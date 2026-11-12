// Procedural 3D car meshes. Units are metres: x = right, y = up, z = forward. The car sits on y = 0, centred on x/z.

export const MAT = { paint: 0, glass: 1, rubber: 2, chrome: 3, dark: 4, tail: 5, head: 6, plate: 7, trim: 8 } as const;
export interface CarMesh { data: Float32Array; count: number; length: number; rearAxle: number; tail: { x: number; y: number; z: number } }

interface Spec {
  L: number; W: number; sill: number; deck: number; roof: number; cowl: number; nose: number; beltR: number; beltF: number;
  tA: number; tB: number; tC: number; tD: number; roofW: number; hips: number;
  wheelR: number; axR: number; axF: number; wing: 'lip' | 'big' | 'roof' | 'none'; lights: 'twin' | 'bar' | 'round' | 'block'; pipes: number;
}
const SPECS: Spec[] = [
  // Vortex GT – coupe
  { L: 4.45, W: 0.9, sill: 0.17, deck: 0.86, roof: 1.22, cowl: 0.88, nose: 0.58, beltR: 0.84, beltF: 0.8, tA: 0.13, tB: 0.3, tC: 0.52, tD: 0.68, roofW: 0.66, hips: 0.03, wheelR: 0.33, axR: 0.19, axF: 0.8, wing: 'lip', lights: 'twin', pipes: 2 },
  // Sirocco S – low wedge
  { L: 4.5, W: 0.98, sill: 0.13, deck: 0.8, roof: 1.08, cowl: 0.78, nose: 0.42, beltR: 0.78, beltF: 0.66, tA: 0.17, tB: 0.36, tC: 0.5, tD: 0.7, roofW: 0.6, hips: 0.06, wheelR: 0.34, axR: 0.2, axF: 0.8, wing: 'big', lights: 'bar', pipes: 4 },
  // Kestrel RS – hot hatch
  { L: 4.0, W: 0.88, sill: 0.18, deck: 1.02, roof: 1.36, cowl: 0.95, nose: 0.66, beltR: 0.98, beltF: 0.9, tA: 0.035, tB: 0.17, tC: 0.56, tD: 0.72, roofW: 0.7, hips: 0.02, wheelR: 0.31, axR: 0.17, axF: 0.8, wing: 'roof', lights: 'round', pipes: 2 },
  // Marathon – long grand tourer
  { L: 4.75, W: 0.92, sill: 0.18, deck: 0.9, roof: 1.27, cowl: 0.92, nose: 0.64, beltR: 0.88, beltF: 0.84, tA: 0.09, tB: 0.34, tC: 0.56, tD: 0.7, roofW: 0.68, hips: 0.02, wheelR: 0.34, axR: 0.18, axF: 0.81, wing: 'none', lights: 'block', pipes: 1 },
];

type V = [number, number, number];
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const curve = (pts: [number, number][], t: number) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * sm(pts[i - 1][0], pts[i][0], t);
  return pts[pts.length - 1][1];
};
const chaikin = (p: [number, number][]) => {
  const o: [number, number][] = [p[0]];
  for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
  o.push(p[p.length - 1]);
  return o;
};
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

