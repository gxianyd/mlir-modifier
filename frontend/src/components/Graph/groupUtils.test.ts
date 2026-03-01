import { describe, it, expect, beforeEach } from 'vitest';
import { computeGroupIO, createNodeGroup, resetGroupCounter } from './groupUtils';
import type { IRGraph } from '../../types/ir';

/**
 * Test fixture: A → B → C chain
 *
 *   block args: %arg0 (f32), %arg1 (f32)
 *
 *   %0 = opA(%arg0, %arg1)    → val_a_result
 *   %1 = opB(%0)              → val_b_result
 *   %2 = opC(%1)              → val_c_result
 *   return %2
 */
const CHAIN_GRAPH: IRGraph = {
  module_id: 'op_module',
  operations: [
    {
      op_id: 'op_a',
      name: 'arith.addf',
      dialect: 'arith',
      attributes: {},
      operands: [
        { value_id: 'val_arg0', type: 'f32' },
        { value_id: 'val_arg1', type: 'f32' },
      ],
      results: [{ value_id: 'val_a_result', type: 'f32' }],
      regions: [],
      parent_block: 'block_0',
      position: 0,
    },
    {
      op_id: 'op_b',
      name: 'arith.mulf',
      dialect: 'arith',
      attributes: {},
      operands: [{ value_id: 'val_a_result', type: 'f32' }],
      results: [{ value_id: 'val_b_result', type: 'f32' }],
      regions: [],
      parent_block: 'block_0',
      position: 1,
    },
    {
      op_id: 'op_c',
      name: 'arith.negf',
      dialect: 'arith',
      attributes: {},
      operands: [{ value_id: 'val_b_result', type: 'f32' }],
      results: [{ value_id: 'val_c_result', type: 'f32' }],
      regions: [],
      parent_block: 'block_0',
      position: 2,
    },
    {
      op_id: 'op_return',
      name: 'func.return',
      dialect: 'func',
      attributes: {},
      operands: [{ value_id: 'val_c_result', type: 'f32' }],
      results: [],
      regions: [],
      parent_block: 'block_0',
      position: 3,
    },
  ],
  blocks: [
    {
      block_id: 'block_0',
      arguments: [
        { value_id: 'val_arg0', type: 'f32' },
        { value_id: 'val_arg1', type: 'f32' },
      ],
      parent_region: 'region_0',
      operations: ['op_a', 'op_b', 'op_c', 'op_return'],
    },
  ],
  regions: [
    { region_id: 'region_0', parent_op: 'op_func', blocks: ['block_0'] },
  ],
  edges: [
    { from_value: 'val_arg0', to_op: 'op_a', to_operand_index: 0 },
    { from_value: 'val_arg1', to_op: 'op_a', to_operand_index: 1 },
    { from_value: 'val_a_result', to_op: 'op_b', to_operand_index: 0 },
    { from_value: 'val_b_result', to_op: 'op_c', to_operand_index: 0 },
    { from_value: 'val_c_result', to_op: 'op_return', to_operand_index: 0 },
  ],
};

/**
 * Test fixture: two parallel ops consuming the same input
 *
 *   %0 = opX(%arg0)  → val_x_result
 *   %1 = opY(%arg0)  → val_y_result
 *   return %0, %1
 */
const PARALLEL_GRAPH: IRGraph = {
  module_id: 'op_module',
  operations: [
    {
      op_id: 'op_x',
      name: 'arith.addf',
      dialect: 'arith',
      attributes: {},
      operands: [{ value_id: 'val_arg0', type: 'f32' }],
      results: [{ value_id: 'val_x_result', type: 'f32' }],
      regions: [],
      parent_block: 'block_0',
      position: 0,
    },
    {
      op_id: 'op_y',
      name: 'arith.mulf',
      dialect: 'arith',
      attributes: {},
      operands: [{ value_id: 'val_arg0', type: 'f32' }],
      results: [{ value_id: 'val_y_result', type: 'f32' }],
      regions: [],
      parent_block: 'block_0',
      position: 1,
    },
    {
      op_id: 'op_return',
      name: 'func.return',
      dialect: 'func',
      attributes: {},
      operands: [
        { value_id: 'val_x_result', type: 'f32' },
        { value_id: 'val_y_result', type: 'f32' },
      ],
      results: [],
      regions: [],
      parent_block: 'block_0',
      position: 2,
    },
  ],
  blocks: [
    {
      block_id: 'block_0',
      arguments: [{ value_id: 'val_arg0', type: 'f32' }],
      parent_region: 'region_0',
      operations: ['op_x', 'op_y', 'op_return'],
    },
  ],
  regions: [
    { region_id: 'region_0', parent_op: 'op_func', blocks: ['block_0'] },
  ],
  edges: [
    { from_value: 'val_arg0', to_op: 'op_x', to_operand_index: 0 },
    { from_value: 'val_arg0', to_op: 'op_y', to_operand_index: 0 },
    { from_value: 'val_x_result', to_op: 'op_return', to_operand_index: 0 },
    { from_value: 'val_y_result', to_op: 'op_return', to_operand_index: 1 },
  ],
};

