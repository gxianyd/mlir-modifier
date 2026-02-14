import type { Node, Edge } from '@xyflow/react';
import type {
  IRGraph,
  OperationInfo,
  BlockInfo,
  RegionInfo,
} from '../../types/ir';
import type { OpNodeData } from './OpNode';
import type { InputNodeData } from './InputNode';

/**
 * Default maximum nesting depth for inline expansion.
 * 0 means: only show direct body ops of the view root; any op with regions
 * is rendered as a collapsed card with a drill-in hint.
 * Higher values expand nested regions inline as flat sibling cards.
 */
const DEFAULT_MAX_EXPAND_DEPTH = 0;

// ─── Lookup helpers ────────────────────────────────────────────────

/**
 * Pre-build fast lookup maps from the flat IR arrays so that
 * subsequent traversal can find ops/blocks/regions/value-producers in O(1).
 */
function buildLookups(graph: IRGraph) {
  // op_id -> OperationInfo
  const opMap = new Map<string, OperationInfo>();
  for (const op of graph.operations) opMap.set(op.op_id, op);

  // block_id -> BlockInfo
  const blockMap = new Map<string, BlockInfo>();
  for (const b of graph.blocks) blockMap.set(b.block_id, b);

  // region_id -> RegionInfo
  const regionMap = new Map<string, RegionInfo>();
  for (const r of graph.regions) regionMap.set(r.region_id, r);

  // value_id -> producing op & result index
  // Used to trace SSA data-flow edges (which op produced this value)
  const valueProducerMap = new Map<string, { opId: string; resultIndex: number }>();
  for (const op of graph.operations) {
    op.results.forEach((result, idx) => {
      valueProducerMap.set(result.value_id, { opId: op.op_id, resultIndex: idx });
    });
  }

  // value_id -> block argument source node ID
  // Used to create edges from input nodes to consumer ops
  const blockArgNodeMap = new Map<string, string>();
  for (const block of graph.blocks) {
    block.arguments.forEach((arg) => {
      // Node ID for this block arg: "input_{value_id}"
      blockArgNodeMap.set(arg.value_id, `input_${arg.value_id}`);
    });
  }

  return { opMap, blockMap, regionMap, valueProducerMap, blockArgNodeMap };
}

// ─── View root resolution ──────────────────────────────────────────

/**
 * Determine which regions to render based on the current viewPath.
 *
 * The last element in viewPath is the "view root" op.
 * We render the contents of that op's regions.
 *
 * Examples:
 *   viewPath = ['op_module']                     → render module's regions (top-level view)
 *   viewPath = ['op_module', 'op_func']          → render func.func's regions
 *   viewPath = ['op_module', 'op_func', 'op_for']→ render scf.for's regions (drill-in)
 */
function getViewRootRegionIds(
  graph: IRGraph,
  viewPath: string[],
  opMap: Map<string, OperationInfo>,
): string[] {
  if (viewPath.length === 0) return [];

  const rootOpId = viewPath[viewPath.length - 1];

  // Special case: the module op is the root.
  // Its regions are found by filtering graph.regions (module isn't in graph.operations).
  if (rootOpId === graph.module_id) {
    const moduleRegions = graph.regions.filter((r) => r.parent_op === rootOpId);
    return moduleRegions.map((r) => r.region_id);
  }

  // Normal op: return its region IDs from the operation info
  const rootOp = opMap.get(rootOpId);
  if (!rootOp) return [];
  return rootOp.regions;
}

// ─── Recursive region walker ───────────────────────────────────────

