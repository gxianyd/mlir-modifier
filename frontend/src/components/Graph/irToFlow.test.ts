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

/**
 * Nested test fixture:
 *   builtin.module (op_module)
 *     └─ func.func @main (op_func)
 *          └─ region_0 / block_0
 *               ├─ arith.addf (op_addf2)
 *               ├─ scf.for (op_scf_for)  — has region
 *               │    └─ region_1 / block_1
 *               │         ├─ arith.mulf (op_inner_mulf)
 *               │         └─ scf.yield (op_yield)
 *               └─ func.return (op_return2)
 */
const NESTED_GRAPH: IRGraph = {
  module_id: 'op_module',
  operations: [
    {
      op_id: 'op_func',
      name: 'func.func',
      dialect: 'func',
      attributes: { sym_name: { type: 'StringAttr', value: '"main"' } },
      operands: [],
      results: [],
      regions: ['region_0'],
      parent_block: 'block_module',
      position: 0,
    },
    {
      op_id: 'op_addf2',
      name: 'arith.addf',
      dialect: 'arith',
      attributes: {},
      operands: [
        { value_id: 'val_arg0', type: 'f32' },
        { value_id: 'val_arg1', type: 'f32' },
      ],
      results: [{ value_id: 'val_addf2_result', type: 'f32' }],
      regions: [],
      parent_block: 'block_0',
      position: 0,
    },
    {
      op_id: 'op_scf_for',
      name: 'scf.for',
      dialect: 'scf',
      attributes: {},
      operands: [{ value_id: 'val_addf2_result', type: 'f32' }],
      results: [{ value_id: 'val_for_result', type: 'f32' }],
      regions: ['region_1'],
      parent_block: 'block_0',
      position: 1,
    },
    {
      op_id: 'op_inner_mulf',
      name: 'arith.mulf',
      dialect: 'arith',
      attributes: {},
      operands: [
        { value_id: 'val_iter_arg', type: 'f32' },
        { value_id: 'val_iter_arg', type: 'f32' },
      ],
      results: [{ value_id: 'val_mulf_result', type: 'f32' }],
      regions: [],
      parent_block: 'block_1',
      position: 0,
    },
    {
      op_id: 'op_yield',
      name: 'scf.yield',
      dialect: 'scf',
      attributes: {},
      operands: [{ value_id: 'val_mulf_result', type: 'f32' }],
      results: [],
      regions: [],
      parent_block: 'block_1',
      position: 1,
    },
    {
      op_id: 'op_return2',
      name: 'func.return',
      dialect: 'func',
      attributes: {},
      operands: [{ value_id: 'val_for_result', type: 'f32' }],
      results: [],
      regions: [],
      parent_block: 'block_0',
      position: 2,
    },
  ],
  blocks: [
    {
      block_id: 'block_module',
      arguments: [],
      parent_region: 'region_module',
      operations: ['op_func'],
    },
    {
      block_id: 'block_0',
      arguments: [
        { value_id: 'val_arg0', type: 'f32' },
        { value_id: 'val_arg1', type: 'f32' },
      ],
      parent_region: 'region_0',
      operations: ['op_addf2', 'op_scf_for', 'op_return2'],
    },
    {
      block_id: 'block_1',
      arguments: [{ value_id: 'val_iter_arg', type: 'f32' }],
      parent_region: 'region_1',
      operations: ['op_inner_mulf', 'op_yield'],
    },
  ],
  regions: [
    { region_id: 'region_module', parent_op: 'op_module', blocks: ['block_module'] },
    { region_id: 'region_0', parent_op: 'op_func', blocks: ['block_0'] },
    { region_id: 'region_1', parent_op: 'op_scf_for', blocks: ['block_1'] },
  ],
  edges: [
    { from_value: 'val_arg0', to_op: 'op_addf2', to_operand_index: 0 },
    { from_value: 'val_arg1', to_op: 'op_addf2', to_operand_index: 1 },
    { from_value: 'val_addf2_result', to_op: 'op_scf_for', to_operand_index: 0 },
    { from_value: 'val_iter_arg', to_op: 'op_inner_mulf', to_operand_index: 0 },
    { from_value: 'val_iter_arg', to_op: 'op_inner_mulf', to_operand_index: 1 },
    { from_value: 'val_mulf_result', to_op: 'op_yield', to_operand_index: 0 },
    { from_value: 'val_for_result', to_op: 'op_return2', to_operand_index: 0 },
  ],
};

