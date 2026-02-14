from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.notifier import notifier

router = APIRouter()


@router.websocket("/ws/validation")
async def validation_ws(ws: WebSocket):
    """WebSocket endpoint for real-time validation status updates."""
    await notifier.connect(ws)
    try:
        # Keep connection alive — wait for client disconnect
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        notifier.disconnect(ws)
