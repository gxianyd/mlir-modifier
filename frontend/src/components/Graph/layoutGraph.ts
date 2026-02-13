import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

/** Fixed dimensions for all op nodes — consistent card size */
const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

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

  // Register all nodes with uniform size
  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Register edges for dagre ranking
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  // Apply computed positions (dagre returns center coords, convert to top-left)
  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
