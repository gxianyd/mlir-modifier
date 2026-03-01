import { memo, useState, useRef } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { Input } from 'antd';
import type { GroupInput, GroupOutput, GroupDisplayMode } from '../../types/ir';

export interface GroupNodeData extends Record<string, unknown> {
  groupId: string;
  name: string;
  color: string;
  inputs: GroupInput[];
  outputs: GroupOutput[];
  /** Dummy arrays for ELK port building — length must match inputs/outputs */
  operands: { value_id: string; type: string }[];
  results: { value_id: string; type: string }[];
  onRename: (groupId: string, newName: string) => void;
  onUngroup: (groupId: string) => void;
  onSetMode: (groupId: string, mode: GroupDisplayMode) => void;
}

export type GroupNodeType = Node<GroupNodeData, 'groupNode'>;

function GroupNode({ data }: NodeProps<GroupNodeType>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = () => {
    setDraft(data.name);
    setEditing(true);
    // Focus after render
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const commitRename = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== data.name) {
      data.onRename(data.groupId, trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setEditing(false);
  };

  const inputCount = data.inputs.length;
  const outputCount = data.outputs.length;

  return (
    <div style={{
      minWidth: 160,
      border: `2px solid ${data.color}`,
      borderRadius: 6,
      background: '#fff',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      fontSize: 12,
      overflow: 'hidden',
    }}>
      {/* Input handles — top */}
      {data.inputs.map((inp, i) => (
        <Handle
          key={`in-${i}`}
          type="target"
          position={Position.Top}
          id={`in-${i}`}
          style={{
            left: `${((i + 1) / (inputCount + 1)) * 100}%`,
            background: data.color as string,
            width: 8,
            height: 8,
            border: '2px solid #fff',
          }}
          title={inp.type}
        />
      ))}

      {/* Colored header */}
      <div
        style={{
          background: data.color as string,
          color: '#fff',
          padding: '6px 10px',
          fontWeight: 600,
          textAlign: 'center',
          letterSpacing: 0.3,
          cursor: 'default',
          userSelect: 'none',
        }}
        onDoubleClick={handleDoubleClick}
      >
        {editing ? (
          <Input
            ref={inputRef}
            size="small"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            style={{
              color: '#333',
              background: '#fff',
              borderColor: data.color as string,
              fontSize: 12,
              fontWeight: 600,
              padding: '1px 6px',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span title="Double-click to rename">{data.name}</span>
        )}
      </div>

      {/* Body: show input/output counts */}
      <div style={{ padding: '6px 10px', color: '#666', fontSize: 11 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{inputCount} input{inputCount !== 1 ? 's' : ''}</span>
          <span>{outputCount} output{outputCount !== 1 ? 's' : ''}</span>
        </div>
        {data.inputs.map((inp, i) => (
          <div key={i} style={{ color: '#999', padding: '1px 0' }}>↓ {inp.type}</div>
        ))}
        {data.outputs.map((out, i) => (
          <div key={i} style={{ color: '#999', padding: '1px 0' }}>↑ {out.type}</div>
        ))}
      </div>

      {/* Output handles — bottom */}
      {data.outputs.map((out, i) => (
        <Handle
          key={`out-${i}`}
          type="source"
          position={Position.Bottom}
          id={`out-${i}`}
          style={{
            left: `${((i + 1) / (outputCount + 1)) * 100}%`,
            background: data.color as string,
            width: 8,
            height: 8,
            border: '2px solid #fff',
          }}
          title={out.type}
        />
      ))}
    </div>
  );
}

export default memo(GroupNode);
