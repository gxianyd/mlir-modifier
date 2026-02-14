import io

import pytest

from tests.conftest import SIMPLE_MLIR


class TestAddToOutput:
    def test_add_op_result_to_output(self, ir_manager):
        """Adding addf's result to output should add it to return operands."""
        graph = ir_manager.load(SIMPLE_MLIR)
        ret_op = next(op for op in graph.operations if op.name == "func.return")
        original_ret_count = len(ret_op.operands)

        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        new_graph = ir_manager.add_to_output(addf_op.op_id, 0)

        new_ret = next(op for op in new_graph.operations if op.name == "func.return")
        assert len(new_ret.operands) == original_ret_count + 1

    def test_add_to_output_updates_func_type(self, ir_manager):
        """Function type should gain an extra result type."""
        graph = ir_manager.load(SIMPLE_MLIR)
        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        new_graph = ir_manager.add_to_output(addf_op.op_id, 0)

        # Verify module text has updated function signature
        text = ir_manager.get_module_text()
        assert "-> (f32, f32)" in text

    def test_add_to_output_valid_module(self, ir_manager):
        """Module should verify after adding to output."""
        graph = ir_manager.load(SIMPLE_MLIR)
        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        ir_manager.add_to_output(addf_op.op_id, 0)
        valid, diags = ir_manager.validate()
        assert valid, f"Module invalid: {diags}"

    def test_add_to_output_undo(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        ret_op = next(op for op in graph.operations if op.name == "func.return")
        original_count = len(ret_op.operands)

        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        ir_manager.add_to_output(addf_op.op_id, 0)
        restored = ir_manager.undo()
        restored_ret = next(op for op in restored.operations if op.name == "func.return")
        assert len(restored_ret.operands) == original_count

    def test_add_to_output_invalid_result_index(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        with pytest.raises(IndexError, match="out of range"):
            ir_manager.add_to_output(addf_op.op_id, 99)

    def test_add_to_output_no_module(self, ir_manager):
        with pytest.raises(ValueError, match="No module loaded"):
            ir_manager.add_to_output("op_0", 0)


class TestRemoveReturnOperand:
    def test_remove_return_operand_updates_func_type(self, ir_manager):
        """Removing a return operand should also update the function type."""
        graph = ir_manager.load(SIMPLE_MLIR)
        # First add an extra output to have 2 return values
        addf_op = next(op for op in graph.operations if op.name == "arith.addf")
        graph2 = ir_manager.add_to_output(addf_op.op_id, 0)

        text_before = ir_manager.get_module_text()
        assert "-> (f32, f32)" in text_before

        # Now remove the first return operand
        ret_op = next(op for op in graph2.operations if op.name == "func.return")
        ir_manager.remove_operand(ret_op.op_id, 0)

        text_after = ir_manager.get_module_text()
        # Should be back to single return type
        assert "-> f32" in text_after

        valid, diags = ir_manager.validate()
        assert valid, f"Module invalid: {diags}"


@pytest.mark.anyio
class TestAddToOutputAPI:
    async def test_add_to_output_endpoint(self, client):
        content = SIMPLE_MLIR.encode()
        files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
        load_resp = await client.post("/api/model/load", files=files)
        assert load_resp.status_code == 200
        graph = load_resp.json()

        addf_op = next(op for op in graph["operations"] if op["name"] == "arith.addf")
        resp = await client.post(
            f"/api/op/{addf_op['op_id']}/add-to-output",
            json={"result_index": 0},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "graph" in data
        assert data["valid"] is True

    async def test_add_to_output_invalid_op(self, client):
        content = SIMPLE_MLIR.encode()
        files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
        await client.post("/api/model/load", files=files)

        resp = await client.post(
            "/api/op/nonexistent/add-to-output",
            json={"result_index": 0},
        )
        assert resp.status_code == 404
