import * as THREE from 'three/webgpu';
import { triplanarTexture, texture, uv, mix, vec2, vec3, vec4, float, positionWorld, normalWorld, positionLocal, smoothstep, abs, step, fract, floor, max, normalMap, mx_noise_float, transformNormalToView } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FINISH_BEFORE_END, ROCKIES_BRIDGE, ROCKIES_GALLERY, ROCKIES_OVERPASS, pointAt, type Track } from '../../../sim/src/index';
import type { Engine } from '../gfx/engine';
import { snowU, snowRoad, weatherGround, wetRoad } from './weather';
import { World, fbm, hash, M, set, sstep, std, tex, vnoise, type WorldDef } from './base';
import { routeBounds, roadField, sweep, pathAt as pathAtT, sRange, banner, gantry, deckBridge, coniferGeo, scatter, peaks } from './route';

/** Ridged noise 0..1: sharp crests and gullies. */
const ridge = (x: number, y: number) => {
  const r1 = Math.pow(1 - Math.abs(2 * vnoise(x, y) - 1), 1.7), r2 = Math.pow(1 - Math.abs(2 * vnoise(x * 2.3 + 5, y * 2.3 + 9) - 1), 1.7), r3 = 1 - Math.abs(2 * vnoise(x * 5.1 + 2, y * 5.1 + 7) - 1);
  return Math.min(1, r1 * 0.68 + r1 * r2 * 0.4 + r2 * r3 * 0.08);
};
/** Position + normal only box (so it can be merged with sweeps). */
const boxG = (w: number, h: number, d: number, m: THREE.Matrix4) => { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.deleteAttribute('uv'); g.applyMatrix4(m); return g; };

