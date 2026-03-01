from __future__ import annotations

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
from app.services.history import HistoryManager


class IRManager:
    """Manages an MLIR Module in memory and provides structured access."""

    def __init__(self) -> None:
        self.context: ir.Context | None = None
        self.module: ir.Module | None = None
        self.history = HistoryManager()
        # Forward mappings: id -> MLIR object
        self._op_map: dict[str, ir.Operation] = {}
        self._block_map: dict[str, ir.Block] = {}
        self._value_map: dict[str, ir.Value] = {}
        # For resolving operands: stores (op_id, result_index) -> value_id
        self._result_value_ids: dict[tuple[str, int], str] = {}
        # For resolving block args: stores (block_id, arg_index) -> value_id
        self._block_arg_value_ids: dict[tuple[str, int], str] = {}
        # Sequential counters for deterministic IDs (reset on each rebuild)
        self._id_counters: dict[str, int] = {}

    def load(self, mlir_text: str) -> IRGraph:
        """Parse MLIR text and return the structured IR graph.

        Loads all available dialects to enable proper validation while
        still allowing unregistered dialects for custom operations.
        """

        self._clear_maps()
        self.history.clear()
        self.context = ir.Context()
        # Load all available dialects to enable proper validation
        self.context.load_all_available_dialects()
        # Keep allow_unregistered_dialects enabled for custom dialects
        # but loaded dialects will still be validated
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

    def _snapshot(self) -> None:
        """Save the current module text to the undo history.

        Must be called **before** any mutation so the pre-mutation state can
        be restored.
        """
        if self.module is None:
            raise ValueError("No module loaded")
        self.history.snapshot(str(self.module))

    def _reparse(self, mlir_text: str) -> None:
        """Re-parse *mlir_text* into ``self.module``, reusing the context.

        Clears detached ops first — once we reparse, the old module (and
        any values the detached ops reference) will be destroyed, so the
        detached ops must go first.
        """

        if self.context is None:
            self.context = ir.Context()
            self.context.allow_unregistered_dialects = True
        self.module = ir.Module.parse(mlir_text, self.context)

    def undo(self) -> IRGraph:
        """Undo the last mutation and return the restored graph."""
        if self.module is None:
            raise ValueError("No module loaded")
        previous_text = self.history.undo(str(self.module))
        self._reparse(previous_text)
        return self.rebuild_graph()

    def redo(self) -> IRGraph:
        """Redo the last undone mutation and return the restored graph."""
        if self.module is None:
            raise ValueError("No module loaded")
        next_text = self.history.redo(str(self.module))
        self._reparse(next_text)
        return self.rebuild_graph()

    def modify_attributes(
        self,
        op_id: str,
        updates: dict[str, str],
        deletes: list[str],
    ) -> IRGraph:
        """Modify attributes on *op_id*.  Returns the updated graph.

        *updates* maps attribute names to MLIR syntax strings (parsed via
        ``ir.Attribute.parse``).  *deletes* lists attribute names to remove.

        If parsing any attribute fails, the module is rolled back to the
        pre-mutation snapshot and the error is re-raised.
        """
        if self.module is None:
            raise ValueError("No module loaded")
        if op_id not in self._op_map:
            raise KeyError(f"Unknown op_id: {op_id}")

        self._snapshot()
        op = self._op_map[op_id]

        try:
            for name in deletes:
                if name in op.attributes:
                    del op.attributes[name]
            for name, value_str in updates.items():
                attr = ir.Attribute.parse(value_str, self.context)
                op.attributes[name] = attr
        except Exception:
            # Roll back: re-parse from the snapshot we just pushed.
            rollback_text = self.history.undo(str(self.module))
            self._reparse(rollback_text)
            self.rebuild_graph()
            raise

        return self.rebuild_graph()

    def delete_op(self, op_id: str) -> IRGraph:
        """Delete the operation identified by *op_id* and all its dependents.

        Cascading: any operation that uses a result of the deleted op is
        also deleted (recursively).  Uses ``replace_all_uses_with`` to
        break use-def chains before detaching to prevent C++ assertion
        crashes during garbage collection.
        """
        if self.module is None:
            raise ValueError("No module loaded")
        if op_id not in self._op_map:
            raise KeyError(f"Unknown op_id: {op_id}")

        self._snapshot()
        op = self._op_map[op_id]

        # Collect the op and all transitive dependents (post-order:
        # users come before producers).
        to_delete: list[ir.Operation] = []
        visited: set[int] = set()
        self._collect_dependents(op, to_delete, visited)

        # Erase ops in post-order (users before producers).  When a user
        # op is erased its operand references are destroyed, removing it as
        # a user of the producer's results.  By the time we reach the
        # producer, its results are use-free and erase() succeeds.
        for dep_op in to_delete:
            dep_op.erase()

        return self.rebuild_graph()

    def delete_op_single(self, op_id: str) -> IRGraph:
        """Delete only this op; remove its results from user ops' operand lists.

        Unlike delete_op(), this method does NOT cascade to dependent operations.
        Instead, any operand in a user op that references a result of the deleted
        op is removed (the user op is recreated with fewer operands).
        """
        if self.module is None:
            raise ValueError("No module loaded")
        if op_id not in self._op_map:
            raise KeyError(f"Unknown op_id: {op_id}")

        self._snapshot()
        op = self._op_map[op_id]

        try:
            # Collect per-user-op the operand indices that reference this op's results.
            # A single user op may reference multiple results, so we accumulate all
            # matching indices before recreating.
            # key: id(user_op)  value: [user_op, [indices...]]
            users: dict[int, list] = {}
            for res in op.results:
                for use in list(res.uses):
                    user_op = use.owner
                    key = id(user_op)
                    if key not in users:
                        users[key] = [user_op, []]
                    for i, operand in enumerate(user_op.operands):
                        if operand == res:
                            users[key][1].append(i)

            # Recreate each user op without the affected operands.
            # Remove highest index first to preserve lower index validity.
            for _key, (user_op, indices) in users.items():
                new_operands = list(user_op.operands)
                for i in sorted(set(indices), reverse=True):
                    new_operands.pop(i)
                is_return = user_op.name in ("func.return", "return")
                func_op_for_sync = None
                if is_return:
                    func_op_for_sync, _ = self._find_func_and_return(user_op)
                self._recreate_op_with_operands(user_op, new_operands)
                if is_return and func_op_for_sync is not None:
                    self._sync_func_type(func_op_for_sync)

            # All uses are now gone; safe to erase
            op.erase()
        except Exception:
            rollback_text = self.history.undo(str(self.module))
            self._reparse(rollback_text)
            self.rebuild_graph()
            raise

        return self.rebuild_graph()

    def _collect_dependents(
        self,
        op: ir.Operation,
        result: list[ir.Operation],
        visited: set[int],
    ) -> None:
        """Collect *op* and all ops that transitively use its results (post-order)."""
        op_ptr = id(op)
        if op_ptr in visited:
            return
        visited.add(op_ptr)

        for res in op.results:
            for use in list(res.uses):
                user_op = use.owner
                self._collect_dependents(user_op, result, visited)

        result.append(op)

    def create_op(
        self,
        op_name: str,
        result_types: list[str],
        operands: list[str],
        attributes: dict[str, str],
        block_id: str,
        position: int | None,
    ) -> IRGraph:
        """Create a new operation and insert it into the given block.

        *result_types*: MLIR type strings (e.g. ``["f32"]``).
        *operands*: value_ids of existing SSA values.
        *attributes*: attr_name -> MLIR attribute syntax string.
        *block_id*: target block.
        *position*: insertion index within the block (None = append).

        On failure the module is rolled back to the pre-mutation snapshot.
        """
        if self.module is None:
            raise ValueError("No module loaded")
        if block_id not in self._block_map:
            raise KeyError(f"Unknown block_id: {block_id}")

        self._snapshot()

        try:
            # Parse result types
            parsed_types = [ir.Type.parse(t, self.context) for t in result_types]

            # Resolve operand values
            parsed_operands = []
            for vid in operands:
                if vid not in self._value_map:
                    raise KeyError(f"Unknown value_id: {vid}")
                parsed_operands.append(self._value_map[vid])

            # Parse attributes
            parsed_attrs = {}
            for name, val_str in attributes.items():
                parsed_attrs[name] = ir.Attribute.parse(val_str, self.context)

            # Determine insertion point
            block = self._block_map[block_id]

            ops_list = list(block.operations)
            if position is not None and position < len(ops_list):
                # Insert before the op at the given position
                ref_op = ops_list[position].operation
                ip = ir.InsertionPoint(ref_op)
            elif ops_list:
                # Block has ops; insert before the last (terminator) to avoid
                # "cannot insert after terminator" error.
                ip = ir.InsertionPoint.at_block_terminator(block)
            else:
                # Empty block — just append
                ip = ir.InsertionPoint(block)

            loc = ir.Location.unknown(self.context)
            ir.Operation.create(
                op_name,
                results=parsed_types,
                operands=parsed_operands,
                attributes=parsed_attrs,
                ip=ip,
                loc=loc,
            )
        except Exception:
            # Roll back
            rollback_text = self.history.undo(str(self.module))
            self._reparse(rollback_text)
            self.rebuild_graph()
            raise

        return self.rebuild_graph()

    def set_operand(
        self,
        op_id: str,
        operand_index: int,
        new_value_id: str,
    ) -> IRGraph:
        """Replace operand at *operand_index* of *op_id* with *new_value_id*.

        Uses the MLIR Python API directly: ``op.operands[i] = new_value``.
        """
        if self.module is None:
            raise ValueError("No module loaded")
        if op_id not in self._op_map:
            raise KeyError(f"Unknown op_id: {op_id}")
        if new_value_id not in self._value_map:
            raise KeyError(f"Unknown value_id: {new_value_id}")

        op = self._op_map[op_id]
        if operand_index < 0 or operand_index >= len(op.operands):
            raise IndexError(
                f"operand_index {operand_index} out of range "
                f"(op has {len(op.operands)} operands)"
            )

        self._snapshot()
        try:
            op.operands[operand_index] = self._value_map[new_value_id]
            self._ensure_dominance(op)
        except Exception:
            rollback_text = self.history.undo(str(self.module))
            self._reparse(rollback_text)
            self.rebuild_graph()
            raise

        return self.rebuild_graph()

    def remove_operand(self, op_id: str, operand_index: int) -> IRGraph:
        """Remove operand at *operand_index* from *op_id*.

        Recreates the operation with one fewer operand.  Transfers regions
        and redirects result uses to the new op.
        """
        if self.module is None:
            raise ValueError("No module loaded")
        if op_id not in self._op_map:
            raise KeyError(f"Unknown op_id: {op_id}")

        op = self._op_map[op_id]
        if operand_index < 0 or operand_index >= len(op.operands):
            raise IndexError(
                f"operand_index {operand_index} out of range "
                f"(op has {len(op.operands)} operands)"
            )

        self._snapshot()
        try:
            is_return = op.name in ("func.return", "return")
            # Find enclosing func BEFORE recreating (op is still attached)
            func_op_for_sync = None
            if is_return:
                func_op_for_sync, _ = self._find_func_and_return(op)

            new_operands = [
                op.operands[i] for i in range(len(op.operands))
                if i != operand_index
            ]
            self._recreate_op_with_operands(op, new_operands)

            if is_return and func_op_for_sync is not None:
                self._sync_func_type(func_op_for_sync)
        except Exception:
            rollback_text = self.history.undo(str(self.module))
            self._reparse(rollback_text)
            self.rebuild_graph()
            raise

        return self.rebuild_graph()

    def add_operand(
        self,
        op_id: str,
        value_id: str,
        position: int | None = None,
    ) -> IRGraph:
        """Add a new operand to *op_id* at *position*.

        *position* is the index where the new operand is inserted.
        ``None`` means append at the end.
        """
        if self.module is None:
            raise ValueError("No module loaded")
        if op_id not in self._op_map:
            raise KeyError(f"Unknown op_id: {op_id}")
        if value_id not in self._value_map:
            raise KeyError(f"Unknown value_id: {value_id}")

        op = self._op_map[op_id]
        new_value = self._value_map[value_id]

        self._snapshot()
        try:
            operands = list(op.operands)
            pos = position if position is not None else len(operands)
            operands.insert(pos, new_value)
            new_op = self._recreate_op_with_operands(op, operands)
            self._ensure_dominance(new_op)
        except Exception:
            rollback_text = self.history.undo(str(self.module))
            self._reparse(rollback_text)
            self.rebuild_graph()
            raise

        return self.rebuild_graph()

    def _recreate_op_with_operands(
        self,
        old_op: ir.Operation,
        new_operands: list[ir.Value],
    ) -> ir.Operation:
        """Replace *old_op* with a new op that has *new_operands*.

        Copies attributes, result types, and regions (via body transfer).
        Redirects all uses of old results to the new results.
        """
        result_types = [r.type for r in old_op.results]
        # Iterating op.attributes yields NamedAttribute objects; extract name/attr.
        attrs = {na.name: na.attr for na in old_op.attributes}
        num_regions = len(old_op.regions)

        ip = ir.InsertionPoint(old_op)
        new_op = ir.Operation.create(
            old_op.name,
            results=result_types,
            operands=new_operands,
            attributes=attrs,
            regions=num_regions,
            loc=old_op.location,
            ip=ip,
        )
        # ir.Operation.create() may return a dialect-specific OpView (e.g. PowOp
        # for math.powf) when the dialect has registered Python classes.
        # Unwrap to the raw ir.Operation so callers always receive a consistent type.
        if not isinstance(new_op, ir.Operation):
            new_op = new_op.operation

        # Transfer region contents from old op to new op.
        # Block.append_to(region) detaches the block from its current region
        # and appends it to the target region.
        for i in range(num_regions):
            old_region = old_op.regions[i]
            new_region = new_op.regions[i]
            # Collect blocks first (iterating while mutating is unsafe)
            blocks = list(old_region.blocks)
            for block in blocks:
                block.append_to(new_region)

        # Redirect all uses of old results to new results
        for i in range(len(old_op.results)):
            old_op.results[i].replace_all_uses_with(new_op.results[i])

        old_op.erase()
        return new_op

    def add_to_output(self, op_id: str, result_index: int) -> IRGraph:
        """Add an op's result to the enclosing function's return.

        Finds the ``func.return`` in the same function, appends the value
        as a new operand, and updates ``func.func``'s ``function_type``
        attribute to include the new return type.
        """
        if self.module is None:
            raise ValueError("No module loaded")
        if op_id not in self._op_map:
            raise KeyError(f"Unknown op_id: {op_id}")

        op = self._op_map[op_id]
        if result_index < 0 or result_index >= len(op.results):
            raise IndexError(
                f"result_index {result_index} out of range "
                f"(op has {len(op.results)} results)"
            )

        value = op.results[result_index]

        # Walk up to find the enclosing func.func and its return op
        func_op, ret_op = self._find_func_and_return(op)
        if func_op is None or ret_op is None:
            raise ValueError("Cannot find enclosing func.func or its return op")

        self._snapshot()
        try:
            # Add operand to return
            operands = list(ret_op.operands)
            operands.append(value)
            new_ret = self._recreate_op_with_operands(ret_op, operands)
            self._ensure_dominance(new_ret)

            # Update function type
            self._sync_func_type(func_op)
        except Exception:
            rollback_text = self.history.undo(str(self.module))
            self._reparse(rollback_text)
            self.rebuild_graph()
            raise

        return self.rebuild_graph()

    def _find_func_and_return(
        self, op: ir.Operation,
    ) -> tuple[ir.Operation | None, ir.Operation | None]:
        """Walk up from *op* to find the enclosing ``func.func`` and its
        ``func.return`` / ``return`` terminator."""
        func_op = None
        # Use the parent chain: op.parent returns the parent Operation
        current = op if hasattr(op, 'parent') else None
        while current is not None:
            raw = current.operation if hasattr(current, 'operation') else current
            if raw.name == "func.func":
                func_op = raw
                break
            try:
                current = raw.parent
            except Exception:
                break

        if func_op is None:
            return None, None

        # Find the return op in func's entry block
        entry_block = list(func_op.regions[0].blocks)[0]
        ops_list = list(entry_block.operations)
        if not ops_list:
            return func_op, None
        last_op = ops_list[-1].operation
        if last_op.name in ("func.return", "return"):
            return func_op, last_op
        return func_op, None

    def _sync_func_type(self, func_op: ir.Operation) -> None:
        """Update ``func.func``'s ``function_type`` attribute to match its
        entry block's return operand types."""
        entry_block = list(func_op.regions[0].blocks)[0]
        ops_list = list(entry_block.operations)
        if not ops_list:
            return
        last_op = ops_list[-1].operation
        if last_op.name not in ("func.return", "return"):
            return

        # Get current input types from function_type
        ft_attr = ir.TypeAttr(func_op.attributes["function_type"])
        ft = ir.FunctionType(ft_attr.value)
        input_types = list(ft.inputs)

        # Build result types from return operands
        result_types = [operand.type for operand in last_op.operands]

        new_ft = ir.FunctionType.get(input_types, result_types, self.context)
        func_op.attributes["function_type"] = ir.TypeAttr.get(new_ft, self.context)

    def validate(self) -> tuple[bool, list[str]]:
        """Verify the current module and return (valid, diagnostics).

        Uses DiagnosticHandler to capture detailed verification messages,
        then runs Python-level checks for unregistered dialect ops.
        Returns (False, diagnostics) if verification fails or raises an error.
        """
        if self.module is None:
            return (False, ["No module loaded"])

        diagnostics: list[str] = []

        def handler(diag) -> bool:
            """Append diagnostic message to the list.

            Returns True to indicate the handler handled the diagnostic,
            which is the expected return value for DiagnosticHandler.
            """
            severity = diag.severity.upper()
            message = diag.message
            diagnostics.append(f"{severity}: {message}")
            return True

        try:
            with self.context.attach_diagnostic_handler(handler):
                valid = self.module.operation.verify()
        except ir.MLIRError:
            valid = False

        # Python-level checks for unregistered ops (e.g. hbir)
        py_diags = self._validate_unregistered_ops()
        if py_diags:
            diagnostics.extend(py_diags)
            valid = False

        return (valid, diagnostics)

    def _validate_unregistered_ops(self) -> list[str]:
        """Check operand/result counts for ops whose dialect has no C++ verifier.

        Uses dialect_registry.get_op_signature() to get expected counts from
        the Python OpView class, then compares with actual op state.
        """
        from app.services.dialect_registry import get_op_signature

        diagnostics: list[str] = []
        for op_id, op in self._op_map.items():
            # Skip ops whose dialect IS registered (already verified by C++)
            if self.context.is_registered_operation(op.name):
                continue

            sig = get_op_signature(op.name)
            if sig is None:
                continue  # no Python binding either, can't check

            # Check operand count
            expected_operands = sum(
                1 for p in sig.params if p.kind == "operand" and p.required
            )
            actual_operands = len(list(op.operands))
            if actual_operands < expected_operands:
                diagnostics.append(
                    f"WARNING: {op.name} ({op_id}): expected at least "
                    f"{expected_operands} operands, got {actual_operands}"
                )

            # Check result count (skip variadic / unknown)
            if sig.num_results > 0 and len(list(op.results)) != sig.num_results:
                diagnostics.append(
                    f"WARNING: {op.name} ({op_id}): expected "
                    f"{sig.num_results} results, got {len(list(op.results))}"
                )

        return diagnostics

    # --- Private helpers ---

    def _ensure_dominance(self, consumer_op: ir.Operation) -> None:
        """Ensure SSA dominance: all operand producers in the same block
        come before *consumer_op*.

        If a producer is after the consumer, performs a topological sort of
        all ops in the block and reorders them via ``move_after``.
        """
        # Normalize: ir.Operation.create() may return a dialect-specific OpView
        # for registered ops (e.g. math.powf → PowOp). Unwrap to ir.Operation.
        if not isinstance(consumer_op, ir.Operation):
            consumer_op = consumer_op.operation  # type: ignore[union-attr]
        # ir.Operation has no .block attribute in this MLIR version; use
        # InsertionPoint to access the parent block.
        try:
            parent_block = ir.InsertionPoint(consumer_op).block
        except Exception:
            return

        # Build position map: op -> index in block
        ops_list = list(parent_block.operations)
        op_to_pos = {op.operation: i for i, op in enumerate(ops_list)}

        consumer_pos = op_to_pos.get(consumer_op)
        if consumer_pos is None:
            return

        # Check if any same-block producer is after the consumer.
        # NOTE: In some MLIR Python Binding builds, isinstance(v, ir.OpResult)
        # always returns False even for OpResult values; use ir.OpResult.isinstance().
        needs_reorder = False
        for operand in consumer_op.operands:
            if ir.OpResult.isinstance(operand):
                producer = ir.OpResult(operand).owner
                producer_pos = op_to_pos.get(producer)
                if producer_pos is not None and producer_pos > consumer_pos:
                    needs_reorder = True
                    break

        if not needs_reorder:
            return

        # Topological sort of all ops in the block.
        # For each op, predecessors are its operand producers in the same block.
        ops_set = set(op.operation for op in ops_list)
        # op -> set of ops that must come before it
        predecessors: dict[ir.Operation, set[ir.Operation]] = {
            op.operation: set() for op in ops_list
        }
        for op_view in ops_list:
            op = op_view.operation
            for operand in op.operands:
                if ir.OpResult.isinstance(operand):
                    prod = ir.OpResult(operand).owner
                    if prod in ops_set and prod != op:
                        predecessors[op].add(prod)

        # Kahn's algorithm
        in_degree = {op: len(preds) for op, preds in predecessors.items()}
        # Successors for propagation
        successors: dict[ir.Operation, list[ir.Operation]] = {
            op.operation: [] for op in ops_list
        }
        for op, preds in predecessors.items():
            for pred in preds:
                successors[pred].append(op)

        queue = [op.operation for op in ops_list if in_degree[op.operation] == 0]
        sorted_ops: list[ir.Operation] = []
        while queue:
            # Among ready ops, prefer their original order to minimize movement
            queue.sort(key=lambda o: op_to_pos.get(o, 0))
            current = queue.pop(0)
            sorted_ops.append(current)
            for succ in successors[current]:
                in_degree[succ] -= 1
                if in_degree[succ] == 0:
                    queue.append(succ)

        # If topological sort didn't include all ops, there's a cycle —
        # skip reordering and let validation catch the issue.
        if len(sorted_ops) != len(ops_list):
            return

        # Reorder: move each op to the correct position
        for i, op in enumerate(sorted_ops):
            if i == 0:
                # First op: move to front by moving before the current first op
                current_first = list(parent_block.operations)[0].operation
                if op != current_first:
                    op.move_before(current_first)
            else:
                # Move after the previous op in sorted order
                op.move_after(sorted_ops[i - 1])

    def _clear_maps(self) -> None:
        self._op_map.clear()
        self._block_map.clear()
        self._value_map.clear()
        self._result_value_ids.clear()
        self._block_arg_value_ids.clear()
        self._id_counters.clear()

    def _gen_id(self, prefix: str) -> str:
        n = self._id_counters.get(prefix, 0)
        self._id_counters[prefix] = n + 1
        return f"{prefix}_{n}"

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

                    # Build attributes.
                    # OpAttributeMap iteration behaviour differs by MLIR build:
                    #   - Older pybind11 builds: yields str keys (index into map to get value)
                    #   - Newer nanobind builds: yields NamedAttribute objects (.name / .attr)
                    attrs: dict[str, AttributeInfo] = {}
                    for item in child_op.attributes:
                        if isinstance(item, str):
                            attr_name = item
                            attr_val = child_op.attributes[attr_name]
                        else:
                            attr_name = item.name
                            attr_val = item.attr
                        attrs[attr_name] = AttributeInfo(
                            type=type(attr_val).__name__,
                            value=str(attr_val),
                        )

                    # Also collect MLIR properties (the <{...}> syntax in the generic
                    # op format).  This Python binding version does not expose
                    # properties through op.attributes; instead, they appear as typed
                    # descriptors on the dialect-specific OpView subclass.
                    # We enumerate the class-specific members of the OpView and keep
                    # those whose value is an ir.Attribute (properties/attributes),
                    # skipping ir.Value members (operands/results).
                    opview = child_op.opview
                    base_members = set(dir(ir.OpView))
                    for key in type(opview).__dict__:
                        if key.startswith("_") or key == "OPERATION_NAME":
                            continue
                        if key in base_members or key in attrs:
                            continue
                        try:
                            val = getattr(opview, key)
                        except Exception:
                            continue
                        if isinstance(val, ir.Attribute):
                            attrs[key] = AttributeInfo(
                                type=type(val).__name__,
                                value=str(val),
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

        Scans _value_map directly using Value == comparison (C++ pointer equality).
        This is more reliable than comparing owner Operation/Block objects, which
        can fail for custom/unregistered dialect ops.
        """
        for vid, stored_val in self._value_map.items():
            try:
                if stored_val == value:
                    return vid
            except Exception:
                continue

        # Fallback: register as new (shouldn't normally happen)
        vid = self._gen_id("val")
        self._value_map[vid] = value
        return vid
