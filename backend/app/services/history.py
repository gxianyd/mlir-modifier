from __future__ import annotations

import zlib


class HistoryManager:
    """Snapshot-based undo/redo history using MLIR text round-trip.

    Each snapshot is a zlib-compressed ``str(module)`` bytes object.
    Compression typically achieves 10:1 ratio on MLIR text, keeping memory
    usage manageable even for large modules (e.g. 500KB text -> ~50KB
    compressed, 50 snapshots -> ~2.5MB).

    This avoids holding MLIR wrapper references across mutations (which is
    unsafe due to unstable wrapper identity in the Python binding).
    """

    def __init__(self, max_history: int = 50) -> None:
        self._undo_stack: list[bytes] = []
        self._redo_stack: list[bytes] = []
        self._max_history = max_history

    @staticmethod
    def _compress(text: str) -> bytes:
        return zlib.compress(text.encode("utf-8"))

    @staticmethod
    def _decompress(data: bytes) -> str:
        return zlib.decompress(data).decode("utf-8")

    # -- mutations --

    def snapshot(self, module_text: str) -> None:
        """Save *module_text* (the state **before** a mutation) onto the undo
        stack and clear the redo stack (new edit branch)."""
        self._undo_stack.append(self._compress(module_text))
        if len(self._undo_stack) > self._max_history:
            self._undo_stack.pop(0)
        self._redo_stack.clear()

    def undo(self, current_text: str) -> str:
        """Return the previous module text and push *current_text* onto the
        redo stack.

        Raises ``IndexError`` if there is nothing to undo.
        """
        if not self._undo_stack:
            raise IndexError("Nothing to undo")
        previous = self._undo_stack.pop()
        self._redo_stack.append(self._compress(current_text))
        return self._decompress(previous)

    def redo(self, current_text: str) -> str:
        """Return the next module text and push *current_text* onto the undo
        stack.

        Raises ``IndexError`` if there is nothing to redo.
        """
        if not self._redo_stack:
            raise IndexError("Nothing to redo")
        next_data = self._redo_stack.pop()
        self._undo_stack.append(self._compress(current_text))
        return self._decompress(next_data)

    def clear(self) -> None:
        """Reset both stacks (e.g. when a new file is loaded)."""
        self._undo_stack.clear()
        self._redo_stack.clear()

    # -- queries --

    @property
    def can_undo(self) -> bool:
        return len(self._undo_stack) > 0

    @property
    def can_redo(self) -> bool:
        return len(self._redo_stack) > 0
