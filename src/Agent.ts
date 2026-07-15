import { PageController } from './PageController';
import { LLM } from './LLM';
import { PageAgentCore } from './PageAgentCore';
import { Panel } from './Panel';

export class Agent extends PageAgentCore {
  panel: Panel;

  constructor(pageController: PageController, llm: LLM, maxSteps = 15) {
    super(pageController, llm, maxSteps);
    this.panel = new Panel(this);
    this.panel.show();
  }
}
