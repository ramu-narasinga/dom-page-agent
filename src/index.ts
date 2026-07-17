import { PageController } from './PageController';
import { LLM } from './LLM';
import { PageAgentCore } from './PageAgentCore';
import { Agent } from './Agent';
import { Panel } from './Panel';
import { WsLangGraphAgent } from './ws/WsLangGraphAgent';
import { verifyDom, buildTrustReport } from './verify';

const WS_URL = 'ws://localhost:8765/agent-ws';

const existing = (window as any).MiniPageAgent;
const agent = existing?.agent ?? new WsLangGraphAgent(new PageController(), WS_URL);
if (!existing?.agent) {
  const panel = new Panel(agent);
  panel.show();
}

(window as any).MiniPageAgent = {
  PageController,
  LLM,
  PageAgentCore,
  Agent,
  Panel,
  WsLangGraphAgent,
  verifyDom,
  buildTrustReport,
  agent,
};
