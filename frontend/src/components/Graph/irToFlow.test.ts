import { describe, it, expect } from 'vitest';
import { irToFlow } from './irToFlow';
import type { IRGraph } from '../../types/ir';

/**
 * Test fixture: a simple graph simulating the backend response for:
 *   func.func @add_mul(%arg0: f32, %arg1: f32, %arg2: f32) -> f32 {
 *     %0 = arith.addf %arg0, %arg1 : f32
 *     %1 = arith.mulf %0, %arg2 : f32
 *     return %1 : f32
 *   }
 */
const SIMPLE_GRAPH: IRGraph = {
  module_id: 'op_module',
  operations: [
    {
      op_id: 'op_addf',
      name: 'arith.addf',
      dialect: 'arith',
      attributes: {
        fastmath: { type: 'Attribute', value: '#arith.fastmath<none>' },
      },
      operands: [
        { value_id: 'val_arg0', type: 'f32' },
        { value_id: 'val_arg1', type: 'f32' },
      ],
      results: [{ value_id: 'val_add_result', type: 'f32' }],
      regions: [],
      parent_block: 'block_0',
      position: 0,
    },
    {
      op_id: 'op_mulf',
      name: 'arith.mulf',
      dialect: 'arith',
      attributes: {
        fastmath: { type: 'Attribute', value: '#arith.fastmath<none>' },
      },
      operands: [
        { value_id: 'val_add_result', type: 'f32' },
        { value_id: 'val_arg2', type: 'f32' },
      ],
      results: [{ value_id: 'val_mul_result', type: 'f32' }],
      regions: [],
      parent_block: 'block_0',
      position: 1,
    },
    {
      op_id: 'op_return',
      name: 'func.return',
      dialect: 'func',
      attributes: {},
      operands: [{ value_id: 'val_mul_result', type: 'f32' }],
      results: [],
      regions: [],
      parent_block: 'block_0',
      position: 2,
    },
    {
      op_id: 'op_func',
      name: 'func.func',
      dialect: 'func',
      attributes: {
        sym_name: { type: 'StringAttr', value: '"add_mul"' },
        function_type: { type: 'TypeAttr', value: '(f32, f32, f32) -> f32' },
      },
      operands: [],
      results: [],
      regions: ['region_0'],
      parent_block: 'block_module',
      position: 0,
    },
  ],
  blocks: [
    {
      block_id: 'block_0',
      arguments: [
        { value_id: 'val_arg0', type: 'f32' },
        { value_id: 'val_arg1', type: 'f32' },
        { value_id: 'val_arg2', type: 'f32' },
      ],
      parent_region: 'region_0',
      operations: ['op_addf', 'op_mulf', 'op_return'],
    },
    {
      block_id: 'block_module',
      arguments: [],
      parent_region: 'region_module',
      operations: ['op_func'],
    },
  ],
  regions: [
    { region_id: 'region_0', parent_op: 'op_func', blocks: ['block_0'] },
    { region_id: 'region_module', parent_op: 'op_module', blocks: ['block_module'] },
  ],
  edges: [
    { from_value: 'val_arg0', to_op: 'op_addf', to_operand_index: 0 },
    { from_value: 'val_arg1', to_op: 'op_addf', to_operand_index: 1 },
    { from_value: 'val_add_result', to_op: 'op_mulf', to_operand_index: 0 },
    { from_value: 'val_arg2', to_op: 'op_mulf', to_operand_index: 1 },
    { from_value: 'val_mul_result', to_op: 'op_return', to_operand_index: 0 },
  ],
};

describe('irToFlow', () => {
  it('should skip builtin.module op', () => {
    const { nodes } = irToFlow(SIMPLE_GRAPH);
    const nodeIds = nodes.map((n) => n.id);
    expect(nodeIds).not.toContain('op_module');
  });

  it('should create nodes for all non-module ops', () => {
    const { nodes } = irToFlow(SIMPLE_GRAPH);
    const nodeIds = new Set(nodes.map((n) => n.id));
    expect(nodeIds.has('op_addf')).toBe(true);
    expect(nodeIds.has('op_mulf')).toBe(true);
    expect(nodeIds.has('op_return')).toBe(true);
    expect(nodeIds.has('op_func')).toBe(true);
  });

  it('should create edges between ops connected by SSA values', () => {
    const { edges } = irToFlow(SIMPLE_GRAPH);
    // addf -> mulf edge (via val_add_result)
    const addfToMulf = edges.find(
      (e) => e.source === 'op_addf' && e.target === 'op_mulf',
    );
    expect(addfToMulf).toBeDefined();

    // mulf -> return edge (via val_mul_result)
    const mulfToRet = edges.find(
      (e) => e.source === 'op_mulf' && e.target === 'op_return',
    );
    expect(mulfToRet).toBeDefined();
  });

  it('should not create edges for block argument operands (no source op)', () => {
    const { edges } = irToFlow(SIMPLE_GRAPH);
    // Block arguments don't come from any op, so no edges should point from them
    // addf's operands are block args — these should NOT generate edges
    // because block args have no producing op in valueProducerMap
    const edgesToAddf = edges.filter((e) => e.target === 'op_addf');
    expect(edgesToAddf.length).toBe(0);
  });

  it('should set correct source/target handles', () => {
    const { edges } = irToFlow(SIMPLE_GRAPH);
    const addfToMulf = edges.find(
      (e) => e.source === 'op_addf' && e.target === 'op_mulf',
    );
    expect(addfToMulf?.sourceHandle).toBe('out-0'); // addf has 1 result at index 0
    expect(addfToMulf?.targetHandle).toBe('in-0'); // mulf's first operand
  });

  it('should set node data with correct dialect and attributes', () => {
    const { nodes } = irToFlow(SIMPLE_GRAPH);
    const addfNode = nodes.find((n) => n.id === 'op_addf');
    expect(addfNode?.data.dialect).toBe('arith');
    expect(addfNode?.data.label).toBe('arith.addf');
    expect(addfNode?.data.attributes).toHaveProperty('fastmath');
  });

  it('should mark ops with regions', () => {
    const { nodes } = irToFlow(SIMPLE_GRAPH);
    const funcNode = nodes.find((n) => n.id === 'op_func');
    expect(funcNode?.data.hasRegions).toBe(true);

    const addfNode = nodes.find((n) => n.id === 'op_addf');
    expect(addfNode?.data.hasRegions).toBe(false);
  });

  it('should include type labels on edges', () => {
    const { edges } = irToFlow(SIMPLE_GRAPH);
    const addfToMulf = edges.find(
      (e) => e.source === 'op_addf' && e.target === 'op_mulf',
    );
    expect(addfToMulf?.label).toBe('f32');
  });

  it('should handle empty graph', () => {
    const emptyGraph: IRGraph = {
      module_id: 'op_module',
      operations: [],
      blocks: [],
      regions: [],
      edges: [],
    };
    const { nodes, edges } = irToFlow(emptyGraph);
    expect(nodes.length).toBe(0);
    expect(edges.length).toBe(0);
  });
});
