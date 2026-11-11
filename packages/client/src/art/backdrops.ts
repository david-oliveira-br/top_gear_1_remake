import { mulberry32, type ThemeId } from '../../../shared/src/index';

// Painted horizon panoramas. Each layer is a wide canvas that wraps horizontally; the bottom edge sits on the horizon.
type G = CanvasRenderingContext2D;
export interface Backdrop { far: HTMLCanvasElement; near: HTMLCanvasElement; lights: HTMLCanvasElement; lightsOnNear: boolean }
const W = 4096, H = 512;

/** Periodic 0..1 height function (seamless over the canvas width). ridged=true gives sharp peaks. */
function ridge(seed: number, comps: number, ridged = false, firstK = 1) {
  const r = mulberry32(seed);
  const cs = Array.from({ length: comps }, (_, i) => ({ k: firstK + i + Math.floor(r() * 2) + i * (ridged ? 2 : 1), a: 1 / (1 + i * (ridged ? 0.9 : 1.4)), p: r() * 6.283 }));
  const total = cs.reduce((a, c) => a + c.a, 0);
  return (x: number) => {
    let v = 0;
    for (const c of cs) { const s = Math.sin(6.283185 * c.k * x + c.p); v += c.a * (ridged ? 1 - Math.abs(s) : s * 0.5 + 0.5); }
    return v / total;
  };
}
function band(g: G, f: (x: number) => number, base: number, amp: number, top: string, bottom: string) {
  const gr = g.createLinearGradient(0, H * (1 - base - amp), 0, H); gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.beginPath(); g.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) g.lineTo(x, H * (1 - base - amp * f(x / W)));
  g.lineTo(W, H); g.closePath(); g.fill();
}
/** Paint only where the band already has pixels (shading, snow caps, strata). */
function onBand(g: G, fn: () => void) { g.save(); g.globalCompositeOperation = 'source-atop'; fn(); g.restore(); }
const yOf = (f: (x: number) => number, base: number, amp: number, x: number) => H * (1 - base - amp * f(((x % W) + W) % W / W));
/** Draw something at x and again one panorama to the left/right so it wraps cleanly. */
function wrap(x: number, halfW: number, fn: (x: number) => void) { fn(x); if (x - halfW < 0) fn(x + W); if (x + halfW > W) fn(x - W); }

