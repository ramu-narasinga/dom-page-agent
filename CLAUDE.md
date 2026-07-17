# CLAUDE.md

Conventions and non-obvious decisions for this repo. Read before changing `src/PageAgentCore.ts`, `src/Panel.ts`, `server/index.ts`, or anything in `agent-server/` — several of these look simplifiable but aren't.

## Reflect-before-act is mandatory

`AGENT_STEP_TOOL` (`src/tools.ts`, mirrored in `agent-server/graph.py`) requires `evaluation_previous_goal`, `memory`, and `next_goal` on every step, not just `action`. Do not collapse this into a bare `{tool_name, params}` call to save tokens — these fields are what make `agent.history` (and the Panel's live feed) legible for debugging and for demonstrating failure modes. Losing them turns the transcript back into an opaque click sequence.

## `AGENT_STEP_TOOL.params` must declare its sub-fields explicitly

`params` used to be a bare `{type: 'object'}` with no declared shape — the model only knew `input_text` needs `{index, text}` from prose in the system prompt, not from the schema. This caused a real failure: a model omitted `index` entirely, and `PageController` failed safe with `"No interactive element at index undefined"` instead of crashing, but the underlying cause (schema under-specification) wasn't obvious until traced. `params` now explicitly declares `index`/`text`/`down`/`success` with descriptions in both the TS (`src/tools.ts`) and Python (`agent-server/graph.py`) copies — don't strip that back down to a bare object type.

## Independent DOM verification always overrides the agent's self-report

`src/verify.ts`'s `buildTrustReport` must never be simplified into trusting `agentClaim.success` alone. The agent's own `success: true` is a self-report — LLMs can and do claim success when a value didn't actually stick (this happened for real during development). `verdict` is `VERIFIED` only when the agent's claim *and* an independent `verifyDom` check both agree; either one failing means `NEEDS_REVIEW`. Checking only one field before trusting `VERIFIED` is not sufficient evidence — verify several fields, not one, before treating a run as trustworthy.

## The proxy/direct-key pattern exists to keep the API key off the browser

`server/index.ts` is a thin passthrough specifically so `ANTHROPIC_API_KEY` never touches client-side code. Calling `api.anthropic.com` directly from `src/LLM.ts` would require the `anthropic-dangerous-direct-browser-access` header and expose the key in devtools/network tab to any script on the page. If `LLM.ts` is ever changed to call Anthropic directly, that's a security regression, not a simplification — route it back through the proxy. `agent-server/graph.py` calls Anthropic directly, but from a Python server the browser can't inspect, which is the equivalent security boundary for that path — don't move the LangGraph agent's key into browser-reachable code either.

## Plain loop vs. LangGraph — both are deliberate, for different reasons

`PageAgentCore.#run` is a single bounded `for` loop, not a state machine — this project has one agent taking one action at a time against one page, no branching, no agent-to-agent delegation. It's the right-sized solution and stays the primary implementation.

`agent-server/graph.py`'s `StateGraph` (one node, one conditional self-loop edge) is a **second, parallel** implementation added specifically to demonstrate LangGraph fluency — not because the plain loop was insufficient. Keep both. Don't let one "simplify away" the other; they're answering different questions (what does this problem need vs. what can you build with a heavier framework when asked to).

## Panel only talks to the agent through `PanelAgentAdapter`

`src/Panel.ts` imports only `PanelAgentAdapter` from `src/types.ts` — never `PageController`, `LLM`, `tools.ts`, or anything WebSocket/LangGraph-specific directly. This decoupling (`status`, `history`, `task`, `execute`/`stop`/`dispose`, plus `statuschange`/`historychange`/`activity`/`dispose` events) is what let `WsLangGraphAgent` (a structurally opposite, server-owned-loop implementation) plug into the exact same `Panel` with zero changes to `Panel.ts`. That's the payoff of keeping the interface — don't have `Panel` reach into any agent implementation's internals, on either branch.

## `stop()` must stay wired through a real cancellation primitive

**Plain loop**: `execute()` creates an `AbortController` per run and threads its `signal` through `LLM.invoke()` into `fetch()`. `stop()` calls `.abort()` and awaits `#runningPromise` so the caller knows the run has actually settled to `status: 'stopped'` before returning.

**WS/LangGraph**: `agent_step` checks `bridge.stop_event` at the top of each iteration *and* races the in-flight Anthropic call against `bridge.stop_event.wait()` via `asyncio.wait(..., return_when=FIRST_COMPLETED)`, cancelling the request task if stop wins. Don't turn either into a no-op status flip that leaves the in-flight call running in the background — that silently keeps burning API calls after the user thinks they've cancelled.

## The WebSocket server must never await the graph inline in its message-reading loop

`agent-server/main.py` runs `run_task()` via `asyncio.create_task(...)`, not `await`ed directly in the loop that calls `websocket.receive_text()`. This is not a style preference — awaiting the graph inline caused a real deadlock: `bridge.request()` (used by `get_browser_state`/`execute_tool`) sends its request and awaits a `Future` that only resolves when the *same* loop calls `receive_text()` again and routes the response to `bridge.handle_incoming()`. If that loop is itself blocked awaiting the graph, nothing ever reads the response, and the future hangs forever. This hung the very first real run after exactly one exchange. Worth remembering for debugging: DevTools' Network panel showed the browser's response as "sent" the whole time — that panel proves wire-level delivery, not that the server application ever read it. Don't reintroduce an inline `await graph.ainvoke(...)` in the message loop.

## uvicorn must run with `--ws wsproto`

The default legacy `websockets` implementation raises `SecurityError: line too long` on a real Chrome connection once the browser's accumulated `Cookie` header for `localhost` exceeds its internal line-length ceiling (cookies aren't segmented by port, so this fills up fast across many local dev projects on the same machine). A synthetic test client without cookies won't trigger this, which is why it's easy to miss until testing from an actual browser tab. `--ws wsproto` doesn't have this ceiling. Don't drop the flag from the run command or docs.

