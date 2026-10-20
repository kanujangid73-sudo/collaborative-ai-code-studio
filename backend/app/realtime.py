"""In-process WebSocket hub: one room per workspace, with presence tracking."""

import asyncio
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        # workspace_id -> {websocket: username}
        self.rooms: dict[int, dict[WebSocket, str]] = defaultdict(dict)

    async def connect(self, workspace_id: int, websocket: WebSocket, username: str) -> None:
        await websocket.accept()
        self.rooms[workspace_id][websocket] = username
        await self.broadcast_presence(workspace_id)

    async def disconnect(self, workspace_id: int, websocket: WebSocket) -> None:
        room = self.rooms.get(workspace_id, {})
        room.pop(websocket, None)
        if not room:
            self.rooms.pop(workspace_id, None)
        else:
            await self.broadcast_presence(workspace_id)

    def online(self, workspace_id: int) -> list[str]:
        return sorted(set(self.rooms.get(workspace_id, {}).values()))

    def online_total(self) -> int:
        return len({name for room in self.rooms.values() for name in room.values()})

    async def broadcast(self, workspace_id: int, event: dict, exclude: WebSocket | None = None) -> None:
        targets = [ws for ws in list(self.rooms.get(workspace_id, {})) if ws is not exclude]
        results = await asyncio.gather(*(ws.send_json(event) for ws in targets), return_exceptions=True)
        for ws, result in zip(targets, results):
            if isinstance(result, Exception):
                self.rooms.get(workspace_id, {}).pop(ws, None)

    async def kick(self, workspace_id: int, username: str, code: int = 4403) -> None:
        """Disconnect a user from a room, e.g. after losing access to a private workspace."""
        room = self.rooms.get(workspace_id, {})
        for ws, name in list(room.items()):
            if name == username:
                room.pop(ws, None)
                await self._close(ws, code)
        if room:
            await self.broadcast_presence(workspace_id)
        else:
            self.rooms.pop(workspace_id, None)

    async def close_room(self, workspace_id: int, code: int = 4404) -> None:
        for ws in list(self.rooms.pop(workspace_id, {})):
            await self._close(ws, code)

    @staticmethod
    async def _close(ws: WebSocket, code: int) -> None:
        try:
            await ws.close(code=code)
        except Exception:
            pass  # already closed

    async def broadcast_presence(self, workspace_id: int) -> None:
        await self.broadcast(workspace_id, {"type": "presence", "users": self.online(workspace_id)})


manager = ConnectionManager()
