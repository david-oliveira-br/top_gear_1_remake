import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural cars. Local axes: +z forward, +y up, +x to the car's left. The car sits on y = 0, centred on x/z.

export interface Shape {
  /** mid-engine supercar: hard creases, side intakes, engine deck */
  mid: boolean; L: number; W: number; sill: number; deck: number; roof: number; cowl: number; nose: number; beltR: number; beltF: number;
  /** stations along the length (0 = tail, 1 = nose): rear screen bottom/top, windscreen top/bottom */
  tA: number; tB: number; tC: number; tD: number; roofW: number; hips: number; wheelR: number; axR: number; axF: number;
}
/** Front-engine grand tourer. */
export const GT: Shape = { mid: false, L: 4.5, W: 0.94, sill: 0.16, deck: 0.9, roof: 1.2, cowl: 0.86, nose: 0.56, beltR: 0.86, beltF: 0.78,
  tA: 0.1, tB: 0.3, tC: 0.53, tD: 0.7, roofW: 0.64, hips: 0.045, wheelR: 0.335, axR: 0.2, axF: 0.79 };
/** Mid-engine wedge: cab forward, low nose, wide haunches. */
export const SUPER: Shape = { mid: true, L: 4.56, W: 1.0, sill: 0.13, deck: 0.93, roof: 1.13, cowl: 0.8, nose: 0.47, beltR: 0.9, beltF: 0.7,
  tA: 0.2, tB: 0.42, tC: 0.57, tD: 0.75, roofW: 0.58, hips: 0.075, wheelR: 0.35, axR: 0.205, axF: 0.8 };
export const SHAPES = [SUPER, GT];

type P2 = [number, number];
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const curve = (pts: P2[], t: number) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * sm(pts[i - 1][0], pts[i][0], t);
  return pts[pts.length - 1][1];
};
/** Corner cutting; `r[i]` is how far each corner is rounded (0.25 = soft, small = crease). */
const soften = (p: P2[], r: number[]) => {
  const o: P2[] = [p[0]];
  for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1], ra = r[i], rb = r[i + 1]; o.push([a[0] + (b[0] - a[0]) * ra, a[1] + (b[1] - a[1]) * ra], [b[0] + (a[0] - b[0]) * rb, b[1] + (a[1] - b[1]) * rb]); }
  o.push(p[p.length - 1]);
  return o;
};
const SOFT = [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25], CREASED = [0.25, 0.25, 0.09, 0.25, 0.07, 0.11, 0.25];

export interface BodyParts {
  shell: THREE.BufferGeometry; glass: THREE.BufferGeometry; mask: THREE.CanvasTexture; relief: THREE.CanvasTexture;
  dark: THREE.BufferGeometry; carbon: THREE.BufferGeometry; chrome: THREE.BufferGeometry; tail: THREE.BufferGeometry; head: THREE.BufferGeometry; wing: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry; seats: THREE.BufferGeometry;
  wheel: { tyre: THREE.BufferGeometry; rims: THREE.BufferGeometry[]; disc: THREE.BufferGeometry; caliper: THREE.BufferGeometry };
  axleR: number; axleF: number; track: number; shape: Shape;
}

/** v coordinate (around the section) of the belt line and the roof edge. */
const V_BELT = 4 / 6, V_ROOF = 5 / 6;
const strip = (q: THREE.BufferGeometry[]) => mergeGeometries(q.map((x) => { const y = x.index ? x.toNonIndexed() : x; y.deleteAttribute('uv'); return y; }))!;
const cache = new Map<Shape, BodyParts>();

