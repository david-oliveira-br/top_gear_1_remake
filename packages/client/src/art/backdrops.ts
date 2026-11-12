import { mulberry32, type ThemeId } from '../../../shared/src/index';

// Painted horizon panoramas. Each layer is a wide canvas that wraps horizontally; the bottom edge sits on the horizon.
type G = CanvasRenderingContext2D;
export interface Backdrop { far: HTMLCanvasElement; near: HTMLCanvasElement; lights: HTMLCanvasElement; lightsOnNear: boolean; sea: boolean; balloons: boolean; searchlights: boolean }
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
    if (base === 0 && f(x / W) < 0.03) continue; // no trees standing in the water
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

// ---------- landmarks: original silhouettes of famous places, painted onto the panorama ----------
const poly = (g: G, p: number[]) => { g.beginPath(); for (let i = 0; i < p.length; i += 2) { if (i) g.lineTo(p[i], p[i + 1]); else g.moveTo(p[i], p[i + 1]); } g.closePath(); g.fill(); };
function mount(g: G, x: number, hw: number, hh: number, c1: string, c2: string, skew = 0, y = H) {
  const gr = g.createLinearGradient(0, y - hh, 0, y); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr;
  g.beginPath(); g.moveTo(x - hw, y); g.bezierCurveTo(x - hw * 0.5, y - hh * 0.2, x - hw * 0.22 + skew, y - hh, x + skew, y - hh);
  g.bezierCurveTo(x + hw * 0.25 + skew, y - hh, x + hw * 0.55, y - hh * 0.25, x + hw, y); g.fill();
}
/** Statue with open arms on a pedestal; y is the base, s the total height. */
function openArms(g: G, x: number, y: number, s: number, col: string) {
  g.fillStyle = col;
  g.fillRect(x - s * 0.08, y - s * 0.17, s * 0.16, s * 0.17);
  poly(g, [x - s * 0.075, y - s * 0.17, x + s * 0.075, y - s * 0.17, x + s * 0.05, y - s * 0.78, x - s * 0.05, y - s * 0.78]);
  poly(g, [x - s * 0.47, y - s * 0.75, x + s * 0.47, y - s * 0.75, x + s * 0.47, y - s * 0.7, x + s * 0.08, y - s * 0.63, x - s * 0.08, y - s * 0.63, x - s * 0.47, y - s * 0.7]);
  g.beginPath(); g.arc(x, y - s * 0.845, s * 0.052, 0, 7); g.fill(); g.fillRect(x - s * 0.025, y - s * 0.81, s * 0.05, s * 0.05);
}
function glow(e: G, x: number, y: number, r: number, col: string) {
  const gr = e.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); e.fillStyle = gr; e.fillRect(x - r, y - r, r * 2, r * 2);
}
function wheel(g: G, e: G | null, x: number, y: number, r: number, col: string) {
  for (const c of e ? [g, e] : [g]) {
    c.strokeStyle = c === g ? col : '#ffb0d8'; c.lineWidth = c === g ? 5 : 3; c.beginPath(); c.arc(x, y - r - 14, r, 0, 7); c.stroke();
    c.lineWidth = 2; for (let k = 0; k < 12; k++) { const a = (k / 12) * 6.283; c.beginPath(); c.moveTo(x, y - r - 14); c.lineTo(x + Math.cos(a) * r, y - r - 14 + Math.sin(a) * r); c.stroke(); }
    c.fillStyle = c === g ? col : '#9fe6ff'; for (let k = 0; k < 12; k++) { const a = (k / 12) * 6.283; c.fillRect(x + Math.cos(a) * r - 5, y - r - 14 + Math.sin(a) * r - 2, 10, 9); }
  }
  g.fillStyle = col; poly(g, [x - r * 0.5, y, x - 4, y - r - 14, x + 4, y - r - 14, x + r * 0.5, y, x + r * 0.5 - 9, y, x, y - r - 2, x - r * 0.5 + 9, y]);
}
function latticeTower(g: G, e: G, x: number, hh: number) {
  for (const c of [g, e]) {
    for (let k = 0; k < 9; k++) {
      const t0 = k / 9, t1 = (k + 1) / 9, w0 = 105 * Math.pow(1 - t0, 1.9) + 5, w1 = 105 * Math.pow(1 - t1, 1.9) + 5;
      c.fillStyle = c === g ? (k % 2 ? '#f2f2f2' : '#e0452c') : (k % 2 ? 'rgba(255,200,120,.55)' : 'rgba(255,120,40,.7)');
      poly(c, [x - w0, H - t0 * hh, x + w0, H - t0 * hh, x + w1, H - t1 * hh, x - w1, H - t1 * hh]);
    }
    c.fillRect(x - 2, H - hh - 60, 4, 62);
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; // open legs
    poly(c, [x - 78, H, x + 78, H, x + 34, H - hh * 0.2, x, H - hh * 0.26, x - 34, H - hh * 0.2]);
    c.globalCompositeOperation = 'source-over';
  }
  g.fillStyle = '#b8bcc4'; g.fillRect(x - 42, H - hh * 0.36, 84, 12); g.fillRect(x - 22, H - hh * 0.62, 44, 9);
  glow(e, x, H - hh - 60, 16, 'rgba(255,60,40,1)');
}
function arches(g: G, x0: number, y: number, n: number, w: number, h: number, col: string, hole: string | null) {
  g.fillStyle = col; g.fillRect(x0, y - h, n * w, h);
  for (let k = 0; k < n; k++) {
    const cx = x0 + k * w + w / 2, r = w * 0.34;
    if (hole) g.fillStyle = hole; else g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.moveTo(cx - r, y); g.lineTo(cx - r, y - h * 0.62 + r); g.arc(cx, y - h * 0.62 + r, r, Math.PI, 0); g.lineTo(cx + r, y); g.fill();
    g.globalCompositeOperation = 'source-over';
  }
}
function minaret(g: G, e: G, x: number, hh: number, col: string) {
  g.fillStyle = col; g.fillRect(x - 9, H - hh, 18, hh); g.fillRect(x - 15, H - hh * 0.7, 30, 7); g.fillRect(x - 13, H - hh * 0.9, 26, 6);
  poly(g, [x - 9, H - hh, x, H - hh - 34, x + 9, H - hh]);
  e.fillStyle = '#ffd98a'; e.fillRect(x - 13, H - hh * 0.9 - 9, 26, 7); e.fillRect(x - 15, H - hh * 0.7 - 9, 30, 7); glow(e, x, H - hh - 34, 14, 'rgba(120,255,160,.9)');
}
function castle(n: G, x: number, y: number) {
  n.fillStyle = '#6f6c66'; n.fillRect(x - 70, y - 44, 140, 50);
  for (const tx of [-80, -10, 60]) { n.fillRect(x + tx, y - 82, 30, 88); for (let k = 0; k < 3; k++) n.clearRect(x + tx + 3 + k * 10, y - 82, 5, 7); }
}

