import { torqueAt, type CarSpec } from './specs';
import { heightAt, locate, type Loc, type Track } from './track';

export const DT = 1 / 60;
const SUB = 4, H = DT / SUB, G = 9.81, RHO = 1.2;

export interface Input { steer: number; throttle: number; brake: number; nitro: boolean; handbrake: boolean; shift: number; }
export const noInput = (): Input => ({ steer: 0, throttle: 0, brake: 0, nitro: false, handbrake: false, shift: 0 });

export interface Car {
  id: number; spec: CarSpec; auto: boolean;
  x: number; z: number; y: number; yaw: number;
  /** body-frame velocity: forward, to the right; and yaw rate (positive turns right) */
  vx: number; vy: number; wz: number;
  steer: number; rpm: number; gear: number; shiftT: number; spool: number; throttle: number; brake: number;
  nitro: number; nitroOn: boolean;
  loc: Loc; slopeS: number; slopeL: number;
  /** accelerations in the body frame (for body roll / pitch), tyre slip 0..1 front and rear, wheelspin 0..1 */
  ax: number; ay: number; slipF: number; slipR: number; spin: number;
  offRoad: boolean; draft: number; hit: number;
}

export function makeCar(id: number, spec: CarSpec): Car {
  return {
    id, spec, auto: true, x: 0, z: 0, y: 0, yaw: 0, vx: 0, vy: 0, wz: 0, steer: 0, rpm: spec.idle, gear: 1, shiftT: 0, spool: 0, throttle: 0, brake: 0,
    nitro: spec.nitroTank, nitroOn: false, loc: { idx: 0, frac: 0, lat: 0 }, slopeS: 0, slopeL: 0, ax: 0, ay: 0, slipF: 0, slipR: 0, spin: 0,
    offRoad: false, draft: 0, hit: 0,
  };
}

/** Largest useful steering angle at a given speed: enough to reach the grip limit, no more. */
export function steerLimit(s: CarSpec, v: number) {
  return Math.max(0.035, Math.min(0.56, Math.atan((s.wheelbase * s.mu * G * 1.1) / Math.max(1, v * v)) + 0.1));
}

/** Lateral tyre force. `stiff` is the cornering stiffness at rest; load transfer and `keep` (grip left after braking or driving) change the peak, not the initial response. */
function tyre(alpha: number, load: number, mu: number, stiff: number, keep: number) {
  return load < 1 ? 0 : -mu * load * keep * Math.sin(1.5 * Math.atan((stiff / (load * keep)) * alpha));
}

