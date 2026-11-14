import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import manifest from './models.gen.json';
import type { CarId } from '../../../sim/src/index';

/** A downloaded car model, measured. Local axes: +z forward, +y up, +x left; wheels' hubs at `wheels[i].hub`. */
export interface CarKit {
  scene: THREE.Group; /** wheel nodes: front-left, front-right, rear-left, rear-right */ wheels: THREE.Object3D[];
  wheelR: number; wheelbase: number; track: number; halfW: number; halfL: number; /** hub z of the axle midpoint, y of the ground below the hubs */ midZ: number; groundY: number;
  paint: THREE.MeshStandardMaterial | null; glass: THREE.Material | null;
  /** camera anchors in car space: origin on the ground under the axle midpoint, +z forward, +y up, +x left */
  anchors: CarAnchors;
  /** only for the Car Concept: hub positions (scene space), the yaw each wheel node's axle is off the car's x axis, and the steering wheel's centre/axis */
  /** normalised Sketchfab cars (tools/build-cars.mjs): the manifest entry */
  norm?: NormInfo;
  concept?: { hubs: THREE.Vector3[]; axleYaw: number[]; steerCentre: THREE.Vector3; steerAxis: THREE.Vector3 };
}
export interface NormInfo { paintable: boolean; staticWheels: boolean; tris: number; }
export interface CarAnchors { head: THREE.Vector3; hood: THREE.Vector3; bumper: THREE.Vector3; }
/** Anchors for the procedural bodies, which have no mesh to measure. */
export const defaultAnchors = (): CarAnchors => ({ head: new THREE.Vector3(0.36, 1.02, -0.15), hood: new THREE.Vector3(0, 1.02, 0.35), bumper: new THREE.Vector3(0, 0.5, 2.1) });

/** Model kinds, by index: 0 is the Car Concept (the Aurora); 1 and 2 are the older CC0 coupes (kept for the procedural fallback); 3.. are the normalised selectable cars. */
export interface ModelDef { file: string; type: 'concept' | 'legacy' | 'norm'; car?: CarId; }
export const CAR_MODELS: ModelDef[] = [
  { file: 'CarConcept', type: 'concept', car: 'aurora' }, { file: '1990s-sports-car', type: 'legacy' }, { file: '1980s-sports-car', type: 'legacy' },
  ...(['corvette', 'cuda', 'mustang', 'golf', 'm635', 'alfa155'] as CarId[]).map((c): ModelDef => ({ file: c, type: 'norm', car: c })),
];
/** Model kind that draws a car (falls back to the Aurora). */
export const kindOf = (id: string): number => Math.max(0, CAR_MODELS.findIndex((m) => m.car === id));
export const kindCar = (kind: number): CarId => CAR_MODELS[kind]?.car ?? 'aurora';
/** Models with a heavy mesh: rivals beyond a handful fall back to a lighter one. */
export const isHeavy = (kind: number) => kind === 0 || ((kits.get(kind)?.norm?.tris ?? 0) >= 60000);
const kits = new Map<number, CarKit>();

