import { describe, expect, it } from 'vitest';
import * as sim from '../src/index';
import { ARCADE, BASE, CARS, SIM, noInput, stepCar, steerLimit } from '../src/index';
import { G, flat, fresh, cruise, steady, skidpad, stepSteer, kmh, keyTap, keyHold, handbrake, brakeInTurn, powerOn, lockShare, understeerGradient, arcadeRamp, type Steady } from './handling-metrics';


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

/** Arcade (NFS4-style) preset: every car, 60/100/180 km/h, with the Arcade keyboard ramp. */
describe('arcade handling', () => {
  const h = ARCADE, speeds = [60, 100, 180];
  it('makeCar defaults to the SIM preset', () => { expect(fresh(CARS[0].spec, 10).h).toBe(SIM); });
  it('skidpad reaches the tyre limit, grips at full lock and never spins', () => {
    for (const c of CARS) for (const k of speeds) {
      const r = skidpad(c.spec, kmh(k), h); expect(r.ay / G, `${c.id} ${k}`).toBeGreaterThan(0.95 * c.spec.mu * (1 - Math.abs(c.spec.balance ?? 0) * 0.5));
      expect(r.beta, `${c.id} ${k}`).toBeLessThan(0.12); expect(r.spun).toBe(false);
    }
  });
  it('understeer is mild and progressive', () => {
    for (const c of CARS) {
      const v = kmh(100), ug = understeerGradient(c.spec, v, h); expect(ug, c.id).toBeGreaterThan(0.8); expect(ug, c.id).toBeLessThan(3.0);
      for (const k of speeds) {
        const l25 = lockShare(c.spec, kmh(k), 0.25, h), l50 = lockShare(c.spec, kmh(k), 0.5, h);
        expect(l25, `${c.id} ${k} 25%`).toBeGreaterThan(0.65); expect(l25, `${c.id} ${k} 25%`).toBeLessThan(0.95);
        expect(l50, `${c.id} ${k} 50%`).toBeGreaterThan(0.88); expect(l50, `${c.id} ${k} 50%`).toBeLessThan(1.05);
      }
    }
  });
  it('turns in crisply without overshoot', () => {
    for (const c of CARS) for (const k of speeds) {
      const st = stepSteer(c.spec, kmh(k), 1, h);
      expect(st.t90, `${c.id} ${k}`).toBeLessThan(0.45); expect(st.overshoot, `${c.id} ${k} raw`).toBeLessThan(1.5); expect(st.maxBeta, `${c.id} ${k}`).toBeLessThan(0.3);
      expect(keyHold(c.spec, kmh(k), h, arcadeRamp).overshoot, `${c.id} ${k} key`).toBeLessThan(1.30);
    }
  });
  it('a 0.25 s tap turns 3.8-5.8 degrees at 180 km/h and over 7 at 100 km/h', () => {
    for (const c of CARS) {
      const t = keyTap(c.spec, kmh(180), 0.25, h, arcadeRamp); expect(t, `${c.id} 180`).toBeGreaterThan(3.8); expect(t, `${c.id} 180`).toBeLessThan(5.8);
      expect(keyTap(c.spec, kmh(100), 0.25, h, arcadeRamp), `${c.id} 100`).toBeGreaterThan(7);
    }
  });
  it('steerLimit without a boost equals boost 0', () => {
    for (const c of CARS) for (const k of speeds) for (const g of [0.6, 1]) expect(steerLimit(c.spec, kmh(k), g, 0.085)).toBe(steerLimit(c.spec, kmh(k), g, 0.085, 0));
  });
  it('braking or powering at full lock stays catchable', () => {
    for (const c of CARS) for (const k of speeds) {
      expect(brakeInTurn(c.spec, kmh(k), h), `${c.id} ${k} brake`).toBeLessThan(25); expect(powerOn(c.spec, kmh(k), h), `${c.id} ${k} power`).toBeLessThan(14);
    }
  });
  it('handbrake gives a 30-50 degree drift, never more, and straightens on release', () => {
    for (const c of CARS) for (const k of speeds) {
      const a = handbrake(c.spec, kmh(k), 0.7, h), b = handbrake(c.spec, kmh(k), 2, h);
      expect(a.peak, `${c.id} ${k} 0.7s`).toBeGreaterThan(25); expect(a.peak, `${c.id} ${k} 0.7s`).toBeLessThan(50);
      expect(b.peak, `${c.id} ${k} 2s`).toBeGreaterThan(30); expect(b.peak, `${c.id} ${k} 2s`).toBeLessThan(50);
      expect(a.recover, `${c.id} ${k} recover`).toBeLessThan(0.8);
    }
  });
  it('the handbrake with full lock kept after release still does not spin out', () => {
    for (const c of CARS) for (const k of speeds) expect(handbrake(c.spec, kmh(k), 0.7, h, true).recover, `${c.id} ${k}`).toBeLessThan(5);
  });
  it('rain and snow: full lock does not spin', () => {
    for (const c of CARS) for (const [name, grip] of [['rain', 0.82], ['snow', 0.6]] as const) for (const k of speeds) {
      const car = fresh(c.spec, kmh(k), h), inp = noInput(); car.grip = grip; let maxBeta = 0;
      for (let i = 0; i < 60 * 5; i++) { cruise(car, kmh(k), inp); inp.steer = 1; stepCar(car, inp, flat, false); maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(car.vy, Math.max(1, Math.abs(car.vx))))); }
      expect(maxBeta, `${c.id} ${name} ${k}`).toBeLessThan(0.5);
    }
  });
  it('drift state is 1 while the handbrake is held and decays over 0.6 s', () => {
    const car = fresh(CARS[0].spec, kmh(100), h), inp = noInput(); inp.handbrake = true; stepCar(car, inp, flat, false); expect(car.drift).toBe(1);
    inp.handbrake = false; for (let i = 0; i < 40; i++) stepCar(car, inp, flat, false); expect(car.drift).toBe(0);
  });
});
