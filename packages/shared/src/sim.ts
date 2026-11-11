import { PIT_X0, PIT_X1, SEG_LEN, type TimeOfDay, type Track, type Weather } from './track';
import { clamp, wrapDiff } from './util';

export const DT = 1 / 60;
export const KMH = 1 / 40; // world units/s -> displayed km/h
export const MAX_CARS = 12;
export const COUNTDOWN_TICKS = 240;
export const NITRO_TIME = 3.5;
export const NITRO_START = 3;
export const PIT_SPEED = 3600;
export const CAR_LEN = 760;
export const CAR_W = 0.42;
const NITRO_ACC = 2600;
const GEAR_RATIO = [0.28, 0.46, 0.64, 0.82, 1.0];
const GEAR_ACC = [1.9, 1.45, 1.1, 0.8, 0.56];
export const GEARS = GEAR_RATIO.length;
const COAST = 900, BRAKE = 8000, STEER_RATE = 8;
const STEER_K = 2.4, CENT_K = 0.26;

export interface CarClass { id: string; name: string; top: number; accel: number; grip: number; tank: number; blurb: string }
export const CAR_CLASSES: CarClass[] = [
  { id: 'vortex', name: 'Vortex GT', top: 12400, accel: 1750, grip: 1.0, tank: 1.5e6, blurb: 'Balanced all-rounder' },
  { id: 'sirocco', name: 'Sirocco S', top: 13300, accel: 1600, grip: 0.93, tank: 1.15e6, blurb: 'Highest top speed, thirsty' },
  { id: 'kestrel', name: 'Kestrel RS', top: 11800, accel: 2050, grip: 1.12, tank: 1.35e6, blurb: 'Best acceleration and grip' },
  { id: 'marathon', name: 'Marathon', top: 12000, accel: 1680, grip: 1.02, tank: 2.2e6, blurb: 'Huge range, fewer pit stops' },
];
export const CAR_COLORS = ['#e23636', '#2f6fed', '#f2c230', '#2fbf71', '#f27d1f', '#9b4de0', '#e8e8ee', '#1d1f26', '#19c2c2', '#e0509a', '#8a5a2b', '#7ed321'];

export interface Input { steer: number; throttle: number; brake: number; nitro: boolean; up: boolean; down: boolean }
export const NO_INPUT: Input = { steer: 0, throttle: 0, brake: 0, nitro: false, up: false, down: false };

export interface Car {
  idx: number; name: string; classId: number; color: number; auto: boolean; isAI: boolean; human: boolean; skill: number;
  x: number; z: number; lap: number; speed: number; gear: number; rpm: number; fuel: number;
  nitro: number; nitroT: number; steer: number;
  pNitro: boolean; pUp: boolean; pDown: boolean;
  finished: boolean; dnf: boolean; finishTick: number; stallT: number;
  bump: number; offroad: boolean; inPit: boolean; lane: number;
  rx: number; rz: number; // render-only (interpolated) position
}

export type Difficulty = 0 | 1 | 2;
export interface Entry { name: string; classId: number; color: number; auto: boolean; isAI: boolean }
export interface World {
  track: Track; laps: number; weather: Weather; time: TimeOfDay; difficulty: Difficulty;
  cars: Car[]; tick: number; phase: 'countdown' | 'racing' | 'done'; firstFinishTick: number;
}

/** entries are ordered by grid slot: entries[0] is pole. */
export function createWorld(o: { track: Track; laps: number; weather: Weather; time: TimeOfDay; difficulty: Difficulty; entries: Entry[] }): World {
  const n = o.entries.length;
  const rows = Math.ceil(n / 2);
  const base = [0.86, 0.91, 0.955][o.difficulty];
  const cars: Car[] = o.entries.map((e, s) => {
    const row = Math.floor(s / 2);
    const z = o.track.length - 600 - row * 1600 - (s % 2 ? 500 : 0);
    const x = s % 2 ? 0.45 : -0.45;
    void rows;
    return {
      idx: s, name: e.name, classId: e.classId, color: e.color, auto: e.auto, isAI: e.isAI, human: !e.isAI,
      skill: base + 0.045 * (1 - s / Math.max(1, n - 1)),
      x, z, lap: 0, speed: 0, gear: 1, rpm: 0, fuel: 1, nitro: NITRO_START, nitroT: 0, steer: 0,
      pNitro: false, pUp: false, pDown: false, finished: false, dnf: false, finishTick: 0, stallT: 0,
      bump: 0, offroad: false, inPit: false, lane: x, rx: x, rz: z,
    };
  });
  return { track: o.track, laps: o.laps, weather: o.weather, time: o.time, difficulty: o.difficulty, cars, tick: 0, phase: 'countdown', firstFinishTick: 0 };
}

