import * as THREE from 'three/webgpu';
import { texture, uv, vec3, normalView, positionViewDirection, float } from 'three/tsl';
import { CITIES, type City } from '../../sim/src/index';
import type { Engine } from './gfx/engine';

const R = 50, CENTER = new THREE.Vector3(0, 5200, 0);
const dir = (lat: number, lon: number, out = new THREE.Vector3()) => { const a = (lat * Math.PI) / 180, o = (lon * Math.PI) / 180; return out.set(Math.cos(a) * Math.cos(o), Math.sin(a), -Math.cos(a) * Math.sin(o)); };

/** The World Tour map: a globe high above the circuit, with city markers and a flight arc. */
export class Globe {
  group = new THREE.Group(); selected: City = CITIES[0];
  private markers = new Map<string, THREE.Mesh>(); private view = dir(-10, -50); private arc: THREE.Mesh | null = null; private plane: THREE.Mesh; private fly = 1; private from = new THREE.Vector3(); private to = new THREE.Vector3();
  constructor(private eng: Engine) {
    this.group.position.copy(CENTER); this.group.visible = false; eng.scene.add(this.group);
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024; const g = cv.getContext('2d')!;
    g.fillStyle = '#04111d'; g.fillRect(0, 0, 2048, 1024);
    g.strokeStyle = 'rgba(90,150,190,.16)'; g.lineWidth = 1;
    for (let i = 0; i <= 24; i++) { g.beginPath(); g.moveTo((i / 24) * 2048, 0); g.lineTo((i / 24) * 2048, 1024); g.stroke(); }
    for (let i = 0; i <= 12; i++) { g.beginPath(); g.moveTo(0, (i / 12) * 1024); g.lineTo(2048, (i / 12) * 1024); g.stroke(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    fetch('/assets/ne_110m_land.geojson').then((r) => r.json()).then((geo) => {
      g.fillStyle = '#1c5a4c'; g.strokeStyle = '#6fe0b8'; g.lineWidth = 1.6;
      for (const f of geo.features) for (const poly of f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) {
        g.beginPath(); for (const ring of poly) ring.forEach(([lon, lat]: number[], i: number) => { const x = ((lon + 180) / 360) * 2048, y = ((90 - lat) / 180) * 1024; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.fill(); g.stroke();
      }
      tex.needsUpdate = true;
    }).catch(() => {});
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.1 });
    m.colorNode = texture(tex, uv()).rgb.mul(0.7); m.emissiveNode = texture(tex, uv()).rgb.mul(0.55);
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), m));
    const halo = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending });
    halo.colorNode = vec3(0.25, 0.6, 1); halo.opacityNode = float(1).sub(normalView.dot(positionViewDirection).abs()).pow(3).mul(0.9);
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.12, 64, 48), halo));
    for (const c of CITIES) {
      const mk = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshStandardNodeMaterial({ color: 0x111111 }));
      mk.position.copy(dir(c.lat, c.lon)).multiplyScalar(R + 0.5); this.group.add(mk); this.markers.set(c.id, mk);
    }
    const pm = new THREE.MeshStandardNodeMaterial({ color: 0xffffff }); pm.emissiveNode = vec3(1, 0.9, 0.6).mul(3);
    this.plane = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.2, 8).rotateX(Math.PI / 2), pm); this.plane.visible = false; this.group.add(this.plane);
  }
  /** Colour the markers: open, locked or beaten. */
  paint(state: (c: City) => 'open' | 'lock' | 'done') {
    for (const c of CITIES) { const s = state(c), m = this.markers.get(c.id)!.material as THREE.MeshStandardNodeMaterial; m.emissiveNode = (s === 'open' ? vec3(1, 0.3, 0.15) : s === 'done' ? vec3(0.2, 1, 0.6) : vec3(0.25, 0.28, 0.32)).mul(s === 'lock' ? 1 : 4); m.needsUpdate = true; }
  }
  select(c: City, animate = true) {
    const prev = this.selected; this.selected = c;
    if (this.arc) { this.arc.removeFromParent(); this.arc.geometry.dispose(); this.arc = null; }
    if (!animate || prev.id === c.id) { this.plane.visible = false; return; }
    this.from.copy(dir(prev.lat, prev.lon)); this.to.copy(dir(c.lat, c.lon));
    const pts: THREE.Vector3[] = []; for (let i = 0; i <= 48; i++) pts.push(this.arcPoint(i / 48, new THREE.Vector3()));
    const am = new THREE.MeshBasicNodeMaterial(); am.colorNode = vec3(3, 1.4, 0.5);
    this.arc = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.14, 6), am); this.group.add(this.arc);
    this.fly = 0; this.plane.visible = true;
  }
  private arcPoint(t: number, out: THREE.Vector3) {
    const ang = this.from.angleTo(this.to), s = Math.sin(ang) || 1;
    out.copy(this.from).multiplyScalar(Math.sin((1 - t) * ang) / s).addScaledVector(this.to, Math.sin(t * ang) / s);
    return out.normalize().multiplyScalar(R + 1 + Math.sin(t * Math.PI) * ang * 6);
  }
  show(on: boolean) { this.group.visible = on; }
  /** Move the camera towards the selected city; returns screen positions for the labels. */
  update(dt: number, labels: Map<string, HTMLElement>) {
    const cam = this.eng.camera, c = this.selected, want = dir(c.lat * 0.6, c.lon);
    this.view.lerp(want, Math.min(1, dt * 2.2)).normalize();
    cam.position.copy(CENTER).addScaledVector(this.view, R * 2.9); cam.position.x -= 0; cam.lookAt(CENTER);
    // shift the globe to the left half of the screen so the side panel has room
    cam.translateX(R * 0.55); if (cam.fov !== 40) { cam.fov = 40; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    if (this.fly < 1) { this.fly = Math.min(1, this.fly + dt / 1.8); const p = this.arcPoint(this.fly, this.plane.position), q = this.arcPoint(Math.min(1, this.fly + 0.02), new THREE.Vector3()); this.plane.lookAt(q.add(CENTER)); void p; if (this.fly >= 1) this.plane.visible = false; }
    const v = new THREE.Vector3(), w = innerWidth, hh = innerHeight;
    for (const city of CITIES) {
      const el = labels.get(city.id); if (!el) continue;
      v.copy(this.markers.get(city.id)!.position).add(CENTER); const facing = v.clone().sub(CENTER).normalize().dot(cam.position.clone().sub(CENTER).normalize());
      v.project(cam); el.style.display = facing > 0.2 ? '' : 'none'; el.style.left = (v.x * 0.5 + 0.5) * w + 'px'; el.style.top = (-v.y * 0.5 + 0.5) * hh + 'px';
    }
  }
}
