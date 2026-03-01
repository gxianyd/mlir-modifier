import { useCallback, useEffect, useState, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  SelectionMode,
  type NodeTypes,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import { Input, Modal } from 'antd';
import '@xyflow/react/dist/style.css';

import OpNode from './OpNode';
import InputNode from './InputNode';
import GroupNode from './GroupNode';
import SelectionPanel from './SelectionPanel';
import { irToFlow, type GroupHandlers } from './irToFlow';
import { layoutGraph } from './layoutGraph';
import { getGroupColor } from './groupUtils';
import type { IRGraph, OperationInfo, NodeGroup, GroupDisplayMode } from '../../types/ir';


interface GraphViewProps {
  /** The full IR graph from the backend (null if no model loaded) */
  graph: IRGraph | null;
  /** Current view path — op IDs from root to current drill-in location */
  viewPath: string[];
  /** Callback when user selects a node (click) or deselects (click pane) */
  onSelectOp: (op: OperationInfo | null) => void;
  /** Callback when user double-clicks a collapsed node to drill into it */
  onDrillIn: (opId: string) => void;
  /** Callback when user requests to delete the selected op (cascade) */
  onDeleteOp?: (opId: string) => void;
  /** Callback when user requests to delete only the selected op (single) */
  onDeleteOpSingle?: (opId: string) => void;
  /** Callback when user connects two handles (add edge) */
  onConnect?: (targetOpId: string, sourceValueId: string, operandIndex: number | null) => void;
  /** Callback when user deletes an edge */
  onDeleteEdge?: (targetOpId: string, operandIndex: number) => void;
  /** Callback when user reconnects an edge to a different source */
  onReconnectEdge?: (targetOpId: string, operandIndex: number, newValueId: string) => void;
  /** Callback when user adds an op result to the function output */
  onAddToOutput?: (opId: string, resultIndex: number) => void;
  /** Set of op names (e.g. "arith.constant") to hide from the graph */
  hiddenOpNames?: Set<string>;
  /** Node groups for collapsing multiple ops into one visual node */
  nodeGroups?: NodeGroup[];
  /** Callback to create a new group from selected op IDs */
  onCreateGroup?: (opIds: string[]) => void;
  /** Callback to dissolve a group */
  onUngroupGroup?: (groupId: string) => void;
  /** Callback to rename a group */
  onRenameGroup?: (groupId: string, newName: string) => void;
  /** Callback to switch a group's display mode */
  onToggleGroupMode?: (groupId: string, mode: GroupDisplayMode) => void;
  /** Currently active drilldown group ID (null = normal view) */
  activeDrillGroupId?: string | null;
  /** Callback to enter group drilldown */
  onGroupDrillIn?: (groupId: string) => void;
}

/**
 * Registry of custom node types.
 */
const nodeTypes: NodeTypes = {
  opNode: OpNode,
  inputNode: InputNode,
  groupNode: GroupNode,
};

/**
 * Parse a handle ID like "out-0" or "in-1" to extract the index.
 */
function parseHandleIndex(handleId: string | null | undefined): number {
  if (!handleId) return 0;
  const parts = handleId.split('-');
  return parseInt(parts[parts.length - 1], 10) || 0;
}

/**
 * Resolve a source node + handle to a value_id.
 * For op nodes, the value comes from the op's results.
 * For input nodes, the value comes from the node's data.
 */
function resolveSourceValueId(
  graph: IRGraph,
  sourceNodeId: string,
  sourceHandle: string | null | undefined,
): string | null {
  // Check if it's an input node (block argument)
  if (sourceNodeId.startsWith('input_')) {
    // Input node ID format: "input_{value_id}"
    return sourceNodeId.replace('input_', '');
  }

  // Op node: look up the result at the handle index
  const op = graph.operations.find((o) => o.op_id === sourceNodeId);
  if (!op) return null;
  const resultIndex = parseHandleIndex(sourceHandle);
  if (resultIndex >= 0 && resultIndex < op.results.length) {
    return op.results[resultIndex].value_id;
  }
  return null;
}

/**
 * Inner component that syncs externally-computed layout into React Flow state
 * and calls fitView after each update. Must be rendered inside <ReactFlow>
 * so that useReactFlow() has access to the ReactFlow context.
 */
function LayoutSyncer({
  layoutedNodes,
  layoutedEdges,
  setNodes,
  setEdges,
}: {
  layoutedNodes: Node[];
  layoutedEdges: Edge[];
  setNodes: (ns: Node[]) => void;
  setEdges: (es: Edge[]) => void;
}) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    requestAnimationFrame(() => fitView({ duration: 300, padding: 0.1 }));
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges, fitView]);
  return null;
}

