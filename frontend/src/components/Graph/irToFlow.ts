import type { Node, Edge } from '@xyflow/react';
import type {
  IRGraph,
  OperationInfo,
  BlockInfo,
  RegionInfo,
  NodeGroup,
  GroupDisplayMode,
} from '../../types/ir';
import type { OpNodeData } from './OpNode';
import type { InputNodeData } from './InputNode';
import type { GroupNodeData } from './GroupNode';
import { getGroupColor } from './groupUtils';

/**
 * Default maximum nesting depth for inline expansion.
 * 0 means: only show direct body ops of the view root; any op with regions
 * is rendered as a collapsed card with a drill-in hint.
 * Higher values expand nested regions inline as flat sibling cards.
 */
const DEFAULT_MAX_EXPAND_DEPTH = 0;

// ─── Group handler callbacks ───────────────────────────────────────

export interface GroupHandlers {
  onRename: (groupId: string, newName: string) => void;
  onUngroup: (groupId: string) => void;
  onSetMode: (groupId: string, mode: GroupDisplayMode) => void;
}

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
 * @param collapsedGroupByOp  Map from opId → collapsed group (skip op, render group node once)
 * @param inlineGroupByOp     Map from opId → inline group (add groupColor to data)
 * @param renderedGroupIds    Set of group IDs already rendered (prevents duplicates)
 * @param groupHandlers       Callbacks for group node actions
 * @param visibleGroupIds     Output set — tracks rendered group node IDs
 */
