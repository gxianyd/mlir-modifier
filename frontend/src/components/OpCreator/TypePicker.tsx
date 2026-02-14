import { useState, useEffect } from 'react';
import { Select, Input, Space } from 'antd';

const SCALAR_TYPES = [
  { label: 'i1', value: 'i1' },
  { label: 'i8', value: 'i8' },
  { label: 'i16', value: 'i16' },
  { label: 'i32', value: 'i32' },
  { label: 'i64', value: 'i64' },
  { label: 'f16', value: 'f16' },
  { label: 'bf16', value: 'bf16' },
  { label: 'f32', value: 'f32' },
  { label: 'f64', value: 'f64' },
  { label: 'index', value: 'index' },
];

type TypeCategory = 'scalar' | 'tensor' | 'memref' | 'vector';

const CATEGORY_OPTIONS = [
  { label: 'Scalar', value: 'scalar' as TypeCategory },
  { label: 'Tensor', value: 'tensor' as TypeCategory },
  { label: 'Memref', value: 'memref' as TypeCategory },
  { label: 'Vector', value: 'vector' as TypeCategory },
];

interface TypePickerProps {
  value: string;
  onChange: (type: string) => void;
}

/**
 * Parses a type string into category, element type, and shape.
 * E.g. "tensor<2x3xf32>" → { category: "tensor", element: "f32", shape: "2x3" }
 */
function parseTypeString(s: string): { category: TypeCategory; element: string; shape: string } {
  const match = s.match(/^(tensor|memref|vector)<(.+)x([a-z]\w*)>$/);
  if (match) {
    return { category: match[1] as TypeCategory, element: match[3], shape: match[2] };
  }
  return { category: 'scalar', element: s || 'f32', shape: '' };
}

function buildTypeString(category: TypeCategory, element: string, shape: string): string {
  if (category === 'scalar') return element;
  if (!shape.trim()) return element; // fallback if no shape given
  return `${category}<${shape}x${element}>`;
}

export default function TypePicker({ value, onChange }: TypePickerProps) {
  const parsed = parseTypeString(value);
  const [category, setCategory] = useState<TypeCategory>(parsed.category);
  const [element, setElement] = useState(parsed.element);
  const [shape, setShape] = useState(parsed.shape);

  // Sync state when external value changes
  useEffect(() => {
    const p = parseTypeString(value);
    setCategory(p.category);
    setElement(p.element);
    setShape(p.shape);
  }, [value]);

  const emit = (cat: TypeCategory, el: string, sh: string) => {
    onChange(buildTypeString(cat, el, sh));
  };

  return (
    <Space.Compact style={{ width: '100%' }}>
      <Select
        size="small"
        value={category}
        onChange={(cat) => {
          setCategory(cat);
          emit(cat, element, shape);
        }}
        options={CATEGORY_OPTIONS}
        style={{ width: 100 }}
      />
      {category !== 'scalar' && (
        <Input
          size="small"
          value={shape}
          onChange={(e) => {
            setShape(e.target.value);
            emit(category, element, e.target.value);
          }}
          placeholder="2x3x4"
          style={{ width: 90 }}
        />
      )}
      <Select
        size="small"
        showSearch
        value={element}
        onChange={(el) => {
          setElement(el);
          emit(category, el, shape);
        }}
        options={SCALAR_TYPES}
        style={{ flex: 1, minWidth: 70 }}
      />
    </Space.Compact>
  );
}
