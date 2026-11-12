import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural grand tourer. Local axes: +z forward, +y up, +x to the car's left. The car sits on y = 0, centred on x/z.

export interface Shape {
  L: number; W: number; sill: number; deck: number; roof: number; cowl: number; nose: number; beltR: number; beltF: number;
  /** stations along the length (0 = tail, 1 = nose): rear screen bottom/top, windscreen top/bottom */
  tA: number; tB: number; tC: number; tD: number; roofW: number; hips: number; wheelR: number; axR: number; axF: number;
}
export const GT: Shape = { L: 4.5, W: 0.94, sill: 0.16, deck: 0.9, roof: 1.2, cowl: 0.86, nose: 0.56, beltR: 0.86, beltF: 0.78,
  tA: 0.1, tB: 0.3, tC: 0.53, tD: 0.7, roofW: 0.64, hips: 0.045, wheelR: 0.335, axR: 0.2, axF: 0.79 };

type P2 = [number, number];
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const curve = (pts: P2[], t: number) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * sm(pts[i - 1][0], pts[i][0], t);
  return pts[pts.length - 1][1];
};
const chaikin = (p: P2[]) => {
  const o: P2[] = [p[0]];
  for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
  o.push(p[p.length - 1]);
  return o;
};

export interface BodyParts {
  shell: THREE.BufferGeometry; mask: THREE.CanvasTexture;
  dark: THREE.BufferGeometry; chrome: THREE.BufferGeometry; tail: THREE.BufferGeometry; head: THREE.BufferGeometry; wing: THREE.BufferGeometry;
  wheel: { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry; disc: THREE.BufferGeometry };
  axleR: number; axleF: number; track: number; shape: Shape;
}

/** v coordinate (around the section) of the belt line and the roof edge. */
const V_BELT = 4 / 6, V_ROOF = 5 / 6;

