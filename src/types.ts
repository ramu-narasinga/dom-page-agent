export interface ElementInfo {
  index: number;
  tag: string;
  text: string;
  el: Element;
}

export interface BrowserState {
  url: string;
  title: string;
  interactiveElements: string; // formatted "[0] <tag> text" lines, one per element
}

export interface ToolResult {
  success: boolean;
  message: string;
}

export interface AgentStepResult {
  success: boolean;
  message: string;
}

export interface PanelHistoryStep {
  type: 'step';
  stepIndex: number;
  reflection?: {
    evaluation_previous_goal?: string;
    memory?: string;
    next_goal?: string;
  };
  action?: {
    name: string;
    input: unknown;
    output: string;
  };
}

export type AgentStatus = 'idle' | 'running' | 'completed' | 'error' | 'stopped';

export interface PanelAgentAdapter extends EventTarget {
  readonly status: AgentStatus;
  readonly history: readonly PanelHistoryStep[];
  readonly task: string;
  execute(task: string): Promise<AgentStepResult>;
  stop(): Promise<void>;
  dispose(): void;
}
