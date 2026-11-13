import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** A downloaded car model, measured. Local axes: +z forward, +y up, +x left; wheels' hubs at `wheels[i].hub`. */
export interface CarKit {
  scene: THREE.Group; /** wheel nodes: front-left, front-right, rear-left, rear-right */ wheels: THREE.Object3D[];
  wheelR: number; wheelbase: number; track: number; halfW: number; halfL: number; /** hub z of the axle midpoint, y of the ground below the hubs */ midZ: number; groundY: number;
  paint: THREE.MeshStandardMaterial | null; glass: THREE.Material | null;
}
export const CAR_FILES = ['1990s-sports-car', '1980s-sports-car'];
const kits = new Map<number, CarKit>();

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
  return { scene: root, wheels: w, wheelR, wheelbase, track: Math.abs(pos[0].x - pos[1].x), halfW: Math.max(bb.max.x, -bb.min.x), halfL: (bb.max.z - bb.min.z) / 2, midZ, groundY: pos[0].y - wheelR, paint, glass };
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
}
export const carKit = (kind: number) => kits.get(kind % CAR_FILES.length) ?? null;
