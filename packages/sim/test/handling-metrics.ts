/** Handling metrics shared by steering.test.ts and tools/handling-report.mjs. Every metric takes an optional `handling` preset (applied as `car.h`, a no-op until the Handling field exists). */
import { buildTrack, makeCar, noInput, stepCar, locate, RIO, type CarSpec } from '../src/index';

export const rio = buildTrack(RIO);
/** A flat, endlessly wide track so a car can circle without meeting barriers or slopes. */
export const flat = { ...rio, hw: new Float64Array(rio.n).fill(1e6), slope: new Float64Array(rio.n), bank: new Float64Array(rio.n) } as typeof rio;
export const G = 9.81;
export const kmh = (x: number) => x / 3.6;
const DEG = 180 / Math.PI;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

type Car = ReturnType<typeof makeCar>;
/** Preset applied to the car; until `Car.h` exists this does nothing. */
const apply = (c: Car, h?: unknown) => { if (h !== undefined) (c as unknown as { h: unknown }).h = h; return c; };

export function fresh(spec: CarSpec, v: number, h?: unknown, track = rio, idx = 10) {
  const c = makeCar(0, spec); c.x = track.px[idx]; c.z = track.pz[idx]; c.yaw = 0; c.vx = v; c.gear = Math.max(1, spec.gears.length - 1);
  // pick the gear whose wheel speed fits
  for (let g = 1; g <= spec.gears.length; g++) { c.gear = g; if ((v / spec.wheelR) * spec.gears[g - 1] * spec.final * (30 / Math.PI) < spec.redline * 0.85) break; }
  c.rpm = spec.idle + 2000; return apply(c, h);
}
/** simple cruise: hold speed with throttle / brake */
export function cruise(c: Car, v: number, inp = noInput()) {
  const e = v - Math.hypot(c.vx, c.vy);
  inp.throttle = Math.max(0, Math.min(1, 0.3 + e * 0.5)); inp.brake = e < -1 ? Math.min(0.5, -e * 0.1) : 0; return inp;
}
export interface Steady { ay: number; delta: number; beta: number; spun: boolean; wz: number; vEnd: number }
/** Hold speed `v` and steer `steerN` (-1..1 of the steering limit) until steady; report lateral acceleration and balance. */
export function steady(spec: CarSpec, v: number, steerN: number, secs = 5, h?: unknown): Steady {
  const c = fresh(spec, v, h), inp = noInput(); let ay = 0, delta = 0, beta = 0, wz = 0, n = 0, maxBeta = 0;
  for (let k = 0; k < 60 * secs; k++) {
    cruise(c, v, inp); inp.steer = steerN; stepCar(c, inp, flat, false);
    const b = Math.abs(Math.atan2(c.vy, Math.max(1, Math.abs(c.vx)))); maxBeta = Math.max(maxBeta, b);
    if (k >= 60 * (secs - 1.5)) { ay += Math.hypot(c.vx, c.vy) * c.wz; delta += c.steer; beta += Math.atan2(c.vy, Math.max(1, c.vx)); wz += c.wz; n++; }
  }
  return { ay: Math.abs(ay / n), delta: Math.abs(delta / n), beta: Math.abs(beta / n), spun: maxBeta > 0.5, wz: Math.abs(wz / n), vEnd: Math.hypot(c.vx, c.vy) };
}
/** Full lock at speed v: peak steady lateral acceleration (m/s2) and slip angle. */
export const skidpad = (spec: CarSpec, v: number, h?: unknown) => steady(spec, v, 1, 5, h);
/** Step the steering to `steerN` and time the yaw response. */
export function stepSteer(spec: CarSpec, v: number, steerN = 0.6, h?: unknown) {
  const c = fresh(spec, v, h), inp = noInput();
  for (let k = 0; k < 60; k++) { cruise(c, v, inp); stepCar(c, inp, flat, false); }
  const wzs: number[] = []; let maxBeta = 0;
  for (let k = 0; k < 60 * 3; k++) { cruise(c, v, inp); inp.steer = steerN; stepCar(c, inp, flat, false); wzs.push(Math.abs(c.wz)); maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(c.vy, Math.max(1, c.vx)))); }
  const fin = wzs[wzs.length - 1], t90 = wzs.findIndex((w) => w >= 0.9 * fin) / 60;
  return { t90, wz: fin, maxBeta, overshoot: Math.max(...wzs) / fin };
}

