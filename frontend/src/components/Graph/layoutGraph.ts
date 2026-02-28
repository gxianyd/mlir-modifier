import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';

/** Fixed dimensions for op nodes — must match OpNode.tsx render size */
const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

/** Smaller dimensions for input (block argument) nodes */
const INPUT_NODE_WIDTH = 140;
const INPUT_NODE_HEIGHT = 44;

const elk = new ELK();

/**
 * Build ELK port descriptors for a node.
 *
 * ELK requires port IDs to be globally unique across the entire graph.
 * We use compound IDs of the form `nodeId:portId` so edge references
 * (which also use `nodeId:portId`) resolve correctly.
 *
 * InputNodes have a single output port at the bottom.
 * OpNodes have `in-N` ports at the top and `out-N` ports at the bottom.
 * Port indices control left-to-right ordering under FIXED_ORDER constraints.
 */
function buildElkPorts(node: Node): Array<{ id: string; properties: Record<string, string> }> {
  if (node.id.startsWith('input_')) {
    return [{
      id: `${node.id}:out-0`,
      properties: { 'port.side': 'SOUTH', 'port.index': '0' },
    }];
  }
  const data = node.data as { operands?: unknown[]; results?: unknown[] };
  const ports: Array<{ id: string; properties: Record<string, string> }> = [];
  (data.operands ?? []).forEach((_, i) =>
    ports.push({ id: `${node.id}:in-${i}`, properties: { 'port.side': 'NORTH', 'port.index': `${i}` } }),
  );
  (data.results ?? []).forEach((_, i) =>
    ports.push({ id: `${node.id}:out-${i}`, properties: { 'port.side': 'SOUTH', 'port.index': `${i}` } }),
  );
  return ports;
}

/**
 * Compute positions for all nodes using the ELK `layered` algorithm.
 *
 * - FIXED_ORDER port constraints enforce operand index ordering natively.
 * - LAYER_SWEEP crossing minimization reduces edge crossings.
 * - SPLINES edge routing avoids routing edges through nodes.
 *
 * The function is async because ELK's layout API is Promise-based.
 *
 * @param nodes  React Flow nodes (positions will be set)
 * @param edges  React Flow edges (used by ELK for ranking and crossing minimization)
 * @returns      Promise resolving to nodes with positions applied, and edges unchanged
 */
export async function layoutGraph(
  nodes: Node[],
  edges: Edge[],
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  if (nodes.length === 0) return { nodes, edges };

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.edgeRouting': 'SPLINES',
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.id.startsWith('input_') ? INPUT_NODE_WIDTH : NODE_WIDTH,
      height: node.id.startsWith('input_') ? INPUT_NODE_HEIGHT : NODE_HEIGHT,
      ports: buildElkPorts(node),
      layoutOptions: { 'elk.portConstraints': 'FIXED_ORDER' },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [`${edge.source}:${edge.sourceHandle ?? 'out-0'}`],
      targets: [`${edge.target}:${edge.targetHandle ?? 'in-0'}`],
    })),
  };

  const result = await elk.layout(elkGraph);

  const posMap = new Map<string, { x: number; y: number }>();
  for (const child of result.children ?? []) {
    posMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  return {
    nodes: nodes.map((n) => ({ ...n, position: posMap.get(n.id) ?? { x: 0, y: 0 } })),
    edges,
  };
}
