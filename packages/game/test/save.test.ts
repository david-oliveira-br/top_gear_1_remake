import { describe, expect, it } from 'vitest';
import { cleanSettings, migrateCareer } from '../src/save';
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
  it('fills setups for new cars when migrating a 7-car save', () => {
    const n = JSON.parse(JSON.stringify(newCareer())); for (const id of ['rsk', 'cobra', 'viper', 'camaro', 'm1', 'e850', 'z8', 'contgt', 'batur']) delete n.cars[id];
    n.cars.golf.parts.brakes = 2; expect(Object.keys(n.cars).length).toBe(7);
    const c = migrateCareer(n); expect(Object.keys(c.cars).length).toBe(16); expect(c.cars.batur.parts.engine).toBe(0); expect(c.cars.golf.parts.brakes).toBe(2);
  });
  it('sends a locked selected car back to the Aurora', () => {
    const n = JSON.parse(JSON.stringify(newCareer())); n.car = 'contgt'; expect(migrateCareer(n).car).toBe('aurora');
    n.rep = 300; expect(migrateCareer(n).car).toBe('contgt');
    n.car = 'viper'; expect(migrateCareer(n).car).toBe('aurora'); n.results['niagara-rival'] = { place: 1, best: 1 }; expect(migrateCareer(n).car).toBe('viper');
  });
  it('falls back to a fresh career on junk and clamps part levels', () => {
    expect(migrateCareer(null)).toEqual(newCareer());
    expect(migrateCareer({ v: 2 })).toEqual(newCareer());
    const c = migrateCareer({ v: 1, parts: { engine: 99, tyres: -4 } });
    expect(c.cars.aurora.parts.engine).toBe(3); expect(c.cars.aurora.parts.tyres).toBe(0);
  });
});

describe('settings', () => {
  it('defaults handling to arcade, keeps old saves, round trips and rejects junk', () => {
    expect(cleanSettings({}).handling).toBe('arcade');
    expect(cleanSettings({ quality: 'low', auto: false }).handling).toBe('arcade');
    expect(cleanSettings({ quality: 'low', auto: false }).quality).toBe('low');
    const s = cleanSettings({ handling: 'sim' }); expect(cleanSettings(JSON.parse(JSON.stringify(s))).handling).toBe('sim');
    expect(cleanSettings({ handling: 'drift' }).handling).toBe('arcade');
    expect(cleanSettings(null).handling).toBe('arcade');
  });
});