## Defensive parsing on model output, not just on our own code

`agent-server/graph.py` `json.loads()`s `decision["action"]` and `action["params"]` if either comes back as a string instead of a nested object — observed with `claude-haiku-4-5`, which occasionally stringifies a nested object field instead of honoring the schema's declared object type. This is a real, reproducible model-variance issue, not defensive-programming-for-its-own-sake — don't remove the `isinstance(..., str)` checks on the assumption "the schema already guarantees this."

## Errors must be visible, not silently swallowed

Both agent implementations log the underlying error before setting an error/stopped status:
- Browser: `console.error('[PageAgentCore] step failed:', err)` / `console.error('[WsLangGraphAgent] server error:', ...)`.
- Python: `traceback.print_exc()` in `agent-server/main.py`'s exception handler, not just `str(err)` sent to the browser — a bare `str(err)` (e.g. `"string indices must be integers"`) is not enough to locate the failing line; the full traceback is what actually diagnosed that bug.

Any new failure path added to either side should log the same way — don't let a caught exception disappear with only a status flip or a one-line message.

## Testing convention

No automated test framework — `npm run typecheck` (checks both `tsconfig.json` and `server/tsconfig.json`) is the only required pre-commit gate on the TypeScript side. All functional verification is manual and browser-driven, including a deliberately-broken run to confirm `buildTrustReport` correctly produces `NEEDS_REVIEW`. On the Python side, there's no test framework either — verify by running the actual server and driving a real browser task, same philosophy.

## Bundling convention

`dist/` is build output only — never hand-edited, always regenerated via `npm run build`. On this branch, `src/index.ts` self-initializes a `WsLangGraphAgent` + `Panel` on injection (not the plain-loop `Agent` — that's still exported for console/comparison use, just not auto-constructed here). If you add new exports to `window.MiniPageAgent`, keep the existing ones (`PageController`, `LLM`, `PageAgentCore`, `Agent`, `Panel`, `WsLangGraphAgent`, `verifyDom`, `buildTrustReport`, `agent`) rather than replacing them.

## Real bugs found during development (keep in mind before "simplifying" `PageController` or the WS bridge)

1. **`<select>` elements were unsupported** — fixed by matching requested text against `<option>` value or label.
2. **Inputs without a `placeholder` showed up with zero description** — fixed by resolving `aria-label` → `label[for]` → wrapping `<label>` before falling back to `textContent`/`placeholder`.
3. **`LLM.invoke` crashed on a truncated response** with no `tool_use` block — fixed by raising `max_tokens` and throwing a descriptive error.
4. **Button-grid UIs got no grouping context**, causing a skipped required selection (a date picker) — fixed with a nearest-heading/`<legend>` fallback in `PageController.getSectionContext`.
5. **`AGENT_STEP_TOOL.params` had no declared sub-schema** — fixed by explicitly declaring `index`/`text`/`down`/`success`.
6. **A model stringified a nested `action` object** — fixed with defensive `json.loads()` in `graph.py`.
7. **A real asyncio deadlock** from awaiting the graph inline in the WS message loop — fixed by running it as a separate task.
8. **uvicorn's default WebSocket implementation rejected real browser connections** on cookie-header size — fixed by running with `--ws wsproto`.
9. **A model omitted a required top-level field (`next_goal`)** from its structured output entirely — `decision[k]` (direct subscript) crashed with `KeyError` instead of degrading gracefully. Schema `required` is a strong hint to Anthropic, not a hard guarantee, same lesson as bug 6. Fixed with `decision.get(k, "")` in `graph.py`.

All nine were caught by actually running the agent against the real demo pages, not by code review — a reminder that `PageController`'s element-description logic, `LLM.invoke`'s response parsing, and the WS bridge's concurrency model are the most failure-prone parts of this codebase, and any change to them should be re-verified against the full demo pages, not just a small scratch page.
