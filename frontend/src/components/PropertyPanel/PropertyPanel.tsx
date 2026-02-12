import type { OperationInfo } from '../../types/ir';

interface PropertyPanelProps {
  selectedOp: OperationInfo | null;
}

export default function PropertyPanel({ selectedOp }: PropertyPanelProps) {
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
            <div key={i} style={{ padding: '2px 0', color: '#555' }}>
              <span style={{ color: '#888' }}>%{i}: </span>{op.type}
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

      {attrEntries.length > 0 && (
        <Section title="Attributes">
          {attrEntries.map(([name, attr]) => (
            <div key={name} style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '2px 0',
              gap: 8,
            }}>
              <span style={{ color: '#888' }}>{name}</span>
              <span style={{
                color: '#333',
                maxWidth: 150,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textAlign: 'right',
              }}>
                {attr.value}
              </span>
            </div>
          ))}
        </Section>
      )}

      {selectedOp.regions.length > 0 && (
        <Section title="Regions">
          <div style={{ color: '#555' }}>{selectedOp.regions.length} region(s)</div>
        </Section>
      )}
    </div>
  );
}

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
