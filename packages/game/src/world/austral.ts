import * as THREE from 'three/webgpu';
import { texture, uv, mix, vec2, vec3, float, positionWorld, normalWorld, smoothstep, abs, normalMap, mx_noise_float, triplanarTexture, attribute, sin, cos, time, max, step, fract, floor, vec4, positionLocal, positionGeometry, length, uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AUSTRAL_BRIDGE, FINISH_BEFORE_END, pointAt, type Track } from '../../../sim/src/index';
import type { Engine } from '../gfx/engine';
import { weatherGround, wetRoad, wetU, snowU, windU } from './weather';
import { World, fbm, hash, M, set, sstep, std, vnoise, type WaterDef, type WorldDef } from './base';
import { routeBounds, roadField, gantry, banner, peaks, deckBridge, scatter, sweep, pathAt } from './route';

/**
 * Carretera Austral (Chile): deep green coigue / lenga rainforest on grey basalt, a turquoise lake and glacial river under two timber-truss bridges,
 * giant nalca leaves and ferns, the Cuesta Queulat climb and a basalt cliff with a hanging glacier and a waterfall facing the viewpoint straight.
 * Everything is placed in arc-length / lateral coordinates, so the layout follows the route.
 */

const LAKE = 19; // lake surface (m)
const WIND: [number, number] = [4, 2];
// timber-truss bridges: river centre line crosses the road at the bridge middle, flowing towards -u (left) for 1 and +u (right) for 2
const bridgeFrames = (t: Track) => AUSTRAL_BRIDGE.map((br, k) => {
  const s = (br.from + br.to) / 2, [x, y, z, yaw] = pointAt(t, s, 0);
  return { k, s, x, z, tx: Math.cos(yaw), tz: Math.sin(yaw), surf: y - 5.6, br };
});