/**
 * Recursively traverse regions → blocks → operations and generate React Flow nodes.
 *
 * All nodes are rendered as flat "opNode" cards (no Group Nodes / containers).
 *
 * For each op encountered:
 *   - If it has regions AND depth <= maxExpandDepth → render the op as a normal card,
 *     THEN recurse into its child regions (children appear as flat sibling cards).
 *   - If it has regions AND depth > maxExpandDepth → render as a collapsed "opNode"
 *     with a drill-in hint. Do NOT recurse; children stay hidden.
 *   - If it has no regions → render as a regular "opNode".
 *
 * @param regionIds      Region IDs to walk
 * @param depth          Current nesting depth relative to the view root (starts at 1)
 * @param maxExpandDepth Threshold: expand if depth <= this, collapse otherwise
 * @param lookups        Pre-built lookup maps
 * @param nodes          Output array — nodes are pushed here
 * @param visibleOpIds   Output set — tracks which ops are visible (for edge filtering)
 */
function walkRegions(
  regionIds: string[],
  depth: number,
  maxExpandDepth: number,
  lookups: ReturnType<typeof buildLookups>,
  nodes: Node[],
  visibleOpIds: Set<string>,
  visibleInputNodeIds: Set<string>,
): void {
  const { opMap, blockMap, regionMap, blockArgNodeMap } = lookups;

  for (const regionId of regionIds) {
    const region = regionMap.get(regionId);
    if (!region) continue;

    for (const blockId of region.blocks) {
      const block = blockMap.get(blockId);
      if (!block) continue;

      // Create input nodes for block arguments
      for (const arg of block.arguments) {
        const nodeId = blockArgNodeMap.get(arg.value_id);
        if (!nodeId) continue;

        const nodeData: InputNodeData = {
          label: arg.value_id,
          type: arg.type,
          valueId: arg.value_id,
        };

        nodes.push({
          id: nodeId,
          type: 'inputNode',
          data: nodeData,
          position: { x: 0, y: 0 },
        });
        visibleInputNodeIds.add(nodeId);
      }

      for (const opId of block.operations) {
        const op = opMap.get(opId);
        if (!op) continue;

        const hasRegions = op.regions.length > 0;

        if (hasRegions && depth <= maxExpandDepth) {
          // ── Expanded op ──
          // Render the op itself as a normal card, then also render its children
          // as flat siblings (no container, no parentId).
          const nodeData: OpNodeData = {
            label: op.name,
            dialect: op.dialect,
            attributes: op.attributes,
            operands: op.operands,
            results: op.results,
            hasRegions: true,
          };

          nodes.push({
            id: op.op_id,
            type: 'opNode',
            data: nodeData,
            position: { x: 0, y: 0 },
          });
          visibleOpIds.add(op.op_id);

          // Recurse into this op's regions — children become flat sibling cards
          walkRegions(
            op.regions,
            depth + 1,
            maxExpandDepth,
            lookups,
            nodes,
            visibleOpIds,
            visibleInputNodeIds,
          );
        } else if (hasRegions && depth > maxExpandDepth) {
          // ── Collapsed op (depth exceeds threshold) ──
          // Shown as a card with a "drill-in" indicator.
          // Children are NOT rendered — user must double-click to drill in.
          const nodeData: OpNodeData = {
            label: op.name,
            dialect: op.dialect,
            attributes: op.attributes,
            operands: op.operands,
            results: op.results,
            hasRegions: true,
            collapsed: true,
            regionCount: op.regions.length,
          };

          nodes.push({
            id: op.op_id,
            type: 'opNode',
            data: nodeData,
            position: { x: 0, y: 0 },
          });
          visibleOpIds.add(op.op_id);
          // Do NOT recurse — children stay hidden
        } else {
          // ── Regular op (leaf, no regions) ──
          const nodeData: OpNodeData = {
            label: op.name,
            dialect: op.dialect,
            attributes: op.attributes,
            operands: op.operands,
            results: op.results,
            hasRegions: false,
          };

          nodes.push({
            id: op.op_id,
            type: 'opNode',
            data: nodeData,
            position: { x: 0, y: 0 },
          });
          visibleOpIds.add(op.op_id);
        }
      }
    }
  }
}

// ─── Edge generation ───────────────────────────────────────────────

/**
 * Generate data-flow edges between visible nodes.
 *
 * For each visible op, iterate its operands:
 *   - If the operand is produced by another visible op → edge from that op
 *   - If the operand is a block argument with a visible input node → edge from input node
 */
