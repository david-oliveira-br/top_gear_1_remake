import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { NO_INPUT, decodeInput, type ClientMsg } from '../../shared/src/index';
import { Room, sendTo, type Player } from './room';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

export function startServer(port: number) {
  const rooms = new Map<string, Room>();
  const players = new Set<Player>();
  let nextId = 1;

  const http = createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: players.size })); return; }
    let file = normalize(join(DIST, url === '/' ? 'index.html' : url));
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) file = join(DIST, 'index.html');
    if (!existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Client is not built yet. Run "npm run build", or use "npm run dev" and open http://localhost:5173'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 4096 });
  const newCode = () => { let c = ''; do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join(''); } while (rooms.has(c)); return c; };
  const list = () => [...rooms.values()].map((r) => ({ code: r.code, mode: r.settings.mode, players: r.players.length, max: r.max, racing: r.racing, trackId: r.settings.trackId }));
  const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

  wss.on('connection', (ws) => {
    const p: Player = { id: nextId++, ws, name: 'Driver', classId: 0, color: 0, auto: true, ready: false, room: null, carIdx: -1, queue: [], last: NO_INPUT, ack: 0 };
    players.add(p);
    let welcomed = false;
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const b = data as Buffer;
        const d = decodeInput(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
        if (d && p.room) p.room.input(p, d.seq, d.input);
        return;
      }
      let m: ClientMsg;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (!m || typeof m !== 'object') return;
      switch (m.t) {
        case 'hello': p.name = clean(m.name, 14) || 'Driver'; if (!welcomed) { welcomed = true; sendTo(p, { t: 'welcome', id: p.id }); } p.room?.broadcast(); break;
        case 'ping': sendTo(p, { t: 'pong', c: Number(m.c) || 0 }); break;
        case 'list': sendTo(p, { t: 'rooms', rooms: list() }); break;
        case 'create': {
          if (p.room) break;
          if (rooms.size >= 200) { sendTo(p, { t: 'error', msg: 'The server is full' }); break; }
          const r = new Room(newCode(), m.mode === 'duel' ? 'duel' : 'grid', (room) => rooms.delete(room.code));
          rooms.set(r.code, r); r.add(p);
          break;
        }
        case 'join': {
          if (p.room) break;
          const r = rooms.get(clean(m.code, 4).toUpperCase());
          const err = r ? r.add(p) : 'No room with that code';
          if (err) sendTo(p, { t: 'error', msg: err });
          break;
        }
        case 'leave': if (p.room) { p.room.remove(p); sendTo(p, { t: 'left' }); } break;
        case 'set': if (p.room && m.settings && typeof m.settings === 'object') p.room.set(p, m.settings); break;
        case 'car':
          p.classId = [0, 1, 2, 3].includes(m.classId) ? m.classId : 0; p.auto = !!m.auto;
          if (Number.isInteger(m.color) && m.color >= 0 && m.color < 12 && !p.room?.players.some((o) => o !== p && o.color === m.color)) p.color = m.color;
          p.room?.broadcast(); break;
        case 'ready': p.ready = !!m.ready; p.room?.broadcast(); break;
        case 'start': { const err = p.room?.start(p); if (err) sendTo(p, { t: 'error', msg: err }); break; }
      }
    });
    ws.on('close', () => { players.delete(p); p.room?.remove(p); });
    ws.on('error', () => ws.close());
  });

  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    http.listen(port, () => {
      const actual = (http.address() as { port: number }).port;
      resolve({ port: actual, close: () => new Promise<void>((r) => { for (const c of wss.clients) c.terminate(); wss.close(); http.close(() => r()); }) });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT) || 8787;
  startServer(port).then((s) => console.log(`Redline Circuit server on http://localhost:${s.port}`));
}
