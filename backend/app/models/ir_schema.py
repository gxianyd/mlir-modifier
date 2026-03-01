from __future__ import annotations

from pydantic import BaseModel


class ValueInfo(BaseModel):
    value_id: str
    type: str


class AttributeInfo(BaseModel):
    type: str
    value: str


class OperationInfo(BaseModel):
    op_id: str
    name: str
    dialect: str
    attributes: dict[str, AttributeInfo]
    operands: list[ValueInfo]
    results: list[ValueInfo]
    regions: list[str]  # region_ids
    parent_block: str
    position: int


class BlockInfo(BaseModel):
    block_id: str
    arguments: list[ValueInfo]
    parent_region: str
    operations: list[str]  # op_ids in order


class RegionInfo(BaseModel):
    region_id: str
    parent_op: str
    blocks: list[str]  # block_ids in order


class EdgeInfo(BaseModel):
    from_value: str
    to_op: str
    to_operand_index: int


class IRGraph(BaseModel):
    module_id: str
    operations: list[OperationInfo]
    blocks: list[BlockInfo]
    regions: list[RegionInfo]
    edges: list[EdgeInfo]


class HistoryStatus(BaseModel):
    can_undo: bool
    can_redo: bool


class EditResponse(BaseModel):
    graph: IRGraph
    valid: bool
    diagnostics: list[str] = []


class ModifyAttrRequest(BaseModel):
    updates: dict[str, str] = {}   # attr_name -> MLIR attribute syntax string
    deletes: list[str] = []        # attr_names to remove


class InsertPointInfo(BaseModel):
    block_id: str
    position: int | None = None  # None = append at end


class CreateOpRequest(BaseModel):
    op_name: str                        # e.g. "arith.addf"
    result_types: list[str] = []        # MLIR type strings, e.g. ["f32"]
    operands: list[str] = []            # value_ids of existing SSA values
    attributes: dict[str, str] = {}     # attr_name -> MLIR attribute syntax string
    insert_point: InsertPointInfo


class SetOperandRequest(BaseModel):
    new_value_id: str


class AddOperandRequest(BaseModel):
    value_id: str
    position: int | None = None  # None = append at end


class AddToOutputRequest(BaseModel):
    result_index: int = 0  # which result of the op to add as output


class OpDefinitionInfo(BaseModel):
    name: str           # e.g. "arith.addf"
    dialect: str        # e.g. "arith"
    description: str    # summary


class OpParamInfoResponse(BaseModel):
    name: str
    kind: str           # "operand" | "attribute"
    required: bool


class OpSignatureResponse(BaseModel):
    op_name: str
    params: list[OpParamInfoResponse] = []
    num_results: int = 0   # -1 means variadic
    num_regions: int = 0


class SaveResponse(BaseModel):
    mlir_text: str
    valid: bool
    diagnostics: list[str] = []
