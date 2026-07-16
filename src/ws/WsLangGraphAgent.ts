import { PageController } from '../PageController';
import { TOOLS } from '../tools';
import type { AgentStepResult, PanelHistoryStep, AgentStatus, PanelAgentAdapter } from '../types';

export class WsLangGraphAgent extends EventTarget implements PanelAgentAdapter {
  history: PanelHistoryStep[] = [];
  task = '';
  #status: AgentStatus = 'idle';
  #ws: WebSocket | null = null;
  #resolveExecute: ((result: AgentStepResult) => void) | null = null;

  constructor(private pageController: PageController, private wsUrl = 'ws://localhost:8765/agent-ws') {
    super();
  }

  get status(): AgentStatus {
    return this.#status;
  }

  async execute(task: string): Promise<AgentStepResult> {
    this.task = task;
    this.history = [];
    this.#status = 'running';
    this.dispatchEvent(new Event('statuschange'));

    return new Promise((resolve) => {
      this.#resolveExecute = resolve;
      this.#ws = new WebSocket(this.wsUrl);
      this.#ws.onopen = () => this.#ws!.send(JSON.stringify({ type: 'start_task', task }));
      this.#ws.onmessage = (e) => this.#handleMessage(JSON.parse(e.data));
      this.#ws.onerror = () => this.#finish({ success: false, message: 'websocket error' }, 'error');
    });
  }

  async #handleMessage(msg: any): Promise<void> {
    if (msg.type === 'get_browser_state') {
      const state = await this.pageController.getBrowserState();
      this.#ws!.send(JSON.stringify({ type: 'response', request_id: msg.request_id, data: state }));
    } else if (msg.type === 'execute_tool') {
      const tool = TOOLS.get(msg.tool_name);
      const result = tool
        ? await tool.execute(this.pageController, msg.params)
        : { success: false, message: `unknown tool ${msg.tool_name}` };
      this.#ws!.send(JSON.stringify({ type: 'response', request_id: msg.request_id, data: result }));
    } else if (msg.type === 'step_update') {
      this.history.push(msg.entry);
      this.dispatchEvent(new Event('historychange'));
    } else if (msg.type === 'task_complete') {
      this.#finish(msg.result, msg.result.success ? 'completed' : 'error');
    } else if (msg.type === 'task_stopped') {
      this.#finish({ success: false, message: 'stopped by user' }, 'stopped');
    } else if (msg.type === 'task_error') {
      console.error('[WsLangGraphAgent] server error:', msg.message);
      this.#finish({ success: false, message: msg.message }, 'error');
    }
  }

  #finish(result: AgentStepResult, status: AgentStatus): void {
    this.#status = status;
    this.dispatchEvent(new Event('statuschange'));
    this.#ws?.close();
    this.#resolveExecute?.(result);
    this.#resolveExecute = null;
  }

  async stop(): Promise<void> {
    this.#ws?.send(JSON.stringify({ type: 'stop_task' }));
  }

  dispose(): void {
    this.#ws?.close();
    this.#status = 'idle';
    this.dispatchEvent(new Event('dispose'));
  }
}
