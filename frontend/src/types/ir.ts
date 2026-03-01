export interface ValueInfo {
  value_id: string;
  type: string;
}

export interface AttributeInfo {
  type: string;
  value: string;
}

export interface OperationInfo {
  op_id: string;
  name: string;
  dialect: string;
  attributes: Record<string, AttributeInfo>;
  operands: ValueInfo[];
  results: ValueInfo[];
  regions: string[];
  parent_block: string;
  position: number;
}

export interface BlockInfo {
  block_id: string;
  arguments: ValueInfo[];
  parent_region: string;
  operations: string[];
}

export interface RegionInfo {
  region_id: string;
  parent_op: string;
  blocks: string[];
}

export interface EdgeInfo {
  from_value: string;
  to_op: string;
  to_operand_index: number;
}

export interface IRGraph {
  module_id: string;
  operations: OperationInfo[];
  blocks: BlockInfo[];
  regions: RegionInfo[];
  edges: EdgeInfo[];
}

export interface HistoryStatus {
  can_undo: boolean;
  can_redo: boolean;
}

export interface EditResponse {
  graph: IRGraph;
  valid: boolean;
  diagnostics: string[];
}

export interface SaveResponse {
  mlir_text: string;
  valid: boolean;
  diagnostics: string[];
}

// ── Node Group types ──

export interface GroupInput {
  valueId: string;
  type: string;
  consumerOpIds: string[];
}

export interface GroupOutput {
  valueId: string;
  type: string;
  producerOpId: string;
  resultIndex: number;
}

export type GroupDisplayMode = 'collapsed' | 'expanded' | 'drilldown';

export interface NodeGroup {
  id: string;
  name: string;
  opIds: string[];
  displayMode: GroupDisplayMode;
  inputs: GroupInput[];
  outputs: GroupOutput[];
}
