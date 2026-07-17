# Bookmarklet (langgraph branch)

Injects the built `dist/mini-page-agent.js` bundle into whatever page is currently open — no browser extension required. On this branch, injection self-initializes a `WsLangGraphAgent` (connecting to the Python LangGraph server on `ws://localhost:8765/agent-ws`) and shows its Panel automatically, so the input widget appears bottom-center with no console commands needed. The Node proxy (`:8787`) is **not** required for this flow — the Python service holds its own `ANTHROPIC_API_KEY` and calls Anthropic directly.

1. Serve the bundle: `npm run bundle-host` (serves `dist/` on `:8081`)
2. Start the LangGraph server: from `agent-server/` (venv active, `.env` filled in), `uvicorn main:app --port 8765 --ws wsproto` — the `--ws wsproto` flag matters: uvicorn's default legacy `websockets` implementation can reject real browser connections with `SecurityError: line too long` once Chrome's accumulated `localhost` cookie header grows past ~8KB (cookies aren't segmented by port, so this fills up fast across many local dev projects). `wsproto` doesn't have this ceiling.
3. Serve the demo app: `npm run demo` (`:3000`)
4. Save this as a browser bookmark (paste as the URL):
```
javascript:(function(){var s=document.createElement('script');s.src='http://localhost:8081/mini-page-agent.js?cb='+Date.now();document.body.appendChild(s);})()
```
5. Open the demo app, click the bookmarklet — the panel appears bottom-center immediately. Type a task into it and press Enter.

Note: `window.MiniPageAgent` caches the auto-created `agent` across repeated bookmarklet clicks in the same tab (so clicking twice doesn't spawn duplicate panels) — if you change server-side code and want a clean retry, reload the page first, then click the bookmarklet again, rather than just re-clicking without reloading.

`window.MiniPageAgent` also exposes `PageController`, `LLM`, `PageAgentCore`, `Agent` (the original Node-proxy-based plain loop from `main`, still available here for comparison), `Panel`, `WsLangGraphAgent`, `verifyDom`, and `buildTrustReport` for console-driven use.
