# dom-page-agent

A page agent that lives inside a webpage, drives it via natural language using a text-based index of interactive elements (not screenshots), and **independently verifies** that what it claims to have done actually happened in the DOM. No browser extension, no headless browser: a bookmarklet injects a small bundled script into whatever tab is open.

## The real problem

AI coding assistants can implement or change a UI feature and claim it works. Confirming that claim currently means manually opening the browser and clicking through it yourself, every time. This project is a **UI task verifier** that happens to work by driving the page like a user would: point it at any page, give it a natural-language instruction, and get back an independently-checked verdict — `VERIFIED` or `NEEDS_REVIEW` — instead of just trusting the agent's own word.

Three demo pages (below) stand in for "features an AI just built," each exercising a different interaction shape: a long multi-field form, a multi-step wizard with grouped buttons, and a search-then-act table.

## Two agent implementations, one shared UI

This repo has **two structurally different agent backends**, both plugging into the *same* `Panel` widget through a shared `PanelAgentAdapter` contract — proof that the UI/agent decoupling is a real design choice, not decoration.

| | `PageAgentCore` (plain loop) | `WsLangGraphAgent` (LangGraph + WebSocket bridge) |
|---|---|---|
| Where the loop lives | Browser (`src/PageAgentCore.ts`) | Python server (`agent-server/graph.py`), driven by LangGraph |
| LLM call path | Browser → Node proxy (`server/`) → Anthropic | Python server → Anthropic directly |
| API key location | `server/.env` only | `agent-server/.env` (a deliberate second copy — see Tradeoffs) |
| Default on this branch's bookmarklet | Available via `MiniPageAgent.Agent` | **Auto-initialized** (`src/index.ts`) |
| Why it exists | The actual engineering solution — no more than this problem needs | Framework-breadth demonstration — LangGraph genuinely owns the multi-step loop here, not just one call |

## Architecture — plain loop

```
┌──────────────────┐        ┌──────────────────┐        ┌────────────────────┐
│  demo-app/        │  DOM   │  src/ (bundle)    │ fetch  │  server/ (proxy)    │
│  the target page  │◄──────►│  Agent + Panel    │───────►│  holds ANTHROPIC_   │
│  :3000            │        │  PageController   │        │  API_KEY, forwards  │
│                    │        │  LLM / tools      │        │  to Anthropic       │
└──────────────────┘        └──────────────────┘        └────────────────────┘
                                                                    │
                                                                    ▼
                                                          api.anthropic.com
```

- **`src/PageController.ts`** — indexes visible, interactive DOM elements only (an interactivity filter + a visibility filter), resolves each element's description via `aria-label` → `label[for]` → wrapping `<label>` → nearest section heading/`<legend>` fallback (buttons in a grid have no `<label for>` mechanism — the heading fallback exists specifically for that), exposes `click`/`inputText` (including `<select>` matching)/`scroll`.
- **`src/tools.ts`** — a tool dispatch table plus `AGENT_STEP_TOOL`: a schema that (a) forces the model to reflect (`evaluation_previous_goal`, `memory`, `next_goal`) before every action, and (b) explicitly declares `params`'s sub-fields (`index`, `text`, `down`, `success`) with descriptions, rather than leaving the model to infer the shape from prose alone.
- **`src/LLM.ts`** — calls the local proxy, never Anthropic directly. Forwards an `AbortSignal` so a run can be cancelled mid-flight. Throws a descriptive error (including `stop_reason`) if a response has no `tool_use` block, instead of crashing on `undefined.input`.
- **`src/PageAgentCore.ts`** — the bounded step loop. An `EventTarget` that fires `statuschange` / `historychange` / `activity` events and implements `PanelAgentAdapter`, so the UI never reaches into agent internals.
- **`src/Panel.ts`** — the bottom-center, **draggable** UI widget: status line, live history feed, task input, Stop button. Talks to the agent only through `PanelAgentAdapter`.
- **`src/Agent.ts`** — `PageAgentCore` + auto-constructed, auto-shown `Panel`.
- **`src/verify.ts`** — `verifyDom` independently re-reads the actual DOM after the agent claims success; `buildTrustReport` only says `VERIFIED` when the agent's self-report *and* the independent DOM check agree. **This is the actual differentiator.**
- **`server/index.ts`** — a thin Express passthrough. Holds `ANTHROPIC_API_KEY` server-side; the browser never sees it, never sends `anthropic-dangerous-direct-browser-access`.

