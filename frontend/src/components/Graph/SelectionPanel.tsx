import { Panel } from '@xyflow/react';
import { Button } from 'antd';
import type { IRGraph } from '../../types/ir';

interface SelectionPanelProps {
  selectedOpIds: string[];
  graph: IRGraph;
  onCreateGroup: (opIds: string[]) => void;
}

/**
 * Floating panel shown inside the ReactFlow canvas when ≥2 op nodes are selected.
 * Displays selected op names and a "创建分组" button.
 */
export default function SelectionPanel({ selectedOpIds, graph, onCreateGroup }: SelectionPanelProps) {
  if (selectedOpIds.length < 2) return null;

  const MAX_DISPLAY = 4;
  const opNames = selectedOpIds.map((id) => {
    const op = graph.operations.find((o) => o.op_id === id);
    return op ? op.name : id;
  });

  const displayNames = opNames.slice(0, MAX_DISPLAY);
  const extra = opNames.length - MAX_DISPLAY;

  return (
    <Panel position="bottom-center">
      <div style={{
        background: '#fff',
        border: '1px solid #d9d9d9',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 13,
        maxWidth: 600,
        marginBottom: 8,
      }}>
        <span style={{ color: '#555', flexShrink: 0 }}>
          Selected <strong>{selectedOpIds.length}</strong> ops:
        </span>
        <span style={{ color: '#333', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayNames.join(', ')}
          {extra > 0 && <span style={{ color: '#999' }}> +{extra} more</span>}
        </span>
        <Button
          type="primary"
          size="small"
          onClick={() => onCreateGroup(selectedOpIds)}
          style={{ flexShrink: 0 }}
        >
          Create Group
        </Button>
      </div>
    </Panel>
  );
}
