"""Tests for IRManager — covers pitfalls discovered during development.

Key pitfalls tested:
1. OpView vs Operation: block.operations yields OpView, need .operation for name
2. Attribute iteration: op.attributes is dict-like, keys are strings
3. Wrapper identity instability: MLIR Python binding creates new wrappers each access
4. Value resolution: OpResult vs BlockArgument, using == comparison
5. Nested regions: ops with regions (func.func, scf.if) must be handled recursively
"""

import pytest

from app.services.ir_manager import IRManager
from tests.conftest import (
    SIMPLE_MLIR,
    NESTED_MLIR,
    MULTI_FUNC_MLIR,
    TENSOR_MLIR,
)


class TestBasicParsing:
    """Test basic MLIR parsing and graph construction."""

    def test_load_simple_mlir(self, ir_manager: IRManager):
        graph = ir_manager.load(SIMPLE_MLIR)
        assert graph.module_id is not None
        assert len(graph.operations) > 0

    def test_operations_have_correct_names(self, ir_manager: IRManager):
        """Pitfall: op.name on OpView returns sym_name (StringAttr), not the op type.
        Must use op.operation.name to get the op type string like 'arith.addf'."""
        graph = ir_manager.load(SIMPLE_MLIR)
        op_names = {op.name for op in graph.operations}
        assert "arith.addf" in op_names
        assert "arith.mulf" in op_names
        assert "func.return" in op_names
        assert "func.func" in op_names

    def test_dialect_extracted_correctly(self, ir_manager: IRManager):
        graph = ir_manager.load(SIMPLE_MLIR)
        for op in graph.operations:
            if op.name == "arith.addf":
                assert op.dialect == "arith"
            elif op.name == "func.func":
                assert op.dialect == "func"

    def test_no_duplicate_op_ids(self, ir_manager: IRManager):
        graph = ir_manager.load(SIMPLE_MLIR)
        op_ids = [op.op_id for op in graph.operations]
        assert len(op_ids) == len(set(op_ids))


