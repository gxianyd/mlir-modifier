import io

import pytest

from tests.conftest import SIMPLE_MLIR, MULTI_FUNC_MLIR


class TestDeleteOp:
    def test_delete_leaf_op(self, ir_manager):
        """Delete an op whose results are not used (func.return uses %1, mulf produces %1)."""
        graph = ir_manager.load(SIMPLE_MLIR)
        # func.return is a leaf — its results are not used by anything.
        ret_op = next(op for op in graph.operations if op.name == "func.return")
        new_graph = ir_manager.delete_op(ret_op.op_id)
        # func.return should be gone
        op_names = [op.name for op in new_graph.operations]
        assert "func.return" not in op_names

    def test_delete_reduces_op_count(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        original_count = len(graph.operations)
        ret_op = next(op for op in graph.operations if op.name == "func.return")
        new_graph = ir_manager.delete_op(ret_op.op_id)
        assert len(new_graph.operations) == original_count - 1

    def test_delete_nonexistent_op_raises(self, ir_manager):
        ir_manager.load(SIMPLE_MLIR)
        with pytest.raises(KeyError, match="Unknown op_id"):
            ir_manager.delete_op("nonexistent_id")

    def test_delete_without_module_raises(self, ir_manager):
        with pytest.raises(ValueError, match="No module loaded"):
            ir_manager.delete_op("some_id")

    def test_undo_restores_after_delete(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        original_op_count = len(graph.operations)
        ret_op = next(op for op in graph.operations if op.name == "func.return")

        ir_manager.delete_op(ret_op.op_id)
        restored = ir_manager.undo()
        assert len(restored.operations) == original_op_count
        assert any(op.name == "func.return" for op in restored.operations)

    def test_delete_preserves_other_ops(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        ret_op = next(op for op in graph.operations if op.name == "func.return")
        remaining_names = sorted(
            op.name for op in graph.operations if op.op_id != ret_op.op_id
        )

        new_graph = ir_manager.delete_op(ret_op.op_id)
        new_names = sorted(op.name for op in new_graph.operations)
        assert new_names == remaining_names

    def test_cascade_delete_op_with_uses(self, ir_manager):
        """Deleting an op whose results are used cascade-deletes the users."""
        graph = ir_manager.load(SIMPLE_MLIR)
        # In SIMPLE_MLIR: addf produces %0, mulf uses %0 and produces %1,
        # return uses %1.  Deleting addf should cascade to mulf and return.
        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        new_graph = ir_manager.delete_op(addf_op.op_id)
        op_names = [op.name for op in new_graph.operations]
        assert "arith.addf" not in op_names
        assert "arith.mulf" not in op_names
        assert "func.return" not in op_names
        # Only func.func should remain
        assert "func.func" in op_names

    def test_cascade_delete_middle_op(self, ir_manager):
        """Deleting a middle op cascade-deletes downstream but preserves upstream."""
        graph = ir_manager.load(SIMPLE_MLIR)
        # Delete mulf — should cascade to return, but preserve addf
        mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
        new_graph = ir_manager.delete_op(mulf_op.op_id)
        op_names = [op.name for op in new_graph.operations]
        assert "arith.addf" in op_names
        assert "arith.mulf" not in op_names
        assert "func.return" not in op_names

    def test_cascade_delete_undo_restores_all(self, ir_manager):
        """Undo after cascade delete restores all deleted ops."""
        graph = ir_manager.load(SIMPLE_MLIR)
        original_count = len(graph.operations)
        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        ir_manager.delete_op(addf_op.op_id)
        restored = ir_manager.undo()
        assert len(restored.operations) == original_count

    def test_delete_multiple_ops_sequentially(self, ir_manager):
        graph = ir_manager.load(MULTI_FUNC_MLIR)
        original_count = len(graph.operations)

        # Delete all func.return ops one by one
        for _ in range(2):
            g = ir_manager.rebuild_graph()
            ret = next((op for op in g.operations if op.name == "func.return"), None)
            if ret:
                ir_manager.delete_op(ret.op_id)

        final = ir_manager.rebuild_graph()
        assert len(final.operations) < original_count


@pytest.mark.anyio
class TestDeleteOpAPI:
    async def test_delete_endpoint(self, client):
        content = SIMPLE_MLIR.encode()
        files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
        load_resp = await client.post("/api/model/load", files=files)
        assert load_resp.status_code == 200
        graph = load_resp.json()

        ret_op = next(op for op in graph["operations"] if op["name"] == "func.return")
        resp = await client.delete(f"/api/op/{ret_op['op_id']}")
        assert resp.status_code == 200
        data = resp.json()
        assert "graph" in data
        assert "valid" in data
        assert "diagnostics" in data

    async def test_delete_nonexistent_returns_404(self, client):
        content = SIMPLE_MLIR.encode()
        files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
        await client.post("/api/model/load", files=files)

        resp = await client.delete("/api/op/nonexistent")
        assert resp.status_code == 404