function peaks(g: G, seed: number, base: number, amp: number, top: string, bottom: string, snow: number) {
  const f = ridge(seed, 5, true);
  band(g, f, base, amp, top, bottom);
  onBand(g, () => {
    // shaded faces
    g.fillStyle = 'rgba(0,0,20,.22)';
    for (let x = 0; x < W; x += 6) { const d = f((x + 10) / W) - f(x / W); if (d < 0) g.fillRect(x, 0, 6, H); }
    if (snow > 0) {
      const line = H * (1 - base - amp * (1 - snow)), r = mulberry32(seed + 1);
      g.fillStyle = 'rgba(248,251,255,.96)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0);
      for (let x = W; x >= 0; x -= 14) g.lineTo(x, line + (r() - 0.5) * 34 + Math.sin(x * 0.05) * 10);
      g.closePath(); g.fill();
    }
  });
}
function treeline(g: G, f: (x: number) => number, base: number, amp: number, seed: number, col: string, kind: 'round' | 'conifer' | 'palm' | 'cypress', every: number, size: number) {
  const r = mulberry32(seed); g.fillStyle = col; g.strokeStyle = col;
  for (let x = 0; x < W; x += every * (0.5 + r())) {
    const s = size * (0.6 + r() * 0.8), y = yOf(f, base, amp, x) + 4;
    wrap(x, s * 2, (X) => {
      if (kind === 'round') { g.beginPath(); g.arc(X, y - s * 0.6, s, 0, 7); g.fill(); }
      else if (kind === 'conifer') { g.beginPath(); g.moveTo(X, y - s * 2.6); g.lineTo(X + s * 0.7, y); g.lineTo(X - s * 0.7, y); g.fill(); }
      else if (kind === 'cypress') { g.beginPath(); g.ellipse(X, y - s * 1.5, s * 0.36, s * 1.6, 0, 0, 7); g.fill(); }
      else { g.lineWidth = s * 0.16; g.beginPath(); g.moveTo(X, y); g.quadraticCurveTo(X + s * 0.3, y - s * 1.2, X + s * 0.1, y - s * 2.2); g.stroke(); for (let k = 0; k < 6; k++) { const a = -2.9 + k * 0.55; g.beginPath(); g.ellipse(X + s * 0.1 + Math.cos(a) * s * 0.7, y - s * 2.2 + Math.sin(a) * s * 0.4 + s * 0.2, s * 0.75, s * 0.16, a, 0, 7); g.fill(); } }
    });
  }
}
function skyline(g: G, e: G, seed: number, base: number, amp: number, col: string, lit: string, scale: number) {
  const r = mulberry32(seed), cluster = ridge(seed + 5, 3);
  let x = 0;
  while (x < W) {
    const bw = Math.min(W - x, (26 + r() * 60) * scale), c = cluster((x + bw / 2) / W);
    const bh = H * (base + amp * (0.15 + 0.85 * c * c) * (0.45 + r() * 0.55)), y = H - bh;
    const gr = g.createLinearGradient(x, 0, x + bw, 0); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,.0)');
    g.fillStyle = col; g.fillRect(x, y, bw + 1, bh);
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(x, y, bw * 0.45, bh);
    void gr;
    const style = r();
    if (style < 0.2) { g.fillStyle = col; g.fillRect(x + bw * 0.45, y - bh * 0.18, 2 * scale, bh * 0.18); }
    else if (style < 0.35) { g.fillStyle = col; g.fillRect(x + bw * 0.2, y - 10 * scale, bw * 0.6, 10 * scale); }
    else if (style < 0.42) { g.fillStyle = col; g.beginPath(); g.moveTo(x, y); g.lineTo(x + bw / 2, y - bw * 0.7); g.lineTo(x + bw, y); g.fill(); }
    const cw = 7 * scale, ch = 9 * scale;
    for (let wy = y + 6 * scale; wy < H - ch; wy += ch) for (let wx = x + 3 * scale; wx < x + bw - cw * 0.7; wx += cw) {
      const on = r() < 0.42;
      g.fillStyle = on ? 'rgba(190,215,235,.5)' : 'rgba(0,0,0,.22)'; g.fillRect(wx, wy, cw * 0.6, ch * 0.55);
      if (on) { e.fillStyle = r() < 0.15 ? '#9fe6ff' : lit; e.fillRect(wx, wy, cw * 0.6, ch * 0.55); }
    }
    x += bw + (r() < 0.25 ? 6 * scale : 0);
  }
}
function mesas(g: G, seed: number, base: number, amp: number, top: string, bottom: string, n: number) {
  const r = mulberry32(seed);
  band(g, ridge(seed + 3, 3), base * 0.5, base * 0.6, top, bottom);
  for (let i = 0; i < n; i++) {
    const cx = ((i + r() * 0.7) / n) * W, hw = 80 + r() * 260, hh = H * (base + amp * (0.4 + r() * 0.6));
    wrap(cx, hw * 1.4, (X) => {
      const gr = g.createLinearGradient(0, H - hh, 0, H); gr.addColorStop(0, top); gr.addColorStop(1, bottom);
      g.fillStyle = gr; g.beginPath(); g.moveTo(X - hw * 1.35, H); g.lineTo(X - hw, H - hh * 0.55); g.lineTo(X - hw * 0.92, H - hh); g.lineTo(X + hw * 0.9, H - hh); g.lineTo(X + hw, H - hh * 0.5); g.lineTo(X + hw * 1.4, H); g.fill();
      g.fillStyle = 'rgba(40,10,0,.2)'; g.beginPath(); g.moveTo(X + hw * 0.3, H - hh); g.lineTo(X + hw * 0.9, H - hh); g.lineTo(X + hw, H - hh * 0.5); g.lineTo(X + hw * 1.4, H); g.lineTo(X + hw * 0.5, H); g.fill();
      g.strokeStyle = 'rgba(60,20,0,.25)'; g.lineWidth = 2; for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(X - hw * 0.95, H - hh + (hh * 0.45 * k) / 5); g.lineTo(X + hw * 0.93, H - hh + (hh * 0.45 * k) / 5); g.stroke(); }
    });
  }
}
function cone(g: G, x: number, hw: number, hh: number, col: string, col2: string, snow: boolean) {
  wrap(x, hw, (X) => {
    const gr = g.createLinearGradient(0, H - hh, 0, H); gr.addColorStop(0, col); gr.addColorStop(1, col2);
    g.fillStyle = gr; g.beginPath(); g.moveTo(X - hw, H); g.bezierCurveTo(X - hw * 0.45, H - hh * 0.25, X - hw * 0.2, H - hh * 0.8, X - hw * 0.08, H - hh); g.lineTo(X + hw * 0.08, H - hh); g.bezierCurveTo(X + hw * 0.2, H - hh * 0.8, X + hw * 0.45, H - hh * 0.25, X + hw, H); g.fill();
    if (snow) { g.fillStyle = 'rgba(250,252,255,.95)'; g.beginPath(); g.moveTo(X - hw * 0.08, H - hh); g.lineTo(X + hw * 0.08, H - hh); g.lineTo(X + hw * 0.24, H - hh * 0.68); g.lineTo(X + hw * 0.12, H - hh * 0.76); g.lineTo(X + hw * 0.04, H - hh * 0.64); g.lineTo(X - hw * 0.06, H - hh * 0.77); g.lineTo(X - hw * 0.14, H - hh * 0.66); g.lineTo(X - hw * 0.24, H - hh * 0.68); g.fill(); }
  });
}
function domes(g: G, seed: number, n: number, col: string, col2: string) {
  const r = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const x = ((i + r() * 0.8) / n) * W, hw = 90 + r() * 150, hh = H * (0.3 + r() * 0.45);
    wrap(x, hw, (X) => { const gr = g.createLinearGradient(X - hw, 0, X + hw, 0); gr.addColorStop(0, col); gr.addColorStop(1, col2); g.fillStyle = gr; g.beginPath(); g.moveTo(X - hw, H); g.bezierCurveTo(X - hw * 0.8, H - hh * 1.25, X + hw * 0.5, H - hh * 1.3, X + hw, H); g.fill(); });
  }
}
function pyramids(g: G, seed: number) {
  const r = mulberry32(seed);
  for (const [fx, s] of [[0.2, 1], [0.27, 0.72], [0.33, 0.5], [0.7, 0.85], [0.76, 0.55]] as [number, number][]) {
    const x = fx * W + r() * 60, hw = 260 * s, hh = 300 * s;
    g.fillStyle = '#e8c88a'; g.beginPath(); g.moveTo(x - hw, H); g.lineTo(x, H - hh); g.lineTo(x + hw, H); g.fill();
    g.fillStyle = '#a8843f'; g.beginPath(); g.moveTo(x, H - hh); g.lineTo(x + hw, H); g.lineTo(x + hw * 0.25, H); g.fill();
  }
}
function boxes(g: G, e: G, x: number, y: number, n: number, col: string, roof: string, seed: number, towers: boolean) {
  const r = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const bx = x + (i - n / 2) * 30 + r() * 12, bw = 24 + r() * 22, bh = 20 + r() * 26 + (towers && r() < 0.2 ? 60 : 0), by = y + r() * 14;
    g.fillStyle = col; g.fillRect(bx, by - bh, bw, bh + 20);
    g.fillStyle = roof; g.beginPath(); g.moveTo(bx - 3, by - bh); g.lineTo(bx + bw / 2, by - bh - 9); g.lineTo(bx + bw + 3, by - bh); g.fill();
    g.fillStyle = 'rgba(0,0,0,.35)'; e.fillStyle = '#ffd68a';
    for (let k = 0; k < 2; k++) { const wx = bx + 5 + k * (bw - 14), wy = by - bh + 8; g.fillRect(wx, wy, 4, 6); if (r() < 0.7) e.fillRect(wx, wy, 4, 6); }
  }
}

