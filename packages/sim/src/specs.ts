/** Physical description of a car. SI units throughout. */
export interface CarSpec {
  mass: number; wheelbase: number; cgFront: number; cgHeight: number; inertia: number;
  wheelR: number; halfW: number; halfL: number;
  torque: number; redline: number; idle: number; boost: number; lag: number;
  gears: number[]; final: number; shiftTime: number; /** share of engine torque that reaches the wheels */ eff: number;
  mu: number; brake: number; brakeBias: number;
  cda: number; cla: number;
  nitroPower: number; nitroTank: number;
  /** how quickly the chassis settles (suspension quality), 0..1 */
  poise: number;
}

export const PART_IDS = ['engine', 'turbo', 'gearbox', 'tyres', 'suspension', 'brakes', 'weight', 'aero', 'nitro'] as const;
export type PartId = (typeof PART_IDS)[number];
export type Parts = Record<PartId, number>;
export const MAX_LEVEL = 3;
export const noParts = (): Parts => ({ engine: 0, turbo: 0, gearbox: 0, tyres: 0, suspension: 0, brakes: 0, weight: 0, aero: 0, nitro: 0 });

/** Price of each level above stock. */
export const PART_PRICE: Record<PartId, number[]> = {
  engine: [4000, 9000, 18000], turbo: [3500, 8000, 16000], gearbox: [2000, 5000, 10000], tyres: [2500, 6000, 12000],
  suspension: [2000, 5000, 10000], brakes: [1500, 4000, 8000], weight: [3000, 7000, 14000], aero: [2000, 5500, 11000], nitro: [1500, 4000, 9000],
};

export interface Tuning { /** final drive scale: <1 longer gearing, >1 shorter */ gearing: number; /** 0..1 wing angle */ wing: number; /** front brake share */ bias: number; }
export const defaultTuning = (): Tuning => ({ gearing: 1, wing: 0.5, bias: 0.62 });

export const BASE: CarSpec = {
  mass: 1380, wheelbase: 2.62, cgFront: 1.27, cgHeight: 0.52, inertia: 2100,
  wheelR: 0.335, halfW: 0.95, halfL: 2.2,
  torque: 350, redline: 7400, idle: 950, boost: 0, lag: 0.45,
  gears: [3.25, 2.05, 1.48, 1.14, 0.92, 0.77], final: 3.7, shiftTime: 0.28, eff: 0.88,
  mu: 1.08, brake: 10500, brakeBias: 0.62,
  cda: 0.74, cla: 0.35,
  nitroPower: 90000, nitroTank: 2.5,
  poise: 0.35,
};

const lv = (a: number[], l: number) => a[Math.max(0, Math.min(MAX_LEVEL, l))];

export function buildSpec(parts: Parts, tune: Tuning = defaultTuning(), base: CarSpec = BASE): CarSpec {
  const s: CarSpec = { ...base, gears: base.gears.slice() };
  s.torque *= lv([1, 1.1, 1.2, 1.32], parts.engine);
  s.redline += lv([0, 150, 300, 500], parts.engine);
  s.boost = lv([0, 0.14, 0.25, 0.38], parts.turbo); s.lag = lv([0.45, 0.5, 0.45, 0.36], parts.turbo);
  s.shiftTime = lv([0.28, 0.2, 0.13, 0.07], parts.gearbox);
  s.eff = lv([0.88, 0.9, 0.92, 0.94], parts.gearbox);
  const close = lv([0, 0.025, 0.05, 0.075], parts.gearbox); // closer middle ratios keep the engine in its power band
  for (let i = 1; i < s.gears.length - 1; i++) s.gears[i] *= 1 + close;
  s.mu = lv([1.08, 1.18, 1.29, 1.42], parts.tyres);
  s.cgHeight = lv([0.52, 0.48, 0.44, 0.4], parts.suspension); s.poise = lv([0.35, 0.55, 0.75, 1], parts.suspension);
  s.mu *= lv([1, 1.015, 1.03, 1.045], parts.suspension);
  s.brake = lv([10500, 13500, 17000, 21000], parts.brakes);
  s.mass -= lv([0, 60, 130, 210], parts.weight); s.inertia *= s.mass / base.mass;
  const kit = lv([0, 0.35, 0.75, 1.2], parts.aero);
  s.cla = 0.35 + kit * (0.5 + tune.wing); s.cda = 0.74 - kit * 0.03 + kit * tune.wing * 0.09 + (tune.wing - 0.5) * 0.04;
  s.nitroPower = lv([90000, 125000, 165000, 210000], parts.nitro); s.nitroTank = lv([2.5, 3.5, 4.5, 6], parts.nitro);
  s.final *= tune.gearing; s.brakeBias = tune.bias;
  return s;
}

/** Engine torque (N m) at full throttle with the turbo fully spooled. */
export function torqueAt(s: CarSpec, rpm: number, spool = 1): number {
  const x = rpm / s.redline, p = 0.6, w = x < p ? 0.78 : 0.62, k = (x - p) / w;
  const na = Math.max(0, 1 - k * k);
  const boost = s.boost * spool * Math.max(0, Math.min(1, (x - 0.28) / 0.3));
  return s.torque * na * (1 + boost);
}

/** Dyno run: torque (N m) and power (kW) across the rev range. */
export function dyno(s: CarSpec, steps = 60) {
  const rpm: number[] = [], tq: number[] = [], kw: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const r = s.idle + ((s.redline - s.idle) * i) / steps, t = torqueAt(s, r);
    rpm.push(r); tq.push(t); kw.push((t * r * Math.PI) / 30 / 1000);
  }
  return { rpm, tq, kw, peakKw: Math.max(...kw), peakTq: Math.max(...tq) };
}

/** Headline figures for the garage, 0..1 each. */
export function ratings(s: CarSpec) {
  const d = dyno(s), pw = d.peakKw / s.mass; // kW per kg
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    hp: Math.round(d.peakKw * 1.341),
    power: clamp((pw - 0.12) / 0.26), grip: clamp((s.mu - 1) / 0.55 + s.cla * 0.08), braking: clamp((s.brake - 9000) / 12000),
    top: clamp((Math.cbrt((d.peakKw * 1000 * 0.9) / (0.6 * s.cda)) * 3.6 - 220) / 130), nitro: clamp((s.nitroPower * s.nitroTank) / 1260000),
  };
}