const track = (pos: THREE.Vector3[]) => Math.abs(pos[0].x - pos[1].x);
export const HEAD_X = 0.27, HEAD_H = 1.0;
function measure(root: THREE.Group): CarKit | null {
  root.updateMatrixWorld(true);
  const find = (s: string) => { let f: THREE.Object3D | null = null; root.traverse((o) => { if (!f && o.name.toLowerCase().endsWith(s)) f = o; }); return f as THREE.Object3D | null; };
  const wheels = ['_wheel_fl', '_wheel_fr', '_wheel_rl', '_wheel_rr'].map(find);
  if (wheels.some((w) => !w)) return null;
  const w = wheels as THREE.Object3D[];
  const box = new THREE.Box3(), pos = w.map((o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld));
  box.setFromObject(w[0]); const wheelR = (box.max.y - box.min.y) / 2;
  // body box excludes the wheels
  const bb = new THREE.Box3(); root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !w.some((x) => x === o || x.getObjectById(o.id))) bb.expandByObject(o); });
  const wheelbase = (pos[0].z + pos[1].z) / 2 - (pos[2].z + pos[3].z) / 2, midZ = (pos[0].z + pos[1].z + pos[2].z + pos[3].z) / 4;
  let paint: THREE.MeshStandardMaterial | null = null, glass: THREE.Material | null = null, best = 0;
  root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || w.some((x) => x.getObjectById(o.id) || x === o)) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mt of mats) { if (mt.transparent) glass = mt; else if (m.geometry.attributes.position.count > best) { best = m.geometry.attributes.position.count; paint = mt as THREE.MeshStandardMaterial; } } });
  if (glass) { const g = glass as THREE.MeshStandardMaterial; g.color.multiplyScalar(0.3); g.opacity = 0.6; g.roughness = 0.05; }
  // anchors: raycast down onto the bodywork to find the roof/bonnet heights
  const rc = new THREE.Raycaster(), meshes: THREE.Object3D[] = []; root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !w.some((x) => x === o || x.getObjectById(o.id)) && !((o as THREE.Mesh).material as THREE.Material).transparent) meshes.push(o); });
  const topAt = (x: number, z: number) => { rc.set(new THREE.Vector3(x, bb.max.y + 1, z), new THREE.Vector3(0, -1, 0)); const h = rc.intersectObjects(meshes, false)[0]; return h ? h.point.y : bb.min.y; };
  const gy = pos[0].y - wheelR, headZ = midZ - wheelbase * 0.12, noseZ = bb.max.z;
  const anchors: CarAnchors = {
    head: new THREE.Vector3(HEAD_X * track(pos), HEAD_H, headZ - midZ),
    hood: new THREE.Vector3(0, topAt(0, midZ + wheelbase * 0.3) - gy + 0.42, wheelbase * 0.12),
    bumper: new THREE.Vector3(0, 0.5, noseZ - midZ - 0.15),
  };
  return { anchors, scene: root, wheels: w, wheelR, wheelbase, track: Math.abs(pos[0].x - pos[1].x), halfW: Math.max(bb.max.x, -bb.min.x), halfL: (bb.max.z - bb.min.z) / 2, midZ, groundY: pos[0].y - wheelR, paint, glass };
}


/** Normalised car (+x left, +z forward, y up, origin on the ground under the axle midpoint): wheel_FL/FR/RL/RR nodes at the hubs, materials 'paint' and 'glass'. */
function measureNorm(root: THREE.Group, id: string): CarKit | null {
  root.updateMatrixWorld(true);
  const info = (manifest as Record<string, { wheelR: number; wheelbase: number; track: number; halfW: number; halfL: number; paintable: boolean; staticWheels: boolean; tris: number }>)[id]; if (!info) return null;
  const find = (s: string) => { let f: THREE.Object3D | null = null; root.traverse((o) => { if (!f && o.name === s) f = o; }); return f as THREE.Object3D | null; };
  const w = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map(find) as THREE.Object3D[];
  if (w.some((x) => !x)) return null;
  const inWheel = (o: THREE.Object3D) => w.some((x) => x === o || x.getObjectById(o.id));
  const bb = new THREE.Box3(); root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !inWheel(o)) bb.expandByObject(o); });
  let paint: THREE.MeshStandardMaterial | null = null, glass: THREE.Material | null = null;
  root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; for (const mt of Array.isArray(m.material) ? m.material : [m.material]) { if (mt.name === 'paint') paint = mt as THREE.MeshStandardMaterial; else if (mt.name === 'glass') glass = mt; } });
  if (glass) { const g = glass as THREE.MeshStandardMaterial; g.transparent = true; g.depthWrite = false; g.color.multiplyScalar(0.3); g.opacity = 0.6; g.roughness = 0.05; }
  const rc = new THREE.Raycaster(), meshes: THREE.Object3D[] = []; root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !inWheel(o) && !(m.material as THREE.Material).transparent) meshes.push(o); });
  const topAt = (x: number, z: number) => { rc.set(new THREE.Vector3(x, bb.max.y + 1, z), new THREE.Vector3(0, -1, 0)); const h = rc.intersectObjects(meshes, false)[0]; return h ? h.point.y : bb.min.y; };
  const wb = info.wheelbase;
  const anchors: CarAnchors = {
    head: new THREE.Vector3(HEAD_X * info.track, HEAD_H, -wb * 0.12),
    hood: new THREE.Vector3(0, topAt(0, wb * 0.3) + 0.42, wb * 0.12),
    bumper: new THREE.Vector3(0, 0.5, bb.max.z - 0.15),
  };
  return { anchors, scene: root, wheels: w, wheelR: info.wheelR, wheelbase: wb, track: info.track, halfW: info.halfW, halfL: info.halfL, midZ: 0, groundY: 0, paint, glass,
    norm: { paintable: info.paintable, staticWheels: info.staticWheels, tris: info.tris } };
}

