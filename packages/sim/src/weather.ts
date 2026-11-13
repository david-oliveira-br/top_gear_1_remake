import type { TrackDef } from './track';

export type WeatherKind = 'clear' | 'overcast' | 'rain' | 'storm' | 'fog' | 'snow';

export interface WeatherInfo {
  name: string;
  /** multiplier on tyre grip */
  grip: number;
  /** metres the AI can comfortably see */
  visibility: number;
  /** road wetness 0..1 (renderer) */
  wet: number;
}

export const WEATHER: Record<WeatherKind, WeatherInfo> = {
  clear: { name: 'Limpo', grip: 1, visibility: 1500, wet: 0 },
  overcast: { name: 'Nublado', grip: 1, visibility: 1500, wet: 0 },
  rain: { name: 'Chuva', grip: 0.82, visibility: 500, wet: 0.8 },
  storm: { name: 'Tempestade', grip: 0.74, visibility: 300, wet: 1 },
  fog: { name: 'Neblina', grip: 1, visibility: 180, wet: 0.15 },
  snow: { name: 'Neve', grip: 0.6, visibility: 350, wet: 0.3 },
};

/** Kinds this track can roll, in the order the track lists them (zero weights excluded). */
export function allowedWeather(def: TrackDef): WeatherKind[] {
  return def.weather.filter((w) => w.weight > 0).map((w) => w.kind);
}

/** Deterministic weighted choice from the track's list. */
export function pickWeather(def: TrackDef, seed: number): WeatherKind {
  const list = def.weather.filter((w) => w.weight > 0);
  if (!list.length) return 'clear';
  // integer hash (murmur-style finaliser) -> [0,1)
  let h = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
  let x = (h / 4294967296) * list.reduce((s, w) => s + w.weight, 0);
  for (const w of list) { if (x < w.weight) return w.kind; x -= w.weight; }
  return list[list.length - 1].kind;
}

/** AI pace factor for low visibility (1 in good sight). */
export function cautionFor(kind: WeatherKind): number {
  const v = WEATHER[kind].visibility;
  return v >= 500 ? 1 : 1 - 0.06 * (1 - v / 500);
}
