import pytest

from app.services.history import HistoryManager


class TestHistoryManager:
    def test_initial_state(self):
        h = HistoryManager()
        assert not h.can_undo
        assert not h.can_redo

    def test_snapshot_enables_undo(self):
        h = HistoryManager()
        h.snapshot("state_0")
        assert h.can_undo
        assert not h.can_redo

    def test_undo_restores_previous(self):
        h = HistoryManager()
        h.snapshot("state_0")
        result = h.undo("state_1")
        assert result == "state_0"
        assert not h.can_undo
        assert h.can_redo

    def test_redo_after_undo(self):
        h = HistoryManager()
        h.snapshot("state_0")
        h.undo("state_1")
        result = h.redo("state_0")
        assert result == "state_1"
        assert h.can_undo
        assert not h.can_redo

    def test_undo_empty_stack_raises(self):
        h = HistoryManager()
        with pytest.raises(IndexError, match="Nothing to undo"):
            h.undo("current")

    def test_redo_empty_stack_raises(self):
        h = HistoryManager()
        with pytest.raises(IndexError, match="Nothing to redo"):
            h.redo("current")

    def test_new_snapshot_clears_redo(self):
        h = HistoryManager()
        h.snapshot("state_0")
        h.undo("state_1")
        assert h.can_redo
        # New edit clears redo branch
        h.snapshot("state_1")
        assert not h.can_redo

    def test_max_history_limit(self):
        h = HistoryManager(max_history=3)
        h.snapshot("s0")
        h.snapshot("s1")
        h.snapshot("s2")
        h.snapshot("s3")  # s0 should be evicted
        # Only 3 entries: s1, s2, s3
        r1 = h.undo("s4")
        assert r1 == "s3"
        r2 = h.undo("s3")
        assert r2 == "s2"
        r3 = h.undo("s2")
        assert r3 == "s1"
        assert not h.can_undo  # s0 was evicted

    def test_clear_resets_stacks(self):
        h = HistoryManager()
        h.snapshot("s0")
        h.undo("s1")
        assert h.can_redo
        h.clear()
        assert not h.can_undo
        assert not h.can_redo

    def test_multiple_undo_redo_round_trip(self):
        h = HistoryManager()
        h.snapshot("s0")
        h.snapshot("s1")
        h.snapshot("s2")
        # Undo 3 times
        assert h.undo("s3") == "s2"
        assert h.undo("s2") == "s1"
        assert h.undo("s1") == "s0"
        assert not h.can_undo
        # Redo 3 times
        assert h.redo("s0") == "s1"
        assert h.redo("s1") == "s2"
        assert h.redo("s2") == "s3"
        assert not h.can_redo

    def test_compression_preserves_content(self):
        """Verify zlib compression/decompression round-trip works."""
        h = HistoryManager()
        large_text = "func.func @test() {\n" + "  %x = arith.constant 0 : i32\n" * 1000 + "}\n"
        h.snapshot(large_text)
        result = h.undo("current")
        assert result == large_text
