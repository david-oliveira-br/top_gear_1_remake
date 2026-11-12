type Child = Node | string | null | undefined | false;
/** Tiny element builder: h('div.panel', {onclick}, child, ...) */
export function h<K extends keyof HTMLElementTagNameMap = 'div'>(sel: string, props: Record<string, any> | null = null, ...kids: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const [tag, ...cls] = sel.split('.'), el = document.createElement(tag || 'div') as any;
  if (cls.length) el.className = cls.join(' ');
  if (props) for (const k in props) { if (k === 'style') Object.assign(el.style, props[k]); else if (k === 'html') el.innerHTML = props[k]; else el[k] = props[k]; }
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}
export const money = (n: number) => '$ ' + Math.round(n).toLocaleString('pt-BR');
export function clock(ticks: number) { if (!ticks) return '--:--.--'; const s = ticks / 60, m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(2).padStart(5, '0'); }
