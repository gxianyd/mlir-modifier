import { useState, useCallback } from 'react';
import { Input, Button, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { OperationInfo } from '../../types/ir';

interface PropertyPanelProps {
  selectedOp: OperationInfo | null;
  onAttributeEdit?: (
    opId: string,
    updates: Record<string, string>,
    deletes: string[],
  ) => Promise<void>;
  onRemoveOperand?: (opId: string, operandIndex: number) => void;
}

export default function PropertyPanel({ selectedOp, onAttributeEdit, onRemoveOperand }: PropertyPanelProps) {
  if (!selectedOp) {
    return (
      <div style={{
        width: 280,
        borderLeft: '1px solid #e8e8e8',
        padding: 16,
        color: '#999',
        fontSize: 13,
        background: '#fafafa',
      }}>
        Select a node to view properties
      </div>
    );
  }

  const attrEntries = Object.entries(selectedOp.attributes);

  return (
    <div style={{
      width: 280,
      borderLeft: '1px solid #e8e8e8',
      padding: 16,
      background: '#fafafa',
      fontSize: 13,
      overflowY: 'auto',
    }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>{selectedOp.name}</h3>

      <Section title="Dialect">
        <div style={{ color: '#555' }}>{selectedOp.dialect || 'builtin'}</div>
      </Section>

      <Section title="Inputs">
        {selectedOp.operands.length === 0 ? (
          <div style={{ color: '#aaa' }}>None</div>
        ) : (
          selectedOp.operands.map((op, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0', color: '#555' }}>
              <span><span style={{ color: '#888' }}>%{i}: </span>{op.type}</span>
              {onRemoveOperand && (
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => onRemoveOperand(selectedOp.op_id, i)}
                  style={{ flexShrink: 0, color: '#ccc', padding: '0 2px' }}
                />
              )}
            </div>
          ))
        )}
      </Section>

      <Section title="Outputs">
        {selectedOp.results.length === 0 ? (
          <div style={{ color: '#aaa' }}>None</div>
        ) : (
          selectedOp.results.map((r, i) => (
            <div key={i} style={{ padding: '2px 0', color: '#555' }}>
              <span style={{ color: '#888' }}>%{i}: </span>{r.type}
            </div>
          ))
        )}
      </Section>

      <Section title="Attributes">
        {attrEntries.length === 0 ? (
          <div style={{ color: '#aaa' }}>None</div>
        ) : (
          attrEntries.map(([name, attr]) => (
            <EditableAttrRow
              key={name}
              opId={selectedOp.op_id}
              name={name}
              value={attr.value}
              onEdit={onAttributeEdit}
            />
          ))
        )}
      </Section>

      {selectedOp.regions.length > 0 && (
        <Section title="Regions">
          <div style={{ color: '#555' }}>{selectedOp.regions.length} region(s)</div>
        </Section>
      )}
    </div>
  );
}

// ── Editable attribute row ──

interface EditableAttrRowProps {
  opId: string;
  name: string;
  value: string;
  onEdit?: (
    opId: string,
    updates: Record<string, string>,
    deletes: string[],
  ) => Promise<void>;
}

function EditableAttrRow({ opId, name, value, onEdit }: EditableAttrRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!onEdit || draft === value) {
      setEditing(false);
      setError(null);
      return;
    }
    try {
      await onEdit(opId, { [name]: draft }, []);
      setEditing(false);
      setError(null);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(detail);
    }
  }, [onEdit, opId, name, draft, value]);

  const handleDelete = useCallback(async () => {
    if (!onEdit) return;
    try {
      await onEdit(opId, {}, [name]);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`Failed to delete attribute: ${detail}`);
    }
  }, [onEdit, opId, name]);

  if (editing) {
    return (
      <div style={{ padding: '2px 0' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ color: '#888', flexShrink: 0 }}>{name}</span>
          <Input
            size="small"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            onPressEnter={handleSubmit}
            onBlur={handleSubmit}
            autoFocus
            style={{ fontSize: 12 }}
          />
        </div>
        {error && (
          <div style={{ color: '#e74c3c', fontSize: 11, marginTop: 2 }}>{error}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '2px 0',
      gap: 4,
    }}>
      <span style={{ color: '#888', flexShrink: 0 }}>{name}</span>
      <span
        style={{
          color: '#333',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'right',
          cursor: onEdit ? 'pointer' : 'default',
        }}
        title={`Click to edit: ${value}`}
        onClick={() => { if (onEdit) { setDraft(value); setEditing(true); } }}
      >
        {value}
      </span>
      {onEdit && (
        <Button
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          onClick={handleDelete}
          style={{ flexShrink: 0, color: '#ccc', padding: '0 2px' }}
        />
      )}
    </div>
  );
}

// ── Section helper ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: '#aaa',
        textTransform: 'uppercase',
        marginBottom: 4,
        letterSpacing: 0.5,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}
