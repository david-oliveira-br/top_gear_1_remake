import { describe, expect, it } from 'vitest';
import goldens from './fixtures/sim-goldens.json';
import { BASE, CARS, EVENTS, TRACKS, buildTrack, createRace, makeCar, noInput, stepCar, stepRace, locate, type Driver } from '../src/index';

const ace: Driver = { name: 'ace', skill: 0.97, aggression: 0.5, consistency: 1 };
const IDS = ['rio', 'coast', 'rockies', 'patagonia'] as const;
const RUN: Record<string, string> = { rio: 'rio-rival', coast: 'coast-run', rockies: 'rockies-run', patagonia: 'pata-run' };

/** Solo ace AI on a track (2 laps on the closed Rio circuit, 1 on the point-to-point regions). */
function soloAce(id: string) {
  const tr = buildTrack(TRACKS[id]), r = createRace(tr, [{ spec: BASE, driver: ace, name: 'a', paint: 0 }], id === 'rio' ? 2 : 1, 3, 0), c = r.racers[0].car;
  for (let k = 0; k < 60 * 500 && !r.racers[0].finished; k++) stepRace(r, [null]);
  return { finishTick: r.racers[0].finishTick, x: c.x, z: c.z, vx: c.vx, yaw: c.yaw };
}
/** Full 8-car grid: places and finish ticks. */
function grid(id: string) {
  const tr = buildTrack(TRACKS[id]), ev = EVENTS.find((e) => e.id === RUN[id])!;
  const r = createRace(tr, [{ spec: BASE, driver: ace, name: 'p', paint: 0 }, ...ev.rivals.map((x, i) => ({ spec: BASE, driver: x.driver, name: x.driver.name, paint: i }))], 1, 9, 0);
  for (let k = 0; k < 60 * 500 && !r.racers.every((q) => q.finished); k++) stepRace(r, r.racers.map(() => null));
  return { places: r.racers.map((q) => q.place), finishTicks: r.racers.map((q) => q.finishTick) };
}
/** Scripted player-style input on Rio: throttle, weaving steer, a brake and a handbrake burst. Every car spec. */
function scripted(carId: string) {
  const tr = buildTrack(TRACKS.rio), spec = CARS.find((c) => c.id === carId)!.spec, c = makeCar(0, spec), inp = noInput();
  c.x = tr.px[10]; c.z = tr.pz[10]; c.yaw = Math.atan2(tr.tz[10], tr.tx[10]); locate(tr, c.x, c.z, 10, c.loc);
  for (let k = 0; k < 60 * 20; k++) {
    const t = k / 60;
    inp.throttle = t % 8 < 6 ? 1 : 0; inp.brake = t % 8 >= 6.5 ? 1 : 0; inp.steer = 0.5 * Math.sin(t * 1.3) + (t > 12 && t < 12.6 ? 0.5 : 0);
    inp.handbrake = t > 15 && t < 15.5; inp.nitro = t > 3 && t < 5;
    stepCar(c, inp, tr, false);
  }
  return { x: c.x, z: c.z, vx: c.vx, vy: c.vy, wz: c.wz, yaw: c.yaw, steer: c.steer, rpm: c.rpm, gear: c.gear };
}
function compute() {
  const out: Record<string, unknown> = { solo: {}, grid: {}, scripted: {} };
  for (const id of IDS) { (out.solo as any)[id] = soloAce(id); (out.grid as any)[id] = grid(id); }
  for (const c of CARS.slice(0, 7)) (out.scripted as any)[c.id] = scripted(c.id);
  return JSON.parse(JSON.stringify(out));
}

describe('SIM handling preset is bit-identical', () => {
  it('matches the recorded goldens exactly (solo ace, 8-car grids, scripted player runs)', () => {
    // To re-record (only when the SIM physics is changed on purpose): console.log(JSON.stringify(compute(), null, 1)) into fixtures/sim-goldens.json.
    expect(compute()).toEqual(goldens);
  });
});
