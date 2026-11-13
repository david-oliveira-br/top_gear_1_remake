/** A closed circuit sampled at a fixed step along its centre line. Units are metres; x = east, z = south, y = up. */
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

export const TRACKS: Record<string, TrackDef> = { rio: RIO, coast: COAST };
