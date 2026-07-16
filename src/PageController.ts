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

  private getLabelText(el: Element): string {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    const id = el.getAttribute('id');
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label?.textContent) return label.textContent.trim();
    }
    const wrappingLabel = el.closest('label');
    if (wrappingLabel?.textContent) return wrappingLabel.textContent.trim();
    return '';
  }

  // Buttons/grouped controls have no <label for> mechanism, so a human visually reads
  // a nearby heading ("Choose a date") to know what a group of similar-looking buttons
  // means — the flat interactive-elements list strips that out entirely otherwise.
  private getSectionContext(el: Element): string {
    const fieldset = el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector(':scope > legend');
      if (legend?.textContent) return legend.textContent.trim();
    }
    let container: Element | null = el.parentElement;
    while (container && container !== document.body) {
      let sibling = container.previousElementSibling;
      while (sibling) {
        if (/^H[1-6]$/.test(sibling.tagName) && sibling.textContent) {
          return sibling.textContent.trim();
        }
        sibling = sibling.previousElementSibling;
      }
      container = container.parentElement;
    }
    return '';
  }

  private buildInteractiveMap(): void {
    this.interactiveElements = [];
    let idx = 0;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (this.isInteractive(el) && this.isVisible(el)) {
        const tag = el.tagName.toLowerCase();
        let text: string;
        if (tag === 'select') {
          text = Array.from((el as HTMLSelectElement).options)
            .map(o => o.textContent?.trim())
            .filter(Boolean)
            .join(' / ')
            .slice(0, 120);
        } else {
          const label = this.getLabelText(el);
          const fallback = (el.textContent || (el as HTMLInputElement).placeholder || '').trim();
          text = (label || fallback).slice(0, 80);
        }
        const context = this.getSectionContext(el);
        if (context && !text.includes(context)) {
          text = `${context} — ${text}`.slice(0, 140);
        }
        this.interactiveElements.push({ index: idx, tag, text, el });
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
    if (!item) return { success: false, message: `No interactive element at index ${index}` };

    if (item.tag === 'select') {
      const selectEl = item.el as HTMLSelectElement;
      const match = Array.from(selectEl.options).find(
        opt =>
          opt.value.toLowerCase() === text.toLowerCase() ||
          opt.textContent?.trim().toLowerCase() === text.toLowerCase()
      );
      if (!match) return { success: false, message: `No option matching "${text}" in select [${index}]` };
      selectEl.value = match.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, message: `Selected "${match.textContent?.trim()}" in [${index}]` };
    }

    if (!['input', 'textarea'].includes(item.tag)) {
      return { success: false, message: `No input/textarea/select at index ${index}` };
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
