import * as THREE from 'three/webgpu';
import { instanceIndex, triplanarTexture, texture, uv, mix, vec2, vec3, float, positionWorld, normalWorld, smoothstep, fract, floor, step, abs, sin, attribute, mx_noise_float, normalMap, max, vec4 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Track } from '../../../sim/src/index';
import type { Engine } from '../gfx/engine';
import { weatherGround, wetRoad } from './weather';
import { World, fbm, hash, M, set, sstep, std, vnoise, type WorldDef } from './base';

const dome = (x: number, z: number, cx: number, cz: number, R: number, H: number, p = 0.55) => { const r = Math.hypot(x - cx, z - cz) / R; return r < 1 ? H * Math.pow(1 - r * r, p) : 0; };

export const CRISTO = { x: -170, z: -820, h: 318 };
const SUGAR = { x: 1010, z: 470 }, URCA = { x: 850, z: 330 };
const shore = (x: number) => 196 + 14 * Math.sin(x / 260) + 8 * Math.sin(x / 90 + 1);


/** Height of the land before the road is cut into it. */
export function natural(x: number, z: number) {
  const d = shore(x) - z;
  let h = d < 0 ? Math.max(-9, d * 0.07) : d < 34 ? 2.4 * sstep(0, 34, d) : 2.4 + (d - 34) * 0.0615;
  if (d > 60) h += (fbm(x / 150, z / 150) - 0.45) * 22 * sstep(60, 420, d);
  h += dome(x, z, CRISTO.x, CRISTO.z, 330, CRISTO.h - 60, 0.8) + dome(x, z, CRISTO.x + 260, CRISTO.z - 60, 300, 150, 0.7) + dome(x, z, CRISTO.x - 420, CRISTO.z + 30, 380, 190, 0.7);
  h += 150 * Math.exp(-Math.pow((z + 1050) / 240, 2)) * (0.5 + fbm(x / 300 + 4, 2)) + dome(x, z, 1150, -420, 420, 210, 0.7);
  h = Math.max(h, dome(x, z, SUGAR.x, SUGAR.z, 190, 236, 0.5) - 8, dome(x, z, URCA.x, URCA.z, 170, 118, 0.6) - 6);
  return h;
}

/** Flat coastal strip where the city stands. */
const cityZone = (w: World, x: number, z: number) => { const d = shore(x) - z; return d > 58 && d < 240 && w.heightAt(x, z) < 19 && x < 780; };

function terrainMaterial() {
    const grass = set('aerial_grass_rock'), sand = set('aerial_beach_01'), rock = set('rock_face_03');
    const m = new THREE.MeshStandardNodeMaterial();
    const p = positionWorld.xz, y = positionWorld.y, ny = normalWorld.y;
    const lay = (s: ReturnType<typeof set>, a: number, b: number) => mix(texture(s.map, p.div(a)).rgb, texture(s.map, p.div(b)).rgb, 0.5);
    const sandW = float(1).sub(smoothstep(2.3, 3.6, y)), rockW = smoothstep(0.84, 0.6, ny);
    const macro = mx_noise_float(p.div(90)).mul(0.14).add(0.92);
    const gcol = lay(grass, 9, 61).mul(vec3(0.62, 0.78, 0.5)), rcol = triplanarTexture(texture(rock.map), null, null, float(1 / 38)).rgb.mul(vec3(0.62, 0.6, 0.6)).mul(mx_noise_float(vec3(p.div(7), y.div(60))).mul(0.25).add(0.85)), scol = lay(sand, 14, 70).mul(vec3(1.1, 1.02, 0.9));
    const wg = weatherGround(mix(mix(gcol, scol, sandW), rcol, rockW).mul(macro), mix(mix(texture(grass.rough, p.div(9)).r, texture(sand.rough, p.div(14)).r, sandW), texture(rock.rough, p.div(26)).r, rockW), ny);
    m.colorNode = wg.color; m.roughnessNode = wg.rough;
    m.normalNode = normalMap(mix(mix(texture(grass.nor, p.div(9)), texture(sand.nor, p.div(14)), sandW), texture(rock.nor, p.div(26)), rockW));
  return m;
}

