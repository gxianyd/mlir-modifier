import { useCallback, useMemo } from 'react';
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
import type { IRGraph } from '../../types/ir';
import type { OperationInfo } from '../../types/ir';

interface GraphViewProps {
  graph: IRGraph | null;
  onSelectOp: (op: OperationInfo | null) => void;
}

const nodeTypes: NodeTypes = {
  opNode: OpNode,
};

export default function GraphView({ graph, onSelectOp }: GraphViewProps) {
  const { layoutedNodes, layoutedEdges } = useMemo(() => {
    if (!graph) return { layoutedNodes: [], layoutedEdges: [] };
    const { nodes, edges } = irToFlow(graph);
    const result = layoutGraph(nodes, edges);
    return { layoutedNodes: result.nodes, layoutedEdges: result.edges };
  }, [graph]);

  const [nodes, , onNodesChange] = useNodesState(layoutedNodes);
  const [edges, , onEdgesChange] = useEdgesState(layoutedEdges);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      if (!graph) return;
      const op = graph.operations.find((o) => o.op_id === node.id) || null;
      onSelectOp(op);
    },
    [graph, onSelectOp],
  );

  const onPaneClick = useCallback(() => {
    onSelectOp(null);
  }, [onSelectOp]);

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
