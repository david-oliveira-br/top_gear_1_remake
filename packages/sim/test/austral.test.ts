import { describe, expect, it } from 'vitest';
import { AUSTRAL, AUSTRAL_BRIDGE, buildTrack } from '../src/index';
import { regionTests } from './region';

regionTests('austral (Carretera Austral)', AUSTRAL, { len: [6400, 7200], y: [20, 240], flats: AUSTRAL_BRIDGE, trial: 'austral-trial', run: 'austral-run', minWeather: ['rain', 'storm'], hw: 5.5 });

describe('austral extras', () => {
  it('has two bridges, hairpins (R48 turtle, ~36 m measured on the spline like Patagonia) and grades under 0.12 (0.08 designed, integer-height jitter)', () => {
    const tr = buildTrack(AUSTRAL); expect(AUSTRAL_BRIDGE.length).toBe(2);
    let maxK = 0, maxG = 0; for (let i = 0; i < tr.n; i++) { maxK = Math.max(maxK, Math.abs(tr.curv[i])); maxG = Math.max(maxG, Math.abs(tr.slope[i])); }
    expect(1 / maxK).toBeGreaterThan(33); expect(maxG).toBeLessThan(0.12);
  });
});
