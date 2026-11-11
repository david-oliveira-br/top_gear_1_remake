import { CAR_COLORS } from '../../../shared/src/index';
import type { SpriteInfo } from './atlas';

type G = CanvasRenderingContext2D;
export const CAR_FRAMES = 5;
const SW = 384, SH = 240, K = 2.5; // sprite pixels; drawing is authored in a 153.6 x 96 design space
const CAR_WORLD_W = 1130;

export function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
const rr = (g: G, x: number, y: number, w: number, h: number, r: number) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
const poly = (g: G, p: number[]) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); };

interface Shape { bw: number; bh: number; roof: number; wing: 0 | 1 | 2; lights: 'twin' | 'bar' | 'round' | 'block'; pipes: number; hips: number }
const SHAPES: Shape[] = [
  { bw: 108, bh: 34, roof: 24, wing: 1, lights: 'twin', pipes: 2, hips: 3 },   // Vortex GT
  { bw: 116, bh: 29, roof: 19, wing: 2, lights: 'bar', pipes: 4, hips: 5 },    // Sirocco S
  { bw: 102, bh: 34, roof: 25, wing: 2, lights: 'round', pipes: 2, hips: 2 },  // Kestrel RS
  { bw: 110, bh: 38, roof: 29, wing: 0, lights: 'block', pipes: 1, hips: 1 },  // Marathon
];

function tyre(g: G, x: number, y: number, w: number, h: number) {
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, '#050506'); gr.addColorStop(0.5, '#1c1d21'); gr.addColorStop(1, '#050506');
  g.fillStyle = gr; rr(g, x, y, w, h, 3.5); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 0.6;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + (w * i) / 4, y + 2); g.lineTo(x + (w * i) / 4, y + h - 1); g.stroke(); }
}

