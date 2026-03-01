import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { AttributeInfo, ValueInfo } from '../../types/ir';

export interface OpNodeData {
  label: string;
  dialect: string;
  attributes: Record<string, AttributeInfo>;
  operands: ValueInfo[];
  results: ValueInfo[];
  hasRegions: boolean;
  /**
   * When true, this op has regions that are NOT expanded inline
   * (depth exceeded maxExpandDepth). The user can double-click to
   * drill into the collapsed regions.
   */
  collapsed?: boolean;
  /** Number of regions on this op (shown in the collapsed indicator) */
  regionCount?: number;
  /** When set, overrides the header/border color to indicate group membership (inline mode) */
  groupColor?: string;
  [key: string]: unknown;
}

export type OpNodeType = Node<OpNodeData, 'opNode'>;

const DIALECT_COLORS: Record<string, { header: string; border: string }> = {
  arith: { header: '#4a7fb5', border: '#3a6a9b' },
  func: { header: '#6b8e5e', border: '#5a7d4d' },
  scf: { header: '#9b6b8e', border: '#8a5a7d' },
  linalg: { header: '#b58a4a', border: '#a47939' },
  memref: { header: '#5eaaaa', border: '#4d9999' },
  tensor: { header: '#aa7a5e', border: '#996944' },
  tosa: { header: '#7a5eaa', border: '#694d99' },
};

const DEFAULT_COLOR = { header: '#666', border: '#555' };

function getDialectColor(dialect: string) {
  return DIALECT_COLORS[dialect] || DEFAULT_COLOR;
}

function OpNode({ data }: NodeProps<OpNodeType>) {
  const dialectColor = getDialectColor(data.dialect);
  // When in an inline group, use the group color for the header and border
  const headerColor = data.groupColor ?? dialectColor.header;
  const borderColor = data.groupColor ?? dialectColor.border;
  const attrEntries = Object.entries(data.attributes);

  return (
    <div style={{
      minWidth: 180,
      border: `1px solid ${borderColor}`,
      borderRadius: 6,
      // Lightly tint the body when grouped so the whole node is visually marked
      background: data.groupColor ? `${data.groupColor}12` : '#fff',
      boxShadow: data.collapsed
        ? '0 3px 10px rgba(0,0,0,0.18)'
        : '0 2px 6px rgba(0,0,0,0.1)',
      fontSize: 12,
      overflow: 'hidden',
    }}>

      {/* Input handles */}
      {data.operands.map((_, i) => (
        <Handle
          key={`in-${i}`}
          type="target"
          position={Position.Top}
          id={`in-${i}`}
          style={{
            left: `${((i + 1) / (data.operands.length + 2)) * 100}%`,
            background: headerColor,
            width: 8,
            height: 8,
            border: '2px solid #fff',
          }}
        />
      ))}

      {/* Add new operand handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="in-add"
        style={{
          left: `${((data.operands.length + 1) / (data.operands.length + 2)) * 100}%`,
          background: headerColor,
          opacity: 0.6,
          width: 12,
          height: 12,
          border: '2px dashed #999',
          cursor: 'crosshair',
          zIndex: 10,
        }}
        title="Add new operand"
      />

      {/* Header */}
      <div style={{
        background: headerColor,
        color: '#fff',
        padding: '6px 10px',
        fontWeight: 600,
        textAlign: 'center',
        letterSpacing: 0.3,
      }}>
        {data.label}
      </div>

      {/* Attributes */}
      {attrEntries.length > 0 && (
        <div style={{ padding: '4px 10px 6px' }}>
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
                maxWidth: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {attr.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Regions indicator — collapsed ops show a drill-in hint */}
      {data.hasRegions && (
        <div style={{
          padding: '2px 10px 4px',
          color: data.collapsed ? headerColor : '#aaa',
          fontSize: 11,
          textAlign: 'center',
          borderTop: '1px dashed #eee',
          cursor: data.collapsed ? 'pointer' : 'default',
          fontWeight: data.collapsed ? 500 : 400,
        }}>
          {data.collapsed
            ? `▶ ${data.regionCount ?? 1} region(s) — double-click to expand`
            : '[regions]'}
        </div>
      )}

      {/* Output handles */}
      {data.results.map((_, i) => (
        <Handle
          key={`out-${i}`}
          type="source"
          position={Position.Bottom}
          id={`out-${i}`}
          style={{
            left: `${((i + 1) / (data.results.length + 1)) * 100}%`,
            background: headerColor,
            width: 8,
            height: 8,
            border: '2px solid #fff',
          }}
        />
      ))}
    </div>
  );
}

export default memo(OpNode);
