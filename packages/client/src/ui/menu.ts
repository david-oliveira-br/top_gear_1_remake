import type { Nav } from '../input/input';

export interface Item {
  label: string | (() => string);
  value?: () => string;
  left?: () => void; right?: () => void; ok?: () => void;
  hidden?: () => boolean;
  /** free text field (keyboard only) */
  text?: { get: () => string; set: (v: string) => void; max: number; upper?: boolean };
}
export interface Screen {
  title: string; sub?: () => string; body?: () => string; items: Item[];
  back?: () => void; focus?: number; wide?: boolean;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const h = esc;

export class Menu {
  stack: Screen[] = [];
  hint = '';
  onSound: (kind: 'move' | 'ok' | 'back') => void = () => {};
  constructor(private el: HTMLElement) {
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement, li = t.closest('li[data-i]') as HTMLElement | null, s = this.top;
      if (!li || !s) return;
      s.focus = Number(li.dataset.i);
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (t.dataset.dir === 'l') this.nav('left'); else if (t.dataset.dir === 'r') this.nav('right');
      else { const it = this.visible(s)[s.focus]; this.nav(it?.ok || it?.text ? 'ok' : 'right'); }
    });
    el.addEventListener('input', (e) => {
      const inp = e.target as HTMLInputElement, s = this.top; if (!s || inp.tagName !== 'INPUT') return;
      const it = this.visible(s)[Number(inp.dataset.i)]; if (!it?.text) return;
      if (it.text.upper) inp.value = inp.value.toUpperCase();
      it.text.set(inp.value);
    });
  }
  get top(): Screen | undefined { return this.stack[this.stack.length - 1]; }
  get open() { return this.stack.length > 0; }
  private visible(s: Screen) { return s.items.filter((i) => !i.hidden?.()); }

  push(s: Screen) { this.stack.push(s); this.render(); }
  pop() { this.stack.pop(); this.render(); }
  reset(s?: Screen) { this.stack = s ? [s] : []; this.render(); }
  replaceTop(s: Screen) { const f = this.top?.focus; this.stack.pop(); s.focus = s.focus ?? f; this.stack.push(s); this.render(); }

  nav(n: Nav) {
    const s = this.top; if (!s) return;
    const items = this.visible(s);
    s.focus = Math.max(0, Math.min(items.length - 1, s.focus ?? 0));
    const it = items[s.focus];
    if (n === 'up' || n === 'down') { s.focus = (s.focus + (n === 'up' ? -1 : 1) + items.length) % Math.max(1, items.length); this.onSound('move'); }
    else if (n === 'left' && it?.left) { it.left(); this.onSound('move'); }
    else if (n === 'right' && it?.right) { it.right(); this.onSound('move'); }
    else if (n === 'ok' && it) {
      if (it.text) { this.render(); (this.el.querySelector(`input[data-i="${s.focus}"]`) as HTMLInputElement | null)?.focus(); return; }
      this.onSound('ok'); if (it.ok) it.ok(); else it.right?.();
    } else if (n === 'back' && s.back) { this.onSound('back'); s.back(); }
    this.render();
  }

  render() {
    const s = this.top;
    this.el.classList.toggle('open', !!s);
    if (!s) { this.el.innerHTML = ''; return; }
    const items = this.visible(s);
    s.focus = Math.max(0, Math.min(items.length - 1, s.focus ?? 0));
    const active = document.activeElement as HTMLInputElement | null;
    if (active?.tagName === 'INPUT' && this.el.contains(active)) return; // don't rebuild while typing
    const lis = items.map((it, i) => {
      const label = typeof it.label === 'function' ? it.label() : it.label;
      let val = '';
      if (it.text) val = `<input data-i="${i}" maxlength="${it.text.max}" value="${esc(it.text.get())}" spellcheck="false" autocomplete="off">`;
      else if (it.value) val = `<span class="val">${it.left ? '<b data-dir="l">‹</b>' : ''}<span>${esc(it.value())}</span>${it.right ? '<b data-dir="r">›</b>' : ''}</span>`;
      return `<li data-i="${i}" class="${i === s.focus ? 'focus' : ''}${!it.value && !it.text ? ' action' : ''}"><span class="label">${esc(label)}</span>${val}</li>`;
    }).join('');
    this.el.innerHTML = `<div class="panel${s.wide ? ' wide' : ''}"><h1>${esc(s.title)}</h1>${s.sub ? `<p class="sub">${esc(s.sub())}</p>` : ''}${s.body ? `<div class="body">${s.body()}</div>` : ''}<ul>${lis}</ul><div class="hint">${this.hint}</div></div>`;
    this.el.querySelector('li.focus')?.scrollIntoView({ block: 'nearest' });
  }
}
