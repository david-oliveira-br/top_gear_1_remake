import { describe, expect, it } from 'vitest';
import { BASE, TRACKS, buildTrack, createRace, stepRace, pointAt, medal, EVENTS, type Driver, type TrackDef, type WeatherKind } from '../src/index';

const ace: Driver = { name: 'ace', skill: 0.97, aggression: 0.5, consistency: 1 };

export const regionTests = (name: string, def: TrackDef, o: { len: [number, number]; y: [number, number]; flats: { from: number; to: number }[]; trial: string; run: string; minWeather: WeatherKind[]; hw: number }) => describe(name, () => {
  const tr = buildTrack(def);
  const solo = (w?: WeatherKind) => {
    const r = createRace(tr, [{ spec: BASE, driver: ace, name: 'a', paint: 0 }], 1, 3, 0, w), c = r.racers[0].car;
    let hits = 0, maxIdx = 0;
    for (let k = 0; k < 60 * 500 && !(r.racers[0].finished && Math.hypot(c.vx, c.vy) < 0.2); k++) { stepRace(r, [null]); if (c.hit > 1) hits++; maxIdx = Math.max(maxIdx, c.loc.idx + c.loc.frac); }
    return { r, hits, maxIdx, c };
  };
  it('has the expected length, corners, clearance, heights and flat bridge spans', () => {
    expect(tr.open).toBe(true); expect(TRACKS[def.id]).toBe(def); expect(def.halfWidth).toBe(o.hw);
    expect(tr.len).toBeGreaterThan(o.len[0]); expect(tr.len).toBeLessThan(o.len[1]);
    let maxK = 0, maxG = 0; for (let i = 0; i < tr.n; i++) { maxK = Math.max(maxK, Math.abs(tr.curv[i])); maxG = Math.max(maxG, Math.abs(tr.slope[i])); }
    expect(1 / maxK).toBeGreaterThan(25); expect(maxG).toBeLessThan(0.12);
    const skip = Math.ceil(120 / tr.step); let min = Infinity;
    for (let i = 0; i < tr.n; i++) for (let j = i + skip; j < tr.n; j++) min = Math.min(min, Math.hypot(tr.px[i] - tr.px[j], tr.pz[i] - tr.pz[j]));
    expect(min).toBeGreaterThan(55);
    expect(Math.min(...tr.py)).toBeGreaterThan(o.y[0]); expect(Math.max(...tr.py)).toBeLessThan(o.y[1]);
    for (const f of o.flats) {
      expect(f.to - f.from).toBeGreaterThan(140); expect(f.to).toBeLessThan(tr.len - 400);
      const h0 = pointAt(tr, f.from, 0)[1]; for (let s = f.from; s <= f.to; s += 10) expect(Math.abs(pointAt(tr, s, 0)[1] - h0)).toBeLessThan(1);
    }
    // a straight, near-flat finish run
    const h = pointAt(tr, tr.len - 400, 0)[1]; for (let s = tr.len - 400; s <= tr.len; s += 10) { const p = pointAt(tr, s, 0); expect(Math.abs(p[1] - h)).toBeLessThan(2); expect(Math.abs(Math.cos(p[3] - pointAt(tr, tr.len, 0)[3]))).toBeGreaterThan(0.99); }
  });
  it('solo ace AI drives start to finish without hitting walls and the trial medals match', () => {
    const { r, hits, maxIdx, c } = solo(), q = r.racers[0];
    console.log(def.id, 'solo ace time', (q.finishTick / 60).toFixed(2), 'len', tr.len.toFixed(0), 'hits', hits);
    expect(q.finished).toBe(true); expect(hits).toBe(0);
    const ev = EVENTS.find((e) => e.id === o.trial)!;
    expect(medal(ev, q.finishTick)).toBe(1); expect(medal(ev, Math.round(q.finishTick * 1.04))).toBe(2); expect(medal(ev, Math.round(q.finishTick * 1.1))).toBe(3); expect(medal(ev, Math.round(q.finishTick * 1.2))).toBe(4);
    expect(maxIdx * tr.step).toBeLessThan(tr.len - 1); expect(Math.hypot(c.vx, c.vy)).toBeLessThan(0.3);
  });
  it('solo ace finishes cleanly in hard weather', () => {
    for (const w of o.minWeather) { const { r, hits } = solo(w); console.log(def.id, w, (r.racers[0].finishTick / 60).toFixed(2), 'hits', hits); expect(r.racers[0].finished).toBe(true); expect(hits).toBe(0); }
  });
  it('a full grid finishes with places 1..8 and is deterministic', () => {
    const ev = EVENTS.find((e) => e.id === o.run)!;
    const run = () => {
      const r = createRace(tr, [{ spec: BASE, driver: ace, name: 'p', paint: 0 }, ...ev.rivals.map((x, i) => ({ spec: BASE, driver: x.driver, name: x.driver.name, paint: i }))], 1, 9, 0);
      for (let k = 0; k < 60 * 500 && !r.racers.every((q) => q.finished); k++) stepRace(r, r.racers.map(() => null));
      return r;
    };
    const r = run();
    expect(r.racers.length).toBe(8); expect(r.racers.every((q) => q.finished)).toBe(true);
    expect(r.racers.map((q) => q.place).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const snap = (x: typeof r) => x.racers.map((q) => [q.car.x, q.car.z, q.car.vx, q.dist, q.finishTick]);
    expect(snap(run())).toEqual(snap(r));
  });
});
