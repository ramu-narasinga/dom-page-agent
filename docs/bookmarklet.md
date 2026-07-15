# Bookmarklet

Injects the built `dist/mini-page-agent.js` bundle into whatever page is currently open — no browser extension required. On injection, the bundle self-initializes an `Agent` (pointed at the local proxy on `:8787`) and shows its Panel automatically, so the input widget appears bottom-center with no console commands needed.

1. Serve the bundle: `npm run bundle-host` (serves `dist/` on `:8080`)
2. Serve the proxy: `npm run proxy` (serves `:8787`) — must be running before you click the bookmarklet, since the panel's first agent step calls it immediately.
3. Save this as a browser bookmark (paste as the URL):
```
javascript:(function(){var s=document.createElement('script');s.src='http://localhost:8080/mini-page-agent.js?cb='+Date.now();document.body.appendChild(s);})()
```
4. Open the demo app, click the bookmarklet — the panel appears bottom-center immediately. Type a task into it and press Enter.

`window.MiniPageAgent` is also exposed for console-driven use (`PageController`, `LLM`, `PageAgentCore`, `Agent`, `Panel`, `verifyDom`, `buildTrustReport`, and the auto-created `agent` instance itself).