class Builder {
  out: number[] = [];
  tri(a: V, b: V, c: V, na: V, nb: V, nc: V, m: number) { this.out.push(...a, ...na, m, ...b, ...nb, m, ...c, ...nc, m); }
  quad(a: V, b: V, c: V, d: V, m: number, n?: V) { const nn = n ?? norm(cross(sub(b, a), sub(d, a))); this.tri(a, b, c, nn, nn, nn, m); this.tri(a, c, d, nn, nn, nn, m); }
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, m: number) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], m, [0, 0, -1]); this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], m, [0, 0, 1]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], m, [-1, 0, 0]); this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], m, [1, 0, 0]);
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], m, [0, 1, 0]); this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], m, [0, -1, 0]);
  }
  /** Cylinder with its axis along x (wheels) or z (exhausts). */
  cyl(axis: 'x' | 'z', c: V, r: number, len: number, m: number, capM = m, seg = 28) {
    const P = (a: number, o: number): V => axis === 'x' ? [c[0] + o, c[1] + Math.sin(a) * r, c[2] + Math.cos(a) * r] : [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2] + o];
    const N = (a: number): V => axis === 'x' ? [0, Math.sin(a), Math.cos(a)] : [Math.cos(a), Math.sin(a), 0];
    const ctr = (o: number): V => axis === 'x' ? [c[0] + o, c[1], c[2]] : [c[0], c[1], c[2] + o];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * 6.2832, a1 = ((i + 1) / seg) * 6.2832;
      this.tri(P(a0, -len / 2), P(a1, -len / 2), P(a1, len / 2), N(a0), N(a1), N(a1), m); this.tri(P(a0, -len / 2), P(a1, len / 2), P(a0, len / 2), N(a0), N(a1), N(a0), m);
      for (const s of [-1, 1]) { const n: V = axis === 'x' ? [s, 0, 0] : [0, 0, s]; this.tri(ctr((s * len) / 2), P(a0, (s * len) / 2), P(a1, (s * len) / 2), n, n, n, capM); }
    }
  }
}

