import { mulberry32 } from '../../../shared/src/index';
import { shade } from './cars';

export interface SpriteInfo { u0: number; v0: number; u1: number; v1: number; w: number; h: number }
export interface Atlas { base: HTMLCanvasElement; emis: HTMLCanvasElement; sprites: Record<string, SpriteInfo> }
type G = CanvasRenderingContext2D;
type Draw = (g: G, e: G, w: number, h: number) => void;

const AW = 4096, AH = 2048, PAD = 4;

function rr(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
}
function poly(g: G, pts: number[]) {
  g.beginPath(); g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
}
function blob(g: G, x: number, y: number, r: number, col: string, hi: string) {
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  gr.addColorStop(0, hi); gr.addColorStop(1, col);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
}
function trunk(g: G, x: number, y0: number, y1: number, w: number, col = '#5a3b22') {
  const gr = g.createLinearGradient(x - w, 0, x + w, 0);
  gr.addColorStop(0, shade(col.startsWith('#') ? col : '#5a3b22', -0.35)); gr.addColorStop(0.5, col); gr.addColorStop(1, shade(col, -0.5));
  g.fillStyle = gr; poly(g, [x - w * 0.6, y0, x + w * 0.6, y0, x + w, y1, x - w, y1]); g.fill();
}

function leafy(cols: [string, string], seed: number, flowers?: string, bark = '#5a3b22'): Draw {
  return (g, _e, w, h) => {
    const r = mulberry32(seed);
    trunk(g, w / 2, h * 0.45, h, w * 0.06, bark);
    for (let i = 0; i < 26; i++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * w * 0.3;
      const x = w / 2 + Math.cos(a) * d, y = h * 0.36 + Math.sin(a) * d * 0.8, rad = w * (0.1 + r() * 0.09);
      blob(g, x, y, rad, r() < 0.5 ? cols[0] : shade(cols[0], -0.2), cols[1]);
    }
    if (flowers) { g.fillStyle = flowers; for (let i = 0; i < 90; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * w * 0.36; g.fillRect(w / 2 + Math.cos(a) * d, h * 0.36 + Math.sin(a) * d * 0.8, 3, 3); } }
  };
}
function conifer(col: string, snow: boolean): Draw {
  return (g, _e, w, h) => {
    trunk(g, w / 2, h * 0.7, h, w * 0.07);
    for (let i = 0; i < 6; i++) {
      const t = i / 6, y0 = h * (0.02 + t * 0.72), y1 = y0 + h * 0.26, hw = w * (0.12 + t * 0.36);
      const gr = g.createLinearGradient(w / 2 - hw, 0, w / 2 + hw, 0);
      gr.addColorStop(0, shade(col, 0.12)); gr.addColorStop(1, shade(col, -0.45));
      g.fillStyle = gr; poly(g, [w / 2, y0, w / 2 + hw, y1, w / 2 - hw, y1]); g.fill();
      if (snow) { g.fillStyle = 'rgba(245,250,255,.95)'; poly(g, [w / 2, y0, w / 2 + hw * 0.55, y0 + (y1 - y0) * 0.55, w / 2 + hw * 0.2, y0 + (y1 - y0) * 0.45, w / 2 - hw * 0.1, y0 + (y1 - y0) * 0.6, w / 2 - hw * 0.5, y0 + (y1 - y0) * 0.5]); g.fill(); }
    }
  };
}
const palm: Draw = (g, _e, w, h) => {
  g.strokeStyle = '#7a5a36'; g.lineWidth = w * 0.07; g.lineCap = 'round';
  g.beginPath(); g.moveTo(w * 0.45, h); g.quadraticCurveTo(w * 0.4, h * 0.55, w * 0.52, h * 0.22); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2;
  for (let i = 0; i < 12; i++) { const y = h * (0.28 + i * 0.058); g.beginPath(); g.moveTo(w * 0.4, y); g.lineTo(w * 0.52, y - 3); g.stroke(); }
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI + (i / 8) * Math.PI, len = w * (0.42 + (i % 2) * 0.06);
    const ex = w * 0.52 + Math.cos(a) * len, ey = h * 0.22 + Math.sin(a) * len * 0.55 + len * 0.35;
    const gr = g.createLinearGradient(w * 0.52, h * 0.2, ex, ey); gr.addColorStop(0, '#3fae4a'); gr.addColorStop(1, '#17692c');
    g.fillStyle = gr; g.beginPath(); g.moveTo(w * 0.52, h * 0.22);
    g.quadraticCurveTo(w * 0.52 + Math.cos(a) * len * 0.6, h * 0.22 + Math.sin(a) * len * 0.7 - 14, ex, ey);
    g.quadraticCurveTo(w * 0.52 + Math.cos(a) * len * 0.5, h * 0.22 + Math.sin(a) * len * 0.4 + 12, w * 0.52, h * 0.22); g.fill();
  }
  blob(g, w * 0.52, h * 0.225, w * 0.05, '#5b3d1f', '#8a6a3a');
};
const cactus: Draw = (g, _e, w, h) => {
  const col = '#3d8a4a';
  const arm = (x: number, y: number, ww: number, hh: number) => { const gr = g.createLinearGradient(x, 0, x + ww, 0); gr.addColorStop(0, shade(col, 0.25)); gr.addColorStop(1, shade(col, -0.4)); g.fillStyle = gr; rr(g, x, y, ww, hh, ww / 2); g.fill(); };
  arm(w * 0.38, h * 0.05, w * 0.26, h * 0.95);
  arm(w * 0.08, h * 0.35, w * 0.18, h * 0.3); arm(w * 0.08, h * 0.52, w * 0.4, w * 0.18);
  arm(w * 0.74, h * 0.22, w * 0.18, h * 0.3); arm(w * 0.5, h * 0.42, w * 0.42, w * 0.18);
};
const deadtree: Draw = (g, _e, w, h) => {
  g.strokeStyle = '#4c3a2c'; g.lineCap = 'round';
  const br = (x: number, y: number, a: number, len: number, lw: number, d: number) => {
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    g.lineWidth = lw; g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
    if (d > 0) { br(ex, ey, a - 0.5, len * 0.68, lw * 0.65, d - 1); br(ex, ey, a + 0.45, len * 0.6, lw * 0.6, d - 1); }
  };
  br(w / 2, h, -Math.PI / 2, h * 0.36, w * 0.07, 4);
};
const bush: Draw = (g, _e, w, h) => {
  const r = mulberry32(5);
  for (let i = 0; i < 12; i++) blob(g, w * (0.18 + r() * 0.64), h * (0.45 + r() * 0.3), w * (0.13 + r() * 0.08), '#2c7a36', '#63b85a');
};
function rock(snow: boolean, c0 = '#9a938c', c1 = '#4e4944'): Draw {
  return (g, _e, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    g.fillStyle = gr; poly(g, [w * 0.05, h, w * 0.15, h * 0.45, w * 0.4, h * 0.1, w * 0.7, h * 0.2, w * 0.95, h * 0.65, w * 0.98, h]); g.fill();
    g.fillStyle = 'rgba(0,0,0,.2)'; poly(g, [w * 0.55, h, w * 0.7, h * 0.2, w * 0.95, h * 0.65, w * 0.98, h]); g.fill();
    if (snow) { g.fillStyle = '#f4f8ff'; poly(g, [w * 0.15, h * 0.45, w * 0.4, h * 0.1, w * 0.7, h * 0.2, w * 0.8, h * 0.42, w * 0.6, h * 0.35, w * 0.42, h * 0.48, w * 0.3, h * 0.38]); g.fill(); }
  };
}
function building(col: string, seed: number, cols: number, rows: number, lit: string): Draw {
  return (g, e, w, h) => {
    const r = mulberry32(seed);
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, shade(col, 0.12)); gr.addColorStop(1, shade(col, -0.35));
    g.fillStyle = gr; g.fillRect(w * 0.04, h * 0.03, w * 0.92, h * 0.97);
    g.fillStyle = shade(col, -0.5); g.fillRect(w * 0.04, h * 0.03, w * 0.92, 6); g.fillRect(w * 0.3, 0, w * 0.12, h * 0.03);
    const cw = (w * 0.84) / cols, ch = (h * 0.9) / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const X = w * 0.08 + x * cw + cw * 0.15, Y = h * 0.06 + y * ch + ch * 0.2, on = r() < 0.55;
      g.fillStyle = on ? '#b9d4e8' : '#3b4a5c'; g.fillRect(X, Y, cw * 0.7, ch * 0.55);
      if (on) { e.fillStyle = lit; e.fillRect(X, Y, cw * 0.7, ch * 0.55); }
    }
    g.fillStyle = '#20242c'; g.fillRect(w * 0.42, h * 0.93, w * 0.16, h * 0.07);
  };
}
function house(wall: string, roof: string, snow: boolean): Draw {
  return (g, e, w, h) => {
    g.fillStyle = wall; g.fillRect(w * 0.1, h * 0.45, w * 0.8, h * 0.55);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(w * 0.6, h * 0.45, w * 0.3, h * 0.55);
    g.fillStyle = roof; poly(g, [w * 0.02, h * 0.48, w * 0.5, h * 0.05, w * 0.98, h * 0.48]); g.fill();
    if (snow) { g.fillStyle = '#f4f8ff'; poly(g, [w * 0.02, h * 0.48, w * 0.5, h * 0.05, w * 0.98, h * 0.48, w * 0.9, h * 0.44, w * 0.5, h * 0.15, w * 0.1, h * 0.44]); g.fill(); }
    g.fillStyle = '#5b3a22'; g.fillRect(w * 0.44, h * 0.68, w * 0.13, h * 0.32);
    for (const x of [0.18, 0.68]) { g.fillStyle = '#bcd6ea'; g.fillRect(w * x, h * 0.6, w * 0.15, h * 0.18); e.fillStyle = '#ffd27a'; e.fillRect(w * x, h * 0.6, w * 0.15, h * 0.18); }
  };
}
const lamp: Draw = (g, e, w, h) => {
  g.fillStyle = '#59606b'; g.fillRect(w * 0.44, h * 0.08, w * 0.12, h * 0.92); g.fillRect(w * 0.2, h * 0.06, w * 0.6, h * 0.035);
  g.fillStyle = '#fff6c9'; rr(g, w * 0.14, h * 0.085, w * 0.72, h * 0.03, 4); g.fill();
  const gl = e.createRadialGradient(w / 2, h * 0.1, 2, w / 2, h * 0.1, w * 0.5);
  gl.addColorStop(0, 'rgba(255,240,180,1)'); gl.addColorStop(1, 'rgba(255,220,120,0)');
  e.fillStyle = gl; e.fillRect(0, 0, w, h * 0.3);
};
function billboard(bg: [string, string], l1: string, l2: string, fg: string): Draw {
  return (g, e, w, h) => {
    g.fillStyle = '#4a4f58'; g.fillRect(w * 0.2, h * 0.6, w * 0.05, h * 0.4); g.fillRect(w * 0.75, h * 0.6, w * 0.05, h * 0.4);
    const paint = (c: G, a: number) => {
      const gr = c.createLinearGradient(0, 0, w, h * 0.66); gr.addColorStop(0, bg[0]); gr.addColorStop(1, bg[1]);
      c.globalAlpha = a; c.fillStyle = gr; rr(c, w * 0.03, h * 0.03, w * 0.94, h * 0.62, 8); c.fill();
      c.fillStyle = fg; c.textAlign = 'center'; c.font = `italic 900 ${h * 0.2}px Arial, sans-serif`; c.fillText(l1, w / 2, h * 0.3);
      c.font = `700 ${h * 0.12}px Arial, sans-serif`; c.fillText(l2, w / 2, h * 0.5); c.globalAlpha = 1;
    };
    paint(g, 1); paint(e, 0.55);
    g.strokeStyle = '#22252b'; g.lineWidth = 5; rr(g, w * 0.03, h * 0.03, w * 0.94, h * 0.62, 8); g.stroke();
  };
}
function sign(dir: number): Draw {
  return (g, e, w, h) => {
    g.fillStyle = '#5a5f68'; g.fillRect(w * 0.45, h * 0.5, w * 0.1, h * 0.5);
    for (const c of [g, e]) {
      c.globalAlpha = c === e ? 0.4 : 1;
      c.fillStyle = '#f6c915'; rr(c, w * 0.04, h * 0.03, w * 0.92, h * 0.55, 6); c.fill();
      c.fillStyle = '#16171a';
      for (const o of [-0.2, 0.12]) { const x = w * (0.5 + o * dir); poly(c, [x - dir * w * 0.12, h * 0.1, x + dir * w * 0.14, h * 0.3, x - dir * w * 0.12, h * 0.5, x - dir * w * 0.02, h * 0.3]); c.fill(); }
      c.globalAlpha = 1;
    }
  };
}
const stand: Draw = (g, _e, w, h) => {
  const r = mulberry32(9);
  g.fillStyle = '#6b7280'; poly(g, [0, h, 0, h * 0.35, w, h * 0.2, w, h]); g.fill();
  const cols = ['#e23636', '#2f6fed', '#f2c230', '#fff', '#2fbf71', '#f27d1f', '#222'];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 60; x++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(4 + x * (w - 8) / 60, h * 0.4 + y * h * 0.06 - (x / 60) * h * 0.13, 4, 5); }
  g.fillStyle = '#c62f2f'; poly(g, [0, h * 0.3, w, h * 0.12, w, h * 0.2, 0, h * 0.38]); g.fill();
  g.fillStyle = '#3d424b'; g.fillRect(0, h * 0.94, w, h * 0.06);
};
const arch: Draw = (g, e, w, h) => {
  for (const x of [0, w - 60]) { const gr = g.createLinearGradient(x, 0, x + 60, 0); gr.addColorStop(0, '#9aa3b2'); gr.addColorStop(1, '#4a5160'); g.fillStyle = gr; g.fillRect(x, h * 0.05, 60, h * 0.95); }
  g.fillStyle = '#1b1e25'; g.fillRect(0, h * 0.04, w, h * 0.34);
  for (let i = 0; i < 48; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#f4f4f4' : '#111'; g.fillRect(i * w / 48, h * 0.04 + j * h * 0.05, w / 48 + 1, h * 0.05); }
  for (const c of [g, e]) {
    c.fillStyle = c === g ? '#ff3b3b' : '#ff6a4a'; c.textAlign = 'center'; c.font = `italic 900 ${h * 0.17}px Arial, sans-serif`;
    c.fillText('REDLINE CIRCUIT', w / 2, h * 0.32);
  }
};
const puff: Draw = (g, _e, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
};
const glow: Draw = (g, _e, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
};

const cypress: Draw = (g, _e, w, h) => {
  trunk(g, w / 2, h * 0.86, h, w * 0.09);
  const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#3f7a3a'); gr.addColorStop(0.45, '#255c2c'); gr.addColorStop(1, '#0f331a');
  g.fillStyle = gr; g.beginPath(); g.moveTo(w / 2, 0); g.bezierCurveTo(w * 0.98, h * 0.3, w * 0.95, h * 0.8, w / 2, h * 0.92); g.bezierCurveTo(w * 0.05, h * 0.8, w * 0.02, h * 0.3, w / 2, 0); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2; for (let i = 1; i < 9; i++) { g.beginPath(); g.moveTo(w * 0.3, h * i * 0.1); g.quadraticCurveTo(w / 2, h * (i * 0.1 + 0.04), w * 0.7, h * i * 0.1); g.stroke(); }
};
const haybale: Draw = (g, _e, w, h) => {
  blob(g, w / 2, h * 0.55, h * 0.44, '#b8892e', '#f0d27a');
  g.strokeStyle = 'rgba(110,70,10,.5)'; g.lineWidth = 2; for (let r = 0.1; r < 0.44; r += 0.08) { g.beginPath(); g.arc(w / 2, h * 0.55, h * r, 0, 7); g.stroke(); }
};
const hedge: Draw = (g, _e, w, h) => {
  const r = mulberry32(21);
  for (let i = 0; i < 26; i++) blob(g, w * (0.05 + (i / 26) * 0.9), h * (0.5 + r() * 0.2), h * (0.3 + r() * 0.12), '#245f2a', '#5fa44e');
};
const ruin: Draw = (g, _e, w, h) => {
  const col = (x: number, top: number) => {
    const gr = g.createLinearGradient(x, 0, x + w * 0.13, 0); gr.addColorStop(0, '#ecd9a8'); gr.addColorStop(1, '#9a8355');
    g.fillStyle = gr; g.fillRect(x, top, w * 0.13, h - top); g.fillStyle = '#d9c38e'; g.fillRect(x - w * 0.02, top, w * 0.17, h * 0.05); g.fillRect(x - w * 0.02, h * 0.95, w * 0.17, h * 0.05);
    g.strokeStyle = 'rgba(80,60,20,.35)'; g.lineWidth = 2; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x + (w * 0.13 * k) / 4, top + h * 0.06); g.lineTo(x + (w * 0.13 * k) / 4, h * 0.94); g.stroke(); }
  };
  col(w * 0.08, h * 0.18); col(w * 0.43, h * 0.18); col(w * 0.78, h * 0.5);
  g.fillStyle = '#cbb37a'; poly(g, [w * 0.04, h * 0.18, w * 0.62, h * 0.18, w * 0.6, h * 0.06, w * 0.04, h * 0.08]); g.fill();
};
const fence: Draw = (g, _e, w, h) => {
  g.fillStyle = '#4b5059'; for (let i = 0; i < 5; i++) g.fillRect(w * (0.04 + i * 0.23), h * 0.2, w * 0.025, h * 0.8);
  const gr = g.createLinearGradient(0, h * 0.2, 0, h * 0.75); gr.addColorStop(0, '#e9edf2'); gr.addColorStop(0.5, '#9aa2ad'); gr.addColorStop(1, '#5d646e');
  g.fillStyle = gr; rr(g, 0, h * 0.22, w, h * 0.24, 4); g.fill(); rr(g, 0, h * 0.52, w, h * 0.24, 4); g.fill();
};
const gantry: Draw = (g, e, w, h) => {
  for (const x of [0, w - 26]) { g.fillStyle = '#6b7280'; g.fillRect(x, h * 0.05, 26, h * 0.95); }
  g.fillStyle = '#4a5160'; g.fillRect(0, h * 0.05, w, h * 0.07); g.fillRect(0, h * 0.36, w, h * 0.04);
  for (const [x, t] of [[0.2, 'PIT LANE'], [0.57, 'CIRCUIT']] as [number, string][]) {
    for (const c of [g, e]) { c.globalAlpha = c === e ? 0.45 : 1; c.fillStyle = '#126a3c'; rr(c, w * x, h * 0.1, w * 0.24, h * 0.27, 6); c.fill(); c.fillStyle = '#fff'; c.font = `700 ${h * 0.11}px Arial, sans-serif`; c.textAlign = 'center'; c.fillText(t, w * (x + 0.12), h * 0.28); c.globalAlpha = 1; }
  }
};
function tunnel(face: string, stripes: boolean): Draw {
  return (g, e, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, shade(face, 0.1)); gr.addColorStop(1, shade(face, -0.45));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const ox = w * 0.335, ow = w * 0.33, oy = h * 0.55;
    if (stripes) { for (let i = 0; i < 14; i++) { g.fillStyle = i % 2 ? '#f2c230' : '#1b1b1b'; g.fillRect(ox - 14 + (i * (ow + 28)) / 14, oy - 22, (ow + 28) / 14 + 1, 12); } }
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    g.beginPath(); g.moveTo(ox, h); g.lineTo(ox, oy + 20); g.quadraticCurveTo(ox, oy, ox + 24, oy); g.lineTo(ox + ow - 24, oy); g.quadraticCurveTo(ox + ow, oy, ox + ow, oy + 20); g.lineTo(ox + ow, h); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#fff3c4'; g.fillRect(ox + ow * 0.2, oy - 5, ow * 0.6, 4);
    e.fillStyle = '#ffe9a0'; e.fillRect(ox + ow * 0.2, oy - 6, ow * 0.6, 6);
  };
}
const shadow: Draw = (g, _e, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(0,0,0,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(0, h / 2); g.scale(1, h / w); g.translate(0, -h / 2); g.fillStyle = gr; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, 7); g.fill(); g.restore();
};

