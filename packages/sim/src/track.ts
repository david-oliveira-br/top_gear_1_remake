/** A closed circuit sampled at a fixed step along its centre line. Units are metres; x = east, z = south, y = up. */
import type { WeatherKind } from './weather';

export interface TrackDef {
  id: string;
  name: string;
  /** closed loop of control points: x, z, height, optional half width */
  points: [number, number, number, number?][];
  /** point-to-point track: the spline is not closed and nothing wraps around */
  open?: boolean;
  halfWidth: number;
  /** flat run-off between the road edge and the barrier */
  shoulder: number;
  /** weather this track can roll, with relative weights */
  weather: { kind: WeatherKind; weight: number }[];
}

export interface Track {
  def: TrackDef;
  /** open tracks have n samples from s = 0 to s = len = (n - 1) * step; closed ones have len = n * step */
  open: boolean;
  n: number; step: number; len: number;
  px: Float64Array; py: Float64Array; pz: Float64Array;
  /** unit tangent in the ground plane */
  tx: Float64Array; tz: Float64Array;
  /** signed curvature, 1/m; positive turns right (towards +z when heading +x) */
  curv: Float64Array;
  /** road half width */
  hw: Float64Array;
  /** height change per metre along the track, and per metre to the right */
  slope: Float64Array; bank: Float64Array;
}

export const TRACK_STEP = 2;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function smooth(a: Float64Array, radius: number, passes: number, open = false): Float64Array<ArrayBuffer> {
  const n = a.length; let src: Float64Array = a, dst: Float64Array = new Float64Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      if (open) for (let k = -radius; k <= radius; k++) s += src[Math.max(0, Math.min(n - 1, i + k))];
      else for (let k = -radius; k <= radius; k++) s += src[(i + k + n * 8) % n];
      dst[i] = s / (2 * radius + 1);
    }
    const t = src; src = dst; dst = t === a ? new Float64Array(n) : t;
  }
  return src as Float64Array<ArrayBuffer>;
}
export { smooth as smoothLoop };
/** Smoothing that respects the track topology: clamped at the ends of an open track, wrapped on a loop. */
export const smoothTrack = (t: Track, a: Float64Array, radius: number, passes: number) => smooth(a, radius, passes, t.open);

export function buildTrack(def: TrackDef): Track {
  const P = def.points, m = P.length, open = !!def.open;
  // dense polyline through the control points
  const dense: number[][] = [];
  const ext = (p: readonly (number | undefined)[], q: readonly (number | undefined)[]) => [2 * p[0]! - q[0]!, 2 * p[1]! - q[1]!, 2 * p[2]! - q[2]!, 2 * (p[3] ?? def.halfWidth) - (q[3] ?? def.halfWidth)] as [number, number, number, number];
  for (let i = 0; i < (open ? m - 1 : m); i++) {
    const a = open ? (i > 0 ? P[i - 1] : ext(P[0], P[1])) : P[(i + m - 1) % m], b = P[i], c = open ? P[i + 1] : P[(i + 1) % m];
    const d = open ? (i + 2 < m ? P[i + 2] : ext(P[m - 1], P[m - 2])) : P[(i + 2) % m];
    for (let k = 0; k < 64; k++) {
      const t = k / 64;
      dense.push([catmull(a[0], b[0], c[0], d[0], t), catmull(a[2], b[2], c[2], d[2], t), catmull(a[1], b[1], c[1], d[1], t),
        catmull(a[3] ?? def.halfWidth, b[3] ?? def.halfWidth, c[3] ?? def.halfWidth, d[3] ?? def.halfWidth, t)]);
    }
  }
  if (open) { const e = P[m - 1]; dense.push([e[0], e[2], e[1], e[3] ?? def.halfWidth]); }
  const cum = [0], dl = dense.length;
  for (let i = 0; i < (open ? dl - 1 : dl); i++) { const a = dense[i], b = dense[(i + 1) % dl]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[2] - a[2])); }
  const total = cum[cum.length - 1], segs = Math.round(total / TRACK_STEP), step = total / segs, n = open ? segs + 1 : segs;
  const px = new Float64Array(n), pz = new Float64Array(n); let py = new Float64Array(n), hw = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = i * step; while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j]), a = dense[j], b = dense[(j + 1) % dl];
    px[i] = a[0] + (b[0] - a[0]) * t; py[i] = a[1] + (b[1] - a[1]) * t; pz[i] = a[2] + (b[2] - a[2]) * t; hw[i] = a[3] + (b[3] - a[3]) * t;
  }
  py = smooth(py, 6, 2, open) as Float64Array<ArrayBuffer>; hw = smooth(hw, 4, 1, open) as Float64Array<ArrayBuffer>;
  const tx = new Float64Array(n), tz = new Float64Array(n), slope = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = open ? Math.max(0, i - 1) : (i + n - 1) % n, b = open ? Math.min(n - 1, i + 1) : (i + 1) % n, dx = px[b] - px[a], dz = pz[b] - pz[a], l = Math.hypot(dx, dz);
    tx[i] = dx / l; tz[i] = dz / l; slope[i] = (py[b] - py[a]) / l;
  }
  let curv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = open ? Math.max(0, i - 1) : (i + n - 1) % n, b = open ? Math.min(n - 1, i + 1) : (i + 1) % n;
    curv[i] = (tx[a] * tz[b] - tz[a] * tx[b]) / (2 * step); // sin of heading change over two steps
  }
  curv = smooth(curv, 3, 2, open) as Float64Array<ArrayBuffer>;
  const bank = new Float64Array(n);
  for (let i = 0; i < n; i++) bank[i] = -Math.max(-0.07, Math.min(0.07, curv[i] * 5)); // inside of the corner sits lower
  return { def, open, n, step, len: (open ? n - 1 : n) * step, px, py, pz, tx, tz, curv, hw, slope, bank: smooth(bank, 8, 2, open) };
}

