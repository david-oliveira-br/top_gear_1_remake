import { steerLimit, type Car, type Input } from './car';
import type { CarSpec } from './specs';
import { smoothLoop, type Track } from './track';

export interface Driver { name: string; /** pace 0.8..1.02 */ skill: number; /** 0..1 how hard they push past traffic */ aggression: number; /** 0..1, lower makes more mistakes */ consistency: number; }

export interface AiProfile {
  driver: Driver;
  /** lateral offset of the racing line and target speed at each track sample */
  off: Float64Array; vt: Float64Array;
  side: number; lapse: number; seed: number;
}

/** Racing line that cuts towards the inside of corners, with a speed profile the car can actually hold and brake for. */
export function makeProfile(t: Track, spec: CarSpec, driver: Driver, seed: number): AiProfile {
  const n = t.n, off = new Float64Array(n);
  const wide = smoothLoop(t.curv, 14, 2);
  for (let i = 0; i < n; i++) off[i] = Math.max(-(t.hw[i] - 2.2), Math.min(t.hw[i] - 2.2, wide[i] * 520));
  const line = smoothLoop(off, 10, 2);
  // curvature of the driven path
  const qx = new Float64Array(n), qz = new Float64Array(n);
  for (let i = 0; i < n; i++) { qx[i] = t.px[i] - t.tz[i] * line[i]; qz[i] = t.pz[i] + t.tx[i] * line[i]; }
  let k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i + n - 3) % n, b = (i + 3) % n, ux = qx[i] - qx[a], uz = qz[i] - qz[a], vx = qx[b] - qx[i], vz = qz[b] - qz[i];
    const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
    k[i] = Math.abs((ux * vz - uz * vx) / (lu * lv)) / ((lu + lv) / 2);
  }
  k = smoothLoop(k, 4, 2) as Float64Array<ArrayBuffer>;
  const vt = new Float64Array(n), g = 9.81, grip = spec.mu * 0.9 * driver.skill, df = (0.5 * 1.2 * spec.cla) / spec.mass;
  for (let i = 0; i < n; i++) { const d = k[i] - grip * df; vt[i] = d > 1e-5 ? Math.min(110, Math.sqrt((grip * g) / d)) : 110; }
  const brake = Math.min(spec.mu * g * 0.8, spec.brake / spec.mass) * 0.8 * driver.skill;
  for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) { const nx = vt[(i + 1) % n]; vt[i] = Math.min(vt[i], Math.sqrt(nx * nx + 2 * brake * t.step)); }
  return { driver, off: line, vt, side: 0, lapse: 0, seed: seed >>> 0 || 1 };
}

function rnd(p: AiProfile) { let s = p.seed; s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; p.seed = s || 1; return s / 4294967296; }

/** Decide the controls for one AI car this tick. `pace` scales its target speed (rubber banding, mistakes). */
export function drive(c: Car, p: AiProfile, t: Track, others: Car[], pace: number, out: Input): Input {
  const n = t.n, v = Math.hypot(c.vx, c.vy), i = c.loc.idx;
  // traffic: pick a side to pass on, or lift when boxed in
  let want = 0, block = 0;
  for (const o of others) {
    if (o === c) continue;
    let ds = ((o.loc.idx - i + n) % n) * t.step; if (ds > t.len / 2) ds -= t.len;
    const dl = o.loc.lat - c.loc.lat, closing = v - o.vx;
    if (ds > 1 && ds < 10 + v * 0.55 && Math.abs(dl) < 2.6 && closing > -2) {
      const room = t.hw[i] - 1.3, goRight = o.loc.lat < 0 ? 1 : -1;
      want = (Math.abs(o.loc.lat + goRight * 3) < room ? goRight : -goRight) * (2.4 + p.driver.aggression);
      if (ds < 7 + (1 - p.driver.aggression) * 5 && closing > 0 && Math.abs(dl) < 2) block = Math.max(block, 1 - ds / 14);
    } else if (Math.abs(ds) < 5 && Math.abs(dl) < 2.8) want = dl > 0 ? -1.2 : 1.2; // alongside: give room
  }
  p.side += (want - p.side) * 0.04;
  // occasional lapses
  if (p.lapse > 0) p.lapse--; else if (rnd(p) < (1 - p.driver.consistency) * 0.0012) p.lapse = 50 + Math.floor(rnd(p) * 60);
  const k = pace * (p.lapse > 0 ? 0.93 : 1);

  // steer towards a point on the line ahead
  const ahead = 7 + v * 0.42, ti = (i + Math.round(ahead / t.step)) % n;
  const lim = t.hw[ti] - 1.2, lat = Math.max(-lim, Math.min(lim, p.off[ti] + p.side));
  const gx = t.px[ti] - t.tz[ti] * lat - c.x, gz = t.pz[ti] + t.tx[ti] * lat - c.z;
  const ct = Math.cos(c.yaw), st = Math.sin(c.yaw), lx = gx * ct + gz * st, ly = -gx * st + gz * ct;
  const delta = Math.atan2(2 * c.spec.wheelbase * ly, lx * lx + ly * ly);
  out.steer = Math.max(-1, Math.min(1, delta / steerLimit(c.spec, v)));

  // speed: look a little ahead so braking starts in time
  const si = (i + Math.round((v * 0.3) / t.step)) % n, target = Math.min(p.vt[i], p.vt[si]) * k * (1 - block * 0.25);
  const err = target - v, sliding = Math.max(c.slipR, c.slipF * 0.8);
  out.throttle = err > 0 ? Math.min(1, 0.25 + err * 0.5) * (sliding > 0.7 ? 0.45 : 1) * (c.spin > 0.2 ? 0.6 : 1) : 0;
  out.brake = err < -0.5 ? Math.min(1, -err * 0.6) : 0;
  out.handbrake = false; out.shift = 0;
  const straight = Math.abs(t.curv[i]) < 0.002 && Math.abs(t.curv[(i + 40) % n]) < 0.004;
  out.nitro = straight && err > 6 && v > 30 && c.nitro > (c.nitroOn ? 0 : c.spec.nitroTank * 0.5);
  return out;
}
