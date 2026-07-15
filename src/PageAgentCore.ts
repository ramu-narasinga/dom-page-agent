import { PageController } from './PageController';
import { LLM } from './LLM';
import { TOOLS, AGENT_STEP_TOOL } from './tools';
import type { AgentStepResult, PanelHistoryStep, AgentStatus, PanelAgentAdapter, AgentActivity } from './types';

export class PageAgentCore extends EventTarget implements PanelAgentAdapter {
  history: PanelHistoryStep[] = [];
  task = '';

  #status: AgentStatus = 'idle';
  #abortController: AbortController | null = null;
  #runningPromise: Promise<void> = Promise.resolve();

  constructor(private pageController: PageController, private llm: LLM, private maxSteps = 15) {
    super();
  }

  get status(): AgentStatus {
    return this.#status;
  }

  #setStatus(status: AgentStatus) {
    this.#status = status;
    this.dispatchEvent(new Event('statuschange'));
  }

  #emitHistoryChange() {
    this.dispatchEvent(new Event('historychange'));
  }

  #emitActivity(activity: AgentActivity) {
    this.dispatchEvent(new CustomEvent('activity', { detail: activity }));
  }

  async execute(task: string): Promise<AgentStepResult> {
    this.task = task;
    this.history = [];
    this.#abortController = new AbortController();
    this.#setStatus('running');
    this.#emitHistoryChange();

    const run = this.#run(task, this.#abortController.signal);
    this.#runningPromise = run.then(() => undefined);
    return run;
  }

  async stop(): Promise<void> {
    this.#abortController?.abort();
    await this.#runningPromise;
  }

  dispose(): void {
    this.#abortController?.abort();
    this.#setStatus('idle');
    this.dispatchEvent(new Event('dispose'));
  }

  async #run(task: string, signal: AbortSignal): Promise<AgentStepResult> {
    try {
      for (let step = 0; step < this.maxSteps; step++) {
        this.#emitActivity({ type: 'thinking' });
        const state = await this.pageController.getBrowserState();
        const prompt = this.buildPrompt(task, state);
        const { evaluation_previous_goal, memory, next_goal, action } = await this.llm.invoke(
          this.systemPrompt(),
          prompt,
          AGENT_STEP_TOOL,
          signal
        );

        if (action.tool_name === 'done') {
          this.history.push({
            type: 'step',
            stepIndex: step,
            reflection: { evaluation_previous_goal, memory, next_goal },
            action: { name: 'done', input: action.params, output: 'done' },
          });
          this.#emitHistoryChange();
          const result = { success: action.params.success !== false, message: String(action.params.text ?? '') };
          this.#setStatus('completed');
          return result;
        }

        this.#emitActivity({ type: 'executing', tool: action.tool_name });
        const tool = TOOLS.get(action.tool_name);
        const output = tool
          ? await tool.execute(this.pageController, action.params)
          : { success: false, message: `unknown tool ${action.tool_name}` };
        this.#emitActivity({ type: 'executed', tool: action.tool_name, output: output.message });

        this.history.push({
          type: 'step',
          stepIndex: step,
          reflection: { evaluation_previous_goal, memory, next_goal },
          action: { name: action.tool_name, input: action.params, output: output.message },
        });
        this.#emitHistoryChange();
      }
      console.warn('[PageAgentCore] max steps reached without a done action');
      this.#setStatus('error');
      return { success: false, message: 'max steps reached' };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.#setStatus('stopped');
        return { success: false, message: 'stopped by user' };
      }
      console.error('[PageAgentCore] step failed:', err);
      this.#emitActivity({ type: 'error', message: String(err) });
      this.#setStatus('error');
      return { success: false, message: String(err) };
    }
  }

  private buildPrompt(task: string, state: Awaited<ReturnType<PageController['getBrowserState']>>) {
    return `<user_request>${task}</user_request>
<current_url>${state.url}</current_url>
<interactive_elements>
${state.interactiveElements}
</interactive_elements>
<history>
${this.history.map(h => `Step ${h.stepIndex}: ${h.action?.name}(${JSON.stringify(h.action?.input)}) -> ${h.action?.output}`).join('\n')}
</history>`;
  }

  private systemPrompt() {
    return `You are a browser automation agent. You control a webpage by referencing interactive elements by their index number, shown in <interactive_elements>. For a <select> element, the option labels are listed after its index (e.g. "[6] <select> Select one / California / New York") — use input_text with the exact option label text to choose it; do not click_element_by_index on a select, that only opens the native dropdown and cannot be interacted with further. Before each action: evaluate whether your previous action succeeded, note what you've learned, and state your next goal. Then choose exactly one action: click_element_by_index, input_text, scroll, or done.`;
  }
}
