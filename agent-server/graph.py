from __future__ import annotations

import operator
import os
import httpx
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, START, END
from bridge import BrowserBridge

ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]  # loaded from agent-server/.env by main.py at startup

AGENT_STEP_TOOL = {
    "name": "agent_step",
    "description": "Reflect on the previous action, then choose exactly one next action.",
    "input_schema": {
        "type": "object",
        "properties": {
            "evaluation_previous_goal": {"type": "string"},
            "memory": {"type": "string"},
            "next_goal": {"type": "string"},
            "action": {
                "type": "object",
                "properties": {
                    "tool_name": {"type": "string", "enum": ["click_element_by_index", "input_text", "scroll", "done"]},
                    "params": {"type": "object"},
                },
                "required": ["tool_name", "params"],
            },
        },
        "required": ["evaluation_previous_goal", "memory", "next_goal", "action"],
    },
}

SYSTEM_PROMPT = (
    "You are a browser automation agent. You control a webpage by referencing interactive elements "
    "by their index number. For a <select>, use input_text with the exact option label text. Before "
    "each action: evaluate the previous action, note what you've learned, state your next goal. "
    "Then choose exactly one action: click_element_by_index, input_text, scroll, or done."
)


class AgentState(TypedDict):
    task: str
    history: Annotated[list, operator.add]
    step_count: int
    status: str


def build_graph(bridge: BrowserBridge, max_steps: int):
    async def agent_step(state: AgentState) -> dict:
        if bridge.stop_event.is_set():
            return {"status": "stopped"}

        browser_state = await bridge.get_browser_state()
        history_text = "\n".join(
            f"Step {h['stepIndex']}: {h['action']['name']}({h['action']['input']}) -> {h['action']['output']}"
            for h in state["history"]
        )
        prompt = (
            f"<user_request>{state['task']}</user_request>\n"
            f"<current_url>{browser_state['url']}</current_url>\n"
            f"<interactive_elements>\n{browser_state['interactiveElements']}\n</interactive_elements>\n"
            f"<history>\n{history_text}\n</history>"
        )

        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "content-type": "application/json",
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": "claude-haiku-4-5",
                    "max_tokens": 2048,
                    "system": SYSTEM_PROMPT,
                    "messages": [{"role": "user", "content": prompt}],
                    "tools": [AGENT_STEP_TOOL],
                    "tool_choice": {"type": "tool", "name": "agent_step"},
                },
                timeout=60,
            )
        data = res.json()
        if res.status_code != 200:
            raise RuntimeError(f"Anthropic API error ({res.status_code}): {data}")
        tool_use = next((b for b in data["content"] if b["type"] == "tool_use"), None)
        if tool_use is None:
            raise RuntimeError(f"No tool_use in response (stop_reason: {data.get('stop_reason')})")
        decision = tool_use["input"]
        action = decision["action"]

        if action["tool_name"] == "done":
            entry = {
                "type": "step", "stepIndex": state["step_count"],
                "reflection": {k: decision[k] for k in ("evaluation_previous_goal", "memory", "next_goal")},
                "action": {"name": "done", "input": action["params"], "output": "done"},
            }
            await bridge.send_step_update(entry)
            return {"history": [entry], "step_count": state["step_count"] + 1, "status": "completed"}

        result = await bridge.execute_tool(action["tool_name"], action["params"])
        entry = {
            "type": "step", "stepIndex": state["step_count"],
            "reflection": {k: decision[k] for k in ("evaluation_previous_goal", "memory", "next_goal")},
            "action": {"name": action["tool_name"], "input": action["params"], "output": result.get("message", "")},
        }
        await bridge.send_step_update(entry)
        return {"history": [entry], "step_count": state["step_count"] + 1, "status": "running"}

    def route(state: AgentState) -> str:
        if state["status"] in ("completed", "stopped") or state["step_count"] >= max_steps:
            return END
        return "agent_step"

    return (
        StateGraph(AgentState)
        .add_node("agent_step", agent_step)
        .add_edge(START, "agent_step")
        .add_conditional_edges("agent_step", route)
        .compile()
    )
