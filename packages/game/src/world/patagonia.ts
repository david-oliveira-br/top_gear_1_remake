import * as THREE from 'three/webgpu';
import { texture, uv, mix, vec2, vec3, float, positionWorld, positionLocal, normalWorld, smoothstep, abs, normalMap, mx_noise_float, triplanarTexture, attribute, sin, cos, time, max, step, fract, floor, vec4 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FINISH_BEFORE_END, PATAGONIA_BRIDGE, pointAt, type Track } from '../../../sim/src/index';
import type { Engine } from '../gfx/engine';
import { weatherGround, wetRoad, windU } from './weather';
import { World, fbm, hash, M, set, sstep, std, vnoise, type WaterDef, type WorldDef } from './base';
import { routeBounds, roadField, gantry, banner, peaks, deckBridge, scatter, sweep, pathAt, coniferGeo } from './route';

/** Patagonia, "Ruta del Fin del Mundo": golden steppe, a glacier lake with a timber bridge, red lenga forest, moraine, and the granite towers ahead. */

// ---- zones along the route, by world z (the route runs mostly towards -z): lenga forest z -3450..-4450, moraine from z -4450 on, easing off towards the end ----
const forestZ = (z: number) => (1 - sstep(-3560, -3300, z)) * sstep(-4560, -4350, z);
const moraineZ = (z: number) => (1 - sstep(-4700, -4450, z)) * (1 - 0.8 * (1 - sstep(-6350, -5950, z)));

/** Geometry reduced to position + normal, non-indexed, so differing primitives can be merged. */
function bare(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}
/** Adds a per-vertex 'sway' weight (0 at the foot, 1 at `top`) for the wind animation. */
function withSway(g: THREE.BufferGeometry, top: number) {
  const p = g.attributes.position, a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) a[i] = Math.max(0, Math.min(1, p.getY(i) / top));
  g.setAttribute('sway', new THREE.BufferAttribute(a, 1)); return g;
}
/** Jitters the vertices of a blob consistently (coincident vertices get the same offset), then makes it flat shaded. */
function lump(g: THREE.BufferGeometry, amt: number, seed: number) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (hash(Math.round(x * 31) + seed, Math.round(y * 37 + z * 53)) - 0.5) * amt;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  const f = bare(g); f.computeVertexNormals(); return f;
}
const WIND: [number, number] = [9, 4], WL = Math.hypot(WIND[0], WIND[1]), WX = WIND[0] / WL, WZ = WIND[1] / WL;

/** Wind-swept lenga: trunk and crown bent downwind (+WIND). Sway weights run 0..1 up to ~10 m. */
function lengaGeo(lite: boolean) {
  const lean = (x: number, y: number, z: number): [number, number, number] => { const k = 0.028 * y * y; return [x + WX * k, y, z + WZ * k]; };
  const bend = (g: THREE.BufferGeometry) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, ...lean(p.getX(i), p.getY(i), p.getZ(i))); const f = bare(g); f.computeVertexNormals(); return withSway(f, 10.5); };
  const blob = (r: number, d: number, x: number, y: number, z: number, sy: number, seed: number) => { const g = new THREE.IcosahedronGeometry(r, d); g.scale(1, sy, 1); g.translate(x, y, z); return lump(g, 0.42, seed); };
  const crown = lite ? mergeGeometries([blob(2.8, 0, 0, 6.2, 0, 0.8, 1), blob(1.9, 0, 1.2, 7.7, 0.4, 0.8, 2)])! : mergeGeometries([blob(3.0, 1, 0, 5.9, 0, 0.78, 1), blob(2.1, 1, 1.4, 7.5, 0.6, 0.8, 2), blob(2.2, 1, -1.2, 5.5, -0.8, 0.8, 3)])!;
  const trunk = new THREE.CylinderGeometry(0.15, 0.3, 5.2, lite ? 4 : 5, 2).translate(0, 2.6, 0);
  return { crown: bend(crown), trunk: bend(bare(trunk)) };
}
function tuftGeo() {
  const pos: number[] = [], nor: number[] = [], sw: number[] = [];
  for (let k = 0; k < 7; k++) {
    const a = hash(k, 3) * 6.283, r = hash(k, 5) * 0.14, h = 0.4 + hash(k, 7) * 0.4, w = 0.035, bx = Math.cos(a) * r, bz = Math.sin(a) * r, ca = Math.cos(a + 1.57) * w, sa = Math.sin(a + 1.57) * w;
    const tl = 0.12 + hash(k, 9) * 0.12, tx = bx + Math.cos(a) * tl, tz = bz + Math.sin(a) * tl;
    pos.push(bx - ca, 0, bz - sa, bx + ca, 0, bz + sa, tx, h, tz); nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0); sw.push(0, 0, 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('sway', new THREE.Float32BufferAttribute(sw, 1)); return g;
}
/** Wind sway as a vertex displacement: needs a 'sway' attribute; phase comes from position so neighbours do not move in lockstep. */
const swayNode = (amp: number) => {
  const g = attribute('sway', 'float'), ph = positionLocal.x.mul(0.045).add(positionLocal.z.mul(0.06));
  const gust = sin(time.mul(1.7).add(ph)).mul(0.5).add(0.65).add(sin(time.mul(0.55).add(ph.mul(0.5))).mul(0.3));
  return positionLocal.add(vec3(windU.x, 0, windU.y).mul(gust.mul(amp).mul(g.mul(g))));
};

/** Guanaco: tan body, pale belly, dark face, long neck. `graze` puts the head down. */
function guanacoGeo(graze: boolean) {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: [number, number, number]) => { const b = bare(g); b.computeVertexNormals(); const n = b.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); b.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(b); };
  const body = new THREE.SphereGeometry(1, 8, 5); body.scale(0.42, 0.4, 0.95); body.translate(0, 1.02, 0); add(body, [0.52, 0.34, 0.18]);
  const belly = new THREE.SphereGeometry(1, 7, 4); belly.scale(0.36, 0.22, 0.8); belly.translate(0, 0.78, 0.05); add(belly, [0.86, 0.8, 0.7]);
  for (const [lx, lz] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]]) { const l = new THREE.CylinderGeometry(0.045, 0.035, 0.95, 4); l.translate(lx, 0.475, lz); add(l, [0.78, 0.62, 0.42]); }
  const nk = new THREE.CylinderGeometry(0.075, 0.11, 0.85, 5); const hy = graze ? 0.5 : 1.95, hz = graze ? 1.35 : 1.15;
  const ax = new THREE.Vector3(0, hy - 1.2, hz - 0.8).normalize(); nk.translate(0, 0.42, 0); nk.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax)); nk.translate(0, 1.2, 0.8); add(nk, [0.72, 0.52, 0.32]);
  const hd = new THREE.SphereGeometry(1, 6, 4); hd.scale(0.09, 0.1, 0.2); hd.translate(0, hy, hz + (graze ? 0.1 : 0.12)); add(hd, [0.34, 0.27, 0.22]);
  for (const sx of [-1, 1]) { const e = new THREE.ConeGeometry(0.03, 0.14, 4); e.translate(sx * 0.06, hy + 0.14, hz - 0.05); add(e, [0.34, 0.27, 0.22]); }
  const tail = new THREE.ConeGeometry(0.06, 0.28, 4); tail.rotateX(-1.2); tail.translate(0, 1.32, -0.95); add(tail, [0.5, 0.34, 0.18]);
  return mergeGeometries(parts)!;
}

