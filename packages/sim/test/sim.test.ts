import { describe, expect, it } from 'vitest';
import { BASE, RIO, buildSpec, buildTrack, createRace, makeCar, noInput, noParts, stepCar, stepRace, locate, heightAt, ratings, dyno, newCareer, buyPart, settle, EVENTS, medal, type Driver, type Parts } from '../src/index';

const track = buildTrack(RIO);
const ace: Driver = { name: 'ace', skill: 0.97, aggression: 0.5, consistency: 1 };

function straightCar(spec = BASE) {
  const c = makeCar(0, spec); const i = Math.round(60 / track.step); // on the main straight
  c.x = track.px[i]; c.z = track.pz[i]; c.yaw = Math.atan2(track.tz[i], track.tx[i]); locate(track, c.x, c.z, -1, c.loc); c.y = heightAt(track, c.loc);
  return c;
}
function soloLap(parts: Parts, laps = 2) {
  const r = createRace(track, [{ spec: buildSpec(parts), driver: ace, name: 'a', paint: 0 }], laps, 3, 0);
  let hits = 0;
  for (let k = 0; k < 60 * 400 && !r.racers[0].finished; k++) { stepRace(r, [null]); if (r.racers[0].car.hit > 3) hits++; }
  return { r, best: r.racers[0].best / 60, hits };
}

describe('track', () => {
  it('is a closed loop of sensible length', () => {
    expect(track.len).toBeGreaterThan(3000); expect(track.len).toBeLessThan(5500);
    let maxK = 0; for (let i = 0; i < track.n; i++) maxK = Math.max(maxK, Math.abs(track.curv[i]));
    expect(1 / maxK).toBeGreaterThan(25); // no corner tighter than a 25 m radius
  });
});

describe('car', () => {
  it('accelerates, tops out and stops like a sports car', () => {
    const c = straightCar(), inp = noInput(); inp.throttle = 1;
    let t100 = 0;
    for (let k = 0; k < 60 * 12; k++) { stepCar(c, inp, track, false); if (!t100 && c.vx * 3.6 >= 100) t100 = k / 60; }
    expect(t100).toBeGreaterThan(3.2); expect(t100).toBeLessThan(6.5);
    // braking distance from 100 km/h
    c.vx = 100 / 3.6; c.vy = 0; c.wz = 0; const x0 = c.x, z0 = c.z; inp.throttle = 0; inp.brake = 1;
    for (let k = 0; k < 600 && c.vx > 0.5; k++) stepCar(c, inp, track, false);
    const d = Math.hypot(c.x - x0, c.z - z0);
    expect(d).toBeGreaterThan(26); expect(d).toBeLessThan(62);
  });
  it('upgrades raise power and the dyno reflects it', () => {
    const p = noParts(); const a = ratings(buildSpec(p)); p.engine = 3; p.turbo = 3; const b = ratings(buildSpec(p));
    expect(a.hp).toBeGreaterThan(230); expect(a.hp).toBeLessThan(330); expect(b.hp).toBeGreaterThan(a.hp * 1.5);
    expect(dyno(buildSpec(p)).kw.length).toBe(61);
  });
});

describe('race', () => {
  it('is deterministic', () => {
    const run = () => { const r = createRace(track, [{ spec: BASE, driver: ace, name: 'a', paint: 0 }, { spec: BASE, driver: { ...ace, skill: 0.9 }, name: 'b', paint: 1 }], 1, 5); for (let k = 0; k < 3000; k++) stepRace(r, [null, null]); return r.racers.map((q) => [q.car.x, q.car.z, q.car.vx, q.dist]); };
    expect(run()).toEqual(run());
  });
  it('AI laps cleanly and upgrades make it faster', () => {
    const stock = soloLap(noParts()), full = soloLap({ engine: 3, turbo: 3, gearbox: 3, tyres: 3, suspension: 3, brakes: 3, weight: 3, aero: 3, nitro: 3 });
    console.log('lap stock', stock.best.toFixed(2), 'hits', stock.hits, '| full', full.best.toFixed(2), 'hits', full.hits);
    expect(stock.r.racers[0].finished).toBe(true); expect(stock.hits).toBe(0);
    expect(stock.best).toBeGreaterThan(60); expect(stock.best).toBeLessThan(140);
    expect(full.best).toBeLessThan(stock.best * 0.93);
    for (const part of ['engine', 'tyres', 'weight'] as const) { const p = noParts(); p[part] = 3; expect(soloLap(p).best).toBeLessThan(stock.best); }
  });
  it('a full grid finishes without pile-ups', () => {
    const ev = EVENTS[0], r = createRace(track, ev.rivals.map((x, i) => ({ spec: BASE, driver: x.driver, name: x.driver.name, paint: i })), 2, 9, 0);
    for (let k = 0; k < 60 * 400 && !r.racers.every((q) => q.finished); k++) stepRace(r, r.racers.map(() => null));
    expect(r.racers.every((q) => q.finished)).toBe(true);
    const places = r.racers.map((q) => q.place).sort(); expect(places).toEqual([1, 2, 3, 4, 5, 6, 7]);
    console.log('grid bests', r.racers.map((q) => q.name + ' ' + (q.best / 60).toFixed(1)).join(', '));
  });
});

describe('career', () => {
  it('buys parts and banks prizes', () => {
    const c = newCareer(); expect(buyPart(c, 'engine')).toBe(false);
    const got = settle(c, EVENTS[0], 1, 6000); expect(got.money).toBe(6000); expect(c.rep).toBe(30);
    expect(buyPart(c, 'engine')).toBe(true); expect(c.parts.engine).toBe(1); expect(c.money).toBe(4500);
    expect(settle(c, EVENTS[0], 1, 5900).money).toBeLessThan(3000);
    expect(medal(EVENTS[1], 79 * 60)).toBe(1); expect(medal(EVENTS[1], 200 * 60)).toBe(4);
  });
});
