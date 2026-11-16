import * as THREE from 'three/webgpu';
import { texture, uv, mix, vec2, vec3, vec4, float, positionWorld, normalWorld, positionLocal, smoothstep, abs, step, fract, floor, max, normalMap, mx_noise_float, transformNormalToView, triplanarTexture, attribute, sin, time, dot, length, uniform, positionGeometry } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FINISH_BEFORE_END, NIAGARA_BRIDGE, NIAGARA_OVERPASS, pointAt, type Track } from '../../../sim/src/index';
import type { Engine } from '../gfx/engine';
import { weatherGround, wetRoad, windU } from './weather';
import { World, fbm, hash, M, set, sstep, std, tex, type WorldDef } from './base';
import { routeBounds, roadField, sweep, pathAt as pathAtT, sRange, banner, gantry, deckBridge, scatter } from './route';

/**
 * Niagara Parkway at dusk: Dufferin Islands pond and a flat deck bridge, the river running to the Horseshoe Falls (mist), Clifton Hill neon and
 * the Skylon, the Rainbow Bridge overhead, a gorge-rim run, an escarpment descent and the Whirlpool basin with its Aero Car.
 * The river is a polyline beside the road (see `riverPath`): terrain, water ribbons and falls are all derived from it.
 */

/** Position + normal only, non-indexed (so differing primitives can be merged). */
function bare(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}
const boxG = (w: number, h: number, d: number, m: THREE.Matrix4) => { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.deleteAttribute('uv'); g.applyMatrix4(m); return g; };
const cylG = (r0: number, r1: number, h: number, seg: number, m: THREE.Matrix4) => { const g = new THREE.CylinderGeometry(r0, r1, h, seg, 1, true).toNonIndexed(); g.deleteAttribute('uv'); g.applyMatrix4(m); return g; };
/** Lumpy blob (crown part), flat shaded, position + normal only. */
function blob(r: number, x: number, y: number, z: number, sy: number, det: number, seed: number) {
  const g = new THREE.IcosahedronGeometry(r, det); g.scale(1, sy, 1); g.translate(x, y, z); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 1 + (hash(Math.round(p.getX(i) * 31) + seed, Math.round(p.getY(i) * 37 + p.getZ(i) * 53)) - 0.5) * 0.45; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
  const f = bare(g); f.computeVertexNormals(); return f;
}
const withSway = (g: THREE.BufferGeometry, top: number) => { const p = g.attributes.position, a = new Float32Array(p.count); for (let i = 0; i < p.count; i++) a[i] = Math.max(0, Math.min(1, p.getY(i) / top)); g.setAttribute('sway', new THREE.BufferAttribute(a, 1)); return g; };

const Y_UP = 174.5, Y_DROP = 46, FALL_S = 1050, RC = 95; // river level above the falls, height of the falls, arc length of the crest, crescent radius

