import type { Car, Difficulty, Entry, Input, World } from './sim';
import type { TimeOfDay, Weather } from './track';

export const MSG_SNAPSHOT = 1;
export const MSG_INPUT = 2;
const CAR_BYTES = 29;
const PHASES = ['countdown', 'racing', 'done'] as const;

export interface RoomSettings {
  mode: 'grid' | 'duel'; trackId: string; laps: number; weather: Weather | 'default'; time: TimeOfDay | 'default';
  aiFill: boolean; difficulty: Difficulty;
}
export interface RoomPlayer { id: number; name: string; classId: number; color: number; auto: boolean; ready: boolean }
export interface RoomState { code: string; hostId: number; racing: boolean; settings: RoomSettings; players: RoomPlayer[] }
export interface RaceStart { trackId: string; laps: number; weather: Weather; time: TimeOfDay; difficulty: Difficulty; entries: Entry[]; yourIdx: number }
export interface ResultRow { idx: number; name: string; time: number; human: boolean }

export type ClientMsg =
  | { t: 'hello'; name: string }
  | { t: 'list' }
  | { t: 'create'; mode: 'grid' | 'duel' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'set'; settings: Partial<RoomSettings> }
  | { t: 'car'; classId: number; color: number; auto: boolean }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'ping'; c: number };
export type ServerMsg =
  | { t: 'welcome'; id: number }
  | { t: 'rooms'; rooms: { code: string; mode: string; players: number; max: number; racing: boolean; trackId: string }[] }
  | { t: 'room'; room: RoomState }
  | { t: 'left' }
  | { t: 'race'; race: RaceStart }
  | { t: 'results'; rows: ResultRow[] }
  | { t: 'error'; msg: string }
  | { t: 'pong'; c: number };

/** Round an input to what survives the wire so client prediction matches the server exactly. */
export function quantizeInput(i: Input): Input {
  return {
    steer: Math.round(Math.max(-1, Math.min(1, i.steer)) * 127) / 127,
    throttle: Math.round(Math.max(0, Math.min(1, i.throttle)) * 255) / 255,
    brake: Math.round(Math.max(0, Math.min(1, i.brake)) * 255) / 255,
    nitro: i.nitro, up: i.up, down: i.down,
  };
}
export function encodeInput(seq: number, i: Input): ArrayBuffer {
  const b = new DataView(new ArrayBuffer(9));
  b.setUint8(0, MSG_INPUT); b.setUint32(1, seq);
  b.setInt8(5, Math.round(i.steer * 127)); b.setUint8(6, Math.round(i.throttle * 255)); b.setUint8(7, Math.round(i.brake * 255));
  b.setUint8(8, (i.nitro ? 1 : 0) | (i.up ? 2 : 0) | (i.down ? 4 : 0));
  return b.buffer;
}
export function decodeInput(buf: ArrayBuffer): { seq: number; input: Input } | null {
  if (buf.byteLength !== 9) return null;
  const b = new DataView(buf);
  if (b.getUint8(0) !== MSG_INPUT) return null;
  const f = b.getUint8(8);
  return { seq: b.getUint32(1), input: { steer: b.getInt8(5) / 127, throttle: b.getUint8(6) / 255, brake: b.getUint8(7) / 255, nitro: !!(f & 1), up: !!(f & 2), down: !!(f & 4) } };
}

export interface SnapCar {
  x: number; z: number; speed: number; fuel: number; nitroT: number; steer: number; lap: number; gear: number; nitro: number;
  finished: boolean; dnf: boolean; pNitro: boolean; pUp: boolean; pDown: boolean; inPit: boolean; offroad: boolean; isAI: boolean; bump: number;
}
export interface Snapshot { tick: number; phase: World['phase']; ack: number; cars: SnapCar[] }

export function encodeSnapshot(w: World, ack: number): ArrayBuffer {
  const b = new DataView(new ArrayBuffer(11 + w.cars.length * CAR_BYTES));
  b.setUint8(0, MSG_SNAPSHOT); b.setUint32(1, w.tick); b.setUint8(5, PHASES.indexOf(w.phase)); b.setUint32(6, ack); b.setUint8(10, w.cars.length);
  let o = 11;
  for (const c of w.cars) {
    b.setFloat32(o, c.x); b.setFloat32(o + 4, c.z); b.setFloat32(o + 8, c.speed); b.setFloat32(o + 12, c.fuel);
    b.setFloat32(o + 16, c.nitroT); b.setFloat32(o + 20, c.steer);
    b.setUint8(o + 24, c.lap); b.setUint8(o + 25, c.gear); b.setUint8(o + 26, c.nitro);
    b.setUint8(o + 27, (c.finished ? 1 : 0) | (c.dnf ? 2 : 0) | (c.pNitro ? 4 : 0) | (c.pUp ? 8 : 0) | (c.pDown ? 16 : 0) | (c.inPit ? 32 : 0) | (c.offroad ? 64 : 0) | (c.isAI ? 128 : 0));
    b.setUint8(o + 28, Math.round(Math.min(1, c.bump) * 255));
    o += CAR_BYTES;
  }
  return b.buffer;
}
export function decodeSnapshot(buf: ArrayBuffer): Snapshot | null {
  const b = new DataView(buf);
  if (buf.byteLength < 11 || b.getUint8(0) !== MSG_SNAPSHOT) return null;
  const n = b.getUint8(10);
  if (buf.byteLength !== 11 + n * CAR_BYTES) return null;
  const cars: SnapCar[] = [];
  let o = 11;
  for (let i = 0; i < n; i++) {
    const f = b.getUint8(o + 27);
    cars.push({
      x: b.getFloat32(o), z: b.getFloat32(o + 4), speed: b.getFloat32(o + 8), fuel: b.getFloat32(o + 12), nitroT: b.getFloat32(o + 16), steer: b.getFloat32(o + 20),
      lap: b.getUint8(o + 24), gear: b.getUint8(o + 25), nitro: b.getUint8(o + 26),
      finished: !!(f & 1), dnf: !!(f & 2), pNitro: !!(f & 4), pUp: !!(f & 8), pDown: !!(f & 16), inPit: !!(f & 32), offroad: !!(f & 64), isAI: !!(f & 128),
      bump: b.getUint8(o + 28) / 255,
    });
    o += CAR_BYTES;
  }
  return { tick: b.getUint32(1), phase: PHASES[b.getUint8(5)] ?? 'racing', ack: b.getUint32(6), cars };
}
export function applySnapCar(c: Car, s: SnapCar) {
  c.x = s.x; c.z = s.z; c.speed = s.speed; c.fuel = s.fuel; c.nitroT = s.nitroT; c.steer = s.steer; c.lap = s.lap; c.gear = s.gear; c.nitro = s.nitro;
  c.finished = s.finished; c.dnf = s.dnf; c.pNitro = s.pNitro; c.pUp = s.pUp; c.pDown = s.pDown; c.inPit = s.inPit; c.offroad = s.offroad; c.isAI = s.isAI; c.bump = s.bump;
}
