import { Upload, Button, Space } from 'antd';
import { UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';

interface ToolbarProps {
  onFileLoad: (file: File) => void;
  onSave: () => void;
  hasModel: boolean;
}

export default function Toolbar({ onFileLoad, onSave, hasModel }: ToolbarProps) {
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
      </Space>
    </div>
  );
}
