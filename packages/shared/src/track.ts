import { easeIn, easeInOut, mulberry32 } from './util';

export const SEG_LEN = 200;
export const ROAD_W = 2000; // half width of the road in world units
export const PIT_X0 = 1.12;
export const PIT_X1 = 1.95;

export type ThemeId = 'tropical' | 'desert' | 'city' | 'snow' | 'sakura' | 'forest';
export type TimeOfDay = 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'rain' | 'fog' | 'snow';

export interface Sprite { kind: string; offset: number; solid: boolean }
export interface Segment { curve: number; y1: number; y2: number; sprites: Sprite[]; pit: boolean }

/** ['s', n] straight · ['c', n, curve, hill?] curve · ['h', n, hill] hill */
export type Op = ['s', number] | ['c', number, number, number?] | ['h', number, number];

export interface TrackDef {
  id: string; name: string; country: string; theme: ThemeId;
  time: TimeOfDay; weather: Weather; laps: number; seed: number; ops: Op[];
}
export interface Track extends TrackDef {
  segments: Segment[]; length: number; pitStart: number; pitEnd: number;
}

const SCENERY: Record<ThemeId, { kinds: [string, number][]; density: number; lamps: boolean }> = {
  tropical: { kinds: [['palm', 6], ['bush', 3], ['rock', 1], ['house', 1]], density: 0.16, lamps: false },
  desert: { kinds: [['cactus', 5], ['rock', 4], ['deadtree', 2], ['bush', 1]], density: 0.1, lamps: false },
  city: { kinds: [['building_a', 3], ['building_b', 3], ['building_c', 3], ['tree', 1]], density: 0.13, lamps: true },
  snow: { kinds: [['snowpine', 7], ['snowrock', 2], ['cabin', 1]], density: 0.18, lamps: false },
  sakura: { kinds: [['sakura', 6], ['pine', 2], ['bush', 2], ['house', 1]], density: 0.16, lamps: false },
  forest: { kinds: [['pine', 6], ['tree', 4], ['bush', 2], ['rock', 1], ['cabin', 1]], density: 0.2, lamps: false },
};
const WIDE = new Set(['building_a', 'building_b', 'building_c', 'house', 'cabin']);

