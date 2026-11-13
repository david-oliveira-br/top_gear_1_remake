import * as THREE from 'three/webgpu';
import { uniform, texture, uv, vec3, float, mix, fog, rangeFogFactor, mx_noise_float, normalMap, positionWorld, dot, vec2, sin, time, smoothstep, step, fract } from 'three/tsl';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { locate, WEATHER, type Loc, type Track, type WeatherKind } from '../../../sim/src/index';
import { LOOK, Precip, flashU, skyNode, snowU, wetU } from './weather';
import type { Engine } from '../gfx/engine';

export const A = '/assets/';
const loader = new THREE.TextureLoader();
export function tex(name: string, srgb = false) {
  const t = loader.load(A + name); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t;
}
export const set = (id: string) => ({ map: tex(id + '_diffuse.jpg', true), nor: tex(id + '_nor_gl.jpg'), rough: tex(id + '_rough.jpg') });
export type TexSet = ReturnType<typeof set>;

// deterministic noise for placing things
export function hash(x: number, y: number) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v;
}
export const fbm = (x: number, y: number) => vnoise(x, y) * 0.5 + vnoise(x * 2.1 + 7, y * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 1, y * 4.3 + 9) * 0.2;
export const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const std = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
export const M = (x: number, y: number, z: number, ry: number, sx: number, sy = sx, sz = sx) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));

export interface BridgeRange { from: number; to: number; }
/** Everything that makes one place different; `World` does the rest. */
export interface WorldDef {
  id: string;
  /** terrain grid bounds (world metres) and cell size */
  x0: number; z0: number; x1: number; z1: number; cell: number;
  /** height of the land before the road is cut into it */
  natural: (x: number, z: number) => number;
  /** direction towards the sun (azimuth is used; elevation comes from the HDR) */
  sunDir: [number, number, number]; sunColor: number;
  fog: [number, number, number]; fogNear: number; fogFar: number;
  seaColor: [number, number, number]; seaSize?: number; seaCenter?: [number, number];
  terrainMaterial: (w: World) => THREE.Material;
  roadMaterial: (w: World) => THREE.Material;
  barrier: 'concrete' | 'rail';
  /** an arc-length range where the road is a bridge: terrain is not raised to it and no barrier/verge is drawn */
  bridge?: BridgeRange;
  /** how far (m) beyond the shoulder the road cut blends into the land */
  cutBlend?: number;
  /** metres of flat ground kept beyond the shoulder before the cut starts to blend (default 9) */
  cutEdge?: number;
  props: (w: World) => void;
}

// one fog node shared by every world: switching places only changes uniforms, so no shader recompiles
const fogColor = uniform(new THREE.Vector3(0.6, 0.56, 0.58)), fogNear = uniform(400), fogFar = uniform(9000);
let hdrP: Promise<{ hdr: THREE.Texture; lat: number; lon: number }> | null = null;
function loadSky() {
  return (hdrP ??= new HDRLoader().loadAsync(A + 'kloppenheim_06_puresky_4k.hdr').then((hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const img = hdr.image as { data: Uint16Array; width: number; height: number };
    let best = 0, bu = 0, bv = 0;
    for (let y = 0; y < img.height / 2; y += 3) for (let x = 0; x < img.width; x += 3) {
      const i = (y * img.width + x) * 4, l = THREE.DataUtils.fromHalfFloat(img.data[i]) + THREE.DataUtils.fromHalfFloat(img.data[i + 1]) + THREE.DataUtils.fromHalfFloat(img.data[i + 2]);
      if (l > best) { best = l; bu = x / img.width; bv = y / img.height; }
    }
    return { hdr, lat: (0.5 - bv) * Math.PI, lon: (bu - 0.5) * Math.PI * 2 };
  }));
}

export class World {
  group = new THREE.Group(); sun: THREE.DirectionalLight; sunDir: THREE.Vector3;
  /** 0..1 pulse from the music; street lamps and signs breathe with it */
  pulse = uniform(0);
  /** lateral limit of the drivable surface (road + shoulder) */
  lim: number;
  private rot = 0;
  private nearest = new Int32Array(0); private gx0: number; private gz0: number; private cell: number; private gw = 0; private gh = 0; private height!: Float32Array;

