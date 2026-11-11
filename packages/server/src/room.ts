import type { WebSocket } from 'ws';
import {
  AI_NAMES, CAR_COLORS, DT, MAX_CARS, NO_INPUT, TRACK_DEFS, createWorld, encodeSnapshot, getTrack, raceTime, standings, stepWorld,
  type Entry, type Input, type RaceStart, type ResultRow, type RoomSettings, type RoomState, type ServerMsg, type World,
} from '../../shared/src/index';

export interface Player {
  id: number; ws: WebSocket; name: string; classId: number; color: number; auto: boolean; ready: boolean;
  room: Room | null; carIdx: number; queue: { seq: number; input: Input }[]; last: Input; ack: number;
}
export const sendTo = (p: Player, m: ServerMsg) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); };

export class Room {
  players: Player[] = [];
  hostId = 0;
  settings: RoomSettings;
  world: World | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastTime = 0; private acc = 0;

  constructor(public code: string, mode: 'grid' | 'duel', private onEmpty: (r: Room) => void) {
    this.settings = { mode, trackId: TRACK_DEFS[0].id, laps: TRACK_DEFS[0].laps, weather: 'default', time: 'default', aiFill: mode === 'grid', difficulty: 1 };
  }
  get max() { return this.settings.mode === 'duel' ? 2 : MAX_CARS; }
  get racing() { return !!this.world; }

  state(): RoomState {
    return { code: this.code, hostId: this.hostId, racing: this.racing, settings: this.settings, players: this.players.map((p) => ({ id: p.id, name: p.name, classId: p.classId, color: p.color, auto: p.auto, ready: p.ready })) };
  }
  broadcast() { const m: ServerMsg = { t: 'room', room: this.state() }; for (const p of this.players) sendTo(p, m); }

  add(p: Player): string | null {
    if (this.players.length >= this.max) return 'That room is full';
    if (this.players.some((o) => o.color === p.color)) p.color = CAR_COLORS.map((_, i) => i).find((i) => !this.players.some((o) => o.color === i)) ?? p.color;
    this.players.push(p); p.room = this; p.ready = false; p.carIdx = -1;
    if (this.players.length === 1) this.hostId = p.id;
    this.broadcast();
    return null;
  }
  remove(p: Player) {
    this.players = this.players.filter((o) => o !== p);
    p.room = null;
    if (this.world && p.carIdx >= 0) { const c = this.world.cars[p.carIdx]; c.isAI = true; c.human = false; }
    p.carIdx = -1;
    if (!this.players.length) { this.stop(); this.onEmpty(this); return; }
    if (this.hostId === p.id) this.hostId = this.players[0].id;
    if (this.world && !this.players.some((o) => o.carIdx >= 0)) this.stop();
    this.broadcast();
  }

  set(p: Player, s: Partial<RoomSettings>) {
    if (p.id !== this.hostId || this.racing) return;
    const t = this.settings;
    if (typeof s.trackId === 'string' && TRACK_DEFS.some((d) => d.id === s.trackId)) t.trackId = s.trackId;
    if (typeof s.laps === 'number') t.laps = Math.max(1, Math.min(9, Math.floor(s.laps)));
    if (s.weather && ['default', 'clear', 'rain', 'fog', 'snow'].includes(s.weather)) t.weather = s.weather;
    if (s.time && ['default', 'day', 'dusk', 'night'].includes(s.time)) t.time = s.time;
    if (typeof s.aiFill === 'boolean') t.aiFill = s.aiFill;
    if (s.difficulty === 0 || s.difficulty === 1 || s.difficulty === 2) t.difficulty = s.difficulty;
    this.broadcast();
  }

  start(p: Player): string | null {
    if (p.id !== this.hostId) return 'Only the host can start the race';
    if (this.racing) return 'A race is already running';
    if (this.players.some((o) => o !== p && !o.ready)) return 'Not everyone is ready yet';
    if (this.settings.mode === 'duel' && this.players.length < 2 && !this.settings.aiFill) return 'A duel needs a second player (or enable AI cars)';
    const s = this.settings, def = TRACK_DEFS.find((d) => d.id === s.trackId)!;
    const humans = [...this.players].sort(() => Math.random() - 0.5);
    const nAI = s.aiFill ? MAX_CARS - humans.length : 0;
    const used = new Set(humans.map((h) => h.color));
    const free = CAR_COLORS.map((_, i) => i).filter((i) => !used.has(i));
    const entries: Entry[] = [];
    for (let i = 0; i < nAI; i++) entries.push({ name: AI_NAMES[i], classId: i % 4, color: free[i % free.length], auto: true, isAI: true });
    humans.forEach((h, i) => { h.carIdx = nAI + i; h.queue = []; h.last = NO_INPUT; h.ack = 0; entries.push({ name: h.name, classId: h.classId, color: h.color, auto: h.auto, isAI: false }); });
    const race: Omit<RaceStart, 'yourIdx'> = {
      trackId: def.id, laps: s.laps, weather: s.weather === 'default' ? def.weather : s.weather, time: s.time === 'default' ? def.time : s.time, difficulty: s.difficulty, entries,
      shift: s.weather === 'default' && s.time === 'default' ? def.shift : 'none',
    };
    this.world = createWorld({ track: getTrack(def.id), laps: race.laps, weather: race.weather, time: race.time, difficulty: race.difficulty, entries, shift: race.shift });
    for (const h of humans) sendTo(h, { t: 'race', race: { ...race, yourIdx: h.carIdx } });
    this.lastTime = performance.now(); this.acc = 0;
    this.timer = setInterval(() => this.tick(), 1000 / 120);
    this.broadcast();
    return null;
  }

  input(p: Player, seq: number, input: Input) {
    if (p.carIdx < 0) return;
    p.queue.push({ seq, input });
    if (p.queue.length > 8) p.queue.splice(0, p.queue.length - 3); // client ran ahead: catch up
  }

  private tick() {
    const w = this.world; if (!w) return;
    const now = performance.now();
    this.acc = Math.min(0.25, this.acc + (now - this.lastTime) / 1000); this.lastTime = now;
    while (this.acc >= DT && this.world) {
      this.acc -= DT;
      const inputs: (Input | undefined)[] = [];
      for (const p of this.players) {
        if (p.carIdx < 0) continue;
        const q = p.queue.shift();
        if (q) { p.last = q.input; p.ack = q.seq; }
        inputs[p.carIdx] = p.last;
      }
      stepWorld(w, inputs);
      if (w.tick % 3 === 0 || w.phase === 'done') {
        for (const p of this.players) if (p.carIdx >= 0 && p.ws.readyState === 1) p.ws.send(encodeSnapshot(w, p.ack));
      }
      if (w.phase === 'done') this.finish();
    }
  }

  private finish() {
    const w = this.world!;
    const rows: ResultRow[] = standings(w).map((i) => ({ idx: i, name: w.cars[i].name, time: raceTime(w.cars[i]), human: w.cars[i].human }));
    const racers = this.players.filter((p) => p.carIdx >= 0);
    this.stop();
    for (const p of this.players) { p.ready = false; p.carIdx = -1; }
    setTimeout(() => { for (const p of racers) if (p.room === this) sendTo(p, { t: 'results', rows }); this.broadcast(); }, 2500);
  }
  private stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.world = null; }
}
