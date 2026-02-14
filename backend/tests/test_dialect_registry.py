from app.services.dialect_registry import list_dialects, list_ops, get_op_signature


class TestListDialects:
    def test_returns_list(self):
        dialects = list_dialects()
        assert isinstance(dialects, list)

    def test_arith_available(self):
        dialects = list_dialects()
        assert "arith" in dialects

    def test_func_available(self):
        dialects = list_dialects()
        assert "func" in dialects


class TestListOps:
    def test_arith_has_ops(self):
        ops = list_ops("arith")
        assert len(ops) > 0

    def test_arith_addf_exists(self):
        ops = list_ops("arith")
        names = [o.name for o in ops]
        assert "arith.addf" in names

    def test_op_has_dialect_field(self):
        ops = list_ops("arith")
        for op in ops:
            assert op.dialect == "arith"

    def test_nonexistent_dialect_returns_empty(self):
        ops = list_ops("totally_fake_dialect")
        assert ops == []

    def test_ops_sorted_by_name(self):
        ops = list_ops("arith")
        names = [o.name for o in ops]
        assert names == sorted(names)


class TestGetOpSignature:
    def test_addf_has_two_operands(self):
        sig = get_op_signature("arith.addf")
        assert sig is not None
        operands = [p for p in sig.params if p.kind == "operand"]
        assert len(operands) == 2
        assert operands[0].name == "lhs"
        assert operands[1].name == "rhs"

    def test_addf_has_fastmath_attribute(self):
        sig = get_op_signature("arith.addf")
        attrs = [p for p in sig.params if p.kind == "attribute"]
        names = [a.name for a in attrs]
        assert "fastmath" in names

    def test_constant_has_value_attribute(self):
        sig = get_op_signature("arith.constant")
        assert sig is not None
        attrs = [p for p in sig.params if p.kind == "attribute"]
        names = [a.name for a in attrs]
        assert "value" in names

    def test_constant_has_one_result(self):
        sig = get_op_signature("arith.constant")
        assert sig.num_results == 1

    def test_cmpf_predicate_is_attribute(self):
        sig = get_op_signature("arith.cmpf")
        assert sig is not None
        pred = next(p for p in sig.params if p.name == "predicate")
        assert pred.kind == "attribute"

    def test_select_operands_correct(self):
        sig = get_op_signature("arith.select")
        assert sig is not None
        operands = [p for p in sig.params if p.kind == "operand"]
        names = [o.name for o in operands]
        assert "condition" in names
        assert "true_value" in names
        assert "false_value" in names

    def test_return_has_zero_results(self):
        sig = get_op_signature("func.return")
        assert sig is not None
        assert sig.num_results == 0

    def test_nonexistent_op_returns_none(self):
        sig = get_op_signature("fake.nonexistent")
        assert sig is None

    def test_func_has_regions(self):
        sig = get_op_signature("func.func")
        assert sig is not None
        assert sig.num_regions >= 1
