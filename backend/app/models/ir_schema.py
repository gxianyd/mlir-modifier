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
