import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { aiInput, applySnapCar, createWorld, decodeSnapshot, encodeInput, getTrack, quantizeInput, type RaceStart, type ResultRow, type RoomState, type ServerMsg, type World } from '../../shared/src/index';
import { startServer } from '../src/index';

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => { srv = await startServer(0); });
afterAll(async () => { await srv.close(); });

/** A scripted client that drives its car with the AI controller. */
class Bot {
  ws: WebSocket; id = 0; room: RoomState | null = null; race: RaceStart | null = null; world: World | null = null;
  results: ResultRow[] | null = null; errors: string[] = []; snaps = 0; seq = 0; timer: NodeJS.Timeout | null = null;
  private waiters: (() => void)[] = [];
  constructor(public name: string, private lagMs = 0) {
    this.ws = new WebSocket(`ws://localhost:${srv.port}/ws`); this.ws.binaryType = 'arraybuffer';
    this.ws.on('open', () => this.send({ t: 'hello', name }));
    this.ws.on('message', (d, bin) => { const go = () => this.onMsg(d as any, bin); if (lagMs) setTimeout(go, lagMs); else go(); });
  }
  send(m: object) { const go = () => this.ws.readyState === 1 && this.ws.send(JSON.stringify(m)); if (this.lagMs) setTimeout(go, this.lagMs); else go(); }
  private onMsg(d: ArrayBuffer | Buffer, bin: boolean) {
    if (bin) {
      const s = decodeSnapshot(d as ArrayBuffer); if (!s || !this.world) return;
      this.snaps++; this.world.tick = s.tick; this.world.phase = s.phase;
      s.cars.forEach((c, i) => applySnapCar(this.world!.cars[i], c));
    } else {
      const m = JSON.parse(String(d)) as ServerMsg;
      if (m.t === 'welcome') this.id = m.id;
      else if (m.t === 'room') this.room = m.room;
      else if (m.t === 'error') this.errors.push(m.msg);
      else if (m.t === 'results') { this.results = m.rows; if (this.timer) clearInterval(this.timer); }
      else if (m.t === 'race') {
        this.race = m.race;
        this.world = createWorld({ track: getTrack(m.race.trackId), laps: m.race.laps, weather: m.race.weather, time: m.race.time, difficulty: m.race.difficulty, entries: m.race.entries });
        this.timer = setInterval(() => {
          const w = this.world!; const inp = quantizeInput(aiInput(w, m.race.yourIdx));
          const buf = encodeInput(++this.seq, inp);
          if (this.lagMs) setTimeout(() => this.ws.readyState === 1 && this.ws.send(buf), this.lagMs); else if (this.ws.readyState === 1) this.ws.send(buf);
        }, 1000 / 60);
      }
    }
    this.waiters.forEach((w) => w());
  }
  until(cond: () => boolean, ms = 8000) {
    return new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${this.name}: timed out`)), ms);
      const check = () => { if (cond()) { clearTimeout(t); this.waiters = this.waiters.filter((w) => w !== check); res(); } };
      this.waiters.push(check); check();
    });
  }
  close() { if (this.timer) clearInterval(this.timer); this.ws.close(); }
}

describe('game server', () => {
  it('runs a full 12-player grid race to consistent results (with 60 ms lag each way)', async () => {
    const bots = Array.from({ length: 12 }, (_, i) => new Bot('bot' + i, 60));
    await Promise.all(bots.map((b) => b.until(() => b.id > 0)));
    bots[0].send({ t: 'create', mode: 'grid' });
    await bots[0].until(() => !!bots[0].room);
    const code = bots[0].room!.code;
    for (const b of bots.slice(1)) b.send({ t: 'join', code });
    await bots[0].until(() => bots[0].room!.players.length === 12);
    const extra = new Bot('late'); await extra.until(() => extra.id > 0);
    extra.send({ t: 'join', code }); await extra.until(() => extra.errors.length > 0);
    expect(extra.errors[0]).toMatch(/full/); extra.close();

    bots[0].send({ t: 'set', settings: { trackId: 'touge', laps: 1, weather: 'clear' } });
    bots[3].send({ t: 'set', settings: { laps: 9 } }); // not the host: ignored
    bots[0].send({ t: 'start' });
    await bots[0].until(() => bots[0].errors.length > 0);
    expect(bots[0].errors[0]).toMatch(/ready/);
    for (const b of bots) b.send({ t: 'ready', ready: true });
    await bots[0].until(() => bots[0].room!.players.every((p) => p.ready));
    bots[0].send({ t: 'start' });
    await Promise.all(bots.map((b) => b.until(() => !!b.race)));
    expect(bots[0].race!.laps).toBe(1);
    expect(new Set(bots.map((b) => b.race!.yourIdx)).size).toBe(12);
    expect(new Set(bots[0].race!.entries.map((e) => e.color)).size).toBe(12);
    await Promise.all(bots.map((b) => b.until(() => !!b.results, 150000)));
    const ref = JSON.stringify(bots[0].results);
    for (const b of bots) expect(JSON.stringify(b.results)).toBe(ref);
    const rows = bots[0].results!;
    expect(rows.length).toBe(12);
    expect(rows.filter((r) => r.time > 0).length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < rows.length; i++) if (rows[i].time > 0) expect(rows[i].time).toBeGreaterThanOrEqual(rows[i - 1].time);
    expect(bots[0].snaps).toBeGreaterThan(300);
    await bots[0].until(() => !bots[0].room!.racing);
    bots.forEach((b) => b.close());
  }, 180000);

  it('duel room takes two players, fills with AI on request, and hands a leaver’s car to the AI', async () => {
    const a = new Bot('a'), b = new Bot('b'), c = new Bot('c');
    await Promise.all([a, b, c].map((x) => x.until(() => x.id > 0)));
    a.send({ t: 'create', mode: 'duel' }); await a.until(() => !!a.room);
    b.send({ t: 'join', code: a.room!.code }); await b.until(() => !!b.room);
    c.send({ t: 'join', code: a.room!.code }); await c.until(() => c.errors.length > 0);
    a.send({ t: 'set', settings: { trackId: 'mojave', laps: 1, aiFill: true } });
    b.send({ t: 'ready', ready: true }); await a.until(() => a.room!.players[1]?.ready === true);
    a.send({ t: 'start' });
    await Promise.all([a, b].map((x) => x.until(() => !!x.race)));
    expect(a.race!.entries.length).toBe(12);
    expect(a.race!.entries.filter((e) => !e.isAI).length).toBe(2);
    await a.until(() => a.world!.phase === 'racing', 10000);
    b.close();
    await a.until(() => a.world!.cars[b.race!.yourIdx].isAI, 5000);
    await a.until(() => a.room!.players.length === 1);
    a.close(); c.close();
  }, 30000);
});
