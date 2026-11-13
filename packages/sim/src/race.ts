import { drive, makeProfile, type AiProfile, type Driver } from './ai';
import { collide, DT, makeCar, noInput, stepCar, type Car, type Input } from './car';
import type { CarSpec } from './specs';
import { heightAt, locate, pointAt, type Track } from './track';

export interface Entrant { spec: CarSpec; driver: Driver | null; name: string; paint: number; }
export interface Racer {
  car: Car; ai: AiProfile | null; name: string; paint: number;
  /** metres travelled since the start line; negative on the grid */
  dist: number; lap: number; lapStart: number; lapTimes: number[]; best: number;
  finished: boolean; finishTick: number; place: number;
}
export interface Race {
  track: Track; laps: number; tick: number;
  /** ticks until the lights go out; racing while <= 0 */
  countdown: number; racers: Racer[]; over: boolean; rubber: number;
}

export const COUNTDOWN = 240;
/** point-to-point tracks end this many metres after the finish line */
export const FINISH_BEFORE_END = 320;

/** Entrants are listed in grid order, pole first. */
export function createRace(track: Track, entrants: Entrant[], laps: number, seed = 1, rubber = 0.5): Race {
  const racers = entrants.map((e, k) => {
    const car = makeCar(k, e.spec);
    // closed loops start behind the line; point-to-point tracks start 30 m in, pole in front
    const s0 = track.open ? 30 + (entrants.length - 1 - k) * 7.5 : track.len - 10 - k * 7.5;
    const [x, y, z, yaw] = pointAt(track, s0, track.open ? (k % 2 ? 2.4 : -2.4) : (k % 2 ? 2.8 : -2.8));
    car.x = x; car.y = y; car.z = z; car.yaw = yaw; locate(track, x, z, -1, car.loc); car.y = heightAt(track, car.loc);
    const ai = e.driver ? makeProfile(track, e.spec, e.driver, seed * 7919 + k * 104729) : null;
    return { car, ai, name: e.name, paint: e.paint, dist: track.open ? s0 : -(10 + k * 7.5), lap: 0, lapStart: 0, lapTimes: [], best: 0, finished: false, finishTick: 0, place: k + 1 } as Racer;
  });
  return { track, laps: track.open ? 1 : laps, tick: 0, countdown: COUNTDOWN, racers, over: false, rubber };
}

const aiIn = noInput();

/** Advance the race one 60 Hz tick. `inputs[i]` drives racer i when it has no AI driver. */
export function stepRace(r: Race, inputs: (Input | null)[]) {
  const t = r.track, hold = r.countdown > 0, cars = r.racers.map((q) => q.car);
  if (hold) r.countdown--;
  let human = -Infinity; for (const q of r.racers) if (!q.ai) human = Math.max(human, q.dist);
  for (let k = 0; k < r.racers.length; k++) {
    const q = r.racers[k], c = q.car; let inp = inputs[k] ?? aiIn;
    if (q.ai) {
      // rubber band: ease off when far ahead of the player, push when far behind
      let pace = 1;
      if (human > -Infinity && r.rubber > 0) pace += Math.max(-0.05, Math.min(0.04, (human - q.dist) / 3000)) * r.rubber;
      inp = drive(c, q.ai, t, cars, q.finished ? 0.7 : pace, aiIn);
    } else if (q.finished) { inp = aiIn; aiIn.steer = 0; aiIn.throttle = 0; aiIn.brake = t.open ? 1 : 0.4; aiIn.nitro = false; aiIn.handbrake = false; aiIn.shift = 0; }
    // slipstream from the car ahead
    let draft = 0;
    for (const o of cars) {
      if (o === c) continue;
      const dx = o.x - c.x, dz = o.z - c.z, f = dx * Math.cos(c.yaw) + dz * Math.sin(c.yaw), s = -dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw);
      if (f > 3 && f < 34 && Math.abs(s) < 1.7 && o.vx > 25) draft = Math.max(draft, 1 - (f - 3) / 31);
    }
    c.draft += (draft - c.draft) * 0.08;
    const before = c.loc.idx + c.loc.frac;
    stepCar(c, inp, t, hold);
    let d = (c.loc.idx + c.loc.frac - before) * t.step;
    if (!t.open) { if (d > t.len / 2) d -= t.len; else if (d < -t.len / 2) d += t.len; }
    q.dist += d;
  }
  for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) collide(cars[a], cars[b]);
  if (!hold) {
    r.tick++;
    for (const q of r.racers) {
      const lap = t.open ? (q.dist >= t.len - FINISH_BEFORE_END ? 1 : 0) : Math.floor(q.dist / t.len);
      if (lap > q.lap && !q.finished) {
        const time = r.tick - q.lapStart; q.lapTimes.push(time); if (!q.best || time < q.best) q.best = time;
        q.lapStart = r.tick; q.lap = lap;
        if (lap >= r.laps) { q.finished = true; q.finishTick = r.tick; }
      }
    }
    const order = r.racers.slice().sort((a, b) => (a.finished && b.finished ? a.finishTick - b.finishTick : a.finished ? -1 : b.finished ? 1 : b.dist - a.dist));
    order.forEach((q, k) => { if (!q.finished || !q.place || q.finishTick === r.tick) q.place = k + 1; });
    r.over = r.racers.every((q) => q.finished || q.ai) && r.racers.some((q) => q.finished);
  }
}

export const ticksToSeconds = (ticks: number) => ticks * DT;
