# CLAUDE.md

Conventions and non-obvious decisions for this repo. Read before changing `src/Panel.ts`, `src/ws/WsLangGraphAgent.ts`, or anything in `agent-server/` — several of these look simplifiable but aren't.

## Reflect-before-act is mandatory

`agent-server/graph.py`'s `AGENT_STEP_TOOL` requires `evaluation_previous_goal`, `memory`, and `next_goal` on every step, not just `action`. Do not collapse this into a bare `{tool_name, params}` call to save tokens — these fields are what make `agent.history` (and the Panel's live feed) legible for debugging and for demonstrating failure modes. Losing them turns the transcript back into an opaque click sequence.

## `AGENT_STEP_TOOL.params` must declare its sub-fields explicitly

`params` used to be a bare `{type: 'object'}` with no declared shape — the model only knew `input_text` needs `{index, text}` from prose in the system prompt, not from the schema. This caused a real failure: a model omitted `index` entirely, and `PageController` failed safe with `"No interactive element at index undefined"` instead of crashing, but the underlying cause (schema under-specification) wasn't obvious until traced. `params` now explicitly declares `index`/`text`/`down`/`success` with descriptions. Don't strip that back down to a bare object type.

## There is no independent verification layer — this is a deliberate decision, not an oversight

An earlier version of this project included `src/verify.ts` (`verifyDom`/`buildTrustReport`) framed as the project's "differentiator." It was removed because it was never actually wired into the automated loop — `grep` showed its only call site was `src/index.ts` re-exporting it onto `window.MiniPageAgent` for manual console use. Keeping unused-but-prominently-documented code that implies automatic verification is happening when it isn't is worse than not having it — it's a form of dishonesty about what the system actually does. **Do not re-add a verification layer as decoration.** If one gets added back, it must:
1. Actually run automatically as part of the loop (not require a manual console call), and
2. Derive what to check from the agent's own recorded actions (e.g. `{index, text}` from each `input_text` step, matched to the actual DOM element at the moment it was acted on), **not** from a new field the model self-declares — letting the same agent that might be lying also decide what counts as "verified" defeats the point of independence.

See `~/.claude/plans/auto-verification-plan.md` (outside this repo) for a fully worked-out design if this gets revisited — it was scoped and reviewed but deliberately not built.

## The API key never touches the browser

`agent-server/graph.py` calls `api.anthropic.com` directly via `httpx`, using `ANTHROPIC_API_KEY` loaded from `agent-server/.env` — from a Python server the browser can never inspect. Don't move the Anthropic call (or the key) into any browser-side code (`src/ws/WsLangGraphAgent.ts` or otherwise) — that would put the key in the network tab, readable by any script on the page.

## Why LangGraph, and why a WebSocket bridge specifically

The DOM actions (click/type/scroll) can only happen in the browser — `PageController` operates on `document`, which the Python process can't reach directly. For LangGraph to genuinely *own* the multi-step loop (not just decide one action per HTTP call, which would barely differ from a stateless proxy), the graph node reaches back into the browser mid-run over a live WebSocket connection every time it needs DOM state or a tool executed, and awaits that response before continuing to the next graph iteration. `agent-server/graph.py`'s `StateGraph` is one node (`agent_step`) with a conditional self-loop edge — the same control flow as a hand-rolled `for` loop, just expressed as a graph.

## Panel only talks to the agent through `PanelAgentAdapter`

`src/Panel.ts` imports only `PanelAgentAdapter` from `src/types.ts` — never `PageController` or anything WebSocket-specific directly. This decoupling (`status`, `history`, `task`, `execute`/`stop`/`dispose`, plus `statuschange`/`historychange`/`activity`/`dispose` events) is the same pattern alibaba/page-agent's own UI package uses to stay independent of the core agent implementation. Keep the interface even though there's currently one implementation — it's what makes `Panel.ts` reusable if a second implementation is ever added again.

## `stop()` must stay wired through a real cancellation primitive

`agent_step` (Python) checks `bridge.stop_event` at the top of each iteration *and* races the in-flight Anthropic call against `bridge.stop_event.wait()` via `asyncio.wait(..., return_when=FIRST_COMPLETED)`, cancelling the request task if stop wins. Don't turn this into a no-op status flip that leaves the in-flight call running in the background — that silently keeps burning API calls after the user thinks they've cancelled.

## The WebSocket server must never await the graph inline in its message-reading loop

