import type { PageController } from './PageController';
import type { ToolResult } from './types';

export const TOOLS = new Map<string, { execute: (pc: PageController, params: any) => Promise<ToolResult> }>([
  ['click_element_by_index', { execute: (pc, p) => pc.clickElement(p.index) }],
  ['input_text', { execute: (pc, p) => pc.inputText(p.index, p.text) }],
  ['scroll', { execute: (pc, p) => pc.scroll(p.down ?? true) }],
]);
