import type { ElementInfo, BrowserState, ToolResult } from './types';

export class PageController {
  private interactiveElements: ElementInfo[] = [];

  private isVisible(el: Element): boolean {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private isInteractive(el: Element): boolean {
    const interactiveTags = ['a', 'button', 'input', 'textarea', 'select'];
    if (interactiveTags.includes(el.tagName.toLowerCase())) return true;
    if (el.hasAttribute('onclick')) return true;
    const role = el.getAttribute('role');
    if (role && ['button', 'link', 'checkbox', 'tab', 'menuitem'].includes(role)) return true;
    if (el.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  private buildInteractiveMap(): void {
    this.interactiveElements = [];
    let idx = 0;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (this.isInteractive(el) && this.isVisible(el)) {
        const text = (el.textContent || (el as HTMLInputElement).placeholder || '').trim().slice(0, 80);
        this.interactiveElements.push({ index: idx, tag: el.tagName.toLowerCase(), text, el });
        idx++;
      }
    }
  }

  async getBrowserState(): Promise<BrowserState> {
    this.buildInteractiveMap();
    const summary = this.interactiveElements.map(e => `[${e.index}] <${e.tag}> ${e.text}`).join('\n');
    return { url: window.location.href, title: document.title, interactiveElements: summary };
  }

  async clickElement(index: number): Promise<ToolResult> {
    const item = this.interactiveElements[index];
    if (!item) return { success: false, message: `No interactive element at index ${index}` };
    (item.el as HTMLElement).click();
    return { success: true, message: `Clicked [${index}] ${item.tag}` };
  }

  async inputText(index: number, text: string): Promise<ToolResult> {
    const item = this.interactiveElements[index];
    if (!item || !['input', 'textarea'].includes(item.tag)) {
      return { success: false, message: `No input/textarea at index ${index}` };
    }
    const el = item.el as HTMLInputElement;
    el.focus();
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, message: `Typed "${text}" into [${index}]` };
  }

  async scroll(down: boolean): Promise<ToolResult> {
    window.scrollBy(0, down ? window.innerHeight * 0.8 : -window.innerHeight * 0.8);
    return { success: true, message: `Scrolled ${down ? 'down' : 'up'}` };
  }
}
