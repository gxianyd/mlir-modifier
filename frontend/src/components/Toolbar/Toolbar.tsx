import { useState } from 'react';
import { Upload, Button, Space, Select, Popover, Checkbox, Badge } from 'antd';
import { UploadOutlined, DownloadOutlined, PlusOutlined, UndoOutlined, RedoOutlined, FilterOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';

/** A top-level function entry for the function selector */
interface FunctionOption {
  opId: string;
  label: string;  // e.g. "@add_mul"
}

interface ToolbarProps {
  onFileLoad: (file: File) => void;
  onSave: () => void;
  hasModel: boolean;
  /** List of top-level func.func ops available for viewing */
  functions: FunctionOption[];
  /** Currently selected function's op_id (null if none selected) */
  selectedFuncId: string | null;
  /** Called when user picks a different function from the dropdown */
  onSelectFunction: (funcOpId: string) => void;
  /** Called when user clicks "Add Op" button */
  onAddOp?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** All op names present in the current graph (for the filter checklist) */
  availableOpNames?: string[];
  /** Set of op names currently hidden from the graph */
  hiddenOpNames?: Set<string>;
  /** Called when the user changes the hidden op set */
  onHiddenChange?: (hidden: Set<string>) => void;
}

export default function Toolbar({
  onFileLoad,
  onSave,
  hasModel,
  functions,
  selectedFuncId,
  onSelectFunction,
  onAddOp,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  availableOpNames = [],
  hiddenOpNames = new Set(),
  onHiddenChange,
}: ToolbarProps) {
  const [filterOpen, setFilterOpen] = useState(false);

  const uploadProps: UploadProps = {
    accept: '.mlir',
    showUploadList: false,
    beforeUpload: (file) => {
      onFileLoad(file);
      return false; // prevent auto upload
    },
  };

  return (
    <div style={{
      height: 48,
      padding: '0 16px',
      display: 'flex',
      alignItems: 'center',
      borderBottom: '1px solid #e8e8e8',
      background: '#fff',
    }}>
      <Space>
        <Upload {...uploadProps}>
          <Button icon={<UploadOutlined />}>Load MLIR</Button>
        </Upload>
        <Button
          icon={<DownloadOutlined />}
          onClick={onSave}
          disabled={!hasModel}
        >
          Save
        </Button>
        <Button
          icon={<UndoOutlined />}
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        />
        <Button
          icon={<RedoOutlined />}
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
        />

        {/* Function selector — shown when the model has functions */}
        {functions.length > 0 && (
          <Select
            value={selectedFuncId ?? undefined}
            onChange={onSelectFunction}
            style={{ minWidth: 180 }}
            placeholder="Select function..."
            options={functions.map((f) => ({
              value: f.opId,
              label: f.label,
            }))}
          />
        )}

        {hasModel && (
          <Button
            icon={<PlusOutlined />}
            onClick={onAddOp}
          >
            Add Op
          </Button>
        )}

        {hasModel && (
          <Popover
            open={filterOpen}
            onOpenChange={setFilterOpen}
            trigger="click"
            placement="bottomRight"
            title="Op 类型过滤"
            content={
              <div style={{ minWidth: 200, maxHeight: 320, overflowY: 'auto' }}>
                {availableOpNames.length === 0 ? (
                  <span style={{ color: '#999', fontSize: 12 }}>暂无 Op 类型</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {availableOpNames.map((name) => (
                      <Checkbox
                        key={name}
                        checked={!hiddenOpNames.has(name)}
                        onChange={(e) => {
                          const next = new Set(hiddenOpNames);
                          if (e.target.checked) {
                            next.delete(name);
                          } else {
                            next.add(name);
                          }
                          onHiddenChange?.(next);
                        }}
                      >
                        {name}
                      </Checkbox>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 8, borderTop: '1px solid #f0f0f0', paddingTop: 6, display: 'flex', gap: 12 }}>
                  <span
                    style={{ color: '#1677ff', cursor: 'pointer', fontSize: 12 }}
                    onClick={() => onHiddenChange?.(new Set())}
                  >
                    全选
                  </span>
                  <span
                    style={{ color: '#1677ff', cursor: 'pointer', fontSize: 12 }}
                    onClick={() => onHiddenChange?.(new Set(availableOpNames))}
                  >
                    全不选
                  </span>
                </div>
              </div>
            }
          >
            <Badge count={hiddenOpNames.size} size="small">
              <Button icon={<FilterOutlined />}>Filter</Button>
            </Badge>
          </Popover>
        )}
      </Space>
    </div>
  );
}