  constructor(public eng: Engine, public track: Track, public def: WorldDef) {
    this.gx0 = def.x0; this.gz0 = def.z0; this.cell = def.cell; this.lim = track.def.halfWidth + track.def.shoulder;
    this.sun = new THREE.DirectionalLight(def.sunColor, 5.5); this.sunDir = new THREE.Vector3(...def.sunDir).normalize();
    this.group.visible = false; eng.scene.add(this.group);
  }

  async build() {
    const eng = this.eng, q = eng.quality, def = this.def;
    const { hdr, lat, lon } = await loadSky();
    const hx = Math.cos(lat) * Math.cos(lon), hz = Math.cos(lat) * Math.sin(lon);
    const want = Math.atan2(this.sunDir.z, this.sunDir.x), have = Math.atan2(hz, hx); this.rot = have - want;
    const el = Math.max(0.3, lat), c = Math.cos(el); this.sunDir.set(Math.cos(want) * c, Math.sin(el), Math.sin(want) * c);
    (this as any).hdr = hdr;
    const s = this.sun; s.castShadow = true; s.shadow.mapSize.set(q.shadow, q.shadow); s.shadow.bias = -0.0004; s.shadow.normalBias = 0.06;
    Object.assign(s.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 10, far: 700 }); s.shadow.camera.updateProjectionMatrix();
    this.group.add(s, s.target);
    this.terrain(); this.road(); this.barriers(); this.sea(); def.props(this);
  }

  /** Make this the visible world: sky, fog, light. */
  show(on: boolean) {
    this.group.visible = on; if (!on) { this.precip?.set(0, 0, 1); return; }
    const eng = this.eng, d = this.def, hdr = (this as any).hdr as THREE.Texture;
    eng.scene.background = hdr; eng.scene.environment = hdr; eng.scene.backgroundRotation.y = this.rot; eng.scene.environmentRotation.y = this.rot;
    eng.scene.environmentIntensity = 0.75; eng.scene.backgroundIntensity = 1;
    if (!eng.scene.fogNode) eng.scene.fogNode = fog(fogColor, rangeFogFactor(fogNear, fogFar));
    this.applyWeather();
  }

  weather: WeatherKind = 'clear'; private precip: Precip | null = null; private flash = 0; private nextFlash = 3; private lastT = 0;
  /** called with the delay (s) before the thunder that follows a flash */
  onThunder: ((delay: number, power: number) => void) | null = null;
  /** Sky, light, fog, wet road, snow and precipitation for a kind. Cheap and repeatable: only uniforms and light values change. */
  setWeather(kind: WeatherKind) { this.weather = kind; if (this.group.visible) this.applyWeather(); }
  private applyWeather() {
    const eng = this.eng, d = this.def, kind = this.weather, L = LOOK[kind], info = WEATHER[kind], sc = eng.scene;
    wetU.value = info.wet; snowU.value = kind === 'snow' ? 1 : 0; flashU.value = 0; this.flash = 0; this.nextFlash = 2 + Math.random() * 3;
    sc.environmentIntensity = L.env; sc.backgroundIntensity = L.bg; this.sun.color.setHex(L.sunColor ?? d.sunColor); this.sun.intensity = L.sun; this.baseSun = L.sun; this.baseEnv = L.env;
    let tint = 1;
    if (L.sky) {
      const [h, z] = L.sky; sc.background = null; sc.backgroundNode = skyNode(vec3(...h), vec3(...z));
      fogColor.value.set(h[0] * 0.97, h[1] * 0.97, h[2] * 0.97); tint = (h[0] + h[1] + h[2]) / 3 * 1.6;
    } else { sc.backgroundNode = null; sc.background = (this as any).hdr; fogColor.value.set(...d.fog); }
    fogNear.value = L.fog ? L.fog[0] : d.fogNear; fogFar.value = L.fog ? L.fog[1] : d.fogFar;
    if (!this.precip) { this.precip = new Precip(eng.quality.detail); eng.overlay.add(this.precip.group); }
    this.precip.set(L.rain, L.snow, Math.min(1, 0.35 + tint * 0.6));
    this.sky = L.sky ? 1 : 0;
  }
  private baseSun = 5.5; private baseEnv = 0.75; private sky = 0;

  /** Keep the shadow box centred on the action. */
  update(focus: THREE.Vector3) {
    const now = performance.now() / 1000, dt = this.lastT ? Math.min(0.1, now - this.lastT) : 0.016; this.lastT = now;
    this.precip?.update(this.eng.camera, dt);
    if (this.weather === 'storm') { // lightning: two quick pulses, then thunder some time later (visual only, not part of the simulation)
      this.nextFlash -= dt;
      if (this.nextFlash <= 0 && this.flash <= 0) { this.flash = 1; this.nextFlash = 5 + Math.random() * 9; this.onThunder?.(0.6 + Math.random() * 2.4, 0.6 + Math.random() * 0.4); }
      if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt * 2.6); const f = this.flash, v = f * f * (0.55 + 0.45 * Math.abs(Math.sin(f * 14))); flashU.value = v; this.eng.scene.environmentIntensity = this.baseEnv + v * 2.2; this.sun.intensity = this.baseSun + v * 14; if (this.flash === 0) { this.eng.scene.environmentIntensity = this.baseEnv; this.sun.intensity = this.baseSun; } }
    }
    const s = this.sun, texel = 190 / s.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    s.target.position.set(fx, focus.y, fz); s.position.copy(s.target.position).addScaledVector(this.sunDir, 350); s.target.updateMatrixWorld();
  }

  private loc: Loc = { idx: 0, frac: 0, lat: 0 };
  /** Ground height anywhere: the road corridor near the track, natural land elsewhere. */
  heightAt(x: number, z: number) {
    const gx = (x - this.gx0) / this.cell, gz = (z - this.gz0) / this.cell, i = Math.floor(gx), j = Math.floor(gz);
    if (i < 0 || j < 0 || i >= this.gw - 1 || j >= this.gh - 1) return this.def.natural(x, z);
    const fx = gx - i, fz = gz - j, h = this.height, k = j * this.gw + i;
    return (h[k] * (1 - fx) + h[k + 1] * fx) * (1 - fz) + (h[k + this.gw] * (1 - fx) + h[k + this.gw + 1] * fx) * fz;
  }
  /** Distance from the centre line (metres) or Infinity when far from the road. */
  roadDist(x: number, z: number) {
    const gx = Math.round((x - this.gx0) / this.cell), gz = Math.round((z - this.gz0) / this.cell);
    if (gx < 0 || gz < 0 || gx >= this.gw || gz >= this.gh) return Infinity;
    const n = this.nearest[gz * this.gw + gx]; if (n < 0) return Infinity;
    return Math.abs(locate(this.track, x, z, n, this.loc).lat);
  }
  /** 1 on the bridge (with short ramps at its ends), 0 elsewhere. */
  bridgeW(s: number, ramp = 6) { const b = this.def.bridge; return b ? sstep(b.from - ramp, b.from + ramp, s) * (1 - sstep(b.to - ramp, b.to + ramp, s)) : 0; }

  private terrain() {
    const t = this.track, d = this.def, cell = this.cell, lim = this.lim, blend = d.cutBlend ?? 55;
    const gw = (this.gw = Math.floor((d.x1 - d.x0) / cell) + 1), gh = (this.gh = Math.floor((d.z1 - d.z0) / cell) + 1);
    const near = (this.nearest = new Int32Array(gw * gh).fill(-1)), nd = new Float32Array(gw * gh).fill(1e9);
    const R = Math.max(18, Math.ceil((lim + 12 + blend) / cell));
    for (let i = 0; i < t.n; i++) { // stamp each track sample onto the grid cells around it
      const cx = Math.round((t.px[i] - this.gx0) / cell), cz = Math.round((t.pz[i] - this.gz0) / cell);
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= gw || z >= gh) continue;
        const dd = Math.hypot(this.gx0 + x * cell - t.px[i], this.gz0 + z * cell - t.pz[i]), k = z * gw + x;
        if (dd < nd[k]) { nd[k] = dd; near[k] = i; }
      }
    }
    const H = (this.height = new Float32Array(gw * gh)), pos = new Float32Array(gw * gh * 3), loc: Loc = { idx: 0, frac: 0, lat: 0 };
    for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) {
      const k = z * gw + x, wx = this.gx0 + x * cell, wz = this.gz0 + z * cell; let h = d.natural(wx, wz);
      if (near[k] >= 0) {
        locate(t, wx, wz, near[k], loc);
        const i = loc.idx, j = Math.min(i + 1, t.n - 1), a = Math.abs(loc.lat), edge = lim + (d.cutEdge ?? 9);
        const ry = t.py[i] + (t.py[j] - t.py[i]) * loc.frac + Math.max(-lim, Math.min(lim, loc.lat)) * t.bank[i];
        const cut = ry - 0.7 + (h - (ry - 0.7)) * sstep(edge, edge + blend, a), w = 1 - this.bridgeW((i + loc.frac) * t.step, 14);
        h = h + (cut - h) * w;
      }
      H[k] = h; pos[k * 3] = wx; pos[k * 3 + 1] = h; pos[k * 3 + 2] = wz;
    }
    const idx = new Uint32Array((gw - 1) * (gh - 1) * 6); let o = 0;
    for (let z = 0; z < gh - 1; z++) for (let x = 0; x < gw - 1; x++) { const k = z * gw + x; idx[o++] = k; idx[o++] = k + gw; idx[o++] = k + 1; idx[o++] = k + 1; idx[o++] = k + gw; idx[o++] = k + gw + 1; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, d.terrainMaterial(this)); mesh.receiveShadow = true; mesh.frustumCulled = false; this.group.add(mesh);
    (this as any).terrainTris = idx.length / 3;
  }

  private road() {
    const t = this.track, n = t.n, hw = t.def.halfWidth, lim = this.lim, L = t.open ? n : n + 1;
    const lats = [-(lim + 10), -lim, -(hw + 1.15), -hw, 0, hw, hw + 1.15, lim, lim + 10], dy = [-0.8, 0, 0.05, 0, 0, 0, 0.05, 0, -0.8], NL = lats.length;
    const pos: number[] = [], uvs: number[] = [], kerb: number[] = [], idx: number[] = [];
    for (let i = 0; i < L; i++) {
      const k = i % n, c = Math.abs(t.curv[k]) > 0.0032 ? 1 : 0, bw = this.bridgeW(k * t.step);
      for (let j = 0; j < NL; j++) {
        let l = lats[j]; if (Math.abs(l) > lim) l = Math.sign(l) * (lim + (Math.abs(l) - lim) * (1 - bw));
        pos.push(t.px[k] - t.tz[k] * l, t.py[k] + Math.max(-lim, Math.min(lim, l)) * t.bank[k] + dy[j] * (1 - bw) + 0.02, t.pz[k] + t.tx[k] * l);
        uvs.push(l, i * t.step); kerb.push(c);
      }
      if (i < L - 1) for (let j = 0; j < NL - 1; j++) { const a = i * NL + j; idx.push(a, a + 1, a + NL, a + 1, a + NL + 1, a + NL); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('kerb', new THREE.Float32BufferAttribute(kerb, 1)); g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this.def.roadMaterial(this)); mesh.receiveShadow = true; mesh.frustumCulled = false; this.group.add(mesh);
  }

  private barriers() {
    const t = this.track, n = t.n, lim = this.lim, L = t.open ? n : n + 1, rail = this.def.barrier === 'rail';
    // concrete: painted top band; rail: a corrugated W-beam on posts
    const prof = rail ? [[0.3, 0.42], [0.36, 0.5], [0.3, 0.58], [0.38, 0.66], [0.3, 0.74], [0.3, 0.78]] : [[0, 0], [0.1, 0.28], [0.17, 0.86], [0.4, 0.86], [0.47, 0.28], [0.57, 0]];
    const bp: number[] = [], bu: number[] = [], bi: number[] = [];
    for (const side of [-1, 1]) {
      const base0 = bp.length / 3;
      for (let i = 0; i < L; i++) {
        const k = i % n;
        for (let j = 0; j < prof.length; j++) { const lt = side * (lim + prof[j][0]); bp.push(t.px[k] - t.tz[k] * lt, t.py[k] + side * lim * t.bank[k] + prof[j][1], t.pz[k] + t.tx[k] * lt); bu.push(i * t.step, prof[j][1]); }
        if (i < L - 1 && this.bridgeW((k + 0.5) * t.step, 1) < 0.5) for (let j = 0; j < prof.length - 1; j++) { const a = base0 + i * prof.length + j, b = a + prof.length; if (side > 0) bi.push(a, b, a + 1, a + 1, b, b + 1); else bi.push(a, a + 1, b, a + 1, b + 1, b); }
      }
    }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(bu, 2)); bg.setIndex(bi); bg.computeVertexNormals();
    let bm: THREE.Material;
    if (rail) {
      bm = new THREE.MeshStandardNodeMaterial({ color: 0xc4c8cc, roughness: 0.38, metalness: 0.85, side: THREE.DoubleSide });
    } else {
      const conc = set('concrete_wall_008'), m = new THREE.MeshStandardNodeMaterial(), stripe = step(0.5, fract(uv().x.div(12))), band = smoothstep(0.5, 0.56, uv().y);
      m.colorNode = mix(texture(conc.map, uv().div(2.5)).rgb.mul(0.85), mix(vec3(0.75, 0.06, 0.05), vec3(0.88), stripe), band.mul(0.9));
      m.roughnessNode = texture(conc.rough, uv().div(2.5)).r; m.normalNode = normalMap(texture(conc.nor, uv().div(2.5)));
      bm = m;
    }
    const bmesh = new THREE.Mesh(bg, bm); bmesh.castShadow = true; bmesh.receiveShadow = true; bmesh.frustumCulled = false; this.group.add(bmesh);
    if (rail) { // posts every 4 m
      const post = new THREE.BoxGeometry(0.14, 0.8, 0.14).translate(0, 0.4, 0), mats: THREE.Matrix4[] = [], q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
      const stp = Math.max(1, Math.round(4 / t.step));
      for (let i = 0; i < n; i += stp) {
        if (this.bridgeW(i * t.step, 1) > 0.5) continue;
        for (const side of [-1, 1]) { const lt = side * (lim + 0.3); q.setFromEuler(new THREE.Euler(0, Math.atan2(-t.tz[i], t.tx[i]), 0)); mats.push(new THREE.Matrix4().compose(new THREE.Vector3(t.px[i] - t.tz[i] * lt, t.py[i] + side * lim * t.bank[i] - 0.05, t.pz[i] + t.tx[i] * lt), q, sc)); }
      }
      const im = new THREE.InstancedMesh(post, std(0x7d8084, 0.6, 0.5), mats.length); mats.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; im.frustumCulled = false; this.group.add(im);
    }
  }

  private sea() {
    const d = this.def, S = d.seaSize ?? 9000, g = new THREE.PlaneGeometry(S, S, 1, 1); g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
    const p = positionWorld.xz, tt = time.mul(0.6);
    const w = (k: number, ax: number, az: number, sp: number) => sin(dot(p, vec2(ax, az)).mul(k).add(tt.mul(sp)));
    const nx = w(0.21, 1, 0.3, 1.1).mul(0.05).add(w(0.83, -0.4, 1, 1.7).mul(0.035)).add(mx_noise_float(vec3(p.mul(0.9), tt)).mul(0.07));
    const nz = w(0.17, 0.2, 1, 0.9).mul(0.05).add(w(0.67, 1, 0.6, 1.5).mul(0.035)).add(mx_noise_float(vec3(p.mul(0.9).add(31), tt)).mul(0.07));
    m.normalNode = vec3(nx, nz, 1).normalize();
    m.colorNode = vec3(...d.seaColor); m.roughnessNode = float(0.07);
    const mesh = new THREE.Mesh(g, m); mesh.position.set(d.seaCenter?.[0] ?? 0, 0, d.seaCenter?.[1] ?? 0); mesh.frustumCulled = false; this.group.add(mesh);
  }

  /** Instanced mesh helper for props. */
  place(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], cols?: THREE.Color[], shadow = true) {
    const im = new THREE.InstancedMesh(geo, mat, mats.length); mats.forEach((mm, i) => { im.setMatrixAt(i, mm); if (cols) im.setColorAt(i, cols[i]); });
    im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false; this.group.add(im); return im;
  }
}