`agent-server/main.py` runs `run_task()` via `asyncio.create_task(...)`, not `await`ed directly in the loop that calls `websocket.receive_text()`. This is not a style preference — awaiting the graph inline caused a real deadlock: `bridge.request()` (used by `get_browser_state`/`execute_tool`) sends its request and awaits a `Future` that only resolves when the *same* loop calls `receive_text()` again and routes the response to `bridge.handle_incoming()`. If that loop is itself blocked awaiting the graph, nothing ever reads the response, and the future hangs forever. This hung the very first real run after exactly one exchange. Worth remembering for debugging: DevTools' Network panel showed the browser's response as "sent" the whole time — that panel proves wire-level delivery, not that the server application ever read it. Don't reintroduce an inline `await graph.ainvoke(...)` in the message loop.

## uvicorn must run with `--ws wsproto`

The default legacy `websockets` implementation raises `SecurityError: line too long` on a real Chrome connection once the browser's accumulated `Cookie` header for `localhost` exceeds its internal line-length ceiling (cookies aren't segmented by port, so this fills up fast across many local dev projects on the same machine). A synthetic test client without cookies won't trigger this, which is why it's easy to miss until testing from an actual browser tab. `--ws wsproto` doesn't have this ceiling. Don't drop the flag from the run command or docs.

## `ALLOWED_ORIGIN` is env-configurable but still a manual allowlist

`agent-server/main.py` reads `ALLOWED_ORIGIN` from the environment (comma-separated for multiple origins), defaulting to `http://localhost:3000`. This exists so a one-off demo against a real external site is possible without editing code — but it's still a deliberate security boundary, not a general CORS policy. Don't default it to a wildcard or leave a non-localhost origin in `agent-server/.env` after a one-off demo.

## Defensive parsing on model output, not just on our own code

`agent-server/graph.py` uses `decision.get(k, "")` (not direct subscript) for the reflection fields, and `json.loads()`s `action`/`action.params` if either comes back as a string instead of a nested object. Both were observed with `claude-haiku-4-5`: it has omitted a required top-level field entirely, and separately stringified a nested object field, despite the schema declaring both. This is real, reproduced model variance, not defensive-programming-for-its-own-sake — don't remove these checks on the assumption "the schema already guarantees this."

## Errors must be visible, not silently swallowed

- Browser: `console.error('[WsLangGraphAgent] server error:', ...)`.
- Python: `traceback.print_exc()` in `agent-server/main.py`'s exception handler, not just `str(err)` sent to the browser — a bare `str(err)` (e.g. `"string indices must be integers"`) is not enough to locate the failing line; the full traceback is what actually diagnosed that bug.

Any new failure path should log the same way — don't let a caught exception disappear with only a status flip or a one-line message.

## Testing convention

No automated test framework — `npm run typecheck` is the only required pre-commit gate on the TypeScript side. All functional verification is manual and browser-driven. On the Python side, there's no test framework either — verify by running the actual server and driving a real browser task, same philosophy.

## Bundling convention

`dist/` is build output only — never hand-edited, always regenerated via `npm run build`. `src/index.ts` self-initializes a `WsLangGraphAgent` + `Panel` on injection. If you add new exports to `window.MiniPageAgent`, keep the existing ones (`PageController`, `Panel`, `WsLangGraphAgent`, `agent`) rather than replacing them.

## Real bugs found during development (keep in mind before "simplifying" `PageController` or the WS bridge)

1. **`<select>` elements were unsupported** — fixed by matching requested text against `<option>` value or label.
2. **Inputs without a `placeholder` showed up with zero description** — fixed by resolving `aria-label` → `label[for]` → wrapping `<label>` before falling back to `textContent`/`placeholder`.
3. **Button-grid UIs got no grouping context**, causing a skipped required selection (a date picker) — fixed with a nearest-heading/`<legend>` fallback in `PageController.getSectionContext`.
4. **`AGENT_STEP_TOOL.params` had no declared sub-schema** — fixed by explicitly declaring `index`/`text`/`down`/`success`.
5. **A model stringified a nested `action` object** — fixed with defensive `json.loads()` in `graph.py`.
6. **A real asyncio deadlock** from awaiting the graph inline in the WS message loop — fixed by running it as a separate task.
7. **uvicorn's default WebSocket implementation rejected real browser connections** on cookie-header size — fixed by running with `--ws wsproto`.
8. **A model omitted a required top-level field (`next_goal`)** from its structured output entirely — `decision[k]` (direct subscript) crashed with `KeyError` instead of degrading gracefully. Schema `required` is a strong hint to Anthropic, not a hard guarantee, same lesson as bug 5. Fixed with `decision.get(k, "")` in `graph.py`.

All eight were caught by actually running the agent against the real demo pages, not by code review — a reminder that `PageController`'s element-description logic, the tool schema, and the WS bridge's concurrency model are the most failure-prone parts of this codebase, and any change to them should be re-verified against the full demo pages, not just a small scratch page.
