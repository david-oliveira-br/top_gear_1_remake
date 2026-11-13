import * as THREE from 'three/webgpu';
import { texture, uv, mix, vec3, float, uniform, step, max, bumpMap, positionLocal, mx_noise_float, fract, floor, smoothstep } from 'three/tsl';
import { buildBody, SHAPES, type BodyParts } from './body';
import { carKit, cockpitScene, COCKPIT_HEAD, defaultAnchors, type CarAnchors, type CarKit } from './glb';

export const PAINTS = ['#c8102e', '#f2b01e', '#1565d8', '#0f8f5a', '#e8e8ec', '#141518', '#f05a14', '#7a2bd0', '#12b5c9', '#d81b77', '#8a8f98', '#b9d21a', '#101c3a', '#5a1010'];
export const FINISHES = ['Metálico', 'Sólido', 'Fosco', 'Perolado'];
export const WHEELS = ['5 raios', 'Multirraio', 'Turbina'];
export const CAR_NAMES = ['Sirocco MR', 'Vento GT'];

const std = (color: number, roughness: number, metalness: number) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
let mats: ReturnType<typeof makeCommon> | null = null;
function makeCommon() {
  const carbon = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.38, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
  const cx = positionLocal.x.add(positionLocal.y).mul(85), cz = positionLocal.z.mul(85); // 2x2 twill weave
  carbon.colorNode = vec3(1).mul(mix(float(0.012), float(0.06), step(0.5, fract(cx.add(floor(cz).mul(0.5)).mul(0.5)))));
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0x06090c, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0 });
  return { dark: std(0x0b0c0e, 0.55, 0.1), chrome: std(0xd8dade, 0.12, 1), tyre: std(0x0a0a0b, 0.88, 0), disc: std(0x4c4f55, 0.42, 0.9), cabin: std(0x121214, 0.75, 0), seats: std(0x6e3a1e, 0.62, 0),
    carbon, glass, rim: [std(0xb9bcc4, 0.2, 1), std(0x1a1b1e, 0.3, 0.9), std(0xc79a3a, 0.24, 1)], caliper: [std(0xc41a12, 0.4, 0.3), std(0xe0b010, 0.4, 0.3), std(0x1d1d20, 0.4, 0.3)] };
}
const common = () => (mats ??= makeCommon());

/** One car on screen: body, glass, cabin, wheels, lamps. Pose it with `place` every frame. */
export class CarVisual {
  group = new THREE.Group(); body = new THREE.Group(); parts!: BodyParts;
  private wheels: THREE.Group[] = []; private wing!: THREE.Mesh; private rims: THREE.Mesh[] = []; private calipers: THREE.Mesh[] = [];
  private paint = uniform(new THREE.Color()); private brake = uniform(0); private lamps = uniform(1);
  private metal = uniform(0.7); private rough = uniform(0.36); private coat = uniform(1); private flake = uniform(1); private pearl = uniform(0);
  private glb = false; private glbWheels: THREE.Group[] = []; private wheelR = 0.335;
  /** camera anchors (car space) and the glass meshes, which the cockpit view hides */
  anchors: CarAnchors = defaultAnchors(); private glass: THREE.Object3D[] = []; private bodyOff = new THREE.Vector3(); private carHead = new THREE.Vector3(); private shell: THREE.Object3D[] = []; private interior: THREE.Object3D | null = null; private wheelNode: THREE.Object3D | null = null;
  private spin = 0; private pitch = 0; private roll = 0; private heave = 0; private baseY = 0;

