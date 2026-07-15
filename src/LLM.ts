import type { AgentStepDecision } from './types';

export class LLM {
  constructor(private proxyBaseUrl: string, private model = 'claude-sonnet-5') {}

  async invoke(systemPrompt: string, userPrompt: string, toolDef: any, signal?: AbortSignal): Promise<AgentStepDecision> {
    const res = await fetch(`${this.proxyBaseUrl}/agent-step`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        tools: [toolDef],
        tool_choice: { type: 'tool', name: 'agent_step' },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Proxy error: ${JSON.stringify(data)}`);
    const toolUse = data.content.find((b: any) => b.type === 'tool_use');
    if (!toolUse) {
      throw new Error(
        `No tool_use block in response (stop_reason: ${data.stop_reason}). Response was likely truncated by max_tokens before completing the tool call.`
      );
    }
    return toolUse.input as AgentStepDecision;
  }
}