export function buildBody(s: Shape = GT): BodyParts {
  const half = s.L / 2, Z = (t: number) => -half + t * s.L;
  const top = (t: number) => curve([[0, s.deck - 0.06], [0.035, s.deck], [s.tA, s.deck + 0.01], [s.tB, s.roof], [(s.tB + s.tC) / 2, s.roof + 0.012], [s.tC, s.roof - 0.015], [s.tD, s.cowl], [0.92, s.nose + 0.08], [1, s.nose - 0.06]], t);
  const belt = (t: number) => Math.min(top(t) - 0.02, s.beltR + (s.beltF - s.beltR) * t);
  const width = (t: number) => s.W * (1 - 0.08 * (1 - sm(0, 0.16, t)) - 0.16 * sm(0.78, 1, t) + s.hips * Math.exp(-Math.pow((t - s.axR) / 0.1, 2)) + s.hips * 0.7 * Math.exp(-Math.pow((t - s.axF) / 0.09, 2)));
  const under = (t: number) => s.sill + 0.06 * sm(0.9, 1, t) + 0.07 * (1 - sm(0, 0.1, t));
  const endScale = (t: number) => { const e = Math.min(t / 0.05, (1 - t) / 0.06, 1); return 0.78 + 0.22 * Math.sqrt(1 - (1 - e) * (1 - e)); };
  const Ra = s.wheelR + 0.055;
  const arch = (z: number) => { let y = 0; for (const a of [s.axR, s.axF]) { const dz = z - Z(a); if (Math.abs(dz) < Ra) y = Math.max(y, s.wheelR + Math.sqrt(Ra * Ra - dz * dz)); } return y; };

  // stations: uniform, plus tight pairs at the arch ends so the openings have crisp vertical edges
  const set = new Set<number>(); for (let i = 0; i <= 110; i++) set.add(i / 110);
  for (const a of [s.axR, s.axF]) for (const e of [-1, 1]) { const t = a + (e * Ra) / s.L; set.add(t - 0.0006); set.add(t + 0.0006); for (let k = 1; k < 8; k++) set.add(a + (e * Ra * Math.sin((k / 8) * 1.5708)) / s.L); }
  const ts = [...set].filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b), NS = ts.length;
  const rings = ts.map((t) => {
    const w = width(t), y0 = under(t), yb = belt(t), yt = top(t), cab = sm(0.03, 0.3, yt - yb);
    const wt = w * 0.86 + (s.W * s.roofW - w * 0.86) * cab;
    let pts: P2[] = [[0, y0], [w * 0.8, y0], [w, y0 + 0.1], [w * 1.006, y0 * 0.45 + yb * 0.55], [w * 0.98, yb], [wt, yt - 0.02 * cab], [0, yt + 0.02]];
    pts = chaikin(chaikin(pts));
    const sc = endScale(t), yc = (y0 + yb) / 2, z = Z(t), lift = arch(z);
    return pts.map(([x, y], j) => {
      let px = x * sc, py = yc + (y - yc) * sc;
      if (py < lift) { py = lift; if (j > pts.length * 0.3) px *= 1.012; } // wheel opening, with a slight lip
      else if (lift > 0 && py < lift + 0.1 && j > 6) px *= 1 + 0.02 * (1 - (py - lift) / 0.1); // flared arch
      return new THREE.Vector3(px, py, z);
    });
  });
  const NR = rings[0].length, pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
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
      const q = base + i * NR + j;
      if (side < 0) idx.push(q, q + NR + 1, q + 1, q, q + NR, q + NR + 1); else idx.push(q, q + 1, q + NR + 1, q, q + NR + 1, q + NR);
    }
    for (const [i, nz] of [[0, -1], [NS - 1, 1]] as const) { // end caps
      const ring = rings[i], c = pos.length / 3, cy = (ring[0].y + ring[NR - 1].y) / 2, start = c + 1;
      pos.push(0, cy, ring[0].z); nor.push(0, 0, nz); uv.push(i ? 1 : 0, 0.05);
      for (let j = 0; j < NR; j++) { pos.push(ring[j].x * side, ring[j].y, ring[j].z); nor.push(0, 0, nz); uv.push(i ? 1 : 0, 0.05); }
      for (let j = 0; j < NR - 1; j++) { if (side * nz < 0) idx.push(c, start + j, start + j + 1); else idx.push(c, start + j + 1, start + j); }
    }
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); shell.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  shell.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); shell.setIndex(idx);

  // ---- surface mask: R = glass, G = lamps, B = black trim and shut lines ----
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024;
  const g = cv.getContext('2d')!, X = (t: number) => t * 2048, Y = (v: number) => (1 - v) * 1024;
  g.fillStyle = '#000'; g.fillRect(0, 0, 2048, 1024);
  const rr = (t0: number, v0: number, t1: number, v1: number, r: number, col: string, skew = 0) => {
    g.fillStyle = col; g.beginPath();
    const x0 = X(t0), x1 = X(t1), y0 = Y(v1), y1 = Y(v0), k = skew * (y1 - y0);
    g.moveTo(x0 + r + k, y0); g.lineTo(x1 - r - k, y0); g.quadraticCurveTo(x1 - k, y0, x1 - k * 0.7, y0 + r); g.lineTo(x1, y1 - r); g.quadraticCurveTo(x1, y1, x1 - r, y1);
    g.lineTo(x0 + r, y1); g.quadraticCurveTo(x0, y1, x0, y1 - r); g.lineTo(x0 + k * 0.7, y0 + r); g.quadraticCurveTo(x0 + k, y0, x0 + r + k, y0); g.fill();
  };
  const line = (t0: number, v0: number, t1: number, v1: number, w = 3) => { g.strokeStyle = '#00f'; g.lineWidth = w; g.beginPath(); g.moveTo(X(t0), Y(v0)); g.lineTo(X(t1), Y(v1)); g.stroke(); };
  const tMid = (s.tB + s.tC) / 2 + 0.025;
  g.fillStyle = '#00f'; g.fillRect(0, Y(0.13), 2048, 1024); // underside and sills
  rr(s.tA + 0.02, V_BELT + 0.012, s.tD - 0.02, V_ROOF - 0.006, 10, '#00f', 0.9); // window surround
  rr(s.tA + 0.035, V_BELT + 0.022, tMid - 0.008, V_ROOF - 0.016, 12, '#f00', 0.9); rr(tMid + 0.008, V_BELT + 0.022, s.tD - 0.04, V_ROOF - 0.016, 12, '#f00', 0.9);
  rr(s.tC + 0.014, V_ROOF + 0.012, s.tD - 0.012, 1.02, 14, '#f00'); rr(s.tA + 0.012, V_ROOF + 0.012, s.tB - 0.014, 1.02, 14, '#f00');
  rr(0.935, 0.5, 0.992, 0.63, 14, '#0f0', -0.5); // head lamps
  rr(0.955, 0.16, 1.0, 0.4, 10, '#00f'); rr(0, 0.14, 0.03, 0.36, 8, '#00f'); // intake, rear valance
  line(s.tD - 0.012, 0.2, s.tD - 0.012, V_BELT); line(tMid, 0.2, tMid, V_BELT); line(s.tD - 0.012, 0.2, tMid, 0.2); // door
  line(s.tD + 0.03, V_BELT - 0.02, s.tD + 0.03, 1); line(s.tD + 0.03, V_BELT - 0.02, 0.93, V_BELT - 0.06); // bonnet
  line(s.tA - 0.03, V_BELT + 0.02, s.tA - 0.03, 1); line(0.955, 0.42, 0.955, 0.5); line(s.axF + 0.1, 0.42, s.axF + 0.135, 0.42, 9); // boot, bumper, vent
  const mask = new THREE.CanvasTexture(cv); mask.colorSpace = THREE.NoColorSpace; mask.anisotropy = 8; mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping;

  // ---- bolt-on parts ----
  const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rx = 0) => { const q = new THREE.BoxGeometry(sx, sy, sz); if (rx) q.rotateX(rx); q.translate(cx, cy, cz); return q; };
  const tube = (cx: number, cy: number, cz: number, r: number, len: number) => { const q = new THREE.CylinderGeometry(r, r, len, 20, 1, true); q.rotateX(Math.PI / 2); q.translate(cx, cy, cz); return q; };
  const zr = -half, xm = width(0) * endScale(0), yDeck = top(0.01), yb0 = under(0), zf = half, xn = width(1) * endScale(1), yn = top(1);
  const dark: THREE.BufferGeometry[] = [], chrome: THREE.BufferGeometry[] = [], tail: THREE.BufferGeometry[] = [], head: THREE.BufferGeometry[] = [];
  dark.push(box(0, yb0 + 0.06, zr + 0.09, xm * 1.6, 0.14, 0.1), box(0, s.sill - 0.02, 0, s.W * 1.5, 0.05, s.L * 0.86)); // diffuser, floor
  for (let i = -2; i <= 2; i++) dark.push(box(i * 0.16, yb0 + 0.04, zr + 0.03, 0.014, 0.1, 0.1));
  tail.push(box(0, yDeck - 0.15, zr - 0.006, xm * 1.74, 0.04, 0.03)); // full-width light bar
  dark.push(box(0, yDeck - 0.31, zr + 0.004, 0.5, 0.12, 0.02), box(0, yn - 0.2, zf - 0.035, xn * 1.2, 0.13, 0.08), box(0, under(1) + 0.0, zf - 0.12, xn * 1.9, 0.025, 0.24)); // plate recess, grille, splitter
  for (const sx of [-1, 1]) {
    chrome.push(tube(sx * xm * 0.55, yb0 + 0.12, zr - 0.02, 0.055, 0.16)); dark.push(tube(sx * xm * 0.55, yb0 + 0.12, zr - 0.03, 0.045, 0.16));
    head.push(box(sx * xn * 0.62, yn - 0.19, zf - 0.02, xn * 0.5, 0.022, 0.05)); // daytime running strips
    const zm = Z(s.tD) - 0.16, wm = width(s.tD - 0.035); // mirrors
    const m = new THREE.SphereGeometry(0.085, 14, 10); m.scale(1.1, 0.7, 0.85); m.translate(sx * (wm + 0.005), belt(s.tD - 0.035) + 0.05, zm); dark.push(m);
    // wheel wells
    for (const t of [s.axR, s.axF]) { const wl = new THREE.CylinderGeometry(Ra + 0.02, Ra + 0.02, 0.5, 24, 1, true, Math.PI / 2, Math.PI); wl.rotateZ(Math.PI / 2); wl.rotateX(Math.PI / 2); wl.translate(sx * (width(t) - 0.27), s.wheelR, Z(t)); dark.push(wl); }
  }
  const wingParts = [box(0, s.deck + 0.3, -half + 0.16, s.W * 1.86, 0.028, 0.3, -0.13)];
  for (const sx of [-1, 1]) wingParts.push(box(sx * s.W * 0.56, s.deck + 0.15, -half + 0.2, 0.035, 0.3, 0.14, -0.2), box(sx * s.W * 0.94, s.deck + 0.3, -half + 0.16, 0.02, 0.15, 0.36));

  // ---- wheel: tyre, alloy rim with five split spokes, brake disc. Axle along x, outer face towards +x. ----
  const R = s.wheelR, tw = 0.27, rimR = R * 0.69;
  const prof = [[rimR, -tw / 2], [R * 0.9, -tw / 2 + 0.005], [R * 0.985, -tw / 2 + 0.035], [R, -tw / 4], [R, tw / 4], [R * 0.985, tw / 2 - 0.035], [R * 0.9, tw / 2 - 0.005], [rimR, tw / 2]].map(([r, y]) => new THREE.Vector2(r, y));
  const tyre = new THREE.LatheGeometry(prof, 48); tyre.rotateZ(-Math.PI / 2);
  const barrel = new THREE.LatheGeometry([[rimR * 0.8, -tw / 2 + 0.02], [rimR, -tw / 2], [rimR, tw / 2], [rimR * 0.93, tw / 2 - 0.012], [rimR * 0.9, tw / 2 - 0.05]].map(([r, y]) => new THREE.Vector2(r, y)), 48); barrel.rotateZ(-Math.PI / 2);
  const rim: THREE.BufferGeometry[] = [barrel];
  for (let k = 0; k < 5; k++) for (const e of [-1, 1]) {
    const sp = new THREE.BoxGeometry(0.028, rimR * 0.86, 0.034); sp.translate(0, rimR * 0.5, 0); sp.rotateX(e * 0.17); sp.rotateZ(0.12); sp.translate(tw / 2 - 0.05, 0, 0); sp.rotateX((k / 5) * Math.PI * 2); rim.push(sp);
  }
  const hub = new THREE.CylinderGeometry(R * 0.2, R * 0.24, 0.05, 20); hub.rotateZ(-Math.PI / 2); hub.translate(tw / 2 - 0.04, 0, 0); rim.push(hub);
  const disc = new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.03, 32); disc.rotateZ(-Math.PI / 2); disc.translate(tw / 2 - 0.1, 0, 0);
  const strip = (q: THREE.BufferGeometry[]) => mergeGeometries(q.map((x) => { const y = x.index ? x.toNonIndexed() : x; y.deleteAttribute('uv'); return y; }))!;
  return { shell, mask, dark: strip(dark), chrome: strip(chrome), tail: strip(tail), head: strip(head), wing: strip(wingParts),
    wheel: { tyre, rim: strip(rim), disc }, axleR: Z(s.axR), axleF: Z(s.axF), track: width(s.axR) - tw / 2 + 0.02, shape: s };
}
