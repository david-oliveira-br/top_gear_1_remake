import * as THREE from 'three/webgpu';
import { texture, uv, mix, vec3, float, uniform, step, max } from 'three/tsl';
import { buildBody, type BodyParts } from './body';

export const PAINTS = ['#c8102e', '#f2b01e', '#1565d8', '#0f8f5a', '#e8e8ec', '#141518', '#f05a14', '#7a2bd0', '#12b5c9', '#d81b77', '#8a8f98', '#b9d21a', '#101c3a', '#5a1010'];
export const FINISHES = ['Metálico', 'Sólido', 'Fosco', 'Perolado'];

let parts: BodyParts | null = null;
const shared = () => (parts ??= buildBody());
const std = (color: number, roughness: number, metalness: number) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
let mats: { dark: THREE.Material; chrome: THREE.Material; tyre: THREE.Material; rim: THREE.Material[]; disc: THREE.Material } | null = null;
const common = () => (mats ??= {
  dark: std(0x0b0c0e, 0.55, 0.1), chrome: std(0xd8dade, 0.12, 1), tyre: std(0x0a0a0b, 0.86, 0), disc: std(0x55585e, 0.4, 0.9),
  rim: [std(0xb9bcc4, 0.22, 1), std(0x17181b, 0.3, 0.85), std(0xc79a3a, 0.25, 1)],
});

/** One car on screen: body, wheels, lamps. Pose it with `place` every frame. */
export class CarVisual {
  group = new THREE.Group(); body = new THREE.Group();
  private wheels: THREE.Group[] = []; private wing: THREE.Mesh; private rims: THREE.Mesh[] = [];
  private paint = uniform(new THREE.Color()); private brake = uniform(0); private lamps = uniform(1);
  private metal = uniform(0.7); private rough = uniform(0.36); private coat = uniform(1);
  private tailMat: THREE.MeshStandardNodeMaterial; private headMat: THREE.MeshStandardNodeMaterial;
  private spin = 0; private pitch = 0; private roll = 0; private heave = 0; readonly parts = shared();

  constructor() {
    const p = this.parts, c = common();
    const m = new THREE.MeshPhysicalNodeMaterial();
    const k = texture(p.mask, uv()), glass = k.r, lamp = k.g, trim = k.b, off = max(glass, trim);
    m.colorNode = mix(mix(mix(this.paint, vec3(0.004, 0.005, 0.007), glass), vec3(0.014), trim), vec3(0.55), lamp);
    m.roughnessNode = mix(mix(mix(this.rough, float(0.03), glass), float(0.6), trim), float(0.15), lamp);
    m.metalnessNode = mix(this.metal, float(0), max(off, lamp));
    m.clearcoatNode = mix(this.coat, float(1), glass).mul(float(1).sub(trim)); m.clearcoatRoughnessNode = float(0.035);
    const front = step(0.5, uv().x);
    m.emissiveNode = lamp.mul(mix(vec3(1, 0.03, 0.02).mul(this.lamps.mul(0.9).add(this.brake.mul(7))), vec3(1, 0.93, 0.8).mul(this.lamps.mul(2.2)), front));
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.body) => { const q = new THREE.Mesh(g, mat); q.castShadow = true; q.receiveShadow = true; parent.add(q); return q; };
    add(p.shell, m); add(p.dark, c.dark); add(p.chrome, c.chrome);
    this.tailMat = new THREE.MeshStandardNodeMaterial({ color: 0x300404, roughness: 0.2 }); this.tailMat.emissiveNode = vec3(1, 0.04, 0.02).mul(this.lamps.mul(1.2).add(this.brake.mul(8)));
    this.headMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.2 }); this.headMat.emissiveNode = vec3(1, 0.95, 0.85).mul(this.lamps.mul(3));
    add(p.tail, this.tailMat); add(p.head, this.headMat);
    this.wing = add(p.wing, c.dark); this.wing.visible = false;
    for (const [z, sx] of [[p.axleR, 1], [p.axleR, -1], [p.axleF, 1], [p.axleF, -1]]) {
      const w = new THREE.Group(), turn = new THREE.Group(); w.add(turn);
      add(p.wheel.tyre, c.tyre, turn); this.rims.push(add(p.wheel.rim, c.rim[0], turn)); add(p.wheel.disc, c.disc, turn);
      turn.name = 'turn'; if (sx < 0) w.scale.x = -1;
      w.position.set(sx * p.track, p.shape.wheelR, z); this.group.add(w); this.wheels.push(w);
    }
    this.group.add(this.body); this.group.rotation.order = 'YXZ';
  }
  setLook(o: { paint: number; finish?: number; wheels?: number; aero?: number; lower?: number }) {
    this.paint.value.set(PAINTS[o.paint % PAINTS.length]).convertSRGBToLinear();
    const f = o.finish ?? 0;
    this.metal.value = [0.75, 0.05, 0.3, 0.9][f]; this.rough.value = [0.36, 0.3, 0.62, 0.28][f]; this.coat.value = [1, 1, 0, 1][f];
    for (const r of this.rims) r.material = common().rim[(o.wheels ?? 0) % 3];
    this.wing.visible = (o.aero ?? 0) > 0; this.wing.scale.setScalar(1); this.wing.position.y = (o.aero ?? 0) >= 3 ? 0.06 : 0;
    this.baseY = -0.012 * (o.lower ?? 0);
  }
  /** Pose from the simulation. Angles in radians; `gradF`/`gradR` are the road gradient along the car and to its right. */
  place(x: number, y: number, z: number, yaw: number, o: { speed: number; steer: number; ax: number; ay: number; gradF: number; gradR: number; brake: number; dt: number; lamps?: number }) {
    const g = this.group, k = Math.min(1, o.dt * 9);
    this.pitch += (-o.ax * 0.0042 - this.pitch) * k; this.roll += (o.ay * 0.0045 - this.roll) * k;
    this.heave += ((Math.abs(o.ax) + Math.abs(o.ay)) * -0.0012 - this.heave) * k;
    g.position.set(x, y, z); g.rotation.set(-Math.atan(o.gradF), Math.PI / 2 - yaw, -Math.atan(o.gradR));
    this.body.rotation.set(this.pitch, 0, this.roll); this.body.position.y = this.baseY + this.heave;
    this.spin += (o.speed / this.parts.shape.wheelR) * o.dt;
    for (let i = 0; i < 4; i++) { const w = this.wheels[i]; w.children[0].rotation.x = this.spin; w.rotation.y = i >= 2 ? -o.steer : 0; }
    this.brake.value += (o.brake - this.brake.value) * Math.min(1, o.dt * 20); this.lamps.value = o.lamps ?? 1;
  }
  private baseY = 0;
  dispose() { this.group.removeFromParent(); }
}
