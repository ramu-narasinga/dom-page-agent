from __future__ import annotations

import asyncio
import uuid
from fastapi import WebSocket


class BrowserBridge:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.pending: dict[str, asyncio.Future] = {}
        self.stop_event = asyncio.Event()

    async def request(self, msg_type: str, payload: dict | None = None):
        request_id = str(uuid.uuid4())
        fut = asyncio.get_event_loop().create_future()
        self.pending[request_id] = fut
        await self.websocket.send_json({"type": msg_type, "request_id": request_id, **(payload or {})})
        return await fut

    async def get_browser_state(self) -> dict:
        return await self.request("get_browser_state")

    async def execute_tool(self, tool_name: str, params: dict) -> dict:
        return await self.request("execute_tool", {"tool_name": tool_name, "params": params})

    async def send_step_update(self, entry: dict):
        await self.websocket.send_json({"type": "step_update", "entry": entry})

    async def handle_incoming(self, data: dict):
        """Call this from the single receive loop in main.py for every incoming message
        that isn't a 'start_task' (those are handled by main.py directly)."""
        if data.get("type") == "response" and data.get("request_id") in self.pending:
            self.pending.pop(data["request_id"]).set_result(data.get("data"))
        elif data.get("type") == "stop_task":
            self.stop_event.set()
