import { CAR_COLORS } from '../../../shared/src/index';
import { CarRenderer, hexRgb } from './carrender';

/** World units per metre for the car models. */
export const CAR_U = 410;

export function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

let baker: CarRenderer | null = null;
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
