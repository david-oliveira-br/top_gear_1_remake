import { describe, expect, it } from 'vitest';
import fixtureJson from './fixtures/base-specs.json';
import { BASE, CARS, EVENTS, RIO, PART_IDS, buildSpec, buildTrack, carById, carStats, createRace, defaultTuning, makeCar, newCareer, noInput, noParts, playerSpec, rivalCars, rivalSpec, stepCar, stepRace, locate, heightAt, buyPart, type Driver, type Tuning } from '../src/index';

const track = buildTrack(RIO);
const ace: Driver = { name: 'ace', skill: 0.97, aggression: 0.5, consistency: 1 };

describe('buildSpec is base-relative', () => {
  it('reproduces the pre-refactor numbers for BASE at every part level', () => {
    const fixture = fixtureJson as Record<string, Record<string, unknown>>;
    const tunes: Tuning[] = [{ gearing: 1, wing: 0.5, bias: 0.62 }, { gearing: 1.08, wing: 0.9, bias: 0.55 }];
    let n = 0;
    tunes.forEach((tu, ti) => {
      const cases: [string, ReturnType<typeof noParts>][] = [];
      for (const id of PART_IDS) for (let l = 0; l <= 3; l++) { const p = noParts(); p[id] = l; cases.push([`${ti}:${id}${l}`, p]); }
      for (let l = 0; l <= 3; l++) { const p = noParts(); for (const id of PART_IDS) p[id] = l; cases.push([`${ti}:all${l}`, p]); }
      for (const [key, p] of cases) {
        const got = buildSpec(p, tu) as unknown as Record<string, unknown>, want = fixture[key]; n++;
        for (const f of Object.keys(want)) {
          if (Array.isArray(want[f])) (want[f] as number[]).forEach((x, i) => expect((got[f] as number[])[i]).toBeCloseTo(x, 9));
          else expect(got[f], `${key}.${f}`).toBeCloseTo(want[f] as number, 9);
        }
      }
    });
    expect(n).toBe(80);
  });
  it('upgrades scale from each car own base', () => {
    const p = noParts(); p.tyres = 3; p.brakes = 3;
    for (const c of CARS) { const s = buildSpec(p, defaultTuning(), c.spec); expect(s.mu / c.spec.mu).toBeCloseTo(1.42 / 1.08, 6); expect(s.brake / c.spec.brake).toBeCloseTo(2, 6); }
  });
});

describe('cars', () => {
  it('lists the expected ids and falls back to the Aurora', () => {
    expect(CARS.map((c) => c.id)).toEqual(['aurora', 'corvette', 'cuda', 'mustang', 'golf', 'm635', 'alfa155']);
    expect(carById('nope').id).toBe('aurora'); expect(carById(undefined).id).toBe('aurora'); expect(carById('golf').drivetrain).toBe('FWD');
    expect(carById('aurora').spec).toBe(BASE);
  });
  it('each car has a sane 0-100 and stat bars', () => {
    const rows: string[] = [];
    for (const c of CARS) {
      const st = carStats(buildSpec(noParts(), defaultTuning(), c.spec));
      rows.push(`${c.id} ${JSON.stringify(st)}`);
      expect(st.zeroTo100).toBeGreaterThan(4.2); expect(st.zeroTo100).toBeLessThan(8);
      for (const k of ['speed', 'accel', 'handling', 'braking'] as const) { expect(st[k]).toBeGreaterThanOrEqual(0); expect(st[k]).toBeLessThanOrEqual(100); }
    }
    console.log(rows.join('\n'));
    const t = (id: string) => carStats(buildSpec(noParts(), defaultTuning(), carById(id).spec));
    expect(t('corvette').zeroTo100).toBeLessThanOrEqual(Math.min(...CARS.map((c) => t(c.id).zeroTo100)));
    expect(t('golf').speed).toBeLessThan(t('aurora').speed); expect(t('m635').speed).toBeGreaterThan(t('mustang').speed);
    expect(t('cuda').braking).toBeLessThan(t('aurora').braking);
  });
  it('driveFront changes nothing at 0 and moves a FWD car forward', () => {
    const run = (spec: typeof BASE) => { const c = makeCar(0, spec), i = Math.round(60 / track.step); c.x = track.px[i]; c.z = track.pz[i]; c.yaw = Math.atan2(track.tz[i], track.tx[i]); locate(track, c.x, c.z, -1, c.loc); c.y = heightAt(track, c.loc); const inp = noInput(); inp.throttle = 1; for (let k = 0; k < 300; k++) stepCar(c, inp, track, false); return c; };
    const a = run(BASE), b = run({ ...BASE, driveFront: 0, steerRate: 1, balance: 0 }); expect(b.vx).toBe(a.vx);
    expect(run({ ...BASE, driveFront: 1 }).vx).toBeGreaterThan(15);
  });
  it('stock solo AI Rio laps are clean and within the spread of the Aurora', () => {
    const lap = (id: string) => {
      const r = createRace(track, [{ spec: buildSpec(noParts(), defaultTuning(), carById(id).spec), driver: ace, name: 'a', paint: 0 }], 2, 3, 0); let hits = 0;
      for (let k = 0; k < 60 * 400 && !r.racers[0].finished; k++) { stepRace(r, [null]); if (r.racers[0].car.hit > 3) hits++; }
      return { done: r.racers[0].finished, hits, best: r.racers[0].best / 60 };
    };
    const ref = lap('aurora').best, rows: string[] = [];
    for (const c of CARS) {
      const l = lap(c.id); rows.push(`${c.id} ${l.best.toFixed(2)} (${((l.best / ref - 1) * 100).toFixed(1)}%)`);
      expect(l.done).toBe(true); expect(l.hits).toBe(0);
      expect(l.best).toBeGreaterThan(ref * 0.94); expect(l.best).toBeLessThan(ref * 1.06);
    }
    console.log('rio laps', rows.join(', '));
  });
});

describe('career and rivals', () => {
  it('buys parts for the selected car only', () => {
    const c = newCareer(); c.money = 50000; c.car = 'cuda';
    expect(playerSpec(c).mass).toBe(carById('cuda').spec.mass);
    expect(buyPart(c, 'engine')).toBe(true); expect(c.cars.cuda.parts.engine).toBe(1); expect(c.cars.aurora.parts.engine).toBe(0);
    expect(playerSpec(c).torque).toBeCloseTo(carById('cuda').spec.torque * 1.1, 6);
  });
  it('gives faster cars to faster rivals', () => {
    const order = ['corvette', 'm635', 'aurora', 'alfa155', 'mustang', 'cuda', 'golf'];
    for (const ev of EVENTS) {
      const cars = rivalCars(ev); expect(cars.length).toBe(ev.rivals.length);
      const sk = ev.rivals.map((r) => r.driver.skill);
      for (let i = 1; i < cars.length; i++) if (sk[i] < sk[i - 1]) expect(order.indexOf(cars[i])).toBeGreaterThanOrEqual(order.indexOf(cars[i - 1]));
    }
    expect(rivalCars(EVENTS.find((e) => e.id === 'rio-rival')!)).toEqual(['corvette']);
    expect(rivalSpec(0, 'golf').mass).toBe(carById('golf').spec.mass); expect(rivalSpec(2, 'aurora').torque).toBeCloseTo(BASE.torque * 1.2, 6);
  });
});