## Architecture — LangGraph + WebSocket bridge (this branch)

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

- **`agent-server/bridge.py`** — `BrowserBridge`: correlates outgoing requests (`get_browser_state`/`execute_tool`) to the browser with their eventual responses via `request_id`-keyed `asyncio.Future`s; `stop_event` for cancellation.
- **`agent-server/graph.py`** — the LangGraph `StateGraph`: one node (`agent_step`) doing exactly what the plain loop's body does per iteration (get state → prompt → call Anthropic → act), with a conditional edge back to itself until `done`/`stopped`/`max_steps`. Calls Anthropic directly via `httpx` (own `ANTHROPIC_API_KEY`). Defensively `json.loads()`s the `action`/`params` fields if a model returns them as strings instead of nested objects (observed with `claude-haiku-4-5`).
- **`agent-server/main.py`** — the FastAPI WebSocket endpoint. Runs the graph as a **separate `asyncio.create_task`**, never awaited inline in the same loop that reads incoming messages — see Known limitations/CLAUDE.md for why this one detail is load-bearing. Rejects connections whose `Origin` header isn't `http://localhost:3000`.
- **`src/ws/WsLangGraphAgent.ts`** — the browser-side `PanelAgentAdapter` implementation: connects to the Python server, sends one `start_task`, then just answers whatever the server asks for while relaying `step_update` messages into `history` for `Panel` to render live.

## Demo pages (`demo-app/`)

- **`index.html`** — 15-field "Business License Renewal Application" (two sections, mixed input types, a conditional field, three `<select>`s). Tests: label resolution, `<select>` matching, conditional-visibility indexing.
- **`appointment-scheduling.html`** — 3-step wizard (service → date/time grid → contact details), no page reload. Tests: multi-step section visibility, disambiguating many similar-looking buttons via section-heading context.
- **`inventory-search.html`** — 16-product searchable table with per-row Restock buttons. Tests: the "index list rebuilt fresh every step" design — filtered-out rows must vanish from the agent's element list, live proof that `PageController` never uses a stale index.

## Quickstart — plain loop (3 terminals)

```bash
# terminal 1
npm run proxy          # :8787, requires server/.env with ANTHROPIC_API_KEY

# terminal 2
npm run bundle-host     # :8081

# terminal 3
npm run demo            # :3000
```
1. `cp server/.env.example server/.env` and paste in a real `ANTHROPIC_API_KEY`.
2. Add the bookmarklet from [docs/bookmarklet.md](docs/bookmarklet.md).
3. Open `http://localhost:3000` (or any of the 3 demo pages), click the bookmarklet.
4. Console: `new MiniPageAgent.Agent(new MiniPageAgent.PageController(), new MiniPageAgent.LLM('http://localhost:8787'), 30)` — the plain-loop agent isn't the auto-init default on this branch, so construct it explicitly to compare against the LangGraph path.

## Quickstart — LangGraph + WebSocket bridge (4 terminals, this branch's default)

```bash
# terminal 1
npm run proxy               # :8787 — not used by the WS path itself, but the demo/bundle scripts assume it's available

# terminal 2
npm run bundle-host          # :8081

# terminal 3
npm run demo                 # :3000

# terminal 4 (agent-server/, venv active, .env filled in)
uvicorn main:app --port 8765 --ws wsproto
```
1. `cp agent-server/.env.example agent-server/.env` and paste in a real `ANTHROPIC_API_KEY` (separate copy — see Tradeoffs).
2. The `--ws wsproto` flag is required, not optional — see Known limitations.
3. Open any demo page, click the bookmarklet — the panel appears bottom-center **automatically**, no console commands needed.
4. Type a task, press Enter. Watch Terminal 4 for LangGraph's step-by-step activity.
5. Spot-check independently: `MiniPageAgent.verifyDom('Jane Doe', '#fullName')` (check several fields, not just one).

## Project layout

```
src/                 browser bundle: PageController, tools, LLM, PageAgentCore, Panel, Agent, verify, index
src/ws/               WsLangGraphAgent.ts — the WebSocket-bridge agent implementation
server/               Express proxy holding the Anthropic key (plain-loop path)
agent-server/          FastAPI + LangGraph server (bridge.py, graph.py, main.py) — WS-bridge path
demo-app/              3 demo pages
docs/                 bookmarklet snippet + usage
dist/                 esbuild output (gitignored, regenerate with `npm run build`)
```

## Known limitations

