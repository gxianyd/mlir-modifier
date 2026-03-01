import { describe, it, expect, beforeEach } from 'vitest';
import { irToFlow } from './irToFlow';
import { createNodeGroup, resetGroupCounter } from './groupUtils';
import type { IRGraph, NodeGroup } from '../../types/ir';

/**
 * Shared test fixture: A → B → C chain
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
      parent_region: 'region_func',
      operations: ['op_a', 'op_b', 'op_c', 'op_return'],
    },
  ],
  regions: [
    { region_id: 'region_func', parent_op: 'op_func', blocks: ['block_0'] },
  ],
  edges: [
    { from_value: 'val_arg0', to_op: 'op_a', to_operand_index: 0 },
    { from_value: 'val_arg1', to_op: 'op_a', to_operand_index: 1 },
    { from_value: 'val_a_result', to_op: 'op_b', to_operand_index: 0 },
    { from_value: 'val_b_result', to_op: 'op_c', to_operand_index: 0 },
    { from_value: 'val_c_result', to_op: 'op_return', to_operand_index: 0 },
  ],
};

const VIEW_PATH = ['op_module', 'op_func'];
const MODULE_REGION_GRAPH: IRGraph = {
  ...CHAIN_GRAPH,
  regions: [
    // The module region points to op_func
    { region_id: 'region_module', parent_op: 'op_module', blocks: ['block_module'] },
    // The func region holds actual ops
    { region_id: 'region_func', parent_op: 'op_func', blocks: ['block_0'] },
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
      parent_region: 'region_func',
      operations: ['op_a', 'op_b', 'op_c', 'op_return'],
    },
  ],
  operations: [
    {
      op_id: 'op_func',
      name: 'func.func',
      dialect: 'func',
      attributes: {},
      operands: [],
      results: [],
      regions: ['region_func'],
      parent_block: 'block_module',
      position: 0,
    },
    ...CHAIN_GRAPH.operations,
  ],
};

describe('irToFlow — collapsed group', () => {
  let collapsedGroup: NodeGroup;

  beforeEach(() => {
    resetGroupCounter();
    collapsedGroup = createNodeGroup(['op_a', 'op_b'], MODULE_REGION_GRAPH);
    // displayMode defaults to 'collapsed'
    expect(collapsedGroup.displayMode).toBe('collapsed');
  });

  it('generates a single groupNode instead of member opNodes', () => {
    const { nodes } = irToFlow(
      MODULE_REGION_GRAPH, VIEW_PATH, 0, undefined,
      [collapsedGroup],
    );

    const nodeIds = nodes.map((n) => n.id);
    // Group node should appear
    expect(nodeIds).toContain(collapsedGroup.id);
    // Members should NOT appear as individual opNodes
    expect(nodeIds).not.toContain('op_a');
    expect(nodeIds).not.toContain('op_b');
    // op_c and op_return should still appear (not in the group)
    expect(nodeIds).toContain('op_c');
    expect(nodeIds).toContain('op_return');
  });

  it('groupNode type is "groupNode"', () => {
    const { nodes } = irToFlow(
      MODULE_REGION_GRAPH, VIEW_PATH, 0, undefined,
      [collapsedGroup],
    );
    const groupNode = nodes.find((n) => n.id === collapsedGroup.id);
    expect(groupNode).toBeDefined();
    expect(groupNode!.type).toBe('groupNode');
  });

  it('groupNode data includes inputs and outputs', () => {
    const { nodes } = irToFlow(
      MODULE_REGION_GRAPH, VIEW_PATH, 0, undefined,
      [collapsedGroup],
    );
    const groupNode = nodes.find((n) => n.id === collapsedGroup.id);
    const data = groupNode!.data as { inputs: unknown[]; outputs: unknown[] };
    expect(data.inputs).toHaveLength(2); // val_arg0, val_arg1
    expect(data.outputs).toHaveLength(1); // val_b_result → consumed by op_c
  });

  it('external op → group input edge uses group node as target', () => {
    const { edges } = irToFlow(
      MODULE_REGION_GRAPH, VIEW_PATH, 0, undefined,
      [collapsedGroup],
    );
    // Input nodes (block args) → group node
    const incomingGroupEdges = edges.filter((e) => e.target === collapsedGroup.id);
    expect(incomingGroupEdges.length).toBeGreaterThan(0);
    // The targets should be the group node with in-N handles
    incomingGroupEdges.forEach((e) => {
      expect(e.targetHandle).toMatch(/^in-\d+$/);
    });
  });

  it('group output → external op edge uses group node as source', () => {
    const { edges } = irToFlow(
      MODULE_REGION_GRAPH, VIEW_PATH, 0, undefined,
      [collapsedGroup],
    );
    // Group output (val_b_result) → op_c
    const outgoingGroupEdges = edges.filter((e) => e.source === collapsedGroup.id);
    expect(outgoingGroupEdges.length).toBeGreaterThan(0);
    const edgeToC = outgoingGroupEdges.find((e) => e.target === 'op_c');
    expect(edgeToC).toBeDefined();
    expect(edgeToC!.sourceHandle).toMatch(/^out-\d+$/);
  });

  it('intra-group edges are not generated', () => {
    const { edges } = irToFlow(
      MODULE_REGION_GRAPH, VIEW_PATH, 0, undefined,
      [collapsedGroup],
    );
    // val_a_result is produced by op_a (in group) and consumed by op_b (in group)
    // This edge should NOT appear
    const intraEdge = edges.find(
      (e) => e.source === 'op_a' && e.target === 'op_b',
    );
    expect(intraEdge).toBeUndefined();
  });
});

describe('irToFlow — inline group (expanded)', () => {
  let inlineGroup: NodeGroup;

  beforeEach(() => {
    resetGroupCounter();
    const g = createNodeGroup(['op_a', 'op_b'], MODULE_REGION_GRAPH);
    inlineGroup = { ...g, displayMode: 'expanded' };
  });

  it('member opNodes are all visible (not merged into group node)', () => {
    const { nodes } = irToFlow(
      MODULE_REGION_GRAPH, VIEW_PATH, 0, undefined,
      [inlineGroup],
    );
    const nodeIds = nodes.map((n) => n.id);
    expect(nodeIds).toContain('op_a');
    expect(nodeIds).toContain('op_b');
    // No separate group node
    expect(nodeIds).not.toContain(inlineGroup.id);
  });

  it('member opNodes have groupColor set in their data', () => {
    const { nodes } = irToFlow(
      MODULE_REGION_GRAPH, VIEW_PATH, 0, undefined,
      [inlineGroup],
    );
    const opANode = nodes.find((n) => n.id === 'op_a');
    const opBNode = nodes.find((n) => n.id === 'op_b');
    expect((opANode!.data as { groupColor?: string }).groupColor).toBeTruthy();
    expect((opBNode!.data as { groupColor?: string }).groupColor).toBeTruthy();
    // Both in the same group → same color
    expect((opANode!.data as { groupColor?: string }).groupColor)
      .toBe((opBNode!.data as { groupColor?: string }).groupColor);
  });

  it('non-member nodes do NOT have groupColor', () => {
    const { nodes } = irToFlow(
      MODULE_REGION_GRAPH, VIEW_PATH, 0, undefined,
      [inlineGroup],
    );
    const opCNode = nodes.find((n) => n.id === 'op_c');
    expect((opCNode!.data as { groupColor?: string }).groupColor).toBeUndefined();
  });
});

describe('irToFlow — drilldown mode', () => {
  let group: NodeGroup;

  beforeEach(() => {
    resetGroupCounter();
    group = createNodeGroup(['op_a', 'op_b'], MODULE_REGION_GRAPH);
  });

  it('only group member ops are shown', () => {
    const { nodes } = irToFlow(
      MODULE_REGION_GRAPH, VIEW_PATH, 0, undefined,
      [group], group.id,
    );
    const opNodes = nodes.filter((n) => n.type === 'opNode');
    const opIds = opNodes.map((n) => n.id);
    // Only group members
    expect(opIds).toContain('op_a');
    expect(opIds).toContain('op_b');
    // Non-members excluded
    expect(opIds).not.toContain('op_c');
    expect(opIds).not.toContain('op_return');
  });

  it('no groupNode is rendered in drilldown mode', () => {
    const { nodes } = irToFlow(
      MODULE_REGION_GRAPH, VIEW_PATH, 0, undefined,
      [group], group.id,
    );
    const groupNode = nodes.find((n) => n.id === group.id);
    expect(groupNode).toBeUndefined();
  });

  it('input nodes for external values are present', () => {
    const { nodes } = irToFlow(
      MODULE_REGION_GRAPH, VIEW_PATH, 0, undefined,
      [group], group.id,
    );
    const inputNodes = nodes.filter((n) => n.type === 'inputNode');
    // op_a consumes val_arg0 and val_arg1 (block args)
    const inputValueIds = inputNodes.map((n) => (n.data as { valueId: string }).valueId);
    expect(inputValueIds).toContain('val_arg0');
    expect(inputValueIds).toContain('val_arg1');
  });
});

describe('irToFlow — no groups (backward compatibility)', () => {
  it('returns same result as before when no nodeGroups provided', () => {
    const { nodes, edges } = irToFlow(MODULE_REGION_GRAPH, VIEW_PATH);
    const nodeIds = nodes.map((n) => n.id);
    expect(nodeIds).toContain('op_a');
    expect(nodeIds).toContain('op_b');
    expect(nodeIds).toContain('op_c');
    expect(nodeIds).toContain('op_return');
    // Input nodes for block args
    expect(nodeIds).toContain('input_val_arg0');
    expect(nodeIds).toContain('input_val_arg1');
    // Edges exist
    expect(edges.length).toBeGreaterThan(0);
  });

  it('no groupColor on any node when no groups', () => {
    const { nodes } = irToFlow(MODULE_REGION_GRAPH, VIEW_PATH);
    nodes
      .filter((n) => n.type === 'opNode')
      .forEach((n) => {
        expect((n.data as { groupColor?: string }).groupColor).toBeUndefined();
      });
  });
});