/** Icefields Parkway: a lake shore, forest and wildlife overpass, an avalanche gallery, hairpins up a mountainside, a gorge bridge and a snowy pass with a lodge. */
export function makeRockies(eng: Engine, track: Track): World {
  const t = track, b = routeBounds(t, { x0: 700, x1: 700, z0: 700, z1: 700 }), field = roadField(t, b, { endSide: 0 }), lim = t.def.halfWidth + t.def.shoulder, len = t.len, finishS = len - FINISH_BEFORE_END;
  const br = ROCKIES_BRIDGE, ga = ROCKIES_GALLERY, ov = ROCKIES_OVERPASS, LAKE = 30;
  const pathAt = (s: number, lat = 0, dy = 0) => pathAtT(t, s, lat, dy);
  /** road-surface point at arc length s and lateral offset lat (height follows the banked road, clamped to the paved width) */
  const at = (s: number, lat: number) => { const [x, , z] = pointAt(t, s, lat), y = pointAt(t, s, Math.max(-lim, Math.min(lim, lat)))[1]; return { x, y, z }; };
  // gorge under the bridge (local frame: a along the road, bb lateral, + = right/uphill)
  const [mx, my, mz, myaw] = pointAt(t, (br.from + br.to) / 2, 0), Dx = Math.cos(myaw), Dz = Math.sin(myaw);
  // finish lodge: right of the road past the finish line, on a levelled pad
  const LS = len - 150, [lx0, ly0, lz0, lyaw] = pointAt(t, LS, 0), LAT = 36, lx = lx0 - Math.sin(lyaw) * LAT, lz = lz0 + Math.cos(lyaw) * LAT, padY = ly0 - 0.7;

  function natural(x: number, z: number) {
    const [d, ry, side] = field(x, z), su = sstep(-0.3, 0.3, side), rid = ridge(x / 560 + 3, z / 560), rid2 = ridge(x / 700 + 40, z / 700 + 11);
    const det = (fbm(x / 38, z / 38) - 0.45) * 7 * sstep(14, 90, d) + (fbm(x / 13, z / 13) - 0.45) * 2.4 * sstep(10, 60, d);
    // uphill (right): rises to ridged peaks
    const hu = ry - 0.9 + (d - 8) * 0.05 + sstep(10, 640, d) * (150 + 380 * rid) + det * (1 + 2 * sstep(150, 500, d));
    // downhill (left): falls to the valley floor, which rises to far ridges again; the lake fills the basin along the first km
    const lakeW = (1 - sstep(56, 66, ry)) * (1 - su) * (1 - sstep(470, 640, d)), vf = 33.5 + 7 * fbm(x / 260, z / 260);
    let hd = vf + (ry - 0.9 - vf) * (1 - sstep(10, 440, d)) + det * sstep(30, 300, d);
    const sh = 52 + 46 * fbm(x / 70, z / 70), lakeB = LAKE - 4 - 10 * sstep(70, 300, d);
    const hl = lakeB + (ry - 0.9 - lakeB) * (1 - sstep(8, sh, d)) + det * 0.5 + sstep(280, 580, d) * (90 + 260 * rid2);
    hd = hd + (hl - hd) * lakeW; hd += (1 - lakeW) * sstep(420, 900, d) * (30 + 420 * rid2);
    let h = hd + (hu - hd) * su;
    // lodge pad
    h += (padY - h) * (1 - sstep(26, 56, Math.hypot(x - lx, z - lz)));
    // gorge crossing the road under the bridge
    const a = (x - mx) * Dx + (z - mz) * Dz, bb = -(x - mx) * Dz + (z - mz) * Dx, aw = Math.abs(a) + (fbm(x / 50 + 20, z / 50) - 0.5) * 34 * sstep(0, 40, Math.abs(a));
    if (Math.abs(a) < 112 && bb > -520 && bb < 520) {
      const fl = my - 92 + (bb > 0 ? bb * 0.3 : bb * 0.1) + (fbm(x / 30, z / 30) - 0.5) * 6;
      const vh = fl + 120 * Math.pow(sstep(8, 104, Math.max(0, Math.min(Math.abs(a) + 10, aw))), 1.05) + (fbm(x / 11, z / 11) - 0.5) * 8 * sstep(15, 60, Math.abs(a));
      h += (Math.min(h, vh) - h) * (1 - sstep(380, 520, Math.abs(bb)));
    }
    return h;
  }

  function terrainMaterial() {
    const m = new THREE.MeshStandardNodeMaterial(), fo = set('forrest_ground_01'), rk = set('rock_face_03');
    const meadowT = tex('aerial_grass_rock_diffuse.jpg', true), screeT = tex('aerial_rocks_02_diffuse.jpg', true), snowT = tex('snow_02_diffuse.jpg', true), gravT = tex('gravel_ground_01_diffuse.jpg', true);
    const p = positionWorld.xz, y = positionWorld.y, ny = normalWorld.y;
    const yy = y.add(mx_noise_float(p.div(150)).mul(40)), macro = mx_noise_float(p.div(120)).mul(0.12).add(0.95);
    const fw = float(1).sub(smoothstep(100, 160, yy)), sw = smoothstep(185, 235, yy), mw = float(1).sub(fw).sub(sw).max(0);
    const forest = mix(texture(fo.map, p.div(9)).rgb, texture(fo.map, p.div(57)).rgb, 0.5).mul(vec3(0.62, 0.74, 0.5));
    const two = (tt: THREE.Texture, a: number, bq: number) => mix(texture(tt, p.div(a)).rgb, texture(tt, p.div(bq).add(vec2(0.37, 0.61))).rgb, 0.5);
    const meadow = two(meadowT, 10, 61).mul(vec3(0.74, 0.95, 0.55)), scree = two(screeT, 8, 47).mul(vec3(0.95, 0.95, 1)), grav = texture(gravT, p.div(5)).rgb.mul(vec3(0.95, 0.92, 0.85));
    const rk0 = triplanarTexture(texture(rk.map), null, null, float(1 / 28)).rgb, rockc = mix(vec3(rk0.r.mul(0.3).add(rk0.g.mul(0.59)).add(rk0.b.mul(0.11))), rk0, 0.35).mul(vec3(0.62, 0.66, 0.74)).mul(mx_noise_float(vec3(p.div(11), y.div(30))).mul(0.25).add(0.85));
    const snowc = texture(snowT, p.div(7)).rgb.mul(vec3(1.3, 1.34, 1.42)).min(1);
    const rockW = max(smoothstep(0.8, 0.62, ny), smoothstep(0.92, 0.78, ny).mul(sw)), snowW = smoothstep(240, 275, y.add(mx_noise_float(p.div(45)).mul(26))).mul(smoothstep(0.55, 0.8, ny));
    const shoreW = smoothstep(33.2, 31.4, y).mul(float(1).sub(rockW.mul(0.6)));
    let col = mix(forest.mul(fw).add(meadow.mul(mw)).add(scree.mul(sw)), rockc, rockW);
    col = mix(mix(col.mul(macro), grav, shoreW), snowc, snowW);
    const rough = mix(mix(texture(fo.rough, p.div(9)).r, texture(rk.rough, p.div(26)).r, rockW), float(0.62), snowW);
    const wg = weatherGround(col, rough, ny);
    m.colorNode = wg.color; m.roughnessNode = wg.rough; m.emissiveNode = wg.color.mul(vec3(0.05, 0.062, 0.09).add(vec3(0.12, 0.15, 0.22).mul(float(1).sub(ny).clamp(0, 1)))); // cool sky fill: faces turned from the sun would otherwise go black
    // the terrain has no uv attribute, so a tangent-space normalMap degenerates (black faces on steep slopes): perturb the geometric normal in world space instead
    const nm = mix(mix(texture(fo.nor, p.div(9)), texture(rk.nor, p.div(26)), rockW), vec4(0.5, 0.5, 1, 1), snowW.mul(0.7)).xyz.mul(2).sub(1);
    m.normalNode = transformNormalToView(normalWorld.add(vec3(nm.x, 0, nm.y).mul(smoothstep(0.45, 0.9, ny).mul(0.7))).normalize());
    return m;
  }

  function roadMaterial(w: World) {
    const hw = w.track.def.halfWidth, asph = set('asphalt_04'), gravT = tex('gravel_ground_01_diffuse.jpg', true), foT = tex('forrest_ground_01_diffuse.jpg', true);
    const m = new THREE.MeshStandardNodeMaterial(), l = uv().x, s = uv().y, al = abs(l), auv = vec2(l, s).div(7);
    const onRoad = float(1).sub(smoothstep(hw - 0.02, hw + 0.02, al)), edge = smoothstep(0.1, 0.08, abs(al.sub(hw - 0.4))), yel = smoothstep(0.075, 0.055, abs(al.sub(0.2)));
    const chq = (s0: number, dd: number) => step(s0, s).mul(step(s, dd + s0)).mul(step(0.5, fract(floor(s.sub(s0).div(0.7)).add(floor(l.div(0.7))).mul(0.5))));
    const white = max(max(edge, step(abs(s.sub(98)), 0.22)), chq(finishS, 2.1)).mul(onRoad);
    const keep = max(white, yel.mul(onRoad)), worn = smoothstep(5.0, 1.2, abs(l)).mul(0.14);
    const base = texture(asph.map, auv).rgb.mul(0.66).mul(float(1).sub(worn)).mul(vec3(0.97, 0.98, 1.02));
    const shoulder = smoothstep(hw + 0.1, hw + 0.3, al).mul(float(1).sub(smoothstep(lim - 0.2, lim + 1.2, al)));
    const alpine = smoothstep(232, 270, positionWorld.y).mul(0.92); // permanent snow beside the road on the pass
    const verge = mix(mix(texture(foT, vec2(l, s).div(6)).rgb.mul(vec3(0.62, 0.74, 0.5)), texture(gravT, vec2(l, s).div(3)).rgb.mul(0.85), shoulder), vec3(0.9, 0.93, 0.98), alpine.mul(float(1).sub(shoulder.mul(0.55))));
    const gv = weatherGround(verge, float(0.95), float(1), float(1).sub(onRoad));
    const wr = wetRoad(mix(mix(base, vec3(0.82), white), vec3(0.9, 0.66, 0.08), yel.mul(onRoad)), texture(asph.rough, auv).r.mul(0.75).sub(worn.mul(0.4)), onRoad, keep, l, s);
    const sr = snowRoad(wr.color, wr.rough, onRoad, keep, l, s, hw);
    m.colorNode = mix(gv.color, sr.color, onRoad); m.roughnessNode = mix(gv.rough, sr.rough, onRoad);
    m.normalNode = normalMap(mix(mix(vec4(0.5, 0.5, 1, 1), texture(asph.nor, auv), onRoad), vec4(0.5, 0.5, 1, 1), max(wr.flat, sr.cover.mul(0.85)).min(1)));
    return m;
  }

  /** A sign canvas: yellow diamond with a black elk. */
  function elkSign() {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
    g.translate(128, 128); g.rotate(Math.PI / 4); g.fillStyle = '#e9c40c'; g.beginPath(); g.roundRect(-84, -84, 168, 168, 14); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 7; g.stroke(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#111'; g.strokeStyle = '#111'; g.lineCap = 'round';
    g.beginPath(); g.ellipse(124, 140, 40, 20, 0, 0, 7); g.fill(); // body
    g.beginPath(); g.moveTo(150, 130); g.lineTo(168, 96); g.lineTo(186, 100); g.lineTo(190, 116); g.lineTo(170, 126); g.fill(); // neck + head
    g.lineWidth = 7; for (const x of [96, 110, 138, 152]) { g.beginPath(); g.moveTo(x, 150); g.lineTo(x - 2, 188); g.stroke(); }
    g.lineWidth = 5; g.beginPath(); g.moveTo(176, 98); g.lineTo(168, 70); g.lineTo(150, 56); g.moveTo(168, 70); g.lineTo(184, 58); g.moveTo(176, 96); g.lineTo(196, 78); g.lineTo(206, 58); g.moveTo(196, 78); g.lineTo(212, 74); g.stroke(); // antlers
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
    return new THREE.MeshStandardNodeMaterial({ map: tx, roughness: 0.45, alphaTest: 0.5, side: THREE.DoubleSide, transparent: false });
  }

  function props(W: World) {
    const q = W.eng.quality, group = W.group, place = W.place.bind(W);
    // snow settles on upward faces of structures when it snows
    const snowTop = (mat: THREE.MeshStandardNodeMaterial, col: any) => { mat.colorNode = mix(col, vec3(0.88, 0.92, 0.97), snowU.mul(smoothstep(0.55, 0.9, normalWorld.y)).mul(0.9)); return mat; };
    const conc = set('concrete_wall_008'), concCol = triplanarTexture(texture(conc.map), null, null, float(1 / 5)).rgb.mul(vec3(0.95, 0.96, 1.0));
    const concrete = snowTop(new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.88 }), concCol);
    concrete.emissiveNode = concCol.mul(0.16); // the sky light barely reaches under roofs: a flat base so tunnels read as grey, not black

    // ---------- spruce forest: full crowns near the road, light crowns (no shadows) farther out ----------
    {
      const near = coniferGeo(), far = coniferGeo({ lite: true });
      const nm: THREE.Matrix4[] = [], nc: THREE.Color[] = [], fm: THREE.Matrix4[] = [], fc: THREE.Color[] = [];
      const treeline = (h: number) => 1 - sstep(168, 220, h);
      const tryTree = (x: number, z: number, seed: number, p: number, full: boolean) => {
        const h = W.heightAt(x, z); if (h < 34 || h > 225) return false;
        const rd = W.roadDist(x, z); if (full ? !(rd < 105 && rd > lim + 4.5) : rd < 95) return false;
        const sl = Math.abs(W.heightAt(x + 4, z) - h) + Math.abs(W.heightAt(x, z + 4) - h); if (sl > (full ? 6.5 : 8)) return false;
        const clear = vnoise(x / 170 + 8, z / 170 + 2); if (hash(seed, 77) > p * treeline(h) * (0.25 + 1.1 * sstep(0.2, 0.55, clear))) return false;
        const sc = (full ? 0.66 : 0.9) * (0.8 + hash(seed, 5) * 0.9) * (1 - 0.35 * sstep(130, 215, h)), tall = 0.95 + hash(seed, 6) * 0.8;
        const col = new THREE.Color().setHSL(0.33 + hash(seed, 3) * 0.06, 0.32, 0.04 + hash(seed, 8) * 0.045);
        if (full) { nm.push(M(x, h - 0.4, z, hash(seed, 9) * 6.28, sc * 0.8, sc * tall, sc * 0.8)); nc.push(col); } else { fm.push(M(x, h - 2.2 * sc, z, hash(seed, 9) * 6.28, sc * 0.8, sc * tall, sc * 0.8)); fc.push(col); }
        return true;
      };
      { // spruces on top of the overpass
        const c0 = pathAt((ov.from + ov.to) / 2), sl = (pathAt(ov.to).y - pathAt(ov.from).y) / (ov.to - ov.from);
        for (let k = 0; k < 26; k++) {
          const a = (hash(k, 301) - 0.5) * 44, bq = (hash(k, 302) - 0.5) * 28, x = c0.x + a * c0.tx - bq * c0.tz, z = c0.z + a * c0.tz + bq * c0.tx, sc = 0.45 + hash(k, 303) * 0.35;
          nm.push(M(x, c0.y + sl * a + 8.7 - 0.3, z, hash(k, 304) * 6.28, sc * 0.62, sc * (0.95 + hash(k, 305) * 0.6), sc * 0.62)); nc.push(new THREE.Color().setHSL(0.33 + hash(k, 306) * 0.05, 0.32, 0.045 + hash(k, 307) * 0.04));
        }
      }
      const capN = Math.round(3000 * q.detail), capF = Math.round(5600 * q.detail);
      scatter(t, b, lim, { cap: capN, stride: 2, per: 6, gap: 4.5, mean: 40, accept: (x, z, k) => tryTree(x, z, k, 0.72, true) });
      scatter(t, b, lim, { cap: capF, stride: 3, per: 8, gap: 92, mean: 340, accept: (x, z, k) => tryTree(x, z, k + 500000, 1.4, false) });
      const foliage = std(0xffffff, 0.85);
      const lh = positionLocal.y.div(14).clamp(0, 1);
      foliage.colorNode = vec3(1).mul(mx_noise_float(positionWorld.mul(2.2)).mul(0.35).add(1.0)).mul(mix(float(0.55), float(1.15), lh));
      // snow-dusted tips above the treeline and snow on the boughs when it snows
      foliage.emissiveNode = vec3(0.42, 0.46, 0.52).mul(smoothstep(165, 215, positionWorld.y).mul(0.65).add(snowU.mul(0.9)).min(1).mul(smoothstep(0.1, 0.7, normalWorld.y)).mul(smoothstep(0.15, 0.6, lh)));
      place(near.crown, foliage, nm, nc); place(near.trunk, std(0x3d2d22, 0.9), nm); place(far.crown, foliage, fm, fc, false);
      (W as any).stats = { trees: nm.length, lite: fm.length, treeTris: nm.length * ((near.crown.index ? near.crown.index.count : near.crown.attributes.position.count) + (near.trunk.index?.count ?? 0)) / 3 + fm.length * (far.crown.index ? far.crown.index.count : far.crown.attributes.position.count) / 3 };
    }

    // ---------- boulders ----------
    {
      const ico = new THREE.IcosahedronGeometry(1, 1), pp = ico.attributes.position; for (let i = 0; i < pp.count; i++) { const k = 0.82 + hash(Math.round(pp.getX(i) * 50), Math.round(pp.getY(i) * 50 + pp.getZ(i) * 70)) * 0.4; pp.setXYZ(i, pp.getX(i) * k, pp.getY(i) * k * 0.8, pp.getZ(i) * k); }
      ico.computeVertexNormals();
      const ms: THREE.Matrix4[] = [], cs: THREE.Color[] = [], capB = Math.round(1100 * q.detail);
      scatter(t, b, lim, { cap: capB, stride: 3, per: 3, gap: 2.5, mean: 22, accept: (x, z, k) => {
        const h = W.heightAt(x, z); if (h < 33 || W.roadDist(x, z) < lim + 2) return false;
        if (hash(k, 21) > 0.32 + 0.4 * sstep(120, 220, h)) return false;
        const sc = 0.7 + Math.pow(hash(k, 22), 2.2) * 2.8 * (1 + 0.6 * sstep(100, 220, h));
        ms.push(M(x, h + sc * 0.1, z, hash(k, 23) * 6.28, sc * (0.8 + hash(k, 24) * 0.6), sc * (0.6 + hash(k, 25) * 0.6), sc * (0.8 + hash(k, 26) * 0.6)));
        cs.push(new THREE.Color().setHSL(0.6, 0.06, 0.28 + hash(k, 27) * 0.18)); return true;
      } });
      const rk = set('rock_face_03'), bm = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
      bm.colorNode = snowTop(bm, triplanarTexture(texture(rk.map), null, null, float(1 / 6), positionWorld, normalWorld).rgb.mul(0.85)).colorNode;
      place(ico, bm, ms, cs);
    }

    // ---------- orange snow poles and elk warning signs ----------
    {
      const skip = (s: number) => (s > ov.from - 6 && s < ov.to + 6) || (s > ga.from - 6 && s < ga.to + 6) || (s > br.from - 8 && s < br.to + 8);
      const pole = new THREE.CylinderGeometry(0.035, 0.045, 2.2, 5).translate(0, 1.1, 0), pm: THREE.Matrix4[] = [];
      for (let s = 20; s < len - 10; s += 24) { if (skip(s)) continue; for (const sd of [-1, 1]) { const p = at(s, sd * (lim + 1.2)); pm.push(M(p.x, p.y - 0.25, p.z, 0, 1)); } }
      const pmat = std(0xff6a00, 0.55); pmat.emissiveNode = vec3(0.35, 0.1, 0).mul(step(0.78, positionLocal.y.div(2.2)));
      place(pole, pmat, pm, undefined, false);
      const post = new THREE.CylinderGeometry(0.045, 0.05, 3.2, 6).translate(0, 1.6, 0), face = new THREE.PlaneGeometry(1.5, 1.5), sp: THREE.Matrix4[] = [], sf: THREE.Matrix4[] = [];
      for (const s of [470, 820, 1500 - 120, 2060, 3980, 5330, 6000]) {
        if (skip(s)) continue; const p = at(s, lim + 2.6), tt = pathAt(s); sp.push(M(p.x, p.y - 0.4, p.z, 0, 1));
        sf.push(M(p.x, p.y + 2.65, p.z, Math.atan2(-tt.tx, -tt.tz), 1));
      }
      place(post, std(0x8a8d90, 0.5, 0.7), sp, undefined, false); place(face, elkSign(), sf, undefined, false);
    }

    // ---------- start and finish ----------
    gantry(W, 98, banner('ICEFIELDS PARKWAY', 'LARGADA', false)); gantry(W, finishS, banner('CHEGADA', '', true));

    // ---------- earth-covered wildlife overpass ----------
    {
      const sA = ov.from, sB = ov.to, path = sRange(sA, sB, 2.5).map((s) => pathAt(s));
      const outer: [number, number][] = [[-14, -1.3], [-14, 8.4], [14, 8.4], [14, -1.3]], inner: [number, number][] = [[-9.95, -1.1], [-9.95, 6.6], [9.95, 6.6], [9.95, -1.1]];
      const geos = [sweep(path, outer), sweep(path, inner)];
      for (const p of [path[0], path[path.length - 1]]) { // portal faces
        const pos: number[] = [], P = (u: number, v: number) => [p.x - p.tz * u, p.y + v + u * p.bank, p.z + p.tx * u];
        for (let i = 0; i < 4; i++) { const j = (i + 1) % 4, a = P(...outer[i]), bq = P(...outer[j]), c = P(...inner[j]), d = P(...inner[i]); pos.push(...a, ...bq, ...c, ...a, ...c, ...d); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); geos.push(g);
      }
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, concrete); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh);
      // the earth on top: a grid draped over the terrain, domed over the structure, sloping away at a fixed angle (hidden below the ground where it ends)
      const cs = (sA + sB) / 2, c0 = pathAt(cs), Dx0 = c0.tx, Dz0 = c0.tz, sl = (pathAt(sB).y - pathAt(sA).y) / (sB - sA), topY = 8.7, step2 = 1.75, na = 70, nb = 92;
      const gp: number[] = [], gi: number[] = [];
      for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) {
        const a = (i - na / 2) * step2, bq = (j - nb / 2) * step2, x = c0.x + a * Dx0 - bq * Dz0, z = c0.z + a * Dz0 + bq * Dx0, terr = W.heightAt(x, z);
        const ea = Math.max(0, Math.abs(a) - 25), eb = Math.max(0, Math.abs(bq) - 14), e = Math.hypot(ea, eb);
        let plat = c0.y + sl * a + topY - 0.62 * e + (fbm(x / 9, z / 9) - 0.5) * 1.2 * Math.min(1, e / 10);
        if (Math.abs(a) > 25 && Math.abs(bq) < 13) plat = -1e3; // the road mouth stays open
        gp.push(x, plat > terr + 0.02 ? plat : terr - 0.6, z);
      }
      for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) { const k = i * (nb + 1) + j; gi.push(k, k + 1, k + nb + 1, k + 1, k + nb + 2, k + nb + 1); }
      const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); eg.setIndex(gi); eg.computeVertexNormals();
      const em = new THREE.MeshStandardNodeMaterial(), p2 = positionWorld.xz, mt = tex('aerial_grass_rock_diffuse.jpg', true), wg = weatherGround(texture(mt, p2.div(8)).rgb.mul(vec3(0.66, 0.9, 0.5)), float(0.92), normalWorld.y);
      em.colorNode = wg.color; em.roughnessNode = wg.rough; em.polygonOffset = true; em.polygonOffsetFactor = -2; em.polygonOffsetUnits = -2;
      const emesh = new THREE.Mesh(eg, em); emesh.receiveShadow = true; emesh.castShadow = true; emesh.frustumCulled = false; group.add(emesh);
    }

    // ---------- avalanche gallery: concrete shed, solid wall on the mountain side, columns on the open side ----------
    {
      const path = sRange(ga.from, ga.to, 3).map((s) => pathAt(s));
      const geos = [sweep(path, [[-11.9, 7.1], [-11.9, 8.0], [13.4, 11.4], [13.4, 10.5]]), sweep(path, [[10.2, -1.2], [10.2, 10.5], [11.7, 10.5], [11.7, -1.2]]), sweep(path, [[-12.0, 7.1], [-12.0, 7.9], [-11.0, 7.9], [-11.0, 7.1]])];
      const lamps: THREE.BufferGeometry[] = [];
      for (let s = ga.from + 1; s <= ga.to; s += 7) {
        const p = pathAt(s), yaw = Math.atan2(-p.tz, p.tx), cx = (u: number, v: number) => M(p.x - p.tz * u, p.y + v + u * p.bank, p.z + p.tx * u, yaw, 1);
        const top = 7.4; geos.push(boxG(0.9, top + 1.4, 0.9, cx(-11.5, (top - 1.4) / 2))); lamps.push(boxG(0.5, 0.12, 1.6, cx(-4, 8.2)));
      }
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, concrete); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh);
      const lamp = new THREE.MeshStandardNodeMaterial({ color: 0x222222 }); lamp.emissiveNode = vec3(1, 0.72, 0.38).mul(3.2);
      const lm = new THREE.Mesh(mergeGeometries(lamps)!, lamp); lm.frustumCulled = false; group.add(lm);
    }

    // ---------- girder bridge over the gorge ----------
    {
      const mid = (br.from + br.to) / 2, steel = std(0x486358, 0.5, 0.6);
      const deckMat = snowTop(new THREE.MeshStandardNodeMaterial({ roughness: 0.85, side: THREE.DoubleSide }), concCol.mul(0.95)); deckMat.emissiveNode = concCol.mul(0.12);
      const deck = deckBridge(W, br, { mat: deckMat, step: 3 }), path = deck.path, gg: THREE.BufferGeometry[] = [];
      for (const u of [-4.6, 4.6]) { // two deep plate girders with flanges
        gg.push(sweep(path, [[u - 0.3, -1.05], [u + 0.3, -1.05], [u + 0.3, -3.3], [u - 0.3, -3.3]]), sweep(path, [[u - 0.9, -3.0], [u + 0.9, -3.0], [u + 0.9, -3.4], [u - 0.9, -3.4]]));
      }
      for (let s = br.from + 6; s < br.to - 4; s += 9) { const p = pathAt(s), yaw = Math.atan2(-p.tz, p.tx); gg.push(boxG(0.25, 1.0, 9.2, M(p.x, p.y - 2.4, p.z, yaw, 1))); }
      const gm = new THREE.Mesh(mergeGeometries(gg)!, steel); gm.castShadow = true; gm.receiveShadow = true; gm.frustumCulled = false; group.add(gm);
      const pm: THREE.Matrix4[] = [], unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      for (const f of [0.34, 0.66]) {
        const s = br.from + (br.to - br.from) * f, p = pathAt(s), yaw = Math.atan2(-p.tz, p.tx), top = p.y - 3.4;
        for (const u of [-4.6, 4.6]) { const px = p.x - p.tz * u, pz = p.z + p.tx * u, base = W.heightAt(px, pz) - 5; pm.push(M(px, base, pz, yaw, 2.6, top - 1 - base, 2.2)); }
        pm.push(M(p.x, top - 1.1, p.z, yaw, 3.2, 1.1, 12.4));
      }
      for (const s of [br.from + 4, br.to - 4]) { const p = pathAt(s), yaw = Math.atan2(-p.tz, p.tx), base = Math.min(W.heightAt(p.x, p.z), W.heightAt(p.x - p.tz * 7, p.z + p.tx * 7), W.heightAt(p.x + p.tz * 7, p.z - p.tx * 7)) - 5; pm.push(M(p.x, base, p.z, yaw, 6, p.y - 1.1 - base, 15)); }
      void mid; place(unit, concrete, pm);
    }

    // ---------- finish lodge ----------
    {
      const gy = padY + 0.1, L = new THREE.Group();
      L.position.set(lx, gy, lz); L.rotation.y = -lyaw; L.scale.setScalar(1.3); // local +x along the road, local -z towards the road
      const wood = std(0x6b4a2f, 0.85), stone = std(0x77736d, 0.95), dark = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
      dark.colorNode = mix(vec3(0.075, 0.08, 0.09), vec3(0.9, 0.93, 0.97), snowU.mul(0.93));
      const glow = new THREE.MeshStandardNodeMaterial({ color: 0x1a1a1a }); glow.emissiveNode = vec3(1, 0.7, 0.36).mul(3.0);
      const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0, rz = 0) => { const me = new THREE.Mesh(g, m); me.position.set(x, y, z); me.rotation.set(0, ry, rz); me.castShadow = true; me.receiveShadow = true; L.add(me); return me; };
      add(new THREE.BoxGeometry(30, 1.6, 13.4), stone, 0, 0.8, 0); add(new THREE.BoxGeometry(28, 4.4, 12), wood, 0, 3.8, 0);
      // roof: two slabs meeting at a ridge along the road; the road side is local -z
      const rl = Math.hypot(6.8, 3.6), ang = Math.atan2(3.6, 6.8), rg = new THREE.BoxGeometry(31, 0.5, rl);
      const r1 = add(rg, dark, 0, 7.55, -3.4); r1.rotation.x = -ang; const r2 = add(rg, dark, 0, 7.55, 3.4); r2.rotation.x = ang;
      add(new THREE.BoxGeometry(2.0, 5.6, 2.0), stone, -8, 8.2, 3.5); add(new THREE.BoxGeometry(14, 1.0, 3.2), wood, 0, 2.3, -7.4); // chimney, porch deck
      const win = new THREE.BoxGeometry(1.8, 1.5, 0.12); for (let i = -5; i <= 5; i++) if (i % 5 !== 0 || i === 0) add(win, glow, i * 2.4, 3.9, -6.06);
      for (const x of [-6, -2, 2, 6]) add(new THREE.BoxGeometry(0.3, 3.2, 0.3), wood, x, 3.5, -8.6);
      group.add(L);
    }

    // ---------- backdrop: snowy peaks 1.5-4 km out ----------
    {
      const pm = new THREE.MeshStandardNodeMaterial({ roughness: 0.92 }), y = positionWorld.y, ny = normalWorld.y, n = mx_noise_float(positionWorld.xz.div(260)).mul(70);
      const sn = smoothstep(430, 620, y.add(n)).mul(smoothstep(0.25, 0.65, ny).mul(0.55).add(0.45));
      const low = smoothstep(260, 90, y.add(n.mul(0.5)));
      const rockC = mix(vec3(0.3, 0.31, 0.34), vec3(0.42, 0.4, 0.38), mx_noise_float(positionWorld.xz.div(90)).mul(0.5).add(0.5));
      pm.colorNode = mix(mix(rockC, vec3(0.045, 0.085, 0.05), low), vec3(0.86, 0.9, 0.96), sn);
      peaks(W, [
        { x: 3300, z: -900, r: 1500, h: 1150, seed: 1 }, { x: 3700, z: -3100, r: 1700, h: 1400, seed: 2 }, { x: 3200, z: -5200, r: 1400, h: 1050, seed: 3 },
        { x: -2400, z: -1700, r: 1500, h: 1100, seed: 4 }, { x: -2900, z: -3700, r: 1600, h: 1350, seed: 5 }, { x: -2200, z: -5900, r: 1400, h: 1000, seed: 6 },
        { x: 900, z: -8000, r: 1600, h: 1300, seed: 7 }, { x: 300, z: 2800, r: 1500, h: 950, seed: 8 },
      ], pm);
    }
  }

  const def: WorldDef = {
    id: 'rockies', x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, cell: 8, natural, hdr: 'kloofendal_43d_clear_puresky_2k.hdr',
    water: [{ y: LAKE, x0: b.x0, x1: b.x1, z0: -1900, z1: b.z1, color: [0.02, 0.3, 0.33], rough: 0.05 }], wind: [3.2, 0.6],
    sunDir: [-0.5, 0.4, 0.62], sunColor: 0xfff1de, fog: [0.66, 0.74, 0.85], fogNear: 700, fogFar: 11000, seaColor: [0.02, 0.3, 0.33],
    terrainMaterial, roadMaterial, barrier: 'rail', bridge: br, cutBlend: 46, cutEdge: 3, props,
  };
  return new World(eng, track, def);
}
