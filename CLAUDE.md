# CLAUDE.md

Conventions and non-obvious decisions for this repo. Read before changing `src/PageAgentCore.ts`, `src/Panel.ts`, or `server/index.ts` — several of these look simplifiable but aren't.

## Reflect-before-act is mandatory

`AGENT_STEP_TOOL` (`src/tools.ts`) requires `evaluation_previous_goal`, `memory`, and `next_goal` on every step, not just `action`. Do not collapse this into a bare `{tool_name, params}` call to save tokens — these fields are what make `agent.history` (and the Panel's live feed) legible for debugging and for demonstrating failure modes. Losing them turns the transcript back into an opaque click sequence.

## Independent DOM verification always overrides the agent's self-report

`src/verify.ts`'s `buildTrustReport` must never be simplified into trusting `agentClaim.success` alone. The agent's own `success: true` is a self-report — LLMs can and do claim success when a value didn't actually stick (this happened for real during development, twice, before unrelated fixes: see "Real bugs found" below). `verdict` is `VERIFIED` only when the agent's claim *and* an independent `verifyDom` check both agree; either one failing means `NEEDS_REVIEW`. Checking only one field before trusting `VERIFIED` is not sufficient evidence — verify several fields, not one, before treating a run as trustworthy.

## The proxy exists to keep the API key off the browser — don't reintroduce a direct call

`server/index.ts` is a thin passthrough specifically so `ANTHROPIC_API_KEY` never touches client-side code. Calling `api.anthropic.com` directly from `src/LLM.ts` would require the `anthropic-dangerous-direct-browser-access` header and expose the key in devtools/network tab to any script on the page. If `LLM.ts` is ever changed to call Anthropic directly again, that's a security regression, not a simplification — route it back through the proxy.

## Plain loop, not a multi-agent graph

`PageAgentCore.#run` is a single bounded `for` loop (`maxSteps` guard), deliberately not a LangGraph-style state machine. This project has one agent taking one action at a time against one page — no branching into parallel subtasks, no agent-to-agent delegation. Don't introduce graph/orchestration structure without a concrete need a linear loop can't satisfy.

## Panel only talks to the agent through `PanelAgentAdapter`

`src/Panel.ts` imports only `PanelAgentAdapter` from `src/types.ts` — never `PageController`, `LLM`, or `tools.ts` directly. This decoupling (`status`, `history`, `task`, `execute`/`stop`/`dispose`, plus `statuschange`/`historychange`/`activity`/`dispose` events) is the same pattern alibaba/page-agent's own UI package uses to stay independent of the core agent implementation. Even though this project only has one agent implementation, keep the interface — don't have Panel reach into `PageAgentCore`'s private fields directly.

## `stop()` must stay wired through a real `AbortController`

`execute()` creates an `AbortController` per run and threads its `signal` through `LLM.invoke()` into `fetch()`. `stop()` calls `.abort()` and awaits `#runningPromise` so the caller knows the run has actually settled to `status: 'stopped'` before returning. Don't turn `stop()` into a no-op status flip that leaves the in-flight LLM call running in the background — that would silently keep burning API calls after the user thinks they've cancelled.

## Errors must be visible, not silently swallowed

The `#run` catch block calls `console.error('[PageAgentCore] step failed:', err)` before setting `status: 'error'` (and `console.warn` on hitting `maxSteps`). This was added after a real run failed silently — the Panel showed a bare `ERROR` badge with no way to see why. Any new failure path added to `PageAgentCore` should log the underlying error the same way; don't let a caught exception disappear with only a status flip.

## Testing convention

No automated test framework — `npm run typecheck` (checks both `tsconfig.json` and `server/tsconfig.json`, since they target different environments) is the only required pre-commit gate. All functional verification is manual and browser-driven per the README quickstart, including a deliberately-broken run to confirm `buildTrustReport` correctly produces `NEEDS_REVIEW`.

## Bundling convention

`dist/` is build output only — never hand-edited, always regenerated via `npm run build` before testing the bookmarklet flow. The bundle self-initializes an `Agent` and shows its `Panel` on injection (`src/index.ts`); if you add new exports to `window.MiniPageAgent`, keep the existing ones (`PageController`, `LLM`, `PageAgentCore`, `Agent`, `Panel`, `verifyDom`, `buildTrustReport`, `agent`) rather than replacing them, since console-driven use depends on all of them still being present.

## Real bugs found during development (keep in mind before "simplifying" `PageController`)

1. **`<select>` elements were unsupported** — `inputText` originally rejected any tag other than `input`/`textarea`, so the agent could never fill the demo form's business-type/state/revenue-bracket dropdowns. Fixed by matching the requested text against `<option>` value or label.
2. **Inputs without a `placeholder` showed up with zero description** — the demo form correctly uses `<label for="...">` rather than placeholders, but `PageController` only ever read `textContent`/`placeholder`. The agent was effectively guessing field identity from position alone, which caused real cross-field value drift (e.g. an address ending up in the Tax ID field). Fixed by resolving `aria-label` → `label[for]` → wrapping `<label>` before falling back to `textContent`/`placeholder`.
3. **`LLM.invoke` crashed with an unreadable `TypeError` when the response had no `tool_use` block** — `max_tokens: 1024` was tight enough that on a long-running form-fill (reflection text grows with step count, plus Sonnet 5 spends tokens on extended thinking even for simple steps), a response could get truncated before ever emitting the tool call JSON, leaving `data.content.find(...)` as `undefined` and `.input` throwing. This surfaced in the Panel as a bare `ERROR` badge with no way to tell why. Fixed by raising `max_tokens` to 2048 and throwing a descriptive error (including `stop_reason`) when no `tool_use` block is found, instead of crashing on `undefined.input`.

All three were caught by actually running the agent against the real demo form, not by code review — a reminder that `PageController`'s element-description logic and `LLM.invoke`'s response parsing are the most failure-prone parts of this codebase, and any change to either should be re-verified against the full 15-field, multi-step form, not just a small scratch page.
