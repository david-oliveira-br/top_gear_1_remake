import { describe, expect, it } from 'vitest';
import {
  CAR_CLASSES, CAR_LEN, COUNTDOWN_TICKS, aiInput, collidePair, skyAt, TRACK_DEFS, createWorld, decodeInput, decodeSnapshot, encodeInput, encodeSnapshot, getTrack,
  quantizeInput, standings, stepWorld, type Entry, type Input, type World,
} from '../src/index';

const entries = (n: number, humans = 0): Entry[] =>
  Array.from({ length: n }, (_, i) => ({ name: 'c' + i, classId: i % 4, color: i, auto: true, isAI: i < n - humans }));
const mk = (id: string, n = 12, laps = 2, humans = 0): World => {
  const track = getTrack(id);
  return createWorld({ track, laps, weather: track.weather, time: track.time, difficulty: 1, entries: entries(n, humans), shift: track.shift });
};
const run = (w: World, maxTicks: number, inp?: (w: World) => (Input | undefined)[]) => {
  while (w.phase !== 'done' && w.tick < maxTicks) stepWorld(w, inp ? inp(w) : []);
};
const sig = (w: World) => w.cars.map((c) => [c.x, c.z, c.speed, c.lap, c.fuel, c.gear]).flat().join(',');

describe('simulation', () => {
  it('is deterministic', () => {
    const a = mk('costa'), b = mk('costa');
    run(a, 3000); run(b, 3000);
    expect(sig(a)).toBe(sig(b));
  });

  it('holds cars during the countdown', () => {
    const w = mk('costa');
    for (let i = 0; i < COUNTDOWN_TICKS - 1; i++) stepWorld(w, []);
    expect(w.cars.every((c) => c.speed === 0)).toBe(true);
    expect(w.phase).toBe('countdown');
    stepWorld(w, []);
    expect(w.phase).toBe('racing');
  });

  it('AI finishes every track without stalling or running dry', () => {
    for (const d of TRACK_DEFS) {
      const w = mk(d.id, 12, d.laps);
      run(w, 60 * 60 * 12);
      expect(w.phase, d.id).toBe('done');
      expect(w.cars.filter((c) => c.dnf).length, d.id + ' dnf').toBe(0);
      const best = Math.min(...w.cars.map((c) => c.finishTick)) / 60 / d.laps;
      expect(best, d.id + ' lap time').toBeGreaterThan(30);
      expect(best, d.id + ' lap time').toBeLessThan(110);
    }
    expect(TRACK_DEFS.length).toBe(32);
  }, 240000);

  it('side-by-side contact costs no speed; running into the back of a car does', () => {
    const w = mk('mojave', 2, 1);
    const [a, b] = w.cars;
    a.z = 5000; b.z = 5100; a.x = 0; b.x = 0.25; a.speed = 9000; b.speed = 8000;
    expect(collidePair(a, b, w.track.length)).toBe(1);
    expect(a.speed).toBe(9000); expect(b.speed).toBe(8000);
    expect(b.x - a.x).toBeGreaterThan(0.25);
    a.z = 5000; b.z = 5000 + CAR_LEN - 60; a.x = 0; b.x = 0.05; a.speed = 9000; b.speed = 8000;
    expect(collidePair(a, b, w.track.length)).toBe(2);
    expect(a.speed).toBeLessThan(8000); expect(b.speed).toBeGreaterThan(8000);
    a.x = 0; b.x = 0.4;
    expect(collidePair(a, b, w.track.length)).toBe(0);
  });

  it('AI traffic rarely makes contact in a full-grid race', () => {
    const w = mk('costa', 12, 2);
    let hits = 0; const was = new Set<number>();
    while (w.phase !== 'done' && w.tick < 60 * 60 * 6) {
      stepWorld(w, []);
      for (const c of w.cars) { if (c.bump > 0.05 && !was.has(c.idx)) { hits++; was.add(c.idx); } if (c.bump === 0) was.delete(c.idx); }
    }
    expect(w.phase).toBe('done');
    expect(hits).toBeLessThan(12); // fewer than one bump per car over two laps
  });

  it('slipstream builds behind a car and fades in clean air', () => {
    const w = mk('mojave', 2, 1);
    w.tick = COUNTDOWN_TICKS; w.phase = 'racing';
    const [lead, tail] = w.cars;
    lead.z = 20000; tail.z = 18500; lead.x = tail.x = 0; lead.speed = tail.speed = 11000; lead.gear = tail.gear = 5;
    for (let i = 0; i < 90; i++) { stepWorld(w, []); tail.z = lead.z - 1500; tail.x = lead.x; }
    expect(tail.draft).toBeGreaterThan(0.9); expect(lead.draft).toBe(0);
    for (let i = 0; i < 90; i++) { stepWorld(w, []); tail.x = lead.x + 1; }
    expect(tail.draft).toBe(0);
  });

  it('holding the revs in the band gives a launch boost; over-revving bogs down', () => {
    const run2 = (thr: (rpm: number) => number) => {
      const w = mk('mojave', 1, 1, 1); const c = w.cars[0];
      while (w.phase === 'countdown') stepWorld(w, [{ steer: 0, throttle: thr(c.rpm), brake: 0, nitro: false, up: false, down: false }]);
      return c;
    };
    const good = run2((rpm) => (rpm < 0.7 ? 1 : 0)), flat = run2(() => 1), idle = run2(() => 0);
    expect(good.launchT).toBeGreaterThan(0); expect(good.speed).toBeGreaterThan(1000);
    expect(flat.bogT).toBeGreaterThan(0); expect(flat.speed).toBe(0);
    expect(idle.speed).toBe(0); expect(idle.bogT).toBe(0);
  });

  it('a nightfall race gets dark and a storm race gets wet as it goes on', () => {
    const track = getTrack('canyon');
    const w = createWorld({ track, laps: 2, weather: 'clear', time: 'dusk', difficulty: 1, entries: entries(2), shift: 'nightfall' });
    expect(skyAt(w).night).toBe(0);
    w.tick = COUNTDOWN_TICKS + w.raceTicks; expect(skyAt(w).night).toBe(1);
    const s = createWorld({ track, laps: 2, weather: 'clear', time: 'day', difficulty: 1, entries: entries(2), shift: 'storm' });
    expect(s.wet).toBe(0);
    s.tick = COUNTDOWN_TICKS + Math.round(s.raceTicks * 0.8); s.phase = 'racing'; stepWorld(s, []);
    expect(s.wet).toBe(1);
  });

  it('counts laps and ranks finishers by finish time', () => {
    const w = mk('mojave', 6, 1);
    run(w, 60 * 60 * 5);
    const order = standings(w);
    for (let i = 1; i < order.length; i++) expect(w.cars[order[i]].finishTick).toBeGreaterThanOrEqual(w.cars[order[i - 1]].finishTick);
    expect(w.cars.every((c) => c.lap === 2)).toBe(true);
  });

  it('manual gearbox only shifts on button edges and limits speed per gear', () => {
    const w = mk('mojave', 1, 1, 1);
    w.cars[0].auto = false;
    const full: Input = { steer: 0, throttle: 1, brake: 0, nitro: false, up: false, down: false };
    run(w, COUNTDOWN_TICKS + 600, () => [full]);
    const c = w.cars[0];
    expect(c.gear).toBe(1);
    expect(c.speed).toBeLessThan(CAR_CLASSES[c.classId].top * 0.3);
    stepWorld(w, [{ ...full, up: true }]); stepWorld(w, [{ ...full, up: true }]);
    expect(c.gear).toBe(2);
  });

  it('nitro is limited and raises speed above normal top speed', () => {
    const w = mk('mojave', 1, 1, 1);
    const drive = (nitro: boolean) => ({ ...aiInput(w, 0), throttle: 1, brake: 0, nitro });
    while (w.tick < COUNTDOWN_TICKS + 700) stepWorld(w, [drive(false)]);
    const c = w.cars[0], top = CAR_CLASSES[c.classId].top;
    expect(c.speed).toBeLessThanOrEqual(top);
    expect(c.speed).toBeGreaterThan(top * 0.95);
    stepWorld(w, [drive(true)]);
    expect(c.nitro).toBe(2);
    for (let i = 0; i < 120; i++) stepWorld(w, [drive(true)]);
    expect(c.nitro).toBe(2); // held button does not burn another charge
    expect(c.speed).toBeGreaterThan(top * 1.1);
  });

  it('fuel drains, an empty tank ends the race, and the pit lane refuels', () => {
    const w = mk('mojave', 1, 9, 1);
    const c = w.cars[0];
    c.fuel = 0.02;
    const full: Input = { steer: 0, throttle: 1, brake: 0, nitro: false, up: false, down: false };
    run(w, 60 * 60, () => [full]);
    expect(c.fuel).toBe(0);
    expect(c.dnf).toBe(true);

    const w2 = mk('mojave', 1, 9, 1);
    const d = w2.cars[0];
    d.fuel = 0.3; d.x = 1.5; d.z = w2.track.pitStart * 200 + 100;
    for (let i = 0; i < COUNTDOWN_TICKS + 120; i++) stepWorld(w2, [full]);
    expect(d.inPit).toBe(true);
    expect(d.fuel).toBeGreaterThan(0.5);
    expect(d.speed).toBeLessThanOrEqual(3600);
  });
});

describe('protocol', () => {
  it('round-trips snapshots', () => {
    const w = mk('costa');
    run(w, 900);
    const s = decodeSnapshot(encodeSnapshot(w, 77))!;
    expect(s.ack).toBe(77); expect(s.tick).toBe(w.tick); expect(s.phase).toBe(w.phase);
    expect(s.cars.length).toBe(12);
    w.cars.forEach((c, i) => {
      expect(s.cars[i].x).toBeCloseTo(c.x, 4); expect(s.cars[i].lap).toBe(c.lap); expect(s.cars[i].gear).toBe(c.gear);
      expect(Math.abs(s.cars[i].z - c.z)).toBeLessThan(0.1);
    });
  });
  it('round-trips quantized inputs exactly', () => {
    const q = quantizeInput({ steer: -0.3333, throttle: 0.777, brake: 0.1, nitro: true, up: false, down: true });
    const d = decodeInput(encodeInput(42, q))!;
    expect(d.seq).toBe(42); expect(d.input).toEqual(q);
  });
});