function generateEdges(
  visibleOpIds: Set<string>,
  visibleInputNodeIds: Set<string>,
  lookups: ReturnType<typeof buildLookups>,
): Edge[] {
  const edges: Edge[] = [];
  const { opMap, valueProducerMap, blockArgNodeMap } = lookups;

  for (const opId of visibleOpIds) {
    const op = opMap.get(opId);
    if (!op) continue;

    op.operands.forEach((operand, operandIdx) => {
      const producer = valueProducerMap.get(operand.value_id);
      if (producer && visibleOpIds.has(producer.opId)) {
        // Edge from a producing op's result
        edges.push({
          id: `edge-${operand.value_id}-${op.op_id}-${operandIdx}`,
          source: producer.opId,
          sourceHandle: `out-${producer.resultIndex}`,
          target: op.op_id,
          targetHandle: `in-${operandIdx}`,
          label: operand.type,
          style: { stroke: '#888' },
          labelStyle: { fontSize: 10, fill: '#aaa' },
          deletable: true,
          data: { valueId: operand.value_id, toOp: op.op_id, toOperandIndex: operandIdx },
        });
        return;
      }

      // Check if the operand comes from a block argument input node
      const inputNodeId = blockArgNodeMap.get(operand.value_id);
      if (inputNodeId && visibleInputNodeIds.has(inputNodeId)) {
        edges.push({
          id: `edge-${operand.value_id}-${op.op_id}-${operandIdx}`,
          source: inputNodeId,
          sourceHandle: 'out-0',
          target: op.op_id,
          targetHandle: `in-${operandIdx}`,
          label: operand.type,
          style: { stroke: '#1890ff' },
          labelStyle: { fontSize: 10, fill: '#91d5ff' },
          deletable: true,
          data: { valueId: operand.value_id, toOp: op.op_id, toOperandIndex: operandIdx },
        });
      }
    });
  }

  return edges;
}

// ─── Main entry point ──────────────────────────────────────────────

/**
 * Convert the backend IR graph into React Flow nodes and edges.
 *
 * All ops are rendered as flat "opNode" cards (no container/group nodes).
 * Nesting is handled by depth-based expansion:
 *   - Ops with regions at depth <= maxExpandDepth: card is shown AND its children
 *     are rendered as flat sibling cards on the same canvas.
 *   - Ops with regions at depth > maxExpandDepth: collapsed card with drill-in hint.
 *   - Edges are only generated between visible ops.
 *
 * @param graph           The full IR graph returned by the backend `/model/load` API
 * @param viewPath        Op ID path representing the current drill-in location.
 *                        The last element is the "view root" whose regions are rendered.
 *                        Example: ['op_module'] for top-level, or
 *                                 ['op_module', 'op_func', 'op_for'] after drilling into scf.for
 * @param maxExpandDepth  How many levels of nesting to expand inline (default: 1).
 *                        Ops with regions at depth > this are collapsed.
 * @returns               React Flow nodes and edges ready for rendering
 */
export function irToFlow(
  graph: IRGraph,
  viewPath: string[],
  maxExpandDepth: number = DEFAULT_MAX_EXPAND_DEPTH,
): { nodes: Node[]; edges: Edge[] } {
  // Build O(1) lookup maps from the flat arrays
  const lookups = buildLookups(graph);

  // Determine which regions to render based on viewPath
  const regionIds = getViewRootRegionIds(graph, viewPath, lookups.opMap);

  // If viewPath points to a nonexistent op or op with no regions, return empty
  if (regionIds.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes: Node[] = [];
  const visibleOpIds = new Set<string>();
  const visibleInputNodeIds = new Set<string>();

  // Recursively generate nodes, starting at depth=1
  walkRegions(regionIds, 1, maxExpandDepth, lookups, nodes, visibleOpIds, visibleInputNodeIds);

  // Generate edges between visible ops and input nodes
  const edges = generateEdges(visibleOpIds, visibleInputNodeIds, lookups);

  return { nodes, edges };
}