/** Material that reads the geometry's 'color' attribute (linear). */
const vcol = (rough: number) => { const m = new THREE.MeshStandardNodeMaterial({ roughness: rough }); m.colorNode = attribute('color', 'vec3'); return m; };

/** Fluted granite tower on a lathe: a flared foot, a near-vertical shaft with grooves, a pointed dark cap. Colours are per vertex. */
function towerGeo(H: number, R0: number, seed: number) {
  const S = 28, R = 30, pos: number[] = [], col: number[] = [], idx: number[] = [], sd = seed * 13.7;
  for (let j = 0; j <= R; j++) {
    const h = j / R, flare = 1 + 0.5 * (1 - sstep(0, 0.22, h)), tip = 1 - 0.93 * Math.pow(sstep(0.62, 1, h), 1.2), prof = R0 * flare * tip * (0.92 + 0.12 * fbm(h * 6 + sd, sd));
    const cx = Math.sin(h * 2.2 + sd) * R0 * 0.18 * h, cz = Math.cos(h * 1.7 + sd * 1.3) * R0 * 0.12 * h, y = h * H;
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2, groove = 0.5 + 0.5 * Math.cos(a * 6 + sd + h * 1.4), fine = Math.cos(a * 13 + sd * 2), k = 1 + 0.11 * (groove - 0.5) + 0.04 * fine + (hash(i * 7 + j, seed) - 0.5) * 0.05;
      pos.push(cx + Math.cos(a) * prof * k, y, cz + Math.sin(a) * prof * k);
      const cap = sstep(0.5, 0.58, h + (fbm(a * 2 + sd, h * 9) - 0.5) * 0.08), lite = 0.5 + 0.5 * groove, tone = 0.78 + 0.22 * fbm(a * 3 + sd, h * 12);
      const gr = [0.24 * tone + 0.04 * lite, 0.21 * tone + 0.035 * lite, 0.19 * tone + 0.03 * lite], dk = [0.02, 0.02, 0.022];
      col.push(gr[0] + (dk[0] - gr[0]) * cap, gr[1] + (dk[1] - gr[1]) * cap, gr[2] + (dk[2] - gr[2]) * cap);
    }
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < S; i++) { const a = j * S + i, b = j * S + (i + 1) % S; idx.push(a, a + S, b, b, a + S, b + S); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  const f = g.toNonIndexed(); f.computeVertexNormals(); return f;
}

