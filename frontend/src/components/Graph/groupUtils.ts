import type { IRGraph, GroupInput, GroupOutput, NodeGroup } from '../../types/ir';

/**
 * Compute external inputs and outputs for a group of ops.
 *
 * Inputs:  operands whose producing op is NOT in the group (or is a block arg).
 * Outputs: results consumed by at least one op NOT in the group.
 */
export function computeGroupIO(
  opIds: string[],
  graph: IRGraph,
): { inputs: GroupInput[]; outputs: GroupOutput[] } {
  const groupOpIdSet = new Set(opIds);

  // value_id → producer info
  const valueProducerMap = new Map<string, { opId: string; resultIndex: number }>();
  for (const op of graph.operations) {
    op.results.forEach((r, idx) => {
      valueProducerMap.set(r.value_id, { opId: op.op_id, resultIndex: idx });
    });
  }

  // value_id → list of consumer op_ids
  const valueConsumerMap = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const consumers = valueConsumerMap.get(edge.from_value) || [];
    consumers.push(edge.to_op);
    valueConsumerMap.set(edge.from_value, consumers);
  }

  // --- Inputs ---
  const inputMap = new Map<string, GroupInput>();
  for (const opId of opIds) {
    const op = graph.operations.find((o) => o.op_id === opId);
    if (!op) continue;
    for (const operand of op.operands) {
      const producer = valueProducerMap.get(operand.value_id);
      if (!producer || !groupOpIdSet.has(producer.opId)) {
        const existing = inputMap.get(operand.value_id);
        if (existing) {
          if (!existing.consumerOpIds.includes(opId)) {
            existing.consumerOpIds.push(opId);
          }
        } else {
          inputMap.set(operand.value_id, {
            valueId: operand.value_id,
            type: operand.type,
            consumerOpIds: [opId],
          });
        }
      }
    }
  }

  // --- Outputs ---
  const outputs: GroupOutput[] = [];
  for (const opId of opIds) {
    const op = graph.operations.find((o) => o.op_id === opId);
    if (!op) continue;
    op.results.forEach((result, resultIndex) => {
      const consumers = valueConsumerMap.get(result.value_id) || [];
      const hasExternalConsumer = consumers.some((cId) => !groupOpIdSet.has(cId));
      if (hasExternalConsumer) {
        outputs.push({
          valueId: result.value_id,
          type: result.type,
          producerOpId: opId,
          resultIndex,
        });
      }
    });
  }

  return { inputs: [...inputMap.values()], outputs };
}

let groupCounter = 0;

export function generateGroupId(): string {
  return `group_${++groupCounter}`;
}

/**
 * Reset the group counter (useful for tests).
 */
export function resetGroupCounter(): void {
  groupCounter = 0;
}

/**
 * Create a new NodeGroup from a set of op IDs.
 */
export function createNodeGroup(
  opIds: string[],
  graph: IRGraph,
  name?: string,
): NodeGroup {
  const id = generateGroupId();
  const { inputs, outputs } = computeGroupIO(opIds, graph);
  return {
    id,
    name: name || `Group ${id.split('_')[1]}`,
    opIds,
    displayMode: 'collapsed',
    inputs,
    outputs,
  };
}

const GROUP_COLORS = [
  '#1890ff', '#52c41a', '#fa8c16', '#722ed1',
  '#eb2f96', '#13c2c2', '#f5222d', '#fadb14',
];

/**
 * Get a deterministic color for a group based on its ID.
 * Cycles through GROUP_COLORS palette.
 */
export function getGroupColor(groupId: string): string {
  const index = parseInt(groupId.replace('group_', ''), 10) - 1;
  return GROUP_COLORS[Math.max(0, index) % GROUP_COLORS.length];
}