function build(s: Spec): CarMesh {
  const b = new Builder();
  const half = s.L / 2, Z = (t: number) => -half + t * s.L;
  const top = (t: number) => curve([[0, s.deck - 0.05], [0.03, s.deck], [s.tA, s.deck], [s.tB, s.roof], [(s.tB + s.tC) / 2, s.roof + 0.015], [s.tC, s.roof - 0.012], [s.tD, s.cowl], [0.93, s.nose + 0.07], [1, s.nose - 0.05]], t);
  const belt = (t: number) => Math.min(top(t) - 0.02, s.beltR + (s.beltF - s.beltR) * t);
  const width = (t: number) => s.W * (1 - 0.07 * (1 - sm(0, 0.14, t)) - 0.15 * sm(0.8, 1, t) + s.hips * Math.exp(-Math.pow((t - s.axR) / 0.11, 2)) + s.hips * 0.6 * Math.exp(-Math.pow((t - s.axF) / 0.1, 2)));
  const under = (t: number) => s.sill + 0.05 * sm(0.9, 1, t) + 0.04 * (1 - sm(0, 0.08, t));
  const endScale = (t: number) => { const e = Math.min(t / 0.045, (1 - t) / 0.05, 1); return 0.8 + 0.2 * Math.sqrt(1 - (1 - e) * (1 - e)); };

  const NS = 72;
  const ts = Array.from({ length: NS }, (_, i) => i / (NS - 1));
  const rings: V[][] = ts.map((t) => {
    const w = width(t), y0 = under(t), yb = belt(t), yt = top(t), cab = sm(0.03, 0.3, yt - yb);
    const wt = w * 0.88 + (s.W * s.roofW - w * 0.88) * cab;
    let pts: [number, number][] = [[0, y0], [w * 0.8, y0], [w, y0 + 0.1], [w * 1.005, y0 * 0.45 + yb * 0.55], [w * 0.985, yb], [wt, yt - 0.02 * cab], [0, yt + 0.02]];
    pts = chaikin(chaikin(pts));
    const sc = endScale(t), yc = (y0 + yb) / 2;
    return pts.map(([x, y]): V => [x * sc, yc + (y - yc) * sc, Z(t)]);
  });
  const NR = rings[0].length;
  const normals: V[][] = rings.map((ring, i) => ring.map((p, j): V => {
    const a = rings[Math.min(NS - 1, i + 1)][j], c = rings[Math.max(0, i - 1)][j];
    const d = ring[Math.min(NR - 1, j + 1)], e = ring[Math.max(0, j - 1)];
    let n = norm(cross(sub(d, e), sub(a, c)));
    if (n[0] * p[0] + n[1] * (p[1] - 0.55) + n[2] * (ts[i] - 0.5) * 0.4 < 0) n = [-n[0], -n[1], -n[2]];
    if (j === 0 || j === NR - 1) n = norm([0, n[1], n[2]]);
    return n;
  }));
  const tMid = (s.tB + s.tC) / 2 + 0.02;
  const material = (t: number, p: V, n: V) => {
    const yb = belt(t), yt = top(t), ax = Math.abs(p[0]);
    if (yt - yb < 0.13) return MAT.paint;
    const wt = s.W * s.roofW;
    if (Math.abs(n[0]) > 0.45) { // flank of the cabin
      if (p[1] > yb + 0.05 && p[1] < yt - 0.075 && t > s.tA + 0.035 && t < s.tD - 0.035 && Math.abs(t - tMid) > 0.011) return MAT.glass;
    } else if (p[1] > yb + 0.045 && ax < wt - 0.07) {
      if ((t > s.tC + 0.012 && t < s.tD - 0.012) || (t > s.tA + 0.012 && t < s.tB - 0.012)) return MAT.glass;
    }
    return MAT.paint;
  };
  for (const side of [1, -1]) {
    const fx = (p: V): V => [p[0] * side, p[1], p[2]];
    for (let i = 0; i < NS - 1; i++) for (let j = 0; j < NR - 1; j++) {
      const p00 = rings[i][j], p01 = rings[i][j + 1], p10 = rings[i + 1][j], p11 = rings[i + 1][j + 1];
      const c: V = [(p00[0] + p11[0]) / 2, (p00[1] + p11[1]) / 2, 0], nc = normals[i][j];
      const m = material((ts[i] + ts[i + 1]) / 2, c, nc);
      b.tri(fx(p00), fx(p01), fx(p11), fx(normals[i][j]), fx(normals[i][j + 1]), fx(normals[i + 1][j + 1]), m);
      b.tri(fx(p00), fx(p11), fx(p10), fx(normals[i][j]), fx(normals[i + 1][j + 1]), fx(normals[i + 1][j]), m);
    }
    for (const [i, nz] of [[0, -1], [NS - 1, 1]] as [number, number][]) { // end caps
      const ring = rings[i], cy = (ring[0][1] + ring[NR - 1][1]) / 2, c: V = [0, cy, ring[0][2]], n: V = [0, 0, nz];
      for (let j = 0; j < NR - 1; j++) b.tri(c, fx(ring[j]), fx(ring[j + 1]), n, n, n, MAT.paint);
    }
  }

  // ---- rear panel ----
  const r0 = rings[0], zr = -half - 0.012, xm = Math.max(...r0.map((p) => p[0])), yTop = r0[NR - 1][1], yBot = r0[0][1];
  const ly = yTop - 0.17;
  b.box(0, yBot + 0.1, zr + 0.03, xm * 1.9, 0.2, 0.1, MAT.dark);
  for (let i = -2; i <= 2; i++) b.box(i * 0.15, yBot + 0.05, zr - 0.02, 0.02, 0.1, 0.06, MAT.trim);
  for (const sx of [-1, 1]) {
    if (s.lights === 'twin') b.box(sx * xm * 0.58, ly, zr, xm * 0.62, 0.09, 0.03, MAT.tail);
    else if (s.lights === 'round') for (const k of [0.42, 0.74]) b.cyl('z', [sx * xm * k, ly, zr], 0.075, 0.03, MAT.tail, MAT.tail, 20);
    else if (s.lights === 'block') b.box(sx * xm * 0.74, ly - 0.03, zr, xm * 0.34, 0.17, 0.03, MAT.tail);
  }
  if (s.lights === 'bar') { b.box(0, ly + 0.02, zr, xm * 1.78, 0.055, 0.03, MAT.tail); }
  b.box(0, s.lights === 'bar' ? ly - 0.14 : ly - 0.17, zr, 0.46, 0.115, 0.02, MAT.plate);
  b.box(0, ly + 0.085, zr, 0.07, 0.03, 0.02, MAT.chrome);
  const px = s.pipes === 1 ? [xm * 0.62] : s.pipes === 2 ? [-xm * 0.6, xm * 0.6] : [-xm * 0.68, -xm * 0.5, xm * 0.5, xm * 0.68];
  for (const x of px) { b.cyl('z', [x, yBot + 0.11, zr - 0.03], 0.05, 0.12, MAT.chrome, MAT.rubber, 18); }

  // ---- nose ----
  const rN = rings[NS - 1], zf = half + 0.012, xn = Math.max(...rN.map((p) => p[0])), yN = rN[NR - 1][1], yNb = rN[0][1];
  b.box(0, yNb + 0.1, zf - 0.02, xn * 1.5, 0.16, 0.06, MAT.dark);
  for (const sx of [-1, 1]) b.box(sx * xn * 0.68, yN - 0.09, zf - 0.01, xn * 0.5, 0.075, 0.04, MAT.head);

  // ---- wing / mirrors ----
  if (s.wing === 'big') { b.box(0, s.deck + 0.27, -half + 0.2, s.W * 1.9, 0.03, 0.3, MAT.paint); for (const sx of [-1, 1]) { b.box(sx * s.W * 0.55, s.deck + 0.13, -half + 0.22, 0.03, 0.27, 0.16, MAT.dark); b.box(sx * s.W * 0.95, s.deck + 0.26, -half + 0.2, 0.025, 0.13, 0.34, MAT.paint); } }
  else if (s.wing === 'lip') b.box(0, s.deck + 0.03, -half + 0.12, s.W * 1.62, 0.035, 0.16, MAT.paint);
  else if (s.wing === 'roof') b.box(0, s.roof + 0.015, Z(s.tB) - 0.12, s.W * 1.36, 0.03, 0.3, MAT.dark);
  const zm = Z(s.tD) - 0.2, wm = width(s.tD - 0.04);
  for (const sx of [-1, 1]) b.box(sx * (wm + 0.06), belt(s.tD - 0.04) + 0.06, zm, 0.15, 0.09, 0.07, MAT.paint);

  // ---- wheels ----
  for (const t of [s.axR, s.axF]) for (const sx of [-1, 1]) {
    const w = width(t), z = Z(t), R = s.wheelR, xo = sx * (w + 0.035), xc = sx * (w + 0.035 - 0.125);
    b.cyl('x', [sx * (w + 0.006), R + 0.03, z], R + 0.075, 0.012, MAT.trim, MAT.trim, 32);
    b.cyl('x', [xc, R, z], R, 0.25, MAT.rubber, MAT.rubber, 32);
    b.cyl('x', [xo, R, z], R * 0.7, 0.012, MAT.trim, MAT.trim, 28);
    for (let k = 0; k < 5; k++) { // spokes
      const a = (k / 5) * 6.2832 + 0.3, ca = Math.cos(a), sa = Math.sin(a), w2 = R * 0.085;
      const pt = (rad: number, o: number): V => [xo + sx * 0.012, R + sa * rad - ca * o, z + ca * rad + sa * o];
      b.quad(pt(R * 0.1, -w2), pt(R * 0.68, -w2 * 0.8), pt(R * 0.68, w2 * 0.8), pt(R * 0.1, w2), MAT.chrome, [sx, 0, 0]);
    }
    b.cyl('x', [xo + sx * 0.012, R, z], R * 0.16, 0.014, MAT.chrome, MAT.chrome, 16);
  }
  const data = new Float32Array(b.out);
  return { data, count: data.length / 7, length: s.L, rearAxle: Z(s.axR), tail: { x: xm * 0.62, y: ly, z: -half } };
}

const cache: (CarMesh | undefined)[] = [];
export function carMesh(cls: number): CarMesh { return (cache[cls] ??= build(SPECS[cls] ?? SPECS[0])); }
