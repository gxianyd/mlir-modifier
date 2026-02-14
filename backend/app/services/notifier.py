from __future__ import annotations

import json

from fastapi import WebSocket


class ValidationNotifier:
    """Manages WebSocket connections and broadcasts validation status."""

    def __init__(self) -> None:
        self._connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self._connections:
            self._connections.remove(ws)

    async def broadcast(self, valid: bool, diagnostics: list[str]) -> None:
        """Send validation status to all connected clients."""
        payload = json.dumps({"valid": valid, "diagnostics": diagnostics})
        dead: list[WebSocket] = []
        for ws in self._connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections.remove(ws)

    @property
    def connection_count(self) -> int:
        return len(self._connections)


# Singleton instance
notifier = ValidationNotifier()
