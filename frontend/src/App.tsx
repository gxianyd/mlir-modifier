import { useState, useCallback, useMemo, useEffect } from 'react';
import { message } from 'antd';
import Toolbar from './components/Toolbar/Toolbar';
import Breadcrumb from './components/Toolbar/Breadcrumb';
import GraphView from './components/Graph/GraphView';
import PropertyPanel from './components/PropertyPanel/PropertyPanel';
import ValidationBanner from './components/ValidationBanner';
import OpCreator from './components/OpCreator/OpCreator';
import { loadModel, saveModel, modifyAttributes, deleteOp, undo as apiUndo, redo as apiRedo, getHistoryStatus, createOp, setOperand, removeOperand, addOperand, addToOutput, type CreateOpRequest } from './services/api';
import useValidation from './hooks/useValidation';
import useKeyboardShortcuts from './hooks/useKeyboardShortcuts';
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
  const [validationStatus, setValidationStatus] = useState<{ valid: boolean; diagnostics: string[] }>({ valid: true, diagnostics: [] });
  const [showOpCreator, setShowOpCreator] = useState(false);
  const [historyStatus, setHistoryStatus] = useState({ canUndo: false, canRedo: false });

  // Real-time validation via WebSocket — merge into local state
  const wsValidation = useValidation();
  useEffect(() => {
    if (wsValidation.connected) {
      setValidationStatus({ valid: wsValidation.valid, diagnostics: wsValidation.diagnostics });
    }
  }, [wsValidation.valid, wsValidation.diagnostics, wsValidation.connected]);

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
      setValidationStatus({ valid: true, diagnostics: [] });

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

  // ── Refresh history status after mutations ──
  const refreshHistory = useCallback(async () => {
    try {
      const status = await getHistoryStatus();
      setHistoryStatus({ canUndo: status.can_undo, canRedo: status.can_redo });
    } catch {
      // Ignore — history status is non-critical
    }
  }, []);

  // ── Helper: apply an EditResponse (graph + validation) ──
  const applyEditResponse = useCallback((resp: { graph: IRGraph; valid: boolean; diagnostics: string[] }) => {
    setGraph(resp.graph);
    setSelectedOp(null);
    setValidationStatus({ valid: resp.valid, diagnostics: resp.diagnostics });
    refreshHistory();
  }, [refreshHistory]);

  // ── Attribute editing ──
  const handleAttributeEdit = useCallback(async (
    opId: string,
    updates: Record<string, string>,
    deletes: string[],
  ) => {
    const resp = await modifyAttributes(opId, updates, deletes);
    applyEditResponse(resp);
  }, [applyEditResponse]);

  // ── Op deletion ──
  const handleDeleteOp = useCallback(async (opId: string) => {
    try {
      const resp = await deleteOp(opId);
      applyEditResponse(resp);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`Failed to delete: ${detail}`);
    }
  }, [applyEditResponse]);

  // ── Undo (used by validation banner quick-action) ──
  const handleUndo = useCallback(async () => {
    try {
      const resp = await apiUndo();
      applyEditResponse(resp);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`Undo failed: ${detail}`);
    }
  }, [applyEditResponse]);

  // ── Redo ──
  const handleRedo = useCallback(async () => {
    try {
      const resp = await apiRedo();
      applyEditResponse(resp);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`Redo failed: ${detail}`);
    }
  }, [applyEditResponse]);

  // ── Op creation ──
  const handleCreateOp = useCallback(async (request: CreateOpRequest) => {
    const resp = await createOp(request);
    applyEditResponse(resp);
  }, [applyEditResponse]);

  // ── Edge editing: connect / delete / reconnect ──
  const handleConnect = useCallback(async (targetOpId: string, sourceValueId: string, operandIndex: number | null) => {
    try {
      let resp;
      if (operandIndex !== null) {
        // Replace existing operand at index
        resp = await setOperand(targetOpId, operandIndex, sourceValueId);
      } else {
        // Add new operand
        resp = await addOperand(targetOpId, sourceValueId);
      }
      applyEditResponse(resp);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`Failed to connect: ${detail}`);
    }
  }, [applyEditResponse]);

  const handleDeleteEdge = useCallback(async (targetOpId: string, operandIndex: number) => {
    try {
      const resp = await removeOperand(targetOpId, operandIndex);
      applyEditResponse(resp);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`Failed to delete edge: ${detail}`);
    }
  }, [applyEditResponse]);

  // ── Add to output: add op result to function return ──
  const handleAddToOutput = useCallback(async (opId: string, resultIndex: number) => {
    try {
      const resp = await addToOutput(opId, resultIndex);
      applyEditResponse(resp);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`Failed to add to output: ${detail}`);
    }
  }, [applyEditResponse]);

  const handleReconnectEdge = useCallback(async (targetOpId: string, operandIndex: number, newValueId: string) => {
    try {
      const resp = await setOperand(targetOpId, operandIndex, newValueId);
      applyEditResponse(resp);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`Failed to reconnect edge: ${detail}`);
    }
  }, [applyEditResponse]);

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

  // ── Keyboard shortcuts ──
  useKeyboardShortcuts({ onUndo: handleUndo, onRedo: handleRedo });

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
        onAddOp={() => setShowOpCreator(true)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={historyStatus.canUndo}
        canRedo={historyStatus.canRedo}
      />
      {/* Breadcrumb bar — only shows when drilled deeper than the function level */}
      <Breadcrumb items={breadcrumbs} onNavigate={handleBreadcrumbNavigate} />
      <ValidationBanner
        valid={validationStatus.valid}
        diagnostics={validationStatus.diagnostics}
        onUndo={handleUndo}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <GraphView
          graph={graph}
          viewPath={viewPath}
          onSelectOp={setSelectedOp}
          onDrillIn={handleDrillIn}
          onDeleteOp={handleDeleteOp}
          onConnect={handleConnect}
          onDeleteEdge={handleDeleteEdge}
          onReconnectEdge={handleReconnectEdge}
          onAddToOutput={handleAddToOutput}
        />
        <PropertyPanel selectedOp={selectedOp} onAttributeEdit={handleAttributeEdit} onRemoveOperand={handleDeleteEdge} />
      </div>
      {graph && (
        <OpCreator
          visible={showOpCreator}
          onClose={() => setShowOpCreator(false)}
          onCreateOp={handleCreateOp}
          graph={graph}
          viewPath={viewPath}
        />
      )}
    </div>
  );
}

export default App;
