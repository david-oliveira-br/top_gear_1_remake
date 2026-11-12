/** A closed circuit sampled at a fixed step along its centre line. Units are metres; x = east, z = south, y = up. */
export interface TrackDef {
  id: string;
  name: string;
  /** closed loop of control points: x, z, height, optional half width */
  points: [number, number, number, number?][];
  halfWidth: number;
  /** flat run-off between the road edge and the barrier */
  shoulder: number;
}

export interface Track {
  def: TrackDef;
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

function smooth(a: Float64Array, radius: number, passes: number): Float64Array<ArrayBuffer> {
  const n = a.length; let src: Float64Array = a, dst: Float64Array = new Float64Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) { let s = 0; for (let k = -radius; k <= radius; k++) s += src[(i + k + n * 8) % n]; dst[i] = s / (2 * radius + 1); }
    const t = src; src = dst; dst = t === a ? new Float64Array(n) : t;
  }
  return src as Float64Array<ArrayBuffer>;
}
export { smooth as smoothLoop };

export function buildTrack(def: TrackDef): Track {
  const P = def.points, m = P.length;
  // dense polyline through the control points
  const dense: number[][] = [];
  for (let i = 0; i < m; i++) {
    const a = P[(i + m - 1) % m], b = P[i], c = P[(i + 1) % m], d = P[(i + 2) % m];
    for (let k = 0; k < 64; k++) {
      const t = k / 64;
      dense.push([catmull(a[0], b[0], c[0], d[0], t), catmull(a[2], b[2], c[2], d[2], t), catmull(a[1], b[1], c[1], d[1], t),
        catmull(a[3] ?? def.halfWidth, b[3] ?? def.halfWidth, c[3] ?? def.halfWidth, d[3] ?? def.halfWidth, t)]);
    }
  }
  const cum = [0];
  for (let i = 0; i < dense.length; i++) { const a = dense[i], b = dense[(i + 1) % dense.length]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[2] - a[2])); }
  const total = cum[dense.length], n = Math.round(total / TRACK_STEP), step = total / n;
  const px = new Float64Array(n), pz = new Float64Array(n); let py = new Float64Array(n), hw = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = i * step; while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j]), a = dense[j], b = dense[(j + 1) % dense.length];
    px[i] = a[0] + (b[0] - a[0]) * t; py[i] = a[1] + (b[1] - a[1]) * t; pz[i] = a[2] + (b[2] - a[2]) * t; hw[i] = a[3] + (b[3] - a[3]) * t;
  }
  py = smooth(py, 6, 2) as Float64Array<ArrayBuffer>; hw = smooth(hw, 4, 1) as Float64Array<ArrayBuffer>;
  const tx = new Float64Array(n), tz = new Float64Array(n), slope = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n, dx = px[b] - px[a], dz = pz[b] - pz[a], l = Math.hypot(dx, dz);
    tx[i] = dx / l; tz[i] = dz / l; slope[i] = (py[b] - py[a]) / l;
  }
  let curv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n;
    curv[i] = (tx[a] * tz[b] - tz[a] * tx[b]) / (2 * step); // sin of heading change over two steps
  }
  curv = smooth(curv, 3, 2) as Float64Array<ArrayBuffer>;
  const bank = new Float64Array(n);
  for (let i = 0; i < n; i++) bank[i] = -Math.max(-0.07, Math.min(0.07, curv[i] * 5)); // inside of the corner sits lower
  return { def, n, step, len: n * step, px, py, pz, tx, tz, curv, hw, slope, bank: smooth(bank, 8, 2) };
}

export interface Loc { idx: number; frac: number; lat: number; }

/** Find the track sample nearest to (x, z), searching around `hint` (or everywhere when hint < 0). */
export function locate(t: Track, x: number, z: number, hint: number, out: Loc): Loc {
  const n = t.n; let best = 0, bd = Infinity;
  const lo = hint < 0 ? 0 : hint - 20, hi = hint < 0 ? n - 1 : hint + 30;
  for (let k = lo; k <= hi; k++) {
    const i = ((k % n) + n) % n, dx = x - t.px[i], dz = z - t.pz[i], d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  let i = best, along = (x - t.px[i]) * t.tx[i] + (z - t.pz[i]) * t.tz[i];
  if (along < 0) { i = (i + n - 1) % n; along = (x - t.px[i]) * t.tx[i] + (z - t.pz[i]) * t.tz[i]; }
  out.idx = i; out.frac = Math.max(0, Math.min(1, along / t.step));
  out.lat = (x - t.px[i]) * -t.tz[i] + (z - t.pz[i]) * t.tx[i];
  return out;
}

/** Road surface height at a located point. */
export function heightAt(t: Track, l: Loc): number {
  const i = l.idx, j = (i + 1) % t.n, f = l.frac;
  const lim = t.hw[i] + t.def.shoulder, lat = Math.max(-lim, Math.min(lim, l.lat));
  return t.py[i] + (t.py[j] - t.py[i]) * f + lat * (t.bank[i] + (t.bank[j] - t.bank[i]) * f);
}

/** World position of a point `lat` metres right of the centre line at arc length s. */
export function pointAt(t: Track, s: number, lat: number): [number, number, number, number] {
  const u = (((s % t.len) + t.len) % t.len) / t.step, i = Math.floor(u) % t.n, f = u - Math.floor(u), j = (i + 1) % t.n;
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
