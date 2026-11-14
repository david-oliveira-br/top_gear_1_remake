import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointAt, type Track } from '../../../sim/src/index';
import { World, fbm, hash, M, std, type BridgeRange } from './base';

/** Shared builders for route-relative worlds (Coast, Rockies, Patagonia): everything is placed in arc-length / lateral coordinates. */

export type Bounds = { x0: number; x1: number; z0: number; z1: number };
/** Terrain grid bounds around the track; `pad` is the margin in metres on each side (defaults suit the coast). */
export const routeBounds = (t: Track, pad: Partial<Bounds> = {}): Bounds => ({
  x0: Math.floor(Math.min(...t.px) - (pad.x0 ?? 420)), x1: Math.ceil(Math.max(...t.px) + (pad.x1 ?? 460)),
  z0: Math.floor(Math.min(...t.pz) - (pad.z0 ?? 420)), z1: Math.ceil(Math.max(...t.pz) + (pad.z1 ?? 380)),
});

/**
 * Smooth fields around the road. Returns (x, z) => [distance to the road, road height there, side].
 * side is <0 left of travel (the sea on the coast), >0 right, smooth across the road. `endSide` is the value past the end of an open road
 * (default -1; use 0 for worlds with no sea side).
 */
export function roadField(t: Track, b: Bounds, opts: { endSide?: number } = {}) {
  const endSide = opts.endSide ?? -1;
  const C = 12, R = 650, rc = Math.ceil(R / C), W = Math.ceil((b.x1 - b.x0) / C) + 1, H = Math.ceil((b.z1 - b.z0) / C) + 1;
  const d = new Float32Array(W * H).fill(1e9), sw = new Float32Array(W * H), sr = new Float32Array(W * H), ss = new Float32Array(W * H);
  const idxs: number[] = []; for (let i = 0; i < t.n; i += 3) idxs.push(i); idxs.push(t.n - 1);
  for (const i of idxs) {
    const cx = Math.round((t.px[i] - b.x0) / C), cz = Math.round((t.pz[i] - b.z0) / C);
    for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) {
      const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= W || z >= H) continue;
      const ox = b.x0 + x * C - t.px[i], oz = b.z0 + z * C - t.pz[i], dist = Math.hypot(ox, oz); if (dist > R) continue;
      const k = z * W + x, w = 1 / (dist * dist + 14400), lat = ox * -t.tz[i] + oz * t.tx[i];
      sw[k] += w; sr[k] += w * t.py[i];
      // the side comes from the nearest sample only (averaging puts land in the sea behind bends); past the end of the road it is `endSide`
      if (dist < d[k]) { d[k] = dist; ss[k] = i === t.n - 1 && ox * t.tx[i] + oz * t.tz[i] > 0 ? endSide : lat / (Math.abs(lat) + 25); }
    }
  }
  for (let k = 0; k < W * H; k++) if (sw[k] > 0) sr[k] /= sw[k]; else d[k] = 1e9;
  // cells out of reach of the road take the values of the nearest covered cell (two chamfer passes)
  const pull = (k: number, o: number, c: number) => { if (d[o] + c < d[k]) { d[k] = d[o] + c; sr[k] = sr[o]; ss[k] = ss[o]; } };
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) { const k = z * W + x; if (x > 0) pull(k, k - 1, C); if (z > 0) pull(k, k - W, C); if (x > 0 && z > 0) pull(k, k - W - 1, C * 1.4); if (x < W - 1 && z > 0) pull(k, k - W + 1, C * 1.4); }
  for (let z = H - 1; z >= 0; z--) for (let x = W - 1; x >= 0; x--) { const k = z * W + x; if (x < W - 1) pull(k, k + 1, C); if (z < H - 1) pull(k, k + W, C); if (x < W - 1 && z < H - 1) pull(k, k + W + 1, C * 1.4); if (x > 0 && z < H - 1) pull(k, k + W - 1, C * 1.4); }
  for (let pass = 0; pass < 3; pass++) { const c = ss.slice(); for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) { const k = z * W + x; ss[k] = (c[k] * 4 + c[k - 1] + c[k + 1] + c[k - W] + c[k + W]) / 8; } }
  const bil = (a: Float32Array, x: number, z: number) => {
    const gx = Math.max(0, Math.min(W - 1.001, (x - b.x0) / C)), gz = Math.max(0, Math.min(H - 1.001, (z - b.z0) / C)), i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * W + i;
    return (a[k] * (1 - fx) + a[k + 1] * fx) * (1 - fz) + (a[k + W] * (1 - fx) + a[k + W + 1] * fx) * fz;
  };
  return (x: number, z: number) => [bil(d, x, z), bil(sr, x, z), bil(ss, x, z)] as const;
}