/** Per-circuit landmarks. f/n/e = far, near and light layers; near(x) gives the near-hill height at x. */
function landmarks(id: string, f: G, n: G, e: G, near: (x: number) => number, seed: number, city: boolean) {
  // L / R: left and right of the view at the start line. In cities the roadside towers hide the flanks, so the main landmark stands straight ahead.
  const L = city ? W - 40 : W - 700, R = city ? 900 : 620;
  /** Draw enlarged about (x, horizon): city landmarks must rise above the near skyline to be seen. */
  const big = (x: number, k: number, fn: () => void) => { for (const c of [f, e]) { c.save(); c.translate(x, H); c.scale(k, k); c.translate(-x, -H); } fn(); for (const c of [f, e]) c.restore(); };
  switch (id) {
    case 'costa': { // statue with open arms on a steep peak, and a sugarloaf rock with its cable car
      mount(f, L, 430, 340, '#5f9a86', '#356f60', 40); openArms(f, L + 40, H - 334, 120, '#f6f3e8');
      mount(f, R + 260, 230, 170, '#7f9a94', '#56766f'); mount(f, R, 150, 300, '#8aa39c', '#5d7c75', -10);
      f.strokeStyle = 'rgba(40,40,40,.8)'; f.lineWidth = 2; f.beginPath(); f.moveTo(R - 10, H - 298); f.lineTo(R + 260, H - 168); f.stroke();
      f.fillStyle = '#e8c33a'; f.fillRect(R + 110, H - 236, 22, 13);
      break;
    }
    case 'metropole': {
      mount(f, L, 520, 400, '#22323a', '#141d24', 30); openArms(f, L + 30, H - 394, 112, '#cfd8de');
      openArms(e, L + 30, H - 394, 112, '#fff0c0'); glow(e, L + 30, H - 450, 150, 'rgba(255,230,160,.5)');
      break;
    }
    case 'selva': { // tableland with waterfalls
      const r = mulberry32(seed);
      for (const X of [L, R + 300]) {
        const gr = f.createLinearGradient(0, H - 240, 0, H); gr.addColorStop(0, '#4f8a62'); gr.addColorStop(1, '#2c5a44'); f.fillStyle = gr;
        poly(f, [X - 560, H, X - 500, H - 220, X + 480, H - 235, X + 560, H]);
        for (let k = 0; k < 9; k++) { const fx = X - 420 + k * 100 + r() * 40, fw = 16 + r() * 34; const wg = f.createLinearGradient(0, H - 226, 0, H); wg.addColorStop(0, 'rgba(255,255,255,.95)'); wg.addColorStop(1, 'rgba(225,240,255,.55)'); f.fillStyle = wg; f.fillRect(fx, H - 226, fw, 226); }
        const mg = f.createLinearGradient(0, H - 70, 0, H); mg.addColorStop(0, 'rgba(255,255,255,0)'); mg.addColorStop(1, 'rgba(255,255,255,.8)'); f.fillStyle = mg; f.fillRect(X - 560, H - 70, 1120, 70);
      }
      break;
    }
    case 'serra': { // umbrella pines on the ridge
      n.strokeStyle = n.fillStyle = '#0f3320';
      for (const fx of [0.05, 0.11, 0.2, 0.83, 0.9, 0.96, 0.5]) {
        const x = fx * W, y = near(x) + 4, s = 60 + (fx * 97 % 1) * 40;
        n.lineWidth = 5; n.beginPath(); n.moveTo(x, y); n.lineTo(x, y - s); n.stroke();
        for (const [o, w2] of [[0, 1], [0.2, 0.75]] as [number, number][]) { n.lineWidth = 6; n.beginPath(); n.moveTo(x - s * 0.55 * w2, y - s * (1.02 - o)); n.quadraticCurveTo(x, y - s * (0.78 - o), x + s * 0.55 * w2, y - s * (1.02 - o)); n.stroke(); for (const sx of [-1, 1]) { n.beginPath(); n.arc(x + sx * s * 0.52 * w2, y - s * (1.04 - o), 8, 0, 7); n.fill(); } }
      }
      break;
    }
    case 'mojave': case 'canyon': { // lone sandstone buttes
      for (const [X, k, flip] of [[L - 100, 1, 1], [R + 200, 0.8, -1], [W * 0.5, 0.6, 1]] as [number, number, number][]) {
        const gr = f.createLinearGradient(0, H - 330 * k, 0, H); gr.addColorStop(0, '#d8774a'); gr.addColorStop(1, '#8f4426'); f.fillStyle = gr;
        poly(f, [X - 230 * k, H, X - 120 * k, H - 130 * k, X + 120 * k, H - 130 * k, X + 230 * k, H]);
        f.fillRect(X - 95 * k, H - 330 * k, 150 * k, 210 * k); f.fillRect(X + flip * 78 * k - 22 * k, H - 255 * k, 44 * k, 130 * k);
        f.fillStyle = 'rgba(50,10,0,.28)'; f.fillRect(X + 15 * k, H - 330 * k, 40 * k, 210 * k); poly(f, [X + 60 * k, H - 130 * k, X + 120 * k, H - 130 * k, X + 230 * k, H, X + 110 * k, H]);
      }
      break;
    }
    case 'coast1': { // red suspension bridge across the bay
      const x0 = L - 520, x1 = L + 520, yd = H - 78, col = '#cf4a30';
      f.fillStyle = col; f.fillRect(x0 - 200, yd, x1 - x0 + 400, 9);
      f.strokeStyle = col; f.lineWidth = 4;
      const cable = (a: number, b: number, sag: number) => { f.beginPath(); f.moveTo(a, H - 300); f.quadraticCurveTo((a + b) / 2, yd + sag, b, H - 300); f.stroke(); };
      cable(x0, x1, 190); f.beginPath(); f.moveTo(x0, H - 300); f.lineTo(x0 - 200, yd); f.moveTo(x1, H - 300); f.lineTo(x1 + 200, yd); f.stroke();
      f.lineWidth = 1.5; for (let x = x0 + 26; x < x1; x += 26) { const t = (x - x0) / (x1 - x0), y = H - 300 + (yd - 12 - (H - 300)) * (1 - Math.pow(2 * t - 1, 2)); f.beginPath(); f.moveTo(x, y); f.lineTo(x, yd); f.stroke(); }
      for (const X of [x0, x1]) { f.fillRect(X - 13, H - 310, 9, 310); f.fillRect(X + 4, H - 310, 9, 310); for (const yy of [300, 240, 170]) f.fillRect(X - 13, H - yy, 26, 9); }
      mount(f, R + 200, 420, 200, '#7fa08f', '#557a6b');
      break;
    }
    case 'downtown': { // harbour statue holding a torch
      const x = L, y = H;
      big(x, 1.22, () => {
      f.fillStyle = '#39424f'; poly(f, [x - 150, y, x - 110, y - 40, x + 110, y - 40, x + 150, y]);
      f.fillStyle = '#8f8a80'; poly(f, [x - 46, y - 40, x + 46, y - 40, x + 30, y - 170, x - 30, y - 170]);
      f.fillStyle = '#7fb8a4';
      poly(f, [x - 30, y - 170, x + 30, y - 170, x + 20, y - 300, x - 20, y - 300]); // robe
      f.beginPath(); f.arc(x, y - 314, 15, 0, 7); f.fill();
      for (let k = -3; k <= 3; k++) poly(f, [x + k * 5 - 2, y - 326, x + k * 9, y - 348, x + k * 5 + 2, y - 326]); // crown
      poly(f, [x + 12, y - 296, x + 24, y - 296, x + 40, y - 372, x + 31, y - 372]); // raised arm
      poly(f, [x - 22, y - 280, x - 40, y - 240, x - 26, y - 232, x - 12, y - 270]); // tablet arm
      f.fillStyle = '#e8c860'; poly(f, [x + 28, y - 372, x + 44, y - 372, x + 40, y - 386, x + 36, y - 398, x + 32, y - 386]);
      glow(e, x + 36, y - 386, 34, 'rgba(255,210,110,1)'); e.fillStyle = 'rgba(160,230,205,.6)'; poly(e, [x - 30, y - 170, x + 30, y - 170, x + 20, y - 300, x - 20, y - 300]); e.beginPath(); e.arc(x, y - 314, 15, 0, 7); e.fill(); poly(e, [x + 12, y - 296, x + 24, y - 296, x + 40, y - 372, x + 31, y - 372]); e.fillStyle = 'rgba(255,215,160,.4)'; poly(e, [x - 46, y - 40, x + 46, y - 40, x + 30, y - 170, x - 30, y - 170]);
      });
      break;
    }
    case 'touge': { // shrine gate on the ridge, volcano behind
      cone(f, W * 0.86, 560, H * 0.9, '#8f9ccc', '#6a78aa', true);
      for (const fx of [0.9, 0.12]) {
        const x = fx * W, y = near(x) + 6, s = 80;
        n.fillStyle = '#c8402c'; n.fillRect(x - s * 0.5, y - s, s * 0.12, s); n.fillRect(x + s * 0.38, y - s, s * 0.12, s); n.fillRect(x - s * 0.62, y - s * 0.74, s * 1.24, s * 0.09);
        n.beginPath(); n.moveTo(x - s * 0.82, y - s * 1.1); n.quadraticCurveTo(x, y - s * 0.94, x + s * 0.82, y - s * 1.1); n.lineTo(x + s * 0.76, y - s * 0.94); n.quadraticCurveTo(x, y - s * 0.82, x - s * 0.76, y - s * 0.94); n.fill();
      }
      break;
    }
    case 'expo': case 'neon': {
      latticeTower(f, e, L, 440); wheel(f, e, R + 120, H - 20, 120, '#c9d2e4');
      break;
    }
    case 'fjord': { // wooden stave church
      for (const fx of [0.88, 0.2]) {
        const x = fx * W, y = near(x) + 6; n.fillStyle = '#3a2416';
        for (let k = 0; k < 4; k++) { const w2 = 62 - k * 14, yy = y - k * 30; n.fillRect(x - w2 * 0.62, yy - 22, w2 * 1.24, 24); poly(n, [x - w2, yy - 20, x, yy - 20 - w2 * 0.85, x + w2, yy - 20]); }
        n.fillRect(x - 2, y - 190, 4, 40);
      }
      break;
    }
    case 'tundra': case 'glacier': case 'aurora': {
      for (const fx of [0.1, 0.86]) boxes(n, e, fx * W, near(fx * W) + 4, 6, '#6a4630', '#e9eef6', seed + fx * 50, false);
      break;
    }
    case 'colline': { // leaning bell tower beside a domed church
      const x = W * 0.87, y = near(x) + 8;
      n.save(); n.translate(x, y); n.rotate(0.075);
      n.fillStyle = '#f1ead8'; n.fillRect(-26, -190, 52, 190); n.fillRect(-20, -214, 40, 26);
      n.fillStyle = 'rgba(70,60,50,.55)'; for (let k = 0; k < 7; k++) { n.fillRect(-26, -26 - k * 26, 52, 3); for (let c = 0; c < 5; c++) n.fillRect(-22 + c * 10, -22 - k * 26, 4, 15); }
      n.restore();
      n.fillStyle = '#e9dfc8'; n.fillRect(x - 200, y - 70, 130, 70); n.beginPath(); n.arc(x - 135, y - 70, 46, Math.PI, 0); n.fill(); n.fillRect(x - 138, y - 132, 6, 20);
      break;
    }
    case 'stradale': { // ruined aqueduct striding across the plain
      for (const [x0, cnt] of [[W - 1500, 15], [300, 9]] as [number, number][]) { arches(f, x0, H, cnt, 74, 150, '#c9b08a', null); arches(f, x0, H - 150, cnt * 2 - 5, 37, 62, '#c9b08a', null); }
      break;
    }
    case 'notturno': { // oval arena, floodlit
      const x = L, w = 500;
      big(x, 1.75, () => {
      for (const c of [f, e]) {
        const wall = c === f ? '#8f8674' : 'rgba(255,176,100,.34)', hole = c === f ? '#2a2620' : '#ffc070';
        { c.fillStyle = wall; poly(c, [x - w / 2, H, x - w / 2, H - 250, x - 40, H - 250, x + 10, H - 190, x + w / 2, H - 190, x + w / 2, H]); }
        for (let t = 0; t < 4; t++) { const n2 = t === 3 ? 7 : 14, ww = w / 14; if (t === 3) { if (c === f) { c.fillStyle = '#2a2620'; for (let k = 0; k < 6; k++) c.fillRect(x - w / 2 + 14 + k * ww, H - 236, 12, 16); } continue; } arches(c, x - w / 2, H - t * 62, n2, ww, 62, c === f ? wall : 'rgba(0,0,0,0)', hole); }
      }
      glow(e, x, H - 120, 330, 'rgba(255,190,110,.35)');
      });
      break;
    }
    case 'dales': { // ring of standing stones
      const x = W * 0.86, y = near(x) + 10; n.fillStyle = '#77756f';
      for (let k = 0; k < 7; k++) { const sx = x - 170 + k * 56, hh = 62 + (k * 37 % 17); n.fillRect(sx, y - hh, 15, hh); n.fillRect(sx + 26, y - hh + 4, 15, hh - 4); if (k % 3 !== 2) n.fillRect(sx - 5, y - hh - 12, 52, 13); }
      break;
    }
    case 'highland': castle(n, W * 0.88, near(W * 0.88) + 6); castle(n, W * 0.4, near(W * 0.4) + 6); break;
    case 'seafront': { // pleasure pier
      const x0 = L - 420, y = H - 52; f.fillStyle = '#d9d4c8'; f.fillRect(x0, y, 900, 10);
      f.fillStyle = '#4a4640'; for (let x = x0 + 10; x < x0 + 900; x += 34) f.fillRect(x, y + 8, 5, 46);
      f.fillStyle = '#e8e2d2'; f.fillRect(x0 + 620, y - 62, 190, 62); f.fillStyle = '#b8473a'; poly(f, [x0 + 600, y - 62, x0 + 715, y - 110, x0 + 830, y - 62]);
      wheel(f, null, x0 + 330, y, 100, '#c8ccd6');
      break;
    }
    case 'capital': { // clock tower and twin-towered bridge
      const x = L - 250;
      for (const c of [f, e]) {
        c.fillStyle = c === f ? '#b79f6e' : 'rgba(255,200,120,.22)'; c.fillRect(x - 30, H - 370, 60, 370); c.fillRect(x - 36, H - 380, 72, 14);
        poly(c, [x - 34, H - 380, x - 20, H - 410, x + 20, H - 410, x + 34, H - 380]); poly(c, [x - 20, H - 410, x, H - 480, x + 20, H - 410]);
        c.fillStyle = c === f ? '#f4eed8' : '#fff1c0'; c.beginPath(); c.arc(x, H - 335, 22, 0, 7); c.fill();
      }
      f.strokeStyle = '#3a3428'; f.lineWidth = 3; f.beginPath(); f.moveTo(x, H - 335); f.lineTo(x, H - 352); f.moveTo(x, H - 335); f.lineTo(x + 12, H - 330); f.stroke();
      f.fillStyle = 'rgba(60,45,20,.3)'; for (let k = 0; k < 5; k++) f.fillRect(x - 30 + k * 13, H - 300, 3, 300);
      const b = L + 330;
      for (const c of [f, e]) {
        c.fillStyle = c === f ? '#9a917c' : 'rgba(255,205,130,.25)';
        for (const X of [b - 130, b + 130]) { c.fillRect(X - 34, H - 250, 68, 250); poly(c, [X - 34, H - 250, X, H - 330, X + 34, H - 250]); for (const sx of [-30, 30]) poly(c, [X + sx - 8, H - 250, X + sx, H - 290, X + sx + 8, H - 250]); }
        c.fillStyle = c === f ? '#5a86a8' : 'rgba(150,220,255,.6)'; c.fillRect(b - 96, H - 215, 192, 12); c.fillRect(b - 96, H - 190, 192, 6); c.fillRect(b - 330, H - 84, 660, 10);
      }
      f.strokeStyle = '#5a86a8'; f.lineWidth = 4; for (const sx of [-1, 1]) { f.beginPath(); f.moveTo(b + sx * 164, H - 240); f.quadraticCurveTo(b + sx * 250, H - 110, b + sx * 330, H - 84); f.stroke(); }
      break;
    }
    case 'oasis': case 'valley': case 'delta': { // reclining guardian statue before the pyramids
      const x = W - 620, y = H; f.fillStyle = '#d6b272';
      poly(f, [x - 210, y, x - 200, y - 46, x + 70, y - 52, x + 96, y - 150, x + 150, y - 156, x + 168, y - 70, x + 250, y - 44, x + 260, y]);
      f.fillStyle = '#b08a4c'; poly(f, [x + 96, y - 150, x + 82, y - 60, x + 100, y - 52, x + 112, y - 140]); poly(f, [x + 150, y - 156, x + 178, y - 60, x + 168, y - 70]);
      f.fillStyle = 'rgba(90,60,20,.4)'; f.fillRect(x + 118, y - 126, 22, 5); f.fillRect(x + 122, y - 104, 14, 4);
      if (id === 'valley') for (const ox of [-520, -440]) { f.fillStyle = '#c9a366'; poly(f, [x + ox - 13, y, x + ox - 9, y - 250, x + ox, y - 276, x + ox + 9, y - 250, x + ox + 13, y]); }
      break;
    }
    case 'lanterns': {
      const x = L; big(x, 1.4, () => {
      f.fillStyle = '#8a7350'; f.fillRect(x - 130, H - 150, 260, 150); f.beginPath(); f.arc(x, H - 150, 96, Math.PI, 0); f.fill(); f.fillRect(x - 3, H - 276, 6, 34);
      e.fillStyle = 'rgba(255,200,120,.3)'; e.beginPath(); e.arc(x, H - 150, 96, Math.PI, 0); e.fill(); e.fillStyle = '#ffd98a'; for (let k = 0; k < 7; k++) e.fillRect(x - 112 + k * 35, H - 120, 12, 40);
      for (const [ox, hh] of [[-190, 330], [190, 330], [-290, 240], [300, 260]] as [number, number][]) minaret(f, e, x + ox, hh, '#9a8260');
      });
      minaret(f, e, R + 200, 420, '#9a8260');
      break;
    }
    case 'reef': { // lighthouse on the headland
      const x = W * 0.87, y = near(x) + 6;
      for (let k = 0; k < 5; k++) { n.fillStyle = k % 2 ? '#d8402c' : '#f4f2ea'; const w0 = 22 - k * 2.4, w1 = 22 - (k + 1) * 2.4; poly(n, [x - w0, y - k * 30, x + w0, y - k * 30, x + w1, y - (k + 1) * 30, x - w1, y - (k + 1) * 30]); }
      n.fillStyle = '#2b2f3a'; n.fillRect(x - 15, y - 156, 30, 6); n.fillRect(x - 9, y - 176, 18, 20); poly(n, [x - 12, y - 176, x, y - 192, x + 12, y - 176]);
      e.fillStyle = '#fff3b8'; e.fillRect(x - 7, y - 174, 14, 16); glow(e, x, y - 166, 46, 'rgba(255,240,170,.9)');
      break;
    }
    case 'harbour': { // arch bridge and a concert hall of white shells
      const b = L - 150, half = 430, yd = H - 96;
      for (const c of [f, e]) {
        c.strokeStyle = c === f ? '#5d6a80' : 'rgba(255,210,140,.75)'; c.lineWidth = c === f ? 8 : 2;
        c.beginPath(); c.moveTo(b - half, yd); c.quadraticCurveTo(b, yd - 430, b + half, yd); c.stroke();
        c.lineWidth = c === f ? 5 : 2; c.beginPath(); c.moveTo(b - half, yd); c.quadraticCurveTo(b, yd - 330, b + half, yd); c.stroke();
        c.lineWidth = c === f ? 2 : 0.01; if (c === f) for (let x = b - half + 30; x < b + half; x += 30) { const t = (x - (b - half)) / (2 * half), yy = yd - 430 * 2 * t * (1 - t); c.beginPath(); c.moveTo(x, yy); c.lineTo(x, yd); c.stroke(); }
        c.fillStyle = c === f ? '#5d6a80' : 'rgba(255,220,150,.8)'; c.fillRect(b - half - 160, yd - (c === f ? 0 : 3), 2 * half + 320, c === f ? 10 : 3);
        if (c === f) for (const sx of [-1, 1]) { c.fillStyle = '#8a8474'; c.fillRect(b + sx * (half + 10) - 22, yd - 90, 44, 190); }
      }
      const o = R - 250; big(o, 1.9, () => {
      f.fillStyle = '#3a4250'; f.fillRect(o - 230, H - 30, 470, 30);
      for (const c of [f, e]) {
        c.fillStyle = c === f ? '#f4f1e8' : 'rgba(255,240,210,.75)';
        for (const [ox, s, dir] of [[-150, 1, 1], [-80, 0.8, 1], [-25, 0.6, 1], [150, 0.9, -1], [90, 0.7, -1]] as [number, number, number][]) {
          const x = o + ox; c.beginPath(); c.moveTo(x - dir * 70 * s, H - 30); c.quadraticCurveTo(x - dir * 50 * s, H - 30 - 150 * s, x + dir * 60 * s, H - 30 - 170 * s); c.quadraticCurveTo(x + dir * 30 * s, H - 30 - 70 * s, x + dir * 50 * s, H - 30); c.fill();
        }
      }
      });
      break;
    }
  }
}

