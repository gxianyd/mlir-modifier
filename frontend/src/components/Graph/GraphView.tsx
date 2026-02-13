import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import OpNode from './OpNode';
import { irToFlow } from './irToFlow';
import { layoutGraph } from './layoutGraph';
import type { IRGraph, OperationInfo } from '../../types/ir';

interface GraphViewProps {
  /** The full IR graph from the backend (null if no model loaded) */
  graph: IRGraph | null;
  /** Current view path — op IDs from root to current drill-in location */
  viewPath: string[];
  /** Callback when user selects a node (click) or deselects (click pane) */
  onSelectOp: (op: OperationInfo | null) => void;
  /** Callback when user double-clicks a collapsed node to drill into it */
  onDrillIn: (opId: string) => void;
}

/**
 * Registry of custom node types.
 * All ops are rendered as flat "opNode" cards (Netron-style).
 */
const nodeTypes: NodeTypes = {
  opNode: OpNode,
};

/**
 * GraphView — the main React Flow canvas.
 *
 * Converts the IR graph to React Flow nodes/edges using the current viewPath,
 * applies hierarchical dagre layout, and renders the interactive graph.
 *
 * Interactions:
 *   - Single-click node → select it (shows properties in panel)
 *   - Double-click collapsed node → drill in (viewPath changes)
 *   - Click empty area → deselect
 */
export default function GraphView({ graph, viewPath, onSelectOp, onDrillIn }: GraphViewProps) {
  // Convert IR graph → React Flow nodes/edges, applying nesting and layout
  const { layoutedNodes, layoutedEdges } = useMemo(() => {
    if (!graph || viewPath.length === 0) {
      return { layoutedNodes: [], layoutedEdges: [] };
    }
    const { nodes, edges } = irToFlow(graph, viewPath);
    const result = layoutGraph(nodes, edges);
    return { layoutedNodes: result.nodes, layoutedEdges: result.edges };
  }, [graph, viewPath]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // Sync React Flow state when the computed layout changes
  // (e.g. when viewPath changes after drill-in/out)
  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  // Single-click → select node and show in property panel
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      if (!graph) return;
      const op = graph.operations.find((o) => o.op_id === node.id) || null;
      onSelectOp(op);
    },
    [graph, onSelectOp],
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

  // Click empty canvas area → deselect current node
  const onPaneClick = useCallback(() => {
    onSelectOp(null);
  }, [onSelectOp]);

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
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.1}
      maxZoom={2}
    >
      <Background />
      <Controls />
      <MiniMap />
    </ReactFlow>
  );
}
