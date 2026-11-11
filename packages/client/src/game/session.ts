import {
  DT, applySnapCar, collidePair, createWorld, decodeSnapshot, encodeInput, getTrack, quantizeInput, stepCar, stepWorld, wetness, wrapDiff,
  type Car, type Input, type RaceStart, type Snapshot, type World,
} from '../../../shared/src/index';

export interface Session {
  world: World;
  /** car indices driven by local players, in player order */
  local: number[];
  online: boolean;
  update(dt: number, inputs: Input[]): void;
  dispose(): void;
}

const mod = (v: number, m: number) => ((v % m) + m) % m;

export class LocalSession implements Session {
  online = false;
  private acc = 0; private px: number[] = []; private pz: number[] = [];
  constructor(public world: World, public local: number[]) {
    world.cars.forEach((c, i) => { this.px[i] = c.x; this.pz[i] = c.z; });
  }
  update(dt: number, inputs: Input[]) {
    const w = this.world, L = w.track.length;
    this.acc += Math.min(dt, 0.1);
    const map: (Input | undefined)[] = [];
    this.local.forEach((idx, p) => { map[idx] = inputs[p]; });
    while (this.acc >= DT) {
      w.cars.forEach((c, i) => { this.px[i] = c.x; this.pz[i] = c.z; });
      stepWorld(w, map);
      this.acc -= DT;
    }
    const a = this.acc / DT;
    w.cars.forEach((c, i) => {
      c.rx = this.px[i] + (c.x - this.px[i]) * a;
      c.rz = mod(this.pz[i] + wrapDiff(c.z - this.pz[i], L) * a, L);
    });
  }
  dispose() {}
}

const INTERP_DELAY = 0.1;

/** Online race: predicts the local car, interpolates everyone else from server snapshots. */
export class NetSession implements Session {
  online = true; world: World; local: number[];
  private me: Car; private acc = 0; private seq = 0;
  private pending: { seq: number; input: Input }[] = [];
  private snaps: { t: number; s: Snapshot }[] = [];
  private errX = 0; private errZ = 0; private px = 0; private pz = 0;

  constructor(race: RaceStart, private send: (data: ArrayBuffer) => void) {
    this.world = createWorld({ track: getTrack(race.trackId), laps: race.laps, weather: race.weather, time: race.time, difficulty: race.difficulty, entries: race.entries, shift: race.shift });
    this.local = [race.yourIdx];
    this.me = this.world.cars[race.yourIdx];
    this.px = this.me.x; this.pz = this.me.z;
  }

  private predicting() { return this.world.phase === 'racing' && !this.me.finished; }

  onMessage(buf: ArrayBuffer) {
    const s = decodeSnapshot(buf);
    if (!s || s.cars.length !== this.world.cars.length) return;
    const w = this.world, L = w.track.length, me = this.me;
    this.snaps.push({ t: performance.now() / 1000, s });
    if (this.snaps.length > 30) this.snaps.shift();
    w.tick = s.tick; w.phase = s.phase; w.wet = wetness(w);
    const bx = me.x, bz = me.z;
    const wasPredicting = this.pending.length > 0;
    applySnapCar(me, s.cars[me.idx]);
    this.pending = this.pending.filter((p) => p.seq > s.ack);
    if (this.predicting()) {
      for (const p of this.pending) stepCar(me, p.input, w.track, w.wet);
      if (wasPredicting) {
        const dz = wrapDiff(bz - me.z, L);
        if (Math.abs(dz) < 2500) { this.errX += bx - me.x; this.errZ += dz; } else { this.errX = 0; this.errZ = 0; }
      }
      this.px = me.x; this.pz = me.z;
    } else this.pending.length = 0;
  }

  update(dt: number, inputs: Input[]) {
    const w = this.world, L = w.track.length, me = this.me;
    const inp = quantizeInput(inputs[0] ?? { steer: 0, throttle: 0, brake: 0, nitro: false, up: false, down: false });
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= DT) {
      this.acc -= DT;
      this.send(encodeInput(++this.seq, inp));
      if (this.predicting()) {
        this.pending.push({ seq: this.seq, input: inp });
        if (this.pending.length > 120) this.pending.shift();
        this.px = me.x; this.pz = me.z;
        stepCar(me, inp, w.track, w.wet);
        for (const o of w.cars) if (o !== me && !o.dnf) collidePair(me, { ...o }, L);
      }
    }
    // other cars: interpolate between snapshots, slightly in the past
    const now = performance.now() / 1000 - INTERP_DELAY, sn = this.snaps;
    if (sn.length) {
      let i = sn.length - 1;
      while (i > 0 && sn[i - 1].t > now) i--;
      const b = sn[i], a = sn[Math.max(0, i - 1)];
      const k = b.t > a.t ? Math.max(0, Math.min(1.5, (now - a.t) / (b.t - a.t))) : 1;
      for (const c of w.cars) {
        if (c === me && this.predicting()) continue;
        const A = a.s.cars[c.idx], B = b.s.cars[c.idx];
        if (c !== me) applySnapCar(c, B);
        c.rx = A.x + (B.x - A.x) * k;
        c.rz = mod(A.z + wrapDiff(B.z - A.z, L) * k, L);
        c.x = c.rx; c.z = c.rz;
        c.speed = A.speed + (B.speed - A.speed) * Math.min(1, k);
        c.steer = A.steer + (B.steer - A.steer) * Math.min(1, k);
      }
    }
    if (this.predicting()) {
      const al = this.acc / DT;
      this.errX *= Math.pow(0.002, dt); this.errZ *= Math.pow(0.002, dt);
      me.rx = this.px + (me.x - this.px) * al + this.errX;
      me.rz = mod(this.pz + wrapDiff(me.z - this.pz, L) * al + this.errZ, L);
    }
  }
  dispose() {}
}