export type PathPt = { x: number; y: number; z: number; tx: number; tz: number; bank: number };
/** Extrude a profile (lateral u, vertical v) along a path; the faces are flat shaded. */
export function sweep(path: PathPt[], prof: [number, number][]) {
  const pos: number[] = [], idx: number[] = [], np = prof.length;
  for (const p of path) for (const [u, v] of prof) pos.push(p.x - p.tz * u, p.y + v + u * p.bank, p.z + p.tx * u);
  for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < np; j++) { const a = i * np + j, b = i * np + (j + 1) % np; idx.push(a, b, a + np, b, b + np, a + np); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const f = g.toNonIndexed(); f.computeVertexNormals(); return f;
}

/** Road point at arc length s, lateral offset lat (+ dy): position, unit tangent (tx,tz) and banking slope. */
export function pathAt(t: Track, s: number, lat = 0, dy = 0): PathPt {
  const [x, y, z, yaw] = pointAt(t, s, lat), k = Math.max(0, Math.min(t.n - 1, Math.round(s / t.step)));
  return { x, y: y + dy, z, tx: Math.cos(yaw), tz: Math.sin(yaw), bank: t.bank[k] };
}
/** Arc lengths from a to b every `st` metres, always including b. */
export function sRange(a: number, b: number, st = 2) { const out: number[] = []; for (let s = a; s < b; s += st) out.push(s); out.push(b); return out; }

/** Start / finish banner material (canvas texture): the chequered finish, or a dark sign with a yellow subtitle. */
export function banner(text: string, sub: string, chequer: boolean) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160; const g = c.getContext('2d')!;
  g.fillStyle = chequer ? '#f4f4f4' : '#101a2a'; g.fillRect(0, 0, 1024, 160);
  if (chequer) { for (let i = 0; i < 64; i++) for (let j = 0; j < 10; j++) if ((i + j) % 2) { g.fillStyle = '#111'; g.fillRect(i * 16, j * 16, 16, 16); } g.fillStyle = '#d6101e'; g.fillRect(212, 28, 600, 104); }
  else { g.fillStyle = '#e8b21a'; g.fillRect(0, 0, 1024, 12); g.fillRect(0, 148, 1024, 12); }
  g.fillStyle = '#fff'; g.font = 'bold 74px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 512, chequer ? 80 : 66);
  if (!chequer) { g.font = '600 32px sans-serif'; g.fillStyle = '#e8b21a'; g.fillText(sub, 512, 124); }
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
  return new THREE.MeshStandardNodeMaterial({ map: tx, roughness: 0.6, side: THREE.DoubleSide });
}

