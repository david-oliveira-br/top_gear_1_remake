import * as THREE from 'three/webgpu';
import { mrt, uniform, vec3, vec4, float, fract, sin, instanceIndex, time, mod, normalize, cross, length, smoothstep, positionGeometry, abs, max, mix, attribute, mx_noise_float, positionWorldDirection } from 'three/tsl';
import type { WeatherKind } from '../../../sim/src/index';

/** Shared by every world's materials, so changing the weather only changes uniforms (nothing recompiles). */
export const wetU = uniform(0);
/** particles must not write motion vectors (their animated positions would smear the speed blur) */
const noVel = () => mrt({ velocity: vec4(0, 0, 0, 0) });
export const snowU = uniform(0);
/** 0..1 lightning flash */
export const flashU = uniform(0);

/** Puddle mask 0..1 from low-frequency noise in road coordinates (l = lateral, s = along). */
export function puddles(l: any, s: any) {
  const n = mx_noise_float(vec3(l.mul(0.2), s.mul(0.06), 1.7)).mul(0.5).add(0.5), n2 = mx_noise_float(vec3(l.mul(0.8), s.mul(0.3), 4.3)).mul(0.5).add(0.5);
  const k = n.mul(0.78).add(n2.mul(0.22)), t = float(0.74).sub(wetU.mul(0.27));
  return smoothstep(t, t.add(0.08), k);
}
/**
 * Wet asphalt: darker, much smoother, flat reflective puddles. `keep` is the 0..1 mask of paint and kerbs, which stay readable.
 * Returns the replacement colour, roughness and the amount (0..1) by which to flatten the normal map.
 */
export function wetRoad(color: any, rough: any, onRoad: any, keep: any, l: any, s: any) {
  const p = puddles(l, s), w = wetU.mul(onRoad).toVar();
  const col = color.mul(mix(float(1), float(0.5), w.mul(float(1).sub(keep.mul(0.55)))));
  const r = mix(rough, mix(float(0.32), float(0.035), p), w.mul(1.5).min(1));
  return { color: col, rough: r, flat: p.mul(w).mul(0.9) };
}
/** Snow covers verges and land (not the road): whitens upward-facing ground; wet darkens and smooths it a little. */
export function weatherGround(color: any, rough: any, up: any, cover: any = float(1)) {
  const sn = snowU.mul(cover).mul(smoothstep(0.45, 0.8, up).mul(0.9).add(0.1)).mul(0.92);
  const c = mix(color.mul(mix(float(1), float(0.72), wetU)), vec3(0.86, 0.9, 0.96), sn.min(1));
  return { color: c, rough: mix(mix(rough, rough.mul(0.65), wetU), float(0.75), sn.min(1)) };
}
/** Sky for overcast kinds: a gradient with soft cloud mottling, plus the lightning flash. */
export function skyNode(horizon: any, zenith: any) {
  const d = positionWorldDirection, up = d.y.max(0), cl = mx_noise_float(vec3(d.x, d.z, 0.2).div(up.add(0.35)).mul(1.6)).mul(0.5).add(0.5);
  const base = mix(horizon, zenith, smoothstep(0.0, 0.75, up));
  return base.mul(mix(float(0.82), float(1.12), cl)).add(flashU.mul(vec3(0.55, 0.6, 0.75)));
}

