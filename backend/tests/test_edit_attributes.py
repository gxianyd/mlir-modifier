import pytest

from tests.conftest import SIMPLE_MLIR


class TestModifyAttributes:
    def test_modify_existing_attribute(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        # Find arith.addf — it has a fastmath attr
        addf = next(op for op in graph.operations if op.name == "arith.addf")
        assert "fastmath" in addf.attributes

        new_graph = ir_manager.modify_attributes(
            addf.op_id,
            updates={"fastmath": '#arith.fastmath<fast>'},
            deletes=[],
        )
        updated_addf = next(op for op in new_graph.operations if op.name == "arith.addf")
        assert "fast" in updated_addf.attributes["fastmath"].value

    def test_add_new_attribute(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf = next(op for op in graph.operations if op.name == "arith.addf")

        new_graph = ir_manager.modify_attributes(
            addf.op_id,
            updates={"my_tag": '"hello"'},
            deletes=[],
        )
        updated = next(op for op in new_graph.operations if op.name == "arith.addf")
        assert "my_tag" in updated.attributes

    def test_delete_attribute(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf = next(op for op in graph.operations if op.name == "arith.addf")
        assert "fastmath" in addf.attributes

        new_graph = ir_manager.modify_attributes(
            addf.op_id,
            updates={},
            deletes=["fastmath"],
        )
        updated = next(op for op in new_graph.operations if op.name == "arith.addf")
        assert "fastmath" not in updated.attributes

    def test_invalid_attribute_string_raises(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf = next(op for op in graph.operations if op.name == "arith.addf")

        with pytest.raises(Exception):
            ir_manager.modify_attributes(
                addf.op_id,
                updates={"bad": "not_valid_mlir_attr!!!"},
                deletes=[],
            )

    def test_invalid_attr_rolls_back(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf = next(op for op in graph.operations if op.name == "arith.addf")

        try:
            ir_manager.modify_attributes(
                addf.op_id,
                updates={"bad": "not_valid_mlir_attr!!!"},
                deletes=[],
            )
        except Exception:
            pass

        # Module should be unchanged after rollback
        text = ir_manager.get_module_text()
        assert "arith.addf" in text

    def test_unknown_op_id_raises(self, ir_manager):
        ir_manager.load(SIMPLE_MLIR)
        with pytest.raises(KeyError, match="Unknown op_id"):
            ir_manager.modify_attributes("nonexistent", {"x": "1 : i32"}, [])

    def test_undo_restores_attributes(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf = next(op for op in graph.operations if op.name == "arith.addf")
        original_fastmath = addf.attributes["fastmath"].value

        ir_manager.modify_attributes(
            addf.op_id,
            updates={"fastmath": '#arith.fastmath<fast>'},
            deletes=[],
        )

        restored = ir_manager.undo()
        addf_restored = next(op for op in restored.operations if op.name == "arith.addf")
        assert addf_restored.attributes["fastmath"].value == original_fastmath

    def test_modify_preserves_other_ops(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf = next(op for op in graph.operations if op.name == "arith.addf")
        original_op_names = sorted(op.name for op in graph.operations)

        new_graph = ir_manager.modify_attributes(
            addf.op_id,
            updates={"my_tag": '"test"'},
            deletes=[],
        )
        new_op_names = sorted(op.name for op in new_graph.operations)
        assert new_op_names == original_op_names

    def test_modify_and_delete_in_same_request(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        addf = next(op for op in graph.operations if op.name == "arith.addf")

        new_graph = ir_manager.modify_attributes(
            addf.op_id,
            updates={"my_tag": '"hello"'},
            deletes=["fastmath"],
        )
        updated = next(op for op in new_graph.operations if op.name == "arith.addf")
        assert "my_tag" in updated.attributes
        assert "fastmath" not in updated.attributes

    def test_modify_sym_name(self, ir_manager):
        graph = ir_manager.load(SIMPLE_MLIR)
        func_op = next(op for op in graph.operations if op.name == "func.func")

        new_graph = ir_manager.modify_attributes(
            func_op.op_id,
            updates={"sym_name": '"renamed_func"'},
            deletes=[],
        )
        updated = next(op for op in new_graph.operations if op.name == "func.func")
        assert "renamed_func" in updated.attributes["sym_name"].value


@pytest.mark.anyio
class TestModifyAttributesAPI:
    async def test_modify_attr_endpoint(self, client):
        import io
        content = SIMPLE_MLIR.encode()
        files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
        load_resp = await client.post("/api/model/load", files=files)
        assert load_resp.status_code == 200
        graph = load_resp.json()

        addf = next(op for op in graph["operations"] if op["name"] == "arith.addf")

        resp = await client.patch(
            f"/api/op/{addf['op_id']}/attributes",
            json={"updates": {"my_tag": '"api_test"'}, "deletes": []},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "graph" in data
        assert "valid" in data

    async def test_modify_attr_nonexistent_op(self, client):
        import io
        content = SIMPLE_MLIR.encode()
        files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
        await client.post("/api/model/load", files=files)

        resp = await client.patch(
            "/api/op/nonexistent/attributes",
            json={"updates": {"x": "1 : i32"}, "deletes": []},
        )
        assert resp.status_code == 404
