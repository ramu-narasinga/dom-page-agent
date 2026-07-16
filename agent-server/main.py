from __future__ import annotations

import asyncio
import json
import traceback
from dotenv import load_dotenv
load_dotenv()  # loads agent-server/.env before graph.py reads ANTHROPIC_API_KEY at import time

from fastapi import FastAPI, WebSocket
from bridge import BrowserBridge
from graph import build_graph

app = FastAPI()
ALLOWED_ORIGIN = "http://localhost:3000"


@app.get("/health")
def health():
    return {"ok": True}


@app.websocket("/agent-ws")
async def agent_ws(websocket: WebSocket):
    if websocket.headers.get("origin") != ALLOWED_ORIGIN:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    bridge = BrowserBridge(websocket)

    async def run_task(task: str):
        graph = build_graph(bridge, max_steps=30)
        try:
            final_state = await graph.ainvoke(
                {"task": task, "history": [], "step_count": 0, "status": "running"}
            )
            if final_state["status"] == "stopped":
                await websocket.send_json({"type": "task_stopped"})
            else:
                last = final_state["history"][-1] if final_state["history"] else None
                success = bool(
                    last and last["action"]["name"] == "done"
                    and last["action"]["input"].get("success") is not False
                )
                message = str(last["action"]["input"].get("text", "")) if last else ""
                await websocket.send_json(
                    {"type": "task_complete", "result": {"success": success, "message": message}}
                )
        except Exception as err:
            traceback.print_exc()  # full stack trace to the server console, not just str(err)
            await websocket.send_json({"type": "task_error", "message": str(err)})

    try:
        while True:
            data = json.loads(await websocket.receive_text())
            if data.get("type") == "start_task":
                # Run the graph concurrently, not inline — the outer loop must keep reading
                # incoming messages (responses to get_browser_state/execute_tool, stop_task)
                # the whole time the graph is running, or bridge.request()'s pending futures
                # can never resolve (a real deadlock, not a hypothetical one: this exact bug
                # is what caused the very first run to hang after one exchange).
                asyncio.create_task(run_task(data["task"]))
            else:
                await bridge.handle_incoming(data)
    except Exception:
        pass