export interface Loc { idx: number; frac: number; lat: number; }

/** Find the track sample nearest to (x, z), searching around `hint` (or everywhere when hint < 0). */
export function locate(t: Track, x: number, z: number, hint: number, out: Loc): Loc {
  const n = t.n; let best = 0, bd = Infinity;
  const lo = hint < 0 ? 0 : hint - 20, hi = hint < 0 ? n - 1 : hint + 30;
  for (let k = lo; k <= hi; k++) {
    if (t.open && (k < 0 || k >= n)) continue;
    const i = ((k % n) + n) % n, dx = x - t.px[i], dz = z - t.pz[i], d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  let i = best, along = (x - t.px[i]) * t.tx[i] + (z - t.pz[i]) * t.tz[i];
  if (t.open && i === n - 1) { i = n - 2; along = (x - t.px[i]) * t.tx[i] + (z - t.pz[i]) * t.tz[i]; }
  else if (along < 0) { i = t.open ? Math.max(0, i - 1) : (i + n - 1) % n; along = (x - t.px[i]) * t.tx[i] + (z - t.pz[i]) * t.tz[i]; }
  out.idx = i; out.frac = Math.max(0, Math.min(1, along / t.step));
  out.lat = (x - t.px[i]) * -t.tz[i] + (z - t.pz[i]) * t.tx[i];
  return out;
}

/** Road surface height at a located point. */
export function heightAt(t: Track, l: Loc): number {
  const i = l.idx, j = t.open ? Math.min(i + 1, t.n - 1) : (i + 1) % t.n, f = l.frac;
  const lim = t.hw[i] + t.def.shoulder, lat = Math.max(-lim, Math.min(lim, l.lat));
  return t.py[i] + (t.py[j] - t.py[i]) * f + lat * (t.bank[i] + (t.bank[j] - t.bank[i]) * f);
}

/** World position of a point `lat` metres right of the centre line at arc length s. */
export function pointAt(t: Track, s: number, lat: number): [number, number, number, number] {
  let u: number, i: number, f: number, j: number;
  if (t.open) { u = Math.max(0, Math.min(t.len, s)) / t.step; i = Math.min(Math.floor(u), t.n - 2); f = u - i; j = i + 1; }
  else { u = (((s % t.len) + t.len) % t.len) / t.step; i = Math.floor(u) % t.n; f = u - Math.floor(u); j = (i + 1) % t.n; }
  const x = t.px[i] + (t.px[j] - t.px[i]) * f, z = t.pz[i] + (t.pz[j] - t.pz[i]) * f;
  const txx = t.tx[i] + (t.tx[j] - t.tx[i]) * f, tzz = t.tz[i] + (t.tz[j] - t.tz[i]) * f;
  const y = t.py[i] + (t.py[j] - t.py[i]) * f + lat * (t.bank[i] + (t.bank[j] - t.bank[i]) * f);
  return [x - tzz * lat, y, z + txx * lat, Math.atan2(tzz, txx)];
}

/** Rio seafront circuit: a long straight by the beach, a climb into the hills and a fast descent back to the sea. */
export const RIO: TrackDef = {
  id: 'rio', name: 'Circuito da Orla', halfWidth: 7, shoulder: 3.5,
  weather: [{ kind: 'clear', weight: 5 }, { kind: 'overcast', weight: 2 }, { kind: 'rain', weight: 2 }, { kind: 'storm', weight: 1 }, { kind: 'fog', weight: 0.3 }],
  points: [
    [-600, 150, 3], [-200, 158, 3], [250, 150, 3], [560, 92, 4], [650, -90, 9], [560, -290, 20], [340, -372, 31],
    [130, -300, 35], [30, -160, 27], [-130, -96, 19], [-262, -214, 21], [-432, -330, 29], [-640, -284, 23],
    [-765, -122, 11], [-782, 52, 4.5],
  ],
};

/**
 * Pacific Coast: a point-to-point run south to north along a cliff road with the ocean to the west (smaller x).
 * Flowing cliff bends, a straight over a canyon bridge (COAST_BRIDGE), a switchback pair in the second half and a
 * descent to the lighthouse. Start at the origin heading north (-z).
 */
export const COAST: TrackDef = {
  id: 'coast', name: 'Pacific Coast', open: true, halfWidth: 6.5, shoulder: 2.5,
  weather: [{ kind: 'clear', weight: 4 }, { kind: 'fog', weight: 3 }, { kind: 'overcast', weight: 2 }, { kind: 'rain', weight: 1.5 }],
  points: [
    [0, 0, 22], [0, -70, 24], [0, -140, 28], [21, -233, 34], [35, -287, 35], [30, -342, 36], [15, -400, 40], [-1, -458, 45],
    [-2, -515, 50], [23, -566, 56], [46, -622, 60], [33, -680, 62], [-17, -767, 61], [-44, -867, 57], [-59, -952, 53], [-96, -1056, 49],
    [-134, -1159, 48], [-139, -1200, 49], [-125, -1239, 51], [-94, -1268, 53], [-50, -1309, 58], [-27, -1365, 63], [-14, -1439, 69], [-1, -1513, 74],
    [-9, -1605, 78], [-13, -1702, 80], [5, -1769, 83], [23, -1837, 87], [27, -1887, 91], [10, -1935, 93], [-20, -1987, 95], [-50, -2039, 96],
    [-72, -2091, 97], [-83, -2147, 99], [-89, -2206, 100], [-94, -2266, 100], [-101, -2349, 100], [-108, -2432, 100], [-116, -2515, 100], [-121, -2575, 100],
    [-111, -2631, 97], [-74, -2675, 91], [-45, -2710, 87], [-36, -2756, 86], [-42, -2816, 86], [-47, -2876, 85], [-20, -2975, 84], [7, -3030, 83],
    [16, -3090, 81], [16, -3180, 79], [16, -3270, 77], [18, -3283, 77], [25, -3294, 76], [36, -3302, 76], [49, -3306, 76], [62, -3304, 75],
    [74, -3298, 75], [83, -3288, 75], [87, -3276, 74], [99, -3207, 73], [104, -3195, 73], [113, -3185, 72], [125, -3179, 72], [138, -3177, 72],
    [151, -3181, 72], [161, -3189, 72], [168, -3200, 71], [171, -3213, 71], [171, -3273, 70], [171, -3333, 70], [202, -3431, 96], [253, -3504, 98],
    [305, -3578, 101], [324, -3627, 103], [318, -3679, 104], [310, -3729, 106], [323, -3778, 107], [365, -3869, 108], [407, -3960, 105], [416, -4062, 99],
    [412, -4157, 94], [425, -4231, 92], [438, -4305, 93], [471, -4375, 95], [516, -4429, 99], [538, -4468, 101], [546, -4512, 103], [546, -4587, 104],
    [546, -4662, 101], [555, -4708, 96], [581, -4747, 91], [631, -4797, 84], [675, -4873, 78], [694, -4945, 75], [714, -5018, 67], [742, -5067, 59],
    [791, -5095, 53], [826, -5113, 52], [852, -5142, 33], [897, -5220, 28], [948, -5271, 25], [1013, -5309, 22], [1078, -5346, 22],
  ],
};

/** Arc-length range (metres from the start) of the straight at constant height where the bridge deck is drawn. */
export const COAST_BRIDGE = { from: 2400, to: 2645 };

/**
 * Icefields Parkway (Rockies): a point-to-point run north (-z) from a glacial lake to a lodge on a snowfield pass. Lakeshore sweepers,
 * a forest straight under a wildlife overpass and an avalanche gallery, four stacked hairpins, a fast bench with a gorge bridge and
 * the pass. Generated by tools/gen-track.mjs rockies.
 */
export const ROCKIES: TrackDef = {
  id: 'rockies', name: 'Icefields Parkway', open: true, halfWidth: 6.5, shoulder: 2.5,
  weather: [{ kind: 'clear', weight: 3 }, { kind: 'snow', weight: 2.5 }, { kind: 'overcast', weight: 2 }, { kind: 'fog', weight: 2 }, { kind: 'rain', weight: 1 }],
  points: [
    [0, 0, 42], [0, -60, 43], [0, -120, 43], [7, -187, 44], [28, -250, 45], [48, -324, 46], [46, -401, 47], [40, -463, 48],
    [45, -524, 48], [59, -584, 49], [78, -642, 49], [91, -708, 50], [89, -776, 51], [89, -833, 52], [103, -889, 52], [118, -926, 53],
    [144, -991, 55], [171, -1056, 57], [197, -1121, 59], [223, -1186, 61], [245, -1245, 63], [262, -1305, 65], [276, -1363, 67], [291, -1422, 68],
    [309, -1493, 71], [326, -1564, 73], [344, -1635, 75], [359, -1693, 77], [377, -1751, 80], [402, -1807, 83], [422, -1850, 86], [438, -1894, 89],
    [456, -1958, 93], [474, -2022, 97], [493, -2087, 101], [511, -2133, 104], [538, -2175, 107], [571, -2228, 110], [592, -2287, 114], [607, -2345, 118],
    [621, -2403, 121], [638, -2471, 127], [655, -2539, 132], [667, -2560, 134], [687, -2572, 136], [711, -2573, 138], [732, -2561, 139], [744, -2541, 141],
    [745, -2517, 143], [724, -2435, 150], [703, -2352, 157], [704, -2328, 159], [716, -2308, 161], [737, -2296, 163], [761, -2297, 165], [781, -2309, 167],
    [793, -2330, 168], [813, -2412, 175], [834, -2495, 182], [845, -2516, 184], [866, -2528, 186], [890, -2528, 188], [910, -2517, 190], [923, -2496, 192],
    [923, -2473, 194], [903, -2390, 200], [882, -2308, 207], [882, -2284, 209], [895, -2263, 211], [915, -2252, 213], [939, -2252, 215], [960, -2265, 217],
    [971, -2285, 219], [987, -2350, 221], [1004, -2415, 224], [1020, -2479, 227], [1033, -2557, 227], [1033, -2635, 227], [1033, -2696, 227], [1040, -2757, 227],
    [1053, -2831, 227], [1066, -2905, 227], [1079, -2979, 227], [1092, -3052, 227], [1105, -3127, 227], [1118, -3202, 227], [1131, -3277, 227], [1145, -3352, 227],
    [1158, -3427, 227], [1166, -3476, 227], [1175, -3525, 227], [1197, -3603, 231], [1233, -3675, 235], [1270, -3752, 240], [1288, -3836, 244], [1297, -3916, 249],
    [1305, -3995, 253], [1313, -4075, 258], [1323, -4126, 260], [1342, -4175, 263], [1365, -4238, 266], [1374, -4304, 269], [1377, -4384, 274], [1380, -4464, 279],
    [1383, -4544, 284], [1385, -4624, 290], [1396, -4711, 294], [1408, -4769, 296], [1421, -4828, 298], [1438, -4906, 298], [1454, -4985, 298], [1471, -5063, 298],
    [1487, -5141, 298], [1504, -5219, 298], [1521, -5298, 298],
  ],
};

/** Arc-length ranges (metres from the start) of the gorge bridge (flat), the avalanche gallery and the wildlife overpass. */
export const ROCKIES_BRIDGE = { from: 4620, to: 4850 };
export const ROCKIES_GALLERY = { from: 1480, to: 1690 };
export const ROCKIES_OVERPASS = { from: 980, to: 1030 };

/**
 * Ruta del Fin del Mundo (Patagonia): a point-to-point run north (-z) across the steppe with blind crests, down to a glacier lake
 * (PATAGONIA_BRIDGE), through lenga-forest esses and up a moraine with two hairpins, then a straight towards the granite towers.
 * Generated by tools/gen-track.mjs patagonia.
 */
export const PATAGONIA: TrackDef = {
  id: 'patagonia', name: 'Ruta del Fin del Mundo', open: true, halfWidth: 6.5, shoulder: 3,
  weather: [{ kind: 'overcast', weight: 3 }, { kind: 'clear', weight: 2.5 }, { kind: 'rain', weight: 2 }, { kind: 'storm', weight: 1.5 }, { kind: 'fog', weight: 0.5 }],
  points: [
    [0, 0, 115], [0, -60, 115], [0, -120, 115], [0, -207, 118], [0, -293, 120], [0, -380, 123], [0, -455, 119], [0, -530, 116],
    [0, -605, 113], [0, -680, 109], [2, -743, 108], [7, -805, 107], [15, -868, 106], [27, -947, 108], [40, -1026, 110], [52, -1105, 113],
    [64, -1179, 109], [76, -1253, 104], [88, -1327, 100], [99, -1401, 96], [108, -1471, 95], [112, -1541, 93], [114, -1607, 95], [116, -1674, 96],
    [118, -1740, 97], [120, -1815, 93], [123, -1890, 88], [125, -1965, 84], [127, -2040, 79], [130, -2124, 75], [132, -2207, 71], [135, -2290, 67],
    [139, -2363, 63], [150, -2436, 60], [165, -2524, 55], [181, -2613, 51], [197, -2702, 46], [213, -2790, 42], [223, -2849, 42], [238, -2935, 42],
    [254, -3020, 42], [269, -3105, 42], [279, -3164, 42], [304, -3221, 43], [353, -3260, 44], [390, -3288, 45], [413, -3331, 46], [415, -3378, 47],
    [404, -3437, 48], [406, -3486, 49], [426, -3530, 51], [463, -3562, 52], [496, -3594, 53], [512, -3637, 54], [507, -3683, 55], [490, -3730, 56],
    [482, -3778, 57], [490, -3825, 58], [514, -3868, 59], [537, -3907, 60], [542, -3952, 61], [532, -3995, 62], [498, -4068, 64], [488, -4111, 65],
    [495, -4155, 66], [520, -4192, 67], [546, -4229, 68], [558, -4273, 69], [554, -4318, 70], [538, -4376, 71], [523, -4434, 73], [504, -4492, 77],
    [478, -4547, 81], [445, -4605, 85], [413, -4663, 89], [381, -4722, 93], [360, -4766, 96], [345, -4812, 98], [332, -4861, 102], [319, -4909, 105],
    [319, -4933, 107], [331, -4953, 109], [351, -4965, 111], [375, -4965, 113], [396, -4953, 115], [408, -4933, 117], [424, -4871, 122], [440, -4810, 127],
    [457, -4749, 132], [468, -4728, 134], [489, -4716, 136], [513, -4716, 138], [533, -4728, 140], [545, -4749, 142], [545, -4773, 144], [525, -4850, 149],
    [504, -4927, 155], [484, -5005, 161], [471, -5066, 164], [464, -5128, 168], [464, -5191, 172], [469, -5271, 177], [473, -5351, 183], [477, -5431, 189],
    [476, -5494, 192], [467, -5556, 196], [452, -5621, 200], [437, -5686, 203], [422, -5751, 206], [412, -5811, 209], [410, -5872, 211], [411, -5932, 213],
    [412, -5992, 215], [413, -6072, 215], [415, -6152, 215], [416, -6232, 215], [418, -6312, 215], [420, -6392, 215], [421, -6472, 215], [423, -6552, 215],
  ],
};

export const PATAGONIA_BRIDGE = { from: 2910, to: 3060 };

export const TRACKS: Record<string, TrackDef> = { rio: RIO, coast: COAST, rockies: ROCKIES, patagonia: PATAGONIA };
