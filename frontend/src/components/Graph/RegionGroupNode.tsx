import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';

/**
 * Data shape for the RegionGroupNode.
 *
 * This node type represents an MLIR op that has been expanded to show its
 * internal regions as a container. Child op nodes are nested inside via
 * React Flow's `parentId` mechanism.
 */
export interface RegionGroupData {
  /** Full op name, e.g. "func.func" or "scf.for" */
  label: string;
  /** Dialect name for color theming, e.g. "func", "scf" */
  dialect: string;
  /** The op_id — used for drill-in and property panel lookup */
  opId: string;
  /** Required by React Flow's generic node data constraint */
  [key: string]: unknown;
}

export type RegionGroupNodeType = Node<RegionGroupData, 'regionGroup'>;

/**
 * Dialect color mapping — same palette as OpNode.
 * Shared here so group borders match their dialect theme.
 */
const DIALECT_COLORS: Record<string, { border: string; label: string }> = {
  arith:  { border: '#4a7fb5', label: '#4a7fb5' },
  func:   { border: '#6b8e5e', label: '#6b8e5e' },
  scf:    { border: '#9b6b8e', label: '#9b6b8e' },
  linalg: { border: '#b58a4a', label: '#b58a4a' },
  memref: { border: '#5eaaaa', label: '#5eaaaa' },
  tensor: { border: '#aa7a5e', label: '#aa7a5e' },
  tosa:   { border: '#7a5eaa', label: '#7a5eaa' },
};

const DEFAULT_COLOR = { border: '#999', label: '#666' };

function getDialectColor(dialect: string) {
  return DIALECT_COLORS[dialect] || DEFAULT_COLOR;
}

/**
 * RegionGroupNode — a container node that visually wraps child ops.
 *
 * Rendered as a dashed-border rectangle with a small dialect-colored label
 * at the top. React Flow places child nodes (those with `parentId` pointing
 * to this node) inside the container automatically.
 *
 * Visual style:
 *   ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
 *   ╎  func.func @main                   ╎
 *   ╎  ┌─────────┐     ┌─────────┐       ╎
 *   ╎  │ arith.  │────→│ func.   │       ╎
 *   ╎  │ addf    │     │ return  │       ╎
 *   ╎  └─────────┘     └─────────┘       ╎
 *   └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
 */
function RegionGroupNode({ data }: NodeProps<RegionGroupNodeType>) {
  const color = getDialectColor(data.dialect);

  return (
    <div style={{
      // The actual width/height is determined by React Flow based on child nodes.
      // We set min dimensions and padding so children have room.
      minWidth: 250,
      minHeight: 100,
      padding: '32px 16px 16px 16px',  // extra top padding for the label
      border: `2px dashed ${color.border}`,
      borderRadius: 8,
      background: '#f8f9fa',
      position: 'relative',
    }}>
      {/* Dialect-colored label in the top-left corner */}
      <div style={{
        position: 'absolute',
        top: 6,
        left: 10,
        fontSize: 11,
        fontWeight: 600,
        color: color.label,
        letterSpacing: 0.3,
        userSelect: 'none',
      }}>
        {data.label}
      </div>
    </div>
  );
}

export default memo(RegionGroupNode);
