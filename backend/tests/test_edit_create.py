import io

import pytest

from tests.conftest import SIMPLE_MLIR


class TestCreateOp:
    def test_create_simple_op(self, ir_manager):
        """Create an op with no operands/results (like a constant)."""
        graph = ir_manager.load(SIMPLE_MLIR)
        original_count = len(graph.operations)

        # Find the func body block
        func_op = next(op for op in graph.operations if op.name == "func.func")
        func_region = next(r for r in graph.regions if r.parent_op == func_op.op_id)
        block_id = func_region.blocks[0]

        new_graph = ir_manager.create_op(
            op_name="arith.constant",
            result_types=["f32"],
            operands=[],
            attributes={"value": "1.0 : f32"},
            block_id=block_id,
            position=0,
        )
        assert len(new_graph.operations) == original_count + 1
        # The new op should exist
        assert any(op.name == "arith.constant" for op in new_graph.operations)

    def test_create_op_with_operands(self, ir_manager):
        """Create an op that consumes existing values."""
        graph = ir_manager.load(SIMPLE_MLIR)

        func_op = next(op for op in graph.operations if op.name == "func.func")
        func_region = next(r for r in graph.regions if r.parent_op == func_op.op_id)
        block_id = func_region.blocks[0]

        # Get block argument value_ids (func args)
        block = next(b for b in graph.blocks if b.block_id == block_id)
        arg0_vid = block.arguments[0].value_id
        arg1_vid = block.arguments[1].value_id

        new_graph = ir_manager.create_op(
            op_name="arith.addf",
            result_types=["f32"],
            operands=[arg0_vid, arg1_vid],
            attributes={},
            block_id=block_id,
            position=0,
        )
        # Should have one more op
        addf_ops = [op for op in new_graph.operations if op.name == "arith.addf"]
        assert len(addf_ops) >= 2  # original + new

    def test_create_op_append(self, ir_manager):
        """Create an op appended at end of block (position=None)."""
        graph = ir_manager.load(SIMPLE_MLIR)
        original_count = len(graph.operations)

        func_op = next(op for op in graph.operations if op.name == "func.func")
        func_region = next(r for r in graph.regions if r.parent_op == func_op.op_id)
        block_id = func_region.blocks[0]

        new_graph = ir_manager.create_op(
            op_name="arith.constant",
            result_types=["i32"],
            operands=[],
            attributes={"value": "42 : i32"},
            block_id=block_id,
            position=None,
        )
        assert len(new_graph.operations) == original_count + 1

    def test_create_op_invalid_type_raises(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        func_op = next(op for op in graph.operations if op.name == "func.func")
        func_region = next(r for r in graph.regions if r.parent_op == func_op.op_id)
        block_id = func_region.blocks[0]

        with pytest.raises(Exception):
            ir_manager.create_op(
                op_name="arith.constant",
                result_types=["not_a_type!!!"],
                operands=[],
                attributes={},
                block_id=block_id,
                position=0,
            )

    def test_create_op_rolls_back_on_error(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        original_count = len(graph.operations)

        func_op = next(op for op in graph.operations if op.name == "func.func")
        func_region = next(r for r in graph.regions if r.parent_op == func_op.op_id)
        block_id = func_region.blocks[0]

        try:
            ir_manager.create_op(
                op_name="arith.constant",
                result_types=["not_a_type!!!"],
                operands=[],
                attributes={},
                block_id=block_id,
                position=0,
            )
        except Exception:
            pass

        # Module should be unchanged
        current = ir_manager.rebuild_graph()
        assert len(current.operations) == original_count

    def test_create_op_unknown_block_raises(self, ir_manager):
        ir_manager.load(SIMPLE_MLIR)
        with pytest.raises(KeyError, match="Unknown block_id"):
            ir_manager.create_op(
                op_name="arith.constant",
                result_types=["f32"],
                operands=[],
                attributes={"value": "0.0 : f32"},
                block_id="nonexistent_block",
                position=0,
            )

    def test_create_op_unknown_operand_raises(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        func_op = next(op for op in graph.operations if op.name == "func.func")
        func_region = next(r for r in graph.regions if r.parent_op == func_op.op_id)
        block_id = func_region.blocks[0]

        with pytest.raises(KeyError, match="Unknown value_id"):
            ir_manager.create_op(
                op_name="arith.addf",
                result_types=["f32"],
                operands=["fake_value_1", "fake_value_2"],
                attributes={},
                block_id=block_id,
                position=0,
            )

    def test_undo_after_create(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        original_count = len(graph.operations)

        func_op = next(op for op in graph.operations if op.name == "func.func")
        func_region = next(r for r in graph.regions if r.parent_op == func_op.op_id)
        block_id = func_region.blocks[0]

        ir_manager.create_op(
            op_name="arith.constant",
            result_types=["f32"],
            operands=[],
            attributes={"value": "0.0 : f32"},
            block_id=block_id,
            position=0,
        )

        restored = ir_manager.undo()
        assert len(restored.operations) == original_count


@pytest.mark.anyio
class TestCreateOpAPI:
    async def test_create_endpoint(self, client):
        content = SIMPLE_MLIR.encode()
        files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
        load_resp = await client.post("/api/model/load", files=files)
        graph = load_resp.json()

        func_op = next(op for op in graph["operations"] if op["name"] == "func.func")
        func_region = next(r for r in graph["regions"] if r["parent_op"] == func_op["op_id"])
        block_id = func_region["blocks"][0]

        resp = await client.post("/api/op/create", json={
            "op_name": "arith.constant",
            "result_types": ["f32"],
            "operands": [],
            "attributes": {"value": "1.0 : f32"},
            "insert_point": {"block_id": block_id, "position": 0},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "graph" in data
        assert "valid" in data

    async def test_dialects_endpoint(self, client):
        resp = await client.get("/api/dialects")
        assert resp.status_code == 200
        dialects = resp.json()
        assert isinstance(dialects, list)
        assert "arith" in dialects

    async def test_dialect_ops_endpoint(self, client):
        resp = await client.get("/api/dialect/arith/ops")
        assert resp.status_code == 200
        ops = resp.json()
        assert len(ops) > 0
        names = [o["name"] for o in ops]
        assert "arith.addf" in names