/** Rear view of a car in design space (153.6 x 96). frame 0..4 = increasingly turned to the right. */
export function drawRear(g: G, e: G, cls: number, color: string, frame: number) {
  const s = SHAPES[cls], w = SW / K, h = SH / K;
  const cx = w / 2, by = h - 8, bw = s.bw, bh = s.bh;
  const sh = frame * 4.2, side = frame * 5.4;
  const x0 = cx - bw / 2 + side * 0.4, x1 = x0 + bw, top = by - 10 - bh, mid = cx + side * 0.4;
  // ground shadow
  const sg = g.createRadialGradient(cx, by + 1, 4, cx, by + 1, bw * 0.68);
  sg.addColorStop(0, 'rgba(0,0,0,.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(0, by + 1); g.scale(1, 0.13); g.translate(0, -(by + 1)); g.fillStyle = sg; g.beginPath(); g.arc(cx, by + 1, bw * 0.7 + side, 0, 7); g.fill(); g.restore();
  // flank that shows when the car is turned
  if (frame > 0) {
    const gr = g.createLinearGradient(x0 - side, 0, x0 + 2, 0); gr.addColorStop(0, shade(color, -0.62)); gr.addColorStop(1, shade(color, -0.22));
    g.fillStyle = gr; poly(g, [x0 + 4, top + 3, x0 - side, top + 9, x0 - side - 1, by - 13, x0 + 4, by - 8]); g.fill();
    g.fillStyle = '#0a0a0c'; g.beginPath(); g.ellipse(x0 - side * 0.45, by - 9, side * 0.42, 8.5, 0, 0, 7); g.fill();
  }
  tyre(g, x0 + 1, by - 22, 17, 22); tyre(g, x1 - 18, by - 22, 17, 22);
  // main body
  const bg = g.createLinearGradient(0, top, 0, by - 8);
  bg.addColorStop(0, shade(color, 0.45)); bg.addColorStop(0.18, shade(color, 0.12)); bg.addColorStop(0.5, color); bg.addColorStop(1, shade(color, -0.55));
  g.fillStyle = bg;
  g.beginPath(); g.moveTo(x0 + 7, top); g.lineTo(x1 - 7, top);
  g.quadraticCurveTo(x1 + s.hips, top + 4, x1, top + bh * 0.5); g.lineTo(x1 - 2, by - 9); g.lineTo(x0 + 2, by - 9); g.lineTo(x0, top + bh * 0.5);
  g.quadraticCurveTo(x0 - s.hips, top + 4, x0 + 7, top); g.fill();
  // deck highlight + shut line
  const hl = g.createLinearGradient(x0, 0, x1, 0); hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.35, 'rgba(255,255,255,.4)'); hl.addColorStop(0.6, 'rgba(255,255,255,.08)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl; rr(g, x0 + 6, top + 1.2, bw - 12, 2.2, 1); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x0 + 5, top + 6.5); g.lineTo(x1 - 5, top + 6.5); g.stroke();
  // bumper + diffuser
  const dg = g.createLinearGradient(0, by - 21, 0, by - 8); dg.addColorStop(0, '#22242a'); dg.addColorStop(1, '#08090b');
  g.fillStyle = dg; rr(g, x0 + 9, by - 20.5, bw - 18, 12.5, 3); g.fill();
  g.fillStyle = '#000'; for (let i = 0; i < 5; i++) g.fillRect(mid - 20 + i * 9.4, by - 13, 1.6, 5);
  // cabin
  const cb = bw * 0.8, ct = bw * 0.55, ccx = mid + sh * 0.45, ry = top - s.roof, sk = sh * 0.5;
  g.fillStyle = shade(color, -0.12);
  g.beginPath(); g.moveTo(ccx - cb / 2, top + 3); g.lineTo(ccx - ct / 2 + sk, ry + 2); g.quadraticCurveTo(ccx + sk, ry - 2.5, ccx + ct / 2 + sk, ry + 2); g.lineTo(ccx + cb / 2, top + 3); g.closePath(); g.fill();
  const gg = g.createLinearGradient(0, ry, 0, top + 2);
  gg.addColorStop(0, '#070b12'); gg.addColorStop(0.55, '#1d2c40'); gg.addColorStop(1, '#5d7a98');
  g.fillStyle = gg;
  g.beginPath(); g.moveTo(ccx - cb / 2 + 8, top + 1); g.lineTo(ccx - ct / 2 + sk + 5, ry + 5.5); g.quadraticCurveTo(ccx + sk, ry + 2.5, ccx + ct / 2 + sk - 5, ry + 5.5); g.lineTo(ccx + cb / 2 - 8, top + 1); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,.16)'; poly(g, [ccx - 8 + sk, ry + 5, ccx + 2 + sk, ry + 4.5, ccx - 9, top + 0.5, ccx - 20, top + 0.5]); g.fill();
  g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(ccx - 14 + sk * 0.6, ry + 9, 9, 6); g.fillRect(ccx + 5 + sk * 0.6, ry + 9, 9, 6); // headrests
  // wing
  if (s.wing === 2) {
    g.fillStyle = '#111317'; g.fillRect(x0 + 17, top - 10, 3.2, 11); g.fillRect(x1 - 20, top - 10, 3.2, 11);
    const wg = g.createLinearGradient(0, top - 14, 0, top - 8); wg.addColorStop(0, shade(color, 0.25)); wg.addColorStop(1, shade(color, -0.45));
    g.fillStyle = wg; rr(g, x0 + 1, top - 14, bw - 2, 5.5, 1.5); g.fill();
    g.fillStyle = shade(color, -0.5); g.fillRect(x0 + 0.5, top - 16, 2.4, 9); g.fillRect(x1 - 3, top - 16, 2.4, 9);
  } else if (s.wing === 1) { g.fillStyle = shade(color, 0.28); rr(g, x0 + 5, top - 2.2, bw - 10, 4, 2); g.fill(); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x0 + 6, top + 1.4, bw - 12, 0.8); }
  // lights (base + emissive copy)
  const lamp = (x: number, y: number, ww: number, hh: number, r: number) => {
    const lg = g.createLinearGradient(0, y, 0, y + hh); lg.addColorStop(0, '#ff5a4a'); lg.addColorStop(1, '#8f0c0c');
    g.fillStyle = lg; rr(g, x, y, ww, hh, r); g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)'; rr(g, x + 1, y + 0.8, ww - 2, hh * 0.3, r * 0.5); g.fill();
    e.fillStyle = '#ff3a26'; rr(e, x, y, ww, hh, r); e.fill();
  };
  if (s.lights === 'twin') { lamp(x0 + 6, top + 9, 27, 7, 2.5); lamp(x1 - 33, top + 9, 27, 7, 2.5); }
  else if (s.lights === 'bar') { lamp(x0 + 7, top + 8.5, bw - 14, 4.2, 2); }
  else if (s.lights === 'round') { for (const k of [0, 1]) { lamp(x0 + 7 + k * 11, top + 8, 9, 9, 4.5); lamp(x1 - 16 - k * 11, top + 8, 9, 9, 4.5); } }
  else { lamp(x0 + 5, top + 8, 13, 15, 2.5); lamp(x1 - 18, top + 8, 13, 15, 2.5); }
  // plate, badge, exhausts
  g.fillStyle = '#f1f0e6'; rr(g, mid - 11, top + (s.lights === 'bar' ? 16 : 19), 22, 7.5, 1); g.fill();
  g.fillStyle = '#23262c'; g.fillRect(mid - 8, top + (s.lights === 'bar' ? 18.4 : 21.4), 16, 2.6);
  g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(mid, top + 12.5, 1.5, 0, 7); g.fill();
  const pipe = (x: number) => { const pg = g.createRadialGradient(x, by - 12.5, 0.5, x, by - 12.5, 3.6); pg.addColorStop(0, '#000'); pg.addColorStop(0.6, '#15171a'); pg.addColorStop(0.75, '#b9bec8'); pg.addColorStop(1, '#4a4e57'); g.fillStyle = pg; g.beginPath(); g.arc(x, by - 12.5, 3.6, 0, 7); g.fill(); };
  if (s.pipes === 1) pipe(x1 - 27); else if (s.pipes === 2) { pipe(x0 + 28); pipe(x1 - 28); } else { pipe(x0 + 25); pipe(x0 + 33); pipe(x1 - 25); pipe(x1 - 33); }
}