/** Geometry reduced to position + normal, non-indexed, so differing primitives can be merged. */
function bare(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}
function withSway(g: THREE.BufferGeometry, top: number) {
  const p = g.attributes.position, a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) a[i] = Math.max(0, Math.min(1, p.getY(i) / top));
  g.setAttribute('sway', new THREE.BufferAttribute(a, 1)); return g;
}
function lump(g: THREE.BufferGeometry, amt: number, seed: number) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (hash(Math.round(x * 31) + seed, Math.round(y * 37 + z * 53)) - 0.5) * amt;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  const f = bare(g); f.computeVertexNormals(); return f;
}
const swayNode = (amp: number) => {
  const g = attribute('sway', 'float'), ph = positionLocal.x.mul(0.045).add(positionLocal.z.mul(0.06));
  const gust = sin(time.mul(1.4).add(ph)).mul(0.5).add(0.65).add(sin(time.mul(0.5).add(ph.mul(0.5))).mul(0.3));
  return positionLocal.add(vec3(windU.x, 0, windU.y).mul(gust.mul(amp).mul(g.mul(g))));
};
const vcol = (rough: number) => { const m = new THREE.MeshStandardNodeMaterial({ roughness: rough }); m.colorNode = attribute('color', 'vec3'); return m; };
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Evergreen coigue / lenga: a tall straight trunk and two or three lumpy crown blobs. `lite` = coarse far version. */
function treeGeo(lite: boolean) {
  const blob = (r: number, d: number, x: number, y: number, z: number, sy: number, seed: number) => { const g = new THREE.IcosahedronGeometry(r, d); g.scale(1, sy, 1); g.translate(x, y, z); return lump(g, 0.4, seed); };
  const crown = lite ? mergeGeometries([blob(3.4, 0, 0, 9, 0, 1.15, 1)])! : mergeGeometries([blob(3.4, 1, 0, 8.6, 0, 1.05, 1), blob(2.5, 1, 1.5, 11.6, 0.6, 0.95, 2)])!;
  const trunk = bare(new THREE.CylinderGeometry(0.18, 0.4, 8, lite ? 4 : 5, 1).translate(0, 4, 0));
  return { crown: withSway(crown, 14), trunk: withSway(trunk, 14) };
}
/** Giant nalca (Gunnera) leaf rosette: six lobed disc leaves on long stalks. */
function nalcaGeo() {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const a = k * 1.047 + hash(k, 1) * 0.5, lean = 0.45 + hash(k, 2) * 0.35, len = 1.1 + hash(k, 3) * 0.7, R = 0.75 + hash(k, 4) * 0.45, ca = Math.cos(a), sa = Math.sin(a);
    const topX = ca * len * lean * 1.1, topZ = sa * len * lean * 1.1, topY = len * (1 - lean * 0.35) + 0.2;
    const pos: number[] = [], idx: number[] = [], N = 9;
    pos.push(topX, topY + 0.05, topZ); // leaf centre, cupped: the rim rises
    for (let i = 0; i < N; i++) { const th = (i / N) * 6.283, lobe = 0.8 + 0.3 * Math.sin(th * 5 + k), rx = Math.cos(th) * R * lobe, rz = Math.sin(th) * R * lobe; pos.push(topX + rx, topY + 0.22 * Math.hypot(rx, rz) / R - 0.05 + (rx * ca + rz * sa) * -0.12, topZ + rz); }
    for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + (i + 1) % N);
    const leaf = new THREE.BufferGeometry(); leaf.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); leaf.setIndex(idx); parts.push(bare(leaf));
    const st = new THREE.CylinderGeometry(0.025, 0.04, Math.hypot(topX, topY, topZ), 3, 1); st.translate(0, st.parameters.height / 2, 0);
    st.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(topX, topY, topZ).normalize())); parts.push(bare(st));
  }
  return withSway(mergeGeometries(parts)!, 1.8);
}
/** Fern: five arching fronds. */
function fernGeo() {
  const pos: number[] = [], nor: number[] = [], sw: number[] = [];
  for (let k = 0; k < 5; k++) {
    const a = k * 1.2566 + hash(k, 6) * 0.4, ca = Math.cos(a), sa = Math.sin(a), px = -sa, pz = ca, L = 0.7 + hash(k, 7) * 0.3, W = 0.16;
    let prev: [number, number, number] = [0, 0.05, 0];
    for (let sg = 1; sg <= 4; sg++) {
      const f = sg / 4, r = L * f, y = 0.05 + Math.sin(f * 1.7) * L * 0.7 - f * f * L * 0.35, w = W * Math.sin(Math.min(1, f * 1.1 + 0.15) * 3.14) + 0.01, cur: [number, number, number] = [ca * r, y, sa * r], pw = prev[0] === 0 && prev[2] === 0 ? 0.03 : W * Math.sin(Math.min(1, (f - 0.25) * 1.1 + 0.15) * 3.14) + 0.01;
      pos.push(prev[0] - px * pw, prev[1], prev[2] - pz * pw, prev[0] + px * pw, prev[1], prev[2] + pz * pw, cur[0] - px * w, cur[1], cur[2] - pz * w, prev[0] + px * pw, prev[1], prev[2] + pz * pw, cur[0] + px * w, cur[1], cur[2] + pz * w, cur[0] - px * w, cur[1], cur[2] - pz * w);
      for (let i = 0; i < 6; i++) { nor.push(0, 1, 0); sw.push(f * 0.8); }
      prev = cur;
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('sway', new THREE.Float32BufferAttribute(sw, 1)); return g;
}

export function makeAustral(eng: Engine, track: Track): World {
  const t = track, b = routeBounds(t, { x0: 650, x1: 420, z0: 400, z1: 350 }), field = roadField(t, b, { endSide: 0 }), lim = t.def.halfWidth + t.def.shoulder, finishS = t.len - FINISH_BEFORE_END;
  const frames = bridgeFrames(t), rd = (n: number) => Math.round(n);
  void rd;

  // coarse arc-length field: which part of the route a place belongs to
  const SC = 16, sw = Math.ceil((b.x1 - b.x0) / SC) + 1, sh = Math.ceil((b.z1 - b.z0) / SC) + 1, sArr = new Float32Array(sw * sh), sD = new Float32Array(sw * sh).fill(1e9);
  {
    const RC = 24;
    for (let i = 0; i < t.n; i += 2) {
      const cx = Math.round((t.px[i] - b.x0) / SC), cz = Math.round((t.pz[i] - b.z0) / SC);
      for (let dz = -RC; dz <= RC; dz++) for (let dx = -RC; dx <= RC; dx++) {
        const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= sw || z >= sh) continue;
        const dd = Math.hypot(b.x0 + x * SC - t.px[i], b.z0 + z * SC - t.pz[i]), k = z * sw + x; if (dd < sD[k]) { sD[k] = dd; sArr[k] = i * t.step; }
      }
    }
    const pull = (k: number, o: number, c: number) => { if (sD[o] + c < sD[k]) { sD[k] = sD[o] + c; sArr[k] = sArr[o]; } };
    for (let z = 0; z < sh; z++) for (let x = 0; x < sw; x++) { const k = z * sw + x; if (x > 0) pull(k, k - 1, SC); if (z > 0) pull(k, k - sw, SC); }
    for (let z = sh - 1; z >= 0; z--) for (let x = sw - 1; x >= 0; x--) { const k = z * sw + x; if (x < sw - 1) pull(k, k + 1, SC); if (z < sh - 1) pull(k, k + sw, SC); }
  }
  const sAt = (x: number, z: number) => {
    const gx = Math.max(0, Math.min(sw - 1.001, (x - b.x0) / SC)), gz = Math.max(0, Math.min(sh - 1.001, (z - b.z0) / SC)), i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * sw + i;
    return (sArr[k] * (1 - fx) + sArr[k + 1] * fx) * (1 - fz) + (sArr[k + sw] * (1 - fx) + sArr[k + sw + 1] * fx) * fz;
  };

  // rivers: perpendicular to the road at each bridge, a gentle meander, surface heights from the deck
  const meander = (u: number, k: number) => 30 * Math.sin(u * 0.012 + k * 2.1), dmeander = (u: number, k: number) => 0.36 * Math.cos(u * 0.012 + k * 2.1);
  const surfAt = (f: (typeof frames)[number], u: number) => f.k === 0 ? f.surf - (f.surf - LAKE - 1) * sstep(-120, -560, u) + Math.max(0, u) * 0.03 : f.surf - u * 0.035;
  /** [distance to the river centre line, surface height, the river] of the nearest river within reach, or null */
  function river(x: number, z: number) {
    let best: [number, number, number] | null = null;
    for (const f of frames) {
      const dx = x - f.x, dz = z - f.z, a = dx * f.tx + dz * f.tz, u = -dx * f.tz + dz * f.tx; if (u < -620 || u > 760) continue;
      const cd = Math.abs(a - meander(u, f.k)) / Math.sqrt(1 + dmeander(u, f.k) ** 2);
      if (cd < 150 && (!best || cd < best[0])) best = [cd, surfAt(f, u), f.k];
    }
    return best;
  }
  const lakeRect = (() => {
    let x1 = -1e9, z0 = 1e9; for (let i = 0; i < t.n; i++) if (i * t.step < 1700) { x1 = Math.max(x1, t.px[i]); z0 = Math.min(z0, t.pz[i]); }
    return { x0: b.x0 + 5, x1: x1 + 60, z0: z0 - 400, z1: b.z1 - 5 };
  })();

  // the viewpoint cliff: frame at the middle of the straight facing the glacier (left of travel)
  const VS = 5840, VP = pathAt(t, VS), vN = { x: -VP.tz, z: VP.tx }; // vN = right-hand normal
  const along = (x: number, z: number) => (x - VP.x) * VP.tx + (z - VP.z) * VP.tz, lat = (x: number, z: number) => (x - VP.x) * vN.x + (z - VP.z) * vN.z;
  const vxz = (a: number, u: number): [number, number] => [VP.x + a * VP.tx + u * vN.x, VP.z + a * VP.tz + u * vN.z];
  const FALL_A = 70;

  function cliff(x: number, z: number) {
    const a = along(x, z), u = lat(x, z), L = -u; if (L < 250) return 0;
    const wA = 1 - sstep(300, 680, Math.abs(a - 20)), nz = 0.85 + 0.3 * fbm(x / 60, z / 60);
    // lower cliff band 290..380, a bench, then the upper basalt slope with the ice
    return wA * nz * (150 * sstep(290, 385, L) + 18 * sstep(385, 450, L) + 430 * sstep(440, 760, L)) + 90 * sstep(700, 1100, L) * (1 - sstep(500, 1000, Math.abs(a)));
  }

  function natural(x: number, z: number) {
    const [d, ry, side] = field(x, z), n1 = fbm(x / 310 + 5, z / 310), s = sAt(x, z);
    let h = ry - 0.9 + (d - 8) * 0.03 + sstep(6, 130, d) * (14 + 40 * n1) + sstep(90, 450, d) * (60 + 150 * fbm(x / 380 + 9, z / 380 + 4)) + sstep(420, 1000, d) * (140 + 120 * fbm(x / 520 + 2, z / 520 + 8))
      + (fbm(x / 45 + 2, z / 45) - 0.45) * 5 * sstep(12, 70, d) + (fbm(x / 16, z / 16) - 0.45) * 1.3 * sstep(10, 50, d);
    h = Math.max(h, ry - 3);
    // the turquoise lake on the left of the first kilometre and a half
    const e0 = lim + 7, e1 = e0 + Math.max(10, ry - LAKE + 4) * 2.6, lw = sstep(-0.3, -0.7, side) * sstep(e0, e1, d) * (1 - sstep(1180, 1480, s)) * (1 - sstep(380, 640, d));
    if (lw > 0) { const fl = LAKE - 6 + (fbm(x / 40, z / 40) - 0.5) * 3; h = h + (fl - h) * lw; }
    // river valleys under the bridges: flat bed, a bank, then a wide shallow valley that stays below the deck
    const r = river(x, z);
    if (r) { const [cd, rs] = r; const carve = rs - 1.4 + 2.0 * sstep(10, 22, cd) + 0.035 * Math.max(0, cd - 22) + 0.5 * Math.max(0, cd - 110); h = Math.min(h, carve); }
    h += cliff(x, z);
    const e = Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z), w = 1 - sstep(0, 240, e); if (w > 0) h += (128 + (fbm(x / 120, z / 120) - 0.5) * 30 - h) * w;
    return h;
  }

  function terrainMaterial() {
    const forest = set('forrest_ground_01'), rock = set('rock_face_03'), aer = set('aerial_rocks_02'), peb = set('coast_sand_rocks_02');
    const m = new THREE.MeshStandardNodeMaterial(), p = positionWorld.xz, y = positionWorld.y, ny = normalWorld.y;
    const lay = (s: ReturnType<typeof set>, a: number, c: number) => mix(texture(s.map, p.div(a)).rgb, texture(s.map, p.div(c)).rgb, 0.5);
    const moss = mix(vec3(0.17, 0.42, 0.14), vec3(0.26, 0.52, 0.16), smoothstep(-0.2, 0.5, mx_noise_float(p.div(23).add(vec2(2, 5))))), floorC = lay(forest, 6, 37).mul(moss).mul(0.95);
    const alp = smoothstep(150, 205, y.add(mx_noise_float(p.div(80)).mul(30))), basalt = triplanarTexture(texture(rock.map), null, null, float(1 / 12)).rgb.mul(vec3(0.42, 0.45, 0.46)), scree = lay(aer, 8, 53).mul(vec3(0.62, 0.64, 0.62));
    const rockW = smoothstep(0.86, 0.62, ny), shore = float(1).sub(smoothstep(LAKE + 1.5, mx_noise_float(p.div(9)).mul(2).add(LAKE + 5), y));
    const fine = mx_noise_float(p.div(6)).mul(0.5).add(0.5);
    let col = mix(floorC, scree.mul(mix(vec3(0.85), vec3(0.7, 0.85, 0.55), fine.mul(0.5))), alp.mul(0.85));
    col = mix(col, basalt, rockW);
    col = mix(col, texture(peb.map, p.div(5)).rgb.mul(vec3(0.34, 0.36, 0.36)), shore);
    const streak = smoothstep(0.35, 0.8, mx_noise_float(vec3(p.x.mul(0.6), y.mul(0.05), p.y.mul(0.6)))).mul(rockW).mul(0.45); col = col.mul(float(1).sub(streak));
    const wg = weatherGround(col.mul(mx_noise_float(p.div(200)).mul(0.12).add(0.95)), mix(texture(forest.rough, p.div(6)).r.max(0.6), texture(rock.rough, p.div(12)).r, rockW), ny);
    m.colorNode = wg.color; m.roughnessNode = wg.rough;
    m.normalNode = normalMap(mix(mix(texture(forest.nor, p.div(6)), texture(aer.nor, p.div(8)), alp.mul(0.8)), texture(rock.nor, p.div(12)), rockW));
    return m;
  }

  /** Asphalt with a gravel (ripio) look: worn tyre tracks, gravel showing through, dusty beige verges. */
  function roadMaterial(w: World) {
    const hw = w.track.def.halfWidth, asph = set('asphalt_04'), grav = set('gravel_ground_01'), forest = set('forrest_ground_01');
    const m = new THREE.MeshStandardNodeMaterial(), l = uv().x, s = uv().y, al = abs(l), auv = vec2(l, s).div(7), guv = vec2(l, s).div(2.6);
    const onRoad = float(1).sub(smoothstep(hw - 0.02, hw + 0.02, al));
    const worn = smoothstep(4.6, 1.0, abs(l.add(sin(s.mul(0.019)).mul(0.9)))).mul(0.2), patch = smoothstep(-0.1, 0.45, mx_noise_float(vec3(l.mul(0.35), s.mul(0.045), 2.2)));
    const edge = smoothstep(0.1, 0.07, abs(al.sub(hw - 0.4))).mul(mx_noise_float(vec3(l, s.mul(0.4), 3)).mul(0.5).add(0.62).min(1)), yel = smoothstep(0.075, 0.055, abs(al.sub(0.2))).mul(step(0.5, fract(s.div(9))));
    const chq = (s0: number, d: number) => step(s0, s).mul(step(s, d + s0)).mul(step(0.5, fract(floor(s.sub(s0).div(0.7)).add(floor(l.div(0.7))).mul(0.5))));
    const white = max(max(edge, step(abs(s.sub(98)), 0.22)), chq(finishS, 2.1)).mul(onRoad).mul(0.9);
    const gtex = texture(grav.map, guv).rgb.mul(vec3(1.05, 0.98, 0.88)), atex = texture(asph.map, auv).rgb.mul(vec3(0.82, 0.8, 0.76));
    const ripio = patch.mul(0.6).add(float(1).sub(worn).mul(0.0));
    const base = mix(atex, gtex.mul(0.95), ripio.mul(float(1).sub(worn.mul(1.8).min(1))).min(0.75)).mul(float(1).sub(worn.mul(0.9)));
    const shoulder = smoothstep(hw + 0.1, hw + 0.3, al).mul(float(1).sub(smoothstep(lim + 0.8, lim + 2.2, al)));
    const dust = gtex.mul(vec3(0.95, 0.88, 0.78)), verge = texture(forest.map, vec2(l, s).div(5)).rgb.mul(vec3(0.7, 1.1, 0.5));
    const gv = weatherGround(mix(verge, dust, shoulder.mul(0.9)), mix(float(0.95), texture(grav.rough, guv).r, shoulder), float(1), float(1).sub(onRoad));
    const rough0 = mix(texture(asph.rough, auv).r, texture(grav.rough, guv).r, ripio.min(0.6)).mul(0.8).sub(worn.mul(0.4));
    const wr = wetRoad(mix(base, vec3(0.86), white), rough0, onRoad, max(white, yel), l, s);
    m.colorNode = mix(gv.color, mix(wr.color, vec3(0.88, 0.68, 0.1), yel.mul(onRoad)), onRoad); m.roughnessNode = mix(gv.rough, wr.rough, onRoad);
    m.normalNode = normalMap(mix(mix(texture(grav.nor, guv), texture(asph.nor, auv), onRoad.mul(float(1).sub(ripio.min(0.6)))), vec4(0.5, 0.5, 1, 1), wr.flat));
    return m;
  }

  function props(W: World) {
    const q = W.eng.quality, group = W.group, place = W.place.bind(W);
    const frame = (s: number, l = 0) => { const p = pathAt(t, s, l); return { ...p, yaw: Math.atan2(-p.tz, p.tx) }; };
    const gh = (x: number, z: number) => W.heightAt(x, z);
    const cx0 = (b.x0 + b.x1) / 2, cz0 = (b.z0 + b.z1) / 2;
    // river distance for keeping props out of the water
    const riverD = (x: number, z: number) => river(x, z)?.[0] ?? 1e9;

    // ---------- far ground ring, so the land never ends in the void ----------
    {
      const O = 60000, y = 128, pos = [b.x0, y, b.z0, b.x1, y, b.z0, b.x1, y, b.z1, b.x0, y, b.z1, cx0 - O, y, cz0 - O, cx0 + O, y, cz0 - O, cx0 + O, y, cz0 + O, cx0 - O, y, cz0 + O], idx: number[] = [];
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; idx.push(i, 4 + i, j, j, 4 + i, 4 + j); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(24).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 1, side: THREE.DoubleSide }), p = positionWorld.xz;
      m.colorNode = mix(vec3(0.07, 0.13, 0.06), vec3(0.1, 0.16, 0.09), smoothstep(-0.3, 0.4, mx_noise_float(p.div(700)))).mul(mx_noise_float(p.div(50)).mul(0.1).add(0.95));
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; group.add(mesh);
    }

    // ---------- backdrop: a ring of basalt and snow peaks ----------
    {
      const mount = std(0xffffff, 0.95), ny = normalWorld.y, yy = positionWorld.y, nz = mx_noise_float(positionWorld.xz.div(260));
      const rockc = mix(vec3(0.2, 0.22, 0.23), vec3(0.32, 0.33, 0.33), nz.mul(0.5).add(0.5)), snow = smoothstep(520, 800, yy.add(nz.mul(140))).mul(smoothstep(0.3, 0.7, ny)), low = float(1).sub(smoothstep(150, 520, yy.add(nz.mul(80))));
      const wgm = weatherGround(mix(mix(rockc, vec3(0.06, 0.12, 0.05), low.mul(0.9)), vec3(0.92, 0.95, 1.0), snow), float(0.9), ny); mount.colorNode = wgm.color; mount.roughnessNode = wgm.rough;
      const defs: { x: number; z: number; r: number; h: number; seed: number }[] = [], rx = (b.x1 - b.x0) / 2 + 1500, rz = (b.z1 - b.z0) / 2 + 1500;
      for (let k = 0; k < 18; k++) { const a = (k / 18) * 6.283 + 0.2, jit = hash(k, 3); defs.push({ x: cx0 + Math.cos(a) * rx * (0.9 + 0.25 * jit), z: cz0 + Math.sin(a) * rz * (0.88 + 0.25 * hash(k, 4)), r: 1100 + hash(k, 5) * 400, h: 900 + hash(k, 6) * 700, seed: 10 + k }); }
      peaks(W, defs, mount, 70);
    }

    // ---------- rivers: turquoise ribbons following the carved valleys ----------
    {
      const waterMat = (col: [number, number, number]) => {
        const m = new THREE.MeshStandardNodeMaterial({ metalness: 0 }), p = positionWorld.xz, tt = time.mul(0.7);
        const nx = sin(p.x.mul(0.31).add(p.y.mul(0.2)).add(tt.mul(1.2))).mul(0.06).add(mx_noise_float(vec3(p.mul(0.8), tt)).mul(0.09)), nz = sin(p.y.mul(0.27).sub(p.x.mul(0.1)).add(tt.mul(1.0))).mul(0.06).add(mx_noise_float(vec3(p.mul(0.8).add(31), tt)).mul(0.09));
        m.normalNode = vec3(nx, nz, 1).normalize(); m.colorNode = vec3(...col); m.emissiveNode = vec3(...col).mul(0.22); m.roughnessNode = float(0.08); return m;
      };
      const geos: THREE.BufferGeometry[] = [];
      for (const f of frames) {
        const pos: number[] = [], idx: number[] = [], U0 = f.k === 0 ? -560 : -480, U1 = 520, st = 14; let rows = 0;
        for (let u = U0; u <= U1; u += st, rows++) for (const sd of [-1, 1]) {
          const a = meander(u, f.k), hw = 15 + 3.5 * fbm(u / 40 + f.k * 9, 4) * 2 - 3, wx = f.x + (a + sd * hw) * f.tx - u * f.tz, wz = f.z + (a + sd * hw) * f.tz + u * f.tx;
          pos.push(wx, surfAt(f, u), wz);
        }
        for (let i = 0; i < rows - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); geos.push(g);
      }
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, waterMat([0.08, 0.55, 0.55])); mesh.frustumCulled = false; group.add(mesh);
    }

    // ---------- trees: coigue (dark evergreen) and lenga (lighter), two tiers ----------
    const full = treeGeo(false), lite = treeGeo(true);
    const stat = { trees: 0, lite: 0, cover: 0, dust: 0 };
    {
      const leaf = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 }), liteLeaf = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
      for (const mat of [leaf, liteLeaf]) {
        mat.colorNode = vec3(1).mul(mx_noise_float(positionWorld.mul(1.5)).mul(0.3).add(1.0)).mul(mix(float(0.55), float(1.2), attribute('sway', 'float'))); mat.positionNode = swayNode(0.06);
      }
      const bark = std(0x3d3128, 0.95); bark.positionNode = swayNode(0.05);
      const fm: THREE.Matrix4[] = [], fc: THREE.Color[] = [], lm: THREE.Matrix4[] = [], lc: THREE.Color[] = [];
      const zone = (s: number, h: number) => (0.55 + 0.45 * sstep(1000, 1700, s)) * (1 - sstep(168, 206, h)) * (1 - 0.8 * sstep(5900, 6300, s));
      const treeAt = (x: number, z: number, seed: number, isFull: boolean) => {
        const h = gh(x, z); if (h < LAKE + 3 || riverD(x, z) < 26) return false;
        const sl = Math.abs(gh(x + 4, z) - h) + Math.abs(gh(x, z + 4) - h); if (sl > 8) return false;
        const s = sAt(x, z), dens = zone(s, h) * (0.55 + 0.7 * fbm(x / 80 + 2, z / 80)) * (1 - sstep(300, 560, Math.max(0, -lat(x, z))) * (1 - sstep(330, 1000, Math.abs(along(x, z))) * 0));
        if (hash(seed, 77) > dens * 0.95) return false;
        const sc = (isFull ? 0.7 : 0.85) * (0.75 + hash(seed, 5) * 0.8) * (1 - 0.3 * sstep(120, 200, h)), tall = 0.95 + hash(seed, 6) * 0.5, jit = 0.8 + hash(seed, 4) * 0.4;
        const lenga = hash(seed, 3) > 0.72 ? 1 : 0, c = lenga ? [0.03 * jit, 0.06 * jit, 0.012 * jit] : [0.012 * jit, 0.05 * jit, 0.022 * jit];
        const mtx = M(x, h - 0.3, z, hash(seed, 9) * 6.28, sc, sc * tall, sc), col = new THREE.Color(c[0], c[1], c[2]);
        if (isFull) { fm.push(mtx); fc.push(col); } else { lm.push(mtx); lc.push(col); }
        return true;
      };
      const near = Math.round(1800 * q.detail), far = Math.round(3500 * q.detail);
      scatter(t, b, lim, { cap: near, farCap: near, stride: 1, per: 5, gap: 4, mean: 22, accept: (x, z, k) => W.roadDist(x, z) < 75 && W.roadDist(x, z) > lim + 3.5 && treeAt(x, z, k, true) });
      scatter(t, b, lim, { cap: far, farCap: far, stride: 2, per: 6, gap: 70, mean: 120, tries: Math.round(60000 * q.detail), accept: (x, z, k) => W.roadDist(x, z) > 72 && treeAt(x, z, k + 5000, false) });
      if (fm.length) { place(full.crown, leaf, fm, fc); place(full.trunk, bark, fm); }
      if (lm.length) { place(lite.crown, liteLeaf, lm, lc, false); place(lite.trunk, bark, lm, undefined, false); }
      stat.trees = fm.length; stat.lite = lm.length;
    }

    // ---------- ground cover: giant nalca leaves and ferns ----------
    {
      const nm: THREE.Matrix4[] = [], nc: THREE.Color[] = [], fm: THREE.Matrix4[] = [], fc: THREE.Color[] = [];
      const wet = (x: number, z: number) => { const s = sAt(x, z); return 0.5 + 0.5 * sstep(900, 1700, s) - 0.5 * sstep(5100, 5800, s); };
      const nCap = Math.round(2200 * q.detail), fCap = Math.round(3800 * q.detail);
      scatter(t, b, lim, { cap: nCap, farCap: nCap, stride: 1, per: 3, gap: 1.2, mean: 11, accept: (x, z, k) => {
        const h = gh(x, z); if (h < LAKE + 1.5 || W.roadDist(x, z) < lim + 0.9 || h > 190) return false;
        const rv = riverD(x, z), dr = rv < 30 ? 0.9 : 0; // nalca loves the river banks
        if (rv < 17 || hash(k, 21) > (0.3 + 0.35 * wet(x, z) + dr) * (0.5 + fbm(x / 30, z / 30))) return false;
        if (Math.abs(gh(x + 3, z) - h) + Math.abs(gh(x, z + 3) - h) > 7) return false;
        const sc = 0.65 + hash(k, 22) * 1.0; nm.push(M(x, h - 0.1, z, hash(k, 23) * 6.28, sc, sc * (0.8 + hash(k, 24) * 0.4), sc));
        nc.push(new THREE.Color().setHSL(0.27 + hash(k, 25) * 0.05, 0.55, 0.07 + hash(k, 26) * 0.07)); return true;
      } });
      scatter(t, b, lim, { cap: fCap, farCap: fCap, stride: 1, per: 4, gap: 1, mean: 14, accept: (x, z, k) => {
        const h = gh(x, z); if (h < LAKE + 1.5 || W.roadDist(x, z) < lim + 0.7 || h > 200 || riverD(x, z) < 17) return false;
        if (hash(k, 31) > (0.35 + 0.35 * wet(x, z)) * (0.4 + fbm(x / 25 + 4, z / 25))) return false;
        const sc = 0.7 + hash(k, 32) * 1.0; fm.push(M(x, h - 0.05, z, hash(k, 33) * 6.28, sc, sc * (0.8 + hash(k, 34) * 0.5), sc));
        fc.push(new THREE.Color().setHSL(0.25 + hash(k, 35) * 0.06, 0.55, 0.06 + hash(k, 36) * 0.07)); return true;
      } });
      const lm = new THREE.MeshStandardNodeMaterial({ roughness: 0.65, side: THREE.DoubleSide }); lm.positionNode = swayNode(0.1);
      lm.colorNode = vec3(1).mul(mix(float(0.6), float(1.2), attribute('sway', 'float'))).mul(mx_noise_float(positionWorld.mul(2.1)).mul(0.25).add(1));
      const fmat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, side: THREE.DoubleSide }); fmat.positionNode = swayNode(0.12); fmat.colorNode = vec3(1).mul(mix(float(0.7), float(1.25), attribute('sway', 'float')));
      if (nm.length) place(nalcaGeo(), lm, nm, nc, false); if (fm.length) place(fernGeo(), fmat, fm, fc, false);
      stat.cover = nm.length + fm.length;
    }

    // ---------- basalt boulders and column clusters beside the climb ----------
    {
      const bg = lump(new THREE.IcosahedronGeometry(1, 1), 0.55, 4), bm: THREE.Matrix4[] = [], bc: THREE.Color[] = [], bcap = Math.round(450 * q.detail);
      scatter(t, b, lim, { cap: bcap, farCap: bcap, stride: 2, per: 2, gap: 2.5, mean: 24, accept: (x, z, k) => {
        const h = gh(x, z), s = sAt(x, z); if (hash(k, 41) > 0.1 + 0.4 * sstep(3600, 5000, s) || W.roadDist(x, z) < lim + 2.5 || h < LAKE + 2 || riverD(x, z) < 15) return false;
        const sc = 0.5 + Math.pow(hash(k, 42), 2.2) * 2.8; bm.push(M(x, h + sc * 0.1, z, hash(k, 43) * 6.28, sc * 1.3, sc * 0.85, sc)); const g = 0.07 + hash(k, 44) * 0.07; bc.push(new THREE.Color(g * 0.95, g, g * 1.0)); return true;
      } });
      if (bm.length) place(bg, std(0xffffff, 0.9), bm, bc);
      const col = bare(new THREE.CylinderGeometry(0.5, 0.56, 1, 6, 1).translate(0, 0.5, 0)), cm: THREE.Matrix4[] = [], cc: THREE.Color[] = [];
      for (let k = 0, s0 = 4300; s0 < 5800 && k < 40; s0 += 38, k++) {
        const side = hash(k, 51) > 0.5 ? 1 : -1, c = pathAt(t, s0, side * (lim + 5 + hash(k, 52) * 6)), n = 5 + Math.floor(hash(k, 53) * 5);
        for (let i = 0; i < n; i++) { const x = c.x + (hash(k * 9 + i, 54) - 0.5) * 7, z = c.z + (hash(k * 9 + i, 55) - 0.5) * 7, h = gh(x, z), hh = 1.6 + hash(k * 9 + i, 56) * 3.4; if (W.roadDist(x, z) < lim + 2.2) continue; cm.push(M(x, h - 0.4, z, hash(k * 9 + i, 57), 0.7 + hash(k, i) * 0.4, hh, 0.7 + hash(k, i) * 0.4)); const g = 0.1 + hash(i, k) * 0.08; cc.push(new THREE.Color(g, g * 1.02, g * 1.05)); }
      }
      if (cm.length) place(col, std(0xffffff, 0.8), cm, cc);
    }

    // ---------- timber-truss bridges ----------
    {
      const wood = std(0x5c4630, 0.92); wood.colorNode = vec3(0.2, 0.14, 0.09).mul(mx_noise_float(positionWorld.mul(vec3(0.7, 7, 0.7))).mul(0.4).add(0.85));
      const beam = (a: THREE.Vector3, c: THREE.Vector3, w: number, h: number, geos: THREE.BufferGeometry[]) => {
        const d = c.clone().sub(a), len = d.length(), g = new THREE.BoxGeometry(w, h, len);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize())); const mid = a.clone().add(c).multiplyScalar(0.5); g.translate(mid.x, mid.y, mid.z); geos.push(bare(g));
      };
      for (const f of frames) {
        const br = f.br, deck = deckBridge(W, br, { deckBot: -1.1 }), path = deck.path, geos: THREE.BufferGeometry[] = [deck.geos[0]];
        const P = (s: number, l: number, dy: number) => { const p = pathAt(t, s, l); return new THREE.Vector3(p.x, p.y + dy, p.z); };
        const sd = lim + 0.4, H = 4.3, panel = 5, nP = Math.round((br.to - br.from) / panel), step = (br.to - br.from) / nP;
        for (const side of [-1, 1]) {
          const l = side * sd;
          for (let i = 0; i <= nP; i++) { const s = br.from + i * step; beam(P(s, l, -0.9), P(s, l, H), 0.34, 0.3, geos); if (i < nP) { const s2 = s + step; beam(P(s, l, -0.7), P(s2, l, H - 0.2), 0.2, 0.22, geos); } }
          for (let i = 0; i < nP; i++) { const s = br.from + i * step; beam(P(s, l, H), P(s + step, l, H), 0.42, 0.34, geos); beam(P(s, l, 0.05), P(s + step, l, 0.05), 0.3, 0.3, geos); beam(P(s, l, 1.0), P(s + step, l, 1.0), 0.14, 0.2, geos); }
        }
        for (let i = 0; i <= nP; i += 2) { const s = br.from + i * step; beam(P(s, -sd, H + 0.15), P(s, sd, H + 0.15), 0.28, 0.28, geos); }
        for (let s = br.from + 7; s < br.to; s += 14) {
          const p = pathAt(t, s), yw = Math.atan2(-p.tz, p.tx), top = p.y - 1.1;
          const cap = new THREE.BoxGeometry(0.7, 0.6, (lim + 0.5) * 2); cap.rotateY(yw); cap.translate(p.x, top - 0.3, p.z); geos.push(bare(cap));
          for (const sdl of [-1, -0.34, 0.34, 1]) { const q2 = pathAt(t, s, sdl * (lim - 0.4)), g0 = Math.min(gh(q2.x, q2.z), f.surf) - 0.8, hgt = top - g0; if (hgt < 0.3) continue; const g = new THREE.BoxGeometry(0.55, hgt, 0.55); g.rotateY(yw); g.translate(q2.x, g0 + hgt / 2, q2.z); geos.push(bare(g)); }
        }
        void path;
        const mesh = new THREE.Mesh(mergeGeometries(geos.map(bare))!, wood); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh);
      }
    }

    // ---------- the cliff: hanging glacier, waterfalls, and the mirador ----------
    {
      // glacier tongue draped over the upper slope; its toe hangs over the bench, the waterfall starts there
      const NB = 30, NA = 20, pos: number[] = [], col: number[] = [], idx: number[] = [], uA = 20;
      for (let j = 0; j <= NB; j++) for (let i = 0; i <= NA; i++) {
        const v = j / NB, uu = (i / NA) * 2 - 1, Lc = 455 + 300 * v, hw = (70 + 190 * sstep(0, 0.7, v)) * (0.85 + 0.3 * fbm(v * 6, 3));
        const [x, z] = vxz(uA + uu * hw, -Lc), edge = Math.abs(uu) > 0.96 ? 1 : 0, cr = Math.pow(1 - Math.abs(2 * vnoise(x / 12 + 4, z / 30) - 1), 6), deb = sstep(0.6, 1, Math.abs(uu)) * 0.55 + (fbm(x / 9, z / 9) > 0.64 ? 0.3 : 0);
        pos.push(x, gh(x, z) + 3.2 + (fbm(x / 20, z / 20) - 0.45) * 4 - edge * 3 - (j === 0 ? 4 : 0), z);
        const w = [0.82, 0.88, 0.94], bl = [0.3, 0.55, 0.78], gr = [0.14, 0.14, 0.14];
        for (let c = 0; c < 3; c++) col.push((w[c] + (bl[c] - w[c]) * cr * 0.9) * (1 - deb) + gr[c] * deb);
      }
      for (let j = 0; j < NB; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, c = a + NA + 1; idx.push(a, c, a + 1, a + 1, c, c + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
      const gl = new THREE.Mesh(g, vcol(0.35)); gl.receiveShadow = true; gl.frustumCulled = false; group.add(gl);

      // waterfall ribbons following the fall line from the bench edge to the valley floor
      const fall = (a0: number, hwid: number, L0: number, L1: number) => {
        const N = 40, pp: number[] = [], uvs: number[] = [], ii: number[] = [];
        for (let j = 0; j <= N; j++) for (let i = 0; i <= 1; i++) {
          const Lc = L0 + (L1 - L0) * (j / N), [x, z] = vxz(a0 + (i - 0.5) * hwid * (1 + 0.5 * (j / N)), -Lc); pp.push(x, gh(x, z) + 1.0, z); uvs.push(i, j / N);
        }
        for (let j = 0; j < N; j++) { const a = j * 2; ii.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); fg.setIndex(ii); fg.computeVertexNormals(); return fg;
      };
      const fm = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, transparent: true, depthWrite: false, side: THREE.DoubleSide }), fu = uv();
      const streak = mx_noise_float(vec3(fu.x.mul(7), fu.y.mul(9).sub(time.mul(2.6)), 1.3)).mul(0.5).add(0.5), cdw = vec3(0.9, 0.96, 1.0);
      fm.colorNode = mix(vec3(0.55, 0.78, 0.9), cdw, streak); fm.emissiveNode = mix(vec3(0.1, 0.18, 0.22), vec3(0.3, 0.34, 0.36), streak);
      fm.opacityNode = smoothstep(0.0, 0.22, fu.x).mul(smoothstep(1.0, 0.78, fu.x)).mul(smoothstep(0.0, 0.04, fu.y)).mul(0.9);
      const fgeo = [fall(FALL_A, 9, 300, 392), fall(-170, 5, 300, 380), fall(260, 6, 300, 385)];
      const fmesh = new THREE.Mesh(mergeGeometries(fgeo)!, fm); fmesh.frustumCulled = false; fmesh.renderOrder = 2; group.add(fmesh);
    }

    // ---------- dust: slow hazy sprites drifting off the verge in dry weather (<= 250) ----------
    {
      const n = Math.min(250, Math.round(250 * q.detail)), A = new Float32Array(n * 4), B = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const s = 60 + (i / n) * (t.len - 120) + (hash(i, 61) - 0.5) * 20, side = hash(i, 62) > 0.5 ? 1 : -1, p = pathAt(t, s, side * (lim + 0.6 + hash(i, 63) * 4));
        A[i * 4] = p.x; A[i * 4 + 1] = p.y + 0.4 + hash(i, 64) * 1.2; A[i * 4 + 2] = p.z; A[i * 4 + 3] = hash(i, 65);
        B[i * 4] = 3 + hash(i, 66) * 4; B[i * 4 + 3] = 0.55 + hash(i, 67) * 0.45; // size, phase offset
      }
      const geo = new THREE.InstancedBufferGeometry(); geo.copy(new THREE.PlaneGeometry(1, 1) as any); geo.instanceCount = n;
      geo.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4)); geo.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 4));
      const ia = attribute('iA', 'vec4'), ib = attribute('iB', 'vec4'), ph = fract(time.mul(0.045).mul(ib.w).add(ia.w)), right = { u: uniform(new THREE.Vector3(1, 0, 0)) }, up = { u: uniform(new THREE.Vector3(0, 1, 0)) };
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      m.positionNode = ia.xyz.add(vec3(windU.x, 0.12, windU.y).mul(ph.mul(26))).add(right.u.mul(positionGeometry.x.mul(ib.x.mul(ph.mul(1.2).add(0.7))))).add(up.u.mul(positionGeometry.y.mul(ib.x.mul(ph.mul(1.2).add(0.7)))));
      m.colorNode = vec3(0.6, 0.54, 0.45);
      m.opacityNode = smoothstep(0.5, 0.0, length(positionGeometry.xy)).mul(sin(ph.mul(3.1416))).mul(0.2).mul(float(1).sub(wetU.mul(2).min(1))).mul(float(1).sub(snowU));
      const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false; mesh.renderOrder = 8; group.add(mesh); stat.dust = n;
      const cam = W.eng.camera, mat = new THREE.Matrix4(), baseUpdate = W.update.bind(W);
      W.update = (focus: THREE.Vector3) => { baseUpdate(focus); mat.copy(cam.matrixWorld); right.u.value.setFromMatrixColumn(mat, 0); up.u.value.setFromMatrixColumn(mat, 1); };
    }

    // ---------- signs, mirador, gantries ----------
    const bag: Record<string, THREE.BufferGeometry[]> = { wood: [], plank: [] };
    const addG = (key: string, g: THREE.BufferGeometry, m: THREE.Matrix4) => { const c = bare(g); c.applyMatrix4(m); bag[key].push(c); };
    const BOX = new THREE.BoxGeometry(1, 1, 1), anchor = (x: number, y: number, z: number, yaw: number) => M(x, y, z, yaw, 1);
    const box = (key: string, A: THREE.Matrix4, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, ry = 0) => addG(key, BOX, A.clone().multiply(M(lx, ly, lz, ry, sx, sy, sz)));
    {
      const f0 = frame(VS - 60, -(lim + 11.5)), A = anchor(f0.x, f0.y - 0.15, f0.z, f0.yaw);
      box('plank', A, 0, 0, 0, 26, 0.28, 11);
      for (let ix = -12; ix <= 12; ix += 6) for (const iz of [-5, 5]) { const w = new THREE.Vector3(ix, 0, iz).applyMatrix4(A), g0 = gh(w.x, w.z) - 0.6, hgt = f0.y - 0.15 - g0; if (hgt > 0.1) addG('wood', BOX, M(w.x, g0 + hgt / 2, w.z, f0.yaw, 0.35, hgt, 0.35)); }
      for (let ix = -13; ix <= 13; ix += 3) { box('wood', A, ix, 0.65, 5.4, 0.16, 1.3, 0.16); box('wood', A, ix, 0.65, -5.4, 0.16, 1.3, 0.16); }
      box('wood', A, 0, 1.25, 5.4, 26.2, 0.12, 0.12); box('wood', A, 0, 0.75, 5.4, 26.2, 0.08, 0.08); box('wood', A, 0, 1.25, -5.4, 26.2, 0.12, 0.12); box('wood', A, 0, 0.75, -5.4, 26.2, 0.08, 0.08);
      const bp = frame(VS - 160, lim + 3.4), board = new THREE.Mesh(new THREE.PlaneGeometry(5, 5 * 160 / 1024), banner('VENTISQUERO COLGANTE', 'MIRADOR - QUEULAT', false));
      board.position.set(bp.x, Math.max(bp.y, gh(bp.x, bp.z)) + 3.2, bp.z); board.rotation.y = Math.atan2(-bp.tx, -bp.tz); board.castShadow = true; group.add(board);
      for (const o of [-2.1, 2.1]) addG('wood', BOX, M(bp.x - bp.tz * o, gh(bp.x, bp.z) + 1.7, bp.z + bp.tx * o, bp.yaw, 0.14, 3.6, 0.14));
      // kilometre posts
      const posts: THREE.Matrix4[] = [];
      for (let k = 1; k * 500 < t.len - 100; k++) { const p = frame(k * 500, (k % 2 ? 1 : -1) * (lim + 1.6)), gy = gh(p.x, p.z); posts.push(M(p.x, gy - 0.2, p.z, p.yaw, 0.2, 1.1, 0.2).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0))); }
      place(BOX.clone(), std(0xe4e2d6, 0.8), posts);
    }
    gantry(W, 98, banner('CARRETERA AUSTRAL', 'LARGADA', false)); gantry(W, finishS, banner('CHEGADA', '', true));
    const timber = std(0x5a4636, 0.9), plank = std(0x7a5a3e, 0.9); plank.colorNode = vec3(0.5, 0.37, 0.25).mul(mx_noise_float(positionWorld.mul(vec3(0.6, 6, 0.6))).mul(0.35).add(0.88));
    for (const [k, mat] of [['wood', timber], ['plank', plank]] as const) if (bag[k].length) { const mesh = new THREE.Mesh(mergeGeometries(bag[k])!, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh); }

    // ---------- statistics (draw calls and triangles of the whole world) ----------
    let tr = 0, calls = 0;
    group.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; calls++; tr += tris(m.geometry) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1); });
    (W as any).stats = { trees: stat.trees, lite: stat.lite, cover: stat.cover, dust: stat.dust, tris: Math.round(tr), calls };
  }

  const water: WaterDef[] = [{ y: LAKE, ...lakeRect, color: [0.08, 0.55, 0.55], rough: 0.07 }];
  const def: WorldDef = {
    id: 'austral', x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, cell: 10, natural, hdr: 'kloofendal_overcast_puresky_2k.hdr', water,
    sunDir: [-0.3, 0.4, 0.5], sunColor: 0xdfe8ee, fog: [0.55, 0.63, 0.62], fogNear: 220, fogFar: 7500, seaColor: [0.08, 0.55, 0.55], wind: WIND,
    terrainMaterial, roadMaterial, barrier: 'fence', bridge: AUSTRAL_BRIDGE, cutBlend: 26, cutEdge: 3, props,
  };
  return new World(eng, track, def);
}