/** A steel gantry across the road at arc length s with `mat` (see banner) hanging under the beam, facing the traffic. */
export function gantry(W: World, s: number, mat: THREE.Material) {
  const lim = W.lim, p = pathAt(W.track, s), yaw = Math.atan2(-p.tz, p.tx), span = lim + 1.6, H = 7.2, steel = std(0x9aa0a6, 0.4, 0.8);
  const post = new THREE.CylinderGeometry(0.28, 0.34, H, 10).translate(0, H / 2, 0), beam = new THREE.BoxGeometry(0.5, 0.5, span * 2 + 0.6).translate(0, H - 0.25, 0);
  const mats: THREE.Matrix4[] = [];
  for (const side of [-1, 1]) { const l = side * span; mats.push(M(p.x - p.tz * l, p.y + side * lim * p.bank - 0.3, p.z + p.tx * l, 0, 1)); }
  W.place(post, steel, mats); const bm = new THREE.Mesh(beam, steel); bm.position.set(p.x, p.y, p.z); bm.rotation.y = yaw; bm.castShadow = true; W.group.add(bm);
  const bw = span * 2 - 0.4, ban = new THREE.Mesh(new THREE.PlaneGeometry(bw, bw * 160 / 1024), mat);
  ban.position.set(p.x, p.y + H - 0.5 - (bw * 160 / 1024) / 2, p.z); ban.rotation.y = Math.atan2(-p.tx, -p.tz); ban.castShadow = true; W.group.add(ban);
}

/**
 * Bridge deck over the arc-length range `br`: a slab plus two parapets, as flat-shaded geometries (deck, left, right).
 * With `mat` the merged geometries (and `extra`) are added to the world as one mesh. Returns the geometries and the deck dimensions.
 */
export function deckBridge(W: World, br: BridgeRange, opts: { mat?: THREE.Material; deckBot?: number; parapet?: number; extra?: THREE.BufferGeometry[]; step?: number } = {}) {
  const lim = W.lim, t = W.track, deckW = lim + 0.65, deckY = -0.02, deckBot = opts.deckBot ?? -1.05, ph = opts.parapet ?? 0.95;
  const path = sRange(br.from, br.to, opts.step ?? 2).map((s) => pathAt(t, s));
  const geos: THREE.BufferGeometry[] = [sweep(path, [[-deckW, deckY], [deckW, deckY], [deckW, deckBot], [-deckW, deckBot]]),
    sweep(path, [[-(lim + 0.15), deckY], [-(lim + 0.15), ph], [-(lim + 0.65), ph], [-(lim + 0.65), deckY]]), sweep(path, [[lim + 0.15, deckY], [lim + 0.15, ph], [lim + 0.65, ph], [lim + 0.65, deckY]])];
  let mesh: THREE.Mesh | null = null;
  if (opts.mat) { mesh = new THREE.Mesh(mergeGeometries(geos.concat(opts.extra ?? []))!, opts.mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; W.group.add(mesh); }
  return { geos, mesh, deckW, deckY, deckBot, path };
}

/** One cone tier of a conifer crown with jittered radius. */
const cone = (r: number, h: number, y: number, seg: number, rough: number) => {
  const g = new THREE.ConeGeometry(r, h, seg, 3, true); g.translate(0, y + h / 2, 0); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 1 + (hash(Math.round(p.getX(i) * 40), Math.round(p.getY(i) * 20 + p.getZ(i) * 40)) - 0.5) * rough; p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k); }
  return g;
};
/** Conifer crown (five stacked cones, ~14.4 m + trunk base at y 0) and trunk. `lite` = three coarser tiers for far trees (no shadows). */
export function coniferGeo(opts: { lite?: boolean } = {}) {
  const crown = opts.lite
    ? mergeGeometries([cone(1.7, 6.4, 2.4, 6, 0.5), cone(1.2, 6.2, 6.4, 6, 0.45), cone(0.7, 5.6, 10.6, 5, 0.3)])!
    : mergeGeometries([cone(1.7, 5.2, 2.4, 10, 0.5), cone(1.45, 5, 5.0, 10, 0.5), cone(1.15, 4.8, 8.0, 9, 0.45), cone(0.8, 4.4, 11.2, 8, 0.35), cone(0.4, 2.4, 14.4, 6, 0.2)])!;
  crown.computeVertexNormals();
  const trunk = new THREE.CylinderGeometry(0.2, 0.34, 4.5, 6).translate(0, 2.2, 0);
  return { crown, trunk };
}