function roadMaterial(w: World) {
  const t = w.track, hw = t.def.halfWidth;
    const asph = set('asphalt_04'), grass = set('aerial_grass_rock');
    const m = new THREE.MeshStandardNodeMaterial();
    const l = uv().x, s = uv().y, al = abs(l), auv = vec2(l, s).div(7);
    const onRoad = float(1).sub(smoothstep(hw - 0.02, hw + 0.02, al));
    const worn = smoothstep(5.5, 1.5, abs(l.add(sin(s.mul(0.021)).mul(1.6)))).mul(0.22); // darker rubbered line
    const base = texture(asph.map, auv).rgb.mul(0.62).mul(float(1).sub(worn));
    const edge = smoothstep(0.09, 0.07, abs(al.sub(hw - 0.35))), dash = smoothstep(0.08, 0.06, al).mul(step(0.55, fract(s.div(9))));
    const grid = step(s, 1.4).mul(step(0.5, fract(floor(s.div(0.7)).add(floor(l.div(0.7))).mul(0.5)))); // chequered start line
    const paint = max(max(edge, dash), grid).mul(onRoad).mul(texture(asph.rough, auv).r.mul(0.5).add(0.6));
    const kz = attribute('kerb', 'float').mul(smoothstep(hw - 0.02, hw + 0.02, al)).mul(float(1).sub(smoothstep(hw + 1.1, hw + 1.2, al)));
    const kcol = mix(vec3(0.72, 0.05, 0.04), vec3(0.85), step(0.5, fract(s.div(4))));
    const verge = texture(grass.map, vec2(l, s).div(6)).rgb.mul(vec3(0.5, 0.62, 0.4));
    const gv = weatherGround(verge, float(0.95), float(1), float(1).sub(onRoad));
    const wr = wetRoad(mix(mix(base, vec3(0.82), paint), kcol, kz), texture(asph.rough, auv).r.mul(0.75).sub(worn.mul(0.5)), onRoad, max(paint, kz), l, s);
    m.colorNode = mix(gv.color, wr.color, onRoad);
    m.roughnessNode = mix(gv.rough, wr.rough, onRoad);
    m.normalNode = normalMap(mix(mix(texture(grass.nor, vec2(l, s).div(6)), texture(asph.nor, auv), onRoad), vec4(0.5, 0.5, 1, 1), wr.flat));
  return m;
}

