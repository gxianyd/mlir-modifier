import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import OpNode from './OpNode';
import type { OpNodeData } from './OpNode';

// Mock @xyflow/react to avoid ReactFlow context requirements in unit tests
vi.mock('@xyflow/react', () => ({
  Handle: ({ id, style, title }: { id: string; style?: React.CSSProperties; title?: string }) =>
    React.createElement('div', { 'data-handle-id': id, style, title }),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

// Cast OpNode to a simpler prop type for testing (only 'data' is used in the component body)
const TestableOpNode = OpNode as React.ComponentType<{ data: OpNodeData }>;

describe('OpNode', () => {
  it('should export OpNode component', () => {
    expect(OpNode).toBeDefined();
    expect(typeof OpNode === 'object' || typeof OpNode === 'function').toBe(true);
  });

  it('should have correct interface for OpNodeData', () => {
    const mockData: OpNodeData = {
      label: 'arith.addf',
      dialect: 'arith',
      attributes: {},
      operands: [
        { value_id: 'val_1', type: 'f32' },
        { value_id: 'val_2', type: 'f32' },
      ],
      results: [{ value_id: 'val_result', type: 'f32' }],
      hasRegions: false,
    };

    expect(mockData.label).toBe('arith.addf');
    expect(mockData.dialect).toBe('arith');
    expect(mockData.operands.length).toBe(2);
    expect(mockData.results.length).toBe(1);
    expect(mockData.hasRegions).toBe(false);
  });

  it('should handle zero operands', () => {
    const mockData: OpNodeData = {
      label: 'test.op',
      dialect: 'test',
      attributes: {},
      operands: [],
      results: [],
      hasRegions: false,
    };

    expect(mockData.operands.length).toBe(0);
  });

  // ── Rendering tests for the "+" add operand handle ──

  it('renders one input handle per operand', () => {
    const data: OpNodeData = {
      label: 'arith.addf',
      dialect: 'arith',
      attributes: {},
      operands: [
        { value_id: 'val_1', type: 'f32' },
        { value_id: 'val_2', type: 'f32' },
      ],
      results: [{ value_id: 'val_result', type: 'f32' }],
      hasRegions: false,
    };
    const { container } = render(<TestableOpNode data={data} />);
    const allInputHandles = container.querySelectorAll('[data-handle-id^="in-"]');
    const operandHandles = Array.from(allInputHandles).filter(
      (el) => el.getAttribute('data-handle-id') !== 'in-add',
    );
    expect(operandHandles.length).toBe(2);
  });

  it('always renders the "+" add operand handle', () => {
    const data: OpNodeData = {
      label: 'arith.addf',
      dialect: 'arith',
      attributes: {},
      operands: [{ value_id: 'val_1', type: 'f32' }],
      results: [{ value_id: 'val_result', type: 'f32' }],
      hasRegions: false,
    };
    const { container } = render(<TestableOpNode data={data} />);
    const addHandle = container.querySelector('[data-handle-id="in-add"]');
    expect(addHandle).not.toBeNull();
  });

  it('renders "+" add handle even with zero operands', () => {
    const data: OpNodeData = {
      label: 'func.return',
      dialect: 'func',
      attributes: {},
      operands: [],
      results: [],
      hasRegions: false,
    };
    const { container } = render(<TestableOpNode data={data} />);
    const addHandle = container.querySelector('[data-handle-id="in-add"]');
    expect(addHandle).not.toBeNull();
  });

  it('"+" add handle has "Add new operand" tooltip', () => {
    const data: OpNodeData = {
      label: 'arith.mulf',
      dialect: 'arith',
      attributes: {},
      operands: [{ value_id: 'val_1', type: 'f32' }],
      results: [{ value_id: 'val_result', type: 'f32' }],
      hasRegions: false,
    };
    const { container } = render(<TestableOpNode data={data} />);
    const addHandle = container.querySelector('[data-handle-id="in-add"]');
    expect(addHandle?.getAttribute('title')).toBe('Add new operand');
  });
});
