import type { PageController } from './PageController';
import type { ToolResult } from './types';

export const TOOLS = new Map<string, { execute: (pc: PageController, params: any) => Promise<ToolResult> }>([
  ['click_element_by_index', { execute: (pc, p) => pc.clickElement(p.index) }],
  ['input_text', { execute: (pc, p) => pc.inputText(p.index, p.text) }],
  ['scroll', { execute: (pc, p) => pc.scroll(p.down ?? true) }],
]);

export const AGENT_STEP_TOOL = {
  name: 'agent_step',
  description: 'Reflect on the previous action, then choose exactly one next action.',
  input_schema: {
    type: 'object',
    properties: {
      evaluation_previous_goal: { type: 'string', description: 'Did the last action succeed? Why or why not.' },
      memory: { type: 'string', description: 'What you have learned so far, carried forward each step.' },
      next_goal: { type: 'string', description: 'What you are about to do and why.' },
      action: {
        type: 'object',
        properties: {
          tool_name: { type: 'string', enum: ['click_element_by_index', 'input_text', 'scroll', 'done'] },
          params: {
            type: 'object',
            properties: {
              index: {
                type: 'number',
                description: 'Required for click_element_by_index and input_text: the element index from <interactive_elements> to act on.',
              },
              text: {
                type: 'string',
                description: 'Required for input_text: the text to type, or the exact <select> option label to choose.',
              },
              down: {
                type: 'boolean',
                description: 'For scroll: true to scroll down, false to scroll up. Defaults to true if omitted.',
              },
              success: {
                type: 'boolean',
                description: 'For done: whether the task was completed successfully.',
              },
            },
          },
        },
        required: ['tool_name', 'params'],
      },
    },
    required: ['evaluation_previous_goal', 'memory', 'next_goal', 'action'],
  },
};
