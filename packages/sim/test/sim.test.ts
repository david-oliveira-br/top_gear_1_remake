import { describe, expect, it } from 'vitest';
import { BASE, RIO, COAST, COAST_BRIDGE, FINISH_BEFORE_END, TRACKS, buildSpec, buildTrack, createRace, makeCar, noInput, noParts, stepCar, stepRace, locate, heightAt, ratings, dyno, newCareer, buyPart, settle, EVENTS, CITIES, cityOpen, pointAt, medal, type Driver, type Parts } from '../src/index';

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

describe('coast (point to point)', () => {
  const coast = buildTrack(COAST);
  function solo(seed = 3) {
    const r = createRace(coast, [{ spec: BASE, driver: ace, name: 'a', paint: 0 }], 1, seed, 0), c = r.racers[0].car;
    let hits = 0, maxIdx = 0;
    for (let k = 0; k < 60 * 400 && !(r.racers[0].finished && Math.hypot(c.vx, c.vy) < 0.2); k++) {
      stepRace(r, [null]); if (c.hit > 1) hits++; maxIdx = Math.max(maxIdx, c.loc.idx + c.loc.frac);
    }
    return { r, hits, maxIdx, c };
  }
  it('has the expected length, corners and no crossings', () => {
    expect(coast.open).toBe(true); expect(TRACKS.coast).toBe(COAST);
    expect(coast.len).toBeGreaterThan(5000); expect(coast.len).toBeLessThan(7000);
    let maxK = 0; for (let i = 0; i < coast.n; i++) maxK = Math.max(maxK, Math.abs(coast.curv[i]));
    expect(1 / maxK).toBeGreaterThan(25);
    const skip = Math.ceil(120 / coast.step); let min = Infinity;
    for (let i = 0; i < coast.n; i++) for (let j = i + skip; j < coast.n; j++) min = Math.min(min, Math.hypot(coast.px[i] - coast.px[j], coast.pz[i] - coast.pz[j]));
    expect(min).toBeGreaterThan(30);
    const lo = Math.min(...coast.py), hi = Math.max(...coast.py); expect(lo).toBeGreaterThan(15); expect(hi).toBeLessThan(115);
    expect(COAST_BRIDGE.to - COAST_BRIDGE.from).toBeGreaterThan(200);
    expect(COAST_BRIDGE.from / coast.len).toBeGreaterThan(0.35); expect(COAST_BRIDGE.to / coast.len).toBeLessThan(0.47);
    for (let s = COAST_BRIDGE.from; s <= COAST_BRIDGE.to; s += 10) expect(Math.abs(pointAt(coast, s, 0)[1] - 100)).toBeLessThan(1);
  });
  it('solo ace AI drives start to finish without hitting walls and stops before the end', () => {
    const { r, hits, maxIdx, c } = solo(), q = r.racers[0];
    console.log('coast solo ace time', (q.finishTick / 60).toFixed(2), 'len', coast.len.toFixed(0), 'hits', hits);
    expect(q.finished).toBe(true); expect(hits).toBe(0); expect(FINISH_BEFORE_END).toBe(320);
    const ev = EVENTS.find((e) => e.id === 'coast-trial')!; expect(medal(ev, q.finishTick)).toBe(1); expect(medal(ev, Math.round(q.finishTick * 1.04))).toBe(2); expect(medal(ev, Math.round(q.finishTick * 1.1))).toBe(3); expect(medal(ev, Math.round(q.finishTick * 1.2))).toBe(4);
    expect(maxIdx * coast.step).toBeLessThan(coast.len - 1); expect(Math.hypot(c.vx, c.vy)).toBeLessThan(0.3);
  });
  it('a full grid finishes with places 1..8 and is deterministic', () => {
    const ev = EVENTS.find((e) => e.id === 'coast-run')!;
    const run = () => {
      const r = createRace(coast, [{ spec: BASE, driver: ace, name: 'p', paint: 0 }, ...ev.rivals.map((x, i) => ({ spec: BASE, driver: x.driver, name: x.driver.name, paint: i }))], 1, 9, 0);
      for (let k = 0; k < 60 * 400 && !r.racers.every((q) => q.finished); k++) stepRace(r, r.racers.map(() => null));
      return r;
    };
    const r = run();
    expect(r.racers.length).toBe(8); expect(r.racers.every((q) => q.finished)).toBe(true);
    expect(r.racers.map((q) => q.place).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    console.log('coast grid', r.racers.map((q) => q.name + ' ' + (q.finishTick / 60).toFixed(1)).join(', '));
    const snap = (x: typeof r) => x.racers.map((q) => [q.car.x, q.car.z, q.car.vx, q.dist, q.finishTick]);
    expect(snap(run())).toEqual(snap(r));
  });
  it('bigsur opens by reputation alone', () => {
    const c = newCareer(), city = CITIES.find((x) => x.id === 'bigsur')!;
    expect(cityOpen(c, city)).toBe(false); c.rep = 30; expect(cityOpen(c, city)).toBe(true);
    expect(CITIES.some((x) => x.id === 'la')).toBe(false);
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
