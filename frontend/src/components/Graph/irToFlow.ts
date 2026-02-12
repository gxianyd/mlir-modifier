import type { Node, Edge } from '@xyflow/react';
import type { IRGraph, OperationInfo } from '../../types/ir';
import type { OpNodeData } from './OpNode';

/**
 * Convert the backend IR graph structure into React Flow nodes and edges.
 * Currently renders a flat view of all operations (Phase 1).
 * Nested region support will be added in Phase 2.
 */
export function irToFlow(graph: IRGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Build a lookup: value_id -> { op_id, result_index }
  const valueProducerMap = new Map<string, { opId: string; resultIndex: number }>();

  for (const op of graph.operations) {
    op.results.forEach((result, idx) => {
      valueProducerMap.set(result.value_id, { opId: op.op_id, resultIndex: idx });
    });
  }

  // Also map block arguments as producers (they don't have a source op node in Phase 1)
  // We'll skip edges from block arguments for now

  for (const op of graph.operations) {
    // Skip the module op itself — it's a container, not a visual node
    if (op.name === 'builtin.module') continue;

    const nodeData: OpNodeData = {
      label: op.name,
      dialect: op.dialect,
      attributes: op.attributes,
      operands: op.operands,
      results: op.results,
      hasRegions: op.regions.length > 0,
    };

    nodes.push({
      id: op.op_id,
      type: 'opNode',
      data: nodeData,
      position: { x: 0, y: 0 }, // will be set by layout
    });

    // Create edges from operand sources to this op
    op.operands.forEach((operand, operandIdx) => {
      const producer = valueProducerMap.get(operand.value_id);
      if (producer) {
        edges.push({
          id: `edge-${operand.value_id}-${op.op_id}-${operandIdx}`,
          source: producer.opId,
          sourceHandle: `out-${producer.resultIndex}`,
          target: op.op_id,
          targetHandle: `in-${operandIdx}`,
          label: operand.type,
          style: { stroke: '#888' },
          labelStyle: { fontSize: 10, fill: '#aaa' },
        });
      }
    });
  }

  return { nodes, edges };
}
