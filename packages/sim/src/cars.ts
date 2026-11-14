import { BASE, ratings, torqueAt, type CarSpec } from './specs';

export type CarId = 'aurora' | 'corvette' | 'cuda' | 'mustang' | 'golf' | 'm635' | 'alfa155';
export type Drivetrain = 'RWD' | 'FWD' | 'AWD';
export interface CarDef { id: CarId; name: string; year: number; blurb: string; drivetrain: Drivetrain; spec: CarSpec; }

/** Chassis dimensions are constants for now; they may later be measured from models.gen.json. */
function chassis(mass: number, wheelbase: number, front: number, wheelR: number, halfW: number, halfL: number, cgHeight: number): Partial<CarSpec> {
  return {
    mass, wheelbase, cgFront: wheelbase * front, cgHeight, inertia: mass * wheelbase * wheelbase * 0.194, wheelR, halfW, halfL,
    // keep the overall gearing (wheel rpm per road speed) of the base car at this wheel radius
    final: (BASE.final * wheelR) / BASE.wheelR,
  };
}
const car = (o: Partial<CarSpec>): CarSpec => ({ ...BASE, gears: BASE.gears.slice(), ...o });

export const CARS: CarDef[] = [
  { id: 'aurora', name: 'Aurora Concept', year: 2020, drivetrain: 'RWD', spec: BASE,
    blurb: 'O carro de conceito que abre o jogo: equilibrado, estável e pronto para qualquer evolução.' },
  { id: 'corvette', name: 'Chevrolet Corvette Grand Sport', year: 1962, drivetrain: 'RWD',
    blurb: 'Fibra de vidro e V8 de sobra: a melhor arrancada da garagem, mas a traseira não perdoa erros.',
    spec: car({ ...chassis(1000, 2.49, 0.52, 0.345, 1.0, 2.2, 0.47), torque: 470, redline: 6400, mu: 1.1, brake: 8800, poise: 0.4, cda: 0.8, cla: 0.15, steerRate: 1, balance: 0.03 }) },
  { id: 'cuda', name: 'Plymouth Barracuda', year: 1970, drivetrain: 'RWD',
    blurb: 'Muito torque e muito peso: sai de traseira com facilidade e os freios pedem antecedência.',
    spec: car({ ...chassis(1650, 2.74, 0.46, 0.34, 1.05, 2.35, 0.54), torque: 570, redline: 5900, mu: 1.03, brake: 8600, poise: 0.2, cda: 0.84, cla: 0.1, steerRate: 0.85, balance: -0.01 }) },
  { id: 'mustang', name: 'Ford Mustang GT Fastback', year: 1968, drivetrain: 'RWD',
    blurb: 'O muscle car equilibrado: força de V8, direção honesta e fácil de levar ao limite.',
    spec: car({ ...chassis(1480, 2.74, 0.47, 0.345, 1.04, 2.32, 0.52), torque: 440, redline: 6500, mu: 1.07, brake: 9800, poise: 0.3, cda: 0.8, cla: 0.12 }) },
  { id: 'golf', name: 'Volkswagen Golf GTI', year: 1976, drivetrain: 'FWD',
    blurb: 'Leve e ágil, tração dianteira que puxa nas curvas; falta fôlego na reta final.',
    spec: car({ ...chassis(860, 2.4, 0.42, 0.3, 0.9, 1.9, 0.5), torque: 170, redline: 7000, mu: 1.14, brake: 9000, poise: 0.35, cda: 0.62, cla: 0.1, steerRate: 1.2, driveFront: 1, eff: 0.9 }) },
  { id: 'm635', name: 'BMW M635 CSi', year: 1984, drivetrain: 'RWD',
    blurb: 'Seis cilindros em linha e estabilidade de gran turismo: velocidade final de sobra.',
    spec: car({ ...chassis(1430, 2.63, 0.5, 0.33, 1.0, 2.38, 0.5), torque: 385, redline: 7000, mu: 1.09, brake: 10800, poise: 0.5, cda: 0.6, cla: 0.12, balance: -0.01 }) },
  { id: 'alfa155', name: 'Alfa Romeo 155 Q4', year: 1992, drivetrain: 'AWD',
    blurb: 'Tração integral quase de rali: muita aderência e saída de curva imbatível no molhado.',
    spec: car({ ...chassis(1400, 2.54, 0.45, 0.32, 0.96, 2.22, 0.5), torque: 300, redline: 7000, mu: 1.16, brake: 10500, poise: 0.45, cda: 0.7, cla: 0.12, driveFront: 0.45, eff: 0.86 }) },
];

export const DEFAULT_CAR: CarId = 'aurora';
export const isCarId = (id: unknown): id is CarId => typeof id === 'string' && CARS.some((c) => c.id === id);
export const carById = (id: string | undefined | null): CarDef => CARS.find((c) => c.id === id) ?? CARS[0];

/** Garage bars (0..100) plus headline numbers for a spec. */
export interface CarStats { speed: number; accel: number; handling: number; braking: number; /** seconds, 0-100 km/h on a straight */ zeroTo100: number; hp: number; /** km/h reached within 40 s */ topKmh: number; }
export function carStats(s: CarSpec): CarStats {
  const r = ratings(s), a = accelRun(s), clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  return {
    speed: clamp(((a.topKmh - 160) / 160) * 100), accel: clamp(((9 - a.t100) / 5) * 100),
    handling: clamp(((s.mu + s.cla * 0.25 - 0.9) / 0.7) * 100 - Math.abs(s.balance ?? 0) * 500 + ((s.steerRate ?? 1) - 1) * 40 + (s.poise - 0.35) * 25),
    braking: clamp(((Math.min(s.brake / s.mass, s.mu * 9.81 * 0.9) - 5) / 9) * 100),
    zeroTo100: Math.round(a.t100 * 100) / 100, hp: r.hp, topKmh: Math.round(a.topKmh),
  };
}

/** Simple longitudinal integrator (auto gearbox, flat road, traction-limited launch) for 0-100 and top speed. */
export function accelRun(s: CarSpec): { t100: number; topKmh: number } {
  const dt = 0.01, G = 9.81, RHO = 1.2, df = s.driveFront ?? 0;
  const rearLoad = s.cgFront / s.wheelbase + 0.08, frontLoad = 1 - s.cgFront / s.wheelbase - 0.08; // load share under acceleration
  let v = 0, gear = 1, shift = 0, t100 = 0;
  for (let t = 0; t < 40; t += dt) {
    const ratio = s.gears[gear - 1] * s.final, wheelRpm = (v / s.wheelR) * ratio * (30 / Math.PI), rpm = Math.max(s.idle, wheelRpm);
    if (shift > 0) shift -= dt;
    else if (wheelRpm > s.redline * 0.965 && gear < s.gears.length) { gear++; shift = s.shiftTime; }
    const f = shift > 0 || rpm > s.redline * 1.01 ? 0 : (torqueAt(s, rpm, 1) * ratio * s.eff) / s.wheelR;
    // each driven axle can carry its share of the drive force up to mu x its load
    const w = s.mu * (s.mass * G + 0.5 * RHO * s.cla * v * v) * 0.94;
    const grip = Math.min(df < 1 ? (w * rearLoad) / (1 - df) : Infinity, df > 0 ? (w * frontLoad) / df : Infinity);
    v += ((Math.min(f, grip) - 0.5 * RHO * s.cda * v * v - s.mass * G * 0.014) / s.mass) * dt;
    if (!t100 && v * 3.6 >= 100) t100 = t;
  }
  return { t100: t100 || 40, topKmh: v * 3.6 };
}
