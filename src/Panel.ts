import type { PanelAgentAdapter } from './types';

export class Panel {
  #wrapper: HTMLElement;
  #statusText: HTMLElement;
  #historySection: HTMLElement;
  #inputSection: HTMLElement;
  #taskInput: HTMLInputElement;
  #stopBtn: HTMLButtonElement;
  #agent: PanelAgentAdapter;

  constructor(agent: PanelAgentAdapter) {
    this.#agent = agent;
    this.#wrapper = this.#createWrapper();
    this.#statusText = this.#wrapper.querySelector('[data-status-text]')!;
    this.#historySection = this.#wrapper.querySelector('[data-history-section]')!;
    this.#inputSection = this.#wrapper.querySelector('[data-input-section]')!;
    this.#taskInput = this.#wrapper.querySelector('[data-task-input]')!;
    this.#stopBtn = this.#wrapper.querySelector('[data-stop-btn]')!;

    this.#agent.addEventListener('statuschange', () => this.#handleStatusChange());
    this.#agent.addEventListener('historychange', () => this.#renderHistory());
    this.#agent.addEventListener('activity', (e) => this.#handleActivity((e as CustomEvent).detail));
    this.#agent.addEventListener('dispose', () => this.dispose());

    this.#setupEventListeners();
    this.#handleStatusChange();
  }

  #createWrapper(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.id = 'mini-page-agent-panel';
    wrapper.style.cssText = `
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      width: 420px; max-height: 320px; background: white; border: 1px solid #ccc;
      border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      font-family: system-ui, sans-serif; z-index: 2147483647; overflow: hidden;
    `;
    wrapper.innerHTML = `
      <div style="padding: 10px 12px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 600; font-size: 13px;" data-status-text>IDLE</span>
        <button data-stop-btn style="display:none; background:#c0392b; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:12px; cursor:pointer;">Stop</button>
      </div>
      <div data-history-section style="padding: 10px 12px; max-height: 200px; overflow-y: auto; font-size: 12.5px;">
        <div style="color: #888;">Type a task below to get started.</div>
      </div>
      <div data-input-section style="padding: 10px 12px; border-top: 1px solid #eee;">
        <input data-task-input type="text" placeholder="e.g. Fill out this form for Jane Doe..."
          style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; font-size: 13px;" />
      </div>
    `;
    document.body.appendChild(wrapper);
    return wrapper;
  }

  #setupEventListeners(): void {
    this.#taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.#taskInput.value.trim()) this.#submitTask();
    });
    this.#stopBtn.addEventListener('click', () => this.#agent.stop());
  }

  #handleStatusChange(): void {
    this.#statusText.textContent = this.#agent.status.toUpperCase();
    const running = this.#agent.status === 'running';
    this.#stopBtn.style.display = running ? 'inline-block' : 'none';
    this.#inputSection.style.display = running ? 'none' : 'block';
    if (!running) this.#taskInput.focus();
  }

  #handleActivity(activity: any): void {
    if (activity.type === 'thinking') this.#statusText.textContent = 'THINKING…';
    else if (activity.type === 'executing') this.#statusText.textContent = `RUNNING: ${activity.tool}`;
    else if (activity.type === 'executed') this.#statusText.textContent = 'RUNNING…';
    else if (activity.type === 'error') this.#statusText.textContent = 'ERROR';
  }

  #renderHistory(): void {
    const task = this.#agent.task;
    const taskCard = task
      ? `<div style="margin-bottom:8px; font-weight:600;">Task: ${task}</div>`
      : '';
    const items = this.#agent.history
      .map(
        (entry) => `
      <div style="margin-bottom: 6px; padding: 6px 8px; background: #f5f5f5; border-radius: 6px;">
        <div style="font-weight: 600;">Step ${entry.stepIndex}: ${entry.action?.name}</div>
        ${entry.reflection?.next_goal ? `<div style="color:#666; font-size:11.5px;">${entry.reflection.next_goal}</div>` : ''}
        <div style="color:#333; font-size:11.5px;">${entry.action?.output ?? ''}</div>
      </div>`
      )
      .join('');
    this.#historySection.innerHTML = taskCard + (items || '<div style="color:#888;">No steps yet.</div>');
    this.#historySection.scrollTop = this.#historySection.scrollHeight;
  }

  #submitTask(): void {
    const task = this.#taskInput.value.trim();
    if (!task) return;
    this.#taskInput.value = '';
    this.#agent.execute(task);
  }

  show(): void {
    this.#wrapper.style.display = 'block';
  }

  hide(): void {
    this.#wrapper.style.display = 'none';
  }

  dispose(): void {
    this.#wrapper.remove();
  }
}