export function gripFactors(weather: Weather) {
  const wet = weather === 'rain' ? 1 : weather === 'snow' ? 1.3 : 0;
  return { grip: 1 - 0.13 * wet, cent: 1 + 0.28 * wet };
}

function torque(rpm: number) {
  const t = rpm < 0.25 ? 0.62 : Math.max(0.35, 1 - 1.4 * (rpm - 0.72) * (rpm - 0.72));
  return t * clamp((1 - rpm) / 0.04, 0, 1);
}

/** Advance one car by one tick. Car-vs-car contact is handled separately. */
export function stepCar(c: Car, inp: Input, track: Track, weather: Weather) {
  const cls = CAR_CLASSES[c.classId];
  const n = track.segments.length;
  const seg = track.segments[Math.floor(c.z / SEG_LEN) % n];
  const g = gripFactors(weather);
  let throttle = clamp(inp.throttle, 0, 1);
  const brake = clamp(inp.brake, 0, 1);
  if (c.fuel <= 0) throttle = 0;

  // gearbox
  if (c.auto) {
    if (c.rpm > 0.93 && c.gear < GEARS) c.gear++;
    else if (c.gear > 1 && c.speed < cls.top * GEAR_RATIO[c.gear - 2] * 0.72) c.gear--;
  } else {
    if (inp.up && !c.pUp && c.gear < GEARS) c.gear++;
    if (inp.down && !c.pDown && c.gear > 1) c.gear--;
  }
  if (inp.nitro && !c.pNitro && c.nitro > 0 && c.nitroT <= 0 && c.fuel > 0) { c.nitro--; c.nitroT = NITRO_TIME; }
  c.pNitro = inp.nitro; c.pUp = inp.up; c.pDown = inp.down;

  const gearTop = cls.top * GEAR_RATIO[c.gear - 1];
  c.rpm = c.speed / gearTop;
  let acc = cls.accel * GEAR_ACC[c.gear - 1] * torque(c.rpm) * throttle;
  if (c.nitroT > 0) {
    c.nitroT = Math.max(0, c.nitroT - DT);
    acc = c.speed < cls.top * 1.22 ? acc + NITRO_ACC : 0;
  } else {
    if (c.speed > gearTop * 1.01) acc = -3000; // over-rev / engine braking
    acc -= COAST * (1 - throttle);
  }
  acc -= BRAKE * brake;
  c.speed += acc * DT;

  // surfaces
  c.inPit = seg.pit && c.x > PIT_X0 && c.x < PIT_X1;
  c.offroad = Math.abs(c.x) > 1.06 && !c.inPit;
  if (c.offroad && c.speed > cls.top * 0.33) c.speed -= 5200 * DT;
  if (c.inPit) {
    if (c.speed > PIT_SPEED) c.speed = Math.max(PIT_SPEED, c.speed - 9000 * DT);
    c.fuel = Math.min(1, c.fuel + 0.2 * DT);
  }
  if (c.offroad) {
    for (const s of seg.sprites) {
      if (s.solid && Math.abs(c.x - s.offset) < 0.32 && c.speed > cls.top * 0.08) {
        c.speed = cls.top * 0.08; c.bump = 0.35;
      }
    }
  }
  c.speed = clamp(c.speed, 0, cls.top * 1.3);

  // steering
  c.steer += clamp(clamp(inp.steer, -1, 1) - c.steer, -STEER_RATE * DT, STEER_RATE * DT);
  const sp = c.speed / cls.top;
  c.x += DT * STEER_K * Math.min(1, sp * 2.2) * cls.grip * g.grip * c.steer;
  c.x -= DT * STEER_K * sp * sp * seg.curve * CENT_K * g.cent;
  c.x = clamp(c.x, -2.6, 2.6);

  // fuel
  if (c.fuel > 0) c.fuel = Math.max(0, c.fuel - (c.speed * DT / cls.tank) * (c.nitroT > 0 ? 1.8 : 1));
  if (c.bump > 0) c.bump = Math.max(0, c.bump - DT);

  c.z += c.speed * DT;
  if (c.z >= track.length) { c.z -= track.length; c.lap++; }
}

