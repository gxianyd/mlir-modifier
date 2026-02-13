import { Upload, Button, Space, Select } from 'antd';
import { UploadOutlined, DownloadOutlined } from '@ant-design/icons';
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
}

export default function Toolbar({
  onFileLoad,
  onSave,
  hasModel,
  functions,
  selectedFuncId,
  onSelectFunction,
}: ToolbarProps) {
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
      </Space>
    </div>
  );
}
