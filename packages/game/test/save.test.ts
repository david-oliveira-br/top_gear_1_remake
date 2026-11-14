import { describe, expect, it } from 'vitest';
import { migrateCareer } from '../src/save';
import { newCareer } from '../../sim/src/index';

describe('career migration', () => {
  it('moves legacy top-level setup to the Aurora', () => {
    const legacy = { v: 1, money: 9000, rep: 40, parts: { engine: 2, turbo: 1, gearbox: 0, tyres: 3, suspension: 0, brakes: 1, weight: 0, aero: 0, nitro: 0 }, tuning: { gearing: 1.05, wing: 0.7, bias: 0.58 }, paint: 4, finish: 2, wheels: 1, results: { 'rio-sprint': { place: 2, best: 4800 } }, ghost: {} };
    const c = migrateCareer(legacy) as any;
    expect(c.car).toBe('aurora'); expect(c.money).toBe(9000);
    expect(c.cars.aurora.parts.engine).toBe(2); expect(c.cars.aurora.parts.tyres).toBe(3);
    expect(c.cars.aurora.tuning.wing).toBe(0.7); expect(c.cars.aurora.paint).toBe(4); expect(c.cars.aurora.finish).toBe(2); expect(c.cars.aurora.wheels).toBe(1);
    expect(c.cars.corvette.parts.engine).toBe(0);
    for (const k of ['parts', 'tuning', 'paint', 'finish', 'wheels']) expect(k in c).toBe(false);
    expect(c.results['rio-sprint'].place).toBe(2);
  });
  it('keeps a current save and validates the selected car', () => {
    const n = newCareer(); n.car = 'golf'; n.cars.golf.parts.brakes = 2;
    const c = migrateCareer(JSON.parse(JSON.stringify(n)));
    expect(c.car).toBe('golf'); expect(c.cars.golf.parts.brakes).toBe(2);
    expect(migrateCareer({ ...JSON.parse(JSON.stringify(n)), car: 'delorean' }).car).toBe('aurora');
  });
  it('falls back to a fresh career on junk and clamps part levels', () => {
    expect(migrateCareer(null)).toEqual(newCareer());
    expect(migrateCareer({ v: 2 })).toEqual(newCareer());
    const c = migrateCareer({ v: 1, parts: { engine: 99, tyres: -4 } });
    expect(c.cars.aurora.parts.engine).toBe(3); expect(c.cars.aurora.parts.tyres).toBe(0);
  });
});