// ---- keyboard emulation (mirrors packages/game/src/input.ts read()) ----
export type Ramp = (steer: number, want: number, dt: number, speed: number) => number;
const move = (steer: number, want: number, rate: number, dt: number) => steer + Math.max(-rate * dt, Math.min(rate * dt, want - steer));
const reversing = (steer: number, want: number) => Math.sign(want) !== Math.sign(steer) && steer !== 0;
/** Today's (Simulacao) keyboard ramp: wind-on 5 -> 3 /s by speed/55, release 8, reversal 10. */
export const simRamp: Ramp = (steer, want, dt, speed) => move(steer, want, want === 0 ? 8 : reversing(steer, want) ? 10 : 5 - 2 * clamp01(speed / 55), dt);
/** Planned Arcade ramp: release 6, reversal 10, wind-on below sp 0.5 = 6-3sp, above = 3-2sp. */
export const arcadeRamp: Ramp = (steer, want, dt, speed) => {
  const sp = clamp01(speed / 55), wind = sp < 0.5 ? 6 - 3 * sp : 3 - 2 * sp;
  return move(steer, want, want === 0 ? 6 : reversing(steer, want) ? 10 : wind, dt);
};
export const RAMPS = { sim: simRamp, arcade: arcadeRamp };
const beta = (c: Car) => Math.atan2(c.vy, Math.max(1, Math.abs(c.vx)));
/** Full slide angle of the velocity against the nose (up to 180 deg when travelling backwards); 0 below 2 m/s. */
const slide = (c: Car) => (Math.hypot(c.vx, c.vy) < 2 ? 0 : Math.abs(Math.atan2(c.vy, c.vx)));

/** Heading change (deg) from a keyboard tap of `tapSec` seconds, measured after the car has settled. */
export function keyTap(spec: CarSpec, v: number, tapSec = 0.25, h?: unknown, ramp: Ramp = simRamp) {
  const c = fresh(spec, v, h), inp = noInput(); let s = 0;
  for (let k = 0; k < 60; k++) { cruise(c, v, inp); stepCar(c, inp, flat, false); }
  const y0 = c.yaw, dt = 1 / 60;
  for (let k = 0; k < 60 * (tapSec + 3); k++) {
    cruise(c, v, inp); s = ramp(s, k < 60 * tapSec ? 1 : 0, dt, Math.abs(c.vx)); inp.steer = s; stepCar(c, inp, flat, false);
  }
  return Math.abs(c.yaw - y0) * DEG;
}
/** Hold a key for `secs`: yaw-rate overshoot against the final value and the largest slip angle (rad). */
export function keyHold(spec: CarSpec, v: number, h?: unknown, ramp: Ramp = simRamp, secs = 4) {
  const c = fresh(spec, v, h), inp = noInput(); let s = 0, maxBeta = 0, peak = 0, fin = 0, n = 0;
  for (let k = 0; k < 60; k++) { cruise(c, v, inp); stepCar(c, inp, flat, false); }
  for (let k = 0; k < 60 * secs; k++) {
    cruise(c, v, inp); s = ramp(s, 1, 1 / 60, Math.abs(c.vx)); inp.steer = s; stepCar(c, inp, flat, false);
    maxBeta = Math.max(maxBeta, Math.abs(beta(c))); peak = Math.max(peak, Math.abs(c.wz));
    if (k >= 60 * (secs - 1)) { fin += Math.abs(c.wz); n++; }
  }
  return { overshoot: peak / (fin / n), maxBeta };
}
/** Handbrake (with full steer) for `holdSec` at speed v: peak slide angle (deg, up to 180), total yaw turned (deg) and seconds to get back under 5 deg slide after release (Infinity if not within 5 s). `keepSteer` leaves the wheel at full lock after release. */
export function handbrake(spec: CarSpec, v: number, holdSec = 0.7, h?: unknown, keepSteer = false) {
  const c = fresh(spec, v, h), inp = noInput();
  for (let k = 0; k < 60; k++) { cruise(c, v, inp); stepCar(c, inp, flat, false); }
  let peak = 0, yaw = 0; const y0 = c.yaw;
  for (let k = 0; k < 60 * holdSec; k++) { inp.throttle = 0; inp.brake = 0; inp.steer = 1; inp.handbrake = true; stepCar(c, inp, flat, false); peak = Math.max(peak, slide(c)); yaw = Math.max(yaw, Math.abs(c.yaw - y0)); }
  let rec = Infinity;
  for (let k = 0; k < 60 * 5; k++) {
    inp.throttle = 0; inp.brake = 0; inp.steer = keepSteer ? 1 : 0; inp.handbrake = false; stepCar(c, inp, flat, false);
    peak = Math.max(peak, slide(c)); yaw = Math.max(yaw, Math.abs(c.yaw - y0));
    if (slide(c) * DEG < 5 && rec === Infinity) rec = (k + 1) / 60;
  }
  return { peak: peak * DEG, yaw: yaw * DEG, recover: rec };
}
/** Full lock for 2 s, then full brake with the lock held: peak slide angle (deg). */
export function brakeInTurn(spec: CarSpec, v: number, h?: unknown) {
  const c = fresh(spec, v, h), inp = noInput(); let peak = 0;
  for (let k = 0; k < 120; k++) { cruise(c, v, inp); inp.steer = 1; stepCar(c, inp, flat, false); }
  for (let k = 0; k < 60 * 3; k++) { inp.throttle = 0; inp.brake = 1; inp.steer = 1; stepCar(c, inp, flat, false); peak = Math.max(peak, Math.abs(beta(c))); }
  return peak * DEG;
}
/** Full lock for 2 s, then full throttle with the lock held: peak slide angle (deg). */
export function powerOn(spec: CarSpec, v: number, h?: unknown) {
  const c = fresh(spec, v, h), inp = noInput(); let peak = 0;
  for (let k = 0; k < 120; k++) { cruise(c, v, inp); inp.steer = 1; stepCar(c, inp, flat, false); }
  for (let k = 0; k < 60 * 3; k++) { inp.throttle = 1; inp.brake = 0; inp.steer = 1; stepCar(c, inp, flat, false); peak = Math.max(peak, Math.abs(beta(c))); }
  return peak * DEG;
}
/** Steady lateral g at `frac` of full lock as a share of the full-lock (skidpad) lateral g. */
export function lockShare(spec: CarSpec, v: number, frac: number, h?: unknown) {
  return steady(spec, v, frac, 5, h).ay / steady(spec, v, 1, 5, h).ay;
}
/** Understeer gradient in deg/g between ~0.2 and ~0.5 g (steer 0.12 and 0.3 of the limit, as steering.test.ts does). */
export function understeerGradient(spec: CarSpec, v: number, h?: unknown) {
  const a = steady(spec, v, 0.12, 5, h), b = steady(spec, v, 0.3, 5, h);
  const kin = (r: Steady) => r.delta - (spec.wheelbase * r.wz) / v;
  return ((kin(b) - kin(a)) / (b.ay / G - a.ay / G)) * 57.2958;
}
/** Raw step-steer yaw overshoot (peak / final) at full lock. */
export const steadyOvershoot = (spec: CarSpec, v: number, h?: unknown) => stepSteer(spec, v, 1, h).overshoot;