export function buildBody(s: Shape = SUPER): BodyParts {
  const hit = cache.get(s); if (hit) return hit;
  const half = s.L / 2, Z = (t: number) => -half + t * s.L, mid = s.mid;
  const top = (t: number) => curve([[0, s.deck - 0.06], [0.035, s.deck], [s.tA, s.deck + 0.01], [s.tB, s.roof], [(s.tB + s.tC) / 2, s.roof + 0.012], [s.tC, s.roof - 0.015], [s.tD, s.cowl], [0.92, s.nose + 0.08], [1, s.nose - 0.06]], t);
  const belt = (t: number) => Math.min(top(t) - 0.02, s.beltR + (s.beltF - s.beltR) * t);
  const width = (t: number) => s.W * (1 - 0.08 * (1 - sm(0, 0.16, t)) - (mid ? 0.2 : 0.16) * sm(0.78, 1, t) + s.hips * Math.exp(-Math.pow((t - s.axR) / 0.1, 2)) + s.hips * 0.7 * Math.exp(-Math.pow((t - s.axF) / 0.09, 2)));
  const under = (t: number) => s.sill + 0.06 * sm(0.9, 1, t) + 0.07 * (1 - sm(0, 0.1, t));
  const endScale = (t: number) => { const e = Math.min(t / 0.05, (1 - t) / 0.06, 1); return (mid ? 0.84 : 0.78) + (mid ? 0.16 : 0.22) * Math.sqrt(1 - (1 - e) * (1 - e)); };
  const Ra = s.wheelR + 0.055, T_IN = s.axR + Ra / s.L + 0.03; // side intake mouth, just ahead of the rear arch
  const arch = (z: number) => { let y = 0; for (const a of [s.axR, s.axF]) { const dz = z - Z(a); if (Math.abs(dz) < Ra) y = Math.max(y, s.wheelR + Math.sqrt(Ra * Ra - dz * dz)); } return y; };

  // stations: uniform, plus tight pairs where the surface has a step (arch ends, intake mouth)
  const set = new Set<number>(); for (let i = 0; i <= 130; i++) set.add(i / 130);
  for (const a of [s.axR, s.axF]) for (const e of [-1, 1]) { const t = a + (e * Ra) / s.L; set.add(t - 0.0006); set.add(t + 0.0006); for (let k = 1; k < 8; k++) set.add(a + (e * Ra * Math.sin((k / 8) * 1.5708)) / s.L); }
  if (mid) { set.add(T_IN - 0.0006); set.add(T_IN + 0.0006); }
  const ts = [...set].filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b), NS = ts.length;
  const rings = ts.map((t) => {
    const w = width(t), y0 = under(t), yb = belt(t), yt = top(t), cab = sm(0.03, 0.3, yt - yb);
    const wt = w * 0.86 + (s.W * s.roofW - w * 0.86) * cab;
    const ctl: P2[] = [[0, y0], [w * 0.8, y0], [w, y0 + 0.1], [w * 1.006, y0 * 0.45 + yb * 0.55], [w * (mid ? 0.965 : 0.98), yb], [wt, yt - 0.02 * cab], [0, yt + 0.02]];
    const pts = soften(soften(ctl, mid ? CREASED : SOFT), new Array(14).fill(0.25));
    const sc = endScale(t), yc = (y0 + yb) / 2, z = Z(t), lift = arch(z);
    const scoop = mid && t > T_IN ? 0.12 * (1 - sm(T_IN + 0.02, T_IN + 0.2, t)) : 0;
    return pts.map(([x, y], j) => {
      let px = x * sc, py = yc + (y - yc) * sc;
      if (scoop && y > y0 + 0.12 && y < yb - 0.03 && j > 7) px *= 1 - scoop * Math.sin((Math.PI * (y - y0 - 0.12)) / (yb - 0.03 - y0 - 0.12)); // side intake scallop
      if (py < lift) { py = x / w > 0.6 ? lift : Math.min(lift, Math.max(py, yt - 0.17)); if (j > pts.length * 0.3) px *= 1.012; } // wheel opening with a slight lip; the tunnel between the wheels stays under the bonnet
      if (lift > 0) { const k = sm(0.45, 0.8, x / w); py = Math.max(py, (lift + 0.05) * k); } // wing crown over the wheel, higher than a low bonnet
      else if (lift > 0 && py < lift + 0.1 && j > 6) px *= 1 + 0.02 * (1 - (py - lift) / 0.1); // flared arch
      return new THREE.Vector3(px, py, z);
    });
  });

  // ---- surface mask: R = glass, G = lamps, B = black trim and shut lines; a second canvas holds panel-gap relief ----
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024;
  const hv = document.createElement('canvas'); hv.width = 2048; hv.height = 1024;
  const g = cv.getContext('2d', { willReadFrequently: true })!, hg = hv.getContext('2d')!, X = (t: number) => t * 2048, Y = (v: number) => (1 - v) * 1024;
  g.fillStyle = '#000'; g.fillRect(0, 0, 2048, 1024); hg.fillStyle = '#fff'; hg.fillRect(0, 0, 2048, 1024);
  const rr = (t0: number, v0: number, t1: number, v1: number, r: number, col: string, skew = 0) => {
    g.fillStyle = col; g.beginPath();
    const x0 = X(t0), x1 = X(t1), y0 = Y(v1), y1 = Y(v0), k = skew * (y1 - y0);
    g.moveTo(x0 + r + k, y0); g.lineTo(x1 - r - k, y0); g.quadraticCurveTo(x1 - k, y0, x1 - k * 0.7, y0 + r); g.lineTo(x1, y1 - r); g.quadraticCurveTo(x1, y1, x1 - r, y1);
    g.lineTo(x0 + r, y1); g.quadraticCurveTo(x0, y1, x0, y1 - r); g.lineTo(x0 + k * 0.7, y0 + r); g.quadraticCurveTo(x0 + k, y0, x0 + r + k, y0); g.fill();
  };
  const line = (t0: number, v0: number, t1: number, v1: number, w = 3) => { for (const [c, col, lw] of [[g, '#00f', w], [hg, '#000', w + 3]] as const) { c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.moveTo(X(t0), Y(v0)); c.lineTo(X(t1), Y(v1)); c.stroke(); } };
  const tMid = (s.tB + s.tC) / 2 + 0.025;
  g.fillStyle = '#00f'; g.fillRect(0, Y(0.13), 2048, 1024); // underside and sills
  rr(s.tB - 0.07, V_BELT + 0.012, s.tD - 0.02, V_ROOF - 0.006, 10, '#00f', 0.9); // window surround
  rr(s.tB - 0.055, V_BELT + 0.022, tMid - 0.008, V_ROOF - 0.016, 12, '#f00', 0.9); rr(tMid + 0.008, V_BELT + 0.022, s.tD - 0.04, V_ROOF - 0.016, 12, '#f00', 0.9);
  rr(s.tC + 0.014, V_ROOF + 0.012, s.tD - 0.012, 1.02, 14, '#f00'); rr(s.tA + 0.012, V_ROOF + 0.02, s.tB - 0.014, 1.02, 14, '#f00'); // windscreen, rear screen / engine glass
  rr(0.955, 0.16, 1.0, 0.4, 10, '#00f'); rr(0, 0.14, 0.03, 0.36, 8, '#00f'); // intake, rear valance
  if (mid) {
    rr(0.935, 0.535, 0.99, 0.59, 6, '#0f0', -1.2); // slim angular head lamps
    rr(T_IN - 0.004, 0.36, T_IN + 0.035, 0.6, 6, '#00f'); // side intake mouth
    rr(s.tD + 0.06, 0.905, s.tD + 0.12, 0.945, 6, '#00f', 0.5); // bonnet vents
    for (let i = 0; i < 4; i++) rr(0.05 + i * 0.035, 0.9, 0.065 + i * 0.035, 1.02, 3, '#00f'); // engine-deck louvres
    line(T_IN + 0.2, 0.34, T_IN + 0.02, 0.38, 4); line(0.93, 0.43, 0.99, 0.43, 5);
  } else rr(0.935, 0.5, 0.992, 0.63, 14, '#0f0', -0.5);
  line(s.tD - 0.012, 0.2, s.tD - 0.012, V_BELT); line(tMid, 0.2, tMid, V_BELT); line(s.tD - 0.012, 0.2, tMid, 0.2); // door
  line(s.tD + 0.03, V_BELT - 0.02, s.tD + 0.03, 1); line(s.tD + 0.03, V_BELT - 0.02, 0.93, V_BELT - 0.06); // bonnet
  line(s.tA - 0.03, V_BELT + 0.02, s.tA - 0.03, 1); line(0.955, 0.42, 0.955, 0.5); line(s.axF + 0.1, 0.42, s.axF + 0.135, 0.42, 9); // boot, bumper, vent
  const mask = new THREE.CanvasTexture(cv); mask.colorSpace = THREE.NoColorSpace; mask.anisotropy = 8;
  const relief = new THREE.CanvasTexture(hv); relief.colorSpace = THREE.NoColorSpace; relief.anisotropy = 8;
  const px = g.getImageData(0, 0, 2048, 1024).data, isGlass = (u: number, v: number) => px[(Math.min(1023, Math.floor((1 - v) * 1024)) * 2048 + Math.min(2047, Math.floor(u * 2048))) * 4] > 127;

  // ---- skin: painted shell and glass share the vertices ----
  const NR = rings[0].length, pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [], gidx: number[] = [];
  const n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
      const p = rings[i][j];
      a.subVectors(rings[Math.min(NS - 1, i + 1)][j], rings[Math.max(0, i - 1)][j]); b.subVectors(rings[i][Math.min(NR - 1, j + 1)], rings[i][Math.max(0, j - 1)]);
      n.crossVectors(b, a).normalize();
      if (n.x * p.x + n.y * (p.y - 0.55) + n.z * (ts[i] - 0.5) * 0.4 < 0) n.negate();
      if (j === 0 || j === NR - 1) n.setX(0).normalize();
      pos.push(p.x * side, p.y, p.z); nor.push(n.x * side, n.y, n.z); uv.push(ts[i], j / (NR - 1));
    }
    for (let i = 0; i < NS - 1; i++) for (let j = 0; j < NR - 1; j++) {
      const q = base + i * NR + j, out = isGlass((ts[i] + ts[i + 1]) / 2, (j + 0.5) / (NR - 1)) ? gidx : idx;
      if (side < 0) out.push(q, q + NR + 1, q + 1, q, q + NR, q + NR + 1); else out.push(q, q + 1, q + NR + 1, q, q + NR + 1, q + NR);
    }
    for (const [i, nz] of [[0, -1], [NS - 1, 1]] as const) { // end caps
      const ring = rings[i], c = pos.length / 3, cy = (ring[0].y + ring[NR - 1].y) / 2, start = c + 1;
      pos.push(0, cy, ring[0].z); nor.push(0, 0, nz); uv.push(i ? 1 : 0, 0.05);
      for (let j = 0; j < NR; j++) { pos.push(ring[j].x * side, ring[j].y, ring[j].z); nor.push(0, 0, nz); uv.push(i ? 1 : 0, 0.05); }
      for (let j = 0; j < NR - 1; j++) { if (side * nz < 0) idx.push(c, start + j, start + j + 1); else idx.push(c, start + j + 1, start + j); }
    }
  }
  const skin = (index: number[]) => { const q = new THREE.BufferGeometry(); q.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); q.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); q.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); q.setIndex(index); return q; };

  // ---- bolt-on parts ----
  const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rx = 0, ry = 0) => { const q = new THREE.BoxGeometry(sx, sy, sz); if (rx) q.rotateX(rx); if (ry) q.rotateY(ry); q.translate(cx, cy, cz); return q; };
  const tube = (cx: number, cy: number, cz: number, r: number, len: number) => { const q = new THREE.CylinderGeometry(r, r, len, 20, 1, true); q.rotateX(Math.PI / 2); q.translate(cx, cy, cz); return q; };
  const zr = -half, xm = width(0) * endScale(0), yDeck = top(0.01), yb0 = under(0), zf = half, xn = width(1) * endScale(1), yn = top(1);
  const dark: THREE.BufferGeometry[] = [], carbon: THREE.BufferGeometry[] = [], chrome: THREE.BufferGeometry[] = [], tail: THREE.BufferGeometry[] = [], head: THREE.BufferGeometry[] = [];
  dark.push(box(0, s.sill - 0.02, 0, s.W * 1.5, 0.05, s.L * 0.86), box(0, yDeck - 0.31, zr + 0.004, 0.5, 0.12, 0.02), box(0, yn - 0.2, zf - 0.035, xn * 1.2, 0.13, 0.08)); // floor, plate recess, grille
  carbon.push(box(0, yb0 + 0.06, zr + 0.09, xm * 1.6, 0.14, 0.1), box(0, under(1), zf - 0.12, xn * 1.9, 0.025, 0.24)); // diffuser, splitter
  for (let i = -3; i <= 3; i++) carbon.push(box(i * 0.13, yb0 + 0.02, zr + 0.07, 0.012, 0.07, 0.14));
  for (const sx of [-1, 1]) carbon.push(box(sx * (s.W - 0.03), s.sill + 0.015, 0, 0.07, 0.03, s.L * 0.36), box(sx * xn * 0.86, under(1) + 0.07, zf - 0.07, 0.02, 0.14, 0.2)); // skirts, splitter end plates
  tail.push(box(0, yDeck - 0.15, zr - 0.006, xm * (mid ? 1.2 : 1.74), 0.022, 0.03));
  for (const sx of [-1, 1]) {
    if (mid) { // twin hexagonal tail lamps in a dark housing, centre exhausts
      dark.push(box(sx * xm * 0.62, yDeck - 0.15, zr - 0.002, xm * 0.56, 0.12, 0.03));
      for (const k of [0.46, 0.76]) { const q = new THREE.CylinderGeometry(0.047, 0.047, 0.03, 6); q.rotateX(Math.PI / 2); q.translate(sx * xm * k, yDeck - 0.15, zr - 0.012); tail.push(q); }
      chrome.push(tube(sx * 0.1, yb0 + 0.2, zr - 0.02, 0.05, 0.18)); dark.push(tube(sx * 0.1, yb0 + 0.2, zr - 0.03, 0.042, 0.18));
    } else { chrome.push(tube(sx * xm * 0.55, yb0 + 0.12, zr - 0.02, 0.055, 0.16)); dark.push(tube(sx * xm * 0.55, yb0 + 0.12, zr - 0.03, 0.045, 0.16)); }
    head.push(box(sx * xn * 0.62, yn - 0.19, zf - 0.02, xn * 0.5, 0.018, 0.05)); // daytime running strips
    const zm = Z(s.tD) - 0.16, wm = width(s.tD - 0.035), ym = belt(s.tD - 0.035); // mirrors on a stalk
    const m = new THREE.SphereGeometry(0.085, 14, 10); m.scale(1.15, 0.62, 0.8); m.translate(sx * (wm + 0.06), ym + 0.09, zm); dark.push(m, box(sx * (wm - 0.01), ym + 0.05, zm, 0.14, 0.018, 0.04, 0, 0));
    dark.push(box(sx * (width(tMid + 0.04) * 0.985), ym - 0.07, Z(tMid + 0.045), 0.012, 0.018, 0.16)); // door handle
    if (!mid) for (const t of [s.axR, s.axF]) { const wl = new THREE.CylinderGeometry(Ra + 0.02, Ra + 0.02, 0.5, 24, 1, true, Math.PI / 2, Math.PI); wl.rotateZ(Math.PI / 2); wl.rotateX(Math.PI / 2); wl.translate(sx * (width(t) - 0.27), s.wheelR, Z(t)); dark.push(wl); }
    dark.push(box(sx * 0.26, top(s.tD - 0.01) + 0.012, Z(s.tD) - 0.05, 0.5, 0.012, 0.02, 0, sx * 0.12)); // wipers
  }
  const wingParts = [box(0, s.deck + 0.3, -half + 0.16, s.W * 1.86, 0.028, 0.3, -0.13)];
  for (const sx of [-1, 1]) wingParts.push(box(sx * s.W * 0.56, s.deck + 0.15, -half + 0.2, 0.035, 0.3, 0.14, -0.2), box(sx * s.W * 0.94, s.deck + 0.3, -half + 0.16, 0.02, 0.15, 0.36));

  // ---- cabin seen through the glass ----
  const zc = Z((s.tB + s.tD) / 2), yf = s.sill + 0.06, cabin: THREE.BufferGeometry[] = [], seats: THREE.BufferGeometry[] = [];
  cabin.push(box(0, yf, zc, s.W * 1.55, 0.04, s.L * (s.tD - s.tB) + 0.3), box(0, s.cowl - 0.12, Z(s.tD) - 0.3, s.W * 1.5, 0.2, 0.34), box(0, yf + 0.16, zc + 0.1, 0.2, 0.26, 1.0), box(0, (yf + s.beltR) / 2, Z(s.tB) - 0.02, s.W * 1.6, s.beltR - yf, 0.06));
  const wheelRim = new THREE.TorusGeometry(0.165, 0.02, 8, 24); wheelRim.rotateX(-0.42); wheelRim.translate(0.37, s.cowl - 0.1, Z(s.tD) - 0.52); cabin.push(wheelRim, box(0.37, s.cowl - 0.12, Z(s.tD) - 0.44, 0.05, 0.05, 0.2, -0.42));
  for (const sx of [-1, 1]) { const x = sx * 0.37, z = zc - 0.12; seats.push(box(x, yf + 0.15, z + 0.12, 0.44, 0.13, 0.5), box(x, yf + 0.47, z - 0.2, 0.44, 0.6, 0.11, -0.22), box(x, yf + 0.82, z - 0.27, 0.24, 0.16, 0.09, -0.22)); for (const e of [-1, 1]) seats.push(box(x + e * 0.21, yf + 0.42, z - 0.16, 0.06, 0.46, 0.2, -0.22)); }

  // ---- wheel: tyre, three rim designs, vented disc, caliper. Axle along x, outer face towards +x. ----
  const R = s.wheelR, tw = 0.28, rimR = R * 0.7, lathe = (p: number[][], seg = 56) => { const q = new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), seg); q.rotateZ(-Math.PI / 2); return q; };
  const tyre = lathe([[rimR, -tw / 2 + 0.01], [rimR + 0.012, -tw / 2], [R * 0.9, -tw / 2 + 0.002], [R * 0.965, -tw / 2 + 0.018], [R * 0.992, -tw / 2 + 0.05], [R, -tw / 4], [R * 0.994, -0.012], [R * 0.994, 0.012], [R, tw / 4], [R * 0.992, tw / 2 - 0.05], [R * 0.965, tw / 2 - 0.018], [R * 0.9, tw / 2 - 0.002], [rimR + 0.012, tw / 2], [rimR, tw / 2 - 0.01]]);
  const barrel = () => lathe([[rimR * 0.82, -tw / 2 + 0.02], [rimR, -tw / 2], [rimR, tw / 2], [rimR * 0.95, tw / 2 - 0.008], [rimR * 0.92, tw / 2 - 0.045]]);
  const hub = () => { const q = new THREE.CylinderGeometry(R * 0.19, R * 0.25, 0.06, 20); q.rotateZ(-Math.PI / 2); q.translate(tw / 2 - 0.045, 0, 0); return q; };
  const spokes = (count: number, w: number, d: number, lean: number, pair: number, twist: number) => { const o: THREE.BufferGeometry[] = [barrel(), hub()];
    for (let k = 0; k < count; k++) for (const e of pair ? [-1, 1] : [0]) { const sp = new THREE.BoxGeometry(d, rimR * 0.84, w); sp.translate(0, rimR * 0.52, 0); sp.rotateY(twist); sp.rotateX(e * pair); sp.rotateZ(lean); sp.translate(tw / 2 - 0.05, 0, 0); sp.rotateX((k / count) * Math.PI * 2); o.push(sp); }
    return strip(o); };
  const rims = [spokes(5, 0.034, 0.028, 0.12, 0.17, 0), spokes(10, 0.02, 0.03, 0.1, 0, 0), spokes(7, 0.075, 0.016, 0.08, 0, 0.75)];
  const discParts: THREE.BufferGeometry[] = []; for (const o of [-0.012, 0.012]) { const q = new THREE.CylinderGeometry(rimR * 0.84, rimR * 0.84, 0.01, 40); q.rotateZ(-Math.PI / 2); q.translate(tw / 2 - 0.1 + o, 0, 0); discParts.push(q); }
  { const hat = new THREE.CylinderGeometry(rimR * 0.4, rimR * 0.4, 0.05, 24); hat.rotateZ(-Math.PI / 2); hat.translate(tw / 2 - 0.09, 0, 0); discParts.push(hat); }
  const caliper = box(tw / 2 - 0.1, 0, rimR * 0.66, 0.085, 0.2, 0.09, 0.5);
  const out: BodyParts = { shell: skin(idx), glass: skin(gidx), mask, relief, dark: strip(dark), carbon: strip(carbon), chrome: strip(chrome), tail: strip(tail), head: strip(head), wing: strip(wingParts),
    cabin: strip(cabin), seats: strip(seats), wheel: { tyre, rims, disc: strip(discParts), caliper }, axleR: Z(s.axR), axleF: Z(s.axF), track: width(s.axR) - tw / 2 + 0.02, shape: s };
  cache.set(s, out); return out;
}