describe('computeGroupIO', () => {
  it('serial chain A→B: group has 2 inputs (A operands) and 1 output (B result)', () => {
    const { inputs, outputs } = computeGroupIO(['op_a', 'op_b'], CHAIN_GRAPH);

    // A consumes val_arg0 and val_arg1 (block args, external)
    expect(inputs).toHaveLength(2);
    const inputValueIds = inputs.map((i) => i.valueId).sort();
    expect(inputValueIds).toEqual(['val_arg0', 'val_arg1']);

    // B produces val_b_result, consumed by op_c (external)
    expect(outputs).toHaveLength(1);
    expect(outputs[0].valueId).toBe('val_b_result');
    expect(outputs[0].producerOpId).toBe('op_b');
    expect(outputs[0].resultIndex).toBe(0);
  });

  it('serial chain A→B: internal edge A→B is not counted as input/output', () => {
    const { inputs, outputs } = computeGroupIO(['op_a', 'op_b'], CHAIN_GRAPH);

    // val_a_result is produced by op_a and consumed by op_b — both in group
    const inputIds = inputs.map((i) => i.valueId);
    expect(inputIds).not.toContain('val_a_result');

    const outputIds = outputs.map((o) => o.valueId);
    expect(outputIds).not.toContain('val_a_result');
  });

  it('parallel ops: group has 1 input (shared arg) and 2 outputs', () => {
    const { inputs, outputs } = computeGroupIO(['op_x', 'op_y'], PARALLEL_GRAPH);

    // Both ops consume val_arg0 — deduplicated to 1 input
    expect(inputs).toHaveLength(1);
    expect(inputs[0].valueId).toBe('val_arg0');
    expect(inputs[0].consumerOpIds.sort()).toEqual(['op_x', 'op_y']);

    // Both ops produce results consumed by op_return (external)
    expect(outputs).toHaveLength(2);
    const outputValueIds = outputs.map((o) => o.valueId).sort();
    expect(outputValueIds).toEqual(['val_x_result', 'val_y_result']);
  });

  it('3-op chain: group A+B has A inputs and B output consumed by C', () => {
    const { inputs, outputs } = computeGroupIO(['op_a', 'op_b'], CHAIN_GRAPH);

    // A's operands are block args (external)
    expect(inputs).toHaveLength(2);

    // B's result is consumed by C (external)
    expect(outputs).toHaveLength(1);
    expect(outputs[0].valueId).toBe('val_b_result');
  });

  it('grouping all ops: no outputs (return has no results)', () => {
    const { inputs, outputs } = computeGroupIO(
      ['op_a', 'op_b', 'op_c', 'op_return'],
      CHAIN_GRAPH,
    );

    // Only block args are external inputs
    expect(inputs).toHaveLength(2);

    // No outputs — return has no results, and all consumers are internal
    expect(outputs).toHaveLength(0);
  });

  it('single op: inputs are its operands, outputs are its externally-consumed results', () => {
    const { inputs, outputs } = computeGroupIO(['op_b'], CHAIN_GRAPH);

    // op_b consumes val_a_result (produced by op_a, external)
    expect(inputs).toHaveLength(1);
    expect(inputs[0].valueId).toBe('val_a_result');

    // op_b produces val_b_result, consumed by op_c (external)
    expect(outputs).toHaveLength(1);
    expect(outputs[0].valueId).toBe('val_b_result');
  });
});

describe('createNodeGroup', () => {
  beforeEach(() => {
    resetGroupCounter();
  });

  it('creates a group with correct id, name, and IO', () => {
    const group = createNodeGroup(['op_a', 'op_b'], CHAIN_GRAPH);

    expect(group.id).toBe('group_1');
    expect(group.name).toBe('Group 1');
    expect(group.opIds).toEqual(['op_a', 'op_b']);
    expect(group.displayMode).toBe('collapsed');
    expect(group.inputs).toHaveLength(2);
    expect(group.outputs).toHaveLength(1);
  });

  it('accepts a custom name', () => {
    const group = createNodeGroup(['op_a', 'op_b'], CHAIN_GRAPH, 'My Group');
    expect(group.name).toBe('My Group');
  });

  it('increments group IDs', () => {
    const g1 = createNodeGroup(['op_a', 'op_b'], CHAIN_GRAPH);
    const g2 = createNodeGroup(['op_x', 'op_y'], PARALLEL_GRAPH);
    expect(g1.id).toBe('group_1');
    expect(g2.id).toBe('group_2');
  });
});