// ─── Function-level view tests ─────────────────────────────────────
// In real usage, viewPath is ['op_module', 'op_func'] so we view the
// function's body directly. func.func itself is NOT rendered.

describe('irToFlow — function body view', () => {
  // viewPath drills into the single function
  const viewPath = ['op_module', 'op_func'];

  it('should not include func.func or module as nodes', () => {
    const { nodes } = irToFlow(SIMPLE_GRAPH, viewPath);
    const nodeIds = new Set(nodes.map((n) => n.id));
    expect(nodeIds.has('op_module')).toBe(false);
    expect(nodeIds.has('op_func')).toBe(false);
  });

  it('should render only the function body ops', () => {
    const { nodes } = irToFlow(SIMPLE_GRAPH, viewPath);
    const nodeIds = new Set(nodes.map((n) => n.id));
    expect(nodeIds.has('op_addf')).toBe(true);
    expect(nodeIds.has('op_mulf')).toBe(true);
    expect(nodeIds.has('op_return')).toBe(true);
    expect(nodes.length).toBe(3);
  });

  it('should create edges between ops connected by SSA values', () => {
    const { edges } = irToFlow(SIMPLE_GRAPH, viewPath);
    const addfToMulf = edges.find(
      (e) => e.source === 'op_addf' && e.target === 'op_mulf',
    );
    expect(addfToMulf).toBeDefined();

    const mulfToRet = edges.find(
      (e) => e.source === 'op_mulf' && e.target === 'op_return',
    );
    expect(mulfToRet).toBeDefined();
  });

  it('should set correct source/target handles', () => {
    const { edges } = irToFlow(SIMPLE_GRAPH, viewPath);
    const addfToMulf = edges.find(
      (e) => e.source === 'op_addf' && e.target === 'op_mulf',
    );
    expect(addfToMulf?.sourceHandle).toBe('out-0');
    expect(addfToMulf?.targetHandle).toBe('in-0');
  });

  it('should set node data with correct dialect and attributes', () => {
    const { nodes } = irToFlow(SIMPLE_GRAPH, viewPath);
    const addfNode = nodes.find((n) => n.id === 'op_addf');
    expect(addfNode?.data.dialect).toBe('arith');
    expect(addfNode?.data.label).toBe('arith.addf');
    expect(addfNode?.data.attributes).toHaveProperty('fastmath');
  });

  it('should render all nodes as opNode type', () => {
    const { nodes } = irToFlow(SIMPLE_GRAPH, viewPath);
    for (const node of nodes) {
      expect(node.type).toBe('opNode');
    }
  });

  it('should include type labels on edges', () => {
    const { edges } = irToFlow(SIMPLE_GRAPH, viewPath);
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
    const { nodes, edges } = irToFlow(emptyGraph, ['op_module']);
    expect(nodes.length).toBe(0);
    expect(edges.length).toBe(0);
  });
});

// ─── Nested rendering & drill-in tests ─────────────────────────────