export function makeNiagara(eng: Engine, track: Track): World {
  const t = track, q = eng.quality, lim = t.def.halfWidth + t.def.shoulder, len = t.len, finishS = len - FINISH_BEFORE_END, br = NIAGARA_BRIDGE, ov = NIAGARA_OVERPASS;
  const b = routeBounds(t, { x0: 560, x1: 800, z0: 620, z1: 700 }), field = roadField(t, b, { endSide: 0 });
  const pathAt = (s: number, lat = 0, dy = 0) => pathAtT(t, s, lat, dy);
  const at = (s: number, lat: number) => { const [x, , z] = pointAt(t, s, lat), y = pointAt(t, s, Math.max(-lim, Math.min(lim, lat)))[1]; return { x, y, z }; };

  // ---------------- the river: a smoothed polyline left of the road, then round the hairpins to the Whirlpool ----------------
  const ST = 20, nRaw = Math.floor(4750 / ST);
  const Lat = (s: number) => 210 - 75 * sstep(300, 1000, s) + 75 * sstep(1100, 1700, s) - 15 * sstep(1700, 3000, s) + 200 * sstep(4300, 4750, s);
  const raw: [number, number][] = [];
  for (let i = 0; i <= nRaw; i++) { const p = pointAt(t, i * ST, -Lat(i * ST)); raw.push([p[0], p[2]]); }
  { // extension: away from the hairpins and down to the basin beside the finish
    const way: [number, number][] = [[3470, 260], [3490, 520], [3410, 800], [3330, 1010], [3300, 1160]];
    let [px, pz] = raw[raw.length - 1];
    for (const [wx, wz] of way) { const n = Math.max(1, Math.round(Math.hypot(wx - px, wz - pz) / ST)); for (let k = 1; k <= n; k++) raw.push([px + (wx - px) * k / n, pz + (wz - pz) * k / n]); px = wx; pz = wz; }
  }
  const NR = raw.length, rx = new Float32Array(NR), rz = new Float32Array(NR);
  for (let i = 0; i < NR; i++) { let x = 0, z = 0, n = 0; for (let j = -10; j <= 10; j++) { const k = Math.max(0, Math.min(NR - 1, i + j)); x += raw[k][0]; z += raw[k][1]; n++; } rx[i] = x / n; rz[i] = z / n; }
  rx[0] = raw[0][0]; rz[0] = raw[0][1]; rx[NR - 1] = raw[NR - 1][0]; rz[NR - 1] = raw[NR - 1][1];
  const iF = Math.round(FALL_S / ST), iEnd = NR - 1;
  // river surface height and half width per vertex
  const nearRoadY = (x: number, z: number) => { let d = 1e9, y = 0; for (let k = 0; k < t.n; k += 4) { const dd = (t.px[k] - x) ** 2 + (t.pz[k] - z) ** 2; if (dd < d) { d = dd; y = t.py[k]; } } return y; };
  const ry = new Float32Array(NR), rw = new Float32Array(NR);
  { let prev = Infinity; for (let i = 0; i < NR; i++) {
    if (i <= iF) ry[i] = Y_UP; else { prev = Math.min(prev, nearRoadY(rx[i], rz[i]) - Y_DROP + (i - iF) * 0.0); ry[i] = i === iF + 1 ? prev : Math.min(prev, ry[i - 1] - 0.02); }
    rw[i] = i <= iF ? 62 + 40 * sstep(0, iF, i) : 100 - 55 * sstep(iF + 3, iF + 45, i);
    if (i > iEnd - 14) rw[i] = 45 + 72 * sstep(iEnd - 14, iEnd - 2, i);
  } }
  // bucket grid of the vertices for nearest-segment queries
  const BK = 170, bx0 = Math.min(...rx) - 300, bz0 = Math.min(...rz) - 300, bw = Math.ceil((Math.max(...rx) + 300 - bx0) / BK) + 1, bh = Math.ceil((Math.max(...rz) + 300 - bz0) / BK) + 1;
  const buckets: number[][] = Array.from({ length: bw * bh }, () => []);
  for (let i = 0; i < NR; i++) buckets[Math.floor((rz[i] - bz0) / BK) * bw + Math.floor((rx[i] - bx0) / BK)].push(i);
  /** nearest river point: [distance, fractional vertex index, signed lateral offset (+ right of flow)] */
  const riv = (x: number, z: number): [number, number, number] => {
    const cx = Math.floor((x - bx0) / BK), cz = Math.floor((z - bz0) / BK); let bd = 1e9, bu = 0, bl = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gz = cz + dz; if (gx < 0 || gz < 0 || gx >= bw || gz >= bh) continue;
      for (const i of buckets[gz * bw + gx]) for (const j of [i - 1, i]) {
        if (j < 0 || j >= NR - 1) continue;
        const ax = rx[j], az = rz[j], vx = rx[j + 1] - ax, vz = rz[j + 1] - az, l2 = vx * vx + vz * vz, k = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
        const d = Math.hypot(x - ax - vx * k, z - az - vz * k); if (d < bd) { bd = d; bu = j + k; bl = ((x - ax) * -vz + (z - az) * vx) / Math.sqrt(l2); }
      }
    }
    return [bd, bu, bl];
  };
  const lerpA = (a: Float32Array, u: number) => { const i = Math.min(NR - 2, Math.floor(u)), f = u - i; return a[i] * (1 - f) + a[i + 1] * f; };
  /** falls crest bend: how far downstream the crescent crest sits at lateral offset l (m) */
  const bend = (l: number) => 0.7 * RC * (1 - Math.sqrt(1 - Math.min(0.96, (l / RC) ** 2)));
  const fx0 = rx[iF], fz0 = rz[iF], fdx = rx[iF + 1] - rx[iF - 1], fdz = rz[iF + 1] - rz[iF - 1], fl = Math.hypot(fdx, fdz), fDx = fdx / fl, fDz = fdz / fl; // flow direction at the falls
  const yDn = ry[iF + 1];

  // ---------------- bridge channel, Dufferin pond and islets (local frame at the bridge middle) ----------------
  const [mx, , mz, myaw] = pointAt(t, (br.from + br.to) / 2, 0), Dx = Math.cos(myaw), Dz = Math.sin(myaw);
  const frame = (x: number, z: number) => [(x - mx) * Dx + (z - mz) * Dz, -(x - mx) * Dz + (z - mz) * Dx] as const; // [along road, lateral (+ right)]
  const islets: [number, number, number][] = [[-52, 100, 17], [34, 150, 23], [-18, 210, 15], [64, 76, 12], [-6, 62, 9], [-60, 190, 11]];
  const PB = 270; // the pond ends this far right of the road
  const lakeEdge = (aa: number, bb: number) => (1 - sstep(96, 126, Math.abs(aa))) * (1 - sstep(PB - 20, PB + 24, bb));

  // ---------------- finish: Whirlpool basin with the Aero Car, plus the Skylon / Rainbow Bridge anchors ----------------
  const [e0x, e0y, e0z] = pointAt(t, len - 40, 0);
  void e0y;

  function natural(x: number, z: number) {
    const [d, rry] = field(x, z), hillW = sstep(150, 520, d);
    let P = rry - 0.9 + (fbm(x / 45, z / 45) - 0.45) * 3 * sstep(20, 80, d) + hillW * (fbm(x / 240 + 3, z / 240) - 0.3) * 80 + (fbm(x / 70, z / 70) - 0.4) * 10 * hillW;
    let h = P;
    const [dr, u, lat] = riv(x, z);
    if (dr < 260) {
      let uu = u; if (Math.abs(u - iF) < 8) uu = u - bend(lat) / ST; // the falls are a crescent: the step in the river follows it
      let floor: number, wr: number;
      if (uu <= iF) { floor = Y_UP - 3.2; wr = lerpA(rw, Math.min(u, iF)); } else { const j = Math.max(uu, iF + 1.0001); floor = lerpA(ry, j) - 3.5; wr = lerpA(rw, j); if (uu < iF + 1) wr = rw[iF + 1]; }
      const lim2 = Math.max(P, floor + 12), wall = Math.max(7, (lim2 - floor) * 0.8);
      const e = Math.max(0, dr - wr + (fbm(x / 26 + 9, z / 26 + 4) - 0.5) * 24 * sstep(2, 20, Math.max(0, dr - wr)));
      h = floor + (lim2 - floor) * sstep(0, wall, e) + (h - lim2) * sstep(wall * 0.6, wall * 1.6, e);
      if (uu > iF) h = Math.min(h, lim2 * 0 + h);
    }
    // bridge channel and the pond with its islets
    const [aa, bb] = frame(x, z);
    if (bb > -440 && Math.abs(aa) < 160) {
      const w = lakeEdge(aa, bb), floor = Y_UP - 3.6 + (fbm(x / 20, z / 20) - 0.5) * 0.8;
      if (w > 0 && h > floor) h += (floor - h) * Math.min(1, w * 1.15);
      for (const [ia, ib, ir] of islets) { const dd = Math.hypot(aa - ia, bb - ib); if (dd < ir) h = Math.max(h, Y_UP - 3.6 + 5.4 * (1 - sstep(ir * 0.45, ir, dd)) + (fbm(x / 6, z / 6) - 0.5) * 0.6); }
    }
    return h;
  }

  function terrainMaterial() {
    const m = new THREE.MeshStandardNodeMaterial(), fo = set('forrest_ground_01'), rk = set('rock_face_03'), meadowT = tex('aerial_grass_rock_diffuse.jpg', true), dryT = tex('dry_ground_rocks_diffuse.jpg', true);
    const p = positionWorld.xz, y = positionWorld.y, ny = normalWorld.y, macro = mx_noise_float(p.div(120)).mul(0.14).add(0.94);
    const two = (tt: THREE.Texture, a: number, bq: number) => mix(texture(tt, p.div(a)).rgb, texture(tt, p.div(bq).add(vec2(0.37, 0.61))).rgb, 0.5);
    const grass = two(meadowT, 10, 61).mul(vec3(0.62, 0.78, 0.4)), forest = two(fo.map, 9, 57).mul(vec3(0.58, 0.64, 0.42)), dry = two(dryT, 8, 41).mul(vec3(0.8, 0.74, 0.62));
    const rk0 = triplanarTexture(texture(rk.map), null, null, float(1 / 24)).rgb, rockc = mix(vec3(rk0.r.mul(0.3).add(rk0.g.mul(0.59)).add(rk0.b.mul(0.11))), rk0, 0.3).mul(vec3(0.7, 0.66, 0.62));
    const rockW = smoothstep(0.86, 0.66, ny), woodW = smoothstep(0.35, 0.65, mx_noise_float(p.div(170)).add(mx_noise_float(p.div(40)).mul(0.25)));
    const bankW = smoothstep(Y_UP + 1.2, Y_UP - 0.2, y).mul(step(Y_UP - 6, y));
    let col = mix(mix(grass, forest, woodW), dry, bankW.mul(0.7));
    col = mix(col.mul(macro), rockc, rockW);
    const rough = mix(texture(fo.rough, p.div(9)).r, texture(rk.rough, p.div(26)).r, rockW);
    const wg = weatherGround(col, rough, ny);
    m.colorNode = wg.color; m.roughnessNode = wg.rough;
    m.emissiveNode = wg.color.mul(vec3(0.06, 0.05, 0.075).add(vec3(0.1, 0.1, 0.16).mul(float(1).sub(ny).clamp(0, 1)))); // cool dusk fill so faces turned from the sun do not go black
    const nm = mix(texture(fo.nor, p.div(9)), texture(rk.nor, p.div(26)), rockW).xyz.mul(2).sub(1);
    m.normalNode = transformNormalToView(normalWorld.add(vec3(nm.x, 0, nm.y).mul(smoothstep(0.45, 0.9, ny).mul(0.7))).normalize());
    return m;
  }

  function roadMaterial(w: World) {
    const hw = w.track.def.halfWidth, asph = set('asphalt_04'), grassT = tex('aerial_grass_rock_diffuse.jpg', true), dryT = tex('dry_ground_rocks_diffuse.jpg', true);
    const m = new THREE.MeshStandardNodeMaterial(), l = uv().x, s = uv().y, al = abs(l), auv = vec2(l, s).div(7);
    const onRoad = float(1).sub(smoothstep(hw - 0.02, hw + 0.02, al)), edge = smoothstep(0.1, 0.08, abs(al.sub(hw - 0.4))), yel = smoothstep(0.075, 0.055, abs(al.sub(0.2)));
    const chq = (s0: number, dd: number) => step(s0, s).mul(step(s, dd + s0)).mul(step(0.5, fract(floor(s.sub(s0).div(0.7)).add(floor(l.div(0.7))).mul(0.5))));
    const white = max(max(edge, step(abs(s.sub(98)), 0.22)), chq(finishS, 2.1)).mul(onRoad), keep = max(white, yel.mul(onRoad)), worn = smoothstep(5.0, 1.2, abs(l)).mul(0.14);
    const base = texture(asph.map, auv).rgb.mul(0.62).mul(float(1).sub(worn)).mul(vec3(1.0, 0.97, 0.98));
    const shoulder = smoothstep(hw + 0.1, hw + 0.3, al).mul(float(1).sub(smoothstep(lim - 0.2, lim + 1.2, al)));
    const verge = mix(texture(grassT, vec2(l, s).div(6)).rgb.mul(vec3(0.62, 0.78, 0.4)), texture(dryT, vec2(l, s).div(3)).rgb.mul(0.8), shoulder);
    const gv = weatherGround(verge, float(0.95), float(1), float(1).sub(onRoad));
    const wr = wetRoad(mix(mix(base, vec3(0.82), white), vec3(0.9, 0.66, 0.08), yel.mul(onRoad)), texture(asph.rough, auv).r.mul(0.75).sub(worn.mul(0.4)), onRoad, keep, l, s);
    m.colorNode = mix(gv.color, wr.color, onRoad); m.roughnessNode = mix(gv.rough, wr.rough, onRoad);
    m.normalNode = normalMap(mix(mix(vec4(0.5, 0.5, 1, 1), texture(asph.nor, auv), onRoad), vec4(0.5, 0.5, 1, 1), wr.flat));
    return m;
  }

  /** Shared water look: gentle wave normals; `foam` adds drifting white caps (rapids below the falls). */
  function waterMat(color: [number, number, number], foam = 0) {
    const m = new THREE.MeshStandardNodeMaterial({ metalness: 0 }), p = positionWorld.xz, tt = time.mul(0.6);
    const w = (k: number, ax: number, az: number, sp: number) => sin(dot(p, vec2(ax, az)).mul(k).add(tt.mul(sp)));
    const nx = w(0.21, 1, 0.3, 1.1).mul(0.05).add(w(0.83, -0.4, 1, 1.7).mul(0.035)).add(mx_noise_float(vec3(p.mul(0.9), tt)).mul(0.07));
    const nz = w(0.17, 0.2, 1, 0.9).mul(0.05).add(w(0.67, 1, 0.6, 1.5).mul(0.035)).add(mx_noise_float(vec3(p.mul(0.9).add(31), tt)).mul(0.07));
    m.normalNode = vec3(nx, nz, 1).normalize(); m.colorNode = vec3(...color); m.roughnessNode = float(0.07);
    if (foam > 0) m.emissiveNode = vec3(0.6, 0.7, 0.72).mul(smoothstep(0.55, 0.85, mx_noise_float(vec3(p.mul(0.22), tt.mul(1.4))).add(mx_noise_float(vec3(p.mul(0.7), tt.mul(2.2))).mul(0.4))).mul(foam));
    return m;
  }

  function props(W: World) {
    const group = W.group, place = W.place.bind(W), pulse = W.pulse, d = q.detail;
    const WATER: [number, number, number] = [0.15, 0.42, 0.38], mesh = (g: THREE.BufferGeometry, mat: THREE.Material, shadow = false) => { const o = new THREE.Mesh(g, mat); o.frustumCulled = false; o.castShadow = shadow; o.receiveShadow = true; group.add(o); return o; };
    const conc = set('concrete_wall_008'), concCol = triplanarTexture(texture(conc.map), null, null, float(1 / 5)).rgb.mul(vec3(0.9, 0.9, 0.94));
    const concrete = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.88 }); concrete.colorNode = concCol; concrete.emissiveNode = concCol.mul(0.14);
    const steel = std(0x6d7780, 0.5, 0.6);
    const glowMat = (c: [number, number, number], k = 3.2, pl = 0.5) => { const g = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide }); g.colorNode = vec3(...c).mul(pulse.mul(pl).add(k)); return g; };

    // ---------- river ribbons (above the falls, below them) and the pond / channel at the bridge, the Whirlpool disc ----------
    {
      const ribbon = (i0: number, i1: number) => {
        const pos: number[] = [], idx: number[] = [];
        for (let i = i0; i <= i1; i++) {
          const a = Math.max(0, i - 1), c = Math.min(NR - 1, i + 1), tx = rx[c] - rx[a], tz = rz[c] - rz[a], l = Math.hypot(tx, tz), nx = -tz / l, nz = tx / l, w = rw[i] + 16;
          pos.push(rx[i] - nx * w, ry[i] + 0.0, rz[i] - nz * w, rx[i] + nx * w, ry[i] + 0.0, rz[i] + nz * w);
          if (i < i1) { const k = (i - i0) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
      };
      mesh(ribbon(0, iF), waterMat(WATER)); mesh(ribbon(iF + 1, iEnd), waterMat(WATER, 0.5));
      const pond = new THREE.PlaneGeometry(2 * 132, 440 + PB + 20, 1, 1); pond.rotateX(-Math.PI / 2); const po = mesh(pond, waterMat(WATER));
      const ca = 0, cb = (-440 + PB + 20) / 2; po.position.set(mx + ca * Dx - cb * Dz, Y_UP, mz + ca * Dz + cb * Dx); po.rotation.y = -myaw;
      const disc = mesh(new THREE.CircleGeometry(rw[iEnd] + 22, 40).rotateX(-Math.PI / 2), waterMat(WATER, 0.7)); disc.position.set(rx[iEnd], ry[iEnd], rz[iEnd]);
    }

    // ---------- Horseshoe Falls: a crescent sheet of white water with animated streaks, mist and spray ----------
    {
      const NA = 28, pos: number[] = [], uvs: number[] = [], idx: number[] = [], th = 1.15, drop = Y_UP - yDn, nxx = -fDz, nzz = fDx;
      const crest = (a: number) => { const l = Math.sin(a) * RC, bd = bend(l) ; return [fx0 + nxx * l + fDx * bd, fz0 + nzz * l + fDz * bd] as const; };
      for (let i = 0; i <= NA; i++) {
        const a = (i / NA * 2 - 1) * th, [x, z] = crest(a);
        pos.push(x, Y_UP + 0.1, z, x + fDx * 4, yDn + 1, z + fDz * 4); uvs.push(i / NA * 6, 1, i / NA * 6, 0);
        if (i < NA) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx);
      const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.6 }), vv = uv().y, uu = uv().x;
      const streak = mx_noise_float(vec3(uu.mul(9), vv.mul(0.35).add(time.mul(-0.9)), 0)).mul(0.5).add(0.5).mul(mx_noise_float(vec3(uu.mul(31), vv.mul(0.9).add(time.mul(-1.6)), 3)).mul(0.3).add(0.8));
      m.colorNode = mix(vec3(0.42, 0.78, 0.7), vec3(0.97, 1, 1), smoothstep(0.25, 0.8, streak).mul(float(1).sub(vv.mul(0.35)).add(smoothstep(0.35, 0.0, vv).mul(0.7))).clamp(0, 1));
      m.emissiveNode = m.colorNode.mul(0.35);
      const fm = mesh(g, m); fm.receiveShadow = false; (W as any).fallsMesh = fm;
      // churned pool at the foot
      const foot = new THREE.RingGeometry(0, 1, 28, 1); foot.rotateX(-Math.PI / 2);
      const fp = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, transparent: true, depthWrite: false }); fp.colorNode = vec3(0.9, 0.97, 1); fp.emissiveNode = vec3(0.45, 0.5, 0.52);
      fp.opacityNode = smoothstep(0.5, 0.95, mx_noise_float(vec3(positionWorld.xz.mul(0.12), time.mul(1.3))).mul(0.5).add(0.5)).mul(0.55).add(0.18);
      const pools: THREE.BufferGeometry[] = [];
      for (let i = 0; i <= 10; i++) { const [x, z] = crest(((i / 10) * 2 - 1) * th * 0.92), r = foot.clone(); r.scale(24, 1, 16); r.translate(x + fDx * 14, yDn + 0.25, z + fDz * 14); pools.push(r); }
      mesh(mergeGeometries(pools.map((p) => { const n = p.toNonIndexed(); n.deleteAttribute('uv'); return n; }))!, fp);
      // mist: <= 250 additive billboards rising from the plunge pool
      const N = Math.round(250 * Math.min(1, d)), arr = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        const a = (hash(i, 11) * 2 - 1) * th * 0.95, [x, z] = crest(a), off = 8 + hash(i, 12) * 40;
        arr[i * 4] = x + fDx * off; arr[i * 4 + 1] = yDn + 1 + hash(i, 13) * 6; arr[i * 4 + 2] = z + fDz * off; arr[i * 4 + 3] = hash(i, 14);
      }
      const plane = new THREE.PlaneGeometry(1, 1), mg = new THREE.InstancedBufferGeometry(); mg.copy(plane as any); mg.instanceCount = N; mg.setAttribute('imist', new THREE.InstancedBufferAttribute(arr, 4));
      const right = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3(0, 1, 0); (W as any).mistRightU = right; (W as any).mistUpU = up;
      const mist = mkMist(mg, right, up);
      group.add(mist);
    }

    function mkMist(mg: THREE.BufferGeometry, right: THREE.Vector3, up: THREE.Vector3) {
      const R = uniform(right), U = uniform(up), a = attribute('imist', 'vec4'), vv = positionGeometry.xy.add(0.5);
      const age = fract(a.w.add(time.mul(0.04).mul(a.w.mul(0.6).add(0.7)))), centre = vec3(a.x, a.y.add(age.mul(62)), a.z).add(vec3(windU.x, 0, windU.y).mul(age.mul(26)));
      const sz = float(11).add(age.mul(34)).mul(a.w.mul(0.6).add(0.7));
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      m.positionNode = centre.add(R.mul(vv.x.sub(0.5).mul(sz))).add(U.mul(vv.y.sub(0.5).mul(sz)));
      m.colorNode = vec3(0.8, 0.88, 0.95); m.opacityNode = sin(age.mul(3.14159)).mul(0.17).mul(smoothstep(0.5, 0.08, length(vv.sub(0.5))));
      const o = new THREE.Mesh(mg, m); o.frustumCulled = false; o.renderOrder = 5; return o;
    }

    // ---------- trees: maples and oaks (instanced), lite crowns far away, shrubs as ground cover ----------
    const stats: Record<string, number> = {};
    {
      const maple = { crown: withSway(mergeGeometries([blob(2.5, 0, 5.8, 0, 0.9, 1, 1), blob(1.9, 1.3, 7.2, 0.5, 0.9, 1, 2)])!, 9), trunk: withSway(bare(new THREE.CylinderGeometry(0.16, 0.3, 4.6, 5, 2).translate(0, 2.3, 0)), 9) };
      const oak = { crown: withSway(mergeGeometries([blob(3.4, 0, 6.0, 0, 0.78, 1, 3), blob(2.5, 2.4, 5.4, 0.8, 0.8, 1, 4), blob(2.4, -2.0, 5.5, -0.9, 0.8, 1, 5)])!, 9), trunk: withSway(bare(new THREE.CylinderGeometry(0.22, 0.42, 4.2, 6, 2).translate(0, 2.1, 0)), 9) };
      const lite = mergeGeometries([blob(3.0, 0, 5.6, 0, 0.85, 0, 6), blob(2.2, 1.3, 7.0, 0.4, 0.85, 0, 7)])!;
      const mm: THREE.Matrix4[] = [], mc: THREE.Color[] = [], om: THREE.Matrix4[] = [], oc: THREE.Color[] = [], fm: THREE.Matrix4[] = [], fc: THREE.Color[] = [];
      const capN = Math.round(1800 * d), capF = Math.round(3500 * d);
      const belowPlateau = (x: number, z: number, h: number) => h < field(x, z)[1] - 2.4;
      const mapleCol = (k: number) => { const c = new THREE.Color(); const r = hash(k, 31); return r < 0.5 ? c.setHSL(0.015 + hash(k, 32) * 0.06, 0.7, 0.2 + hash(k, 33) * 0.1) : r < 0.75 ? c.setHSL(0.1 + hash(k, 34) * 0.04, 0.65, 0.22) : c.setHSL(0.24 + hash(k, 35) * 0.05, 0.45, 0.14 + hash(k, 36) * 0.06); };
      const oakCol = (k: number) => new THREE.Color().setHSL(0.2 + hash(k, 37) * 0.07, 0.5, 0.1 + hash(k, 38) * 0.07);
      const tryTree = (x: number, z: number, seed: number, full: boolean) => {
        const h = W.heightAt(x, z), rd = W.roadDist(x, z); if (belowPlateau(x, z, h) || rd < lim + (full ? 5 : 80)) return false;
        const bf = W.bridgeW(0); void bf;
        const sl = Math.abs(W.heightAt(x + 4, z) - h) + Math.abs(W.heightAt(x, z + 4) - h); if (sl > 6) return false;
        if (full && rd > 130) return false;
        const [aa, bb] = frame(x, z); if (Math.abs(aa) < 150 && bb > -60 && bb < PB + 30) return false; // pond area
        const c0 = hash(seed, 41), sc = 0.8 + hash(seed, 5) * 0.8, ry0 = hash(seed, 9) * 6.28, dens = 0.35 + 0.9 * sstep(0.2, 0.6, fbm(x / 150 + 4, z / 150));
        if (hash(seed, 77) > dens) return false;
        if (!full) { fm.push(M(x, h - 0.5 * sc, z, ry0, sc * 1.1)); fc.push(c0 < 0.55 ? mapleCol(seed) : oakCol(seed)); return true; }
        if (c0 < 0.55) { mm.push(M(x, h - 0.3, z, ry0, sc * 0.85, sc * (0.9 + hash(seed, 6) * 0.5), sc * 0.85)); mc.push(mapleCol(seed)); } else { om.push(M(x, h - 0.3, z, ry0, sc * 0.95)); oc.push(oakCol(seed)); }
        return true;
      };
      scatter(t, b, lim, { cap: capN, stride: 2, per: 5, gap: 4.5, mean: 34, accept: (x, z, k) => tryTree(x, z, k, true) });
      scatter(t, b, lim, { cap: capF, farCap: capF, stride: 3, per: 6, gap: 70, mean: 260, tries: 40000, accept: (x, z, k) => tryTree(x, z, k + 500000, false) });
      // Dufferin islets
      for (let i = 0; i < islets.length; i++) { const [ia, ib, ir] = islets[i]; for (let k = 0; k < 4; k++) { const aa = ia + (hash(i, k) - 0.5) * ir * 0.9, bb = ib + (hash(i, k + 9) - 0.5) * ir * 0.9, x = mx + aa * Dx - bb * Dz, z = mz + aa * Dz + bb * Dx, h = W.heightAt(x, z); if (h < Y_UP + 0.2) continue; mm.push(M(x, h - 0.3, z, hash(i, k + 5) * 6.28, 0.8 + hash(k, i) * 0.4)); mc.push(mapleCol(i * 10 + k)); } }
      const foliage = std(0xffffff, 0.85), lh = positionLocal.y.div(10).clamp(0, 1);
      foliage.colorNode = vec3(1).mul(mx_noise_float(positionWorld.mul(2.0)).mul(0.35).add(1.0)).mul(mix(float(0.6), float(1.2), lh));
      foliage.emissiveNode = vec3(0.05, 0.035, 0.03);
      place(maple.crown, foliage, mm, mc); place(maple.trunk, std(0x3e3027, 0.9), mm); place(oak.crown, foliage, om, oc); place(oak.trunk, std(0x372c24, 0.9), om); place(lite, foliage, fm, fc, false);
      // ground cover: shrubs and tall grass clumps beside the road
      const shrub = mergeGeometries([blob(0.7, 0, 0.35, 0, 0.7, 0, 8), blob(0.5, 0.55, 0.3, 0.2, 0.7, 0, 9)])!, sm: THREE.Matrix4[] = [], scl: THREE.Color[] = [];
      scatter(t, b, lim, { cap: Math.round(6000 * d), stride: 1, per: 3, gap: 1.6, mean: 11, accept: (x, z, k) => {
        const h = W.heightAt(x, z); if (belowPlateau(x, z, h) || W.roadDist(x, z) < lim + 1.2) return false;
        const [aa, bb] = frame(x, z); if (Math.abs(aa) < 130 && bb > -30 && bb < PB) return false;
        if (hash(k, 21) > 0.55) return false; const sc = 0.7 + hash(k, 22) * 1.6;
        sm.push(M(x, h - 0.05, z, hash(k, 23) * 6.28, sc, sc * (0.7 + hash(k, 24) * 0.6), sc)); scl.push(new THREE.Color().setHSL(0.2 + hash(k, 25) * 0.1, 0.4, 0.06 + hash(k, 26) * 0.07)); return true;
      } });
      place(shrub, std(0xffffff, 0.9), sm, scl, false);
      stats.maples = mm.length; stats.oaks = om.length; stats.lite = fm.length; stats.shrubs = sm.length;
    }

    // ---------- start / finish ----------
    gantry(W, 98, banner('NIAGARA PARKWAY', 'LARGADA', false)); gantry(W, finishS, banner('CHEGADA', '', true));

    // ---------- Dufferin Islands bridge: a flat deck with stone parapets ----------
    {
      const deck = deckBridge(W, br, { mat: concrete, step: 4 });
      const gg: THREE.BufferGeometry[] = [];
      for (let s = br.from + 8; s < br.to - 4; s += 26) { const p = pathAt(s), yaw = Math.atan2(-p.tz, p.tx); gg.push(boxG(2.4, 4.2, 2.0, M(p.x - p.tz * 7.4, p.y - 3.1, p.z + p.tx * 7.4, yaw, 1)), boxG(2.4, 4.2, 2.0, M(p.x + p.tz * 7.4, p.y - 3.1, p.z - p.tx * 7.4, yaw, 1))); }
      mesh(mergeGeometries(gg)!, concrete, true); void deck;
    }

    // ---------- Clifton Hill: windowed blocks, neon, the SkyWheel, the Skylon ----------
    {
      const bm: THREE.Matrix4[] = [], unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const free = (x: number, z: number, r: number) => W.roadDist(x, z) > lim + r && W.roadDist(x + r, z) > lim + r * 0.5 && W.roadDist(x - r, z) > lim + r * 0.5 && W.roadDist(x, z + r) > lim + r * 0.5 && W.roadDist(x, z - r) > lim + r * 0.5;
      const spots: { x: number; z: number; r: number }[] = [];
      for (let s = 1700; s < 2500; s += 17) for (const side of [-1, 1]) for (let k = 0; k < 2; k++) {
        const key = s * 3 + side + k * 7, lt = side * (lim + 16 + k * 26 + hash(key, 1) * 10), p = pathAt(s + hash(key, 2) * 10), x = p.x - p.tz * lt, z = p.z + p.tx * lt, w = 11 + hash(key, 3) * 14, h = W.heightAt(x, z);
        if (!free(x, z, w * 0.75 + 6) || h < Y_UP - 60) continue;
        if (spots.some((o) => Math.hypot(o.x - x, o.z - z) < (o.r + w) * 0.8)) continue;
        spots.push({ x, z, r: w }); const ht = 9 + Math.pow(hash(key, 4), 1.6) * 44; bm.push(M(x, h - 1.5, z, Math.atan2(p.tz, p.tx) + (hash(key, 5) - 0.5) * 0.1, w, ht, w * (0.7 + hash(key, 6) * 0.5)));
      }
      const bmat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 }), pw = positionWorld, fu = fract(pw.x.add(pw.z).div(3.4)), fv = fract(pw.y.div(3.3)), cell = vec2(floor(pw.x.add(pw.z).div(3.4)), floor(pw.y.div(3.3)));
      const lit = step(0.42, fract(sin(dot(cell, vec2(12.9898, 78.233))).mul(43758.5453)));
      bmat.colorNode = vec3(0.16, 0.15, 0.18).mul(mx_noise_float(pw.div(9)).mul(0.3).add(0.9));
      bmat.emissiveNode = vec3(1, 0.7, 0.38).mul(step(0.3, fu).mul(step(0.3, fv)).mul(lit).mul(smoothstep(0.55, 0.2, abs(normalWorld.y))).mul(0.9)).mul(0.9);
      place(unit, bmat, bm, undefined, false); stats.blocks = bm.length;
      // neon signs: blades on posts and bars over the pavement, four colours, four meshes
      const NEON: [number, number, number][] = [[1, 0.1, 0.55], [0.1, 0.9, 1], [1, 0.62, 0.1], [0.3, 1, 0.35]], geos: THREE.BufferGeometry[][] = [[], [], [], []];
      for (let s = 1760, i = 0; s < 2480; s += 11 + hash(i, 2) * 12, i++) {
        const side = hash(i, 3) > 0.5 ? 1 : -1, lt = side * (lim + 3.4 + hash(i, 4) * 2.2), p = pathAt(s), yaw = Math.atan2(-p.tz, p.tx) + Math.PI / 2, c = Math.floor(hash(i, 5) * 4), x = p.x - p.tz * lt, z = p.z + p.tx * lt, y = p.y + side * lim * p.bank, kind = Math.floor(hash(i, 6) * 3);
        if (W.roadDist(x, z) < lim + 1.8) continue;
        const hh = 5.5 + hash(i, 7) * 6;
        geos[(c + 1) % 4].push(boxG(0.16, hh, 0.16, M(x, y + hh / 2 - 0.5, z, yaw, 1))); // pole (coloured too: keeps the count at four meshes)
        if (kind === 0) geos[c].push(boxG(0.5, 3.2, 1.8, M(x, y + hh - 0.5, z, yaw, 1)));
        else if (kind === 1) geos[c].push(boxG(0.4, 1.0, 5.0, M(x, y + hh - 0.5, z, yaw, 1)), boxG(0.4, 0.5, 3.4, M(x, y + hh - 1.4, z, yaw, 1)));
        else geos[c].push(cylG(1.5, 1.5, 0.35, 14, new THREE.Matrix4().compose(new THREE.Vector3(x, y + hh, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2)), new THREE.Vector3(1, 1, 1))));
      }
      // the SkyWheel: a lit ring with spokes and gondolas, beside the road on Clifton Hill
      {
        let wx = 0, wz = 0, wy = 0, ok = false; const p0 = pathAt(2210);
        for (const lt of [150, 120, 190, -150, -120, 230]) { const x = p0.x - p0.tz * lt, z = p0.z + p0.tx * lt; if (free(x, z, 50) && W.heightAt(x, z) > Y_UP - 70) { wx = x; wz = z; wy = W.heightAt(x, z); ok = true; break; } }
        if (ok) {
          const R = 26, cy = wy + R + 5, wyaw = Math.atan2(p0.tz, p0.tx) + Math.PI / 2, g: THREE.BufferGeometry[] = [], tm = (x: number, y: number, zq: number, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(wx, cy, wz).add(new THREE.Vector3(x, y, zq).applyAxisAngle(new THREE.Vector3(0, 1, 0), wyaw)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, wyaw, rz)), new THREE.Vector3(1, 1, 1));
          for (const z of [-1.2, 1.2]) { const r = new THREE.TorusGeometry(R, 0.28, 5, 36).toNonIndexed(); r.deleteAttribute('uv'); r.applyMatrix4(tm(0, 0, z)); g.push(r); }
          for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI; g.push(boxG(0.14, 2 * R, 0.14, tm(0, 0, 0, a))); }
          for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; g.push(boxG(2.2, 2.2, 1.8, tm(Math.cos(a) * R, Math.sin(a) * R, 0))); }
          geos[1].push(...g);
          const legs = mergeGeometries([boxG(1, cy - wy, 1, tm(-9, -(cy - wy) / 2 + 0, 0)), boxG(1, cy - wy, 1, tm(9, -(cy - wy) / 2, 0))].map((x) => x.clone()))!; mesh(legs, steel, true);
        }
      }
      NEON.forEach((c, i) => { if (geos[i].length) mesh(mergeGeometries(geos[i])!, glowMat(c, 2.6 + i * 0.1)); });

      // Skylon: a lathe-turned tower (slender shaft, saucer deck, mast) on a rise behind Clifton Hill
      const prof: [number, number][] = [[0.01, 0], [7, 0], [6, 6], [3.1, 40], [2.2, 100], [1.8, 150], [2.4, 152], [12, 156], [20, 159], [21, 161], [18, 164], [10, 167], [4, 169], [1.4, 172], [0.8, 190], [0.01, 198]];
      const sky = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 22), sm = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.3 });
      const band = smoothstep(154, 158, positionLocal.y).mul(smoothstep(168, 163, positionLocal.y));
      sm.colorNode = vec3(0.62, 0.63, 0.66); sm.emissiveNode = vec3(1, 0.75, 0.35).mul(band.mul(2.2)).add(vec3(0.8, 0.2, 0.3).mul(smoothstep(185, 190, positionLocal.y).mul(2)));
      let sx = 0, sz = 0, sy = 0; const p1 = pathAt(2040);
      for (const lt of [260, 220, 300, -260]) { const x = p1.x - p1.tz * lt, z = p1.z + p1.tx * lt; if (free(x, z, 30)) { sx = x; sz = z; sy = W.heightAt(x, z); break; } }
      if (sx || sz) { const so = new THREE.Mesh(sky, sm); so.position.set(sx, sy - 2, sz); so.castShadow = true; so.frustumCulled = false; group.add(so); (W as any).skylon = so; }
    }

    // ---------- Rainbow Bridge: a steel arch over the gorge whose deck crosses the road with room for traffic ----------
    {
      const sMid = (ov.from + ov.to) / 2, p = pathAt(sMid), deckY = p.y + 9.2, yaw = Math.atan2(-p.tz, p.tx) + Math.PI / 2; // bridge axis: perpendicular to the road
      const ax = (u: number) => [p.x - p.tz * u, p.z + p.tx * u] as const;
      const rl = -Lat(sMid) - 12, U0 = rl - 215, U1 = 150; // lateral span: arch over the river, abutment on the city side
      const geos: THREE.BufferGeometry[] = [], dw = 11;
      const lat = (u: number, v: number, w = 0) => new THREE.Vector3(p.x - p.tz * u + p.tx * w, v, p.z + p.tx * u + p.tz * w);
      const along = Math.atan2(-p.tz, p.tx), box = (u: number, v: number, w: number, lx: number, ly: number, lz: number) => boxG(lx, ly, lz, new THREE.Matrix4().compose(lat(u, v, w), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, along, 0)), new THREE.Vector3(1, 1, 1))); // lz runs across the road (lateral), lx along it
      geos.push(box((U0 + U1) / 2, deckY - 0.7, 0, dw, 1.4, U1 - U0));
      for (const w of [-dw / 2, dw / 2]) geos.push(box((U0 + U1) / 2, deckY + 0.5, w, 0.4, 1.0, U1 - U0)); // parapets
      for (let u = U0 + 10; u <= U1 - 10; u += 24) { // piers on the road side, spandrels over the gorge
        const g0 = W.heightAt(...ax(u)) - 3, topY = deckY - 1.4;
        if (u > rl + 110 || u < rl - 110) geos.push(box(u, (g0 + topY) / 2, 0, 3, Math.max(1, topY - g0), 6));
      }
      // arch ribs: parabola from the gorge walls up to the deck
      const aL = rl - 105, aR = rl + 105, ySpr = ry[Math.min(NR - 1, Math.max(0, Math.round(sMid / ST)))] + 6, yTop = deckY - 4;
      const archY = (u: number) => { const k = (u - rl) / 105; return yTop - (yTop - ySpr) * k * k; };
      for (const w of [-dw / 2 + 0.6, dw / 2 - 0.6]) {
        const pts: THREE.Vector3[] = []; for (let u = aL; u <= aR; u += 7) pts.push(lat(u, archY(u), w));
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 1.0, 5, false).toNonIndexed(); tube.deleteAttribute('uv'); geos.push(tube);
        for (let u = aL + 12; u < aR - 6; u += 18) { const yy = archY(u); geos.push(box(u, (yy + deckY - 1.4) / 2, w, 0.7, deckY - 1.4 - yy, 0.7)); }
      }
      const bmesh = new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshStandardNodeMaterial({ color: 0x5b6b66, roughness: 0.5, metalness: 0.6 })); bmesh.castShadow = true; bmesh.frustumCulled = false; group.add(bmesh);
      // strings of bulbs along the deck (the real bridge is lit at night)
      const bulbs: THREE.BufferGeometry[] = []; for (let u = U0 + 4; u < U1; u += 9) for (const w of [-dw / 2, dw / 2]) bulbs.push(boxG(0.35, 0.35, 0.35, new THREE.Matrix4().compose(lat(u, deckY + 1.15, w), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1))));
      mesh(mergeGeometries(bulbs)!, glowMat([1, 0.82, 0.5], 3.5)); void yaw;
    }

    // ---------- lamp posts (emissive heads, no real lights) ----------
    {
      const lm: THREE.Matrix4[] = [], pole = mergeGeometries([new THREE.CylinderGeometry(0.07, 0.11, 8, 7).translate(0, 4, 0), new THREE.BoxGeometry(0.1, 0.1, 2.4).translate(0, 8, 1.1)])!, head = new THREE.BoxGeometry(0.34, 0.1, 0.7).translate(0, 7.93, 2.2);
      let k = 0; for (let s = 30; s < len - 20; s += 36, k++) {
        if ((s > br.from - 10 && s < br.to + 10) || (s > ov.from - 10 && s < ov.to + 10)) continue;
        const city = s > 1650 && s < 2800, early = s < 700, fin = s > len - 700; if (!(city || early || fin || k % 3 === 0)) continue;
        const side = k % 2 ? 1 : -1, l = side * (lim + 1.5), p = pathAt(s); lm.push(M(p.x - p.tz * l, p.y + side * lim * p.bank - 0.1, p.z + p.tx * l, Math.atan2(-p.tz * -side, -p.tx * side) + Math.PI / 2, 1));
      }
      const glow = new THREE.MeshBasicNodeMaterial(); glow.colorNode = vec3(1, 0.74, 0.42).mul(pulse.mul(1.5).add(4));
      place(pole, std(0x30343a, 0.5, 0.6), lm, undefined, false); place(head, glow, lm, undefined, false); stats.lamps = lm.length;
    }

    // ---------- Whirlpool Aero Car: two stations and a cable across the basin, a red gondola hanging from it ----------
    {
      const A = { x: e0x + (rx[iEnd] - e0x) * 0.15, z: e0z + (rz[iEnd] - e0z) * 0.15 }; // station on this rim
      const dxn = rx[iEnd] - A.x, dzn = rz[iEnd] - A.z, dl = Math.hypot(dxn, dzn), Bx = rx[iEnd] + dxn / dl * (rw[iEnd] + 40), Bz = rz[iEnd] + dzn / dl * (rw[iEnd] + 40);
      const hA = W.heightAt(A.x, A.z), hB = Math.max(W.heightAt(Bx, Bz), hA - 6), TA = hA + 20, TB = hB + 20, yawC = Math.atan2(Bx - A.x, Bz - A.z);
      const towers: THREE.BufferGeometry[] = [];
      for (const [x, z, h0, ty] of [[A.x, A.z, hA, TA], [Bx, Bz, hB, TB]] as const) { towers.push(boxG(2.2, ty - h0 + 2, 2.2, M(x, (h0 + ty) / 2 - 1, z, 0, 1)), boxG(9, 2.5, 7, M(x, h0 + 1.2, z, yawC, 1)), boxG(1.2, 0.6, 6, M(x, ty + 0.2, z, yawC, 1))); }
      mesh(mergeGeometries(towers)!, steel, true);
      const cl = Math.hypot(Bx - A.x, Bz - A.z), cable = new THREE.CylinderGeometry(0.06, 0.06, cl, 4).rotateX(Math.PI / 2);
      const co = new THREE.Mesh(cable, std(0x222222, 0.6, 0.6)); co.position.set((A.x + Bx) / 2, (TA + TB) / 2 + 0.3, (A.z + Bz) / 2); co.lookAt(Bx, TB + 0.3, Bz); co.frustumCulled = false; group.add(co);
      const gx = A.x + (Bx - A.x) * 0.45, gz = A.z + (Bz - A.z) * 0.45, gy = TA + (TB - TA) * 0.45, car = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 3), new THREE.MeshStandardNodeMaterial({ color: 0xc0261f, roughness: 0.4 }));
      car.position.set(gx, gy - 4.2, gz); car.rotation.y = yawC; car.castShadow = true; car.frustumCulled = false; group.add(car);
      const hang = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 0.15), std(0x222222)); hang.position.set(gx, gy - 1.5, gz); group.add(hang);
    }

    // ---------- backdrop: dusk-lit distant hills ring, flat shaded, beyond the terrain grid ----------
    {
      let tris = 0, calls = 0;
      group.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !m.geometry) return; calls++; const g = m.geometry as THREE.BufferGeometry, n = ((g as any).instanceCount ?? (m as THREE.InstancedMesh).count ?? 1); tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * ((m as any).isInstancedMesh || (g as any).isInstancedBufferGeometry ? n : 1); });
      (W as any).stats = { ...stats, tris: Math.round(tris), meshes: calls, riverVerts: NR };
    }
  }

  const def: WorldDef = {
    id: 'niagara', x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, cell: q.detail < 0.6 ? 14 : 10, natural, hdr: 'belfast_sunset_puresky_2k.hdr',
    water: [], wind: [2.2, 1.0], sunDir: [0.5, 0.12, -0.6], sunColor: 0xff9a6a, fog: [0.55, 0.42, 0.5], fogNear: 500, fogFar: 9000, seaColor: [0.15, 0.42, 0.38],
    terrainMaterial, roadMaterial, barrier: 'rail', bridge: br, cutBlend: 30, cutEdge: 6, props,
  };
  const w = new World(eng, track, def), upd = w.update.bind(w), cam = eng.camera, tmp = new THREE.Matrix4();
  w.update = (focus: THREE.Vector3) => {
    upd(focus); const r = (w as any).mistRightU as THREE.Vector3 | undefined, u = (w as any).mistUpU as THREE.Vector3 | undefined;
    if (r && u) { tmp.copy(cam.matrixWorld); r.setFromMatrixColumn(tmp, 0); u.setFromMatrixColumn(tmp, 1); }
  };
  void e0x;
  return w;
}
