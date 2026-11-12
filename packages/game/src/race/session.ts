import * as THREE from 'three/webgpu';
import { DT, createRace, noInput, stepRace, type Entrant, type Input, type Race, type Racer, type Track } from '../../../sim/src/index';
import { CarVisual } from '../car/visual';
import type { Engine } from '../gfx/engine';
import type { World } from '../world/rio';

export type CamMode = 'chase' | 'hood' | 'orbit';
export interface Look { kind?: number; paint: number; finish?: number; wheels?: number; aero?: number; lower?: number; }

/** One running race: steps the simulation at 60 Hz and poses cars and camera every frame. */
export class Session {
  race: Race; visuals: CarVisual[] = []; player = 0; cam: CamMode = 'chase'; orbit = 0; time = 0; ghost: number[] = []; ghostCar: CarVisual | null = null;
  private acc = 0; private prev: number[][] = []; private camPos = new THREE.Vector3(); private camYaw = 0; private first = true; private fov = 62; private shake = 0;
  private input: Input = noInput(); private tmp = new THREE.Vector3(); private look = new THREE.Vector3();
  /** recording of the player's path, 4 numbers per tick: x, y, z, yaw */
  record: number[] = []; onTick: ((s: Session) => void) | null = null;

  constructor(private eng: Engine, private world: World, track: Track, entrants: Entrant[], laps: number, looks: Look[], playerIndex: number, seed = 1, rubber = 0.5) {
    this.race = createRace(track, entrants, laps, seed, rubber); this.player = playerIndex;
    this.race.racers.forEach((r, i) => { const v = new CarVisual(looks[i].kind ?? 0); v.setLook(looks[i]); eng.scene.add(v.group); this.visuals.push(v); this.prev.push([r.car.x, r.car.y, r.car.z, r.car.yaw]); });
  }
  get me(): Racer { return this.race.racers[this.player]; }
  private stride = 1;
  /** `stride`: the path holds one sample every this many ticks. */
  setGhost(path: number[], look: Look, stride = 1) {
    this.ghost = path; this.stride = stride; if (!path.length) return;
    const v = (this.ghostCar = new CarVisual(look.kind ?? 0)); v.setLook(look);
    v.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; const mat = (m.material as THREE.Material).clone(); mat.transparent = true; mat.opacity = 0.35; mat.depthWrite = false; m.material = mat; } });
    this.eng.scene.add(v.group);
  }
  dispose() { for (const v of this.visuals) v.dispose(); this.ghostCar?.dispose(); }

  /** Advance by a frame. `input` drives the player; null lets the AI (or nobody) drive. */
  update(dt: number, input: Input | null) {
    if (input) Object.assign(this.input, input);
    this.acc += Math.min(dt, 0.1); const r = this.race;
    while (this.acc >= DT) {
      this.acc -= DT;
      r.racers.forEach((q, i) => { const p = this.prev[i]; p[0] = q.car.x; p[1] = q.car.y; p[2] = q.car.z; p[3] = q.car.yaw; });
      const ins = r.racers.map((q, i) => (i === this.player && !q.ai ? this.input : null));
      stepRace(r, ins); this.input.shift = 0;
      if (r.countdown <= 0 && !this.me.finished) { const c = this.me.car; this.record.push(c.x, c.y, c.z, c.yaw); }
      this.onTick?.(this);
    }
    this.time += dt;
    const a = this.acc / DT, t = r.track;
    r.racers.forEach((q, i) => {
      const c = q.car, p = this.prev[i]; let dy = c.yaw - p[3]; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const ct = Math.cos(c.yaw), st = Math.sin(c.yaw), k = c.loc.idx, rel = ct * t.tx[k] + st * t.tz[k], relS = -st * t.tx[k] + ct * t.tz[k];
      this.visuals[i].place(p[0] + (c.x - p[0]) * a, p[1] + (c.y - p[1]) * a, p[2] + (c.z - p[2]) * a, p[3] + dy * a, {
        speed: c.vx, steer: c.steer, ax: c.ax, ay: c.ay, gradF: c.slopeS * rel - c.slopeL * relS, gradR: c.slopeS * relS + c.slopeL * rel, brake: c.brake > 0.05 && c.gear > 0 ? 1 : 0, dt });
    });
    if (this.ghostCar) {
      const g = this.ghost, k = Math.min(g.length / 4 - 1, Math.max(0, Math.floor(r.tick / this.stride))) * 4; this.ghostCar.group.visible = r.countdown <= 0 && k < g.length - 4;
      if (g.length) this.ghostCar.place(g[k], g[k + 1], g[k + 2], g[k + 3], { speed: 30, steer: 0, ax: 0, ay: 0, gradF: 0, gradR: 0, brake: 0, dt });
    }
    this.camera(dt);
  }

  private camera(dt: number) {
    const cam = this.eng.camera, v = this.visuals[this.player].group, c = this.me.car, sp = Math.abs(c.vx), yaw = Math.PI / 2 - v.rotation.y;
    if (c.hit > 2) this.shake = Math.min(1, this.shake + c.hit * 0.06);
    this.shake *= Math.exp(-dt * 6);
    const rough = (c.offRoad ? 0.5 : 0) + Math.max(0, sp - 55) * 0.006 + (c.nitroOn ? 0.25 : 0) + this.shake * 2.5;
    const jx = (Math.sin(this.time * 61) + Math.sin(this.time * 97)) * 0.012 * rough, jy = (Math.sin(this.time * 73) + Math.sin(this.time * 113)) * 0.012 * rough;
    if (this.cam === 'orbit') {
      const d = 6.4; cam.position.set(v.position.x + Math.cos(this.orbit) * d, v.position.y + 1.25, v.position.z + Math.sin(this.orbit) * d); cam.lookAt(v.position.x, v.position.y + 0.65, v.position.z);
      this.fov = 38;
    } else if (this.cam === 'hood') {
      const f = this.tmp.set(Math.cos(yaw), 0, Math.sin(yaw));
      cam.position.set(v.position.x + f.x * 0.35, v.position.y + 1.02 + jy, v.position.z + f.z * 0.35);
      this.look.copy(cam.position).addScaledVector(f, 30); this.look.y -= 2.2 - c.slopeS * 30; cam.lookAt(this.look); this.fov += (68 + sp * 0.2 - this.fov) * Math.min(1, dt * 4);
    } else {
      // chase: the camera's heading trails the car's, which shows the slide in corners
      let d = yaw - this.camYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (this.first) { this.camYaw = yaw; this.first = false; } else this.camYaw += d * Math.min(1, dt * (4.2 + sp * 0.03));
      const back = 5.6 - Math.min(1.1, sp * 0.012) + (c.nitroOn ? 0.5 : 0), up = 1.95 - Math.min(0.35, sp * 0.004);
      this.tmp.set(v.position.x - Math.cos(this.camYaw) * back, v.position.y + up, v.position.z - Math.sin(this.camYaw) * back);
      const floor = this.world.heightAt(this.tmp.x, this.tmp.z) + 0.6; if (this.tmp.y < floor) this.tmp.y = floor;
      this.camPos.copy(this.tmp); cam.position.set(this.camPos.x + jx, this.camPos.y + jy, this.camPos.z);
      this.look.set(v.position.x + Math.cos(yaw) * 4.5, v.position.y + 1.05, v.position.z + Math.sin(yaw) * 4.5); cam.lookAt(this.look);
      this.fov += (58 + Math.min(26, sp * 0.3) + (c.nitroOn ? 7 : 0) - this.fov) * Math.min(1, dt * 3);
    }
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.eng.blur.value = this.cam === 'orbit' ? 0 : Math.min(0.75, 0.1 + sp * 0.006 + (c.nitroOn ? 0.25 : 0));
    this.world.update(v.position);
  }
}