- Single-page form only — no true multi-step *page* navigation (the bookmarklet-injected script doesn't survive a page load). Multi-step *sections within one page* (the appointment wizard) work fine.
- Proxy/WS CORS are hardcoded localhost-only allow-lists.
- No automated test suite — `npm run typecheck` is the only pre-commit gate; correctness is demonstrated by manual, reproducible browser runs.
- `stop()` only cancels the in-flight LLM network call, not an in-progress DOM tool action (those are near-instant, so there's nothing meaningful to abort there).
- **The WebSocket server must run with `uvicorn ... --ws wsproto`.** The default legacy `websockets` implementation raises `SecurityError: line too long` on a real Chrome connection once the browser's accumulated `Cookie` header for `localhost` exceeds ~8KB (cookies aren't segmented by port, so this fills up fast across many local dev projects). A raw test client without cookies won't trigger this — it only shows up against a real browser.
- **`agent-server/main.py` must run the graph as a separate task, never awaited inline** in the loop that reads incoming WebSocket messages — doing so deadlocks after one exchange, because `bridge.request()`'s pending future can only resolve once that same loop reads the next message.
- `AGENT_STEP_TOOL`'s schema is duplicated (TypeScript in `src/tools.ts`, Python in `agent-server/graph.py`) — an accepted "two sources of truth" limitation for this project's scope.
- `ANTHROPIC_API_KEY` exists in two places on this branch (`server/.env` and `agent-server/.env`) — a deliberate simplicity-over-DRY tradeoff so the Python service is self-contained.
- Model choice is a cost/speed/reliability tradeoff: `claude-haiku-4-5` has been observed stringifying nested schema fields and skipping required UI steps (see bugs below) that `claude-sonnet-5` did not reproduce.

## Real bugs found during development

1. **`<select>` elements were unsupported** — `inputText` originally rejected any tag other than `input`/`textarea`. Fixed by matching requested text against `<option>` value or label.
2. **Inputs without a `placeholder`** (using correct `<label for>` instead) **showed up with zero description**, causing real cross-field value drift (an address ending up in the Tax ID field). Fixed by resolving `aria-label` → `label[for]` → wrapping `<label>` before falling back to `textContent`/`placeholder`.
3. **`LLM.invoke` crashed with an unreadable `TypeError`** when a response had no `tool_use` block (a tight `max_tokens` truncated the response before the tool call completed). Fixed by raising `max_tokens` and throwing a descriptive error instead of crashing on `undefined.input`.
4. **Button-grid UIs (date/time pickers) got no grouping context** — the agent skipped selecting a date entirely on the appointment scheduler, because nothing told it "this group of buttons is the date picker." Fixed by walking up to the nearest preceding heading/`<legend>` and prepending it to the element's description.
5. **`AGENT_STEP_TOOL`'s `params` field had no declared sub-schema**, so a model could omit or misname required fields, failing silently as `"No interactive element at index undefined"`. Fixed by explicitly declaring `index`/`text`/`down`/`success` with descriptions.
6. **A model (observed with `claude-haiku-4-5`) stringified a nested object field** (`action`) instead of honoring the schema's object type, crashing Python with `TypeError: string indices must be integers`. Fixed with defensive `json.loads()` on both `action` and `action.params` if either is a string.
7. **A real asyncio deadlock in the WebSocket bridge**: awaiting the LangGraph run inline in the same loop that must also read incoming responses caused a total hang after one exchange. DevTools' Network panel still showed the browser's response as "sent" — a reminder that wire-level traffic is not proof the server actually processed it. Fixed by running the graph as a separate `asyncio.create_task`.
8. **`uvicorn`'s default WebSocket implementation rejected real browser connections** with `SecurityError: line too long` once Chrome's accumulated `localhost` cookie header grew past its internal line-length limit — invisible with a synthetic test client. Fixed by running with `--ws wsproto`.
9. **A model omitted a required top-level field (`next_goal`) entirely** from its structured output — direct dict subscript (`decision[k]`) crashed with `KeyError` instead of degrading gracefully. Same lesson as bug 6: schema `required` is a strong hint to Anthropic, not a hard guarantee. Fixed with `decision.get(k, "")`.

All were caught by actually running the agent against the real demo pages, not by code review.

## License

MIT — see [LICENSE](LICENSE). Design inspired by [alibaba/page-agent](https://github.com/alibaba/page-agent); DOM-processing and prompt patterns informed by the `browser-use` project, per alibaba/page-agent's own attribution.