export function buildAtlas(): Atlas {
  const mk = () => { const c = document.createElement('canvas'); c.width = AW; c.height = AH; return c; };
  const base = mk(), emis = mk();
  const g = base.getContext('2d')!, e = emis.getContext('2d')!;
  const sprites: Record<string, SpriteInfo> = {};
  let x = PAD, y = PAD, rowH = 0;
  const add = (name: string, pw: number, ph: number, worldW: number, draw: Draw) => {
    if (x + pw + PAD > AW) { x = PAD; y += rowH + PAD; rowH = 0; }
    if (y + ph + PAD > AH) throw new Error('atlas full');
    for (const c of [g, e]) { c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, pw, ph); c.clip(); }
    draw(g, e, pw, ph);
    g.restore(); e.restore();
    sprites[name] = { u0: x / AW, v0: y / AH, u1: (x + pw) / AW, v1: (y + ph) / AH, w: worldW, h: (worldW * ph) / pw };
    x += pw + PAD; rowH = Math.max(rowH, ph);
  };
  add('building_a', 256, 448, 3600, building('#8a93a6', 1, 6, 12, '#ffd98a'));
  add('building_b', 256, 448, 3300, building('#a0806e', 2, 5, 10, '#fff0c0'));
  add('building_c', 256, 448, 3900, building('#56708f', 3, 7, 14, '#9fe6ff'));
  add('palm', 192, 320, 1900, palm);
  add('pine', 176, 320, 1600, conifer('#1f6b3a', false));
  add('snowpine', 176, 320, 1600, conifer('#1d5a3c', true));
  add('tree', 256, 288, 2300, leafy(['#2f8a3c', '#7ccf62'], 2));
  add('sakura', 256, 288, 2300, leafy(['#e58fb4', '#ffd9e8'], 4, '#fff'));
  add('cactus', 128, 224, 800, cactus);
  add('deadtree', 160, 224, 1300, deadtree);
  add('billboard_a', 256, 192, 2600, billboard(['#ff4d4d', '#8a1022'], 'REDLINE', 'CIRCUIT', '#fff'));
  add('billboard_b', 256, 192, 2600, billboard(['#1aa3ff', '#0b2a6b'], 'ZUNI', 'RACING FUEL', '#fff'));
  add('billboard_c', 256, 192, 2600, billboard(['#ffd23c', '#f08a00'], 'KORVA', 'TYRES', '#1b1b1b'));
  add('house', 256, 176, 2500, house('#e9dcc3', '#b4533a', false));
  add('cabin', 256, 176, 2300, house('#7a5236', '#4a3323', true));
  add('stand', 384, 160, 4600, stand);
  add('arch', 768, 224, 5900, arch);
  add('lamp', 64, 288, 620, lamp);
  add('sign_left', 96, 128, 760, sign(-1));
  add('sign_right', 96, 128, 760, sign(1));
  add('bush', 128, 80, 950, bush);
  add('rock', 128, 88, 1050, rock(false));
  add('snowrock', 128, 88, 1050, rock(true));
  add('puff', 64, 64, 600, puff);
  add('glow', 64, 64, 400, glow);
  add('cypress', 96, 320, 760, cypress);
  add('oak', 256, 288, 2700, leafy(['#3b7a2f', '#8fbf5a'], 7));
  add('gumtree', 256, 288, 2400, leafy(['#6f8748', '#b9c98a'], 9, undefined, '#cfc6b4'));
  add('datepalm', 192, 320, 2000, palm);
  add('villa', 256, 176, 2900, house('#ecc99b', '#c0623a', false));
  add('cottage', 256, 176, 2400, house('#b9b3a6', '#4f4a45', false));
  add('haybale', 96, 80, 700, haybale);
  add('hedge', 256, 80, 2000, hedge);
  add('ruin', 224, 224, 2300, ruin);
  add('redrock', 128, 88, 1500, rock(false, '#c9683c', '#6b2c18'));
  add('fence', 256, 56, 1800, fence);
  add('gantry', 768, 240, 5800, gantry);
  add('tunnel', 640, 280, 14000, tunnel('#3a3d44', false));
  add('portal', 640, 280, 14000, tunnel('#7b756c', true));
  add('shadow', 64, 20, 1000, shadow);
  return { base, emis, sprites };
}