/** Index of the straightest 400 m stretch of Rio, used for wall tests. */
const straightIdx = (() => {
  const span = Math.ceil(400 / rio.step); let best = 0, bk = Infinity;
  for (let i = 0; i < rio.n - span - 5; i += 3) { let k = 0; for (let j = i; j < i + span; j++) k += Math.abs(rio.curv[j]); if (k < bk) { bk = k; best = i; } }
  return best;
})();
/** Percent of speed lost `settleSec` after the car meets the barrier at `angleDeg` to the track (uses the real wall code on a straight of Rio). */
export function wallGraze(spec: CarSpec, v: number, angleDeg: number, h?: unknown, settleSec = 0.7) {
  const i0 = straightIdx, c = fresh(spec, v, h, rio, i0), inp = noInput();
  const along = Math.atan2(rio.tz[i0], rio.tx[i0]), wall = rio.hw[i0] + rio.def.shoulder - spec.halfW - 1.5;
  c.x += -rio.tz[i0] * wall; c.z += rio.tx[i0] * wall; c.yaw = along + angleDeg / DEG; c.vx = v;
  locate(rio, c.x, c.z, i0, c.loc);
  let hit = -1;
  for (let k = 0; k < 60 * 6; k++) {
    if (hit < 0) cruise(c, v, inp); else { inp.throttle = 0; inp.brake = 0; }
    inp.steer = 0; stepCar(c, inp, rio, false);
    if (hit < 0 && c.hit > 0) hit = k;
    if (hit >= 0 && k === hit + Math.round(60 * settleSec)) break;
  }
  return hit < 0 ? 0 : (1 - Math.hypot(c.vx, c.vy) / v) * 100;
}