/**
 * GraphView — the main React Flow canvas.
 *
 * Converts the IR graph to React Flow nodes/edges using the current viewPath,
 * applies hierarchical ELK layout, and renders the interactive graph.
 *
 * Interactions:
 *   - Single-click node → select it (shows properties in panel)
 *   - Ctrl+click → add/remove from multi-selection
 *   - Left-drag on canvas → box select (selectionOnDrag)
 *   - Right-drag on canvas → pan
 *   - Double-click collapsed node → drill in (viewPath changes)
 *   - Click empty area → deselect
 *   - Right-click node → context menu with "Delete"
 *   - Delete/Backspace key → delete selected node or edge
 *   - Drag from handle → connect (add edge)
 *   - Right-click edge → context menu with "Delete"
 *   - Right-click group node → group context menu
 */
export default function GraphView({
  graph,
  viewPath,
  onSelectOp,
  onDrillIn,
  onDeleteOp,
  onDeleteOpSingle,
  onConnect: onConnectProp,
  onDeleteEdge,
  onReconnectEdge,
  onAddToOutput,
  hiddenOpNames,
  nodeGroups,
  onCreateGroup,
  onUngroupGroup,
  onRenameGroup,
  onToggleGroupMode,
  activeDrillGroupId,
  onGroupDrillIn,
}: GraphViewProps) {
  // Async ELK layout: recompute whenever graph, viewPath, hiddenOpNames, or groups change
  const [layoutedNodes, setLayoutedNodes] = useState<Node[]>([]);
  const [layoutedEdges, setLayoutedEdges] = useState<Edge[]>([]);

  // Multi-select: track selected op IDs for the SelectionPanel
  const [selectedOpIds, setSelectedOpIds] = useState<string[]>([]);

  // Build stable group handlers to pass into irToFlow
  const groupHandlers: GroupHandlers = {
    onRename: onRenameGroup ?? (() => {}),
    onUngroup: onUngroupGroup ?? (() => {}),
    onSetMode: onToggleGroupMode ?? (() => {}),
  };

  useEffect(() => {
    if (!graph || viewPath.length === 0) {
      setLayoutedNodes([]);
      setLayoutedEdges([]);
      return;
    }
    let cancelled = false;
    const { nodes: flowNodes, edges: flowEdges } = irToFlow(
      graph, viewPath, 0, hiddenOpNames,
      nodeGroups, activeDrillGroupId, groupHandlers,
    );
    layoutGraph(flowNodes, flowEdges).then((result) => {
      if (!cancelled) {
        setLayoutedNodes(result.nodes);
        setLayoutedEdges(result.edges);
      }
    }).catch((err) => {
      console.error('ELK layout failed:', err);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, viewPath, hiddenOpNames, nodeGroups, activeDrillGroupId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // Track currently selected node/edge for keyboard delete
  const selectedNodeIdRef = useRef<string | null>(null);
  const selectedEdgeRef = useRef<Edge | null>(null);

  // Context menu state — supports node, edge, and group menus
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: 'node' | 'edge' | 'group';
    opId?: string;
    edge?: Edge;
    groupId?: string;
  } | null>(null);

  // Track selected op IDs for multi-select panel
  const handleSelectionChange = useCallback(({ nodes: selectedNodes }: OnSelectionChangeParams) => {
    const opIds = selectedNodes
      .filter((n) => n.type === 'opNode')
      .map((n) => n.id);
    setSelectedOpIds(opIds);
  }, []);

  // Single-click node → select node, deselect edge
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string; type?: string }) => {
      if (!graph) return;
      // Don't propagate to property panel for group/background nodes
      if (node.type === 'groupNode') return;
      const op = graph.operations.find((o) => o.op_id === node.id) || null;
      selectedNodeIdRef.current = node.id;
      selectedEdgeRef.current = null;
      onSelectOp(op);
    },
    [graph, onSelectOp],
  );

  // Single-click edge → select edge, deselect node
  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      selectedEdgeRef.current = edge;
      selectedNodeIdRef.current = null;
    },
    [],
  );

  // Double-click → if the node is collapsed (has hidden regions), drill in
  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: { id: string; data: Record<string, unknown> }) => {
      if (node.data?.collapsed === true) {
        onDrillIn(node.id);
      }
    },
    [onDrillIn],
  );

  // Click empty canvas area → deselect current node and edge
  const onPaneClick = useCallback(() => {
    selectedNodeIdRef.current = null;
    selectedEdgeRef.current = null;
    setContextMenu(null);
    onSelectOp(null);
  }, [onSelectOp]);

  // Right-click node → show context menu (differentiate group vs regular)
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: { id: string; type?: string }) => {
      event.preventDefault();
      if (node.type === 'groupNode') {
        setContextMenu({ x: event.clientX, y: event.clientY, type: 'group', groupId: node.id });
      } else {
        setContextMenu({ x: event.clientX, y: event.clientY, type: 'node', opId: node.id });
      }
    },
    [],
  );

  // Right-click edge → show context menu
  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, type: 'edge', edge });
    },
    [],
  );

  // ── Context menu handlers ──

  const handleContextDeleteNode = useCallback(() => {
    if (contextMenu?.type === 'node' && contextMenu.opId && onDeleteOp) {
      onDeleteOp(contextMenu.opId);
    }
    setContextMenu(null);
  }, [contextMenu, onDeleteOp]);

  const handleContextDeleteNodeSingle = useCallback(() => {
    if (contextMenu?.type === 'node' && contextMenu.opId && onDeleteOpSingle) {
      onDeleteOpSingle(contextMenu.opId);
    }
    setContextMenu(null);
  }, [contextMenu, onDeleteOpSingle]);

  const handleContextAddToOutput = useCallback((resultIndex: number) => {
    if (contextMenu?.type === 'node' && contextMenu.opId && onAddToOutput) {
      onAddToOutput(contextMenu.opId, resultIndex);
    }
    setContextMenu(null);
  }, [contextMenu, onAddToOutput]);

  const handleContextDeleteEdge = useCallback(() => {
    if (contextMenu?.type === 'edge' && contextMenu.edge && onDeleteEdge) {
      const edgeData = contextMenu.edge.data as { toOp: string; toOperandIndex: number } | undefined;
      if (edgeData) {
        onDeleteEdge(edgeData.toOp, edgeData.toOperandIndex);
      }
    }
    setContextMenu(null);
  }, [contextMenu, onDeleteEdge]);

  const handleContextGroupInline = useCallback(() => {
    if (contextMenu?.type === 'group' && contextMenu.groupId) {
      onToggleGroupMode?.(contextMenu.groupId, 'expanded');
    }
    setContextMenu(null);
  }, [contextMenu, onToggleGroupMode]);

  const handleContextGroupDrilldown = useCallback(() => {
    if (contextMenu?.type === 'group' && contextMenu.groupId) {
      onGroupDrillIn?.(contextMenu.groupId);
    }
    setContextMenu(null);
  }, [contextMenu, onGroupDrillIn]);

  const handleContextGroupRename = useCallback(() => {
    const groupId = contextMenu?.groupId;
    setContextMenu(null);
    if (!groupId || !onRenameGroup) return;

    const group = (nodeGroups ?? []).find((g) => g.id === groupId);
    let newName = group?.name ?? '';

    Modal.confirm({
      title: 'Rename Group',
      content: (
        <Input
          defaultValue={newName}
          onChange={(e) => { newName = e.target.value; }}
          onPressEnter={() => Modal.destroyAll()}
          autoFocus
        />
      ),
      onOk: () => {
        const trimmed = newName.trim();
        if (trimmed) onRenameGroup(groupId, trimmed);
      },
    });
  }, [contextMenu, nodeGroups, onRenameGroup]);

  const handleContextGroupUngroup = useCallback(() => {
    if (contextMenu?.type === 'group' && contextMenu.groupId) {
      onUngroupGroup?.(contextMenu.groupId);
      setSelectedOpIds([]);
    }
    setContextMenu(null);
  }, [contextMenu, onUngroupGroup]);

  const handleContextGroupCollapse = useCallback(() => {
    if (contextMenu?.type === 'group' && contextMenu.groupId) {
      onToggleGroupMode?.(contextMenu.groupId, 'collapsed');
    }
    setContextMenu(null);
  }, [contextMenu, onToggleGroupMode]);

  // Handle new connection (drag from source handle to target handle)
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!graph || !onConnectProp) return;
      const { source, sourceHandle, target, targetHandle } = connection;
      if (!source || !target) return;

      const valueId = resolveSourceValueId(graph, source, sourceHandle);
      if (!valueId) return;

      // Check if connecting to the "add" handle
      if (targetHandle === 'in-add') {
        // Add new operand
        onConnectProp(target, valueId, null);
        return;
      }

      const operandIndex = parseHandleIndex(targetHandle);
      const targetOp = graph.operations.find((o) => o.op_id === target);
      if (!targetOp) return;

      if (operandIndex < targetOp.operands.length) {
        // Connecting to an existing operand slot → replace
        onConnectProp(target, valueId, operandIndex);
      } else {
        // Connecting beyond existing slots → add new operand
        onConnectProp(target, valueId, null);
      }
    },
    [graph, onConnectProp],
  );

  // Handle edge reconnection (drag edge endpoint to different source)
  const handleReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (!graph || !onReconnectEdge) return;
      const edgeData = oldEdge.data as { toOp: string; toOperandIndex: number } | undefined;
      if (!edgeData) return;

      const { source, sourceHandle } = newConnection;
      if (!source) return;

      const newValueId = resolveSourceValueId(graph, source, sourceHandle);
      if (!newValueId) return;

      onReconnectEdge(edgeData.toOp, edgeData.toOperandIndex, newValueId);
    },
    [graph, onReconnectEdge],
  );

  // Keyboard: Delete/Backspace → delete selected node or edge
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Prioritize edge deletion if an edge is selected
        if (selectedEdgeRef.current && onDeleteEdge) {
          const edgeData = selectedEdgeRef.current.data as { toOp: string; toOperandIndex: number } | undefined;
          if (edgeData) {
            e.preventDefault();
            onDeleteEdge(edgeData.toOp, edgeData.toOperandIndex);
            selectedEdgeRef.current = null;
            return;
          }
        }
        if (selectedNodeIdRef.current && onDeleteOpSingle) {
          e.preventDefault();
          onDeleteOpSingle(selectedNodeIdRef.current);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onDeleteOpSingle, onDeleteEdge]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  // Empty state — no model loaded yet
  if (!graph) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#999',
        fontSize: 16,
      }}>
        Load an .mlir file to get started
      </div>
    );
  }

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeClick={onEdgeClick}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={onPaneClick}
        onConnect={handleConnect}
        onReconnect={handleReconnect}
        onSelectionChange={handleSelectionChange}
        nodeTypes={nodeTypes}
        edgesReconnectable
        minZoom={0.1}
        maxZoom={2}
        selectionOnDrag
        panOnDrag={[2]}
        multiSelectionKeyCode="Control"
        selectionMode={SelectionMode.Partial}
      >
        <LayoutSyncer
          layoutedNodes={layoutedNodes}
          layoutedEdges={layoutedEdges}
          setNodes={setNodes}
          setEdges={setEdges}
        />
        <Background />
        <Controls />
        <MiniMap />

        {/* Multi-select action panel */}
        {graph && (
          <SelectionPanel
            selectedOpIds={selectedOpIds}
            graph={graph}
            onCreateGroup={(ids) => {
              onCreateGroup?.(ids);
              setSelectedOpIds([]);
            }}
          />
        )}

        {/* Drilldown group breadcrumb */}
        {activeDrillGroupId && (() => {
          const group = (nodeGroups ?? []).find((g) => g.id === activeDrillGroupId);
          return group ? (
            <Panel position="top-center">
              <div style={{
                background: '#fff',
                border: `2px solid ${getGroupColor(group.id)}`,
                borderRadius: 8,
                padding: '4px 14px',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              }}>
                <span
                  style={{ color: '#1890ff', cursor: 'pointer' }}
                  onClick={() => onGroupDrillIn?.('')}
                >
                  ← Back
                </span>
                <span style={{ color: '#999' }}>|</span>
                <span style={{ color: getGroupColor(group.id), fontWeight: 600 }}>
                  Group: {group.name}
                </span>
              </div>
            </Panel>
          ) : null;
        })()}
      </ReactFlow>

      {/* Context menu — node, edge, or group */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 1000,
            padding: '4px 0',
          }}
        >
          {/* Regular op node context menu */}
          {contextMenu.type === 'node' && (() => {
            const op = graph?.operations.find((o) => o.op_id === contextMenu.opId);
            const inlineGroup = (nodeGroups ?? []).find(
              (g) => g.displayMode === 'expanded' && contextMenu.opId && g.opIds.includes(contextMenu.opId),
            );
            return (
              <>
                {/* Collapse inline group shortcut */}
                {inlineGroup && onToggleGroupMode && (
                  <div
                    style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f0f0f0' }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f5f5f5'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                    onClick={() => { onToggleGroupMode(inlineGroup.id, 'collapsed'); setContextMenu(null); }}
                  >
                    Collapse Group: {inlineGroup.name}
                  </div>
                )}
                {onAddToOutput && op && op.results.length > 0 && (
                  op.results.length === 1 ? (
                    <div
                      style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}
                      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f5f5f5'; }}
                      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                      onClick={() => handleContextAddToOutput(0)}
                    >
                      Add to Output
                    </div>
                  ) : (
                    op.results.map((r, i) => (
                      <div
                        key={i}
                        style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}
                        onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f5f5f5'; }}
                        onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                        onClick={() => handleContextAddToOutput(i)}
                      >
                        Add result #{i} ({r.type}) to Output
                      </div>
                    ))
                  )
                )}
                {onDeleteOpSingle && (
                  <div
                    style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f5f5f5'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                    onClick={handleContextDeleteNodeSingle}
                  >
                    Delete Node
                  </div>
                )}
                {onDeleteOp && (
                  <div
                    style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 13, color: '#e74c3c' }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f5f5f5'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                    onClick={handleContextDeleteNode}
                  >
                    Delete Nodes From Here
                  </div>
                )}
              </>
            );
          })()}

          {/* Group node context menu */}
          {contextMenu.type === 'group' && (() => {
            const group = (nodeGroups ?? []).find((g) => g.id === contextMenu.groupId);
            const isCollapsed = !group || group.displayMode === 'collapsed';
            const isInline = group?.displayMode === 'expanded';
            return (
              <>
                <div
                  style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#666', borderBottom: '1px solid #f0f0f0' }}
                >
                  {group?.name ?? 'Group'}
                </div>
                {!isInline && (
                  <div
                    style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f5f5f5'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                    onClick={handleContextGroupInline}
                  >
                    Show Inline
                  </div>
                )}
                {!isCollapsed && (
                  <div
                    style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f5f5f5'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                    onClick={handleContextGroupCollapse}
                  >
                    Collapse
                  </div>
                )}
                <div
                  style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f5f5f5'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                  onClick={handleContextGroupDrilldown}
                >
                  Drill Into
                </div>
                <div
                  style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f5f5f5'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                  onClick={handleContextGroupRename}
                >
                  Rename
                </div>
                <div
                  style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 13, color: '#e74c3c', borderTop: '1px solid #f0f0f0' }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f5f5f5'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                  onClick={handleContextGroupUngroup}
                >
                  Ungroup
                </div>
              </>
            );
          })()}

          {/* Edge context menu */}
          {contextMenu.type === 'edge' && onDeleteEdge && (
            <div
              style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 13, color: '#e74c3c' }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f5f5f5'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
              onClick={handleContextDeleteEdge}
            >
              Delete Edge
            </div>
          )}
        </div>
      )}
    </>
  );
}