class TestAttributes:
    """Test attribute parsing — pitfall: attributes is dict-like, not list of NamedAttribute."""

    def test_arith_op_has_fastmath_attr(self, ir_manager: IRManager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf = next(op for op in graph.operations if op.name == "arith.addf")
        assert "fastmath" in addf.attributes
        assert addf.attributes["fastmath"].value == "#arith.fastmath<none>"

    def test_func_has_sym_name_attr(self, ir_manager: IRManager):
        graph = ir_manager.load(SIMPLE_MLIR)
        func = next(op for op in graph.operations if op.name == "func.func")
        assert "sym_name" in func.attributes
        assert "add_mul" in func.attributes["sym_name"].value

    def test_func_has_function_type_attr(self, ir_manager: IRManager):
        graph = ir_manager.load(SIMPLE_MLIR)
        func = next(op for op in graph.operations if op.name == "func.func")
        assert "function_type" in func.attributes
        assert "f32" in func.attributes["function_type"].value

    def test_return_op_has_no_attributes(self, ir_manager: IRManager):
        graph = ir_manager.load(SIMPLE_MLIR)
        ret = next(op for op in graph.operations if op.name == "func.return")
        # func.return may have no user-visible attributes
        # (it shouldn't have fastmath, sym_name, etc.)
        assert "sym_name" not in ret.attributes


class TestValueResolution:
    """Test SSA value resolution — the most error-prone part.

    Pitfalls:
    - MLIR wrapper id() is unstable: each access creates new Python object
    - Must use == (not is) for Operation/Block comparison
    - OpResult.owner returns Operation, BlockArgument.owner returns Block
    """

    def test_block_arguments_as_operands(self, ir_manager: IRManager):
        """Block arguments (func params) should be correctly linked as operands."""
        graph = ir_manager.load(SIMPLE_MLIR)
        addf = next(op for op in graph.operations if op.name == "arith.addf")

        # addf uses %arg0 and %arg1 (block arguments)
        assert len(addf.operands) == 2

        # These operand value_ids should match block argument value_ids
        func_block = next(
            b for b in graph.blocks
            if any(op_id in b.operations for op_id in
                   [o.op_id for o in graph.operations if o.name == "arith.addf"])
        )
        block_arg_ids = {arg.value_id for arg in func_block.arguments}
        for operand in addf.operands:
            assert operand.value_id in block_arg_ids

    def test_op_result_as_operand(self, ir_manager: IRManager):
        """OpResult from one op used as operand in another should share same value_id."""
        graph = ir_manager.load(SIMPLE_MLIR)
        addf = next(op for op in graph.operations if op.name == "arith.addf")
        mulf = next(op for op in graph.operations if op.name == "arith.mulf")

        # addf result should be mulf's first operand
        addf_result_id = addf.results[0].value_id
        mulf_first_operand_id = mulf.operands[0].value_id
        assert addf_result_id == mulf_first_operand_id

    def test_return_uses_last_result(self, ir_manager: IRManager):
        """func.return should use the result of arith.mulf."""
        graph = ir_manager.load(SIMPLE_MLIR)
        mulf = next(op for op in graph.operations if op.name == "arith.mulf")
        ret = next(op for op in graph.operations if op.name == "func.return")

        mulf_result_id = mulf.results[0].value_id
        ret_operand_id = ret.operands[0].value_id
        assert mulf_result_id == ret_operand_id

    def test_no_fallback_values(self, ir_manager: IRManager):
        """All operand values should be resolved (not fallback).
        If resolution fails, value_ids won't match producers — check via edges."""
        graph = ir_manager.load(SIMPLE_MLIR)

        # All edge from_values should exist as some op's result or block's argument
        all_result_ids = set()
        for op in graph.operations:
            for r in op.results:
                all_result_ids.add(r.value_id)
        all_block_arg_ids = set()
        for block in graph.blocks:
            for arg in block.arguments:
                all_block_arg_ids.add(arg.value_id)

        all_producer_ids = all_result_ids | all_block_arg_ids
        for edge in graph.edges:
            assert edge.from_value in all_producer_ids, (
                f"Edge from_value {edge.from_value} not found in any producer "
                f"(op results or block args). This means _resolve_value fell back."
            )


class TestEdges:
    """Test edge construction — data flow graph correctness."""

    def test_edge_count_matches_operands(self, ir_manager: IRManager):
        """Total edges should equal total operands across all ops."""
        graph = ir_manager.load(SIMPLE_MLIR)
        total_operands = sum(len(op.operands) for op in graph.operations)
        assert len(graph.edges) == total_operands

    def test_edge_targets_are_valid_ops(self, ir_manager: IRManager):
        graph = ir_manager.load(SIMPLE_MLIR)
        op_ids = {op.op_id for op in graph.operations}
        for edge in graph.edges:
            assert edge.to_op in op_ids

    def test_edges_form_correct_dag(self, ir_manager: IRManager):
        """In simple.mlir: arg0,arg1 -> addf -> mulf -> return
                           arg2 -> mulf"""
        graph = ir_manager.load(SIMPLE_MLIR)

        addf = next(op for op in graph.operations if op.name == "arith.addf")
        mulf = next(op for op in graph.operations if op.name == "arith.mulf")
        ret = next(op for op in graph.operations if op.name == "func.return")

        # Edges to addf: 2 (from block args)
        addf_edges = [e for e in graph.edges if e.to_op == addf.op_id]
        assert len(addf_edges) == 2

        # Edges to mulf: 2 (from addf result + block arg)
        mulf_edges = [e for e in graph.edges if e.to_op == mulf.op_id]
        assert len(mulf_edges) == 2

        # Edges to return: 1 (from mulf result)
        ret_edges = [e for e in graph.edges if e.to_op == ret.op_id]
        assert len(ret_edges) == 1


class TestNestedRegions:
    """Test ops with nested regions — must recurse correctly."""

    def test_func_has_region(self, ir_manager: IRManager):
        graph = ir_manager.load(SIMPLE_MLIR)
        func = next(op for op in graph.operations if op.name == "func.func")
        assert len(func.regions) == 1

    def test_nested_regions_parsed(self, ir_manager: IRManager):
        """func.func contains a region; region contains a block; block contains ops."""
        graph = ir_manager.load(SIMPLE_MLIR)
        assert len(graph.regions) >= 2  # module region + func region

    def test_region_parent_op_links(self, ir_manager: IRManager):
        graph = ir_manager.load(SIMPLE_MLIR)
        op_ids = {op.op_id for op in graph.operations} | {graph.module_id}
        for region in graph.regions:
            assert region.parent_op in op_ids

    def test_block_parent_region_links(self, ir_manager: IRManager):
        graph = ir_manager.load(SIMPLE_MLIR)
        region_ids = {r.region_id for r in graph.regions}
        for block in graph.blocks:
            assert block.parent_region in region_ids

    def test_op_parent_block_links(self, ir_manager: IRManager):
        graph = ir_manager.load(SIMPLE_MLIR)
        block_ids = {b.block_id for b in graph.blocks}
        for op in graph.operations:
            assert op.parent_block in block_ids


class TestMultiFunction:
    """Test MLIR with multiple functions."""

    def test_two_functions_parsed(self, ir_manager: IRManager):
        graph = ir_manager.load(MULTI_FUNC_MLIR)
        func_ops = [op for op in graph.operations if op.name == "func.func"]
        assert len(func_ops) == 2

    def test_separate_block_args_per_function(self, ir_manager: IRManager):
        """Each function has its own block with its own arguments."""
        graph = ir_manager.load(MULTI_FUNC_MLIR)
        func_ops = [op for op in graph.operations if op.name == "func.func"]

        for func_op in func_ops:
            region = next(r for r in graph.regions if r.region_id == func_op.regions[0])
            block = next(b for b in graph.blocks if b.block_id == region.blocks[0])
            sym_name = func_op.attributes["sym_name"].value
            if "foo" in sym_name:
                assert len(block.arguments) == 1
            elif "bar" in sym_name:
                assert len(block.arguments) == 2

    def test_value_ids_unique_across_functions(self, ir_manager: IRManager):
        """Value IDs should not collide between different functions."""
        graph = ir_manager.load(MULTI_FUNC_MLIR)
        all_val_ids = []
        for op in graph.operations:
            all_val_ids.extend(r.value_id for r in op.results)
        for block in graph.blocks:
            all_val_ids.extend(a.value_id for a in block.arguments)
        assert len(all_val_ids) == len(set(all_val_ids))


class TestTensorTypes:
    """Test handling of tensor types in operands/results."""

    def test_tensor_type_preserved(self, ir_manager: IRManager):
        graph = ir_manager.load(TENSOR_MLIR)
        addf = next(op for op in graph.operations if op.name == "arith.addf")
        assert "tensor<2x3xf32>" in addf.results[0].type
        assert "tensor<2x3xf32>" in addf.operands[0].type


class TestModuleSerialization:
    """Test round-trip: parse -> serialize -> parse again."""

    def test_get_module_text(self, ir_manager: IRManager):
        ir_manager.load(SIMPLE_MLIR)
        text = ir_manager.get_module_text()
        assert "arith.addf" in text
        assert "arith.mulf" in text

    def test_round_trip(self, ir_manager: IRManager):
        """Parse, serialize, re-parse should produce equivalent graph."""
        graph1 = ir_manager.load(SIMPLE_MLIR)
        text = ir_manager.get_module_text()
        graph2 = ir_manager.load(text)

        # Same number of operations, blocks, regions, edges
        assert len(graph1.operations) == len(graph2.operations)
        assert len(graph1.blocks) == len(graph2.blocks)
        assert len(graph1.regions) == len(graph2.regions)
        assert len(graph1.edges) == len(graph2.edges)

        # Same op names
        names1 = sorted(op.name for op in graph1.operations)
        names2 = sorted(op.name for op in graph2.operations)
        assert names1 == names2

    def test_no_module_raises(self, ir_manager: IRManager):
        with pytest.raises(ValueError, match="No module loaded"):
            ir_manager.get_module_text()


class TestRebuildGraph:
    """Test rebuilding graph from existing module."""

    def test_rebuild_produces_consistent_structure(self, ir_manager: IRManager):
        graph1 = ir_manager.load(SIMPLE_MLIR)
        graph2 = ir_manager.rebuild_graph()

        assert len(graph1.operations) == len(graph2.operations)
        assert len(graph1.edges) == len(graph2.edges)

        names1 = sorted(op.name for op in graph1.operations)
        names2 = sorted(op.name for op in graph2.operations)
        assert names1 == names2


class TestErrorHandling:
    """Test error cases."""

    def test_invalid_mlir_raises(self, ir_manager: IRManager):
        with pytest.raises(Exception):
            ir_manager.load("this is not valid MLIR")

    def test_empty_module(self, ir_manager: IRManager):
        graph = ir_manager.load("module {}")
        # Should have module_id but no child operations
        assert graph.module_id is not None
        assert len(graph.operations) == 0
