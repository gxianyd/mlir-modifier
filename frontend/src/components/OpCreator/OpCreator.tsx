import { useState, useEffect, useCallback } from 'react';
import { Modal, Select, Input, Button, Space, message, Tag } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import TypePicker from './TypePicker';
import AttributeInput from './AttributeInput';
import {
  listDialects,
  listDialectOps,
  getOpSignature,
  type OpDefinitionInfo,
  type OpSignature,
  type CreateOpRequest,
} from '../../services/api';
import type { IRGraph } from '../../types/ir';

interface OpCreatorProps {
  visible: boolean;
  onClose: () => void;
  onCreateOp: (request: CreateOpRequest) => Promise<void>;
  graph: IRGraph;
  /** Current view path — used to determine default insert block */
  viewPath: string[];
}

export default function OpCreator({ visible, onClose, onCreateOp, graph, viewPath }: OpCreatorProps) {
  // Step 1: Dialect selection
  const [dialects, setDialects] = useState<string[]>([]);
  const [selectedDialect, setSelectedDialect] = useState<string | null>(null);

  // Step 2: Op selection
  const [ops, setOps] = useState<OpDefinitionInfo[]>([]);
  const [selectedOpName, setSelectedOpName] = useState<string>('');

  // Op signature (auto-loaded when op is selected)
  const [signature, setSignature] = useState<OpSignature | null>(null);

  // Step 3: Parameters (driven by signature)
  const [resultTypes, setResultTypes] = useState<string[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [blockId, setBlockId] = useState<string>('');
  const [position, setPosition] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);

  // Load dialects on open
  useEffect(() => {
    if (visible) {
      listDialects().then(setDialects).catch(() => {});
      // Auto-select the first block in the current view
      if (viewPath.length >= 2) {
        const viewRootId = viewPath[viewPath.length - 1];
        const viewRootRegions = graph.regions.filter((r) => r.parent_op === viewRootId);
        if (viewRootRegions.length > 0 && viewRootRegions[0].blocks.length > 0) {
          setBlockId(viewRootRegions[0].blocks[0]);
        }
      }
    }
  }, [visible, graph, viewPath]);

  // Load ops when dialect changes
  useEffect(() => {
    if (selectedDialect) {
      listDialectOps(selectedDialect).then(setOps).catch(() => setOps([]));
    } else {
      setOps([]);
    }
    setSelectedOpName('');
    setSignature(null);
    setParamValues({});
    setResultTypes([]);
  }, [selectedDialect]);

  // Load signature when op is selected
  useEffect(() => {
    if (!selectedOpName) {
      setSignature(null);
      setParamValues({});
      setResultTypes([]);
      return;
    }
    getOpSignature(selectedOpName)
      .then((sig) => {
        setSignature(sig);
        // Initialize param values with empty strings
        const initial: Record<string, string> = {};
        for (const p of sig.params) {
          initial[p.name] = '';
        }
        setParamValues(initial);
        // Initialize result types
        if (sig.num_results > 0) {
          setResultTypes(Array(sig.num_results).fill('f32'));
        } else if (sig.num_results === -1) {
          setResultTypes(['f32']); // variadic: start with 1
        } else {
          setResultTypes([]);
        }
      })
      .catch(() => {
        setSignature(null);
        setParamValues({});
        setResultTypes([]);
      });
  }, [selectedOpName]);

  // Reset form on close
  const handleClose = useCallback(() => {
    setSelectedDialect(null);
    setSelectedOpName('');
    setSignature(null);
    setResultTypes([]);
    setParamValues({});
    setPosition(null);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    if (!selectedOpName || !blockId) {
      message.warning('Please fill in the op name and select a block');
      return;
    }

    // Split params into operands and attributes based on signature
    const operands: string[] = [];
    const attributes: Record<string, string> = {};

    if (signature) {
      for (const p of signature.params) {
        const val = paramValues[p.name]?.trim();
        if (!val) continue;
        if (p.kind === 'operand') {
          operands.push(val);
        } else {
          attributes[p.name] = val;
        }
      }
    }

    const request: CreateOpRequest = {
      op_name: selectedOpName,
      result_types: resultTypes.filter((t) => t.trim() !== ''),
      operands,
      attributes,
      insert_point: { block_id: blockId, position },
    };

    setSubmitting(true);
    try {
      await onCreateOp(request);
      handleClose();
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`Failed to create op: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  }, [selectedOpName, blockId, resultTypes, paramValues, position, signature, onCreateOp, handleClose]);

  // Collect available values for operand selection
  const availableValues = (() => {
    const values: { label: string; value: string }[] = [];
    for (const block of graph.blocks) {
      for (const arg of block.arguments) {
        values.push({ label: `${arg.value_id} : ${arg.type}`, value: arg.value_id });
      }
    }
    for (const op of graph.operations) {
      for (const res of op.results) {
        values.push({ label: `${res.value_id} (${op.name}) : ${res.type}`, value: res.value_id });
      }
    }
    return values;
  })();

  // Collect available blocks
  const availableBlocks = graph.blocks.map((b) => ({
    label: `${b.block_id} (${b.operations.length} ops)`,
    value: b.block_id,
  }));

  // Separate params by kind
  const operandParams = signature?.params.filter((p) => p.kind === 'operand') ?? [];
  const attrParams = signature?.params.filter((p) => p.kind === 'attribute') ?? [];

  return (
    <Modal
      title="Create Operation"
      open={visible}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText="Create"
      width={560}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Dialect selection */}
        <div>
          <label style={labelStyle}>Dialect</label>
          <Select
            showSearch
            value={selectedDialect}
            onChange={setSelectedDialect}
            placeholder="Select dialect..."
            style={{ width: '100%' }}
            options={dialects.map((d) => ({ label: d, value: d }))}
          />
        </div>

        {/* Op selection / manual input */}
        <div>
          <label style={labelStyle}>Operation Name</label>
          {ops.length > 0 ? (
            <Select
              showSearch
              value={selectedOpName || undefined}
              onChange={setSelectedOpName}
              placeholder="Select or type op name..."
              style={{ width: '100%' }}
              options={ops.map((o) => ({ label: o.name, value: o.name }))}
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          ) : (
            <Input
              value={selectedOpName}
              onChange={(e) => setSelectedOpName(e.target.value)}
              placeholder="e.g. arith.addf"
            />
          )}
        </div>

        {/* Signature-driven form */}
        {signature && (
          <>
            {/* Result types — always shown.
                num_results > 0: fixed count, no add/remove.
                num_results === -1: variadic, add/remove, keep ≥1.
                num_results === 0: unknown (no registered Python binding),
                  treat as optional — allow adding result types freely. */}
            <div>
              <label style={labelStyle}>
                Result Types
                {signature.num_results === -1 && (
                  <Tag color="blue" style={{ marginLeft: 8, fontSize: 10 }}>variadic</Tag>
                )}
                {signature.num_results === 0 && (
                  <Tag color="default" style={{ marginLeft: 8, fontSize: 10 }}>optional</Tag>
                )}
              </label>
              {resultTypes.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <TypePicker
                    value={t}
                    onChange={(newType) => {
                      const updated = [...resultTypes];
                      updated[i] = newType;
                      setResultTypes(updated);
                    }}
                  />
                  {(signature.num_results === -1 || signature.num_results === 0) && (
                    <Button
                      size="small"
                      icon={<MinusCircleOutlined />}
                      onClick={() => setResultTypes(resultTypes.filter((_, j) => j !== i))}
                    />
                  )}
                </div>
              ))}
              {(signature.num_results === -1 || signature.num_results === 0) && (
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setResultTypes([...resultTypes, 'f32'])}
                >
                  Add result type
                </Button>
              )}
            </div>

            {/* Operand parameters */}
            {operandParams.length > 0 && (
              <div>
                <label style={labelStyle}>Operands</label>
                {operandParams.map((p) => (
                  <div key={p.name} style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
                      {p.name}
                      {p.required && <span style={{ color: '#f5222d' }}> *</span>}
                    </div>
                    <Select
                      showSearch
                      value={paramValues[p.name] || undefined}
                      onChange={(val) => setParamValues({ ...paramValues, [p.name]: val })}
                      placeholder={`Select value for ${p.name}...`}
                      style={{ width: '100%' }}
                      options={availableValues}
                      filterOption={(input, option) =>
                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                      }
                      size="small"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Attribute parameters */}
            {attrParams.length > 0 && (
              <div>
                <label style={labelStyle}>Attributes</label>
                {attrParams.map((p) => (
                  <div key={p.name} style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
                      {p.name}
                      {p.required && <span style={{ color: '#f5222d' }}> *</span>}
                      {!p.required && <span style={{ color: '#aaa' }}> (optional)</span>}
                    </div>
                    <AttributeInput
                      value={paramValues[p.name] || ''}
                      onChange={(val) => setParamValues({ ...paramValues, [p.name]: val })}
                      placeholder={`Value for ${p.name}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Insert point */}
        <div>
          <label style={labelStyle}>Insert Into Block</label>
          <Select
            value={blockId || undefined}
            onChange={setBlockId}
            placeholder="Select block..."
            style={{ width: '100%' }}
            options={availableBlocks}
          />
        </div>

        <div>
          <label style={labelStyle}>Position</label>
          <Space>
            <Input
              type="number"
              size="small"
              value={position ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setPosition(v === '' ? null : parseInt(v, 10));
              }}
              placeholder="auto (before terminator)"
              style={{ width: 200 }}
            />
          </Space>
        </div>
      </div>
    </Modal>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#666',
  marginBottom: 4,
};