function props(W: World) {
  const t = W.track, q = W.eng.quality, lim = W.lim, group = W.group, place = W.place.bind(W), pulse = W.pulse;

    // ---- palms along the seafront and street lamps ----
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 9, 8, 6); trunk.translate(0, 4.5, 0);
    { const p = trunk.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + (y / 9) * (y / 9) * 1.1); } trunk.computeVertexNormals(); }
    const fronds: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 11; k++) {
      const f = new THREE.PlaneGeometry(1.1, 4.6, 2, 7); f.translate(0, 2.3, 0); const p = f.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i), u = y / 4.6, x = p.getX(i); p.setXYZ(i, x * (1 - u * 0.75), y * 0.72 - u * u * 2.4 - Math.abs(x) * 0.5, u * 4.1); }
      f.rotateY((k / 11) * Math.PI * 2 + (k % 2) * 0.2); f.rotateX(0); f.translate(1.1, 9 + (k % 3) * 0.12, 0); f.computeVertexNormals(); fronds.push(f);
    }
    const leafCv = document.createElement('canvas'); leafCv.width = 128; leafCv.height = 512; const lc = leafCv.getContext('2d')!;
    lc.strokeStyle = '#fff'; lc.lineWidth = 5; for (let y = 6; y < 512; y += 9) { lc.beginPath(); lc.moveTo(64, y); lc.lineTo(2, y - 26); lc.moveTo(64, y); lc.lineTo(126, y - 26); lc.stroke(); } lc.fillStyle = '#fff'; lc.fillRect(60, 0, 8, 512);
    const leafTex = new THREE.CanvasTexture(leafCv);
    const leaf = new THREE.MeshStandardNodeMaterial({ color: 0x3f6a22, roughness: 0.7, side: THREE.DoubleSide, alphaMap: leafTex, alphaTest: 0.5 });
    const palmM: THREE.Matrix4[] = [], lampM: THREE.Matrix4[] = [];
    for (let i = 0; i < t.n; i += 9) {
      const beach = t.pz[i] > 60 && Math.abs(t.curv[i]) < 0.006;
      for (const side of [-1, 1]) {
        if (beach && (i / 9) % 2 === (side > 0 ? 0 : 1)) {
          const l = side * (lim + 3.2 + hash(i, side) * 2), x = t.px[i] - t.tz[i] * l, z = t.pz[i] + t.tx[i] * l;
          palmM.push(M(x, t.py[i] - 0.5, z, hash(i, 7) * 6.28, 0.85 + hash(i, 3) * 0.4));
        }
      }
      if (i % 27 === 0) { const side = (i / 27) % 2 ? 1 : -1, l = side * (lim + 1.4); lampM.push(M(t.px[i] - t.tz[i] * l, t.py[i] + side * lim * t.bank[i], t.pz[i] + t.tx[i] * l, Math.atan2(-t.tz[i] * -side, -t.tx[i] * side) + Math.PI / 2, 1)); }
    }
    place(trunk, std(0x6b5a48, 0.9), palmM); place(mergeGeometries(fronds)!, leaf, palmM);
    const pole = mergeGeometries([new THREE.CylinderGeometry(0.07, 0.11, 8, 8).translate(0, 4, 0), new THREE.BoxGeometry(0.1, 0.1, 2.4).translate(0, 8, 1.1)])!;
    const head = new THREE.BoxGeometry(0.34, 0.1, 0.7).translate(0, 7.93, 2.2), glow = new THREE.MeshStandardNodeMaterial({ color: 0x222222 }); glow.emissiveNode = vec3(1, 0.78, 0.45).mul(pulse.mul(6).add(4));
    place(pole, std(0x30343a, 0.5, 0.6), lampM); place(head, glow, lampM, undefined, false);

    // ---- forest on the hills ----
    const blob = (r: number, x: number, y: number, z: number, det = 1) => { const s = new THREE.IcosahedronGeometry(r, det); const p = s.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.74 + hash(Math.round(p.getX(i) * 50) + x * 9, Math.round(p.getY(i) * 50 + p.getZ(i) * 31)) * 0.5; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k); } s.translate(x, y, z); s.computeVertexNormals(); return s; };
    const crown = mergeGeometries([blob(2.6, 0, 6.2, 0, q.detail >= 1 ? 2 : 1), blob(2, 1.6, 5, 0.6), blob(1.9, -1.3, 5.2, -0.9), blob(1.6, 0.2, 7.6, 0.4)])!;
    const bole = new THREE.CylinderGeometry(0.22, 0.34, 5, 6).translate(0, 2.5, 0);
    const treeM: THREE.Matrix4[] = [], treeC: THREE.Color[] = [], count = Math.round(3800 * q.detail);
    for (let k = 0, tries = 0; k < count && tries < count * 12; tries++) {
      const x = -1250 + hash(tries, 11) * 2300, z = -1000 + hash(tries, 23) * 1150, h = W.heightAt(x, z), d = shore(x) - z;
      if (d < 70 || h > 215 || W.roadDist(x, z) < lim + 5 || cityZone(W, x, z) || vnoise(x / 60, z / 60) < 0.3) continue;
      const sl = Math.abs(W.heightAt(x + 4, z) - h) + Math.abs(W.heightAt(x, z + 4) - h); if (sl > 5.5) continue;
      const sc = 0.8 + hash(tries, 5) * 0.9; treeM.push(M(x, h - 0.3, z, hash(tries, 9) * 6.28, sc, sc * (0.9 + hash(tries, 4) * 0.5), sc));
      treeC.push(new THREE.Color().setHSL(0.27 + hash(tries, 6) * 0.08, 0.5, 0.09 + hash(tries, 8) * 0.06)); k++;
    }
    const foliage = std(0xffffff, 0.8); // leafy break-up: clumps of light and dark, darker underneath
    const clump = mx_noise_float(positionWorld.mul(1.7)).mul(0.5).add(mx_noise_float(positionWorld.mul(5.3)).mul(0.35));
    foliage.colorNode = vec3(1).mul(clump.add(1)).mul(mix(float(0.45), float(1.15), normalWorld.y.mul(0.5).add(0.5)));
    foliage.normalNode = undefined as any;
    place(crown, foliage, treeM, treeC); place(bole, std(0x3a2e24, 0.9), treeM);

    // ---- city: seafront towers and blocks behind them ----
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), bM: THREE.Matrix4[] = [], bC: THREE.Color[] = [];
    const tint = ['#d9d2c4', '#c9c2b8', '#e4ddd0', '#b8bcc2', '#d6c7b0', '#a9b4bd', '#e8e2d8', '#c7b9a8'];
    const tower = (x: number, z: number, w: number, d: number, h: number, ry: number, seed: number) => {
      if (W.roadDist(x, z) < lim + 6 + Math.max(w, d) * 0.72) return;
      bM.push(M(x, W.heightAt(x, z) - 1.5, z, ry, w, h + 1.5, d)); bC.push(new THREE.Color(tint[Math.floor(hash(seed, 2) * tint.length)]));
    };
    for (let x = -1380; x < 1150; x += 27 + hash(x, 1) * 9) for (let row = 0; row < 5; row++) {
      const z = shore(x) - 66 - row * 34 - hash(x, row) * 6; if (!cityZone(W, x, z)) continue;
      tower(x, z, 20 + hash(x, row + 3) * 9, 20 + hash(x, row + 5) * 8, 26 + hash(x, row + 7) * 34 + (row > 0 ? hash(x, row + 9) * 40 : 0), 0, x * 7 + row);
    }
    const fac = new THREE.MeshStandardNodeMaterial();
    const wp = positionWorld, horiz = wp.x.add(wp.z), cellU = floor(horiz.div(2.7)), cellV = floor(wp.y.div(3.1));
    const fu = fract(horiz.div(2.7)), fv = fract(wp.y.div(3.1)), wall = step(0.5, abs(normalWorld.y).oneMinus());
    const win = smoothstep(0.14, 0.18, fu).mul(smoothstep(0.86, 0.82, fu)).mul(smoothstep(0.3, 0.34, fv)).mul(smoothstep(0.88, 0.84, fv)).mul(wall);
    const rnd = fract(sin(cellU.mul(12.9898).add(cellV.mul(78.233))).mul(43758.5453));
    const id = instanceIndex.toFloat(), hue = fract(sin(id.mul(91.7)).mul(4375.5)), tone = mix(vec3(0.78, 0.74, 0.66), vec3(0.6, 0.64, 0.68), hue).mul(fract(sin(id.mul(17.3)).mul(931.1)).mul(0.3).add(0.72));
    const slab = smoothstep(0.1, 0.06, fv).mul(wall), pier = step(0.93, fract(horiz.div(8.1))).mul(wall);
    fac.colorNode = mix(mix(tone, tone.mul(1.25), slab).mul(mix(float(1), float(0.82), pier)), vec3(0.02, 0.03, 0.04), win);
    fac.roughnessNode = mix(float(0.88), float(0.08), win); fac.metalnessNode = win.mul(0.85);
    fac.emissiveNode = vec3(1, 0.7, 0.38).mul(win).mul(step(0.86, rnd)).mul(rnd.mul(0.9));
    const city = new THREE.InstancedMesh(box, fac, bM.length); bM.forEach((mm, i) => { city.setMatrixAt(i, mm); city.setColorAt(i, bC[i]); }); city.castShadow = true; city.receiveShadow = true; city.frustumCulled = false; group.add(city);

    // ---- landmarks ----
    const stone = std(0xd8d4c8, 0.9); (stone as THREE.MeshStandardNodeMaterial).emissiveNode = vec3(1, 0.86, 0.66).mul(0.22);
    const cy = natural(CRISTO.x, CRISTO.z), S = 1.9;
    const robe = new THREE.CylinderGeometry(1.5, 2.5, 21, 16).translate(0, 18.5, 0), arms = new THREE.BoxGeometry(27, 2.3, 2.1).translate(0, 25.4, 0);
    const sleeves = [-1, 1].map((e) => new THREE.BoxGeometry(9, 4.2, 2.4).translate(e * 7.4, 23.9, 0)), headG = new THREE.SphereGeometry(1.75, 16, 12).translate(0, 31.2, 0);
    const hands = [-1, 1].map((e) => new THREE.BoxGeometry(1.6, 1.4, 1.2).translate(e * 14.2, 25.4, 0)), plinth = new THREE.CylinderGeometry(3.4, 4.4, 8, 12).translate(0, 4, 0);
    const statue = new THREE.Mesh(mergeGeometries([robe, arms, ...sleeves, headG, ...hands, plinth].map((x) => x.toNonIndexed()))!, stone);
    statue.position.set(CRISTO.x, cy - 2, CRISTO.z); statue.scale.setScalar(S); statue.rotation.y = Math.atan2(0 - CRISTO.x, 200 - CRISTO.z); statue.castShadow = true; group.add(statue);
    // cable car between the two domes
    const a = new THREE.Vector3(URCA.x, natural(URCA.x, URCA.z) + 3, URCA.z), b = new THREE.Vector3(SUGAR.x, natural(SUGAR.x, SUGAR.z) + 3, SUGAR.z), len = a.distanceTo(b);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, len, 5), std(0x202124, 0.5, 0.8)); cable.position.copy(a).lerp(b, 0.5); cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); group.add(cable);
    for (const f of [0.32, 0.7]) { const car = new THREE.Mesh(new THREE.BoxGeometry(5, 3.4, 3.4), std(0xd9b32b, 0.4, 0.3)); car.position.copy(a).lerp(b, f).add(new THREE.Vector3(0, -2.6, 0)); car.lookAt(b); group.add(car); }

}


export const RIO_DEF: WorldDef = {
  id: 'rio', x0: -1500, z0: -1350, x1: 1500, z1: 750, cell: 5, natural,
  sunDir: [-0.85, 0.2, 0.42], sunColor: 0xffc48a, fog: [0.6, 0.56, 0.58], fogNear: 400, fogFar: 9000, seaColor: [0.012, 0.06, 0.085],
  terrainMaterial, roadMaterial, barrier: 'concrete', props,
};
export const makeRio = (eng: Engine, track: Track) => new World(eng, track, RIO_DEF);
export { World };
