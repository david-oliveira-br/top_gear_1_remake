import * as THREE from 'three/webgpu';
import { triplanarTexture, texture, uv, mix, vec2, vec3, float, positionWorld, normalWorld, smoothstep, fract, floor, step, abs, sin, time, mx_noise_float, normalMap, max, positionLocal } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COAST_BRIDGE, FINISH_BEFORE_END, pointAt, type Track } from '../../../sim/src/index';
import type { Engine } from '../gfx/engine';
import { World, fbm, hash, M, set, sstep, std, vnoise, type WorldDef } from './base';

export const COAST_BOUNDS = (t: Track) => ({ x0: Math.floor(Math.min(...t.px) - 420), x1: Math.ceil(Math.max(...t.px) + 460), z0: Math.floor(Math.min(...t.pz) - 420), z1: Math.ceil(Math.max(...t.pz) + 380) });

/** Smooth fields around the road: distance to it, its height there and which side (<0 ocean, left of travel) a point lies on. */
function roadField(t: Track, b: ReturnType<typeof COAST_BOUNDS>) {
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
      // the side comes from the nearest sample only (averaging puts land in the sea behind bends); past the end of the road is ocean
      if (dist < d[k]) { d[k] = dist; ss[k] = i === t.n - 1 && ox * t.tx[i] + oz * t.tz[i] > 0 ? -1 : lat / (Math.abs(lat) + 25); }
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

/** Extrude a profile (lateral u, vertical v) along a path; the faces are flat shaded. */
function sweep(path: { x: number; y: number; z: number; tx: number; tz: number; bank: number }[], prof: [number, number][]) {
  const pos: number[] = [], idx: number[] = [], np = prof.length;
  for (const p of path) for (const [u, v] of prof) pos.push(p.x - p.tz * u, p.y + v + u * p.bank, p.z + p.tx * u);
  for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < np; j++) { const a = i * np + j, b = i * np + (j + 1) % np; idx.push(a, b, a + np, b, b + np, a + np); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const f = g.toNonIndexed(); f.computeVertexNormals(); return f;
}

export function makeCoast(eng: Engine, track: Track) {
  const t = track, b = COAST_BOUNDS(t), field = roadField(t, b), lim = t.def.halfWidth + t.def.shoulder, len = t.len, finishS = len - FINISH_BEFORE_END;
  const br = COAST_BRIDGE, smid = (br.from + br.to) / 2, half = (br.to - br.from) / 2;
  const [mx, , mz, myaw] = pointAt(t, smid, 0), Dx = Math.cos(myaw), Dz = Math.sin(myaw);
  // lighthouse headland, left of the road near the end
  const LS = len - 150, [lx0, , lz0, lyaw] = pointAt(t, LS, 0), LAT = -46, lhx = lx0 - Math.sin(lyaw) * LAT, lhz = lz0 + Math.cos(lyaw) * LAT;
  const lhRy = t.py[Math.round(LS / t.step)];

  function natural(x: number, z: number) {
    const [d, ry, side] = field(x, z), ti = sstep(-0.4, 0.4, side), n1 = fbm(x / 70 + 3, z / 70);
    // ocean side: plateau, cliff edge, steep rocky face, then a shelf at the waterline and the sea floor
    const e = 4 + 16 * n1, hp = ry - 1.2 - d * 0.015, hb = 2.2, wcl = Math.max(12, (hp - hb) * 0.62), f = sstep(e, e + wcl, d);
    let ho = hb + (hp - hb) * (1 - f * f * (3 - 2 * f)) + (fbm(x / 25, z / 25) - 0.45) * 1.6 * (1 - f); ho += ((fbm(x / 34 + 50, z / 34) - 0.45) * 30 + (fbm(x / 11, z / 11) - 0.45) * 7) * f * (1 - f) * 4 * (1 - f * 0.2);
    if (d > e + wcl) ho = hb - Math.min(16, (d - e - wcl) * 0.1) + 4.5 * Math.max(0, vnoise(x / 17, z / 17) - 0.78) * 4 * sstep(e + wcl, e + wcl + 12, d) * (1 - sstep(e + wcl + 20, e + wcl + 80, d));
    // inland: golden rolling hills, gullies, mountains further away
    const gul = Math.pow(1 - Math.abs(2 * vnoise(x / 120 + 11, z / 120 + 5) - 1), 7) * 22 * sstep(30, 160, d);
    let hi = ry - 0.9 + (d - 8) * 0.1 + sstep(10, 260, d) * (30 + 70 * fbm(x / 240, z / 240)) + (fbm(x / 36, z / 36) - 0.45) * 6 * sstep(15, 80, d) - gul + sstep(250, 650, d) * 90;
    hi = Math.max(hi, ry - 2);
    let h = ho + (hi - ho) * ti;
    // headland with the lighthouse
    const r = Math.hypot(x - lhx, z - lhz) / 62; if (r < 1) h = Math.max(h, (lhRy + 8) * sstep(1, 0.45, r));
    // canyon under the bridge: runs across the road (b = metres inland of the road line, a = along it)
    const a = (x - mx) * Dx + (z - mz) * Dz, bb = -(x - mx) * Dz + (z - mz) * Dx, aw = Math.abs(a) + (fbm(x / 50 + 20, z / 50) - 0.5) * 30 * sstep(0, 40, Math.abs(a));
    if (Math.abs(a) < 118 && bb > -330 && bb < 420) {
      const floorY = Math.max(-6, 25 + (bb > 0 ? bb * 0.2 : bb * 0.26) + (fbm(x / 30, z / 30) - 0.5) * 5);
      const vh = floorY + 82 * Math.pow(sstep(8, 106, Math.max(0, Math.min(Math.abs(a) + 10, aw))), 1.05) + (fbm(x / 11, z / 11) - 0.5) * 7 * sstep(15, 60, Math.abs(a));
      h = Math.min(h, vh);
    }
    return h;
  }

  const rock = () => set('rock_face_03');
  function terrainMaterial() {
    const grass = set('aerial_grass_rock'), sand = set('aerial_beach_01'), rk = rock();
    const m = new THREE.MeshStandardNodeMaterial();
    const p = positionWorld.xz, y = positionWorld.y, ny = normalWorld.y;
    const lay = (s: ReturnType<typeof set>, a: number, bb: number) => mix(texture(s.map, p.div(a)).rgb, texture(s.map, p.div(bb)).rgb, 0.5);
    const sandW = float(1).sub(smoothstep(2.4, 3.8, y)), rockW = smoothstep(0.9, 0.68, ny), macro = mx_noise_float(p.div(110)).mul(0.14).add(0.94);
    const patch = smoothstep(-0.2, 0.35, mx_noise_float(p.div(70).add(vec2(4, 9)))), gully = smoothstep(75, 30, y);
    const gold = lay(grass, 8, 53).mul(vec3(1.55, 1.18, 0.62)), olive = lay(grass, 8, 53).mul(vec3(0.85, 0.95, 0.5));
    const gcol = mix(mix(gold, gold.mul(vec3(0.82, 0.8, 0.8)), patch), olive, gully.mul(0.45));
    const rcol = triplanarTexture(texture(rk.map), null, null, float(1 / 30)).rgb.mul(vec3(0.74, 0.7, 0.66)).mul(mx_noise_float(vec3(p.div(9), y.div(40))).mul(0.25).add(0.85));
    const scol = lay(sand, 14, 70).mul(vec3(1.15, 1.05, 0.9));
    const foam = smoothstep(1.5, 0.3, y).mul(smoothstep(-0.9, 0.0, y)).mul(mx_noise_float(vec3(p.div(2.2), time.mul(0.7))).mul(0.5).add(0.55));
    m.colorNode = mix(mix(mix(gcol, scol, sandW), rcol, rockW).mul(macro), vec3(0.9, 0.93, 0.95), foam.mul(0.7));
    m.roughnessNode = mix(mix(texture(grass.rough, p.div(9)).r, texture(sand.rough, p.div(14)).r, sandW), texture(rk.rough, p.div(26)).r, rockW);
    m.normalNode = normalMap(mix(mix(texture(grass.nor, p.div(9)), texture(sand.nor, p.div(14)), sandW), texture(rk.nor, p.div(26)), rockW));
    return m;
  }

  function roadMaterial(w: World) {
    const hw = w.track.def.halfWidth, asph = set('asphalt_04'), grass = set('aerial_grass_rock');
    const m = new THREE.MeshStandardNodeMaterial();
    const l = uv().x, s = uv().y, al = abs(l), auv = vec2(l, s).div(7);
    const onRoad = float(1).sub(smoothstep(hw - 0.02, hw + 0.02, al));
    const worn = smoothstep(5.0, 1.2, abs(l.add(sin(s.mul(0.017)).mul(1.0)))).mul(0.2);
    const base = texture(asph.map, auv).rgb.mul(0.7).mul(float(1).sub(worn)).mul(vec3(1, 0.98, 0.95));
    const edge = smoothstep(0.1, 0.08, abs(al.sub(hw - 0.4)));
    const yel = smoothstep(0.075, 0.055, abs(al.sub(0.2))); // double yellow centre line (two-lane road)
    const chq = (s0: number, d: number) => step(s0, s).mul(step(s, d + s0)).mul(step(0.5, fract(floor(s.sub(s0).div(0.7)).add(floor(l.div(0.7))).mul(0.5))));
    const white = max(max(edge, step(abs(s.sub(98)), 0.22)), chq(finishS, 2.1)).mul(onRoad).mul(texture(asph.rough, auv).r.mul(0.5).add(0.6));
    const shoulder = smoothstep(hw + 0.1, hw + 0.3, al).mul(float(1).sub(smoothstep(lim - 0.2, lim + 1.2, al)));
    const dust = texture(asph.map, auv.mul(1.7)).rgb.mul(vec3(1.5, 1.38, 1.15)).mul(0.78);
    const verge = texture(grass.map, vec2(l, s).div(6)).rgb.mul(vec3(1.5, 1.15, 0.6));
    m.colorNode = mix(mix(mix(mix(verge, dust, shoulder), base, onRoad), vec3(0.82), white), vec3(0.9, 0.66, 0.08), yel.mul(onRoad));
    m.roughnessNode = mix(float(0.95), texture(asph.rough, auv).r.mul(0.75).sub(worn.mul(0.5)), onRoad);
    m.normalNode = normalMap(mix(texture(grass.nor, vec2(l, s).div(6)), texture(asph.nor, auv), onRoad));
    return m;
  }

  function props(W: World) {
    const q = W.eng.quality, group = W.group, place = W.place.bind(W), pulse = W.pulse;
    const conc = set('concrete_wall_008');
    const concrete = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    concrete.colorNode = triplanarTexture(texture(conc.map), null, null, float(1 / 5)).rgb.mul(vec3(1.0, 0.97, 0.9)).mul(0.95);
    concrete.roughnessNode = float(0.85);

    // ---------- conifers: dark, tall, sparse near the road, denser in gullies ----------
    const cone = (r: number, h: number, y: number, seg: number, rough: number) => {
      const g = new THREE.ConeGeometry(r, h, seg, 3, true); g.translate(0, y + h / 2, 0); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 1 + (hash(Math.round(p.getX(i) * 40), Math.round(p.getY(i) * 20 + p.getZ(i) * 40)) - 0.5) * rough; p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k); }
      return g;
    };
    const crown = mergeGeometries([cone(1.7, 5.2, 2.4, 10, 0.5), cone(1.45, 5, 5.0, 10, 0.5), cone(1.15, 4.8, 8.0, 9, 0.45), cone(0.8, 4.4, 11.2, 8, 0.35), cone(0.4, 2.4, 14.4, 6, 0.2)])!; crown.computeVertexNormals();
    const trunk = new THREE.CylinderGeometry(0.2, 0.34, 4.5, 6).translate(0, 2.2, 0);
    const trees: THREE.Matrix4[] = [], tcol: THREE.Color[] = [];
    const tryTree = (x: number, z: number, p: number, seed: number) => {
      const h = W.heightAt(x, z); if (h < 6 || W.roadDist(x, z) < lim + 4) return;
      const sl = Math.abs(W.heightAt(x + 4, z) - h) + Math.abs(W.heightAt(x, z + 4) - h); if (sl > 6.5) return;
      const ring = (W.heightAt(x + 20, z) + W.heightAt(x - 20, z) + W.heightAt(x, z + 20) + W.heightAt(x, z - 20)) / 4, g = Math.max(0, Math.min(1, (ring - h) / 9));
      if (hash(seed, 77) > p + 0.7 * g + (vnoise(x / 130, z / 130) > 0.64 ? 0.4 : 0)) return;
      const sc = 0.75 + hash(seed, 5) * 0.95, tall = 0.95 + hash(seed, 6) * 0.9;
      trees.push(M(x, h - 0.4, z, hash(seed, 9) * 6.28, sc * 0.62, sc * tall, sc * 0.62));
      tcol.push(new THREE.Color().setHSL(0.3 + hash(seed, 3) * 0.08, 0.32, 0.022 + hash(seed, 8) * 0.026));
    };
    const maxTrees = Math.round(7000 * q.detail);
    for (let i = 0, k = 0; i < t.n && trees.length < maxTrees; i += 2) for (let a = 0; a < 5; a++, k++) {
      const side = hash(k, 1) > 0.5 ? 1 : -1, off = lim + 5 + -Math.log(1 - hash(k, 2) * 0.999) * 38, l = side * off;
      tryTree(t.px[i] - t.tz[i] * l, t.pz[i] + t.tx[i] * l, 0.035, k);
    }
    for (let k = 0; k < 14000 * q.detail && trees.length < maxTrees * 1.25; k++) tryTree(b.x0 + hash(k, 41) * (b.x1 - b.x0), b.z0 + hash(k, 43) * (b.z1 - b.z0), 0.0, k + 99991);
    const foliage = std(0xffffff, 0.85); 
    foliage.colorNode = vec3(1).mul(mx_noise_float(positionWorld.mul(2.2)).mul(0.35).add(1.0)).mul(mix(float(0.55), float(1.15), positionLocal.y.div(14).clamp(0, 1)));
    place(crown, foliage, trees, tcol); place(trunk, std(0x3d2d22, 0.9), trees);

    // ---------- the arch bridge ----------
    const pathAt = (s: number, lat = 0, dy = 0) => { const [x, y, z, yaw] = pointAt(t, s, lat), k = Math.max(0, Math.min(t.n - 1, Math.round(s / t.step))); return { x, y: y + dy, z, tx: Math.cos(yaw), tz: Math.sin(yaw), bank: t.bank[k] }; };
    const sRange = (a: number, bb: number, st = 2) => { const out: number[] = []; for (let s = a; s < bb; s += st) out.push(s); out.push(bb); return out; };
    const deckW = lim + 0.65, deckY = -0.02, deckBot = -1.05;
    const full = sRange(br.from, br.to).map((s) => pathAt(s));
    const geos: THREE.BufferGeometry[] = [sweep(full, [[-deckW, deckY], [deckW, deckY], [deckW, deckBot], [-deckW, deckBot]]),
      sweep(full, [[-(lim + 0.15), deckY], [-(lim + 0.15), 0.95], [-(lim + 0.65), 0.95], [-(lim + 0.65), deckY]]), sweep(full, [[lim + 0.15, deckY], [lim + 0.15, 0.95], [lim + 0.65, 0.95], [lim + 0.65, deckY]])];
    const deckBottom = pathAt(smid).y + deckBot, ribT = 0.95, ribW = 1.15, as = 62, ribLat = 5.4;
    const hRel = (s: number, lat: number) => { const p = pathAt(s, lat); return W.heightAt(p.x, p.z); };
    for (const lat of [-ribLat, ribLat]) {
      const ys = Math.min(hRel(smid - as, lat), hRel(smid + as, lat)) - 2.5, yc = deckBottom - ribT;
      const arch = (a: number) => ys + (yc - ys) * (1 - (a / as) * (a / as));
      const rib = sRange(-as, as, 3).map((a) => { const p = pathAt(smid + a, lat); return { ...p, y: arch(a), bank: 0 }; });
      geos.push(sweep(rib, [[-ribW, -ribT], [ribW, -ribT], [ribW, ribT], [-ribW, ribT]]));
    }
    const concreteMesh = new THREE.Mesh(mergeGeometries(geos)!, concrete); concreteMesh.castShadow = true; concreteMesh.receiveShadow = true; concreteMesh.frustumCulled = false; group.add(concreteMesh);
    // spandrel columns over the ribs and on the canyon walls, cross beams at the top, abutments at both ends
    const colM: THREE.Matrix4[] = [], bk = (a: number, lat: number) => { const p = pathAt(smid + a, lat); return { p, x: p.x, z: p.z, yaw: Math.atan2(-p.tz, p.tx) }; };
    const ysp = (lat: number) => Math.min(hRel(smid - as, lat), hRel(smid + as, lat)) - 2.5;
    for (let a = -105; a <= 105.1; a += 15) {
      let topY = deckBottom + 0.05;
      for (const lat of [-ribLat, ribLat]) {
        const { p, x, z, yaw } = bk(a, lat), ys = ysp(lat), yc = deckBottom - ribT;
        const base = Math.abs(a) < as ? ys + (yc - ys) * (1 - (a / as) * (a / as)) + ribT * 0.8 : hRel(smid + a, lat) - 1.2;
        if (topY - base > 1.2) colM.push(M(x, base, z, yaw, 1.3, topY - base, 1.3));
        void p;
      }
      if (Math.abs(a) > 5) { const { x, z, yaw } = bk(a, 0); colM.push(M(x, deckBottom - 0.75, z, yaw, 1.0, 0.75, ribLat * 2 + 1.4)); }
    }
    for (const s of [br.from + 5, br.to - 5]) {
      const p = pathAt(s); const base = Math.min(hRel(s, -deckW), hRel(s, deckW), hRel(s, 0)) - 4, yaw = Math.atan2(-p.tz, p.tx);
      colM.push(M(p.x, base, p.z, yaw, 10, p.y + deckBot - base, deckW * 2));
    }
    place(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), concrete, colM);

    // ---------- start and finish gantries ----------
    const banner = (text: string, sub: string, chequer: boolean) => {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 160; const g = c.getContext('2d')!;
      g.fillStyle = chequer ? '#f4f4f4' : '#101a2a'; g.fillRect(0, 0, 1024, 160);
      if (chequer) { for (let i = 0; i < 64; i++) for (let j = 0; j < 10; j++) if ((i + j) % 2) { g.fillStyle = '#111'; g.fillRect(i * 16, j * 16, 16, 16); } g.fillStyle = '#d6101e'; g.fillRect(212, 28, 600, 104); }
      else { g.fillStyle = '#e8b21a'; g.fillRect(0, 0, 1024, 12); g.fillRect(0, 148, 1024, 12); }
      g.fillStyle = '#fff'; g.font = 'bold 74px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 512, chequer ? 80 : 66);
      if (!chequer) { g.font = '600 32px sans-serif'; g.fillStyle = '#e8b21a'; g.fillText(sub, 512, 124); }
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
      return new THREE.MeshStandardNodeMaterial({ map: tx, roughness: 0.6, side: THREE.DoubleSide });
    };
    const steel = std(0x9aa0a6, 0.4, 0.8);
    const gantry = (s: number, mat: THREE.Material) => {
      const p = pathAt(s), yaw = Math.atan2(-p.tz, p.tx), span = lim + 1.6, H = 7.2;
      const post = new THREE.CylinderGeometry(0.28, 0.34, H, 10).translate(0, H / 2, 0), beam = new THREE.BoxGeometry(0.5, 0.5, span * 2 + 0.6).translate(0, H - 0.25, 0);
      const mats: THREE.Matrix4[] = [];
      for (const side of [-1, 1]) { const l = side * span; mats.push(M(p.x - p.tz * l, p.y + side * lim * p.bank - 0.3, p.z + p.tx * l, 0, 1)); }
      place(post, steel, mats); const bm = new THREE.Mesh(beam, steel); bm.position.set(p.x, p.y, p.z); bm.rotation.y = yaw; bm.castShadow = true; group.add(bm);
      // the banner hangs under the beam and faces the traffic coming towards it
      const bw = span * 2 - 0.4, ban = new THREE.Mesh(new THREE.PlaneGeometry(bw, bw * 160 / 1024), mat);
      ban.position.set(p.x, p.y + H - 0.5 - (bw * 160 / 1024) / 2, p.z); ban.rotation.y = Math.atan2(-p.tx, -p.tz); ban.castShadow = true; group.add(ban);
    };
    gantry(98, banner('PACIFIC COAST', 'LARGADA', false)); gantry(finishS, banner('CHEGADA', '', true));

    // ---------- lighthouse ----------
    {
      const gy = W.heightAt(lhx, lhz) - 1, white = std(0xf1efe8, 0.6), red = std(0xb31d1d, 0.6), dark = std(0x23262b, 0.5, 0.6);
      const lamp = new THREE.MeshStandardNodeMaterial({ color: 0x222222 }); lamp.emissiveNode = vec3(1, 0.85, 0.5).mul(pulse.mul(2).add(sin(time.mul(1.4)).mul(2).add(5)));
      const lh = new THREE.Group(); lh.position.set(lhx, gy, lhz);
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; m.receiveShadow = true; lh.add(m); };
      add(new THREE.CylinderGeometry(7.2, 8.4, 2.2, 20), std(0xa7a49b, 0.9), 1.1);
      add(new THREE.CylinderGeometry(2.6, 3.9, 9, 20), white, 6.7); add(new THREE.CylinderGeometry(2.62, 2.7, 1.8, 20), red, 12.2); add(new THREE.CylinderGeometry(2.3, 2.62, 7.5, 20), white, 16.9);
      add(new THREE.CylinderGeometry(2.55, 2.3, 0.7, 20), red, 21); add(new THREE.CylinderGeometry(3.6, 3.6, 0.35, 24), dark, 21.45);
      add(new THREE.CylinderGeometry(1.5, 1.5, 2.6, 16), lamp, 22.9); add(new THREE.CylinderGeometry(1.7, 1.7, 0.2, 16), dark, 24.3);
      add(new THREE.ConeGeometry(1.9, 1.7, 16), red, 25.2); add(new THREE.SphereGeometry(0.28, 8, 6), dark, 26.2);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * 6.283, post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 5), dark); post.position.set(Math.cos(a) * 1.6, 23, Math.sin(a) * 1.6); lh.add(post); }
      const house = new THREE.Mesh(new THREE.BoxGeometry(9, 4.2, 6), white); house.position.set(10, 2.1, 3); house.castShadow = true; house.receiveShadow = true; lh.add(house);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(5.8, 2.4, 4), red); roof.position.set(10, 5.4, 3); roof.rotation.y = Math.PI / 4; roof.castShadow = true; lh.add(roof);
      group.add(lh);
    }
  }

  const def: WorldDef = {
    id: 'coast', x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, cell: 7, natural,
    sunDir: [-0.78, 0.2, 0.55], sunColor: 0xffcf98, fog: [0.62, 0.67, 0.74], fogNear: 500, fogFar: 8500, seaColor: [0.012, 0.085, 0.12],
    seaSize: 26000, seaCenter: [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2], terrainMaterial, roadMaterial, barrier: 'rail', bridge: br, cutBlend: 24, cutEdge: 3, props,
  };
  return new World(eng, track, def);
}