export function buildTrack(def: TrackDef): Track {
  const segs: Segment[] = [];
  const lastY = () => (segs.length ? segs[segs.length - 1].y2 : 0);
  const add = (curve: number, y: number) => segs.push({ curve, y1: lastY(), y2: y, sprites: [], pit: false });
  const road = (enter: number, hold: number, leave: number, curve: number, hill: number) => {
    const startY = lastY(), endY = startY + hill * SEG_LEN, total = enter + hold + leave;
    for (let n = 0; n < enter; n++) add(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    for (let n = 0; n < hold; n++) add(curve, easeInOut(startY, endY, (enter + n) / total));
    for (let n = 0; n < leave; n++) add(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
  };

  road(0, 120, 0, 0, 0); // start straight
  for (const op of def.ops) {
    if (op[0] === 's') road(0, op[1], 0, 0, 0);
    else if (op[0] === 'h') road(op[1] / 4, op[1] / 2, op[1] / 4, 0, op[2]);
    else road(op[1] / 4, op[1] / 2, op[1] / 4, op[2], op[3] ?? 0);
  }
  road(60, 60, 60, 0, -lastY() / SEG_LEN); // bring height back to 0
  let tail = 264;
  tail += (6 - ((segs.length + tail) % 6)) % 6; // keep road paint pattern seamless
  road(0, tail, 0, 0, 0);
  for (const s of segs) { s.y1 = Math.round(s.y1); s.y2 = Math.round(s.y2); }
  segs[segs.length - 1].y2 = 0;

  const n = segs.length;
  const pitStart = n - 210, pitEnd = n - 50;
  for (let i = pitStart; i < pitEnd; i++) segs[i].pit = true;

  // scenery
  const th = SCENERY[def.theme];
  const rnd = mulberry32(def.seed);
  const total = th.kinds.reduce((a, k) => a + k[1], 0);
  const pick = () => {
    let r = rnd() * total;
    for (const [k, w] of th.kinds) { if ((r -= w) <= 0) return k; }
    return th.kinds[0][0];
  };
  const put = (i: number, kind: string, offset: number, solid = true) =>
    segs[((i % n) + n) % n].sprites.push({ kind, offset, solid });

  for (let i = 0; i < n; i++) {
    const s = segs[i];
    for (const side of [-1, 1]) {
      if (rnd() < th.density) {
        const kind = pick();
        let off = (WIDE.has(kind) ? 2.6 : 1.5) + rnd() * rnd() * 5;
        if (side > 0 && s.pit) off += 1.3;
        put(i, kind, side * off);
      }
    }
    if (th.lamps && i % 30 === 0) { put(i, 'lamp', -1.3); if (!s.pit) put(i, 'lamp', 1.3); }
    if (Math.abs(s.curve) >= 3 && i % 24 === 0) {
      if (s.curve > 0) put(i, 'sign_right', -1.4); else if (!s.pit) put(i, 'sign_left', 1.4);
    }
    if (i % 170 === 85) {
      const side = (i / 170) % 2 < 1 ? -1 : 1;
      put(i, ['billboard_a', 'billboard_b', 'billboard_c'][Math.floor(rnd() * 3)], side * (s.pit && side > 0 ? 3.2 : 1.9));
    }
  }
  put(0, 'arch', 0, false);
  for (let i = n - 60; i < n + 40; i += 12) put(i, 'stand', -2.7);

  return { ...def, segments: segs, length: n * SEG_LEN, pitStart, pitEnd };
}

const D = (id: string, name: string, country: string, theme: ThemeId, time: TimeOfDay, weather: Weather,
  laps: number, seed: number, ops: Op[]): TrackDef => ({ id, name, country, theme, time, weather, laps, seed, ops });

export const TRACK_DEFS: TrackDef[] = [
  D('costa', 'Costa Dourada', 'Brazil', 'tropical', 'day', 'clear', 3, 11, [
    ['s', 80], ['c', 200, 2], ['c', 160, -3, 20], ['s', 100], ['c', 240, 4, -20], ['h', 160, 30], ['c', 120, -2],
    ['s', 120], ['c', 200, -4.5, -30], ['c', 160, 3, 10], ['s', 60], ['c', 240, 5], ['c', 120, -3, 20], ['s', 150], ['c', 200, 2, -20]]),
  D('selva', 'Selva Run', 'Brazil', 'tropical', 'dusk', 'rain', 4, 12, [
    ['c', 160, -2, 15], ['c', 160, 3, -15], ['h', 120, 25], ['c', 280, -4, -10], ['s', 90], ['c', 120, 5, 10], ['c', 120, -5, -10],
    ['s', 140], ['c', 200, 3, 30], ['h', 100, -40], ['c', 240, -3.5], ['s', 80], ['c', 160, 4, 10], ['c', 200, -2, -10], ['s', 100]]),
  D('metropole', 'Metropole Night', 'Brazil', 'city', 'night', 'clear', 4, 13, [
    ['s', 200], ['c', 120, 5.5], ['s', 160], ['c', 120, -5.5], ['s', 100], ['c', 200, 3, 15], ['h', 120, -15], ['c', 160, -4],
    ['s', 220], ['c', 100, 6], ['s', 80], ['c', 100, -6], ['s', 140], ['c', 240, 2.5], ['s', 120], ['c', 160, -3]]),
  D('mojave', 'Mojave Flats', 'USA', 'desert', 'day', 'clear', 3, 21, [
    ['s', 300], ['c', 320, 1.5], ['h', 200, 20], ['s', 200], ['c', 280, -2.5, -20], ['s', 260], ['c', 200, 4], ['h', 160, 30],
    ['c', 240, -1.5, -30], ['s', 300], ['c', 160, 3], ['c', 160, -3], ['s', 200]]),
  D('canyon', 'Red Canyon', 'USA', 'desert', 'dusk', 'clear', 4, 22, [
    ['h', 160, 40], ['c', 200, 4, 20], ['c', 160, -5, -30], ['h', 120, 45], ['c', 240, 3, -45], ['s', 100], ['c', 140, -6, 20],
    ['c', 140, 5, -20], ['h', 200, 50], ['c', 200, -3, -50], ['s', 120], ['c', 180, 4.5, 25], ['c', 180, -2.5, -25], ['s', 140]]),
  D('downtown', 'Downtown Storm', 'USA', 'city', 'night', 'rain', 5, 23, [
    ['s', 180], ['c', 110, -5], ['s', 120], ['c', 110, -5], ['s', 220], ['c', 160, 4, 10], ['c', 160, -3, -10], ['s', 150],
    ['c', 110, 5.5], ['s', 100], ['c', 200, 2.5], ['s', 160], ['c', 130, -4.5], ['s', 120], ['c', 180, 3]]),
  D('sakura', 'Sakura Hills', 'Japan', 'sakura', 'day', 'clear', 3, 31, [
    ['c', 200, 2.5, 20], ['c', 200, -2.5, -20], ['s', 120], ['c', 260, 4, 30], ['h', 140, -30], ['c', 180, -3.5], ['s', 100],
    ['c', 140, 5, 15], ['c', 140, -5, -15], ['s', 160], ['c', 300, -2, 20], ['h', 120, -20], ['c', 200, 3.5], ['s', 120]]),
  D('touge', 'Mist Pass', 'Japan', 'forest', 'dusk', 'fog', 4, 32, [
    ['h', 120, 35], ['c', 150, 5, 20], ['c', 150, -5.5, 20], ['c', 150, 5, 20], ['s', 80], ['c', 200, -4, -30], ['h', 100, 30],
    ['c', 160, 6, -25], ['c', 160, -4.5, -25], ['s', 120], ['c', 220, 3, -20], ['c', 180, -5, 10], ['c', 140, 4, -35], ['s', 100]]),
  D('neon', 'Neon Bay', 'Japan', 'city', 'night', 'clear', 5, 33, [
    ['s', 260], ['c', 200, 3], ['s', 140], ['c', 100, -6], ['c', 100, 6], ['s', 200], ['c', 260, -3.5, 20], ['h', 140, -20],
    ['s', 180], ['c', 140, 5], ['s', 120], ['c', 220, -2.5], ['c', 120, 4.5], ['s', 160]]),
  D('fjord', 'Fjord Line', 'Norway', 'forest', 'day', 'clear', 3, 41, [
    ['c', 260, -2, 25], ['h', 140, -25], ['c', 220, 3.5], ['s', 140], ['c', 180, -4.5, 30], ['c', 180, 4, -30], ['s', 120],
    ['h', 180, 40], ['c', 300, 2.5, -40], ['s', 100], ['c', 160, -5], ['c', 200, 3, 15], ['h', 100, -15], ['s', 140]]),
  D('tundra', 'Tundra Drift', 'Norway', 'snow', 'day', 'snow', 4, 42, [
    ['s', 160], ['c', 240, 3, 15], ['c', 200, -3.5, -15], ['s', 120], ['c', 180, 4, 20], ['h', 120, -20], ['c', 260, -2.5],
    ['s', 140], ['c', 160, 4.5, 10], ['c', 160, -4, -10], ['s', 180], ['c', 220, 3], ['c', 140, -3], ['s', 100]]),
  D('aurora', 'Aurora Ring', 'Norway', 'snow', 'night', 'clear', 5, 43, [
    ['s', 220], ['c', 280, 2.5, 20], ['h', 160, -20], ['c', 200, -4], ['s', 160], ['c', 150, 5, 25], ['c', 150, -5, -25],
    ['s', 200], ['c', 300, -2], ['h', 140, 30], ['c', 200, 3.5, -30], ['s', 160], ['c', 160, -3], ['s', 120]]),
];

const cache = new Map<string, Track>();
export function getTrack(id: string): Track {
  let t = cache.get(id);
  if (!t) {
    const def = TRACK_DEFS.find((d) => d.id === id) ?? TRACK_DEFS[0];
    t = buildTrack(def);
    cache.set(id, t);
  }
  return t;
}
