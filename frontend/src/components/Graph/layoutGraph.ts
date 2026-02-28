import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

/** Fixed dimensions for op nodes */
const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

/** Smaller dimensions for input (block argument) nodes */
const INPUT_NODE_WIDTH = 140;
const INPUT_NODE_HEIGHT = 44;

/**
 * Compute positions for all nodes using dagre (top-to-bottom DAG layout).
 *
 * All nodes are treated as flat siblings with the same fixed size.
 * Dagre uses the edge connections to determine vertical ranking
 * (producers above consumers).
 *
 * @param nodes  React Flow nodes (positions will be set)
 * @param edges  React Flow edges (used by dagre for ranking)
 * @returns      The same nodes with positions applied, and edges unchanged
 */
export function layoutGraph(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  // Register nodes with type-appropriate sizes
  for (const node of nodes) {
    const isInput = node.type === 'inputNode';
    g.setNode(node.id, {
      width: isInput ? INPUT_NODE_WIDTH : NODE_WIDTH,
      height: isInput ? INPUT_NODE_HEIGHT : NODE_HEIGHT,
    });
  }

  // Register edges for dagre ranking
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  // Post-process: reorder same-rank source nodes so their left-to-right order
  // matches the operand index order of their shared consumer op.
  // This eliminates the visual edge crossings caused by Dagre not knowing
  // about port positions (handle in-0 = leftmost, in-N = rightmost).
  reorderSourcesByOperandIndex(g, edges);

  // Apply computed positions (dagre returns center coords, convert to top-left)
  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    const isInput = node.type === 'inputNode';
    const w = isInput ? INPUT_NODE_WIDTH : NODE_WIDTH;
    const h = isInput ? INPUT_NODE_HEIGHT : NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * Post-process Dagre layout to reduce edge crossings caused by port ordering.
 *
 * After Dagre assigns positions, the horizontal order of source nodes may not
 * match the operand index order of their shared consumer. Since input handles
 * on OpNode are evenly spaced left-to-right (in-0 = leftmost), misalignment
 * causes visible crossings.
 *
 * For each consumer op with multiple same-rank sources, this function
 * redistributes their x coordinates so that the source for operand 0 is
 * leftmost, operand 1 is next, etc. — using the x positions Dagre already
 * assigned (preserving spacing, just reordering).
 *
 * Nodes are skipped if they:
 *   - feed more than one distinct consumer (can't satisfy both orderings)
 *   - appear as multiple operands of the same consumer (ambiguous position)
 */
function reorderSourcesByOperandIndex(
  g: dagre.graphlib.Graph,
  edges: Edge[],
): void {
  // Build: targetId → [(sourceId, operandIdx)]
  const targetToSources = new Map<string, Array<{ sourceId: string; operandIdx: number }>>();
  for (const edge of edges) {
    const match = edge.targetHandle?.match(/^in-(\d+)$/);
    if (!match) continue;
    const operandIdx = parseInt(match[1], 10);
    if (!targetToSources.has(edge.target)) targetToSources.set(edge.target, []);
    targetToSources.get(edge.target)!.push({ sourceId: edge.source, operandIdx });
  }

  // Count distinct targets each source feeds
  const sourceTargetCount = new Map<string, number>();
  for (const [, sources] of targetToSources) {
    const seen = new Set<string>();
    for (const { sourceId } of sources) {
      if (!seen.has(sourceId)) {
        seen.add(sourceId);
        sourceTargetCount.set(sourceId, (sourceTargetCount.get(sourceId) ?? 0) + 1);
      }
    }
  }

  for (const [, sources] of targetToSources) {
    if (sources.length < 2) continue;

    // Count occurrences of each source within this target's source list
    const occurrences = new Map<string, number>();
    for (const { sourceId } of sources) {
      occurrences.set(sourceId, (occurrences.get(sourceId) ?? 0) + 1);
    }

    // Group eligible sources by rank (quantized y)
    const rankBuckets = new Map<number, Array<{ sourceId: string; operandIdx: number }>>();
    for (const src of sources) {
      const nodePos = g.node(src.sourceId);
      if (!nodePos) continue;
      // Skip: feeds multiple targets or appears multiple times for this target
      if ((sourceTargetCount.get(src.sourceId) ?? 0) > 1) continue;
      if ((occurrences.get(src.sourceId) ?? 0) > 1) continue;

      const rankKey = Math.round(nodePos.y);
      if (!rankBuckets.has(rankKey)) rankBuckets.set(rankKey, []);
      rankBuckets.get(rankKey)!.push(src);
    }

    // For each rank bucket, redistribute x positions by operand index
    for (const [, bucket] of rankBuckets) {
      if (bucket.length < 2) continue;

      // Collect and sort existing x coords (ascending)
      const sortedXs = bucket.map((s) => g.node(s.sourceId).x).sort((a, b) => a - b);

      // Sort bucket entries by operand index (ascending = left to right)
      const sortedByOperand = [...bucket].sort((a, b) => a.operandIdx - b.operandIdx);

      // Assign: operand[0] → leftmost x, operand[1] → next, etc.
      sortedByOperand.forEach((src, i) => {
        g.node(src.sourceId).x = sortedXs[i];
      });
    }
  }
}
