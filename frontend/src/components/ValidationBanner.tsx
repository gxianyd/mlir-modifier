import { Button } from 'antd';
import { WarningOutlined, UndoOutlined } from '@ant-design/icons';

interface ValidationBannerProps {
  valid: boolean;
  diagnostics: string[];
  onUndo?: () => void;
}

export default function ValidationBanner({ valid, diagnostics, onUndo }: ValidationBannerProps) {
  if (valid || diagnostics.length === 0) return null;

  return (
    <div style={{
      padding: '6px 16px',
      background: '#fff2f0',
      borderBottom: '1px solid #ffccc7',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 13,
    }}>
      <WarningOutlined style={{ color: '#e74c3c' }} />
      <span style={{ flex: 1, color: '#a8071a' }}>
        {diagnostics[0]}
        {diagnostics.length > 1 && ` (+${diagnostics.length - 1} more)`}
      </span>
      {onUndo && (
        <Button
          size="small"
          icon={<UndoOutlined />}
          onClick={onUndo}
        >
          Undo
        </Button>
      )}
    </div>
  );
}
