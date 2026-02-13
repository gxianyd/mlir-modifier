import { useState, useCallback, useMemo } from 'react';
import { message } from 'antd';
import Toolbar from './components/Toolbar/Toolbar';
import Breadcrumb from './components/Toolbar/Breadcrumb';
import GraphView from './components/Graph/GraphView';
import PropertyPanel from './components/PropertyPanel/PropertyPanel';
import { loadModel, saveModel } from './services/api';
import type { IRGraph, OperationInfo } from './types/ir';

/**
 * Extract all top-level func.func operations from the graph.
 * These are ops with name "func.func" that sit directly in the module's region.
 */
function getTopLevelFunctions(graph: IRGraph): OperationInfo[] {
  // Find the module's region → blocks → operations
  const moduleRegions = graph.regions.filter((r) => r.parent_op === graph.module_id);
  const moduleBlockIds = new Set(moduleRegions.flatMap((r) => r.blocks));
  return graph.operations.filter(
    (op) => op.name === 'func.func' && moduleBlockIds.has(op.parent_block),
  );
}

/**
 * Get a human-readable label for a func.func op.
 * Uses sym_name attribute if available (e.g. "@add_mul"), otherwise falls back to op_id.
 */
function getFuncLabel(op: OperationInfo): string {
  const symName = op.attributes?.sym_name?.value;
  return symName ? symName.replace(/"/g, '') : op.op_id;
}

function App() {
  const [graph, setGraph] = useState<IRGraph | null>(null);
  const [selectedOp, setSelectedOp] = useState<OperationInfo | null>(null);

  /**
   * viewPath tracks the current drill-in location in the IR tree.
   * After loading, it starts at the function level (skipping module):
   *   ['op_module', 'op_func']           → viewing func.func's body
   *   ['op_module', 'op_func', 'op_for'] → drilled into scf.for inside func
   */
  const [viewPath, setViewPath] = useState<string[]>([]);

  // List of top-level functions available for selection
  const functions = useMemo(() => {
    if (!graph) return [];
    return getTopLevelFunctions(graph);
  }, [graph]);

  // The currently selected function's op_id (last func in viewPath, or null)
  const selectedFuncId = useMemo(() => {
    if (viewPath.length < 2) return null;
    // viewPath[1] is always the function-level op
    return viewPath[1];
  }, [viewPath]);

  // Compute breadcrumb items from viewPath.
  // Skip module (index 0) and function (index 1) — breadcrumbs start from
  // ops deeper than the function level (scf.for, etc).
  const breadcrumbs = useMemo(() => {
    if (!graph || viewPath.length <= 2) return [];
    // Include the function as the first breadcrumb (for "go back to function" nav)
    return viewPath.slice(1).map((opId) => {
      const op = graph.operations.find((o) => o.op_id === opId);
      const symName = op?.attributes?.sym_name?.value;
      const label = op
        ? `${op.name}${symName ? ' ' + symName.replace(/"/g, '') : ''}`
        : opId;
      return { opId, label };
    });
  }, [graph, viewPath]);

  // ── Select a function to view ──
  const handleSelectFunction = useCallback((funcOpId: string) => {
    if (!graph) return;
    setViewPath([graph.module_id, funcOpId]);
    setSelectedOp(null);
  }, [graph]);

  // ── Drill-in: append the target op to viewPath ──
  const handleDrillIn = useCallback((opId: string) => {
    setViewPath((prev) => [...prev, opId]);
    setSelectedOp(null);
  }, []);

  // ── Drill-out via breadcrumb ──
  // Breadcrumb index 0 = function (viewPath[1]), index N = viewPath[N+1]
  const handleBreadcrumbNavigate = useCallback((index: number) => {
    // +1 because breadcrumbs start from viewPath[1], and we want to keep up to that point
    setViewPath((prev) => prev.slice(0, index + 2));
    setSelectedOp(null);
  }, []);

  // ── File load: parse MLIR, detect functions, auto-select if only one ──
  const handleFileLoad = useCallback(async (file: File) => {
    try {
      const result = await loadModel(file);
      setGraph(result);
      setSelectedOp(null);

      const funcs = getTopLevelFunctions(result);
      if (funcs.length === 1) {
        // Single function → auto-drill into it
        setViewPath([result.module_id, funcs[0].op_id]);
      } else {
        // Multiple or zero functions → stay at module level, user picks from selector
        setViewPath([result.module_id]);
      }

      message.success(`Loaded ${file.name}`);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`Failed to load: ${detail}`);
    }
  }, []);

  // ── Save: download current module as .mlir file ──
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

  // Build function options for the toolbar selector
  const functionOptions = useMemo(() => {
    return functions.map((f) => ({
      opId: f.op_id,
      label: getFuncLabel(f),
    }));
  }, [functions]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Toolbar
        onFileLoad={handleFileLoad}
        onSave={handleSave}
        hasModel={graph !== null}
        functions={functionOptions}
        selectedFuncId={selectedFuncId}
        onSelectFunction={handleSelectFunction}
      />
      {/* Breadcrumb bar — only shows when drilled deeper than the function level */}
      <Breadcrumb items={breadcrumbs} onNavigate={handleBreadcrumbNavigate} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <GraphView
          graph={graph}
          viewPath={viewPath}
          onSelectOp={setSelectedOp}
          onDrillIn={handleDrillIn}
        />
        <PropertyPanel selectedOp={selectedOp} />
      </div>
    </div>
  );
}

export default App;