const cache = new Map<string, Backdrop>();
export function buildBackdrop(theme: ThemeId, country: string, seed: number): Backdrop {
  const key = theme + country; const hit = cache.get(key); if (hit) return hit;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const far = mk(), near = mk(), lights = mk();
  const f = far.getContext('2d')!, n = near.getContext('2d')!, e = lights.getContext('2d')!;
  const s = seed * 31 + 7;
  const hills = ridge(s + 2, 4), low = ridge(s + 9, 5, false, 2);
  switch (theme) {
    case 'tropical':
      band(f, ridge(s, 4), 0.1, 0.25, '#7fb0c8', '#5d98a8'); domes(f, s, 9, '#6aa79a', '#3d7f78');
      band(n, hills, 0.1, 0.35, '#2f8f4a', '#16602c'); treeline(n, hills, 0.1, 0.35, s, '#0f4a22', 'palm', 70, 26); treeline(n, hills, 0.1, 0.35, s + 1, '#1a6a30', 'round', 26, 14);
      break;
    case 'desert':
      mesas(f, s, 0.2, 0.55, '#d98a58', '#a85a38', 9);
      band(n, low, 0.05, 0.22, '#c98a52', '#a06a3a'); treeline(n, low, 0.05, 0.22, s, '#6b5a34', 'round', 90, 7);
      break;
    case 'dunes':
      band(f, ridge(s, 3), 0.1, 0.2, '#f0d9a0', '#d8b56e'); pyramids(f, s);
      band(n, hills, 0.05, 0.3, '#eccb86', '#c79a4e'); onBand(n, () => { n.fillStyle = 'rgba(120,70,10,.16)'; for (let x = 0; x < W; x += 6) if (hills((x + 12) / W) < hills(x / W)) n.fillRect(x, 0, 6, H); });
      treeline(n, hills, 0.05, 0.3, s, '#5d6a2c', 'palm', 260, 22);
      break;
    case 'outback':
      band(f, ridge(s, 4), 0.1, 0.18, '#b98572', '#9a5f4c');
      wrap(W * 0.3, 620, (X) => { const gr = f.createLinearGradient(0, H * 0.3, 0, H); gr.addColorStop(0, '#d7623a'); gr.addColorStop(1, '#8f3418'); f.fillStyle = gr; f.beginPath(); f.moveTo(X - 620, H); f.bezierCurveTo(X - 560, H * 0.42, X - 380, H * 0.34, X - 200, H * 0.33); f.lineTo(X + 260, H * 0.35); f.bezierCurveTo(X + 480, H * 0.38, X + 580, H * 0.6, X + 640, H); f.fill(); f.strokeStyle = 'rgba(70,15,0,.25)'; f.lineWidth = 3; for (let k = -5; k < 6; k++) { f.beginPath(); f.moveTo(X + k * 90, H * 0.36); f.lineTo(X + k * 104, H); f.stroke(); } });
      band(n, low, 0.05, 0.2, '#b5683a', '#8a4a26'); treeline(n, low, 0.05, 0.2, s, '#5f7040', 'round', 60, 15);
      break;
    case 'snow':
      peaks(f, s, 0.2, 0.75, '#9fb4d6', '#6f86b0', 0.55);
      band(n, hills, 0.08, 0.26, '#e8eff8', '#b9c8de'); treeline(n, hills, 0.08, 0.26, s, '#1f4a44', 'conifer', 22, 15);
      break;
    case 'forest':
      peaks(f, s, 0.18, 0.7, '#7f9fb0', '#4f7684', country === 'Norway' ? 0.4 : 0.22);
      band(n, hills, 0.1, 0.3, '#2c6a3c', '#134226'); treeline(n, hills, 0.1, 0.3, s, '#0d3520', 'conifer', 16, 18);
      break;
    case 'sakura':
      band(f, ridge(s, 4), 0.1, 0.25, '#9aa6d0', '#7d8ab8'); cone(f, W * 0.62, 620, H * 0.92, '#8f9ccc', '#6a78aa', true);
      band(n, hills, 0.1, 0.3, '#5fa650', '#33763a'); treeline(n, hills, 0.1, 0.3, s, '#e7a0c0', 'round', 30, 15); treeline(n, hills, 0.1, 0.3, s + 4, '#2c6a34', 'round', 55, 13);
      for (const fx of [0.18, 0.74]) { const x = fx * W, y = yOf(hills, 0.1, 0.3, x); for (let k = 0; k < 4; k++) { const w2 = 46 - k * 8; n.fillStyle = '#7a2f2a'; n.fillRect(x - w2 * 0.35, y - 24 - k * 22, w2 * 0.7, 22); n.fillStyle = '#2b2f3a'; n.beginPath(); n.moveTo(x - w2, y - 24 - k * 22 + 4); n.quadraticCurveTo(x, y - 34 - k * 22, x + w2, y - 24 - k * 22 + 4); n.lineTo(x, y - 40 - k * 22); n.fill(); } }
      break;
    case 'tuscany':
      band(f, ridge(s, 4), 0.14, 0.4, '#8fa9c8', '#7896b4'); band(f, ridge(s + 4, 4, false, 2), 0.08, 0.3, '#86a888', '#6c9272');
      band(n, hills, 0.1, 0.32, '#b7b85a', '#7c9440'); onBand(n, () => { n.fillStyle = 'rgba(210,170,60,.3)'; for (let x = 0; x < W; x += 340) n.fillRect(x, 0, 150, H); });
      treeline(n, hills, 0.1, 0.32, s, '#1f4a26', 'cypress', 48, 15);
      for (const fx of [0.22, 0.68]) boxes(n, e, fx * W, yOf(hills, 0.1, 0.32, fx * W), 9, '#e3c9a0', '#b4603c', s + fx * 100, true);
      break;
    case 'moor':
      band(f, ridge(s, 4), 0.14, 0.42, '#8f9cb8', '#7786a2'); band(f, ridge(s + 4, 4, false, 2), 0.08, 0.3, '#8a9a8c', '#6f8474');
      band(n, hills, 0.1, 0.3, '#5f9a48', '#386e30'); onBand(n, () => { n.strokeStyle = 'rgba(60,60,55,.45)'; n.lineWidth = 3; for (let x = 0; x < W; x += 230) { n.beginPath(); n.moveTo(x, H); n.lineTo(x + 120, H * 0.55); n.stroke(); } });
      treeline(n, hills, 0.1, 0.3, s, '#234f28', 'round', 85, 17);
      { const x = W * 0.4, y = yOf(hills, 0.1, 0.3, x) + 6; n.fillStyle = '#6f6c66'; n.fillRect(x - 70, y - 44, 140, 50); for (const tx of [-80, -10, 60]) { n.fillRect(x + tx, y - 82, 30, 88); for (let k = 0; k < 3; k++) n.clearRect(x + tx + 3 + k * 10, y - 82, 5, 7); } }
      break;
    case 'city': {
      const tint = ({ Brazil: '#3a5a6a', USA: '#3d4a66', Japan: '#4a4466', Italy: '#5a4a4a', UK: '#465058', Egypt: '#6a5a44', Australia: '#3f5566', Norway: '#44566a' } as Record<string, string>)[country] ?? '#3d4a66';
      skyline(f, e, s, 0.12, 0.8, tint, '#ffd98a', 1.25);
      const e2 = document.createElement('canvas').getContext('2d')!;
      skyline(n, e2, s + 11, 0.08, 0.34, '#1c2230', '#ffc46a', 1.9);
      break;
    }
  }
  const b = { far, near, lights, lightsOnNear: theme !== 'city' };
  cache.set(key, b);
  return b;
}