export const carKey = (cls: number, color: number, frame: number) => `${cls}_${color}_${frame}`;

/** Sprite sheet holding only the cars on this grid. */
export function buildCarSheet(cars: { classId: number; color: number }[]) {
  const mk = () => { const c = document.createElement('canvas'); c.width = 4096; c.height = 2048; return c; };
  const base = mk(), emis = mk(), g = base.getContext('2d')!, e = emis.getContext('2d')!;
  const sprites: Record<string, SpriteInfo> = {};
  const PAD = 6, cols = Math.floor(4096 / (SW + PAD));
  let n = 0;
  for (const c of cars) {
    if (sprites[carKey(c.classId, c.color, 0)]) continue;
    for (let f = 0; f < CAR_FRAMES; f++) {
      const x = PAD / 2 + (n % cols) * (SW + PAD), y = PAD / 2 + Math.floor(n / cols) * (SH + PAD); n++;
      if (y + SH > 2048) break;
      for (const ctx of [g, e]) { ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.rect(0, 0, SW, SH); ctx.clip(); ctx.scale(K, K); }
      drawRear(g, e, c.classId, CAR_COLORS[c.color], f);
      g.restore(); e.restore();
      sprites[carKey(c.classId, c.color, f)] = { u0: x / 4096, v0: y / 2048, u1: (x + SW) / 4096, v1: (y + SH) / 2048, w: CAR_WORLD_W, h: (CAR_WORLD_W * SH) / SW };
    }
  }
  return { base, emis, sprites };
}