/** Advance one car by one 60 Hz tick. `hold` keeps it on the grid during the countdown. */
export function stepCar(c: Car, inp: Input, t: Track, hold: boolean) {
  const s = c.spec, a = s.cgFront, b = s.wheelbase - a, L = s.wheelbase;
  c.hit = 0;
  // gearbox
  const topGear = s.gears.length;
  if (c.shiftT > 0) c.shiftT -= DT;
  if (!c.auto && inp.shift && c.shiftT <= 0 && c.gear > 0) {
    const g = Math.max(1, Math.min(topGear, c.gear + inp.shift)); if (g !== c.gear) { c.gear = g; c.shiftT = s.shiftTime; }
  }
  const reverse = c.gear === -1;
  if (!reverse && c.vx < 0.6 && inp.brake > 0.5 && inp.throttle < 0.1 && !hold) c.gear = -1;
  else if (reverse && inp.throttle > 0.1) c.gear = 1;

  let ax = 0, ay = 0, slipF = 0, slipR = 0, spin = 0;
  for (let k = 0; k < SUB; k++) {
    const v = Math.hypot(c.vx, c.vy), fwd = c.vx >= 0 ? 1 : -1;
    // steering
    const lim = steerLimit(s, v), target = Math.max(-1, Math.min(1, inp.steer)) * lim;
    const rate = (2.2 + 1.6 * s.poise) * H * (0.35 + lim);
    c.steer += Math.max(-rate, Math.min(rate, target - c.steer));
    const cd = Math.cos(c.steer), sd = Math.sin(c.steer);

    // engine speed and drive force
    const ratio = c.gear > 0 ? s.gears[c.gear - 1] * s.final : s.gears[0] * s.final;
    const wheelRpm = (Math.abs(c.vx) / s.wheelR) * ratio * (30 / Math.PI);
    let thr = reverse ? inp.brake : inp.throttle, brk = reverse ? inp.throttle : inp.brake;
    if (hold) brk = 1;
    const launch = s.idle + thr * (s.redline * 0.55 - s.idle);
    c.rpm += (Math.max(wheelRpm, hold ? s.idle + thr * (s.redline * 0.8 - s.idle) : launch) - c.rpm) * Math.min(1, H * 14);
    if (c.auto && c.gear > 0 && c.shiftT <= 0 && !hold) {
      if (wheelRpm > s.redline * 0.965 && c.gear < topGear) { c.gear++; c.shiftT = s.shiftTime; }
      else if (c.gear > 1 && (wheelRpm * s.gears[c.gear - 2]) / s.gears[c.gear - 1] < s.redline * (thr > 0.6 ? 0.8 : 0.6)) { c.gear--; c.shiftT = s.shiftTime * 0.6; }
    }
    c.spool += ((thr > 0.2 ? thr : 0) - c.spool) * Math.min(1, H / s.lag);
    let drive = 0;
    if (c.shiftT <= 0 && c.rpm < s.redline * 1.01) drive = (torqueAt(s, c.rpm, c.spool) * thr * ratio * s.eff) / s.wheelR;
    if (reverse) drive = -Math.min(drive, s.mass * 4) * (c.vx > -14 ? 1 : 0);
    else if (thr < 0.05 && c.gear > 0) drive = (-((c.rpm / s.redline) * s.mass * 0.9 * ratio) / 12) * Math.max(0, Math.min(1, c.vx / 2)); // engine braking
    c.nitroOn = inp.nitro && c.nitro > 0 && !reverse && !hold && thr > 0.5;
    if (c.nitroOn) { c.nitro = Math.max(0, c.nitro - H); drive += s.nitroPower / Math.max(22, c.vx); }
    else c.nitro = Math.min(s.nitroTank, c.nitro + H * 0.045);

    // vertical loads with longitudinal transfer and downforce
    const down = 0.5 * RHO * s.cla * v * v, w = s.mass * G + down;
    const shift = Math.max(-0.3 * w, Math.min(0.3 * w, (s.mass * c.ax * s.cgHeight) / L));
    const fzF = Math.max(0, (w * b) / L - shift), fzR = Math.max(0, (w * a) / L + shift);
    const mu = s.mu * (c.offRoad ? 0.58 : 1);

    // longitudinal tyre forces (rear drive), limited by grip
    let fxR = drive, fxF = 0;
    const bf = brk * s.brake * s.brakeBias, br = brk * s.brake * (1 - s.brakeBias);
    const stopping = Math.abs(c.vx) > 0.3 ? -fwd : 0;
    // anti-lock with brake-force distribution: the rear keeps most of its grip for stability
    fxF += stopping * Math.min(bf, mu * fzF * 0.92); fxR += stopping * Math.min(br, mu * fzR * 0.5);
    if (inp.handbrake && !hold) fxR += stopping * mu * fzR * 0.7;
    const capR = mu * fzR;
    let useR = capR > 1 ? Math.abs(fxR) / capR : 0;
    if (useR > 1) { spin = Math.max(spin, Math.min(1, useR - 1)); fxR = Math.sign(fxR) * capR * 0.94; useR = 1; }
    const useF = mu * fzF > 1 ? Math.min(1, Math.abs(fxF) / (mu * fzF)) : 0;

    // lateral tyre forces from slip angles
    const vyF = c.vy + a * c.wz, vyR = c.vy - b * c.wz;
    const latF = vyF * cd - c.vx * sd, lonF = c.vx * cd + vyF * sd;
    const aF = Math.atan2(latF, Math.max(3, Math.abs(lonF))), aR = Math.atan2(vyR, Math.max(3, Math.abs(c.vx)));
    const circleR = Math.sqrt(1 - Math.min(0.72, useR * useR)) * (inp.handbrake ? 0.5 : 1);
    // the front is a little softer than the rear, so the car understeers gently and stays stable at speed
    const fyF = tyre(aF, fzF, mu, (15 * w * b) / L, Math.sqrt(1 - Math.min(0.6, useF * useF)));
    const fyR = tyre(aR, fzR, mu * (1.04 + 0.05 * s.poise), (20 * w * a) / L, circleR);
    slipF = Math.max(slipF, Math.min(1, Math.abs(aF) / 0.16)); slipR = Math.max(slipR, Math.min(1, Math.abs(aR) / 0.14));

    // resistances and gravity on slopes
    const drag = 0.5 * RHO * s.cda * (1 - 0.35 * c.draft) * c.vx * Math.abs(c.vx) + (Math.abs(c.vx) > 0.2 ? fwd * s.mass * G * (c.offRoad ? 0.09 : 0.014) : 0);
    const ct = Math.cos(c.yaw), st = Math.sin(c.yaw), i = c.loc.idx;
    const rel = ct * t.tx[i] + st * t.tz[i], relS = -st * t.tx[i] + ct * t.tz[i]; // track tangent in the body frame
    const gx = -s.mass * G * (c.slopeS * rel - c.slopeL * relS), gy = -s.mass * G * (c.slopeS * relS + c.slopeL * rel);

    const FX = fxR + fxF * cd - fyF * sd - drag + gx, FY = fyR + fyF * cd + fxF * sd + gy;
    let MZ = a * (fyF * cd + fxF * sd) - b * fyR;
    // stability control: damp yaw the tyres cannot hold and pull the nose back towards the direction of travel
    if (!inp.handbrake && v > 10) {
      const wzMax = (mu * (G + down / s.mass) * 1.08) / v, beta = Math.atan2(c.vy, Math.abs(c.vx));
      if (Math.abs(c.wz) > wzMax) MZ -= Math.sign(c.wz) * (Math.abs(c.wz) - wzMax) * s.inertia * 7;
      if (Math.abs(beta) > 0.06) MZ += (beta - Math.sign(beta) * 0.06) * s.inertia * (7 + 5 * s.poise) * fwd;
    }
    ax = FX / s.mass; ay = FY / s.mass;
    c.vx += (ax + c.vy * c.wz) * H; c.vy += (ay - c.vx * c.wz) * H;
    c.wz += (MZ / s.inertia) * H;
    // settle at walking pace so the car stops cleanly and does not creep sideways
    if (v < 2.5) { const d = Math.min(1, H * 6); c.vy -= c.vy * d; c.wz += ((c.vx * Math.tan(c.steer)) / L - c.wz) * d; }
    if (brk > 0 && Math.abs(c.vx) < 0.35 && !reverse) c.vx = 0;
    c.yaw += c.wz * H;
    c.x += (c.vx * ct - c.vy * st) * H; c.z += (c.vx * st + c.vy * ct) * H;
  }
  c.ax += (ax - c.ax) * 0.35; c.ay += (ay - c.ay) * 0.35; c.slipF = slipF; c.slipR = slipR; c.spin = spin;
  c.throttle = inp.throttle; c.brake = inp.brake;

  // road contact: position on the track, barriers, height
  locate(t, c.x, c.z, c.loc.idx, c.loc);
  const i = c.loc.idx, hw = t.hw[i], wall = hw + t.def.shoulder - s.halfW;
  c.offRoad = Math.abs(c.loc.lat) > hw + 0.4;
  if (Math.abs(c.loc.lat) > wall) {
    const side = Math.sign(c.loc.lat), nx = -t.tz[i], nz = t.tx[i], over = Math.abs(c.loc.lat) - wall;
    c.x -= nx * side * over; c.z -= nz * side * over; c.loc.lat = side * wall;
    const ct = Math.cos(c.yaw), st = Math.sin(c.yaw);
    let wx = c.vx * ct - c.vy * st, wzv = c.vx * st + c.vy * ct;
    const vn = (wx * nx + wzv * nz) * side;
    if (vn > 0) {
      wx -= nx * side * vn * 1.25; wzv -= nz * side * vn * 1.25;
      const scrub = Math.max(0.55, 1 - vn * 0.035); wx *= scrub; wzv *= scrub;
      c.vx = wx * ct + wzv * st; c.vy = -wx * st + wzv * ct;
      c.hit = vn;
      // swing the nose back along the wall
      const along = Math.atan2(t.tz[i], t.tx[i]); let d = along - c.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > Math.PI / 2) d = d > 0 ? d - Math.PI : d + Math.PI;
      c.yaw += d * 0.25; c.wz *= 0.4;
    }
  }
  const j = (i + 1) % t.n, f = c.loc.frac;
  c.slopeS = t.slope[i] + (t.slope[j] - t.slope[i]) * f; c.slopeL = t.bank[i] + (t.bank[j] - t.bank[i]) * f;
  c.y = heightAt(t, c.loc);
}