/** Resolve contact between two cars (mutates both). Returns true on contact. */
export function collidePair(a: Car, b: Car, len: number) {
  const dz = wrapDiff(b.z - a.z, len);
  if (Math.abs(dz) >= CAR_LEN || Math.abs(b.x - a.x) >= CAR_W) return false;
  const rear = dz > 0 ? a : b, front = dz > 0 ? b : a;
  if (rear.speed > front.speed) {
    const diff = rear.speed - front.speed;
    rear.speed = front.speed * 0.9;
    front.speed += diff * 0.25;
    rear.bump = 0.25; front.bump = Math.max(front.bump, 0.12);
  }
  const push = a.x < b.x || (a.x === b.x && a.idx < b.idx) ? -0.012 : 0.012;
  a.x += push; b.x -= push;
  return true;
}

/** Steering that exactly cancels the curve push, and the speed fraction above which it is impossible. */
function curveNeeds(c: Car, curve: number, weather: Weather) {
  const cls = CAR_CLASSES[c.classId], g = gripFactors(weather);
  const sp = c.speed / cls.top;
  const steer = (sp * sp * curve * CENT_K * g.cent) / (Math.max(0.05, Math.min(1, sp * 2.2)) * cls.grip * g.grip);
  const limit = Math.abs(curve) < 0.01 ? 9 : Math.sqrt((0.92 * cls.grip * g.grip) / (Math.abs(curve) * CENT_K * g.cent));
  return { steer, limit };
}

function decideLane(w: World, c: Car) {
  const len = w.track.length;
  let blocked = false;
  for (const o of w.cars) {
    if (o === c) continue;
    const dz = wrapDiff(o.z - c.z, len);
    if (dz > 0 && dz < 2600 && Math.abs(o.x - c.x) < 0.5 && o.speed < c.speed + 150) { blocked = true; break; }
  }
  if (!blocked) return;
  const lanes = [-0.62, 0, 0.62].sort((p, q) => Math.abs(p - c.x) - Math.abs(q - c.x));
  for (const l of lanes) {
    if (Math.abs(l - c.lane) < 0.01) continue;
    let free = true;
    for (const o of w.cars) {
      if (o === c) continue;
      const dz = wrapDiff(o.z - c.z, len);
      if (dz > -900 && dz < 2800 && Math.abs(o.x - l) < 0.45) { free = false; break; }
    }
    if (free) { c.lane = l; return; }
  }
}