/** Plain Brazilian-style plate: the model's own texture carries the Khronos logo, which the licence excludes, so it is never used. */
function plateTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160; const g = c.getContext('2d')!;
  g.fillStyle = '#e9e9e4'; g.fillRect(0, 0, 512, 160); g.fillStyle = '#1d3f9a'; g.fillRect(0, 0, 512, 34);
  g.strokeStyle = '#161616'; g.lineWidth = 6; g.strokeRect(5, 5, 502, 150);
  g.fillStyle = '#161616'; g.font = 'bold 104px "Rajdhani", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText('RHZ 1A23', 256, 136);
  const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const flatTexture = (css: string) => { const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d')!; g.fillStyle = css; g.fillRect(0, 0, 8, 8); const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; return t; };

/** The model carries Khronos and 3D Commerce logos (CC BY covers the model, not logos or trademarks): plate text, tyre sidewalls (colour and relief), and an emissive "logo" map reused by rims, brake calipers, mirrors and the steering emblem. All are replaced. */
function scrubLogos(root: THREE.Object3D) {
  const mats = new Set<THREE.MeshPhysicalMaterial>(); root.traverse((o) => { const m = (o as THREE.Mesh).material; if ((o as THREE.Mesh).isMesh) for (const x of Array.isArray(m) ? m : [m]) mats.add(x as THREE.MeshPhysicalMaterial); });
  let plate: unknown = null; for (const m of mats) if (m.name === 'License') { plate = m.map?.image; m.map = plateTexture(); }
  for (const m of mats) {
    if (m.emissiveMap && plate && m.emissiveMap.image === plate) { m.emissiveMap = null; m.emissive.setRGB(0, 0, 0); }
    if (m.name === 'Tireside') {
      if (m.map) m.map = flatTexture('#1c1c1c');
      const n = m.normalMap, im = n?.image as ImageBitmap | undefined;
      if (n && im) {
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d')!; g.drawImage(im, 0, 0);
        const px = g.getImageData(c.width / 2, c.height / 2, 1, 1).data; g.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`; const k = c.width / 1024;
        g.fillRect(0, 330 * k, 112 * k, 340 * k); g.fillRect(940 * k, 410 * k, 84 * k, 210 * k); // Khronos wordmark (left) and 3D Commerce mark (right)
        const t = new THREE.CanvasTexture(c); t.flipY = false; t.anisotropy = 8; m.normalMap = t;
      }
    }
  }
}

/** Node name of a mesh: multi-material nodes load as a group holding `mesh_N` children. */
export const partName = (o: THREE.Object3D) => (/^mesh_\d+/.test(o.name) && o.parent ? o.parent.name : o.name);
function measureConcept(root: THREE.Group): CarKit | null {
  scrubLogos(root); root.updateMatrixWorld(true);
  const find = (s: string) => { let f: THREE.Object3D | null = null; root.traverse((o) => { if (!f && o.name === s) f = o; }); return f as THREE.Object3D | null; };
  const w = ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR'].map(find) as THREE.Object3D[];
  if (w.some((x) => !x)) return null;
  const isWheel = (o: THREE.Object3D) => w.some((x) => x === o || x.getObjectById(o.id)) || o.name === 'Axles';
  const pos = w.map((o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)), box = new THREE.Box3().setFromObject(w[0], true), wheelR = (box.max.y - box.min.y) / 2;
  const bb = new THREE.Box3(); root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !isWheel(o) && !/Wiper/.test(o.name)) bb.union(new THREE.Box3().setFromObject(o, true)); });
  const wheelbase = (pos[0].z + pos[1].z) / 2 - (pos[2].z + pos[3].z) / 2, midZ = (pos[0].z + pos[1].z + pos[2].z + pos[3].z) / 4, groundY = pos[0].y - wheelR;
  // front wheels are modelled steered; the axle of each node, as a yaw about y, is what we must undo
  const axleYaw = w.map((o) => { const e = o.matrixWorld.elements, a = Math.atan2(e[2], e[0]); return Math.abs(a) > Math.PI / 2 ? a - Math.sign(a) * Math.PI : a; });
  // steering wheel: centre and axis (the ring's thinnest direction) from its vertices
  const ring: THREE.Vector3[] = [], v = new THREE.Vector3(); root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && /^InteriorSteeringWheel0[12]$/.test(partName(m))) { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) ring.push(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).clone()); } });
  const c = new THREE.Vector3(); for (const p of ring) c.add(p); c.divideScalar(Math.max(1, ring.length));
  const cov = [0, 0, 0, 0, 0, 0]; for (const p of ring) { const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z; cov[0] += x * x; cov[1] += x * y; cov[2] += x * z; cov[3] += y * y; cov[4] += y * z; cov[5] += z * z; }
  const tr = cov[0] + cov[3] + cov[5], n = new THREE.Vector3(0.1, 0.5, 1); for (let i = 0; i < 60; i++) { n.set(tr * n.x - (cov[0] * n.x + cov[1] * n.y + cov[2] * n.z), tr * n.y - (cov[1] * n.x + cov[3] * n.y + cov[4] * n.z), tr * n.z - (cov[2] * n.x + cov[4] * n.y + cov[5] * n.z)).normalize(); }
  if (n.z < 0) n.negate();
  const mid = new THREE.Vector3(0, groundY, midZ);
  const rc = new THREE.Raycaster(), meshes: THREE.Object3D[] = []; root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !isWheel(o) && !/Wiper|Interior|Engine/.test(partName(o))) meshes.push(o); });
  const topAt = (x: number, z: number) => { rc.set(new THREE.Vector3(x, bb.max.y + 1, z), new THREE.Vector3(0, -1, 0)); const h = rc.intersectObjects(meshes, false)[0]; return h ? h.point.y : bb.min.y; };
  const anchors: CarAnchors = {
    head: new THREE.Vector3(c.x, c.y + 0.33, c.z - 0.655).sub(mid), // eye of the centre-seat driver, just behind the wheel
    hood: new THREE.Vector3(0, topAt(0, midZ + wheelbase * 0.3) - groundY + 0.42, wheelbase * 0.12),
    bumper: new THREE.Vector3(0, 0.5, bb.max.z - midZ - 0.15),
  };
  return { anchors, scene: root, wheels: w, wheelR, wheelbase, track: Math.abs(pos[0].x - pos[1].x), halfW: Math.max(bb.max.x, -bb.min.x), halfL: (bb.max.z - bb.min.z) / 2, midZ, groundY, paint: null, glass: null,
    concept: { hubs: pos, axleYaw, steerCentre: c, steerAxis: n } };
}

/** Load all models once. Failures leave the kit missing so callers fall back to the procedural body. */
export async function preloadCars(base = '/') {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(CAR_MODELS.map(async (m, i) => {
    if (m.type === 'legacy') return; // the CC0 coupes are no longer drawn; kinds 1 and 2 fall back to procedural bodies
    try {
      const g = await loader.loadAsync(`${base}assets/cars/${m.file}.glb`), k = m.type === 'concept' ? measureConcept(g.scene) : m.type === 'norm' ? measureNorm(g.scene, m.file) : measure(g.scene);
      if (k) kits.set(i, k); else console.warn('car model not recognised', m.file);
    } catch (e) { console.warn('car model failed', m.file, e); }
  }));
  try { cockpit = (await loader.loadAsync(`${base}assets/cars/sports-car-cockpit-light.glb`)).scene; } catch (e) { console.warn('cockpit model failed', e); }
}
/** First-person interior (CC0 "Sports Car Cockpit"), drawn only for the player's car in the cockpit view. Same scale and ground as the car models. */
let cockpit: THREE.Group | null = null;
export const cockpitScene = () => cockpit?.clone(true) ?? null;
export const COCKPIT_HEAD = new THREE.Vector3(0.37, 0.98, -0.3);
export const carKit = (kind: number) => kits.get(kind) ?? null;
