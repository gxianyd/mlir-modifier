"""Tests for the WebSocket validation endpoint."""

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.routers.model import ir_manager
from app.services.notifier import notifier

SIMPLE_MLIR = """
module {
  func.func @add(%arg0: f32, %arg1: f32) -> f32 {
    %0 = arith.addf %arg0, %arg1 : f32
    return %0 : f32
  }
}
"""


class TestWebSocket:
    """WebSocket validation endpoint tests."""

    def test_ws_connect_and_receive(self):
        """Client can connect to /ws/validation and receive messages."""
        client = TestClient(app)
        with client.websocket_connect("/ws/validation") as ws:
            assert notifier.connection_count >= 1
            # Connection is alive — we can close cleanly
        # After disconnect, count should decrease
        assert notifier.connection_count == 0

    def test_ws_receives_broadcast(self):
        """Connected client receives validation broadcast."""
        client = TestClient(app)
        ir_manager.load(SIMPLE_MLIR)

        with client.websocket_connect("/ws/validation") as ws:
            import asyncio
            asyncio.get_event_loop().run_until_complete(
                notifier.broadcast(True, [])
            )
            data = ws.receive_json()
            assert data["valid"] is True
            assert data["diagnostics"] == []

    def test_ws_broadcast_invalid(self):
        """Broadcast with diagnostics is received correctly."""
        client = TestClient(app)
        with client.websocket_connect("/ws/validation") as ws:
            import asyncio
            asyncio.get_event_loop().run_until_complete(
                notifier.broadcast(False, ["error: something went wrong"])
            )
            data = ws.receive_json()
            assert data["valid"] is False
            assert len(data["diagnostics"]) == 1
            assert "something went wrong" in data["diagnostics"][0]

    def test_ws_multiple_clients(self):
        """Multiple clients all receive broadcasts."""
        client = TestClient(app)
        with client.websocket_connect("/ws/validation") as ws1:
            with client.websocket_connect("/ws/validation") as ws2:
                assert notifier.connection_count >= 2
                import asyncio
                asyncio.get_event_loop().run_until_complete(
                    notifier.broadcast(True, [])
                )
                d1 = ws1.receive_json()
                d2 = ws2.receive_json()
                assert d1["valid"] is True
                assert d2["valid"] is True


@pytest.fixture(autouse=True)
def _reset():
    """Reset notifier connections between tests."""
    notifier._connections.clear()
    yield
    notifier._connections.clear()
