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
