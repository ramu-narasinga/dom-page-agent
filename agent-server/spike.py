from __future__ import annotations

import asyncio
import json
import uuid
from fastapi import FastAPI, WebSocket

app = FastAPI()

@app.websocket("/agent-ws")
async def agent_ws(websocket: WebSocket):
    await websocket.accept()
    pending: dict[str, asyncio.Future] = {}

    async def request(msg_type: str, payload: dict | None = None):
        request_id = str(uuid.uuid4())
        fut = asyncio.get_event_loop().create_future()
        pending[request_id] = fut
        await websocket.send_json({"type": msg_type, "request_id": request_id, **(payload or {})})
        return await fut

    async def receiver():
        while True:
            data = json.loads(await websocket.receive_text())
            if data.get("type") == "response" and data.get("request_id") in pending:
                pending.pop(data["request_id"]).set_result(data.get("data"))

    recv_task = asyncio.create_task(receiver())
    try:
        state = await request("get_browser_state")
        print("browser state:", state)
        result = await request("execute_tool", {"tool_name": "click_element_by_index", "params": {"index": 0}})
        print("tool result:", result)
    finally:
        recv_task.cancel()