describe('irToFlow — nested rendering', () => {
  // viewPath drills into func.func — we see its body ops directly
  const funcViewPath = ['op_module', 'op_func'];

  it('should show function body ops without func.func itself', () => {
    const { nodes } = irToFlow(NESTED_GRAPH, funcViewPath);
    const nodeIds = new Set(nodes.map((n) => n.id));
    // func.func is the view root — NOT rendered as a node
    expect(nodeIds.has('op_func')).toBe(false);
    // Body ops are visible
    expect(nodeIds.has('op_addf2')).toBe(true);
    expect(nodeIds.has('op_scf_for')).toBe(true);
    expect(nodeIds.has('op_return2')).toBe(true);
  });

  it('should collapse scf.for by default (maxExpandDepth=0)', () => {
    const { nodes } = irToFlow(NESTED_GRAPH, funcViewPath);
    const scfForNode = nodes.find((n) => n.id === 'op_scf_for');
    expect(scfForNode).toBeDefined();
    expect(scfForNode?.type).toBe('opNode');
    expect(scfForNode?.data.collapsed).toBe(true);

    // Inner ops should NOT be present
    const innerMulf = nodes.find((n) => n.id === 'op_inner_mulf');
    expect(innerMulf).toBeUndefined();
    const yieldOp = nodes.find((n) => n.id === 'op_yield');
    expect(yieldOp).toBeUndefined();
  });

  it('should expand scf.for when maxExpandDepth=2', () => {
    const { nodes } = irToFlow(NESTED_GRAPH, funcViewPath, 2);
    const nodeIds = new Set(nodes.map((n) => n.id));
    // scf.for expanded — its children are visible
    expect(nodeIds.has('op_scf_for')).toBe(true);
    expect(nodeIds.has('op_inner_mulf')).toBe(true);
    expect(nodeIds.has('op_yield')).toBe(true);
  });

  it('should render all nodes flat (no parentId)', () => {
    const { nodes } = irToFlow(NESTED_GRAPH, funcViewPath, 2);
    for (const node of nodes) {
      expect(node.parentId).toBeUndefined();
    }
  });

  it('should not generate edges for ops inside collapsed regions', () => {
    const { edges } = irToFlow(NESTED_GRAPH, funcViewPath);
    // Edges inside scf.for (inner_mulf -> yield) should not appear
    const innerEdge = edges.find(
      (e) => e.source === 'op_inner_mulf' || e.target === 'op_inner_mulf',
    );
    expect(innerEdge).toBeUndefined();

    // But edges between visible ops should still exist
    const addfToFor = edges.find(
      (e) => e.source === 'op_addf2' && e.target === 'op_scf_for',
    );
    expect(addfToFor).toBeDefined();
  });

  it('should support drill-in: viewPath into scf.for shows only its contents', () => {
    const { nodes } = irToFlow(NESTED_GRAPH, ['op_module', 'op_func', 'op_scf_for']);
    const nodeIds = new Set(nodes.map((n) => n.id));
    // Should see inner ops of scf.for
    expect(nodeIds.has('op_inner_mulf')).toBe(true);
    expect(nodeIds.has('op_yield')).toBe(true);
    // Should NOT see outer ops or the scf.for itself
    expect(nodeIds.has('op_scf_for')).toBe(false);
    expect(nodeIds.has('op_addf2')).toBe(false);
    expect(nodeIds.has('op_return2')).toBe(false);
    expect(nodeIds.has('op_func')).toBe(false);
  });

  it('should generate edges within drill-in view', () => {
    const { edges } = irToFlow(NESTED_GRAPH, ['op_module', 'op_func', 'op_scf_for']);
    // inner_mulf -> yield edge should exist
    const mulfToYield = edges.find(
      (e) => e.source === 'op_inner_mulf' && e.target === 'op_yield',
    );
    expect(mulfToYield).toBeDefined();
  });

  it('should handle ops with empty regions', () => {
    const graphWithEmptyRegion: IRGraph = {
      module_id: 'op_module',
      operations: [
        {
          op_id: 'op_empty',
          name: 'test.empty_region',
          dialect: 'test',
          attributes: {},
          operands: [],
          results: [],
          regions: ['region_empty'],
          parent_block: 'block_module',
          position: 0,
        },
      ],
      blocks: [
        {
          block_id: 'block_module',
          arguments: [],
          parent_region: 'region_module',
          operations: ['op_empty'],
        },
      ],
      regions: [
        { region_id: 'region_module', parent_op: 'op_module', blocks: ['block_module'] },
        { region_id: 'region_empty', parent_op: 'op_empty', blocks: [] },
      ],
      edges: [],
    };
    const { nodes } = irToFlow(graphWithEmptyRegion, ['op_module']);
    const emptyNode = nodes.find((n) => n.id === 'op_empty');
    expect(emptyNode).toBeDefined();
    expect(emptyNode?.type).toBe('opNode');
    expect(emptyNode?.data.hasRegions).toBe(true);
  });
});
