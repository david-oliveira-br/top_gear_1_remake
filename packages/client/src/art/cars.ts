import { CAR_COLORS } from '../../../shared/src/index';
import type { SpriteInfo } from './atlas';
import { CarRenderer, hexRgb } from './carrender';

// Race sprites are baked from the 3D car models: one row per car, one frame per yaw angle.
export const FRAME_YAWS = [0, 6, 13, 21, 30, 40, 50]; // degrees; negative yaw mirrors the frame
const PX_PER_M = 110, HEIGHT_M = 2.4, BASE_M = 0.72, ELEV = (13 * Math.PI) / 180, PAD = 8;
/** World units per metre, and how far below the car's road point the sprite's bottom edge sits. */
export const CAR_U = 410, CAR_BASE = BASE_M * CAR_U;
const frameM = (deg: number) => { const a = (deg * Math.PI) / 180; return 2.0 * Math.cos(a) + 4.85 * Math.sin(a) + 0.5; };
const FRAME_PX = FRAME_YAWS.map((d) => Math.ceil(frameM(d) * PX_PER_M)), ROW_H = Math.round(HEIGHT_M * PX_PER_M);
const STRIP_W = FRAME_PX.reduce((a, b) => a + b + PAD, 0);

export function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

let baker: CarRenderer | null = null;
const strips = new Map<string, { base: HTMLCanvasElement; emis: HTMLCanvasElement }>();
/** Render (and cache) the strip of frames for one car/colour. */
function strip(cls: number, color: number) {
  const key = cls + '_' + color; const hit = strips.get(key); if (hit) return hit;
  baker ??= new CarRenderer();
  const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const base = mk(STRIP_W, ROW_H), emis = mk(STRIP_W >> 1, ROW_H >> 1);
  const g = base.getContext('2d')!, e = emis.getContext('2d')!;
  g.imageSmoothingQuality = 'high'; e.imageSmoothingQuality = 'high';
  // all frames of the strip are rendered into one canvas, then copied out once (read-backs are the slow part)
  for (const [ctx, k, emisPass] of [[g, 1, false], [e, 0.5, true]] as [CanvasRenderingContext2D, number, boolean][]) {
    const W = Math.round(STRIP_W * k), H = Math.round(ROW_H * k);
    let x = PAD / 2;
    FRAME_YAWS.forEach((deg, i) => {
      const w = FRAME_PX[i];
      baker!.draw({ cls, color: hexRgb(CAR_COLORS[color]), yaw: (deg * Math.PI) / 180, elev: ELEV, w: W, h: H, emis: emisPass,
        vp: [Math.round(x * k), 0, Math.round(w * k), H], ortho: { widthM: w / PX_PER_M, heightM: HEIGHT_M, centreY: HEIGHT_M / 2 - BASE_M } });
      x += w + PAD;
    });
    ctx.drawImage(baker!.canvas, 0, 0);
  }
  const s = { base, emis }; strips.set(key, s); return s;
}

export const carKey = (cls: number, color: number, frame: number) => `${cls}_${color}_${frame}`;

/** Sprite sheet holding only the cars on this grid. The emissive sheet is half resolution with the same UVs. */
export function buildCarSheet(cars: { classId: number; color: number }[]) {
  const uniq = [...new Map(cars.map((c) => [c.classId + '_' + c.color, c])).values()];
  const W = 4096, H = Math.max(ROW_H + PAD, uniq.length * (ROW_H + PAD));
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  const emis = document.createElement('canvas'); emis.width = W >> 1; emis.height = H >> 1;
  const g = base.getContext('2d')!, e = emis.getContext('2d')!;
  e.fillStyle = '#000'; e.fillRect(0, 0, emis.width, emis.height);
  const sprites: Record<string, SpriteInfo> = {};
  uniq.forEach((c, row) => {
    const s = strip(c.classId, c.color), y = PAD / 2 + row * (ROW_H + PAD);
    g.drawImage(s.base, 0, y); e.drawImage(s.emis, 0, y / 2);
    let x = PAD / 2;
    FRAME_YAWS.forEach((_, i) => {
      const w = FRAME_PX[i];
      sprites[carKey(c.classId, c.color, i)] = { u0: x / W, v0: y / H, u1: (x + w) / W, v1: (y + ROW_H) / H, w: (w / PX_PER_M) * CAR_U, h: HEIGHT_M * CAR_U };
      x += w + PAD;
    });
  });
  return { base, emis, sprites };
}

const thumbs = new Map<string, string>();
/** Rear three-quarter thumbnail (data URL) for menus. */
export function carThumb(cls: number, color: number): string {
  const key = cls + '_' + color; const hit = thumbs.get(key); if (hit) return hit;
  baker ??= new CarRenderer();
  baker.draw({ cls, color: hexRgb(CAR_COLORS[color]), yaw: 0.6, elev: 0.3, w: 612, h: 384, ortho: { widthM: 5.4, heightM: 3.39, centreY: 0.75 } });
  const url = baker.canvas.toDataURL(); thumbs.set(key, url); return url;
}

let stage: CarRenderer | null = null;
/** Draw the live showroom view into the given canvas. */
export function drawShowroom(canvas: HTMLCanvasElement, cls: number, color: number, yaw: number) {
  if (!stage || stage.canvas !== canvas) stage = new CarRenderer(canvas);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
  stage.draw({ cls, color: hexRgb(CAR_COLORS[color]), yaw, elev: 0.1, w, h, studio: true, persp: { dist: 8.2, fov: 0.42, centreY: 0.52 } });
}
