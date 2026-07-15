# dom-page-agent

A from-scratch, simplified clone of [alibaba/page-agent](https://github.com/alibaba/page-agent) — an AI agent that lives inside a webpage and drives it via natural language, using a text-based index of interactive elements instead of screenshots. No browser extension, no headless browser: a bookmarklet injects a small bundled script into whatever tab is open.

## The problem

Filling out long, repetitive multi-field forms (business/government renewal forms, enterprise onboarding forms) is tedious and error-prone — you re-type the same kind of information across a dozen fields, selects, and checkboxes. This project proves that a natural-language instruction can drive that entire process, while independently checking that the agent's self-reported success actually matches what landed in the DOM.

## Architecture

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

- **`src/PageController.ts`** — indexes visible, interactive DOM elements (buttons, inputs, selects, links, ARIA roles), extracts each one's associated `<label>` text so the model actually knows what a field is for, and exposes `click`/`inputText` (including `<select>` support)/`scroll`.
- **`src/tools.ts`** — a tool dispatch table plus `AGENT_STEP_TOOL`, a schema that forces the model to reflect (`evaluation_previous_goal`, `memory`, `next_goal`) before every action, not just emit a bare tool call.
- **`src/LLM.ts`** — calls the local proxy, never Anthropic directly. Forwards an `AbortSignal` so a run can be cancelled mid-flight.
- **`src/PageAgentCore.ts`** — the bounded step loop. An `EventTarget` that fires `statuschange` / `historychange` / `activity` events and implements `PanelAgentAdapter`, so the UI never reaches into agent internals.
- **`src/Panel.ts`** — the bottom-center UI widget: status line, live history feed, task input, Stop button. Talks to the agent only through `PanelAgentAdapter`.
- **`src/Agent.ts`** — `PageAgentCore` + auto-constructed, auto-shown `Panel`. The bundle self-initializes one of these on injection (see `src/index.ts`), so clicking the bookmarklet alone makes the input widget appear — no console commands required.
- **`src/verify.ts`** — `verifyDom` independently re-reads the actual DOM after the agent claims success; `buildTrustReport` only says `VERIFIED` when the agent's self-report *and* the independent DOM check agree.
- **`server/index.ts`** — a thin Express passthrough. Holds `ANTHROPIC_API_KEY` server-side; the browser never sees it, never sends `anthropic-dangerous-direct-browser-access`.
- **`demo-app/`** — a 15-field "Business License Renewal Application" (two sections, mixed input types, a conditional field, three `<select>`s) — deliberately tedious, to make the natural-language win obvious.

## Quickstart (manual, 3 terminals — recommended so you can watch each service's logs live)

**Terminal 1 — proxy**
```bash
npm run proxy
```
**Terminal 2 — bundle host**
```bash
npm run bundle-host
```
**Terminal 3 — demo app**
```bash
npm run demo
```

Then:
1. `cp server/.env.example server/.env` and paste in a real `ANTHROPIC_API_KEY`.
2. Add the bookmarklet from [docs/bookmarklet.md](docs/bookmarklet.md) to your bookmarks bar.
3. Open `http://localhost:3000`, click the bookmarklet — the panel appears bottom-center automatically.
4. Type a task (e.g. *"Fill out this business license renewal for Jane Doe, Doe Consulting LLC, LLC, 123 Main St, Springfield, CA 62704..."*) and press Enter.
5. Watch status (`THINKING…` → `RUNNING: ...` → `COMPLETED`) and the live history feed. Click **Stop** to cancel mid-run.
6. Spot-check the result independently in devtools console: `MiniPageAgent.verifyDom('Jane Doe', '#fullName')`.

Console-driven use is still available underneath the panel — `window.MiniPageAgent` exposes `PageController`, `LLM`, `PageAgentCore`, `Agent`, `Panel`, `verifyDom`, `buildTrustReport`, and the auto-created `agent` instance.

## Project layout

```
src/            browser bundle (PageController, tools, LLM, PageAgentCore, Panel, Agent, verify, index)
server/         Express proxy holding the Anthropic key
demo-app/       the 15-field demo form
docs/           bookmarklet snippet + usage
dist/           esbuild output (gitignored, regenerate with `npm run build`)
```

## Known limitations

- Single-page form only — no true multi-step page navigation (the bookmarklet-injected script doesn't survive a page load).
- Proxy CORS is a hardcoded localhost-only allow-list.
- No automated test suite — `npm run typecheck` is the only pre-commit gate; correctness is demonstrated by manual, reproducible browser runs (see [CLAUDE.md](CLAUDE.md)).
- `stop()` only cancels the in-flight LLM network call, not an in-progress DOM tool action (those are near-instant, so there's nothing meaningful to abort there).
- When a step throws (network error, bad proxy response), the panel shows a bare `ERROR` status — the actual error message currently only prints via `console.error` in devtools, not inline in the panel UI.
- Model choice (`claude-sonnet-5` by default) is a cost/speed tradeoff left to the operator via `ANTHROPIC_MODEL` in `server/.env`.

Two real bugs were found and fixed while building this (worth knowing about, not just theoretical failure modes): `PageController.inputText` originally didn't support `<select>` elements at all, and elements without a `placeholder` (using `<label for>` instead, the correct HTML pattern) showed up in the agent's element list with **no description at all** — both caused real field-mapping errors during testing before being fixed.

## License

MIT — see [LICENSE](LICENSE). Design inspired by [alibaba/page-agent](https://github.com/alibaba/page-agent); DOM-processing and prompt patterns informed by the `browser-use` project, per alibaba/page-agent's own attribution.
