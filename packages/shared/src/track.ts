import { easeIn, easeInOut, mulberry32 } from './util';

export const SEG_LEN = 200;
export const ROAD_W = 2000; // half width of the road in world units
export const PIT_X0 = 1.12;
export const PIT_X1 = 1.95;

export type ThemeId = 'tropical' | 'desert' | 'city' | 'snow' | 'sakura' | 'forest' | 'tuscany' | 'moor' | 'dunes' | 'outback';
export type Shift = 'none' | 'nightfall' | 'storm' | 'clearing';
export const COUNTRIES = ['Brazil', 'USA', 'Japan', 'Norway', 'Italy', 'UK', 'Egypt', 'Australia'] as const;
export type TimeOfDay = 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'rain' | 'fog' | 'snow';

export interface Sprite { kind: string; offset: number; solid: boolean }
export interface Segment { curve: number; y1: number; y2: number; sprites: Sprite[]; pit: boolean }

/** ['s', n] straight · ['c', n, curve, hill?] curve · ['h', n, hill] hill · ['t', n] tunnel straight */
export type Op = ['s', number] | ['c', number, number, number?] | ['h', number, number] | ['t', number];

export interface TrackDef {
  id: string; name: string; country: string; theme: ThemeId;
  time: TimeOfDay; weather: Weather; laps: number; seed: number; ops: Op[]; shift: Shift;
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
  tuscany: { kinds: [['cypress', 6], ['tree', 2], ['villa', 1], ['bush', 2], ['haybale', 2]], density: 0.15, lamps: false },
  moor: { kinds: [['oak', 4], ['hedge', 5], ['cottage', 1], ['bush', 2], ['rock', 1]], density: 0.17, lamps: false },
  dunes: { kinds: [['datepalm', 5], ['ruin', 2], ['rock', 3], ['deadtree', 1]], density: 0.09, lamps: false },
  outback: { kinds: [['gumtree', 5], ['redrock', 3], ['bush', 3], ['deadtree', 1]], density: 0.11, lamps: false },
};
const SMALL: Record<ThemeId, string> = { tropical: 'bush', desert: 'rock', city: 'bush', snow: 'snowrock', sakura: 'bush', forest: 'bush', tuscany: 'haybale', moor: 'bush', dunes: 'rock', outback: 'redrock' };
const WIDE = new Set(['building_a', 'building_b', 'building_c', 'house', 'cabin', 'villa', 'cottage', 'ruin']);

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
  const tunnels: [number, number][] = [];
  for (const op of def.ops) {
    if (op[0] === 's') road(0, op[1], 0, 0, 0);
    else if (op[0] === 't') { tunnels.push([segs.length, segs.length + op[1]]); road(0, op[1], 0, 0, 0); }
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

  const inTunnel = (i: number) => tunnels.some(([a, b]) => i >= a - 6 && i < b + 6);
  for (const [a, b] of tunnels) for (let i = a; i < b; i += 2) put(i, i === a || i >= b - 2 ? 'portal' : 'tunnel', 0, false);
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    if (inTunnel(i)) continue;
    for (const side of [-1, 1]) {
      if (rnd() < th.density) {
        const kind = pick();
        let off = (WIDE.has(kind) ? 2.6 : 1.5) + rnd() * rnd() * 5;
        if (side > 0 && s.pit) off += 1.3;
        put(i, kind, side * off);
      }
    }
    if (i % 4 === 0) { put(i, 'post', -1.17, false); put(i, 'post', s.pit ? 2.06 : 1.17, false); }
    for (const side of [-1, 1]) { // low clutter right at the verge
      if (rnd() < 0.07 && !(side > 0 && s.pit)) put(i, SMALL[def.theme], side * (1.32 + rnd() * 0.5), false);
    }
    if (th.lamps && i % 20 === 0) { put(i, 'lamp', -1.3); if (!s.pit) put(i, 'lamp', 1.3); }
    if (Math.abs(s.curve) >= 2 && i % 12 === 0) {
      if (s.curve > 0) put(i, 'sign_right', -1.4); else if (!s.pit) put(i, 'sign_left', 1.4);
    }
    if (i % 400 === 250 && !s.pit && Math.abs(s.curve) < 1) put(i, 'gantry', 0, false);
    if (i % 9 === 0 && Math.abs(s.curve) >= 2.5) put(i, 'fence', s.curve > 0 ? -1.22 : 1.22, false);
    if (i % 170 === 85) {
      const side = (i / 170) % 2 < 1 ? -1 : 1;
      put(i, ['billboard_a', 'billboard_b', 'billboard_c'][Math.floor(rnd() * 3)], side * (s.pit && side > 0 ? 3.2 : 1.9));
    }
  }
  put(0, 'arch', 0, false);
  for (let i = n - 60; i < n + 40; i += 12) put(i, 'stand', -2.7);
  for (let i = pitStart; i < pitEnd; i += 6) put(i, 'fence', 2.02, false);

  return { ...def, segments: segs, length: n * SEG_LEN, pitStart, pitEnd };
}

