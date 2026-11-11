import type { ThemeId, TimeOfDay, Weather } from '../../../shared/src/index';

type V3 = [number, number, number];
export interface Look {
  top: V3; hor: V3; sun: [number, number]; sunCol: V3; stars: number; cloud: number; cloudCol: V3; aurora: number;
  fog: V3; fogDist: number; grassA: V3; grassB: V3; road: V3; rumA: V3; rumB: V3; skyAmb: V3;
  amb: V3; head: number; night: number; wet: number; rain: number; snow: number; snowy: number; storm: boolean;
}
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

const THEME: Record<ThemeId, { gA: V3; gB: V3; sil: number; s1: V3; s2: V3; rumA: V3 }> = {
  tropical: { gA: [0.2, 0.56, 0.2], gB: [0.16, 0.48, 0.17], sil: 0, s1: [0.25, 0.5, 0.45], s2: [0.1, 0.36, 0.22], rumA: [0.85, 0.15, 0.15] },
  desert: { gA: [0.84, 0.66, 0.4], gB: [0.78, 0.59, 0.35], sil: 2, s1: [0.75, 0.45, 0.3], s2: [0.6, 0.32, 0.2], rumA: [0.85, 0.15, 0.15] },
  city: { gA: [0.3, 0.32, 0.36], gB: [0.26, 0.28, 0.32], sil: 1, s1: [0.2, 0.24, 0.36], s2: [0.1, 0.12, 0.2], rumA: [0.95, 0.75, 0.1] },
  snow: { gA: [0.8, 0.84, 0.9], gB: [0.72, 0.77, 0.86], sil: 0, s1: [0.75, 0.82, 0.95], s2: [0.5, 0.6, 0.78], rumA: [0.2, 0.4, 0.9] },
  sakura: { gA: [0.42, 0.68, 0.33], gB: [0.36, 0.6, 0.3], sil: 0, s1: [0.6, 0.55, 0.75], s2: [0.35, 0.5, 0.4], rumA: [0.9, 0.3, 0.5] },
  forest: { gA: [0.17, 0.42, 0.19], gB: [0.14, 0.36, 0.16], sil: 0, s1: [0.3, 0.45, 0.5], s2: [0.08, 0.26, 0.16], rumA: [0.85, 0.15, 0.15] },
  tuscany: { gA: [0.5, 0.6, 0.24], gB: [0.6, 0.56, 0.22], sil: 0, s1: [0, 0, 0], s2: [0, 0, 0], rumA: [0.85, 0.15, 0.15] },
  moor: { gA: [0.3, 0.52, 0.22], gB: [0.26, 0.46, 0.2], sil: 0, s1: [0, 0, 0], s2: [0, 0, 0], rumA: [0.1, 0.35, 0.2] },
  dunes: { gA: [0.82, 0.68, 0.42], gB: [0.76, 0.62, 0.37], sil: 0, s1: [0, 0, 0], s2: [0, 0, 0], rumA: [0.15, 0.4, 0.75] },
  outback: { gA: [0.72, 0.4, 0.22], gB: [0.66, 0.35, 0.19], sil: 0, s1: [0, 0, 0], s2: [0, 0, 0], rumA: [0.95, 0.75, 0.1] },
};

/** Blend two looks (used while the sky changes during a race). */
export function mixLook(a: Look, b: Look, t: number): Look {
  if (t <= 0) return a; if (t >= 1) return b;
  const out: any = {};
  for (const k of Object.keys(a) as (keyof Look)[]) {
    const x = a[k] as any, y = b[k] as any;
    out[k] = typeof x === 'number' ? x + (y - x) * t : Array.isArray(x) ? x.map((v: number, i: number) => v + (y[i] - v) * t) : t > 0.5 ? y : x;
  }
  return out as Look;
}

export function makeLook(theme: ThemeId, time: TimeOfDay, weather: Weather): Look {
  const th = THEME[theme];
  let top: V3, hor: V3, sunCol: V3, amb: V3, sun: [number, number], stars = 0, head = 0, night = 0;
  if (time === 'day') { top = [0.16, 0.45, 0.92]; hor = [0.68, 0.84, 1]; sunCol = [1, 0.95, 0.75]; amb = [1, 1, 1]; sun = [0.68, 0.62]; }
  else if (time === 'dusk') { top = [0.22, 0.17, 0.46]; hor = [1, 0.52, 0.28]; sunCol = [1, 0.6, 0.25]; amb = [0.82, 0.66, 0.6]; sun = [0.42, 0.08]; head = 0.3; night = 0.45; }
  else { top = [0.01, 0.02, 0.07]; hor = [0.07, 0.1, 0.24]; sunCol = [0.75, 0.8, 0.95]; amb = [0.26, 0.29, 0.42]; sun = [0.3, 0.7]; stars = 1; head = 1; night = 1; }
  let cloud = time === 'night' ? 0.35 : 0.5, fogDist = 40000, wet = 0, rain = 0, snow = 0, storm = false;
  let cloudCol: V3 = time === 'day' ? [1, 1, 1] : time === 'dusk' ? [0.95, 0.6, 0.5] : [0.12, 0.14, 0.24];
  const gray: V3 = time === 'night' ? [0.06, 0.07, 0.1] : time === 'dusk' ? [0.4, 0.34, 0.36] : [0.62, 0.66, 0.7];
  if (weather === 'rain') { top = mix(top, gray, 0.75); hor = mix(hor, gray, 0.7); cloud = 0.95; cloudCol = mul(gray, 0.8); fogDist = 27000; wet = 1; rain = 1; stars = 0; sunCol = mul(sunCol, 0.15); amb = mul(amb, 0.8); storm = true; }
  if (weather === 'fog') { top = mix(top, gray, 0.8); hor = mix(hor, gray, 0.85); cloud = 0.8; cloudCol = gray; fogDist = 13000; wet = 0.3; stars *= 0.2; sunCol = mul(sunCol, 0.3); }
  if (weather === 'snow') { top = mix(top, gray, 0.7); hor = mix(hor, [0.85, 0.88, 0.92], time === 'night' ? 0.1 : 0.7); cloud = 0.9; cloudCol = mul(gray, 1.1); fogDist = 22000; snow = 1; stars = 0; sunCol = mul(sunCol, 0.2); }
  const fog = mix(hor, top, time === 'day' ? 0.12 : time === 'dusk' ? 0.55 : 0.3);
  const road: V3 = theme === 'snow' ? [0.36, 0.38, 0.42] : theme === 'desert' ? [0.36, 0.33, 0.31] : [0.27, 0.28, 0.3];
  return {
    top, hor, sun, sunCol, stars, cloud, cloudCol, aurora: theme === 'snow' && time === 'night' && weather === 'clear' ? 1 : 0,
    fog, fogDist, grassA: th.gA, grassB: th.gB, road, rumA: th.rumA, rumB: [0.93, 0.93, 0.93],
    skyAmb: mul(time === 'day' ? [1, 1, 1] : time === 'dusk' ? [0.82, 0.58, 0.55] : [0.15, 0.18, 0.3], weather === 'clear' ? 1 : 0.7),
    amb, head, night, wet, rain, snow, snowy: theme === 'snow' ? 1 : 0, storm,
  };
}