function walkRegions(
  regionIds: string[],
  depth: number,
  maxExpandDepth: number,
  lookups: ReturnType<typeof buildLookups>,
  nodes: Node[],
  visibleOpIds: Set<string>,
  visibleInputNodeIds: Set<string>,
  hiddenOpNames?: Set<string>,
  collapsedGroupByOp?: Map<string, NodeGroup>,
  inlineGroupByOp?: Map<string, NodeGroup>,
  renderedGroupIds?: Set<string>,
  groupHandlers?: GroupHandlers,
  visibleGroupIds?: Set<string>,
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

        // Skip ops whose name is in the hidden set
        if (hiddenOpNames?.has(op.name)) continue;

        // ── Collapsed group: replace this op with its group node ──
        if (collapsedGroupByOp?.has(opId)) {
          const group = collapsedGroupByOp.get(opId)!;
          if (!renderedGroupIds?.has(group.id)) {
            renderedGroupIds?.add(group.id);
            const color = getGroupColor(group.id);
            const groupNodeData: GroupNodeData = {
              groupId: group.id,
              name: group.name,
              color,
              inputs: group.inputs,
              outputs: group.outputs,
              // Dummy operands/results for ELK port building
              operands: group.inputs.map((inp) => ({ value_id: inp.valueId, type: inp.type })),
              results: group.outputs.map((out) => ({ value_id: out.valueId, type: out.type })),
              onRename: groupHandlers?.onRename ?? (() => {}),
              onUngroup: groupHandlers?.onUngroup ?? (() => {}),
              onSetMode: groupHandlers?.onSetMode ?? (() => {}),
            };
            nodes.push({
              id: group.id,
              type: 'groupNode',
              data: groupNodeData,
              position: { x: 0, y: 0 },
            });
            visibleGroupIds?.add(group.id);
          }
          continue; // Skip the individual op
        }

        // ── Inline group: add groupColor to node data ──
        const inlineGroup = inlineGroupByOp?.get(opId);
        const groupColor = inlineGroup ? getGroupColor(inlineGroup.id) : undefined;

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
            ...(groupColor ? { groupColor } : {}),
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
            hiddenOpNames,
            collapsedGroupByOp,
            inlineGroupByOp,
            renderedGroupIds,
            groupHandlers,
            visibleGroupIds,
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
            ...(groupColor ? { groupColor } : {}),
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
            ...(groupColor ? { groupColor } : {}),
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
 * Handles three kinds of connections:
 *   1. Regular op → regular op (both visible)
 *   2. Input node → regular op
 *   3. Op/input node → collapsed group node (redirected through group input handles)
 *   4. Collapsed group node → regular op (redirected through group output handles)
 */
function generateEdges(
  visibleOpIds: Set<string>,
  visibleInputNodeIds: Set<string>,
  visibleGroupIds: Set<string>,
  lookups: ReturnType<typeof buildLookups>,
  collapsedGroupByOp: Map<string, NodeGroup>,
  collapsedGroupsMap: Map<string, NodeGroup>,
): Edge[] {
  const edges: Edge[] = [];
  const { opMap, valueProducerMap, blockArgNodeMap } = lookups;

  // ── Edges for regular visible ops ──
  for (const opId of visibleOpIds) {
    const op = opMap.get(opId);
    if (!op) continue;

    op.operands.forEach((operand, operandIdx) => {
      const producer = valueProducerMap.get(operand.value_id);

      if (producer) {
        if (visibleOpIds.has(producer.opId)) {
          // Normal op → op edge
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

        // Producer is inside a collapsed group → source = group node
        const producerGroup = collapsedGroupByOp.get(producer.opId);
        if (producerGroup && visibleGroupIds.has(producerGroup.id)) {
          const outputIdx = producerGroup.outputs.findIndex(
            (o) => o.valueId === operand.value_id,
          );
          if (outputIdx >= 0) {
            edges.push({
              id: `edge-${operand.value_id}-${op.op_id}-${operandIdx}`,
              source: producerGroup.id,
              sourceHandle: `out-${outputIdx}`,
              target: op.op_id,
              targetHandle: `in-${operandIdx}`,
              label: operand.type,
              style: { stroke: '#888' },
              labelStyle: { fontSize: 10, fill: '#aaa' },
              deletable: false,
              data: { valueId: operand.value_id, toOp: op.op_id, toOperandIndex: operandIdx },
            });
          }
          return;
        }
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

  // ── Edges INTO collapsed group nodes (group inputs) ──
  for (const groupId of visibleGroupIds) {
    const group = collapsedGroupsMap.get(groupId);
    if (!group) continue;

    group.inputs.forEach((inp, inputIdx) => {
      const producer = valueProducerMap.get(inp.valueId);

      if (producer && visibleOpIds.has(producer.opId)) {
        // Regular op produces this group input
        edges.push({
          id: `edge-${inp.valueId}-${group.id}-${inputIdx}`,
          source: producer.opId,
          sourceHandle: `out-${producer.resultIndex}`,
          target: group.id,
          targetHandle: `in-${inputIdx}`,
          label: inp.type,
          style: { stroke: '#888' },
          labelStyle: { fontSize: 10, fill: '#aaa' },
          deletable: false,
          data: { valueId: inp.valueId, toOp: group.id, toOperandIndex: inputIdx },
        });
        return;
      }

      // Check if producer is another visible group node
      if (producer) {
        const producerGroup = collapsedGroupByOp.get(producer.opId);
        if (producerGroup && visibleGroupIds.has(producerGroup.id) && producerGroup.id !== groupId) {
          const outputIdx = producerGroup.outputs.findIndex((o) => o.valueId === inp.valueId);
          if (outputIdx >= 0) {
            edges.push({
              id: `edge-${inp.valueId}-${group.id}-${inputIdx}`,
              source: producerGroup.id,
              sourceHandle: `out-${outputIdx}`,
              target: group.id,
              targetHandle: `in-${inputIdx}`,
              label: inp.type,
              style: { stroke: '#888' },
              labelStyle: { fontSize: 10, fill: '#aaa' },
              deletable: false,
              data: { valueId: inp.valueId, toOp: group.id, toOperandIndex: inputIdx },
            });
          }
          return;
        }
      }

      // Check if input comes from a block argument
      const inputNodeId = blockArgNodeMap.get(inp.valueId);
      if (inputNodeId && visibleInputNodeIds.has(inputNodeId)) {
        edges.push({
          id: `edge-${inp.valueId}-${group.id}-${inputIdx}`,
          source: inputNodeId,
          sourceHandle: 'out-0',
          target: group.id,
          targetHandle: `in-${inputIdx}`,
          label: inp.type,
          style: { stroke: '#1890ff' },
          labelStyle: { fontSize: 10, fill: '#91d5ff' },
          deletable: false,
          data: { valueId: inp.valueId, toOp: group.id, toOperandIndex: inputIdx },
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
 * @param maxExpandDepth  How many levels of nesting to expand inline (default: 0).
 *                        Ops with regions at depth > this are collapsed.
 * @param hiddenOpNames   Set of op names to hide from the graph
 * @param nodeGroups      List of user-defined node groups to apply
 * @param activeDrillGroupId  If set, render only the ops inside this group (drilldown mode)
 * @param groupHandlers   Callbacks for group node rename/ungroup/setMode actions
 * @returns               React Flow nodes and edges ready for rendering
 */
export function irToFlow(
  graph: IRGraph,
  viewPath: string[],
  maxExpandDepth: number = DEFAULT_MAX_EXPAND_DEPTH,
  hiddenOpNames?: Set<string>,
  nodeGroups?: NodeGroup[],
  activeDrillGroupId?: string | null,
  groupHandlers?: GroupHandlers,
): { nodes: Node[]; edges: Edge[] } {
  // Build O(1) lookup maps from the flat arrays
  const lookups = buildLookups(graph);

  // Determine which regions to render based on viewPath
  const regionIds = getViewRootRegionIds(graph, viewPath, lookups.opMap);

  // If viewPath points to a nonexistent op or op with no regions, return empty
  if (regionIds.length === 0) {
    return { nodes: [], edges: [] };
  }

  // ── Build group lookup maps ──
  const collapsedGroupByOp = new Map<string, NodeGroup>();
  const inlineGroupByOp = new Map<string, NodeGroup>();
  const collapsedGroupsMap = new Map<string, NodeGroup>();

  for (const group of nodeGroups ?? []) {
    // In drilldown mode: ignore all group rendering (show raw ops in the group)
    if (activeDrillGroupId) continue;

    if (group.displayMode === 'collapsed') {
      collapsedGroupsMap.set(group.id, group);
      for (const opId of group.opIds) {
        collapsedGroupByOp.set(opId, group);
      }
    } else if (group.displayMode === 'expanded') {
      for (const opId of group.opIds) {
        inlineGroupByOp.set(opId, group);
      }
    }
    // 'drilldown' mode: handled by activeDrillGroupId above
  }

  const nodes: Node[] = [];
  const visibleOpIds = new Set<string>();
  const visibleInputNodeIds = new Set<string>();
  const visibleGroupIds = new Set<string>();
  const renderedGroupIds = new Set<string>();

  // Recursively generate nodes, starting at depth=1
  walkRegions(
    regionIds, 1, maxExpandDepth, lookups,
    nodes, visibleOpIds, visibleInputNodeIds,
    hiddenOpNames,
    collapsedGroupByOp, inlineGroupByOp, renderedGroupIds,
    groupHandlers, visibleGroupIds,
  );

  // ── Drilldown mode: filter to active group's ops only ──
  if (activeDrillGroupId) {
    const activeGroup = (nodeGroups ?? []).find((g) => g.id === activeDrillGroupId);
    if (activeGroup) {
      const groupOpSet = new Set(activeGroup.opIds);

      // Filter out ops not in the group
      const filteredNodes = nodes.filter((n) => {
        if (n.type === 'opNode') return groupOpSet.has(n.id);
        if (n.type === 'inputNode') {
          // Keep only input nodes consumed by group ops
          const valueId = (n.data as InputNodeData).valueId;
          return activeGroup.inputs.some((inp) => inp.valueId === valueId);
        }
        return false;
      });

      // Add virtual input nodes for op-produced group inputs (external values)
      for (const inp of activeGroup.inputs) {
        const nodeId = `input_${inp.valueId}`;
        if (!filteredNodes.some((n) => n.id === nodeId)) {
          filteredNodes.push({
            id: nodeId,
            type: 'inputNode',
            data: {
              label: inp.type,
              type: inp.type,
              valueId: inp.valueId,
            } satisfies InputNodeData,
            position: { x: 0, y: 0 },
          });
          visibleInputNodeIds.add(nodeId);
        }
      }

      // Replace nodes array content and rebuild visibleOpIds
      nodes.length = 0;
      filteredNodes.forEach((n) => nodes.push(n));
      for (const id of [...visibleOpIds]) {
        if (!groupOpSet.has(id)) visibleOpIds.delete(id);
      }
    }
  }

  // Generate edges between visible ops and input nodes
  const edges = generateEdges(
    visibleOpIds, visibleInputNodeIds, visibleGroupIds,
    lookups, collapsedGroupByOp, collapsedGroupsMap,
  );

  return { nodes, edges };
}