export interface WeatherLook {
  sun: number; sunColor: number | null; env: number; bg: number;
  /** horizon / zenith colours of the replacement sky (null keeps the HDR) */
  sky: [[number, number, number], [number, number, number]] | null;
  /** fog near / far in metres (null keeps the world's own) */
  fog: [number, number] | null;
  lamps: number; rain: number; snow: number; wind: number;
}
export const LOOK: Record<WeatherKind, WeatherLook> = {
  clear: { sun: 5.5, sunColor: null, env: 0.75, bg: 1, sky: null, fog: null, lamps: 1, rain: 0, snow: 0, wind: 0 },
  overcast: { sun: 1.6, sunColor: 0xdfe6f0, env: 0.8, bg: 1, sky: [[0.5, 0.53, 0.57], [0.3, 0.33, 0.39]], fog: [250, 4500], lamps: 1.3, rain: 0, snow: 0, wind: 0.35 },
  rain: { sun: 0.6, sunColor: 0xb8c4d4, env: 0.55, bg: 1, sky: [[0.3, 0.32, 0.35], [0.15, 0.17, 0.2]], fog: [40, 1000], lamps: 2.2, rain: 1, snow: 0, wind: 0.5 },
  storm: { sun: 0.2, sunColor: 0x90a0b8, env: 0.4, bg: 1, sky: [[0.14, 0.15, 0.18], [0.045, 0.05, 0.07]], fog: [20, 600], lamps: 3, rain: 2, snow: 0, wind: 1 },
  fog: { sun: 1.8, sunColor: 0xf0ece4, env: 0.85, bg: 1, sky: [[0.6, 0.62, 0.64], [0.55, 0.58, 0.62]], fog: [6, 250], lamps: 3, rain: 0, snow: 0, wind: 0.1 },
  snow: { sun: 1.0, sunColor: 0xd6e2f4, env: 0.8, bg: 1, sky: [[0.58, 0.63, 0.69], [0.4, 0.46, 0.55]], fog: [20, 700], lamps: 2.2, rain: 0, snow: 1, wind: 0.3 },
};

/** Rain streaks and snow flakes: two instanced meshes of quads animated entirely in the vertex shader, wrapped around the camera. */
export class Precip {
  group = new THREE.Group();
  private rainGeo: THREE.InstancedBufferGeometry; private snowGeo: THREE.InstancedBufferGeometry; private rain: THREE.Mesh; private snow: THREE.Mesh;
  private ctr = uniform(new THREE.Vector3()); private camP = uniform(new THREE.Vector3()); private camV = uniform(new THREE.Vector3());
  private right = uniform(new THREE.Vector3(1, 0, 0)); private up = uniform(new THREE.Vector3(0, 1, 0));
  private intensity = uniform(1); private tint = uniform(new THREE.Vector3(1, 1, 1));
  private prev = new THREE.Vector3(); private have = false; private t0 = 0; private fwd = new THREE.Vector3(); private m = new THREE.Matrix4();
  private readonly maxRain = 10000; private readonly maxSnow = 12000;

  constructor(private detail: number) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const mk = (n: number) => { const g = new THREE.InstancedBufferGeometry(); g.copy(plane as any); g.instanceCount = n; return g; };
    this.rainGeo = mk(0); this.snowGeo = mk(0);
    const id = float(instanceIndex), rnd = (k: number) => fract(sin(id.mul(12.9898).add(k * 78.233)).mul(43758.5453));
    const px = positionGeometry.x, py = positionGeometry.y, vv = positionGeometry.xy.add(0.5);

