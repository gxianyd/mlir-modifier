import { useState, useCallback } from 'react';
import { message } from 'antd';
import Toolbar from './components/Toolbar/Toolbar';
import GraphView from './components/Graph/GraphView';
import PropertyPanel from './components/PropertyPanel/PropertyPanel';
import { loadModel, saveModel } from './services/api';
import type { IRGraph, OperationInfo } from './types/ir';

function App() {
  const [graph, setGraph] = useState<IRGraph | null>(null);
  const [selectedOp, setSelectedOp] = useState<OperationInfo | null>(null);

  const handleFileLoad = useCallback(async (file: File) => {
    try {
      const result = await loadModel(file);
      setGraph(result);
      setSelectedOp(null);
      message.success(`Loaded ${file.name}`);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`Failed to load: ${detail}`);
    }
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const text = await saveModel();
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.mlir';
      a.click();
      URL.revokeObjectURL(url);
      message.success('Saved model.mlir');
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`Failed to save: ${detail}`);
    }
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Toolbar
        onFileLoad={handleFileLoad}
        onSave={handleSave}
        hasModel={graph !== null}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <GraphView graph={graph} onSelectOp={setSelectedOp} />
        <PropertyPanel selectedOp={selectedOp} />
      </div>
    </div>
  );
}

export default App;