const SEA = new Set(['costa', 'coast1', 'reef', 'seafront', 'fjord', 'lago', 'delta']);
const cache = new Map<string, Backdrop>();
export function buildBackdrop(theme: ThemeId, country: string, seed: number, trackId = ''): Backdrop {
  const key = theme + country + trackId; const hit = cache.get(key); if (hit) return hit;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const far = mk(), near = mk(), lights = mk();
  const f = far.getContext('2d')!, n = near.getContext('2d')!, e = lights.getContext('2d')!;
  const s = seed * 31 + 7;
  const sea = SEA.has(trackId);
  // on coastal circuits the near hills break into headlands so the water shows between them
  const h0 = ridge(s + 2, 4), l0 = ridge(s + 9, 5, false, 2);
  const hills = sea ? (x: number) => Math.max(0, h0(x) - 0.4) * 1.65 : h0, low = sea ? (x: number) => Math.max(0, l0(x) - 0.4) * 1.65 : l0;
  const B = (b: number) => (sea ? 0 : b);
  let nearY = (x: number) => yOf(hills, B(0.1), 0.3, x);
  switch (theme) {
    case 'tropical':
      band(f, ridge(s, 4), 0.1, 0.25, '#7fb0c8', '#5d98a8'); domes(f, s, 9, '#6aa79a', '#3d7f78');
      band(n, hills, B(0.1), 0.35, '#2f8f4a', '#16602c'); treeline(n, hills, B(0.1), 0.35, s, '#0f4a22', 'palm', 70, 26); treeline(n, hills, B(0.1), 0.35, s + 1, '#1a6a30', 'round', 26, 14);
      nearY = (x) => yOf(hills, B(0.1), 0.35, x);
      break;
    case 'desert':
      mesas(f, s, 0.2, 0.55, '#d98a58', '#a85a38', 9);
      band(n, low, 0.05, 0.22, '#c98a52', '#a06a3a'); treeline(n, low, 0.05, 0.22, s, '#6b5a34', 'round', 90, 7);
      break;
    case 'dunes':
      band(f, ridge(s, 3), 0.1, 0.2, '#f0d9a0', '#d8b56e'); pyramids(f, s);
      band(n, hills, B(0.05), 0.3, '#eccb86', '#c79a4e'); onBand(n, () => { n.fillStyle = 'rgba(120,70,10,.16)'; for (let x = 0; x < W; x += 6) if (hills((x + 12) / W) < hills(x / W)) n.fillRect(x, 0, 6, H); });
      treeline(n, hills, B(0.05), 0.3, s, '#5d6a2c', 'palm', 260, 22);
      nearY = (x) => yOf(hills, B(0.05), 0.3, x);
      break;
    case 'outback':
      band(f, ridge(s, 4), 0.1, 0.18, '#b98572', '#9a5f4c');
      wrap(W * 0.3, 620, (X) => { const gr = f.createLinearGradient(0, H * 0.3, 0, H); gr.addColorStop(0, '#d7623a'); gr.addColorStop(1, '#8f3418'); f.fillStyle = gr; f.beginPath(); f.moveTo(X - 620, H); f.bezierCurveTo(X - 560, H * 0.42, X - 380, H * 0.34, X - 200, H * 0.33); f.lineTo(X + 260, H * 0.35); f.bezierCurveTo(X + 480, H * 0.38, X + 580, H * 0.6, X + 640, H); f.fill(); f.strokeStyle = 'rgba(70,15,0,.25)'; f.lineWidth = 3; for (let k = -5; k < 6; k++) { f.beginPath(); f.moveTo(X + k * 90, H * 0.36); f.lineTo(X + k * 104, H); f.stroke(); } });
      band(n, low, 0.05, 0.2, '#b5683a', '#8a4a26'); treeline(n, low, 0.05, 0.2, s, '#5f7040', 'round', 60, 15);
      break;
    case 'snow':
      peaks(f, s, 0.2, 0.75, '#9fb4d6', '#6f86b0', 0.55);
      band(n, hills, 0.08, 0.26, '#e8eff8', '#b9c8de'); treeline(n, hills, 0.08, 0.26, s, '#1f4a44', 'conifer', 22, 15);
      nearY = (x) => yOf(hills, 0.08, 0.26, x);
      break;
    case 'forest':
      peaks(f, s, 0.18, 0.7, '#7f9fb0', '#4f7684', country === 'Norway' ? 0.4 : 0.22);
      band(n, hills, B(0.1), 0.3, '#2c6a3c', '#134226'); treeline(n, hills, B(0.1), 0.3, s, '#0d3520', 'conifer', 16, 18);
      break;
    case 'sakura':
      band(f, ridge(s, 4), 0.1, 0.25, '#9aa6d0', '#7d8ab8'); cone(f, W * 0.62, 620, H * 0.92, '#8f9ccc', '#6a78aa', true);
      band(n, hills, 0.1, 0.3, '#5fa650', '#33763a'); treeline(n, hills, 0.1, 0.3, s, '#e7a0c0', 'round', 30, 15); treeline(n, hills, 0.1, 0.3, s + 4, '#2c6a34', 'round', 55, 13);
      for (const fx of [0.18, 0.74]) { const x = fx * W, y = yOf(hills, 0.1, 0.3, x); for (let k = 0; k < 4; k++) { const w2 = 46 - k * 8; n.fillStyle = '#7a2f2a'; n.fillRect(x - w2 * 0.35, y - 24 - k * 22, w2 * 0.7, 22); n.fillStyle = '#2b2f3a'; n.beginPath(); n.moveTo(x - w2, y - 24 - k * 22 + 4); n.quadraticCurveTo(x, y - 34 - k * 22, x + w2, y - 24 - k * 22 + 4); n.lineTo(x, y - 40 - k * 22); n.fill(); } }
      break;
    case 'tuscany':
      band(f, ridge(s, 4), 0.14, 0.4, '#8fa9c8', '#7896b4'); band(f, ridge(s + 4, 4, false, 2), 0.08, 0.3, '#86a888', '#6c9272');
      band(n, hills, B(0.1), 0.32, '#b7b85a', '#7c9440'); onBand(n, () => { n.fillStyle = 'rgba(210,170,60,.3)'; for (let x = 0; x < W; x += 340) n.fillRect(x, 0, 150, H); });
      treeline(n, hills, B(0.1), 0.32, s, '#1f4a26', 'cypress', 48, 15);
      nearY = (x) => yOf(hills, B(0.1), 0.32, x);
      for (const fx of [0.22, 0.68]) if (hills(fx) > 0.05) boxes(n, e, fx * W, yOf(hills, B(0.1), 0.32, fx * W), 9, '#e3c9a0', '#b4603c', s + fx * 100, true);
      break;
    case 'moor':
      band(f, ridge(s, 4), 0.14, 0.42, '#8f9cb8', '#7786a2'); band(f, ridge(s + 4, 4, false, 2), 0.08, 0.3, '#8a9a8c', '#6f8474');
      band(n, hills, B(0.1), 0.3, '#5f9a48', '#386e30'); onBand(n, () => { n.strokeStyle = 'rgba(60,60,55,.45)'; n.lineWidth = 3; for (let x = 0; x < W; x += 230) { n.beginPath(); n.moveTo(x, H); n.lineTo(x + 120, H * 0.55); n.stroke(); } });
      treeline(n, hills, B(0.1), 0.3, s, '#234f28', 'round', 85, 17);
      break;
    case 'city': {
      const tint = ({ Brazil: '#3a5a6a', USA: '#3d4a66', Japan: '#4a4466', Italy: '#5a4a4a', UK: '#465058', Egypt: '#6a5a44', Australia: '#3f5566', Norway: '#44566a' } as Record<string, string>)[country] ?? '#3d4a66';
      skyline(f, e, s, 0.12, 0.8, tint, '#ffd98a', 1.25);
      const e2 = document.createElement('canvas').getContext('2d')!;
      skyline(n, e2, s + 11, 0.08, 0.34, '#1c2230', '#ffc46a', 1.9);
      break;
    }
  }
  for (const dx of [0, -W, W]) { // repeated one panorama to each side so landmarks wrap across the seam
    for (const c of [f, n, e]) { c.save(); c.translate(dx, 0); }
    landmarks(trackId, f, n, e, (x) => nearY(x), s, theme === 'city');
    for (const c of [f, n, e]) c.restore();
  }
  const b = { far, near, lights, lightsOnNear: theme !== 'city', sea, balloons: theme === 'dunes' || theme === 'tuscany', searchlights: theme === 'city' };
  cache.set(key, b);
  return b;
}