    // ---- rain: thin streaks along the apparent velocity (fall + wind - camera motion) ----
    {
      const size = vec3(36, 22, 36), fall = float(17).mul(rnd(4).mul(0.3).add(0.85)), vel = vec3(float(2.4), fall.negate(), float(1.2)); // wind slant
      const rel = mod(vec3(rnd(1), rnd(2), rnd(3)).mul(size).add(vel.mul(time)).sub(this.ctr), size).sub(size.mul(0.5));
      const centre = this.ctr.add(rel), va = vel.sub(this.camV), a = normalize(va), view = normalize(centre.sub(this.camP)), side = normalize(cross(a, view));
      const len = float(0.5).add(length(va).mul(0.016)).mul(rnd(5).mul(0.6).add(0.7)), w = float(0.014).mul(rnd(6).mul(0.8).add(0.6));
      const dist = length(centre.sub(this.camP)), edge = max(max(abs(rel.x).div(size.x), abs(rel.y).div(size.y)), abs(rel.z).div(size.z));
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
      m.positionNode = centre.add(a.mul(py.mul(len))).add(side.mul(px.mul(w).mul(dist.mul(0.35).add(1).min(6))));
      m.colorNode = vec3(0.78, 0.84, 0.92).mul(this.tint);
      m.opacityNode = smoothstep(0.5, 0.15, abs(vv.x.sub(0.5))).mul(smoothstep(0.0, 0.3, vv.y)).mul(smoothstep(1.0, 0.7, vv.y)).mul(smoothstep(2, 7, dist)).mul(smoothstep(0.5, 0.36, edge)).mul(this.intensity).mul(0.32);
      this.rain = new THREE.Mesh(this.rainGeo, m); this.rain.frustumCulled = false; this.rain.renderOrder = 10;
    }
    // ---- snow: round flakes drifting slowly with a sway ----
    {
      const size = vec3(30, 18, 30), fall = float(1.5).mul(rnd(4).mul(0.6).add(0.7)), vel = vec3(float(0.6), fall.negate(), float(0.3));
      const rel = mod(vec3(rnd(1), rnd(2), rnd(3)).mul(size).add(vel.mul(time)).sub(this.ctr), size).sub(size.mul(0.5));
      const sway = vec3(sin(time.mul(0.7).add(rnd(5).mul(6.28))), sin(time.mul(0.9).add(rnd(6).mul(6.28))).mul(0.3), sin(time.mul(0.6).add(rnd(7).mul(6.28)))).mul(0.5);
      const centre = this.ctr.add(rel).add(sway), dist = length(centre.sub(this.camP)), edge = max(max(abs(rel.x).div(size.x), abs(rel.y).div(size.y)), abs(rel.z).div(size.z));
      const sz = float(0.055).mul(rnd(8).mul(0.9).add(0.55)).mul(dist.mul(0.12).add(1).min(2.5));
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
      m.positionNode = centre.add(this.right.mul(px.mul(sz))).add(this.up.mul(py.mul(sz)));
      m.colorNode = vec3(0.95, 0.97, 1).mul(this.tint);
      m.opacityNode = smoothstep(0.5, 0.25, length(vv.sub(0.5))).mul(smoothstep(0.4, 2.0, dist)).mul(smoothstep(0.5, 0.36, edge)).mul(this.intensity).mul(0.85);
      this.snow = new THREE.Mesh(this.snowGeo, m); this.snow.frustumCulled = false; this.snow.renderOrder = 10;
    }
    this.group.add(this.rain, this.snow); this.group.visible = false;
  }

  /** rain: 0 none, 1 rain, 2 storm; snow: 0/1. `light` dims the colour with the sky. */
  set(rain: number, snow: number, light: number) {
    const d = this.detail;
    this.rainGeo.instanceCount = rain ? Math.round((rain > 1 ? this.maxRain * 0.6 : this.maxRain * 0.28) * d) : 0;
    this.snowGeo.instanceCount = snow ? Math.round(this.maxSnow * d) : 0;
    this.rain.visible = rain > 0; this.snow.visible = snow > 0; this.group.visible = rain > 0 || snow > 0;
    this.tint.value.setScalar(light); this.intensity.value = rain > 1 ? 0.7 : 0.5;
  }
  update(cam: THREE.Camera, dt: number) {
    if (!this.group.visible) return;
    const now = performance.now() / 1000, d = Math.max(1e-3, this.t0 ? Math.min(0.1, now - this.t0) : dt); this.t0 = now;
    this.camP.value.copy(cam.position);
    if (this.have) { const k = Math.min(1, d * 12), v = this.camV.value; const dx = (cam.position.x - this.prev.x) / d, dy = (cam.position.y - this.prev.y) / d, dz = (cam.position.z - this.prev.z) / d; if (Math.hypot(dx, dz) < 220) { v.x += (dx - v.x) * k; v.y += (dy - v.y) * k; v.z += (dz - v.z) * k; } else v.set(0, 0, 0); }
    this.have = true; this.prev.copy(cam.position);
    cam.getWorldDirection(this.fwd); this.ctr.value.copy(cam.position).addScaledVector(this.fwd, 9);
    this.m.copy(cam.matrixWorld); this.right.value.setFromMatrixColumn(this.m, 0); this.up.value.setFromMatrixColumn(this.m, 1);
  }
}

