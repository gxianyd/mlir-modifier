import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';

export interface InputNodeData {
  /** Display label, e.g. "%arg0" */
  label: string;
  /** MLIR type string, e.g. "f32", "tensor<2x3xf32>" */
  type: string;
  /** The value_id for edge connections */
  valueId: string;
  [key: string]: unknown;
}

export type InputNodeType = Node<InputNodeData, 'inputNode'>;

function InputNode({ data }: NodeProps<InputNodeType>) {
  return (
    <div style={{
      minWidth: 120,
      border: '1px solid #91d5ff',
      borderRadius: 16,
      background: '#e6f7ff',
      fontSize: 12,
      padding: '6px 14px',
      textAlign: 'center',
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    }}>
      <div style={{ fontWeight: 600, color: '#1890ff' }}>
        {data.label}
      </div>
      <div style={{ color: '#666', fontSize: 11 }}>
        {data.type}
      </div>

      {/* Output handle — block args produce values consumed by ops */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="out-0"
        style={{
          background: '#1890ff',
          width: 8,
          height: 8,
          border: '2px solid #fff',
        }}
      />
    </div>
  );
}

export default memo(InputNode);