// ---------------------------------------------------------------- showroom renders
interface Side { roofY: number; cabA: number; cabB: number; wsX: number; noseY: number; tailY: number; len: number; wing: 0 | 1 | 2; rideH: number }
const SIDES: Side[] = [
  { roofY: 44, cabA: 96, cabB: 172, wsX: 222, noseY: 80, tailY: 70, len: 300, wing: 1, rideH: 0 },
  { roofY: 50, cabA: 118, cabB: 180, wsX: 232, noseY: 86, tailY: 74, len: 312, wing: 2, rideH: 2 },
  { roofY: 42, cabA: 92, cabB: 160, wsX: 204, noseY: 78, tailY: 68, len: 284, wing: 2, rideH: 0 },
  { roofY: 36, cabA: 70, cabB: 178, wsX: 226, noseY: 76, tailY: 60, len: 304, wing: 0, rideH: -2 },
];
function wheel(g: G, x: number, y: number, r: number) {
  g.fillStyle = '#0b0b0d'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  const rg = g.createRadialGradient(x - r * 0.2, y - r * 0.25, 1, x, y, r * 0.68); rg.addColorStop(0, '#f2f4f8'); rg.addColorStop(1, '#6d737e');
  g.fillStyle = rg; g.beginPath(); g.arc(x, y, r * 0.68, 0, 7); g.fill();
  g.strokeStyle = '#1a1b1f'; g.lineWidth = r * 0.16;
  for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.283 + 0.3; g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.18, y + Math.sin(a) * r * 0.18); g.lineTo(x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66); g.stroke(); }
  g.fillStyle = '#23252a'; g.beginPath(); g.arc(x, y, r * 0.2, 0, 7); g.fill();
}
/** Side profile in a 360 x 150 design space (car faces right). */
function drawSide(g: G, cls: number, color: string) {
  const s = SIDES[cls], x0 = 30, x1 = x0 + s.len, gy = 122, wr = 21, wy = gy - wr, fw = x1 - 62, rw = x0 + 58, belly = gy - 14 + s.rideH;
  const fl = g.createLinearGradient(0, gy, 0, gy + 26); fl.addColorStop(0, 'rgba(0,0,0,.55)'); fl.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fl; g.beginPath(); g.ellipse((x0 + x1) / 2, gy + 3, s.len * 0.52, 9, 0, 0, 7); g.fill();
  const bg = g.createLinearGradient(0, s.roofY, 0, gy - 8);
  bg.addColorStop(0, shade(color, 0.5)); bg.addColorStop(0.3, shade(color, 0.1)); bg.addColorStop(0.62, color); bg.addColorStop(1, shade(color, -0.6));
  g.fillStyle = bg; g.beginPath();
  g.moveTo(x0 + 4, belly); g.lineTo(x0, s.tailY + 16); g.quadraticCurveTo(x0 - 2, s.tailY + 2, x0 + 10, s.tailY);
  g.lineTo(s.cabA - 14, s.tailY - 4); g.quadraticCurveTo(s.cabA, s.roofY + 2, s.cabA + 22, s.roofY);
  g.lineTo(s.cabB, s.roofY); g.quadraticCurveTo(s.cabB + 20, s.roofY + 2, s.wsX, s.noseY - 14);
  g.quadraticCurveTo(x1 - 30, s.noseY - 8, x1 - 4, s.noseY + 4); g.quadraticCurveTo(x1 + 4, s.noseY + 14, x1 - 2, belly);
  g.closePath(); g.fill();
  // glass
  const gl = g.createLinearGradient(0, s.roofY, 0, s.noseY); gl.addColorStop(0, '#0a1220'); gl.addColorStop(1, '#5d7d9e');
  g.fillStyle = gl; g.beginPath();
  g.moveTo(s.cabA - 4, s.tailY - 6); g.quadraticCurveTo(s.cabA + 6, s.roofY + 6, s.cabA + 24, s.roofY + 5);
  g.lineTo(s.cabB - 2, s.roofY + 5); g.quadraticCurveTo(s.cabB + 14, s.roofY + 7, s.wsX - 8, s.noseY - 15); g.closePath(); g.fill();
  g.fillStyle = shade(color, -0.2); g.fillRect((s.cabA + s.cabB) / 2 + 6, s.roofY + 4, 5, s.tailY - s.roofY - 8);
  g.fillStyle = 'rgba(255,255,255,.2)'; poly(g, [s.cabB - 30, s.roofY + 6, s.cabB - 14, s.roofY + 6, s.cabB - 34, s.noseY - 16, s.cabB - 50, s.noseY - 16]); g.fill();
  // lower sill, door line, highlights
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(rw + wr + 4, belly - 5, fw - rw - 2 * wr - 8, 5);
  g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(s.cabB - 6, s.noseY - 12); g.lineTo(s.cabB - 2, belly - 6); g.moveTo(s.cabA + 20, s.tailY - 2); g.lineTo(s.cabA + 26, belly - 6); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x0 + 14, s.tailY + 8); g.quadraticCurveTo((x0 + x1) / 2, s.noseY - 6, x1 - 26, s.noseY + 6); g.stroke();
  // lights
  g.fillStyle = '#ffe9a8'; g.beginPath(); g.ellipse(x1 - 14, s.noseY + 5, 11, 3.6, -0.25, 0, 7); g.fill();
  g.fillStyle = '#e02a1c'; rr(g, x0, s.tailY + 5, 9, 8, 2); g.fill();
  if (s.wing === 2) { g.fillStyle = '#141519'; g.fillRect(x0 + 16, s.tailY - 17, 4, 16); g.fillStyle = shade(color, -0.25); poly(g, [x0 - 2, s.tailY - 22, x0 + 40, s.tailY - 19, x0 + 40, s.tailY - 15, x0 - 2, s.tailY - 16]); g.fill(); }
  else if (s.wing === 1) { g.fillStyle = shade(color, 0.2); poly(g, [x0 + 2, s.tailY - 1, x0 + 26, s.tailY - 5, x0 + 28, s.tailY - 2, x0 + 6, s.tailY + 3]); g.fill(); }
  // arches + wheels
  g.fillStyle = '#060607'; for (const wx of [rw, fw]) { g.beginPath(); g.arc(wx, wy + 1, wr + 4, Math.PI, 0); g.fill(); }
  wheel(g, rw, wy, wr); wheel(g, fw, wy, wr);
}

