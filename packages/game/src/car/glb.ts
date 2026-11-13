import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** A downloaded car model, measured. Local axes: +z forward, +y up, +x left; wheels' hubs at `wheels[i].hub`. */
export interface CarKit {
  scene: THREE.Group; /** wheel nodes: front-left, front-right, rear-left, rear-right */ wheels: THREE.Object3D[];
  wheelR: number; wheelbase: number; track: number; halfW: number; halfL: number; /** hub z of the axle midpoint, y of the ground below the hubs */ midZ: number; groundY: number;
  paint: THREE.MeshStandardMaterial | null; glass: THREE.Material | null;
  /** camera anchors in car space: origin on the ground under the axle midpoint, +z forward, +y up, +x left */
  anchors: CarAnchors;
}
export interface CarAnchors { head: THREE.Vector3; hood: THREE.Vector3; bumper: THREE.Vector3; }
/** Anchors for the procedural bodies, which have no mesh to measure. */
export const defaultAnchors = (): CarAnchors => ({ head: new THREE.Vector3(0.36, 1.02, -0.15), hood: new THREE.Vector3(0, 1.02, 0.35), bumper: new THREE.Vector3(0, 0.5, 2.1) });

export const CAR_FILES = ['1990s-sports-car', '1980s-sports-car'];
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

/** Load both models once. Failures leave the kit missing so callers fall back to the procedural body. */
export async function preloadCars(base = '/') {
  const loader = new GLTFLoader();
  await Promise.all(CAR_FILES.map(async (f, i) => {
    try {
      const g = await loader.loadAsync(`${base}assets/cars/${f}.glb`), k = measure(g.scene);
      if (k) kits.set(i, k); else console.warn('car model not recognised', f);
    } catch (e) { console.warn('car model failed', f, e); }
  }));
  try { cockpit = (await loader.loadAsync(`${base}assets/cars/sports-car-cockpit-light.glb`)).scene; } catch (e) { console.warn('cockpit model failed', e); }
}
/** First-person interior (CC0 "Sports Car Cockpit"), drawn only for the player's car in the cockpit view. Same scale and ground as the car models. */
let cockpit: THREE.Group | null = null;
export const cockpitScene = () => cockpit?.clone(true) ?? null;
export const COCKPIT_HEAD = new THREE.Vector3(0.37, 0.98, -0.3);
export const carKit = (kind: number) => kits.get(kind % CAR_FILES.length) ?? null;