/** Push two overlapping cars apart and trade momentum along the contact normal. Each car is two circles. */
export function collide(p: Car, q: Car) {
  const dx0 = q.x - p.x, dz0 = q.z - p.z;
  if (dx0 * dx0 + dz0 * dz0 > 36) return;
  const R = 1.02;
  for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) {
    const ox = Math.cos(p.yaw) * 1.15 * i, oz = Math.sin(p.yaw) * 1.15 * i, qx = Math.cos(q.yaw) * 1.15 * j, qz = Math.sin(q.yaw) * 1.15 * j;
    const dx = q.x + qx - p.x - ox, dz = q.z + qz - p.z - oz, d = Math.hypot(dx, dz);
    if (d >= 2 * R || d < 1e-6) continue;
    const nx = dx / d, nz = dz / d, pen = 2 * R - d, mp = p.spec.mass, mq = q.spec.mass, tot = mp + mq;
    p.x -= (nx * pen * mq) / tot; p.z -= (nz * pen * mq) / tot; q.x += (nx * pen * mp) / tot; q.z += (nz * pen * mp) / tot;
    const pw = world(p), qw = world(q), rel = (qw[0] - pw[0]) * nx + (qw[1] - pw[1]) * nz;
    if (rel < 0) {
      const jn = (-(1 + 0.2) * rel) / (1 / mp + 1 / mq);
      setWorld(p, pw[0] - (jn * nx) / mp, pw[1] - (jn * nz) / mp); setWorld(q, qw[0] + (jn * nx) / mq, qw[1] + (jn * nz) / mq);
      // off-centre hits turn the cars
      p.wz += ((ox * nz - oz * nx) * -jn) / p.spec.inertia * 0.5; q.wz += ((qx * nz - qz * nx) * jn) / q.spec.inertia * 0.5;
      p.hit = Math.max(p.hit, -rel); q.hit = Math.max(q.hit, -rel);
    }
  }
}
function world(c: Car): [number, number] { const ct = Math.cos(c.yaw), st = Math.sin(c.yaw); return [c.vx * ct - c.vy * st, c.vx * st + c.vy * ct]; }
function setWorld(c: Car, wx: number, wz: number) { const ct = Math.cos(c.yaw), st = Math.sin(c.yaw); c.vx = wx * ct + wz * st; c.vy = -wx * st + wz * ct; }