export function makePatagonia(eng: Engine, track: Track): World {
  const t = track, b = routeBounds(t, { x0: 700, x1: 1250, z0: 700, z1: 700 }), field = roadField(t, b, { endSide: 0 }), lim = t.def.halfWidth + t.def.shoulder, finishS = t.len - FINISH_BEFORE_END;
  const br = PATAGONIA_BRIDGE, smid = (br.from + br.to) / 2, [mx, , mz, myaw] = pointAt(t, smid, 0), Dx = Math.cos(myaw), Dz = Math.sin(myaw);
  const WATER = 20;
  // the glacier lake: a rounded basin around the bridge, +bb = to the right of the road (east), running 900 m out to the ice
  const LAKE = { bb0: -110, bb1: 900, hwMax: 330 };
  const along = (x: number, z: number) => (x - mx) * Dx + (z - mz) * Dz, lat = (x: number, z: number) => -(x - mx) * Dz + (z - mz) * Dx;
  const lakeXZ = (a: number, bb: number): [number, number] => [mx + a * Dx - bb * Dz, mz + a * Dz + bb * Dx];
  function lakeR(x: number, z: number) {
    const a = along(x, z), bb = lat(x, z), hw = (105 + 205 * sstep(50, 380, bb)) * (1 + 0.2 * (fbm(x / 90 + 3, z / 90) - 0.5)), u = Math.abs(a) / hw, v = Math.abs(bb - 395) / 505 * (1 + 0.08 * (fbm(x / 60, z / 60 + 8) - 0.5));
    return Math.pow(u ** 4 + v ** 4, 0.25);
  }
  // estancia pad on the steppe, left of the road
  const ES = 1240, ELAT = -88, EP = pathAt(t, ES, ELAT), EYAW = Math.atan2(-EP.tz, EP.tx);

  function base(x: number, z: number) {
    const [d, ry] = field(x, z), n1 = fbm(x / 310 + 5, z / 310);
    const li = 1 - sstep(1.0, 2.6, lakeR(x, z));
    let h = ry - 0.9 + (d - 8) * 0.02 * (1 - li) + sstep(6, 260, d) * (6 + 32 * n1) * (1 - 0.9 * li) + (fbm(x / 55 + 2, z / 55) - 0.45) * 4.5 * sstep(12, 70, d) + (fbm(x / 18, z / 18) - 0.45) * 1.1 * sstep(10, 50, d)
      + sstep(300, 900, d) * (25 + 75 * fbm(x / 420 + 9, z / 420 + 4)) * (1 - 0.8 * li) - Math.pow(1 - Math.abs(2 * vnoise(x / 130 + 11, z / 130 + 5) - 1), 6) * 14 * sstep(40, 200, d);
    h = Math.max(h, ry - 2);
    void 0;
    // moraine: ridged mounds and boulder fields
    const mw = moraineZ(z); if (mw > 0) h += (Math.pow(1 - Math.abs(2 * vnoise(x / 48, z / 48) - 1), 2) * 8 + (fbm(x / 14, z / 14) - 0.45) * 3) * mw * sstep(14, 70, d);
    // glacier lake with a soft shore, and the headwall where the ice comes down
    const r = lakeR(x, z);
    if (r < 1.55) { const fl = 17 - 13 * sstep(1, 0.45, r) + (fbm(x / 20, z / 20) - 0.5) * 1.5 * (1 - sstep(0.45, 1, r)), tt = sstep(1, 1.55, r); h = fl + (h - fl) * tt; }
    const a = along(x, z), bb = lat(x, z);
    if (bb > 900) h += 150 * sstep(940, 1300, bb) * (1 - sstep(330, 760, Math.abs(a))) * (0.85 + 0.3 * fbm(x / 80, z / 80)) + 25 * sstep(1250, 1500, bb) * (1 - sstep(300, 900, Math.abs(a)));
    return h;
  }
  const padH = base(EP.x - EP.tz * 0 + 0, EP.z);
  function natural(x: number, z: number) {
    let h = base(x, z);
    const pr = Math.hypot(x - EP.x - 0, z - EP.z); if (pr < 56) h += (padH - h) * (1 - sstep(30, 56, pr));
    // fade to a common ground level at the grid edge so the land runs into the far plane
    const e = Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z), w = 1 - sstep(0, 220, e); if (w > 0) h += (52 + (fbm(x / 120, z / 120) - 0.5) * 14 - h) * w;
    return h;
  }

  function terrainMaterial() {
    const dry = set('dry_ground_rocks'), pebble = set('coast_sand_rocks_02'), mor = set('aerial_rocks_02'), forest = set('forrest_ground_01');
    const m = new THREE.MeshStandardNodeMaterial(), p = positionWorld.xz, y = positionWorld.y, ny = normalWorld.y;
    const zz = positionWorld.z.add(mx_noise_float(p.div(170)).mul(70));
    const fz = float(1).sub(smoothstep(-3560, -3300, zz)).mul(smoothstep(-4560, -4350, zz));
    const mz = float(1).sub(smoothstep(-4700, -4450, zz)).mul(float(1).sub(float(0.8).mul(float(1).sub(smoothstep(-6350, -5950, zz)))));
    const lay = (s: ReturnType<typeof set>, a: number, c: number) => mix(texture(s.map, p.div(a)).rgb, texture(s.map, p.div(c)).rgb, 0.5);
    const patch = smoothstep(-0.25, 0.4, mx_noise_float(p.div(60).add(vec2(4, 9)))), fine = mx_noise_float(p.div(7)).mul(0.5).add(0.5);
    // golden coiron: warm yellow with olive and brown mottling
    const dl = lay(dry, 9, 61), gold = dl.mul(vec3(1.2, 0.98, 0.58)), brown = dl.mul(vec3(0.82, 0.66, 0.46)), olive = dl.mul(vec3(0.8, 0.86, 0.5));
    const steppe = mix(mix(gold, brown, patch.mul(0.65)), olive, smoothstep(0.35, 0.8, mx_noise_float(p.div(150).add(vec2(9, 2)))).mul(0.4)).mul(fine.mul(0.25).add(0.85)).mul(mix(float(1), float(0.72), smoothstep(0.1, 0.55, mx_noise_float(p.div(22).add(vec2(3, 7))))));
    const floorC = lay(forest, 7, 41).mul(vec3(1.7, 0.5, 0.3)), moraineC = triplanarTexture(texture(mor.map), null, null, float(1 / 24)).rgb.mul(vec3(0.95, 0.88, 0.8));
    const rockW = smoothstep(0.84, 0.66, ny), shore = float(1).sub(smoothstep(WATER + 2.5, mx_noise_float(p.div(9)).mul(3).add(WATER + 7), y));
    const stepW = float(1).sub(fz).sub(mz.mul(0.85)).max(0);
    let col = mix(steppe, floorC, fz.mul(0.95)); col = mix(col, moraineC, mz.mul(smoothstep(0.1, 0.5, fine.add(patch.mul(0.4)))).max(rockW));
    col = mix(col, texture(pebble.map, p.div(5)).rgb.mul(vec3(0.5, 0.47, 0.42)), shore);
    void stepW;
    const rough = mix(texture(dry.rough, p.div(9)).r, texture(mor.rough, p.div(18)).r, max(mz, rockW));
    const wg = weatherGround(col.mul(mx_noise_float(p.div(240)).mul(0.14).add(0.95)), rough.max(0.55), ny);
    m.colorNode = wg.color; m.roughnessNode = wg.rough;
    m.normalNode = normalMap(mix(mix(texture(dry.nor, p.div(9)), texture(forest.nor, p.div(7)), fz), texture(mor.nor, p.div(18)), max(mz, rockW)));
    return m;
  }

  function roadMaterial(w: World) {
    const hw = w.track.def.halfWidth, asph = set('asphalt_04'), grav = set('gravel_ground_01'), dry = set('dry_ground_rocks');
    const m = new THREE.MeshStandardNodeMaterial(), l = uv().x, s = uv().y, al = abs(l), auv = vec2(l, s).div(7);
    const onRoad = float(1).sub(smoothstep(hw - 0.02, hw + 0.02, al)), worn = smoothstep(5.0, 1.2, abs(l.add(sin(s.mul(0.017)).mul(1.0)))).mul(0.16);
    const edge = smoothstep(0.1, 0.08, abs(al.sub(hw - 0.4))), yel = smoothstep(0.075, 0.055, abs(al.sub(0.2)));
    const chq = (s0: number, d: number) => step(s0, s).mul(step(s, d + s0)).mul(step(0.5, fract(floor(s.sub(s0).div(0.7)).add(floor(l.div(0.7))).mul(0.5))));
    const white = max(max(edge, step(abs(s.sub(98)), 0.22)), chq(finishS, 2.1)).mul(onRoad).mul(texture(asph.rough, auv).r.mul(0.5).add(0.6));
    const base = texture(asph.map, auv).rgb.mul(0.78).mul(float(1).sub(worn)).mul(vec3(1.02, 1, 0.97));
    const shoulder = smoothstep(hw + 0.1, hw + 0.3, al).mul(float(1).sub(smoothstep(lim + 0.8, lim + 2.2, al)));
    const gravel = texture(grav.map, vec2(l, s).div(3)).rgb.mul(vec3(1.25, 1.1, 0.88)), verge = texture(dry.map, vec2(l, s).div(6)).rgb.mul(vec3(1.5, 1.15, 0.6));
    const gv = weatherGround(mix(verge, gravel, shoulder), mix(float(0.95), texture(grav.rough, vec2(l, s).div(3)).r, shoulder), float(1), float(1).sub(onRoad));
    const wr = wetRoad(mix(mix(base, vec3(0.82), white), vec3(0.9, 0.66, 0.08), yel.mul(onRoad)), texture(asph.rough, auv).r.mul(0.75).sub(worn.mul(0.5)), onRoad, max(white, yel), l, s);
    m.colorNode = mix(gv.color, wr.color, onRoad); m.roughnessNode = mix(gv.rough, wr.rough, onRoad);
    m.normalNode = normalMap(mix(mix(texture(grav.nor, vec2(l, s).div(3)), texture(asph.nor, auv), onRoad), vec4(0.5, 0.5, 1, 1), wr.flat));
    return m;
  }

  function props(W: World) {
    const q = W.eng.quality, group = W.group, place = W.place.bind(W);
    const frame = (s: number, l = 0) => { const p = pathAt(t, s, l); return { ...p, yaw: Math.atan2(-p.tz, p.tx) }; };
    const gh = (x: number, z: number) => W.heightAt(x, z);

    // ---------- far ground: a ring around the terrain grid so the land never ends in the void ----------
    {
      const O = 60000, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, y = 52, pos = [b.x0, y, b.z0, b.x1, y, b.z0, b.x1, y, b.z1, b.x0, y, b.z1, cx - O, y, cz - O, cx + O, y, cz - O, cx + O, y, cz + O, cx - O, y, cz + O];
      const idx: number[] = []; for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; idx.push(i, 4 + i, j, j, 4 + i, 4 + j); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(24).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 1, side: THREE.DoubleSide }), p = positionWorld.xz;
      m.colorNode = mix(vec3(0.5, 0.4, 0.2), vec3(0.34, 0.3, 0.2), smoothstep(-0.3, 0.4, mx_noise_float(p.div(900)))).mul(mx_noise_float(p.div(60)).mul(0.1).add(0.95));
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; group.add(mesh);
    }

    // ---------- trees: wind-swept lenga in autumn colours, two tiers ----------
    const full = lengaGeo(false), lite = lengaGeo(true);
    const pal = [[0.62, 0.1, 0.04], [0.8, 0.2, 0.05], [0.9, 0.4, 0.07], [0.72, 0.07, 0.06], [0.95, 0.58, 0.1], [0.55, 0.3, 0.07], [0.5, 0.42, 0.1]];
    const leaf = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 }), liteLeaf = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
    for (const [mat, amp] of [[leaf, 0.07], [liteLeaf, 0.07]] as const) {
      mat.colorNode = vec3(1).mul(mx_noise_float(positionWorld.mul(1.7)).mul(0.3).add(1.0)).mul(mix(float(0.55), float(1.2), attribute('sway', 'float')));
      mat.positionNode = swayNode(amp);
    }
    const bark = std(0x4a3d34, 0.95); bark.positionNode = swayNode(0.07);
    const tier = { f: [] as THREE.Matrix4[], fc: [] as THREE.Color[], l: [] as THREE.Matrix4[], lc: [] as THREE.Color[] };
    const treeAt = (x: number, z: number, seed: number, isFull: boolean) => {
      const h = gh(x, z); if (h < WATER + 5) return false;
      const sl = Math.abs(gh(x + 4, z) - h) + Math.abs(gh(x, z + 4) - h); if (sl > 7) return false;
      const fw = forestZ(z), lakeSide = lakeR(x, z) < 1.9 ? 0.06 : 0, dens = fw * (0.7 + 0.5 * fbm(x / 70 + 2, z / 70)) + lakeSide + moraineZ(z) * 0.004;
      if (hash(seed, 77) > dens * (isFull ? 0.9 : 0.85)) return false;
      const sc = 0.55 + hash(seed, 5) * 0.55, c = pal[Math.floor(hash(seed, 3) * pal.length)], jit = 0.85 + hash(seed, 4) * 0.3;
      const mtx = M(x, h - 0.3, z, 0, sc, sc * (0.85 + hash(seed, 6) * 0.5), sc), col = new THREE.Color(c[0] * jit, c[1] * jit, c[2] * jit);
      if (isFull) { tier.f.push(mtx); tier.fc.push(col); } else { tier.l.push(mtx); tier.lc.push(col); }
      return true;
    };
    const near = Math.round(3000 * q.detail), far = Math.round(7000 * q.detail);
    scatter(t, b, lim, { cap: near, farCap: near, stride: 1, per: 6, gap: 3, mean: 20, accept: (x, z, k) => W.roadDist(x, z) < 70 && W.roadDist(x, z) > lim + 3 && treeAt(x, z, k, true) });
    scatter(t, b, lim, { cap: far, farCap: far * 1.2, stride: 2, per: 6, gap: 60, mean: 90, tries: 40000 * q.detail, accept: (x, z, k) => W.roadDist(x, z) > 68 && treeAt(x, z, k + 5000, false) });
    if (tier.f.length) { place(full.crown, leaf, tier.f, tier.fc); place(full.trunk, bark, tier.f); }
    if (tier.l.length) { place(lite.crown, liteLeaf, tier.l, tier.lc, false); place(lite.trunk, bark, tier.l, undefined, false); }

    // ---------- scrub, grass tufts near the road, boulders on the moraine ----------
    {
      const sh = new THREE.IcosahedronGeometry(1, 0); sh.scale(1, 0.62, 1); sh.translate(0, 0.35, 0); const shrub = lump(sh, 0.5, 9);
      const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = [], cap = Math.round(4200 * q.detail);
      scatter(t, b, lim, { cap, farCap: cap, stride: 2, per: 3, gap: 4, mean: 80, accept: (x, z, k) => {
        const h = gh(x, z); if (h < WATER + 4 || W.roadDist(x, z) < lim + 3 || forestZ(z) > 0.5 || hash(k, 21) > 0.45 - moraineZ(z) * 0.2) return false;
        const sc = 0.5 + hash(k, 22) * 1.1; mats.push(M(x, h - 0.1, z, hash(k, 23) * 6.28, sc * 1.3, sc * 0.8, sc * 1.3));
        const r = hash(k, 24); cols.push(r < 0.2 ? new THREE.Color(0.5, 0.14, 0.08) : r < 0.55 ? new THREE.Color(0.32, 0.3, 0.12) : new THREE.Color(0.5, 0.4, 0.15)); return true;
      } });
      const sm = std(0xffffff, 0.95); sm.colorNode = vec3(1).mul(mx_noise_float(positionWorld.mul(1.3)).mul(0.3).add(0.95)); place(shrub, sm, mats, cols);
      const tm: THREE.Matrix4[] = [], tc: THREE.Color[] = [], tcap = Math.round(12000 * q.detail);
      scatter(t, b, lim, { cap: tcap, farCap: tcap, stride: 2, per: 3, gap: 1.2, mean: 13, accept: (x, z, k) => {
        const h = gh(x, z); if (h < WATER + 3 || W.roadDist(x, z) < lim + 0.8 || forestZ(z) > 0.7 || lakeR(x, z) < 1.12) return false;
        if (Math.abs(gh(x + 3, z) - h) + Math.abs(gh(x, z + 3) - h) > 5) return false;
        const sc = 0.7 + hash(k, 31) * 1.1; tm.push(M(x, h - 0.05, z, hash(k, 32) * 6.28, sc, sc * (0.8 + hash(k, 33) * 0.6), sc));
        tc.push(new THREE.Color().setHSL(0.1 + hash(k, 34) * 0.04, 0.5 + hash(k, 35) * 0.2, 0.36 + hash(k, 36) * 0.2)); return true;
      } });
      const tuft = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, side: THREE.DoubleSide }); tuft.positionNode = swayNode(0.05);
      tuft.colorNode = vec3(1).mul(mix(float(0.65), float(1.15), attribute('sway', 'float')));
      place(tuftGeo(), tuft, tm, tc, false);
      const bg = lump(new THREE.IcosahedronGeometry(1, 1), 0.55, 4), bm: THREE.Matrix4[] = [], bc: THREE.Color[] = [], bcap = Math.round(500 * q.detail);
      scatter(t, b, lim, { cap: bcap, farCap: bcap, stride: 2, per: 2, gap: 6, mean: 50, accept: (x, z, k) => {
        const mw = moraineZ(z), h = gh(x, z); if (hash(k, 41) > mw * 0.35 + 0.01 || W.roadDist(x, z) < lim + 4 || h < WATER + 4) return false;
        const sc = 0.5 + Math.pow(hash(k, 42), 2.2) * 3.2; bm.push(M(x, h + sc * 0.1, z, hash(k, 43) * 6.28, sc * 1.3, sc * 0.85, sc)); const g = 0.1 + hash(k, 44) * 0.1; bc.push(new THREE.Color(g * 1.1, g, g * 0.9)); return true;
      } });
      place(bg, std(0xffffff, 0.9), bm, bc);
    }

    // ---------- guanaco herds: static, never closer than lim + 12 m to the road ----------
    {
      const up: THREE.Matrix4[] = [], dn: THREE.Matrix4[] = [], mk = () => { return vcol(0.9); };
      const herds: [number, number, number][] = [[430, 1, 7], [760, -1, 5], [1050, 1, 10], [1540, -1, 6], [1760, 1, 8], [2080, -1, 6], [2330, 1, 4], [3520, 1, 3], [4620, -1, 4], [5500, 1, 7], [5780, -1, 5], [6140, 1, 9], [6420, -1, 6], [6800, 1, 5], [640, 1, 3]];
      herds.forEach(([s, side, n], hi) => {
        const cl = lim + 18 + hash(hi, 3) * 90, c = pathAt(t, s, side * cl), heading = hash(hi, 4) * 6.28, graze = hash(hi, 5) > 0.35;
        for (let i = 0; i < n; i++) {
          const a = hash(hi * 40 + i, 6) * 6.28, r = Math.sqrt(hash(hi * 40 + i, 7)) * (5 + n), x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r, h = gh(x, z);
          if (W.roadDist(x, z) < lim + 12 || h < WATER + 4 || lakeR(x, z) < 1.25 || Math.abs(gh(x + 2, z) - h) + Math.abs(gh(x, z + 2) - h) > 1.6) continue;
          const sc = 0.88 + hash(hi * 40 + i, 8) * 0.28, yaw = heading + (hash(hi * 40 + i, 9) - 0.5) * 1.3;
          (graze && hash(hi * 40 + i, 10) > 0.25 ? dn : up).push(M(x, h - 0.03, z, yaw, sc));
        }
      });
      if (up.length) place(guanacoGeo(false), mk(), up); if (dn.length) place(guanacoGeo(true), mk(), dn);
    }

    // ---------- merged static props, grouped by material ----------
    const bag: Record<string, THREE.BufferGeometry[]> = { wood: [], white: [], roofRed: [], metal: [], stone: [], plank: [] };
    const addG = (key: string, g: THREE.BufferGeometry, m: THREE.Matrix4) => { const c = bare(g); c.applyMatrix4(m); bag[key].push(c); };
    const BOX = new THREE.BoxGeometry(1, 1, 1);
    /** a box from min-corner-free centre/size; `A` is the anchor frame matrix */
    const box = (key: string, A: THREE.Matrix4, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, ry = 0) => addG(key, BOX, A.clone().multiply(M(lx, ly, lz, ry, sx, sy, sz)));
    const cyl = (key: string, A: THREE.Matrix4, lx: number, ly: number, lz: number, r: number, h: number, seg = 8) => addG(key, new THREE.CylinderGeometry(r, r, h, seg), A.clone().multiply(M(lx, ly, lz, 0, 1)));
    const gable = (len: number, wid: number, wallH: number, rh: number, ov: number) => {
      const L = len / 2 + ov, Wd = wid / 2 + ov, y0 = wallH - 0.15, y1 = wallH + rh, e = [[-L, y0, -Wd], [L, y0, -Wd], [L, y0, Wd], [-L, y0, Wd]], r = [[-L, y1, 0], [L, y1, 0]];
      const v = [e[0], r[0], r[1], e[0], r[1], e[1], e[3], e[2], r[1], e[3], r[1], r[0], e[0], e[3], r[0], e[1], r[1], e[2]].flat();
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g;
    };
    const anchor = (x: number, y: number, z: number, yaw: number) => M(x, y, z, yaw, 1);

    // estancia: casco, shed, corral, tank, windbreak, windmill
    {
      const gy = padH, A = anchor(EP.x, gy, EP.z, EYAW), roadSide = 1; void roadSide;
      box('stone', A, 0, -0.5, 0, 17, 1.4, 9.5); box('stone', A, 20, -0.5, 6, 20, 1.2, 11);
      box('white', A, 0, 1.7, 0, 15, 3.2, 7.6); addG('roofRed', gable(15, 7.6, 3.2, 2.5, 0.7), A);
      box('wood', A, 0, 1.4, 3.85, 15.6, 0.22, 1.6); for (let i = 0; i < 6; i++) box('wood', A, -6.2 + i * 2.5, 1.1, 4.5, 0.18, 2.2, 0.18);
      box('wood', A, -3, 1.2, -3.84, 1.1, 2.1, 0.1); box('wood', A, 3.5, 1.2, 3.84, 1.1, 2.1, 0.1); box('stone', A, 5.5, 4.2, -1.5, 1, 3.4, 1);
      box('white', A, 20, 2.2, 6, 17, 3.9, 8.6); addG('metal', gable(17, 8.6, 3.9, 2, 0.5), A.clone().multiply(M(20, 0, 6, 0, 1)));
      box('wood', A, 20, 1.6, 10.35, 5, 3.0, 0.15);
      for (let i = -1; i <= 1; i += 2) box('wood', A, 20 + i * 1.3, 1.6, 10.45, 0.12, 3.1, 0.12);
      cyl('metal', A, 8, 2.1, -10, 2.1, 3.6, 12); cyl('metal', A, 8, 4.3, -10, 2.2, 0.3, 12);
      // corral: posts and three rails along a rectangle
      const cx0 = -6, cx1 = 12, cz0 = -26, cz1 = -10;
      const seg = (x0: number, z0: number, x1: number, z1: number) => { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 2.6)); for (let i = 0; i <= n; i++) box('wood', A, x0 + (x1 - x0) * i / n, 0.65, z0 + (z1 - z0) * i / n, 0.18, 1.3, 0.18); const ang = Math.atan2(-(z1 - z0), x1 - x0), len = Math.hypot(x1 - x0, z1 - z0); for (const hy of [0.45, 0.85, 1.2]) box('wood', A, (x0 + x1) / 2, hy, (z0 + z1) / 2, len, 0.09, 0.05, ang); };
      seg(cx0, cz0, cx1, cz0); seg(cx1, cz0, cx1, cz1); seg(cx1, cz1, cx0, cz1); seg(cx0, cz1, cx0, cz0);
      // windbreak of golden poplars, instanced from the lite tree
      const pm: THREE.Matrix4[] = [], pc: THREE.Color[] = [], poplar = coniferGeo({ lite: true });
      for (let i = 0; i < 9; i++) { const lx = -10 + i * 3.4, lz = 11 + hash(i, 5), w = new THREE.Vector3(lx, 0, lz).applyMatrix4(A), hh = gh(w.x, w.z); pm.push(M(w.x, hh - 0.3, w.z, hash(i, 8) * 6, 0.42, 0.5 + hash(i, 6) * 0.15, 0.42)); pc.push(new THREE.Color(0.9, 0.5 + hash(i, 7) * 0.25, 0.06)); }
      const pop = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 }); place(poplar.crown, pop, pm, pc); place(poplar.trunk, std(0x4a3d34, 0.9), pm);
      // windmill: lattice tower and tail are static, the wheel turns from the shader clock and faces the wind
      const wv = new THREE.Vector3(-14, 0, -8).applyMatrix4(A), wx = wv.x, wz = wv.z, wy = gh(wx, wz), hubY = 12.4, face = Math.atan2(-WX, -WZ);
      const W0 = anchor(wx, wy - 0.3, wz, 0), legs: THREE.BufferGeometry[] = [];
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const a = new THREE.Vector3(sx * 1.7, 0, sz * 1.7), c = new THREE.Vector3(sx * 0.45, hubY - 0.6, sz * 0.45), d = c.clone().sub(a), len = d.length();
        const g = new THREE.CylinderGeometry(0.07, 0.09, len, 4); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())); g.translate((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2); legs.push(bare(g));
      }
      for (let k = 1; k <= 5; k++) { const y = k * 2.1, hw2 = 1.7 - (1.25 * y) / (hubY - 0.6); for (const [x0, z0, x1, z1] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) { const g = new THREE.BoxGeometry(Math.hypot(x1 - x0, z1 - z0) * hw2, 0.07, 0.07); g.rotateY(Math.atan2(-(z1 - z0), x1 - x0)); g.translate((x0 + x1) / 2 * hw2, y, (z0 + z1) / 2 * hw2); legs.push(bare(g)); } }
      const head = new THREE.Group(); head.position.set(wx, wy - 0.3, wz); head.rotation.y = face;
      const hs: THREE.BufferGeometry[] = legs.concat([bare(new THREE.BoxGeometry(0.5, 0.5, 1.4).translate(0, hubY, -0.2)), bare(new THREE.BoxGeometry(0.06, 0.08, 4.2).translate(0, hubY, -2.9)), bare(new THREE.BoxGeometry(0.05, 1.5, 1.6).translate(0, hubY, -4.8))]);
      const steel = std(0x8d9296, 0.55, 0.6), tw = new THREE.Mesh(mergeGeometries(hs.slice(0, legs.length))!, steel); tw.position.copy(head.position); tw.castShadow = true; group.add(tw);
      const vane = new THREE.Mesh(mergeGeometries(hs.slice(legs.length))!, std(0xb4b8bc, 0.5, 0.5)); vane.position.copy(head.position); vane.rotation.y = face; vane.castShadow = true; group.add(vane);
      const bl: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 18; k++) { const g = new THREE.BoxGeometry(0.28, 1.9, 0.03); g.translate(0, 1.9, 0); g.rotateZ((k / 18) * Math.PI * 2); g.rotateY(0); const n = bare(g); n.rotateZ(0); bl.push(n); }
      const ring = new THREE.TorusGeometry(2.0, 0.05, 4, 24); bl.push(bare(ring)); const hubG = new THREE.CylinderGeometry(0.22, 0.22, 0.4, 8); hubG.rotateX(Math.PI / 2); bl.push(bare(hubG));
      const wheel = new THREE.Mesh(mergeGeometries(bl)!, std(0xcfd2d4, 0.5, 0.4));
      const th = time.mul(1.0 + WL * 0.18); (wheel.material as THREE.MeshStandardNodeMaterial).positionNode = vec3(positionLocal.x.mul(cos(th)).sub(positionLocal.y.mul(sin(th))), positionLocal.x.mul(sin(th)).add(positionLocal.y.mul(cos(th))), positionLocal.z);
      wheel.position.set(wx, wy - 0.3 + hubY, wz); wheel.position.x += Math.sin(face) * 0.9; wheel.position.z += Math.cos(face) * 0.9; wheel.rotation.y = face; wheel.castShadow = true; wheel.frustumCulled = false; group.add(wheel);
      void W0;
    }

    // ---------- road signs: one atlas for the RUTA 40 panels and the kilometre posts ----------
    {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d')!;
      g.fillStyle = '#0b4a90'; g.fillRect(0, 0, 1024, 256); g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(12, 12, 1000, 232);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 150px sans-serif'; g.fillText('RUTA 40', 512, 112); g.font = '600 44px sans-serif'; g.fillText('EL FIN DEL MUNDO', 512, 205);
      for (let k = 0; k < 16; k++) { const x = (k % 8) * 128, y = 256 + Math.floor(k / 8) * 128; g.fillStyle = '#f2f2ee'; g.fillRect(x, y, 128, 128); g.fillStyle = '#c0261f'; g.fillRect(x, y, 128, 30); g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.fillText('KM', x + 64, y + 16); g.fillStyle = '#222'; g.font = 'bold 54px sans-serif'; g.fillText(String(((k + 1) * 0.5).toFixed(1)).replace('.', ','), x + 64, y + 80); }
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
      const faces: THREE.BufferGeometry[] = [], postM: THREE.Matrix4[] = [];
      const face = (w: number, h: number, u0: number, v0: number, u1: number, v1: number, m: THREE.Matrix4) => { const p = new THREE.PlaneGeometry(w, h), uvs = p.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setXY(i, u0 + uvs.getX(i) * (u1 - u0), v0 + uvs.getY(i) * (v1 - v0)); p.applyMatrix4(m); faces.push(p); };
      for (let k = 0, s = 380; s < t.len - 200; s += 780, k++) {
        const side = k % 2 ? 1 : -1, p = frame(s, side * (lim + 2.8)), gy = gh(p.x, p.z), yw = Math.atan2(-p.tx, -p.tz);
        for (const o of [-1.35, 1.35]) { const lx = p.x - p.tz * o, lz = p.z + p.tx * o, hy = Math.max(p.y, gy); postM.push(M(lx, gy - 0.4, lz, p.yaw, 1, 1, 1).multiply(new THREE.Matrix4().makeScale(0.12, 3.7 + (hy - gy), 0.12)).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0))); }
        face(3.2, 0.8, 0, 0.5, 1, 1, M(p.x, gy + 3.1, p.z, yw, 1)); // faces the traffic
      }
      for (let k = 1; k * 500 < t.len - 100 && k <= 14; k++) {
        const s = k * 500, side = k % 2 ? 1 : -1, p = frame(s, side * (lim + 1.6)), gy = gh(p.x, p.z), yw = Math.atan2(-p.tx, -p.tz), col = (k - 1) % 8, row = Math.floor((k - 1) / 8);
        postM.push(M(p.x, gy - 0.2, p.z, p.yaw, 1).multiply(new THREE.Matrix4().makeScale(0.28, 1.25, 0.28)).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)));
        face(0.3, 0.3, col / 8, 0.5 - 0.25 * (row + 1), (col + 1) / 8, 0.5 - 0.25 * row, M(p.x - p.tx * 0.16, gy + 0.85, p.z - p.tz * 0.16, yw, 1));
      }
      const sm = new THREE.Mesh(mergeGeometries(faces)!, new THREE.MeshStandardNodeMaterial({ map: tx, roughness: 0.55, side: THREE.DoubleSide })); sm.castShadow = true; group.add(sm);
      place(BOX.clone().translate(0, 0, 0), std(0xd8d6cc, 0.8), postM);
    }

    // ---------- the timber bridge ----------
    {
      const deck = deckBridge(W, br), path = deck.path, rail = (u0: number, u1: number, v0: number, v1: number) => sweep(path, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      const geos: THREE.BufferGeometry[] = [deck.geos[0]];
      for (const sd of [-1, 1]) { const a = sd * (lim + 0.28), c = sd * (lim + 0.52); geos.push(rail(Math.min(a, c), Math.max(a, c), 0.96, 1.1), rail(Math.min(a, c), Math.max(a, c), 0.5, 0.62), rail(Math.min(a, c), Math.max(a, c), 0.05, 0.18)); }
      for (let s = br.from + 1; s < br.to; s += 2.5) for (const sd of [-1, 1]) { const p = pathAt(t, s, sd * (lim + 0.4)), g = new THREE.BoxGeometry(0.2, 1.2, 0.2); g.rotateY(Math.atan2(-p.tz, p.tx)); g.translate(p.x, p.y + 0.55, p.z); geos.push(bare(g)); }
      for (let s = br.from + 8; s < br.to; s += 14) {
        const p = pathAt(t, s), yw = Math.atan2(-p.tz, p.tx), top = p.y + deck.deckBot;
        const cap = new THREE.BoxGeometry(0.7, 0.6, (lim + 0.5) * 2); cap.rotateY(yw); cap.translate(p.x, top - 0.3, p.z); geos.push(bare(cap));
        for (const sd of [-1, -0.34, 0.34, 1]) { const q2 = pathAt(t, s, sd * (lim - 0.4)), g0 = Math.min(gh(q2.x, q2.z), WATER) - 0.8, hgt = top - g0, g = new THREE.BoxGeometry(0.5, hgt, 0.5); g.rotateY(yw); g.translate(q2.x, g0 + hgt / 2, q2.z); geos.push(bare(g)); }
      }
      const wood = std(0x6b4f36, 0.92); wood.colorNode = vec3(0.5, 0.36, 0.24).mul(mx_noise_float(positionWorld.mul(vec3(0.7, 7, 0.7))).mul(0.4).add(0.85));
      const mesh = new THREE.Mesh(mergeGeometries(geos.map(bare))!, wood); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh);
    }

    // ---------- gantries and the mirador at the finish ----------
    gantry(W, 98, banner('RUTA 40', 'LARGADA', false)); gantry(W, finishS, banner('CHEGADA', '', true));
    {
      const f0 = frame(finishS + 34, lim + 11.5), A = anchor(f0.x, f0.y - 0.15, f0.z, f0.yaw);
      box('plank', A, 0, 0, 0, 24, 0.28, 11); // deck floor
      for (let ix = -11; ix <= 11; ix += 5.5) for (const iz of [-5, 5]) { const w = new THREE.Vector3(ix, 0, iz).applyMatrix4(A), g0 = gh(w.x, w.z) - 0.6, hgt = f0.y - 0.15 - g0; if (hgt > 0.1) addG('wood', BOX, M(w.x, g0 + hgt / 2, w.z, f0.yaw, 0.35, hgt, 0.35)); }
      for (let ix = -12; ix <= 12; ix += 3) { box('wood', A, ix, 0.65, 5.4, 0.16, 1.3, 0.16); box('wood', A, ix, 0.65, -5.4, 0.16, 1.3, 0.16); }
      box('wood', A, 0, 1.25, 5.4, 24.2, 0.12, 0.12); box('wood', A, 0, 0.75, 5.4, 24.2, 0.08, 0.08); box('wood', A, 0, 1.25, -5.4, 24.2, 0.12, 0.12); box('wood', A, 0, 0.75, -5.4, 24.2, 0.08, 0.08);
      box('wood', A, 12, 0.65, 0, 0.16, 1.3, 0.16); box('wood', A, 12.1, 1.25, 0, 0.12, 0.12, 10.8);
      box('white', A, -8.5, 1.7, -2.2, 5, 3.2, 3.8); addG('metal', gable(5, 3.8, 3.2, 1.2, 0.4), A.clone().multiply(M(-8.5, 0, -2.2, 0, 1)));
      // flags on 9 m poles
      const fl = new THREE.Matrix4(); void fl;
      const fc = document.createElement('canvas'); fc.width = 256; fc.height = 256; const fg = fc.getContext('2d')!;
      fg.fillStyle = '#fff'; fg.fillRect(0, 0, 256, 128); fg.fillStyle = '#d52b1e'; fg.fillRect(86, 64, 170, 64); fg.fillStyle = '#0039a6'; fg.fillRect(0, 0, 86, 64);
      fg.fillStyle = '#fff'; fg.font = 'bold 56px sans-serif'; fg.textAlign = 'center'; fg.textBaseline = 'middle'; fg.fillText('★', 43, 34);
      fg.fillStyle = '#74acdf'; fg.fillRect(0, 128, 256, 43); fg.fillRect(0, 213, 256, 43); fg.fillStyle = '#fff'; fg.fillRect(0, 171, 256, 42); fg.fillStyle = '#f6b40e'; fg.beginPath(); fg.arc(128, 192, 14, 0, 6.283); fg.fill();
      const ftx = new THREE.CanvasTexture(fc); ftx.colorSpace = THREE.SRGBColorSpace;
      const flags: THREE.BufferGeometry[] = [];
      [[-4, 0], [-1.5, 1]].forEach(([lx, k]) => {
        box('metal', A, lx, 4.6, -5.6 + 0, 0.1, 9.2, 0.1);
        const pl = new THREE.PlaneGeometry(2.4, 1.5, 6, 1), p = pl.attributes.position, u = pl.attributes.uv, sw = new Float32Array(p.count);
        for (let i = 0; i < p.count; i++) { sw[i] = (p.getX(i) + 1.2) / 2.4; u.setXY(i, u.getX(i), 0.5 - 0.5 * k + u.getY(i) * 0.5); p.setXYZ(i, p.getX(i) + 1.25, p.getY(i), p.getZ(i)); }
        pl.setAttribute('sway', new THREE.BufferAttribute(sw, 1)); pl.applyMatrix4(A.clone().multiply(M(lx, 8.2, -5.6, 0, 1))); flags.push(pl);
      });
      const fm = new THREE.MeshStandardNodeMaterial({ map: ftx, roughness: 0.8, side: THREE.DoubleSide }); fm.positionNode = positionLocal.add(vec3(WX, 0.0, WZ).mul(attribute('sway', 'float').mul(sin(time.mul(5).sub(attribute('sway', 'float').mul(7)))).mul(0.25)));
      const flagMesh = new THREE.Mesh(mergeGeometries(flags)!, fm); flagMesh.frustumCulled = false; group.add(flagMesh);
      // roadside board before the finish
      const bp = frame(finishS - 110, -(lim + 3)), by = bp.y, board = new THREE.Mesh(new THREE.PlaneGeometry(5, 5 * 160 / 1024), banner('TORRES DEL PAINE', 'MIRADOR A 300 M', false));
      board.position.set(bp.x, Math.max(by, gh(bp.x, bp.z)) + 3.2, bp.z); board.rotation.y = Math.atan2(-bp.tx, -bp.tz); board.castShadow = true; group.add(board);
      for (const o of [-2.1, 2.1]) addG('wood', BOX, M(bp.x - bp.tz * o, gh(bp.x, bp.z) + 1.7, bp.z + bp.tx * o, bp.yaw, 0.14, 3.6, 0.14));
    }

    // ---------- finish bag meshes ----------
    const mats: Record<string, THREE.Material> = {
      wood: std(0x5d4633, 0.92), white: std(0xe8e3d5, 0.85), roofRed: std(0x9a3027, 0.6, 0.35), metal: std(0x6f7479, 0.55, 0.5), stone: std(0x8d877c, 0.95),
      plank: (() => { const m = std(0x7a5a3e, 0.9); m.colorNode = vec3(0.55, 0.4, 0.26).mul(mx_noise_float(positionWorld.mul(vec3(0.6, 6, 0.6))).mul(0.35).add(0.88)); return m; })(),
    };
    mats.roofRed.side = THREE.DoubleSide; mats.metal.side = THREE.DoubleSide;
    for (const k of Object.keys(bag)) if (bag[k].length) { const mesh = new THREE.Mesh(mergeGeometries(bag[k])!, mats[k]); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh); }

    // ---------- glacier tongue and icebergs at the lake head ----------
    {
      const NB = 44, NA = 26, pos: number[] = [], col: number[] = [], idx: number[] = [];
      const bbA = 902, bbB = 1260;
      for (let j = 0; j <= NB; j++) for (let i = 0; i <= NA; i++) {
        const v = j / NB, u = (i / NA) * 2 - 1, bbv = bbA + (bbB - bbA) * v, hw = (120 + 90 * sstep(0, 0.5, v)) * (0.9 + 0.2 * fbm(v * 6, 3));
        const [x, z] = lakeXZ(u * hw, bbv), edge = Math.abs(u) > 0.97 ? 1 : 0, bump = (fbm(x / 22, z / 22) - 0.45) * 4 + Math.pow(1 - Math.abs(2 * vnoise(x / 15 + 4, z / 40) - 1), 6) * -2.4;
        let y = gh(x, z) + 2.6 + bump - edge * 3.5; if (j === 0) y = WATER - 3.5;
        pos.push(x, y, z);
        const cr = Math.pow(1 - Math.abs(2 * vnoise(x / 15 + 4, z / 40) - 1), 6), deb = sstep(0.55, 1, Math.abs(u)) * 0.6 + (fbm(x / 9, z / 9) > 0.62 ? 0.35 : 0);
        const w = [0.72, 0.8, 0.88], bl = [0.25, 0.5, 0.7], gr = [0.34, 0.31, 0.29];
        for (let c = 0; c < 3; c++) col.push((w[c] + (bl[c] - w[c]) * cr * 0.85) * (1 - deb) + gr[c] * deb);
      }
      for (let j = 0; j < NB; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, c = a + NA + 1; idx.push(a, c, a + 1, a + 1, c, c + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
      const gm = vcol(0.4); const gl = new THREE.Mesh(g, gm); gl.receiveShadow = true; gl.frustumCulled = false; group.add(gl);
      // icebergs: lumps half under the water, white above, blue just at the waterline
      const bergs: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 11; k++) {
        const sz = 3 + hash(k, 1) * 8, [x, z] = lakeXZ((hash(k, 2) - 0.5) * 360 * (1 - 0.35 * hash(k, 9)), 560 + hash(k, 3) * 330);
        const ico = new THREE.IcosahedronGeometry(1, 1); ico.scale(sz, sz * (0.6 + hash(k, 4) * 0.6), sz * (0.7 + hash(k, 5) * 0.5)); ico.rotateY(hash(k, 6) * 6.28); ico.translate(x, WATER + sz * 0.08, z);
        const lm = lump(ico, 0.55, k * 3); const pp = lm.attributes.position, cc = new Float32Array(pp.count * 3);
        for (let i = 0; i < pp.count; i++) { const hh = pp.getY(i) - WATER, wv = sstep(-0.5, 1.5, hh); const c = [0.3 + 0.4 * wv, 0.55 + 0.27 * wv, 0.7 + 0.2 * wv]; cc.set(c, i * 3); }
        lm.setAttribute('color', new THREE.BufferAttribute(cc, 3)); bergs.push(lm);
      }
      const bmat = vcol(0.3); const bmesh = new THREE.Mesh(mergeGeometries(bergs)!, bmat); bmesh.frustumCulled = false; bmesh.castShadow = true; group.add(bmesh);
    }

    // ---------- backdrop: the three granite towers dead ahead, their massif, and a ring of mountains ----------
    {
      const end = pathAt(t, t.len, 0), tc = { x: end.x + end.tx * (320 + 2500), z: end.z + end.tz * (320 + 2500) }, lx = -end.tz, lz = end.tx, gy = 52;
      const mount = std(0xffffff, 0.95);
      const ny = normalWorld.y, yy = positionWorld.y, nz = mx_noise_float(positionWorld.xz.div(260)), rockc = mix(vec3(0.3, 0.27, 0.24), vec3(0.46, 0.4, 0.33), nz.mul(0.5).add(0.5));
      const snow = smoothstep(560, 800, yy.add(nz.mul(150))).mul(smoothstep(0.3, 0.7, ny)), low = float(1).sub(smoothstep(80, 230, yy));
      const wgm = weatherGround(mix(mix(rockc, vec3(0.34, 0.28, 0.17), low.mul(0.8)), vec3(0.92, 0.95, 1.0), snow), float(0.9), ny); mount.colorNode = wgm.color; mount.roughnessNode = wgm.rough;
      const defs: { x: number; z: number; r: number; h: number; seed: number }[] = [];
      // massif under the towers and its flanking ridge
      defs.push({ ...tc, r: 1700, h: 430, seed: 1 }, { x: tc.x + lx * 1250, z: tc.z + lz * 1250, r: 1100, h: 380, seed: 2 }, { x: tc.x - lx * 1300, z: tc.z - lz * 1300, r: 1100, h: 360, seed: 3 });
      for (let k = 0; k < 9; k++) { const z = 2600 - k * 1150; for (const sd of [-1, 1]) { const n = k * 2 + (sd > 0 ? 1 : 0); defs.push({ x: sd < 0 ? b.x0 - 2500 - hash(n, 1) * 700 : b.x1 + 1500 + hash(n, 2) * 700, z: z + (hash(n, 3) - 0.5) * 500, r: 1300 + hash(n, 4) * 300, h: 700 + hash(n, 5) * 450, seed: 10 + n }); } }
      const [bx, bz] = lakeXZ(0, 3100); defs.push({ x: bx, z: bz, r: 1500, h: 1100, seed: 40 }); const [bx2, bz2] = lakeXZ(-1000, 3600); defs.push({ x: bx2, z: bz2, r: 1500, h: 950, seed: 41 });
      peaks(W, defs, mount, gy);
      const tm = vcol(0.9);
      const towers: THREE.BufferGeometry[] = [];
      [[-1, 760, 76, -420, 40], [2, 880, 84, 20, 200], [3, 700, 68, 430, 90]].forEach(([sd, H, R0, lo, ao]) => {
        const g = towerGeo(H, R0, sd); g.translate(tc.x + lx * lo + end.tx * ao, gy + 160, tc.z + lz * lo + end.tz * ao); towers.push(g);
      });
      const tw = new THREE.Mesh(mergeGeometries(towers)!, tm); tw.frustumCulled = false; group.add(tw);
    }
  }

  const water: WaterDef[] = (() => {
    const cs = [[-LAKE.hwMax * 1.15, LAKE.bb0 - 30], [LAKE.hwMax * 1.15, LAKE.bb0 - 30], [LAKE.hwMax * 1.15, LAKE.bb1 + 40], [-LAKE.hwMax * 1.15, LAKE.bb1 + 40]].map(([a, bb]) => lakeXZ(a, bb));
    return [{ y: WATER, x0: Math.min(...cs.map((c) => c[0])), x1: Math.max(...cs.map((c) => c[0])), z0: Math.min(...cs.map((c) => c[1])), z1: Math.max(...cs.map((c) => c[1])), color: [0.07, 0.2, 0.24] as [number, number, number], rough: 0.06 }];
  })();
  const def: WorldDef = {
    id: 'patagonia', x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, cell: 8, natural, hdr: 'kloofendal_48d_partly_cloudy_puresky_2k.hdr', water,
    sunDir: [-0.45, 0.32, 0.62], sunColor: 0xffe6c0, fog: [0.7, 0.75, 0.82], fogNear: 300, fogFar: 12000, seaColor: [0.07, 0.2, 0.24], wind: WIND,
    terrainMaterial, roadMaterial, barrier: 'fence', bridge: br, cutBlend: 24, cutEdge: 3, props,
  };
  return new World(eng, track, def);
}
