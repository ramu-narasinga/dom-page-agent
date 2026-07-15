import { PageController } from './PageController';
import { LLM } from './LLM';
import { PageAgentCore } from './PageAgentCore';
import { Agent } from './Agent';
import { Panel } from './Panel';
import { verifyDom, buildTrustReport } from './verify';

const PROXY_BASE_URL = 'http://localhost:8787';

const existing = (window as any).MiniPageAgent;
const agent = existing?.agent ?? new Agent(new PageController(), new LLM(PROXY_BASE_URL), 30);

(window as any).MiniPageAgent = {
  PageController,
  LLM,
  PageAgentCore,
  Agent,
  Panel,
  verifyDom,
  buildTrustReport,
  agent,
};