/** Seeded layout generator for an original circuit: twist 0..1 (how sharp/frequent the corners), hills 0..1. */
function layout(seed: number, segs: number, twist: number, hills: number, tunnel = false): Op[] {
  const r = mulberry32(seed * 7919 + 13);
  const ops: Op[] = [];
  let total = 0, dir = r() < 0.5 ? 1 : -1, tun = tunnel;
  while (total < segs) {
    const k = r();
    let n: number;
    if (k < 0.22 - twist * 0.1) { n = 80 + Math.floor(r() * 5) * 40; if (tun && total > segs * 0.3) { ops.push(['t', 120]); tun = false; n = 120; } else ops.push(['s', n]); }
    else if (k < 0.3 && hills > 0.2) { n = 120 + Math.floor(r() * 3) * 40; ops.push(['h', n, Math.round((r() < 0.5 ? -1 : 1) * (15 + hills * 35))]); }
    else {
      n = 100 + Math.floor(r() * 6) * 40;
      const sharp = 1.5 + r() * (2 + twist * 3.2);
      const curve = Math.round(Math.min(6, sharp * (n < 180 ? 1.15 : 0.85)) * 2) / 2;
      if (r() < 0.7) dir = -dir;
      const hill = r() < hills ? Math.round((r() < 0.5 ? -1 : 1) * (10 + hills * 30)) : 0;
      ops.push(['c', n, dir * curve, hill]);
      if (twist > 0.6 && r() < 0.35) { ops.push(['c', n, -dir * curve, -hill]); total += n; }
    }
    total += n;
  }
  return ops;
}

const D = (id: string, name: string, country: string, theme: ThemeId, time: TimeOfDay, weather: Weather,
  laps: number, seed: number, ops: Op[], shift: Shift = 'none'): TrackDef => ({ id, name, country, theme, time, weather, laps, seed, ops, shift });

const HAND: TrackDef[] = [
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

const G = (id: string, name: string, country: string, theme: ThemeId, time: TimeOfDay, weather: Weather, laps: number, seed: number,
  segs: number, twist: number, hills: number, shift: Shift = 'none', tunnel = false): TrackDef =>
  D(id, name, country, theme, time, weather, laps, seed, layout(seed, segs, twist, hills, tunnel), shift);
const hand = (id: string, shift: Shift = 'none'): TrackDef => ({ ...HAND.find((t) => t.id === id)!, shift });

/** World tour order: 8 countries x 4 circuits. */
export const TRACK_DEFS: TrackDef[] = [
  hand('costa'), hand('selva'), G('serra', 'Serra Alta', 'Brazil', 'forest', 'day', 'clear', 3, 14, 2500, 0.7, 0.9, 'storm', true), hand('metropole'),
  hand('mojave'), hand('canyon', 'nightfall'), G('coast1', 'Pacific Drive', 'USA', 'tropical', 'day', 'clear', 4, 24, 2300, 0.45, 0.5), hand('downtown'),
  hand('sakura'), hand('touge'), G('expo', 'Harbor Expressway', 'Japan', 'city', 'dusk', 'clear', 4, 34, 2400, 0.3, 0.2, 'nightfall', true), hand('neon'),
  hand('fjord'), hand('tundra'), G('glacier', 'Glacier Pass', 'Norway', 'snow', 'dusk', 'clear', 3, 44, 2500, 0.75, 0.9, 'nightfall', true), hand('aurora'),
  G('colline', 'Colline d’Oro', 'Italy', 'tuscany', 'day', 'clear', 3, 51, 2400, 0.5, 0.7),
  G('lago', 'Lago Azzurro', 'Italy', 'tuscany', 'day', 'rain', 4, 52, 2300, 0.65, 0.5, 'clearing', true),
  G('stradale', 'Stradale Vecchia', 'Italy', 'tuscany', 'dusk', 'clear', 4, 53, 2500, 0.85, 0.6, 'nightfall'),
  G('notturno', 'Gran Notturno', 'Italy', 'city', 'night', 'clear', 5, 54, 2300, 0.4, 0.2),
  G('dales', 'Dales Run', 'UK', 'moor', 'day', 'clear', 3, 61, 2500, 0.6, 0.7, 'storm'),
  G('highland', 'Highland Loop', 'UK', 'moor', 'day', 'fog', 4, 62, 2400, 0.8, 0.9),
  G('seafront', 'Seafront Sprint', 'UK', 'moor', 'dusk', 'rain', 4, 63, 2200, 0.35, 0.2),
  G('capital', 'Capital Ring', 'UK', 'city', 'night', 'rain', 5, 64, 2300, 0.5, 0.2, 'none', true),
  G('oasis', 'Oasis Road', 'Egypt', 'dunes', 'day', 'clear', 3, 71, 2700, 0.3, 0.4),
  G('valley', 'Valley of Echoes', 'Egypt', 'dunes', 'dusk', 'clear', 4, 72, 2400, 0.7, 0.8, 'nightfall'),
  G('delta', 'Delta Dash', 'Egypt', 'dunes', 'day', 'clear', 4, 73, 2300, 0.55, 0.3),
  G('lanterns', 'City of Lanterns', 'Egypt', 'city', 'night', 'clear', 5, 74, 2300, 0.45, 0.2),
  G('redcentre', 'Red Centre', 'Australia', 'outback', 'day', 'clear', 3, 81, 2800, 0.25, 0.4),
  G('ranges', 'Blue Ranges', 'Australia', 'outback', 'day', 'clear', 4, 82, 2400, 0.8, 0.9, 'storm', true),
  G('reef', 'Reef Highway', 'Australia', 'tropical', 'dusk', 'clear', 4, 83, 2400, 0.5, 0.4, 'nightfall'),
  G('harbour', 'Harbour Lights', 'Australia', 'city', 'night', 'clear', 5, 84, 2400, 0.55, 0.3),
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
