# dom-page-agent

A from-scratch, simplified clone of [alibaba/page-agent](https://github.com/alibaba/page-agent) — an agent that lives inside a webpage and drives it via natural language, using a text-based index of interactive elements instead of screenshots. No browser extension, no headless browser: a bookmarklet injects a small bundled script into whatever tab is open. The multi-step agent loop is driven by **LangGraph** in a Python server, reached over a WebSocket bridge from the browser.

## The problem

Repetitive UI tasks — filling out long forms, working through a multi-step booking flow, searching a table and acting on one specific row — are tedious to do by hand, every single time. Existing automation approaches either hardcode brittle selectors per page (breaks the moment the page changes) or rely on screenshots and pixel coordinates (expensive, imprecise, and still brittle across screen sizes/zoom levels).

This project is a general primitive instead: read *any* page as a small, LLM-friendly index of interactive elements, let a real multi-step agent loop reason over that index step by step (not a single "do this" API call), and act through the same handful of tools — click, type, scroll — regardless of what the page actually is. The three demo pages (below) are deliberately different shapes (a long form, a multi-step wizard, a search-then-act table) specifically to prove the same small primitive generalizes across all of them, rather than being tuned to one.

## Architecture

```
┌──────────────────┐  DOM   ┌─────────────────────┐  WebSocket   ┌───────────────────────┐
│  demo-app/        │◄──────►│ src/ws/              │◄────────────►│ agent-server/ (Python) │
│  the target page   │        │ WsLangGraphAgent.ts  │  ws://:8765  │ FastAPI + LangGraph    │
│  :3000             │        │ + Panel (shared UI)  │              │ StateGraph, one node   │
└──────────────────┘        └─────────────────────┘              │ agent_step, conditional │
                                                                    │ self-loop edge          │
                                                                    └───────────────────────┘
                                                                              │ fetch (httpx)
                                                                              ▼
                                                                    api.anthropic.com
```

The DOM actions (click/type/scroll) can only happen in the browser, so for LangGraph to genuinely *own* the multi-step loop (not just decide one action per HTTP call), the graph node reaches back into the browser over a live WebSocket connection every time it needs the current DOM state or a tool executed, and awaits that response before continuing.

- **`src/PageController.ts`** — indexes visible, interactive DOM elements only (an interactivity filter + a visibility filter), resolves each element's description via `aria-label` → `label[for]` → wrapping `<label>` → nearest section heading/`<legend>` fallback (buttons in a grid have no `<label for>` mechanism — the heading fallback exists specifically for that), exposes `click`/`inputText` (including `<select>` matching)/`scroll`.
- **`src/tools.ts`** — `TOOLS`, the tool dispatch table (`click_element_by_index`/`input_text`/`scroll`) that `WsLangGraphAgent` calls when the Python server asks it to execute a tool.
- **`src/types.ts`** — shared shapes, notably `PanelAgentAdapter`: the contract that decouples `Panel` from any specific agent implementation.
- **`src/Panel.ts`** — the bottom-center, **draggable** UI widget: status line, live history feed, task input, Stop button. Talks to the agent only through `PanelAgentAdapter` — never reaches into `PageController` or anything WebSocket-specific directly.
- **`src/ws/WsLangGraphAgent.ts`** — the browser-side `PanelAgentAdapter` implementation: connects to the Python server, sends one `start_task`, then just answers whatever the server asks for (`get_browser_state`/`execute_tool`) while relaying `step_update` messages into `history` for `Panel` to render live.
- **`agent-server/bridge.py`** — `BrowserBridge`: correlates outgoing requests to the browser (`get_browser_state`/`execute_tool`) with their eventual responses via `request_id`-keyed `asyncio.Future`s; `stop_event` for cancellation.
- **`agent-server/graph.py`** — the LangGraph `StateGraph`: one node (`agent_step`) doing get-state → prompt → call Anthropic → act, with a conditional edge back to itself until `done`/`stopped`/`max_steps`. Calls Anthropic directly via `httpx` (own `ANTHROPIC_API_KEY`). Defensively `json.loads()`s/`.get()`s model output fields that occasionally come back as strings or missing entirely instead of matching the declared schema (observed with `claude-haiku-4-5`).
- **`agent-server/main.py`** — the FastAPI WebSocket endpoint. Runs the graph as a **separate `asyncio.create_task`**, never awaited inline in the same loop that reads incoming messages (see Known limitations for why this one detail is load-bearing). Rejects connections whose `Origin` header isn't in `ALLOWED_ORIGIN` (env-configurable, comma-separated, defaults to `http://localhost:3000`).

## Demo pages (`demo-app/`)

- **`index.html`** — 15-field "Business License Renewal Application" (two sections, mixed input types, a conditional field, three `<select>`s). Tests: label resolution, `<select>` matching, conditional-visibility indexing.
- **`appointment-scheduling.html`** — 3-step wizard (service → date/time grid → contact details), no page reload. Tests: multi-step section visibility, disambiguating many similar-looking buttons via section-heading context.
- **`inventory-search.html`** — 16-product searchable table with per-row Restock buttons. Tests: the "index list rebuilt fresh every step" design — filtered-out rows must vanish from the agent's element list, live proof that `PageController` never uses a stale index.

## Quickstart (3 terminals)

```bash
# terminal 1
npm run bundle-host     # :8081

# terminal 2
npm run demo             # :3000

# terminal 3 (agent-server/, venv active, .env filled in)
uvicorn main:app --port 8765 --ws wsproto
```
1. `cp agent-server/.env.example agent-server/.env` and paste in a real `ANTHROPIC_API_KEY`.
2. The `--ws wsproto` flag is required, not optional — see Known limitations.
3. Add the bookmarklet from [docs/bookmarklet.md](docs/bookmarklet.md).
4. Open any demo page, click the bookmarklet — the panel appears bottom-center **automatically**, no console commands needed.
5. Type a task, press Enter. Watch Terminal 3 for LangGraph's step-by-step activity, and the demo page for the actual DOM changes as they happen.

## Project layout

```
src/                 browser bundle: PageController, tools, Panel, index
src/ws/               WsLangGraphAgent.ts — the WebSocket-bridge agent implementation
agent-server/          FastAPI + LangGraph server (bridge.py, graph.py, main.py)
demo-app/              3 demo pages
docs/                 bookmarklet snippet + usage
dist/                 esbuild output (gitignored, regenerate with `npm run build`)
```

## Known limitations

- **No independent verification layer.** The agent's `done` report (`success`/`message`) is a self-report — nothing automatically re-checks the DOM against it. An earlier version of this project included a `verify.ts` (`verifyDom`/`buildTrustReport`) that was never actually wired into the automated loop — only reachable manually via console — and was removed rather than kept as an unused, misleading appendage. If this needs to exist, it should check the agent's own recorded actions against live DOM state (not ask the agent to grade itself), not just be resurrected as decoration.
- Single-page form only — no true multi-step *page* navigation (the bookmarklet-injected script doesn't survive a page load). Multi-step *sections within one page* (the appointment wizard) work fine.
- WS `Origin` allowlist is env-configurable but still a manual allowlist, not a general CORS policy.
- No automated test suite — `npm run typecheck` is the only pre-commit gate; correctness is demonstrated by manual, reproducible browser runs.
- `Stop` only cancels the in-flight LLM call, not an in-progress DOM tool action (those are near-instant, so there's nothing meaningful to abort there).
- **The WebSocket server must run with `uvicorn ... --ws wsproto`.** The default legacy `websockets` implementation raises `SecurityError: line too long` on a real Chrome connection once the browser's accumulated `Cookie` header for `localhost` exceeds ~8KB (cookies aren't segmented by port, so this fills up fast across many local dev projects). A raw test client without cookies won't trigger this — it only shows up against a real browser.
- **`agent-server/main.py` must run the graph as a separate task, never awaited inline** in the loop that reads incoming WebSocket messages — doing so deadlocks after one exchange, because `bridge.request()`'s pending future can only resolve once that same loop reads the next message.
- No resumability across a server restart — LangGraph's checkpointer feature would persist `AgentState` across restarts, but the harder unsolved part is re-associating a resumed `thread_id` with a *new* physical WebSocket connection after the browser reconnects, plus non-idempotent tool replay risk (e.g. a "Submit" click firing twice) if a crash happens mid-node. Not implemented — noted here as a real, understood gap, not an oversight.
- Model choice is a cost/speed/reliability tradeoff: `claude-haiku-4-5` has been observed omitting/stringifying required schema fields that `claude-sonnet-5` did not reproduce in the same testing.

## Real bugs found during development

1. **`<select>` elements were unsupported** — `inputText` originally rejected any tag other than `input`/`textarea`. Fixed by matching requested text against `<option>` value or label.
2. **Inputs without a `placeholder`** (using correct `<label for>` instead) **showed up with zero description**, causing real cross-field value drift (an address ending up in the Tax ID field). Fixed by resolving `aria-label` → `label[for]` → wrapping `<label>` before falling back to `textContent`/`placeholder`. (This drift is exactly the kind of thing an independent verification layer would have caught mechanically — currently it's only catchable by manually inspecting the page, a real tradeoff of removing that layer, see Known limitations.)
3. **Button-grid UIs (date/time pickers) got no grouping context** — the agent skipped selecting a date entirely on the appointment scheduler, because nothing told it "this group of buttons is the date picker." Fixed by walking up to the nearest preceding heading/`<legend>` and prepending it to the element's description.
4. **The tool schema's `params` field had no declared sub-schema**, so a model could omit or misname required fields, failing silently as `"No interactive element at index undefined"`. Fixed by explicitly declaring `index`/`text`/`down`/`success` with descriptions.
5. **A model (observed with `claude-haiku-4-5`) stringified a nested object field** (`action`) instead of honoring the schema's object type, crashing Python with `TypeError: string indices must be integers`. Fixed with defensive `json.loads()` on both `action` and `action.params` if either is a string.
6. **A real asyncio deadlock in the WebSocket bridge**: awaiting the LangGraph run inline in the same loop that must also read incoming responses caused a total hang after one exchange. DevTools' Network panel still showed the browser's response as "sent" — a reminder that wire-level traffic is not proof the server actually processed it. Fixed by running the graph as a separate `asyncio.create_task`.
7. **`uvicorn`'s default WebSocket implementation rejected real browser connections** with `SecurityError: line too long` once Chrome's accumulated `localhost` cookie header grew past its internal line-length limit — invisible with a synthetic test client. Fixed by running with `--ws wsproto`.
8. **A model omitted a required top-level field (`next_goal`) entirely** from its structured output — direct dict subscript (`decision[k]`) crashed with `KeyError` instead of degrading gracefully. Same lesson as bug 5: schema `required` is a strong hint to Anthropic, not a hard guarantee. Fixed with `decision.get(k, "")`.

All were caught by actually running the agent against the real demo pages, not by code review.

## License

MIT — see [LICENSE](LICENSE). Design inspired by [alibaba/page-agent](https://github.com/alibaba/page-agent); DOM-processing and prompt patterns informed by the `browser-use` project, per alibaba/page-agent's own attribution.