export function aiInput(w: World, i: number, cruise = false): Input {
  const c = w.cars[i], t = w.track, n = t.segments.length, cls = CAR_CLASSES[c.classId];
  const si = Math.floor(c.z / SEG_LEN) % n, seg = t.segments[si];
  if ((w.tick + i * 7) % 15 === 0) decideLane(w, c);
  let target = c.lane;
  const sp = c.speed / cls.top;

  // pit stop decision
  const perLap = (t.length / cls.tank) * 1.12;
  const lastLap = c.lap >= w.laps;
  const low = !lastLap && c.fuel < perLap * 1.25;
  const toPit = (t.pitStart - si + n) % n;
  const inZone = si >= t.pitStart && si < t.pitEnd;
  const pitting = !cruise && c.lap >= 1 && ((low && (toPit < 90 || inZone)) || (c.inPit && !lastLap && c.fuel < Math.min(0.98, perLap * (w.laps - c.lap + 0.3))));
  let pitBrake = false;
  if (pitting) {
    target = inZone ? 1.52 : 0.85;
    pitBrake = (toPit < 28 || inZone) && c.speed > PIT_SPEED - 200;
  }

  const look = t.segments[(si + Math.floor(8 + sp * 16)) % n].curve;
  const cv = Math.abs(look) > Math.abs(seg.curve) ? look : seg.curve;
  const need = curveNeeds(c, seg.curve, w.weather);
  const steer = clamp((target - c.x) * 3.5 + need.steer, -1, 1);
  let targetSp = Math.min(c.skill, curveNeeds(c, cv, w.weather).limit * (0.93 + c.skill * 0.06));
  if (cruise) targetSp = Math.min(targetSp, 0.45);
  let throttle = sp < targetSp ? 1 : 0;
  let brake = sp > targetSp + 0.07 ? 0.7 : 0;
  if (pitBrake) { throttle = 0; brake = c.speed > PIT_SPEED + 300 ? 1 : 0; }
  const nitro = !cruise && !pitting && c.nitro > 0 && c.lap >= 1 && Math.abs(cv) < 1 && c.fuel > 0.2 && (w.tick + i * 131) % 900 === 0;
  return { steer, throttle, brake, nitro, up: false, down: false };
}

/** Advance the whole race one tick. `inputs[idx]` is used for non-AI cars. */
export function stepWorld(w: World, inputs: (Input | undefined)[]) {
  w.tick++;
  if (w.phase === 'countdown') {
    for (const c of w.cars) {
      const thr = c.isAI ? 0.5 + 0.4 * Math.sin(w.tick * 0.2 + c.idx) : inputs[c.idx]?.throttle ?? 0;
      c.rpm += (thr * 0.85 - c.rpm) * 0.15;
    }
    if (w.tick >= COUNTDOWN_TICKS) w.phase = 'racing';
    return;
  }
  if (w.phase === 'done') return;
  const len = w.track.length;
  for (const c of w.cars) {
    if (c.dnf) { c.speed = 0; continue; }
    const inp = c.finished ? aiInput(w, c.idx, true) : c.isAI ? aiInput(w, c.idx) : inputs[c.idx] ?? NO_INPUT;
    stepCar(c, inp, w.track, w.weather);
    if (!c.finished && c.lap > w.laps) {
      c.finished = true; c.finishTick = w.tick;
      if (c.human && !w.firstFinishTick) w.firstFinishTick = w.tick;
    }
    if (!c.finished && c.fuel <= 0 && c.speed < 30 && !c.inPit) {
      c.stallT += DT;
      if (c.stallT > 3) { c.dnf = true; c.finished = true; c.finishTick = 0; }
    } else c.stallT = 0;
  }
  const cs = w.cars;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    if (!cs[i].dnf && !cs[j].dnf) collidePair(cs[i], cs[j], len);
  }
  const humans = cs.filter((c) => c.human);
  if (humans.length === 0 ? cs.every((c) => c.finished) : humans.every((c) => c.finished) ||
    (w.firstFinishTick > 0 && w.tick - w.firstFinishTick > 45 * 60)) w.phase = 'done';
}

export const progress = (c: Car, len: number) => c.lap * len + c.z;

/** Car indices in race order (leader first). */
export function standings(w: World): number[] {
  const len = w.track.length;
  return w.cars.map((c) => c.idx).sort((a, b) => {
    const A = w.cars[a], B = w.cars[b];
    const fa = A.finished && !A.dnf, fb = B.finished && !B.dnf;
    if (fa && fb) return A.finishTick - B.finishTick;
    if (fa !== fb) return fa ? -1 : 1;
    return progress(B, len) - progress(A, len);
  });
}

export const raceTime = (c: Car) => (c.finished && !c.dnf ? (c.finishTick - COUNTDOWN_TICKS) / 60 : -1);
export const POINTS = [20, 15, 12, 10, 8, 6, 4, 3, 2, 1, 0, 0];
export const AI_NAMES = ['R. Falcão', 'K. Tanaka', 'L. Moretti', 'S. Lindqvist', 'J. Carter', 'A. Dubois', 'M. Okafor', 'P. Novak', 'D. Reyes', 'H. Berg', 'T. Mwangi', 'C. Silva'];
