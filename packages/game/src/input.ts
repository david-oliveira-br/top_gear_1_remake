import { noInput, type Input } from '../../sim/src/index';

/** Keyboard and gamepad, merged into one driving input. */
export class Controls {
  private keys = new Set<string>(); private steer = 0; private shiftHeld = false; private pressed = new Set<string>();
  pad: Gamepad | null = null; readonly out: Input = noInput();
  constructor() {
    addEventListener('keydown', (e) => { if (!this.keys.has(e.code)) this.pressed.add(e.code); this.keys.add(e.code); if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  private k(...c: string[]) { return c.some((x) => this.keys.has(x)); }
  /** True once per key press. */
  hit(...c: string[]) { for (const x of c) if (this.pressed.has(x)) { this.pressed.delete(x); return true; } return false; }
  private padPrev: boolean[] = [];
  /** True once per gamepad button press. */
  padHit(i: number) { const p = this.pad, now = !!p?.buttons[i]?.pressed, was = this.padPrev[i]; this.padPrev[i] = now; return now && !was; }
  read(dt: number): Input {
    const o = this.out, pads = navigator.getGamepads ? navigator.getGamepads() : []; this.pad = null;
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') { this.pad = p; break; }
    const want = (this.k('ArrowRight', 'KeyD') ? 1 : 0) - (this.k('ArrowLeft', 'KeyA') ? 1 : 0);
    // keyboard steering ramps in and snaps back faster than it winds on
    const rate = want === 0 || Math.sign(want) !== Math.sign(this.steer) ? 5.5 : 2.6;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, want - this.steer));
    o.steer = this.steer; o.throttle = this.k('ArrowUp', 'KeyW') ? 1 : 0; o.brake = this.k('ArrowDown', 'KeyS') ? 1 : 0;
    o.nitro = this.k('ShiftLeft', 'ShiftRight', 'KeyN'); o.handbrake = this.k('Space'); o.shift = 0;
    let up = this.k('KeyE'), down = this.k('KeyQ');
    const p = this.pad;
    if (p) {
      const ax = p.axes[0] ?? 0, dz = Math.abs(ax) < 0.08 ? 0 : (ax - Math.sign(ax) * 0.08) / 0.92;
      const st = Math.sign(dz) * Math.pow(Math.abs(dz), 1.6) + (p.buttons[15]?.pressed ? 1 : 0) - (p.buttons[14]?.pressed ? 1 : 0);
      if (Math.abs(st) > Math.abs(o.steer)) o.steer = Math.max(-1, Math.min(1, st));
      o.throttle = Math.max(o.throttle, p.buttons[7]?.value ?? 0, p.buttons[0]?.pressed ? 1 : 0); o.brake = Math.max(o.brake, p.buttons[6]?.value ?? 0, p.buttons[2]?.pressed ? 1 : 0);
      o.nitro ||= !!(p.buttons[1]?.pressed || p.buttons[5]?.pressed); o.handbrake ||= !!p.buttons[4]?.pressed;
      up ||= !!p.buttons[3]?.pressed; down ||= !!p.buttons[12]?.pressed;
    }
    if ((up || down) && !this.shiftHeld) o.shift = up ? 1 : -1;
    this.shiftHeld = up || down;
    return o;
  }
  rumble(strong: number, weak: number, ms = 60) {
    const a = (this.pad as any)?.vibrationActuator; if (a?.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
  }
}
