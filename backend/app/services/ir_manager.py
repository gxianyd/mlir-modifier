from __future__ import annotations

import uuid

import mlir.ir as ir

from app.models.ir_schema import (
    AttributeInfo,
    BlockInfo,
    EdgeInfo,
    IRGraph,
    OperationInfo,
    RegionInfo,
    ValueInfo,
)


class IRManager:
    """Manages an MLIR Module in memory and provides structured access."""

    def __init__(self) -> None:
        self.context: ir.Context | None = None
        self.module: ir.Module | None = None
        # Forward mappings: id -> MLIR object
        self._op_map: dict[str, ir.Operation] = {}
        self._block_map: dict[str, ir.Block] = {}
        self._value_map: dict[str, ir.Value] = {}
        # For resolving operands: stores (op_id, result_index) -> value_id
        self._result_value_ids: dict[tuple[str, int], str] = {}
        # For resolving block args: stores (block_id, arg_index) -> value_id
        self._block_arg_value_ids: dict[tuple[str, int], str] = {}

    def load(self, mlir_text: str) -> IRGraph:
        """Parse MLIR text and return the structured IR graph."""
        self._clear_maps()
        self.context = ir.Context()
        self.context.allow_unregistered_dialects = True
        self.module = ir.Module.parse(mlir_text, self.context)
        return self._build_graph()

    def get_module_text(self) -> str:
        """Serialize the current module back to MLIR text."""
        if self.module is None:
            raise ValueError("No module loaded")
        return str(self.module)

    def get_op(self, op_id: str) -> ir.Operation:
        return self._op_map[op_id]

    def get_block(self, block_id: str) -> ir.Block:
        return self._block_map[block_id]

    def get_value(self, value_id: str) -> ir.Value:
        return self._value_map[value_id]

    def rebuild_graph(self) -> IRGraph:
        """Rebuild the full graph from the current module state."""
        self._clear_maps()
        return self._build_graph()

    # --- Private helpers ---

    def _clear_maps(self) -> None:
        self._op_map.clear()
        self._block_map.clear()
        self._value_map.clear()
        self._result_value_ids.clear()
        self._block_arg_value_ids.clear()

    def _gen_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid.uuid4().hex[:8]}"

    def _register_op(self, op: ir.Operation) -> str:
        oid = self._gen_id("op")
        self._op_map[oid] = op
        return oid

    def _register_block(self, block: ir.Block) -> str:
        bid = self._gen_id("block")
        self._block_map[bid] = block
        return bid

    def _build_graph(self) -> IRGraph:
        operations: list[OperationInfo] = []
        blocks: list[BlockInfo] = []
        regions: list[RegionInfo] = []
        edges: list[EdgeInfo] = []

        module_op = self.module.operation
        module_id = self._register_op(module_op)

        self._walk_op(module_op, module_id, operations, blocks, regions, edges)

        return IRGraph(
            module_id=module_id,
            operations=operations,
            blocks=blocks,
            regions=regions,
            edges=edges,
        )

    def _walk_op(
        self,
        op: ir.Operation,
        op_id: str,
        operations: list[OperationInfo],
        blocks: list[BlockInfo],
        regions: list[RegionInfo],
        edges: list[EdgeInfo],
    ) -> list[str]:
        """Walk an op's regions recursively. Returns list of region_ids."""
        region_ids: list[str] = []

        for region in op.regions:
            region_id = self._gen_id("region")
            region_ids.append(region_id)
            block_ids: list[str] = []

            for block in region.blocks:
                block_id = self._register_block(block)
                block_ids.append(block_id)

                # Register block arguments
                block_args: list[ValueInfo] = []
                for arg_idx, arg in enumerate(block.arguments):
                    val_id = self._gen_id("val")
                    self._value_map[val_id] = arg
                    self._block_arg_value_ids[(block_id, arg_idx)] = val_id
                    block_args.append(
                        ValueInfo(value_id=val_id, type=str(arg.type))
                    )

                child_op_ids: list[str] = []
                for pos, child_op_view in enumerate(block.operations):
                    child_op = child_op_view.operation
                    child_op_id = self._register_op(child_op)
                    child_op_ids.append(child_op_id)

                    # Register results
                    result_infos: list[ValueInfo] = []
                    for res_idx, result in enumerate(child_op.results):
                        val_id = self._gen_id("val")
                        self._value_map[val_id] = result
                        self._result_value_ids[(child_op_id, res_idx)] = val_id
                        result_infos.append(
                            ValueInfo(value_id=val_id, type=str(result.type))
                        )

                    # Resolve operands and build edges
                    operand_infos: list[ValueInfo] = []
                    for idx, operand in enumerate(child_op.operands):
                        val_id = self._resolve_value(operand)
                        operand_infos.append(
                            ValueInfo(value_id=val_id, type=str(operand.type))
                        )
                        edges.append(
                            EdgeInfo(
                                from_value=val_id,
                                to_op=child_op_id,
                                to_operand_index=idx,
                            )
                        )

                    # Build attributes
                    attrs: dict[str, AttributeInfo] = {}
                    for attr_name in child_op.attributes:
                        attr_val = child_op.attributes[attr_name]
                        attrs[attr_name] = AttributeInfo(
                            type=type(attr_val).__name__,
                            value=str(attr_val),
                        )

                    # Determine dialect name
                    op_name = child_op.name
                    dialect = op_name.split(".")[0] if "." in op_name else ""

                    # Recurse into child op's regions
                    child_region_ids = self._walk_op(
                        child_op, child_op_id, operations, blocks, regions, edges
                    )

                    operations.append(OperationInfo(
                        op_id=child_op_id,
                        name=op_name,
                        dialect=dialect,
                        attributes=attrs,
                        operands=operand_infos,
                        results=result_infos,
                        regions=child_region_ids,
                        parent_block=block_id,
                        position=pos,
                    ))

                blocks.append(BlockInfo(
                    block_id=block_id,
                    arguments=block_args,
                    parent_region=region_id,
                    operations=child_op_ids,
                ))

            regions.append(RegionInfo(
                region_id=region_id,
                parent_op=op_id,
                blocks=block_ids,
            ))

        return region_ids

    def _resolve_value(self, value: ir.Value) -> str:
        """Resolve an operand value to its registered value_id.

        Uses == comparison on MLIR objects (which compares underlying C++ pointers).
        """
        if isinstance(value, ir.OpResult):
            owner_op = value.owner
            result_num = value.result_number
            for oid, op in self._op_map.items():
                if op == owner_op:
                    key = (oid, result_num)
                    if key in self._result_value_ids:
                        return self._result_value_ids[key]
        elif isinstance(value, ir.BlockArgument):
            owner_block = value.owner
            arg_num = value.arg_number
            for bid, block in self._block_map.items():
                if block == owner_block:
                    key = (bid, arg_num)
                    if key in self._block_arg_value_ids:
                        return self._block_arg_value_ids[key]

        # Fallback: register as new (shouldn't normally happen)
        vid = self._gen_id("val")
        self._value_map[vid] = value
        return vid
