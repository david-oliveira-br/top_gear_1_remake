import { describe, expect, it } from 'vitest';
import * as sim from '../src/index';
import { BASE, CARS, buildTrack, makeCar, noInput, stepCar, RIO, steerLimit, type CarSpec } from '../src/index';

/** A flat, endlessly wide track so a car can circle without meeting barriers or slopes. */
const rio = buildTrack(RIO);
const flat = { ...rio, hw: new Float64Array(rio.n).fill(1e6), slope: new Float64Array(rio.n), bank: new Float64Array(rio.n) } as typeof rio;
const G = 9.81;

function fresh(spec: CarSpec, v: number) {
  const c = makeCar(0, spec); c.x = rio.px[10]; c.z = rio.pz[10]; c.yaw = 0; c.vx = v; c.gear = Math.max(1, spec.gears.length - 1);
  // pick the gear whose wheel speed fits
  for (let g = 1; g <= spec.gears.length; g++) { c.gear = g; if ((v / spec.wheelR) * spec.gears[g - 1] * spec.final * (30 / Math.PI) < spec.redline * 0.85) break; }
  c.rpm = spec.idle + 2000; return c;
}
/** simple cruise: hold speed with throttle / brake */
function cruise(c: ReturnType<typeof makeCar>, v: number, inp = noInput()) {
  const e = v - Math.hypot(c.vx, c.vy);
  inp.throttle = Math.max(0, Math.min(1, 0.3 + e * 0.5)); inp.brake = e < -1 ? Math.min(0.5, -e * 0.1) : 0; return inp;
}
export interface Steady { ay: number; delta: number; beta: number; spun: boolean; wz: number; vEnd: number }
/** Hold speed `v` and steer `steerN` (-1..1 of the steering limit) until steady; report lateral acceleration and balance. */
export function steady(spec: CarSpec, v: number, steerN: number, secs = 5): Steady {
  const c = fresh(spec, v), inp = noInput(); let ay = 0, delta = 0, beta = 0, wz = 0, n = 0, maxBeta = 0;
  for (let k = 0; k < 60 * secs; k++) {
    cruise(c, v, inp); inp.steer = steerN; stepCar(c, inp, flat, false);
    const b = Math.abs(Math.atan2(c.vy, Math.max(1, Math.abs(c.vx)))); maxBeta = Math.max(maxBeta, b);
    if (k >= 60 * (secs - 1.5)) { ay += Math.hypot(c.vx, c.vy) * c.wz; delta += c.steer; beta += Math.atan2(c.vy, Math.max(1, c.vx)); wz += c.wz; n++; }
  }
  return { ay: Math.abs(ay / n), delta: Math.abs(delta / n), beta: Math.abs(beta / n), spun: maxBeta > 0.5, wz: Math.abs(wz / n), vEnd: Math.hypot(c.vx, c.vy) };
}
/** Full lock at speed v: peak steady lateral acceleration (m/s2) and slip angle. */
export const skidpad = (spec: CarSpec, v: number) => steady(spec, v, 1);
/** Step the steering to full and time the yaw response. */
export function stepSteer(spec: CarSpec, v: number, steerN = 0.6) {
  const c = fresh(spec, v), inp = noInput();
  for (let k = 0; k < 60; k++) { cruise(c, v, inp); stepCar(c, inp, flat, false); }
  const wzs: number[] = []; let maxBeta = 0;
  for (let k = 0; k < 60 * 3; k++) { cruise(c, v, inp); inp.steer = steerN; stepCar(c, inp, flat, false); wzs.push(Math.abs(c.wz)); maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(c.vy, Math.max(1, c.vx)))); }
  const fin = wzs[wzs.length - 1], t90 = wzs.findIndex((w) => w >= 0.9 * fin) / 60;
  return { t90, wz: fin, maxBeta, overshoot: Math.max(...wzs) / fin };
}
const kmh = (x: number) => x / 3.6;

const cars = CARS.map((c) => c.spec);
describe('steering and slip', () => {
  it('skidpad at 100 km/h reaches the tyre limit without spinning', () => {
    for (const c of CARS) {
      const r = skidpad(c.spec, kmh(100)), mu = c.spec.mu;
      expect(r.ay / G, c.id).toBeGreaterThan(0.9 * mu); expect(r.ay / G, c.id).toBeLessThan(1.05 * mu * (1 + Math.abs(c.spec.balance ?? 0)) + 0.06);
      expect(r.spun).toBe(false);
    }
  });
  it('turns in crisply: 90% of the steady yaw rate within 0.45 s', () => {
    for (const s of cars) for (const k of [60, 100, 180]) expect(stepSteer(s, kmh(k)).t90).toBeLessThan(0.45);
  });
  it('does not spin on full lock at 60, 120 and 180 km/h', () => {
    for (const c of CARS) for (const k of [60, 120, 180]) {
      const r = skidpad(c.spec, kmh(k)); expect(r.beta, `${c.id} ${k}`).toBeLessThan(0.2); expect(r.spun).toBe(false);
      expect(stepSteer(c.spec, kmh(k), 1).maxBeta, `${c.id} ${k} step`).toBeLessThan(0.3);
    }
  });
  it('recovers on lift-off from full lock', () => {
    for (const c of CARS) {
      const car = fresh(c.spec, kmh(120)), inp = noInput();
      for (let k = 0; k < 180; k++) { cruise(car, kmh(120), inp); inp.steer = 1; stepCar(car, inp, flat, false); }
      for (let k = 0; k < 60 * 4; k++) { inp.steer = 0; inp.throttle = 0; inp.brake = 0; stepCar(car, inp, flat, false); }
      expect(Math.abs(car.wz), c.id).toBeLessThan(0.1); expect(Math.abs(Math.atan2(car.vy, car.vx)), c.id).toBeLessThan(0.1);
    }
  });
  it('trail braking in a turn keeps the car stable and still rotating', () => {
    for (const c of CARS) {
      const car = fresh(c.spec, kmh(120)), inp = noInput();
      for (let k = 0; k < 120; k++) { cruise(car, kmh(120), inp); inp.steer = 0.1; stepCar(car, inp, flat, false); }
      let maxBeta = 0; const wz0 = Math.abs(car.wz);
      for (let k = 0; k < 60; k++) { inp.throttle = 0; inp.brake = Math.min(1, (0.4 * c.spec.mass * G) / c.spec.brake); inp.steer = 0.1; stepCar(car, inp, flat, false); maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(car.vy, car.vx))); }
      expect(maxBeta, c.id).toBeLessThan((c.spec.balance ?? 0) > 0 ? 0.35 : 0.2); expect(Math.abs(car.wz), c.id).toBeGreaterThan(wz0 * 0.5);
    }
  });
  it('understeer gradient is near neutral (0..1.5 deg/g, lively cars may go slightly negative)', () => {
    for (const c of CARS) {
      const s = c.spec, v = kmh(100), a = steady(s, v, 0.12), b = steady(s, v, 0.3);
      const kin = (r: Steady) => r.delta - (s.wheelbase * r.wz) / v;
      const ug = ((kin(b) - kin(a)) / (b.ay / G - a.ay / G)) * 57.2958;
      expect(ug, c.id).toBeGreaterThan(-0.5); expect(ug, c.id).toBeLessThan(1.5);
    }
  });
  it('steerNorm is steer over the limit', () => {
    expect(sim.steerNorm(BASE, 30, 1, steerLimit(BASE, 30, 1) * 0.5)).toBeCloseTo(0.5, 9);
  });
});