  /** kind: 0 mid-engine supercar, 1 grand tourer */
  constructor(kind = 0) {
    const kit = carKit(kind);
    if (kit) { this.glb = true; this.buildGlb(kit); return; }
    const p = (this.parts = buildBody(SHAPES[kind % SHAPES.length])), c = common(); this.wheelR = p.shape.wheelR;
    const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
    const k = texture(p.mask, uv()), lamp = k.g, trim = k.b;
    const sparkle = mx_noise_float(positionLocal.mul(900)).mul(0.12).mul(this.flake).add(1); // metallic flakes under the lacquer
    m.colorNode = mix(mix(this.paint.mul(sparkle), vec3(0.014), trim), vec3(0.55), lamp);
    m.roughnessNode = mix(mix(this.rough, float(0.6), trim), float(0.15), lamp);
    m.metalnessNode = mix(this.metal, float(0), max(trim, lamp));
    m.clearcoatNode = this.coat.mul(float(1).sub(trim)); m.clearcoatRoughnessNode = float(0.035);
    m.iridescenceNode = this.pearl.mul(float(1).sub(max(trim, lamp))); m.iridescenceIORNode = float(1.7);
    m.normalNode = bumpMap(texture(p.relief, uv()), float(0.5)); // shut lines catch the light
    m.emissiveNode = lamp.mul(mix(vec3(1, 0.03, 0.02).mul(this.lamps.mul(0.9).add(this.brake.mul(7))), vec3(1, 0.93, 0.8).mul(this.lamps.mul(2.2)), step(0.5, uv().x)));
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.body, shadow = true) => { const q = new THREE.Mesh(g, mat); q.castShadow = shadow; q.receiveShadow = shadow; parent.add(q); return q; };
    add(p.shell, m); add(p.cabin, c.cabin, this.body, false); add(p.seats, c.seats, this.body, false); add(p.dark, c.dark); add(p.carbon, c.carbon); add(p.chrome, c.chrome);
    const gl = add(p.glass, c.glass, this.body, false); gl.renderOrder = 2; this.glass.push(gl);
    const tail = new THREE.MeshStandardNodeMaterial({ color: 0x300404, roughness: 0.2 }); tail.emissiveNode = vec3(1, 0.04, 0.02).mul(this.lamps.mul(1.2).add(this.brake.mul(8)));
    const head = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.2 }); head.emissiveNode = vec3(1, 0.95, 0.85).mul(this.lamps.mul(3));
    add(p.tail, tail); add(p.head, head);
    this.wing = add(p.wing, c.carbon); this.wing.visible = false;
    for (const [z, sx] of [[p.axleR, 1], [p.axleR, -1], [p.axleF, 1], [p.axleF, -1]]) {
      const w = new THREE.Group(), turn = new THREE.Group(); w.add(turn);
      add(p.wheel.tyre, c.tyre, turn); this.rims.push(add(p.wheel.rims[0], c.rim[0], turn)); add(p.wheel.disc, c.disc, turn); this.calipers.push(add(p.wheel.caliper, c.caliper[0], w, false));
      if (sx < 0) w.scale.x = -1;
      w.position.set(sx * p.track, p.shape.wheelR, z); this.group.add(w); this.wheels.push(w);
    }
    this.group.add(this.body); this.group.rotation.order = 'YXZ';
  }
  /** Downloaded model: the baked texture holds paint (teal), trim (dark) and lamps; we recolour only the paint pixels. */
  private buildGlb(kit: CarKit) {
    this.wheelR = kit.wheelR; this.anchors = { head: kit.anchors.head.clone(), hood: kit.anchors.hood.clone(), bumper: kit.anchors.bumper.clone() }; this.carHead = kit.anchors.head.clone(); this.parts = { shape: { wheelR: kit.wheelR } } as BodyParts;
    const scene = kit.scene.clone(true), inner = new THREE.Group(); inner.position.set(0, -kit.groundY, -kit.midZ); this.group.add(inner); this.bodyOff.copy(inner.position);
    const byName = (s: string) => { let f!: THREE.Object3D; scene.traverse((c) => { if (c.name.endsWith(s)) f = c; }); return f; };
    const wheelNodes = ['_wheel_fl', '_wheel_fr', '_wheel_rl', '_wheel_rr'].map(byName);
    const src = kit.paint!, m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
    const col = texture(src.map!, uv()), rm = src.metalnessMap ? texture(src.metalnessMap, uv()) : null;
    const isPaint = smoothstep(0.08, 0.2, col.g.sub(col.r)).mul(smoothstep(0.04, 0.12, col.b.sub(col.r)));
    const isRed = smoothstep(0.25, 0.4, col.r.sub(col.g)).mul(smoothstep(0.25, 0.4, col.r.sub(col.b)));
    const isWhite = smoothstep(0.7, 0.85, col.r.min(col.g).min(col.b));
    const sparkle = mx_noise_float(positionLocal.mul(900)).mul(0.12).mul(this.flake).add(1);
    m.colorNode = mix(col.rgb, this.paint.mul(sparkle).mul(col.g.div(0.62).clamp(0.5, 1.4)), isPaint);
    m.normalMap = src.normalMap; m.normalScale = src.normalScale;
    m.roughnessNode = mix(rm ? rm.g : float(0.6), this.rough, isPaint);
    m.metalnessNode = mix(rm ? rm.b : float(0), this.metal, isPaint);
    m.clearcoatNode = this.coat.mul(isPaint); m.clearcoatRoughnessNode = float(0.035);
    m.iridescenceNode = this.pearl.mul(isPaint); m.iridescenceIORNode = float(1.7);
    m.emissiveNode = isRed.mul(vec3(1, 0.05, 0.03)).mul(this.lamps.mul(0.4).add(this.brake.mul(7))).add(isWhite.mul(vec3(1, 0.95, 0.85)).mul(this.lamps.mul(0.12)));
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      if (mesh.material === src) mesh.material = m;
      else if (!Array.isArray(mesh.material) && mesh.material.transparent) { mesh.renderOrder = 2; this.glass.push(mesh); mesh.castShadow = false; mesh.receiveShadow = false; return; }
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (!wheelNodes.some((w) => w === o || w.getObjectById(o.id))) this.shell.push(mesh);
    });
    for (const w of wheelNodes) {
      const pivot = new THREE.Group(), turn = new THREE.Group(); pivot.position.copy(w.position); w.position.set(0, 0, 0); w.rotation.set(0, 0, 0);
      w.removeFromParent(); turn.add(w); pivot.add(turn); this.group.add(pivot); this.glbWheels.push(pivot); pivot.position.add(inner.position);
    }
    this.body.add(scene); inner.add(this.body); this.group.rotation.order = 'YXZ';
    // wheels hang off `group`, the body (inner) rolls separately
  }
  setLook(o: { paint: number; finish?: number; wheels?: number; aero?: number; lower?: number }) {
    this.paint.value.set(PAINTS[o.paint % PAINTS.length]).convertSRGBToLinear();
    const f = o.finish ?? 0, w = (o.wheels ?? 0) % 3, c = common();
    this.metal.value = [0.75, 0.05, 0.3, 0.6][f]; this.rough.value = [0.36, 0.3, 0.62, 0.3][f]; this.coat.value = [1, 1, 0, 1][f]; this.flake.value = [1, 0, 0.3, 0.6][f]; this.pearl.value = f === 3 ? 1 : 0;
    if (this.glb) { this.baseY = -0.012 * (o.lower ?? 0); return; }
    for (const r of this.rims) { r.geometry = this.parts.wheel.rims[w]; r.material = c.rim[w]; }
    for (const q of this.calipers) q.material = c.caliper[w];
    this.wing.visible = (o.aero ?? 0) > 0; this.wing.position.y = (o.aero ?? 0) >= 3 ? 0.06 : 0;
    this.baseY = -0.012 * (o.lower ?? 0);
  }
  /** Pose from the simulation. Angles in radians; `gradF`/`gradR` are the road gradient along the car and to its right. */
  place(x: number, y: number, z: number, yaw: number, o: { speed: number; steer: number; ax: number; ay: number; gradF: number; gradR: number; brake: number; dt: number; lamps?: number }) {
    const g = this.group, k = Math.min(1, o.dt * 9);
    this.pitch += (-o.ax * 0.0042 - this.pitch) * k; this.roll += (o.ay * 0.0045 - this.roll) * k;
    this.heave += ((Math.abs(o.ax) + Math.abs(o.ay)) * -0.0012 - this.heave) * k;
    g.position.set(x, y, z); g.rotation.set(-Math.atan(o.gradF), Math.PI / 2 - yaw, -Math.atan(o.gradR));
    this.body.rotation.set(this.pitch, 0, this.roll); this.body.position.y = this.baseY + this.heave;
    this.spin += (o.speed / this.wheelR) * o.dt;
    const ws = this.glb ? this.glbWheels : this.wheels;
    for (let i = 0; i < 4; i++) { const w = ws[i]; w.children[0].rotation.x = this.spin; w.rotation.y = (this.glb ? i < 2 : i >= 2) ? -o.steer : 0; }
    if (this.wheelNode) this.wheelNode.rotation.z = o.steer * 1.5;
    this.brake.value += (o.brake - this.brake.value) * Math.min(1, o.dt * 20); this.lamps.value = o.lamps ?? 1;
  }
  /** Hide the glass for the driver's own view from inside. */
  setCockpit(on: boolean) {
    for (const g of this.glass) g.visible = !on;
    if (on && !this.interior && this.glb) { // the dashboard-and-wheel interior replaces the model's own cabin while we sit in it
      const i = cockpitScene(); if (i) { i.position.copy(this.bodyOff).negate(); this.body.add(i); this.interior = i; i.traverse((o) => { if (o.name.endsWith('_steering_wheel')) this.wheelNode = o; const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; this.tone(m); } }); }
    }
    if (this.interior) { this.interior.visible = on; for (const m of this.shell) m.visible = !on; this.anchors.head.copy(on ? COCKPIT_HEAD : this.carHead); }
  }
  /** The interior's baked salmon trim is greyed down to black leather, and its screens are tamed so they do not bloom. */
  private toned = new Map<THREE.Material, THREE.Material>();
  private tone(m: THREE.Mesh) {
    const src = m.material as THREE.MeshStandardMaterial; if (Array.isArray(src)) return;
    let out = this.toned.get(src);
    if (!out) {
      if (src.map && /_pbr$/.test(src.name)) {
        const n = new THREE.MeshStandardNodeMaterial(), c = texture(src.map, uv()), g = c.r.mul(0.3).add(c.g.mul(0.59)).add(c.b.mul(0.11));
        n.colorNode = mix(c.rgb, vec3(g), 0.9).mul(0.55); n.roughnessNode = src.metalnessMap ? texture(src.metalnessMap, uv()).g : float(0.7); n.metalnessNode = src.metalnessMap ? texture(src.metalnessMap, uv()).b : float(0);
        n.normalMap = src.normalMap; out = n;
      } else { out = src.clone(); if ((out as THREE.MeshStandardMaterial).emissiveIntensity != null) (out as THREE.MeshStandardMaterial).emissiveIntensity *= 0.3; }
      this.toned.set(src, out);
    }
    m.material = out;
  }
  /** World position of an anchor (it rides with the body's pitch and roll). */
  anchorWorld(a: keyof CarAnchors, out: THREE.Vector3, dx = 0, dy = 0, dz = 0) {
    out.copy(this.anchors[a]).sub(this.bodyOff); out.x += dx; out.y += dy; out.z += dz; this.body.updateWorldMatrix(true, false); return this.body.localToWorld(out);
  }
  dispose() { this.group.removeFromParent(); }
}