const cache = new Map<string, string>();
/** Large showroom image (data URL): side profile on a lit floor plus a rear three-quarter view. */
export function showroomImage(cls: number, color: number): string {
  const key = cls + '_' + color; const hit = cache.get(key); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = 1240; c.height = 420;
  const g = c.getContext('2d')!;
  const fl = g.createRadialGradient(620, 370, 20, 620, 370, 640); fl.addColorStop(0, 'rgba(255,255,255,.2)'); fl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = fl; g.beginPath(); g.ellipse(620, 372, 620, 46, 0, 0, 7); g.fill();
  g.save(); g.translate(10, 12); g.scale(2.25, 2.25); drawSide(g, cls, CAR_COLORS[color]); g.restore();
  g.save(); g.globalAlpha = 0.14; g.translate(10, 12 + 2 * 122 * 2.25 + 8); g.scale(2.25, -2.25); drawSide(g, cls, CAR_COLORS[color]); g.restore();
  const dummy = document.createElement('canvas').getContext('2d')!;
  g.save(); g.translate(800, 92); g.scale(2.8, 2.8); drawRear(g, dummy, cls, CAR_COLORS[color], 3); g.restore();
  const url = c.toDataURL(); cache.set(key, url); return url;
}
/** Small rear thumbnail (data URL) for lists. */
export function carThumb(cls: number, color: number): string {
  const key = 't' + cls + '_' + color; const hit = cache.get(key); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = 230; c.height = 144;
  const g = c.getContext('2d')!; g.scale(1.5, 1.5);
  drawRear(g, document.createElement('canvas').getContext('2d')!, cls, CAR_COLORS[color], 0);
  const url = c.toDataURL(); cache.set(key, url); return url;
}
