import { useState, useEffect } from 'react';
import { Input, Select, Space } from 'antd';
import TypePicker from './TypePicker';

/** Attribute input mode: typed literal or raw MLIR text */
type AttrMode = 'typed' | 'raw';

const MODE_OPTIONS = [
  { label: 'Typed', value: 'typed' as AttrMode },
  { label: 'Raw', value: 'raw' as AttrMode },
];

interface AttributeInputProps {
  /** Current MLIR attribute string (e.g. "1.0 : f32" or "#arith.fastmath<none>") */
  value: string;
  onChange: (attrStr: string) => void;
  placeholder?: string;
}

/**
 * Parses a typed MLIR literal like "1.0 : f32" into value and type parts.
 * Returns null if not a typed literal.
 */
function parseTypedLiteral(s: string): { literal: string; type: string } | null {
  // Match "literal : type" — use last occurrence of " : " to split,
  // so dense<[1.0, 2.0]> : tensor<2xf32> splits correctly.
  const idx = s.lastIndexOf(' : ');
  if (idx < 0) return null;
  let literal = s.slice(0, idx).trim();
  const type = s.slice(idx + 3).trim();
  if (!literal || !type) return null;
  // Unwrap dense<...> so the input field shows just the inner value
  const denseMatch = literal.match(/^dense<(.+)>$/);
  if (denseMatch) literal = denseMatch[1];
  return { literal, type };
}

/** Returns true if the type is a compound type that needs dense<> wrapping */
function isCompoundType(type: string): boolean {
  return /^(tensor|memref|vector)</.test(type.trim());
}

function buildTypedLiteral(literal: string, type: string): string {
  if (!literal.trim()) return '';
  if (!type.trim()) return literal;
  // For tensor/memref/vector types, MLIR requires dense<value> : type
  if (isCompoundType(type) && !literal.trim().startsWith('dense<')) {
    return `dense<${literal.trim()}> : ${type}`;
  }
  return `${literal} : ${type}`;
}

/**
 * Attribute value input that supports two modes:
 * - "Typed": value field + TypePicker → auto-generates "value : type"
 * - "Raw": plain text input for arbitrary MLIR attribute strings
 */
export default function AttributeInput({ value, onChange, placeholder }: AttributeInputProps) {
  const parsed = parseTypedLiteral(value);
  const [mode, setMode] = useState<AttrMode>(parsed ? 'typed' : 'raw');
  const [literal, setLiteral] = useState(parsed?.literal ?? '');
  const [type, setType] = useState(parsed?.type ?? 'f32');

  // Sync state when external value changes
  useEffect(() => {
    const p = parseTypedLiteral(value);
    if (p) {
      setLiteral(p.literal);
      setType(p.type);
    }
  }, [value]);

  const emitTyped = (lit: string, typ: string) => {
    onChange(buildTypedLiteral(lit, typ));
  };

  if (mode === 'raw') {
    return (
      <Space.Compact style={{ width: '100%' }}>
        <Select
          size="small"
          value={mode}
          onChange={(m) => {
            setMode(m);
            if (m === 'typed') emitTyped(literal, type);
          }}
          options={MODE_OPTIONS}
          style={{ width: 72 }}
        />
        <Input
          size="small"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'MLIR attribute string'}
          style={{ flex: 1 }}
        />
      </Space.Compact>
    );
  }

  // Typed mode: literal + TypePicker
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Space.Compact style={{ width: '100%' }}>
        <Select
          size="small"
          value={mode}
          onChange={(m) => {
            setMode(m);
            if (m === 'raw') onChange(buildTypedLiteral(literal, type));
          }}
          options={MODE_OPTIONS}
          style={{ width: 72 }}
        />
        <Input
          size="small"
          value={literal}
          onChange={(e) => {
            setLiteral(e.target.value);
            emitTyped(e.target.value, type);
          }}
          placeholder="value (e.g. 1.0, 42, true)"
          style={{ flex: 1 }}
        />
      </Space.Compact>
      <TypePicker
        value={type}
        onChange={(t) => {
          setType(t);
          emitTyped(literal, t);
        }}
      />
    </div>
  );
}