/**
 * Candidate positions for scattered props, deterministic. `accept(x, z, seed, near)` decides and records the prop (e.g. pushes a matrix) and returns true if placed.
 * near: `per` candidates every `stride` track samples, lateral offset lim + gap + exponential(mean) on a random side, until `cap` are accepted.
 * far: `tries` uniform candidates over the bounds, until `farCap` (default cap * 1.25) are accepted in total.
 */
export function scatter(t: Track, b: Bounds, lim: number, o: { cap: number; farCap?: number; stride?: number; per?: number; gap?: number; mean?: number; tries?: number; accept: (x: number, z: number, seed: number, near: boolean) => boolean }) {
  let n = 0; const stride = o.stride ?? 2, per = o.per ?? 5, gap = o.gap ?? 5, mean = o.mean ?? 38;
  for (let i = 0, k = 0; i < t.n && n < o.cap; i += stride) for (let a = 0; a < per; a++, k++) {
    const side = hash(k, 1) > 0.5 ? 1 : -1, off = lim + gap + -Math.log(1 - hash(k, 2) * 0.999) * mean, l = side * off;
    if (o.accept(t.px[i] - t.tz[i] * l, t.pz[i] + t.tx[i] * l, k, true)) n++;
  }
  const farCap = o.farCap ?? o.cap * 1.25;
  for (let k = 0; k < (o.tries ?? 0) && n < farCap; k++) if (o.accept(b.x0 + hash(k, 41) * (b.x1 - b.x0), b.z0 + hash(k, 43) * (b.z1 - b.z0), k + 99991, false)) n++;
  return n;
}

/**
 * Low-poly backdrop mountains: one flat-shaded ridged cone per entry (centre x,z; radius r and height h in metres; seed), standing from `base` upward.
 * Meant for 1.5-4 km out, beyond the terrain grid; the camera far plane is 6000 m. Returns the merged mesh (added to the world group).
 */
export function peaks(W: World, defs: { x: number; z: number; r: number; h: number; seed: number }[], material: THREE.Material, base = -40) {
  const geos: THREE.BufferGeometry[] = [];
  for (const d of defs) {
    const seg = 28, rings = 9, pos: number[] = [], idx: number[] = [], sd = d.seed * 31.7;
    pos.push(d.x, base + d.h, d.z); // summit (ring 0)
    for (let r = 1; r <= rings; r++) {
      const f = r / rings; // 0 summit .. 1 foot
      for (let s = 0; s < seg; s++) {
        const a = (s / seg) * Math.PI * 2, ridge = 0.78 + 0.5 * fbm(Math.cos(a) * 2.2 + sd, Math.sin(a) * 2.2 + sd * 0.7); // radial ridges / gullies
        const rad = d.r * (0.04 + f) * (f > 0.15 ? ridge * (1 - 0.15 * (1 - f)) + 0.0 : ridge) * (0.88 + 0.24 * hash(s * 7 + r, d.seed));
        // concave flanks: height falls off quickly near the summit, flattens to the foot
        const hh = base + d.h * Math.pow(1 - f, 1.35) * (0.82 + 0.3 * fbm(f * 5 + sd, a * 1.5)) + (hash(s + r * 13, d.seed + 5) - 0.5) * d.h * 0.05 * f * (1 - f) * 4;
        pos.push(d.x + Math.cos(a) * rad, hh, d.z + Math.sin(a) * rad);
      }
    }
    for (let s = 0; s < seg; s++) idx.push(0, 1 + (s + 1) % seg, 1 + s);
    for (let r = 0; r < rings - 1; r++) for (let s = 0; s < seg; s++) {
      const a = 1 + r * seg + s, b = 1 + r * seg + (s + 1) % seg, c = a + seg, e = b + seg; idx.push(a, b, c, b, e, c);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const f = g.toNonIndexed(); f.computeVertexNormals(); geos.push(f);
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos)!, material); mesh.frustumCulled = false; mesh.receiveShadow = false; mesh.castShadow = false; W.group.add(mesh);
  return mesh;
}
