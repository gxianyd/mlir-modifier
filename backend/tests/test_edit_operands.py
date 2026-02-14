import io

import pytest

from tests.conftest import SIMPLE_MLIR, MULTI_FUNC_MLIR


class TestSetOperand:
    def test_set_operand_replaces_connection(self, ir_manager):
        """Replace mulf's first operand (addf result) with arg2 directly."""
        graph = ir_manager.load(SIMPLE_MLIR)
        mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
        # mulf currently takes (addf_result, arg2).
        # Replace first operand with arg2 — so mulf(%arg2, %arg2).
        arg2_value_id = mulf_op.operands[1].value_id  # %arg2
        new_graph = ir_manager.set_operand(mulf_op.op_id, 0, arg2_value_id)
        new_mulf = next(op for op in new_graph.operations if op.name == "arith.mulf")
        assert new_mulf.operands[0].value_id == new_mulf.operands[1].value_id

    def test_set_operand_preserves_op_count(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        original_count = len(graph.operations)
        mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
        arg2_value_id = mulf_op.operands[1].value_id
        new_graph = ir_manager.set_operand(mulf_op.op_id, 0, arg2_value_id)
        assert len(new_graph.operations) == original_count

    def test_set_operand_invalid_index_raises(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
        with pytest.raises(IndexError, match="out of range"):
            ir_manager.set_operand(mulf_op.op_id, 5, mulf_op.operands[0].value_id)

    def test_set_operand_unknown_op_raises(self, ir_manager):
        ir_manager.load(SIMPLE_MLIR)
        with pytest.raises(KeyError, match="Unknown op_id"):
            ir_manager.set_operand("nonexistent", 0, "val_0")

    def test_set_operand_unknown_value_raises(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
        with pytest.raises(KeyError, match="Unknown value_id"):
            ir_manager.set_operand(mulf_op.op_id, 0, "nonexistent_val")

    def test_set_operand_undo(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
        original_operand = mulf_op.operands[0].value_id
        arg2_value_id = mulf_op.operands[1].value_id
        ir_manager.set_operand(mulf_op.op_id, 0, arg2_value_id)
        restored = ir_manager.undo()
        restored_mulf = next(op for op in restored.operations if op.name == "arith.mulf")
        # After undo, the operand should be back to the original
        assert restored_mulf.operands[0].value_id != restored_mulf.operands[1].value_id

    def test_set_operand_no_module_raises(self, ir_manager):
        with pytest.raises(ValueError, match="No module loaded"):
            ir_manager.set_operand("op_0", 0, "val_0")


class TestDominanceReordering:
    def test_set_operand_reorders_for_dominance(self, ir_manager):
        """Disconnect mulf from addf, then connect addf to mulf's result.
        Ops should reorder so mulf (producer) comes before addf (consumer)."""
        graph = ir_manager.load(SIMPLE_MLIR)
        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
        # addf is at position 0, mulf at position 1.
        assert addf_op.position < mulf_op.position

        # Step 1: disconnect mulf from addf by replacing mulf's operand[0]
        # (addf result) with a block argument instead.
        func_op = next(op for op in graph.operations if op.name == "func.func")
        func_region = next(r for r in graph.regions if r.parent_op == func_op.op_id)
        func_block = next(b for b in graph.blocks if b.block_id == func_region.blocks[0])
        arg0_value_id = func_block.arguments[0].value_id
        graph2 = ir_manager.set_operand(mulf_op.op_id, 0, arg0_value_id)

        # Now addf and mulf are independent.
        addf2 = next(op for op in graph2.operations if op.name == "arith.addf")
        mulf2 = next(op for op in graph2.operations if op.name == "arith.mulf")
        mulf_result_id = mulf2.results[0].value_id

        # Step 2: connect addf's operand[0] to mulf's result.
        # mulf is after addf, so dominance requires reordering.
        graph3 = ir_manager.set_operand(addf2.op_id, 0, mulf_result_id)
        addf3 = next(op for op in graph3.operations if op.name == "arith.addf")
        mulf3 = next(op for op in graph3.operations if op.name == "arith.mulf")
        # mulf should now be before addf (producer before consumer)
        assert mulf3.position < addf3.position


class TestRemoveOperand:
    def test_remove_operand_reduces_count(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
        original_operand_count = len(mulf_op.operands)
        new_graph = ir_manager.remove_operand(mulf_op.op_id, 0)
        new_mulf = next(op for op in new_graph.operations if op.name == "arith.mulf")
        assert len(new_mulf.operands) == original_operand_count - 1

    def test_remove_operand_invalid_index_raises(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
        with pytest.raises(IndexError, match="out of range"):
            ir_manager.remove_operand(mulf_op.op_id, 5)

    def test_remove_operand_undo(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
        original_operand_count = len(mulf_op.operands)
        ir_manager.remove_operand(mulf_op.op_id, 0)
        restored = ir_manager.undo()
        restored_mulf = next(op for op in restored.operations if op.name == "arith.mulf")
        assert len(restored_mulf.operands) == original_operand_count

    def test_remove_operand_no_module_raises(self, ir_manager):
        with pytest.raises(ValueError, match="No module loaded"):
            ir_manager.remove_operand("op_0", 0)


class TestAddOperand:
    def test_add_operand_increases_count(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        original_operand_count = len(addf_op.operands)
        # Add arg2 as another operand to addf
        func_op = next(op for op in graph.operations if op.name == "func.func")
        block = next(b for b in graph.blocks if b.block_id == func_op.regions[0]
                     and len(b.arguments) > 0) if False else None
        # Get a block argument value_id — find the func's block args
        func_region = next(r for r in graph.regions if r.parent_op == func_op.op_id)
        func_block = next(b for b in graph.blocks if b.block_id == func_region.blocks[0])
        arg2_value_id = func_block.arguments[2].value_id

        new_graph = ir_manager.add_operand(addf_op.op_id, arg2_value_id)
        new_addf = next(op for op in new_graph.operations if op.name == "arith.addf")
        assert len(new_addf.operands) == original_operand_count + 1

    def test_add_operand_at_position(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        func_op = next(op for op in graph.operations if op.name == "func.func")
        func_region = next(r for r in graph.regions if r.parent_op == func_op.op_id)
        func_block = next(b for b in graph.blocks if b.block_id == func_region.blocks[0])
        arg2_value_id = func_block.arguments[2].value_id

        new_graph = ir_manager.add_operand(addf_op.op_id, arg2_value_id, position=0)
        new_addf = next(op for op in new_graph.operations if op.name == "arith.addf")
        assert len(new_addf.operands) == 3
        # The new operand should be at position 0
        assert new_addf.operands[0].value_id == arg2_value_id

    def test_add_operand_unknown_value_raises(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        with pytest.raises(KeyError, match="Unknown value_id"):
            ir_manager.add_operand(addf_op.op_id, "nonexistent_val")

    def test_add_operand_undo(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        original_operand_count = len(addf_op.operands)
        func_op = next(op for op in graph.operations if op.name == "func.func")
        func_region = next(r for r in graph.regions if r.parent_op == func_op.op_id)
        func_block = next(b for b in graph.blocks if b.block_id == func_region.blocks[0])
        arg2_value_id = func_block.arguments[2].value_id

        ir_manager.add_operand(addf_op.op_id, arg2_value_id)
        restored = ir_manager.undo()
        restored_addf = next(op for op in restored.operations if op.name == "arith.addf")
        assert len(restored_addf.operands) == original_operand_count


@pytest.mark.anyio
class TestOperandAPI:
    async def test_set_operand_endpoint(self, client):
        content = SIMPLE_MLIR.encode()
        files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
        load_resp = await client.post("/api/model/load", files=files)
        assert load_resp.status_code == 200
        graph = load_resp.json()

        mulf_op = next(op for op in graph["operations"] if op["name"] == "arith.mulf")
        arg2_value_id = mulf_op["operands"][1]["value_id"]

        resp = await client.put(
            f"/api/op/{mulf_op['op_id']}/operand/0",
            json={"new_value_id": arg2_value_id},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "graph" in data
        assert "valid" in data

    async def test_remove_operand_endpoint(self, client):
        content = SIMPLE_MLIR.encode()
        files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
        load_resp = await client.post("/api/model/load", files=files)
        assert load_resp.status_code == 200
        graph = load_resp.json()

        mulf_op = next(op for op in graph["operations"] if op["name"] == "arith.mulf")
        resp = await client.delete(f"/api/op/{mulf_op['op_id']}/operand/0")
        assert resp.status_code == 200
        data = resp.json()
        assert "graph" in data

    async def test_add_operand_endpoint(self, client):
        content = SIMPLE_MLIR.encode()
        files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
        load_resp = await client.post("/api/model/load", files=files)
        assert load_resp.status_code == 200
        graph = load_resp.json()

        addf_op = next(op for op in graph["operations"] if op["name"] == "arith.addf")
        func_op = next(op for op in graph["operations"] if op["name"] == "func.func")
        func_region = next(r for r in graph["regions"] if r["parent_op"] == func_op["op_id"])
        func_block = next(b for b in graph["blocks"] if b["block_id"] == func_region["blocks"][0])
        arg2_value_id = func_block["arguments"][2]["value_id"]

        resp = await client.post(
            f"/api/op/{addf_op['op_id']}/operand",
            json={"value_id": arg2_value_id},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "graph" in data

    async def test_set_operand_invalid_index_returns_400(self, client):
        content = SIMPLE_MLIR.encode()
        files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
        load_resp = await client.post("/api/model/load", files=files)
        graph = load_resp.json()

        mulf_op = next(op for op in graph["operations"] if op["name"] == "arith.mulf")
        resp = await client.put(
            f"/api/op/{mulf_op['op_id']}/operand/99",
            json={"new_value_id": mulf_op["operands"][0]["value_id"]},
        )
        assert resp.status_code == 400
