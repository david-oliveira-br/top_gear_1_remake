import type { Input } from '../../../shared/src/index';

export type Device = { kind: 'any' } | { kind: 'kb'; layout: 'both' | 'wasd' | 'arrows' } | { kind: 'pad'; index: number };
export type PadAction = 'throttle' | 'brake' | 'nitro' | 'up' | 'down' | 'pause';
export type Nav = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'pause';
export interface PlayerInput extends Input { pause: boolean }

export const PAD_ACTIONS: { id: PadAction; label: string }[] = [
  { id: 'throttle', label: 'Accelerate' }, { id: 'brake', label: 'Brake' }, { id: 'nitro', label: 'Nitro' },
  { id: 'up', label: 'Shift up' }, { id: 'down', label: 'Shift down' }, { id: 'pause', label: 'Pause' },
];
const DEFAULT_BIND: Record<PadAction, number> = { throttle: 7, brake: 6, nitro: 0, up: 5, down: 4, pause: 9 };
const XBOX = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home'];
const PS = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'PS'];
const DEAD = 0.14;

export class InputManager {
  keys = new Set<string>();
  bind: Record<PadAction, number> = { ...DEFAULT_BIND };
  /** called on first key/mouse gesture (needed to unlock audio) */
  onGesture: () => void = () => {};
  private navQueue: Nav[] = [];
  private held = new Map<string, number>();
  private capture: ((button: number) => void) | null = null;
  private prevButtons = new Map<number, boolean[]>();

  constructor() {
    try { Object.assign(this.bind, JSON.parse(localStorage.getItem('rc_bind') || '{}')); } catch { /* ignore */ }
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') { if (e.code === 'Enter' || e.code === 'Escape') (e.target as HTMLElement).blur(); return; }
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.onGesture();
      if (!e.repeat || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) {
        const nav = ({ ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Enter: 'ok', Space: 'ok', Escape: 'back', Backspace: 'back', KeyP: 'pause' } as Record<string, Nav>)[e.code];
        if (nav) this.navQueue.push(nav);
      }
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('pointerdown', () => this.onGesture());
  }

  pads(): Gamepad[] { return (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p && p.connected); }
  pad(index: number): Gamepad | undefined { return this.pads()[index]; }
  isPlayStation(p?: Gamepad) { return !!p && /054c|dualshock|dualsense|playstation|wireless controller/i.test(p.id); }
  glyph(button: number, p: Gamepad | undefined = this.pads()[0]) { return (this.isPlayStation(p) ? PS : XBOX)[button] ?? 'B' + button; }
  padName(p: Gamepad) { return this.isPlayStation(p) ? 'PlayStation controller' : /xbox|xinput|045e/i.test(p.id) ? 'Xbox controller' : p.id.slice(0, 28); }

  saveBind() { localStorage.setItem('rc_bind', JSON.stringify(this.bind)); }
  resetBind() { this.bind = { ...DEFAULT_BIND }; this.saveBind(); }
  /** Next pad button press is delivered to cb instead of the menus. */
  captureButton(cb: (button: number) => void) { this.capture = cb; }

  /** Call once per frame: turns pad state into menu navigation events. */
  poll(now: number): Nav[] {
    const pads = this.pads();
    pads.forEach((p) => {
      const prev = this.prevButtons.get(p.index) ?? [];
      const cur = p.buttons.map((b) => b.pressed || b.value > 0.5);
      if (this.capture) {
        const i = cur.findIndex((v, k) => v && !prev[k]);
        if (i >= 0) { const cb = this.capture; this.capture = null; cb(i); this.prevButtons.set(p.index, cur); return; }
      } else {
        const edge = (i: number) => cur[i] && !prev[i];
        if (edge(0)) this.navQueue.push('ok');
        if (edge(1)) this.navQueue.push('back');
        if (edge(this.bind.pause) || edge(9)) this.navQueue.push('pause');
        const dirs: [Nav, boolean][] = [
          ['up', cur[12] || p.axes[1] < -0.6], ['down', cur[13] || p.axes[1] > 0.6],
          ['left', cur[14] || p.axes[0] < -0.6], ['right', cur[15] || p.axes[0] > 0.6],
        ];
        for (const [nav, on] of dirs) {
          const key = p.index + nav, t = this.held.get(key);
          if (!on) this.held.delete(key);
          else if (t === undefined) { this.held.set(key, now + 0.4); this.navQueue.push(nav); }
          else if (now > t) { this.held.set(key, now + 0.12); this.navQueue.push(nav); }
        }
      }
      this.prevButtons.set(p.index, cur);
    });
    const q = this.navQueue; this.navQueue = [];
    return q;
  }

  private readKb(layout: 'both' | 'wasd' | 'arrows'): PlayerInput {
    const k = this.keys, a = layout !== 'wasd', w = layout !== 'arrows';
    const d = (...codes: string[]) => codes.some((c) => k.has(c));
    const left = (a && d('ArrowLeft')) || (w && d('KeyA')), right = (a && d('ArrowRight')) || (w && d('KeyD'));
    return {
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      throttle: (a && d('ArrowUp')) || (w && d('KeyW')) ? 1 : 0,
      brake: (a && d('ArrowDown')) || (w && d('KeyS')) ? 1 : 0,
      nitro: (layout === 'both' && d('Space')) || (a && d('ShiftRight', 'Slash')) || (w && d('ShiftLeft')),
      up: (layout === 'both' && d('KeyX')) || (a && d('Period')) || (w && d('KeyE')),
      down: (layout === 'both' && d('KeyZ')) || (a && d('Comma')) || (w && d('KeyQ')),
      pause: false,
    };
  }
  private readPad(p: Gamepad | undefined): PlayerInput {
    if (!p) return { steer: 0, throttle: 0, brake: 0, nitro: false, up: false, down: false, pause: false };
    const b = (i: number) => p.buttons[i]?.value ?? 0;
    const ax = p.axes[0] ?? 0;
    let steer = Math.abs(ax) < DEAD ? 0 : (ax - Math.sign(ax) * DEAD) / (1 - DEAD);
    steer = Math.sign(steer) * Math.pow(Math.abs(steer), 1.4);
    if (b(14) > 0.5) steer = -1; if (b(15) > 0.5) steer = 1;
    return { steer, throttle: b(this.bind.throttle), brake: b(this.bind.brake), nitro: b(this.bind.nitro) > 0.5, up: b(this.bind.up) > 0.5, down: b(this.bind.down) > 0.5, pause: false };
  }
  read(dev: Device): PlayerInput {
    if (dev.kind === 'kb') return this.readKb(dev.layout);
    if (dev.kind === 'pad') return this.readPad(this.pad(dev.index));
    const out = this.readKb('both');
    for (const p of this.pads()) {
      const g = this.readPad(p);
      if (Math.abs(g.steer) > Math.abs(out.steer)) out.steer = g.steer;
      out.throttle = Math.max(out.throttle, g.throttle); out.brake = Math.max(out.brake, g.brake);
      out.nitro ||= g.nitro; out.up ||= g.up; out.down ||= g.down;
    }
    return out;
  }
  rumble(dev: Device, strong: number, weak: number, ms: number) {
    const targets = dev.kind === 'pad' ? [this.pad(dev.index)] : dev.kind === 'any' ? this.pads() : [];
    for (const p of targets) {
      try { (p as any)?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch?.(() => {}); } catch { /* unsupported */ }
    }
  }
}