/** Soft puffs of water thrown up behind the cars on a wet road: a ring buffer written on the CPU, animated by age in the shader. */
export class Spray {
  mesh: THREE.Mesh; private geo: THREE.InstancedBufferGeometry; private a: THREE.InstancedBufferAttribute; private b: THREE.InstancedBufferAttribute; private n: number; private head = 0;
  private now = uniform(0); private right = uniform(new THREE.Vector3(1, 0, 0)); private up = uniform(new THREE.Vector3(0, 1, 0)); private tint = uniform(new THREE.Vector3(1, 1, 1));
  private acc: number[] = []; private t = 0; private m = new THREE.Matrix4();
  readonly life = 0.95;

  constructor(cars: number, perCar = 36) {
    this.n = cars * perCar;
    const plane = new THREE.PlaneGeometry(1, 1); this.geo = new THREE.InstancedBufferGeometry(); this.geo.copy(plane as any); this.geo.instanceCount = this.n;
    const A = new Float32Array(this.n * 4), B = new Float32Array(this.n * 4); for (let i = 0; i < this.n; i++) A[i * 4 + 3] = -100;
    this.a = new THREE.InstancedBufferAttribute(A, 4); this.b = new THREE.InstancedBufferAttribute(B, 4); this.geo.setAttribute('iA', this.a); this.geo.setAttribute('iB', this.b);
    const ia = attribute('iA', 'vec4'), ib = attribute('iB', 'vec4'), age = this.now.sub(ia.w), k = age.div(this.life);
    const centre = ia.xyz.add(ib.xyz.mul(age)).add(vec3(0, age.mul(age).mul(-0.8), 0)), sz = ib.w.mul(k.mul(2.4).add(1));
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
    m.positionNode = centre.add(this.right.mul(positionGeometry.x.mul(sz))).add(this.up.mul(positionGeometry.y.mul(sz)));
    m.colorNode = vec3(0.8, 0.85, 0.9).mul(this.tint);
    m.opacityNode = smoothstep(0.5, 0.0, length(positionGeometry.xy)).mul(float(1).sub(k).max(0).pow(1.6)).mul(0.3);
    this.mesh = new THREE.Mesh(this.geo, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 9;
    for (let i = 0; i < cars; i++) this.acc.push(0);
  }
  setLight(l: number) { this.tint.value.setScalar(l); }
  /** car `i` at (x,z) heading (fx,fz), forward speed in m/s */
  emit(i: number, dt: number, x: number, y: number, z: number, fx: number, fz: number, speed: number) {
    if (speed < 18) return;
    this.acc[i] += dt * (10 + speed * 0.6); const A = this.a.array as Float32Array, B = this.b.array as Float32Array, per = this.n / this.acc.length;
    while (this.acc[i] >= 1) {
      this.acc[i] -= 1; const side = Math.random() < 0.5 ? -1 : 1, j = i * per + (this.head++ % per), o = j * 4, r = Math.random();
      A[o] = x - fx * 1.5 - fz * side * 0.85 + (Math.random() - 0.5) * 0.3; A[o + 1] = y + 0.15; A[o + 2] = z - fz * 1.5 + fx * side * 0.85 + (Math.random() - 0.5) * 0.3; A[o + 3] = this.t;
      B[o] = -fx * speed * 0.18 + (Math.random() - 0.5) * 1.6 - fz * side * 1.0; B[o + 1] = 0.8 + r * 1.6; B[o + 2] = -fz * speed * 0.18 + (Math.random() - 0.5) * 1.6 + fx * side * 1.0; B[o + 3] = 0.55 + r * 0.6;
    }
  }
  update(dt: number, cam: THREE.Camera) {
    this.t += dt; this.now.value = this.t; this.a.needsUpdate = true; this.b.needsUpdate = true;
    this.m.copy(cam.matrixWorld); this.right.value.setFromMatrixColumn(this.m, 0); this.up.value.setFromMatrixColumn(this.m, 1);
  }
  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
