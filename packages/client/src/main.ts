import {
  AI_NAMES, CAR_CLASSES, CAR_COLORS, COUNTDOWN_TICKS, COUNTRIES, INTRO_TICKS, POINTS, TRACK_DEFS, aiInput, createWorld, getTrack, raceTime, skyAt, standings,
  type Difficulty, type Entry, type Input, type ResultRow, type RoomState, type ServerMsg, type Shift, type TimeOfDay, type Weather, type World,
} from '../../shared/src/index';
import { buildBackdrop } from './art/backdrops';
import { carThumb, drawShowroom } from './art/cars';
import { GameAudio } from './audio/audio';
import { RACE_SONGS, SONGS as SONG_DATA } from './audio/songs';
import { LocalSession, NetSession, type Session } from './game/session';
import { InputManager, PAD_ACTIONS, type Device, type Nav } from './input/input';
import { NetClient } from './net/client';
import { Hud, fmtTime } from './render/hud';
import { makeLook, mixLook, type Look } from './render/look';
import { Renderer, type View } from './render/renderer';
import { Menu, h, type Item, type Screen } from './ui/menu';

interface Profile { name: string; classId: number; color: number; auto: boolean }
interface Champ { round: number; difficulty: Difficulty; humans: Profile[]; names: string[]; points: number[] }

const load = <T>(k: string, d: T): T => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return d; } };
const save = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
const cyc = (v: number, n: number, d: number) => (v + d + n) % n;

const settings = load('rc_settings', {
  quality: 'high' as 'high' | 'low', crt: false,
  p: [{ name: 'Driver' + Math.floor(100 + Math.random() * 900), classId: 0, color: 0, auto: true }, { name: 'Player 2', classId: 2, color: 1, auto: true }] as Profile[],
  dev: ['', ''] as string[], song: 'auto',
});
const saveSettings = () => save('rc_settings', settings);

const input = new InputManager();
const audio = new GameAudio();
const net = new NetClient();
const menu = new Menu(document.getElementById('menu')!);
const hud = new Hud(document.getElementById('hud') as HTMLCanvasElement);
let renderer: Renderer;
try { renderer = new Renderer(document.getElementById('game') as HTMLCanvasElement); }
catch (e) { const f = document.getElementById('fatal')!; f.style.display = 'flex'; f.textContent = String((e as Error).message); throw e; }

input.onGesture = () => audio.unlock();
menu.onSound = (k) => audio.ui(k);

// ---------------------------------------------------------------- race state
let session: Session | null = null;
let look: Look = makeLook('tropical', 'day', 'clear');
let lookA = look, lookB: Look | null = null;
let views: View[] = [];
let devices: Device[] = [{ kind: 'any' }];
let racing = false, paused = false, attract = true;
let onRaceDone: ((w: World) => void) | null = null;
let doneAt = 0;
let prev: { gear: number; nitro: number; bump: number }[] = [];
let lastTick = 0;

const FULL: View[] = [{ car: 0, rect: [0, 0, 1, 1] }];
function songFor(trackId: string) {
  if (settings.song !== 'auto' && SONG_DATA[settings.song]) return settings.song;
  return (TRACK_DEFS.find((t) => t.id === trackId)?.country ?? 'usa').toLowerCase();
}

function begin(s: Session, devs: Device[], done: ((w: World) => void) | null) {
  session?.dispose();
  session = s; devices = devs; onRaceDone = done; doneAt = 0; paused = false; lastTick = 0;
  const w = s.world;
  renderer.setBackdrop(buildBackdrop(w.track.theme, w.track.country, w.track.seed, w.track.id));
  if (w.shift === 'storm' || w.shift === 'clearing') { lookA = makeLook(w.track.theme, w.time, 'clear'); lookB = makeLook(w.track.theme, w.time, 'rain'); }
  else if (w.shift === 'nightfall') { lookA = makeLook(w.track.theme, w.time, w.weather); lookB = makeLook(w.track.theme, w.time === 'day' ? 'dusk' : 'night', w.weather); }
  else { lookA = makeLook(w.track.theme, w.time, w.weather); lookB = null; }
  look = lookA;
  views = s.local.length === 2 ? [{ car: s.local[0], rect: [0, 0, 1, 0.5] }, { car: s.local[1], rect: [0, 0.5, 1, 0.5] }] : [{ car: s.local[0] ?? 0, rect: [0, 0, 1, 1] }];
  prev = s.local.map((i) => ({ gear: w.cars[i].gear, nitro: w.cars[i].nitro, bump: 0 }));
}

function startAttract() {
  const def = TRACK_DEFS[Math.floor(Math.random() * TRACK_DEFS.length)];
  const entries: Entry[] = AI_NAMES.map((name, i) => ({ name, classId: i % 4, color: i, auto: true, isAI: true }));
  const world = createWorld({ track: getTrack(def.id), laps: 99, weather: def.weather, time: def.time, difficulty: 1, entries, shift: def.shift });
  world.raceTicks = 60 * 150;
  world.tick = COUNTDOWN_TICKS - 1;
  begin(new LocalSession(world, []), [], null);
  views = [{ car: 6, rect: [0, 0, 1, 1] }];
  attract = true; racing = false;
  audio.setEngines(0); audio.play('title');
}

interface RaceCfg { trackId: string; laps: number; weather: Weather; time: TimeOfDay; shift: Shift; grid: number; difficulty: Difficulty; humans: Profile[]; aiOrder?: { name: string; classId: number; color: number }[] }
function startLocal(cfg: RaceCfg, done: (w: World, local: number[]) => void) {
  const nAI = Math.max(0, cfg.grid - cfg.humans.length);
  const used = new Set(cfg.humans.map((p) => p.color));
  const free = CAR_COLORS.map((_, i) => i).filter((i) => !used.has(i));
  const ai: Entry[] = (cfg.aiOrder ?? AI_NAMES.map((name, i) => ({ name, classId: i % 4, color: free[i % free.length] }))).slice(0, nAI)
    .map((a, i) => ({ ...a, color: used.has(a.color) ? free[i % free.length] : a.color, auto: true, isAI: true }));
  const entries = [...ai, ...cfg.humans.map((p) => ({ name: p.name, classId: p.classId, color: p.color, auto: p.auto, isAI: false }))];
  const world = createWorld({ track: getTrack(cfg.trackId), laps: cfg.laps, weather: cfg.weather, time: cfg.time, difficulty: cfg.difficulty, entries, shift: cfg.shift });
  const local = cfg.humans.map((_, i) => nAI + i);
  begin(new LocalSession(world, local), cfg.humans.length === 2 ? splitDevices() : [{ kind: 'any' }], (w) => done(w, local));
  attract = false; racing = true;
  menu.reset(); audio.setEngines(local.length); audio.play(songFor(cfg.trackId));
}

// ---------------------------------------------------------------- devices
function deviceOptions(): { id: string; label: string; dev: Device }[] {
  const o: { id: string; label: string; dev: Device }[] = [
    { id: 'wasd', label: 'Keyboard (WASD)', dev: { kind: 'kb', layout: 'wasd' } },
    { id: 'arrows', label: 'Keyboard (arrows)', dev: { kind: 'kb', layout: 'arrows' } },
  ];
  input.pads().forEach((p, i) => o.push({ id: 'pad' + i, label: `Pad ${i + 1} · ${input.padName(p)}`, dev: { kind: 'pad', index: i } }));
  return o;
}
function splitDevIds(): string[] {
  const opts = deviceOptions(), n = input.pads().length;
  const def = n >= 2 ? ['pad0', 'pad1'] : n === 1 ? ['arrows', 'pad0'] : ['wasd', 'arrows'];
  return [0, 1].map((i) => (opts.some((o) => o.id === settings.dev[i]) ? settings.dev[i] : def[i]));
}
function splitDevices(): Device[] { const o = deviceOptions(); return splitDevIds().map((id) => o.find((x) => x.id === id)!.dev); }
function devItem(i: number): Item {
  const step = (d: number) => { const o = deviceOptions(), ids = splitDevIds(); settings.dev = ids; settings.dev[i] = o[cyc(o.findIndex((x) => x.id === ids[i]), o.length, d)].id; saveSettings(); };
  return { label: `Player ${i + 1} controls`, value: () => deviceOptions().find((o) => o.id === splitDevIds()[i])!.label, left: () => step(-1), right: () => step(1) };
}

// ---------------------------------------------------------------- shared menu pieces
const COLOR_NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Orange', 'Purple', 'White', 'Black', 'Cyan', 'Pink', 'Bronze', 'Lime'];
function statBars(classId: number) {
  const c = CAR_CLASSES[classId];
  const bar = (v: number) => `<i style="width:${Math.round(Math.max(0.08, Math.min(1, v)) * 100)}%"></i>`;
  return `<div class="stat"><span>Top speed</span>${bar((c.top - 11000) / 2500)}<span>Acceleration</span>${bar((c.accel - 1300) / 800)}
    <span>Grip</span>${bar((c.grip - 0.8) / 0.35)}<span>Fuel range</span>${bar(c.tank / 2.3e6)}</div>`;
}
function carCard(p: Profile) {
  return `<div class="cars"><img src="${carThumb(p.classId, p.color)}" alt="">${statBars(p.classId)}</div>`;
}
let showP: Profile | null = null, showYaw = 2.5, showDrag = 0;
const showCanvas = document.getElementById('showcanvas') as HTMLCanvasElement;
showCanvas.addEventListener('pointermove', (e) => { if (e.buttons) { showYaw += e.movementX * 0.012; showDrag = performance.now(); } });
/** Full-screen car selection. */
function showroomScreen(p: Profile, who: string, changed: () => void): Screen {
  const done = () => { menu.pop(); if (!racing && audio.current === 'showroom') audio.play('title'); };
  if (!racing) audio.play('showroom');
  showP = p;
  const step = (f: () => void) => () => { f(); changed(); };
  return {
    title: who ? `${who} · choose your car` : 'Choose your car', wide: true, back: done,
    sub: () => `${CAR_CLASSES[p.classId].name} — ${CAR_CLASSES[p.classId].blurb}`,
    body: () => `<div id="showslot"></div>${statBars(p.classId)}`,
    items: [
      { label: 'Car', value: () => `${CAR_CLASSES[p.classId].name}  (${p.classId + 1}/4)`, left: step(() => (p.classId = cyc(p.classId, 4, -1))), right: step(() => (p.classId = cyc(p.classId, 4, 1))) },
      { label: 'Colour', value: () => COLOR_NAMES[p.color], left: step(() => (p.color = cyc(p.color, 12, -1))), right: step(() => (p.color = cyc(p.color, 12, 1))) },
      { label: 'Gearbox', value: () => (p.auto ? 'Automatic' : 'Manual'), left: step(() => (p.auto = !p.auto)), right: step(() => (p.auto = !p.auto)) },
      { label: 'Confirm', ok: done },
    ],
    focus: 0,
  };
}
function carItems(p: Profile, tag = '', changed: () => void = saveSettings): Item[] {
  return [{ label: tag + 'Car', value: () => `${CAR_CLASSES[p.classId].name} · ${COLOR_NAMES[p.color]} · ${p.auto ? 'Auto' : 'Manual'}`, ok: () => menu.push(showroomScreen(p, tag.trim(), changed)) }];
}
const DIFF = ['Easy', 'Medium', 'Hard'];
const WEATHERS: (Weather | 'default')[] = ['default', 'clear', 'rain', 'fog', 'snow'];
const TIMES: (TimeOfDay | 'default')[] = ['default', 'day', 'dusk', 'night'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function resultsTable(rows: { name: string; time: number; me: boolean; color?: number; pts?: number }[]) {
  const best = rows.find((r) => r.time > 0)?.time ?? 0;
  return `<table class="t"><tr><th>#</th><th>Driver</th><th class="r">Time</th>${rows[0]?.pts !== undefined ? '<th class="r">Pts</th>' : ''}</tr>` + rows.map((r, i) =>
    `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${r.color !== undefined ? `<span class="dot" style="background:${CAR_COLORS[r.color]}"></span>` : ''}${h(r.name)}</td><td class="r">${r.time > 0 ? (i === 0 ? fmtTime(r.time) : '+' + (r.time - best).toFixed(2)) : '—'}</td>${r.pts !== undefined ? `<td class="r">${r.pts}</td>` : ''}</tr>`).join('') + '</table>';
}
function message(title: string, text: string, then: () => void) {
  menu.push({ title, body: () => `<p>${h(text)}</p>`, items: [{ label: 'OK', ok: then }], back: then });
}

// ---------------------------------------------------------------- menus
function titleScreen(): Screen {
  return {
    title: 'Redline Circuit', sub: () => `Arcade racing · ${TRACK_DEFS.length} tracks · ${COUNTRIES.length} countries`,
    items: [
      { label: 'Single race', ok: () => menu.push(setupScreen(1)) },
      { label: 'World tour', ok: () => menu.push(champScreen()) },
      { label: 'Split-screen (2 players)', ok: () => menu.push(setupScreen(2)) },
      { label: 'Online multiplayer', ok: () => openOnline() },
      { label: 'Options', ok: () => menu.push(optionsScreen()) },
    ],
  };
}
function toTitle() { net.close(); menu.reset(titleScreen()); startAttract(); }

const setup = load('rc_setup', { track: 0, laps: 0, weather: 0, time: 0, grid: 12, difficulty: 1 as Difficulty });
function setupScreen(players: number): Screen {
  const def = () => TRACK_DEFS[setup.track % TRACK_DEFS.length];
  const sv = () => save('rc_setup', setup);
  const grids = [2, 4, 6, 8, 12];
  const items: Item[] = [
    { label: 'Track', value: () => `${def().name} · ${def().country}`, left: () => { setup.track = cyc(setup.track, TRACK_DEFS.length, -1); sv(); }, right: () => { setup.track = cyc(setup.track, TRACK_DEFS.length, 1); sv(); } },
    { label: 'Laps', value: () => (setup.laps ? String(setup.laps) : `${def().laps} (default)`), left: () => { setup.laps = cyc(setup.laps, 10, -1); sv(); }, right: () => { setup.laps = cyc(setup.laps, 10, 1); sv(); } },
    { label: 'Weather', value: () => (setup.weather ? cap(WEATHERS[setup.weather]) : `${cap(def().weather)}${({ storm: ' → storm', clearing: ' → clearing', nightfall: '', none: '' } as Record<string, string>)[def().shift]} (default)`), left: () => { setup.weather = cyc(setup.weather, 5, -1); sv(); }, right: () => { setup.weather = cyc(setup.weather, 5, 1); sv(); } },
    { label: 'Time of day', value: () => (setup.time ? cap(TIMES[setup.time]) : `${cap(def().time)}${def().shift === 'nightfall' ? ' → night' : ''} (default)`), left: () => { setup.time = cyc(setup.time, 4, -1); sv(); }, right: () => { setup.time = cyc(setup.time, 4, 1); sv(); } },
    { label: 'Grid', value: () => (setup.grid === 2 ? 'Duel · 1 vs 1' : setup.grid === 12 ? 'Full grid · 12 cars' : setup.grid + ' cars'), left: () => { setup.grid = grids[cyc(grids.indexOf(setup.grid), grids.length, -1)]; sv(); }, right: () => { setup.grid = grids[cyc(grids.indexOf(setup.grid), grids.length, 1)]; sv(); } },
    { label: 'AI difficulty', value: () => DIFF[setup.difficulty], left: () => { setup.difficulty = cyc(setup.difficulty, 3, -1) as Difficulty; sv(); }, right: () => { setup.difficulty = cyc(setup.difficulty, 3, 1) as Difficulty; sv(); } },
    ...carItems(settings.p[0], players === 2 ? 'P1 ' : ''),
    ...(players === 2 ? [...carItems(settings.p[1], 'P2 '), devItem(0), devItem(1)] : []),
    { label: 'Start race', ok: () => go() },
  ];
  const go = () => {
    const d = def();
    const cfg: RaceCfg = {
      trackId: d.id, laps: setup.laps || d.laps, weather: setup.weather ? (WEATHERS[setup.weather] as Weather) : d.weather, time: setup.time ? (TIMES[setup.time] as TimeOfDay) : d.time,
      shift: setup.weather || setup.time ? 'none' : d.shift,
      grid: Math.max(setup.grid, players), difficulty: setup.difficulty, humans: settings.p.slice(0, players).map((p, i) => ({ ...p, name: players === 2 ? 'Player ' + (i + 1) : p.name })),
    };
    startLocal(cfg, (w, local) => {
      const rows = standings(w).map((i) => ({ name: w.cars[i].name, time: raceTime(w.cars[i]), me: local.includes(i), color: w.cars[i].color }));
      audio.play('results'); startAttract(); audio.play('results');
      menu.reset(titleScreen()); menu.push(setupScreen(players));
      menu.push({ title: 'Results', sub: () => d.name, body: () => resultsTable(rows), items: [{ label: 'Race again', ok: () => go() }, { label: 'Back', ok: () => { menu.pop(); audio.play('title'); } }], back: () => { menu.pop(); audio.play('title'); } });
    });
  };
  return { title: players === 2 ? 'Split-screen' : 'Single race', body: () => carCard(settings.p[0]) + (players === 2 ? carCard(settings.p[1]) : ''), items, focus: items.length - 1, back: () => menu.pop() };
}

function optionsScreen(): Screen {
  const vol = (get: () => number, set: (v: number) => void): Pick<Item, 'value' | 'left' | 'right'> => ({
    value: () => Math.round(get() * 100) + '%', left: () => { set(Math.max(0, get() - 0.1)); audio.saveVol(); }, right: () => { set(Math.min(1, get() + 0.1)); audio.saveVol(); },
  });
  const list = ['auto', ...RACE_SONGS];
  const juke = (d: number) => { settings.song = list[cyc(Math.max(0, list.indexOf(settings.song)), list.length, d)]; saveSettings(); if (!racing) audio.play(settings.song === 'auto' ? 'title' : settings.song); };
  const leave = () => { menu.pop(); if (!racing) audio.play('title'); };
  const tq = () => { settings.quality = settings.quality === 'high' ? 'low' : 'high'; saveSettings(); };
  const tc = () => { settings.crt = !settings.crt; saveSettings(); };
  return {
    title: 'Options', back: leave,
    items: [
      { label: 'Music volume', ...vol(() => audio.musicVol, (v) => (audio.musicVol = v)) },
      { label: 'Effects volume', ...vol(() => audio.sfxVol, (v) => (audio.sfxVol = v)) },
      { label: 'Race music', value: () => (settings.song === 'auto' ? 'Auto (by country)' : SONG_DATA[settings.song].title), left: () => juke(-1), right: () => juke(1) },
      { label: 'Graphics', value: () => (settings.quality === 'high' ? 'High (bloom, full resolution)' : 'Low (faster)'), left: tq, right: tq },
      { label: 'CRT scanlines', value: () => (settings.crt ? 'On' : 'Off'), left: tc, right: tc },
      { label: 'Fullscreen', ok: () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); } },
      { label: 'Controller buttons', ok: () => menu.push(bindScreen()) },
      { label: 'Back', ok: leave },
    ],
  };
}
function bindScreen(): Screen {
  let waiting = '';
  return {
    title: 'Controller', back: () => menu.pop(),
    sub: () => (waiting ? `Press a button for “${waiting}”…` : input.pads().length ? `${input.pads().map((p) => input.padName(p)).join(', ')} · steer with left stick or D-pad` : 'No controller detected — press any button on it to wake it up'),
    body: () => '<p>Keyboard: arrows or WASD to drive · Space nitro · Z/X shift · Esc pause.<br>Split-screen keyboards: WASD + Left Shift + Q/E, and arrows + Right Shift + , .</p>',
    items: [
      ...PAD_ACTIONS.map((a): Item => ({
        label: a.label, value: () => input.glyph(input.bind[a.id]),
        ok: () => { waiting = a.label; input.captureButton((b) => { input.bind[a.id] = b; input.saveBind(); waiting = ''; menu.render(); }); },
      })),
      { label: 'Reset to defaults', ok: () => input.resetBind() },
      { label: 'Back', ok: () => menu.pop() },
    ],
  };
}

// ---------------------------------------------------------------- world tour
const NR = TRACK_DEFS.length;
const b36 = (n: number, len: number) => Math.max(0, Math.round(n)).toString(36).toUpperCase().padStart(len, '0');
/** Compact resume code: round, difficulty, players and the twelve point totals, with a check character. */
function tourCode(c: Champ) {
  const body = b36(c.round, 2) + c.difficulty + c.humans.length + c.points.map((p) => b36(p, 2)).join('');
  let sum = 0; for (const ch of body) sum = (sum * 31 + ch.charCodeAt(0)) % 36;
  return body + sum.toString(36).toUpperCase();
}
function parseTourCode(code: string): Champ | null {
  const t = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (t.length !== 29) return null;
  const body = t.slice(0, 28); let sum = 0; for (const ch of body) sum = (sum * 31 + ch.charCodeAt(0)) % 36;
  if (sum.toString(36).toUpperCase() !== t[28]) return null;
  const round = parseInt(body.slice(0, 2), 36), difficulty = Number(body[2]), nh = Number(body[3]);
  if (!(round >= 0 && round <= NR) || ![0, 1, 2].includes(difficulty) || ![1, 2].includes(nh)) return null;
  const points = Array.from({ length: 12 }, (_, i) => parseInt(body.slice(4 + i * 2, 6 + i * 2), 36));
  const humans = settings.p.slice(0, nh).map((p, i) => ({ ...p, name: nh === 2 ? 'Player ' + (i + 1) : p.name }));
  return { round, difficulty: difficulty as Difficulty, humans, names: [...humans.map((p) => p.name), ...AI_NAMES.slice(0, 12 - nh)], points };
}
function champScreen(): Screen {
  const saved = (): Champ | null => { try { return JSON.parse(localStorage.getItem('rc_champ') || 'null'); } catch { return null; } };
  const cfg = { players: 1, difficulty: 1 as Difficulty };
  let code = '';
  const start = () => {
    const humans = settings.p.slice(0, cfg.players).map((p, i) => ({ ...p, name: cfg.players === 2 ? 'Player ' + (i + 1) : p.name }));
    const c: Champ = { round: 0, difficulty: cfg.difficulty, humans, names: [...humans.map((p) => p.name), ...AI_NAMES.slice(0, 12 - humans.length)], points: new Array(12).fill(0) };
    save('rc_champ', c); menu.push(champHub(c));
  };
  return {
    title: 'World tour', sub: () => `${NR} races · ${COUNTRIES.join(' · ')}`, back: () => menu.pop(),
    body: () => carCard(settings.p[0]) + (cfg.players === 2 ? carCard(settings.p[1]) : ''),
    items: [
      { label: () => { const s = saved(); return s ? `Continue · race ${Math.min(NR, s.round + 1)} of ${NR}` : 'Continue'; }, hidden: () => !saved(), ok: () => menu.push(champHub(saved()!)) },
      { label: 'Players', value: () => (cfg.players === 1 ? '1 player' : '2 players (split-screen)'), left: () => (cfg.players = 3 - cfg.players), right: () => (cfg.players = 3 - cfg.players) },
      { label: 'AI difficulty', value: () => DIFF[cfg.difficulty], left: () => (cfg.difficulty = cyc(cfg.difficulty, 3, -1) as Difficulty), right: () => (cfg.difficulty = cyc(cfg.difficulty, 3, 1) as Difficulty) },
      ...carItems(settings.p[0], 'P1 '),
      ...carItems(settings.p[1], 'P2 ').map((i) => ({ ...i, hidden: () => cfg.players === 1 })),
      { ...devItem(0), hidden: () => cfg.players === 1 }, { ...devItem(1), hidden: () => cfg.players === 1 },
      { label: 'New world tour', ok: start },
      { label: 'Tour code', text: { get: () => code, set: (v) => (code = v), max: 34, upper: true } },
      { label: 'Resume from code', ok: () => { const c = parseTourCode(code); if (c) { save('rc_champ', c); menu.push(champHub(c)); } else message('World tour', 'That code is not valid.', () => menu.pop()); } },
    ],
  };
}
function champHub(c: Champ): Screen {
  const nh = c.humans.length, over = c.round >= NR;
  const ranked = () => c.names.map((_, i) => i).sort((a, b) => c.points[b] - c.points[a] || a - b);
  const table = () => `<table class="t"><tr><th>#</th><th>Driver</th><th class="r">Points</th></tr>${ranked().map((id, i) => `<tr class="${id < nh ? 'me' : ''}"><td>${i + 1}</td><td>${h(c.names[id])}</td><td class="r">${c.points[id]}</td></tr>`).join('')}</table>`;
  const stops = () => `<div class="tour">${COUNTRIES.map((n, i) => `<span class="${Math.floor(Math.min(c.round, NR - 1) / 4) === i && !over ? 'on' : c.round >= (i + 1) * 4 ? 'done' : ''}">${n}</span>`).join('')}</div>`;
  const race = () => {
    const d = TRACK_DEFS[c.round];
    const aiIds = c.names.map((_, i) => i).filter((i) => i >= nh).sort((a, b) => c.points[b] - c.points[a] || a - b);
    const drivers = [...aiIds, ...c.humans.map((_, i) => i)]; // car idx -> driver id
    startLocal({
      trackId: d.id, laps: d.laps, weather: d.weather, time: d.time, shift: d.shift, grid: 12, difficulty: c.difficulty, humans: c.humans,
      aiOrder: aiIds.map((id) => ({ name: c.names[id], classId: id % 4, color: id })),
    }, (w, local) => {
      const order = standings(w);
      const rows = order.map((idx, pos) => { c.points[drivers[idx]] += POINTS[pos]; return { name: w.cars[idx].name, time: raceTime(w.cars[idx]), me: local.includes(idx), color: w.cars[idx].color, pts: POINTS[pos] }; });
      c.round++; save('rc_champ', c);
      startAttract(); audio.play('results');
      menu.reset(titleScreen()); menu.push(champHub(c));
      if (c.round % 4 === 0 && c.round < NR) {
        const lead = c.names[ranked()[0]];
        menu.push({ title: `${d.country} complete`, sub: () => `${lead} leads the tour · next stop: ${TRACK_DEFS[c.round].country}`, body: table, items: [{ label: 'Continue', ok: () => menu.pop() }], back: () => menu.pop() });
      }
      menu.push({ title: 'Race results', sub: () => `${d.name} · ${d.country}`, body: () => resultsTable(rows), items: [{ label: 'Continue', ok: () => menu.pop() }], back: () => menu.pop() });
    });
  };
  const d = TRACK_DEFS[Math.min(c.round, NR - 1)];
  const quit = () => { menu.reset(titleScreen()); audio.play('title'); };
  return {
    title: over ? 'Tour champion!' : `${d.country} · race ${(c.round % 4) + 1} of 4`,
    sub: () => (over ? `${c.names[ranked()[0]]} wins the world tour` : `Race ${c.round + 1} of ${NR}: ${d.name} · ${d.laps} laps · ${cap(d.weather)} ${d.time}${d.shift !== 'none' ? ' · changing sky' : ''}`),
    body: () => stops() + table() + (over ? '' : `<p class="tcode">Resume code: <b>${tourCode(c)}</b></p>`), back: quit,
    items: over
      ? [{ label: 'Finish', ok: () => { localStorage.removeItem('rc_champ'); quit(); } }]
      : [{ label: 'Start race', ok: race }, { label: 'Save and quit', ok: quit }],
  };
}

// ---------------------------------------------------------------- online
let room: RoomState | null = null;
let roomList: { code: string; mode: string; players: number; max: number; racing: boolean; trackId: string }[] = [];
let joinCode = '';
let netSession: NetSession | null = null;

async function openOnline() {
  if (!net.connected) {
    try { await net.connect(settings.p[0].name); }
    catch (e) { message('Online', (e as Error).message + '. Start it with “npm run dev” or “npm start”.', () => menu.pop()); return; }
  }
  net.send({ t: 'list' });
  menu.push(onlineScreen());
}
function onlineScreen(): Screen {
  const me = settings.p[0];
  return {
    title: 'Online', sub: () => `Connected · ${net.ping} ms`, back: () => { net.close(); menu.pop(); },
    items: [
      { label: 'Your name', text: { get: () => me.name, set: (v) => { me.name = v.trim().slice(0, 14) || 'Driver'; saveSettings(); net.send({ t: 'hello', name: me.name }); }, max: 14 } },
      { label: 'Create full-grid room (up to 12)', ok: () => net.send({ t: 'create', mode: 'grid' }) },
      { label: 'Create 1 vs 1 duel room', ok: () => net.send({ t: 'create', mode: 'duel' }) },
      { label: 'Room code', text: { get: () => joinCode, set: (v) => (joinCode = v.toUpperCase().slice(0, 4)), max: 4, upper: true } },
      { label: 'Join by code', ok: () => { if (joinCode.length === 4) net.send({ t: 'join', code: joinCode }); } },
      { label: 'Refresh room list', ok: () => net.send({ t: 'list' }) },
      ...roomList.map((r): Item => ({ label: `Join ${r.code} · ${r.mode === 'duel' ? '1 vs 1' : 'Grid'} · ${TRACK_DEFS.find((t) => t.id === r.trackId)?.name ?? ''}`, value: () => `${r.players}/${r.max}${r.racing ? ' · racing' : ''}`, ok: () => net.send({ t: 'join', code: r.code }) })),
    ],
  };
}
function lobbyScreen(): Screen {
  const r = room!, me = settings.p[0], host = r.hostId === net.id, s = r.settings;
  const mine = r.players.find((p) => p.id === net.id);
  const sendCar = () => { saveSettings(); net.send({ t: 'car', classId: me.classId, color: me.color, auto: me.auto }); };
  const set = (p: Partial<RoomState['settings']>) => net.send({ t: 'set', settings: p });
  const ti = TRACK_DEFS.findIndex((t) => t.id === s.trackId), def = TRACK_DEFS[ti];
  const hostOnly = (it: Item): Item => (host ? it : { label: it.label, value: it.value });
  const leave = () => { net.send({ t: 'leave' }); };
  return {
    title: s.mode === 'duel' ? '1 vs 1 duel' : 'Grid room', back: leave,
    sub: () => (r.racing ? 'Race in progress — you join the next one' : host ? 'You are the host' : 'Waiting for the host to start'),
    body: () => `<div class="code">${h(r.code)}</div><table class="t">${r.players.map((p) => `<tr class="${p.id === net.id ? 'me' : ''}"><td><span class="dot" style="background:${CAR_COLORS[p.color]}"></span>${h(p.name)}${p.id === r.hostId ? ' ★' : ''}</td><td>${CAR_CLASSES[p.classId].name}</td><td class="r">${p.ready ? 'READY' : '…'}</td></tr>`).join('')}</table>`,
    items: [
      { label: () => (mine?.ready ? 'Not ready' : 'Ready'), ok: () => net.send({ t: 'ready', ready: !mine?.ready }) },
      { label: 'Start race', hidden: () => !host || r.racing, ok: () => net.send({ t: 'start' }) },
      ...carItems(me, '', sendCar),
      hostOnly({ label: 'Track', value: () => `${def.name} · ${def.country}`, left: () => set({ trackId: TRACK_DEFS[cyc(ti, TRACK_DEFS.length, -1)].id, laps: TRACK_DEFS[cyc(ti, TRACK_DEFS.length, -1)].laps }), right: () => set({ trackId: TRACK_DEFS[cyc(ti, TRACK_DEFS.length, 1)].id, laps: TRACK_DEFS[cyc(ti, TRACK_DEFS.length, 1)].laps }) }),
      hostOnly({ label: 'Laps', value: () => String(s.laps), left: () => set({ laps: Math.max(1, s.laps - 1) }), right: () => set({ laps: Math.min(9, s.laps + 1) }) }),
      hostOnly({ label: 'Weather', value: () => (s.weather === 'default' ? `${cap(def.weather)} (default)` : cap(s.weather)), left: () => set({ weather: WEATHERS[cyc(WEATHERS.indexOf(s.weather), 5, -1)] }), right: () => set({ weather: WEATHERS[cyc(WEATHERS.indexOf(s.weather), 5, 1)] }) }),
      hostOnly({ label: 'Time of day', value: () => (s.time === 'default' ? `${cap(def.time)} (default)` : cap(s.time)), left: () => set({ time: TIMES[cyc(TIMES.indexOf(s.time), 4, -1)] }), right: () => set({ time: TIMES[cyc(TIMES.indexOf(s.time), 4, 1)] }) }),
      hostOnly({ label: 'AI cars', value: () => (s.aiFill ? (s.mode === 'duel' ? 'Traffic (fill to 12)' : 'Fill grid to 12') : 'None — humans only'), left: () => set({ aiFill: !s.aiFill }), right: () => set({ aiFill: !s.aiFill }) }),
      hostOnly({ label: 'AI difficulty', value: () => DIFF[s.difficulty], left: () => set({ difficulty: cyc(s.difficulty, 3, -1) as Difficulty }), right: () => set({ difficulty: cyc(s.difficulty, 3, 1) as Difficulty }) }),
      { label: 'Leave room', ok: leave },
    ],
  };
}
const inLobby = () => menu.top?.title === 'Grid room' || menu.top?.title === '1 vs 1 duel';
const inOnline = () => menu.top?.title === 'Online';

net.onMsg = (m: ServerMsg) => {
  if (m.t === 'rooms') { roomList = m.rooms; if (inOnline()) menu.replaceTop(onlineScreen()); }
  else if (m.t === 'room') {
    room = m.room;
    if (inLobby()) menu.replaceTop(lobbyScreen());
    else if (inOnline()) { const me = settings.p[0]; net.send({ t: 'car', classId: me.classId, color: me.color, auto: me.auto }); menu.push(lobbyScreen()); }
  } else if (m.t === 'left') { room = null; if (inLobby()) menu.pop(); net.send({ t: 'list' }); }
  else if (m.t === 'error') message('Online', m.msg, () => menu.pop());
  else if (m.t === 'race') {
    netSession = new NetSession(m.race, (b) => net.sendBinary(b));
    begin(netSession, [{ kind: 'any' }], null);
    attract = false; racing = true; menu.reset();
    audio.setEngines(1); audio.play(songFor(m.race.trackId));
  } else if (m.t === 'results') showOnlineResults(m.rows);
};
net.onBinary = (b) => netSession?.onMessage(b);
net.onClose = () => {
  room = null; netSession = null;
  if (racing && session?.online) { startAttract(); menu.reset(titleScreen()); message('Online', 'Connection to the server was lost.', () => menu.pop()); }
  else if (inLobby() || inOnline()) { menu.reset(titleScreen()); message('Online', 'Connection to the server was lost.', () => menu.pop()); }
};
function showOnlineResults(rows: ResultRow[]) {
  const myIdx = netSession?.local[0];
  const w = session?.world;
  netSession = null; startAttract(); audio.play('results');
  menu.reset(titleScreen()); menu.push(onlineScreen());
  if (room) menu.push(lobbyScreen());
  const done = () => { menu.pop(); audio.play('title'); };
  menu.push({ title: 'Results', body: () => resultsTable(rows.map((r) => ({ name: r.name, time: r.time, me: r.idx === myIdx, color: w?.cars[r.idx]?.color }))), items: [{ label: 'Continue', ok: done }], back: done });
}

// ---------------------------------------------------------------- pause
function pauseScreen(): Screen {
  const online = !!session?.online;
  const resume = () => { paused = false; menu.reset(); };
  const quit = () => {
    paused = false;
    if (online) { net.send({ t: 'leave' }); netSession = null; room = null; startAttract(); menu.reset(titleScreen()); menu.push(onlineScreen()); }
    else { startAttract(); menu.reset(titleScreen()); }
  };
  return {
    title: online ? 'Menu' : 'Paused', sub: () => (online ? 'The race keeps running' : ''), back: resume,
    items: [{ label: 'Resume', ok: resume }, { label: 'Options', ok: () => menu.push(optionsScreen()) }, { label: online ? 'Leave race' : 'Quit race', ok: quit }],
  };
}

// ---------------------------------------------------------------- main loop
function hintText() {
  const p = input.pads()[0];
  return p ? `<span><kbd>${input.glyph(0, p)}</kbd> select</span><span><kbd>${input.glyph(1, p)}</kbd> back</span><span><kbd>D-pad</kbd> navigate / change</span>`
    : '<span><kbd>↑↓</kbd> navigate</span><span><kbd>←→</kbd> change</span><span><kbd>Enter</kbd> select</span><span><kbd>Esc</kbd> back</span>';
}
const autopilot = new URLSearchParams(location.search).has('autopilot'); // dev/demo: AI drives the local cars
const padtest = new URLSearchParams(location.search).has('padtest') ? document.getElementById('padtest')! : null;
if (padtest) padtest.style.display = 'block';

const NONE: Input = { steer: 0, throttle: 0, brake: 0, nitro: false, up: false, down: false };
let last = performance.now() / 1000, padCount = -1;

function raceEvents(w: World) {
  if (w.phase === 'countdown') {
    for (const t of [60, 120, 180]) if (lastTick < INTRO_TICKS + t && w.tick >= INTRO_TICKS + t) audio.beep(440, 0.18, 0.3);
  }
  if (lastTick < COUNTDOWN_TICKS && w.tick >= COUNTDOWN_TICKS && lastTick > 0) audio.beep(880, 0.5, 0.35);
  lastTick = w.tick;
  session!.local.forEach((idx, i) => {
    const c = w.cars[idx], p = prev[i], dev = devices[i] ?? { kind: 'any' };
    if (c.gear !== p.gear) audio.shift();
    if (c.nitro < p.nitro) { audio.nitro(); input.rumble(dev, 0.5, 1, 500); }
    if (c.bump > p.bump + 0.05) { audio.bump(); input.rumble(dev, 1, 0.6, 220); }
    else if (c.offroad && c.speed > 1500 && Math.random() < 0.1) input.rumble(dev, 0.25, 0.5, 120);
    p.gear = c.gear; p.nitro = c.nitro; p.bump = c.bump;
    const seg = w.track.segments[Math.floor(c.z / 200) % w.track.segments.length];
    const sp = c.speed / CAR_CLASSES[c.classId].top;
    const skid = c.offroad && c.speed > 1000 ? 0.7 : Math.abs(c.steer) > 0.8 && sp > 0.75 && Math.abs(seg.curve) > 3 ? 0.5 : 0;
    audio.updateEngine(i, c.rpm, w.phase === 'done' || c.finished ? 0.2 : Math.min(1, 0.3 + sp), paused ? 0 : skid, c.nitroT > 0);
  });
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000, dt = Math.min(0.1, now - last); last = now;
  const navs: Nav[] = input.poll(now);
  if (navs.length) audio.unlock();
  const pc = input.pads().length;
  if (pc !== padCount || menu.hint === '') { padCount = pc; menu.hint = hintText(); if (menu.open) menu.render(); }
  for (const n of navs) {
    if (menu.open) menu.nav(n === 'pause' ? 'back' : n);
    else if (racing && (n === 'pause' || n === 'back')) { paused = !session?.online; menu.push(pauseScreen()); }
  }
  // live 3D car in the showroom
  const slot = menu.top?.title.endsWith('choose your car') || menu.top?.title === 'Choose your car' ? document.getElementById('showslot') : null;
  if (slot && showP) {
    const r = slot.getBoundingClientRect();
    Object.assign(showCanvas.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    if (performance.now() - showDrag > 1500) showYaw += dt * 0.45;
    drawShowroom(showCanvas, showP.classId, showP.color, showYaw);
  } else if (showCanvas.style.display !== 'none') showCanvas.style.display = 'none';
  if (padtest) padtest.textContent = input.pads().map((p) => `${p.index}: ${p.id}\n axes ${p.axes.map((a) => a.toFixed(2)).join(' ')}\n btns ${p.buttons.map((b, i) => (b.value > 0.05 ? i + ':' + b.value.toFixed(1) : '')).filter(Boolean).join(' ')}`).join('\n') || 'no gamepad';

  if (session) {
    const w = session.world;
    if (!paused) {
      const idle = menu.open && racing;
      session.update(dt, session.local.map((idx, i) => (idle ? NONE : autopilot ? aiInput(w, idx) : input.read(devices[i] ?? { kind: 'any' }))));
      if (racing) raceEvents(w);
    } else session.local.forEach((_, i) => audio.updateEngine(i, 0.1, 0, 0, false));
    if (lookB) { const sk = skyAt(w); look = mixLook(lookA, lookB, w.shift === 'nightfall' ? sk.night : sk.rain); }
    const ik = racing && w.phase === 'countdown' ? Math.min(1, w.tick / (INTRO_TICKS - 20)) : 1;
    renderer.render(w, views.length ? views : FULL, look, now, { bloom: settings.quality === 'high', crt: settings.crt, scale: settings.quality === 'high' ? 1 : 0.7, intro: ik * ik * (3 - 2 * ik) });
    if (racing) hud.draw(w, views, now, { ping: session.online ? net.ping : undefined, names: true }); else hud.clear();
    if (racing && w.phase === 'done' && onRaceDone) {
      if (!doneAt) doneAt = now + 2.5;
      else if (now > doneAt) { const cb = onRaceDone; onRaceDone = null; racing = false; cb(w); }
    }
    if (attract && w.cars.every((c) => c.finished)) startAttract();
  }
}

menu.hint = hintText();
menu.reset(titleScreen());
startAttract();
requestAnimationFrame(frame);
// debugging / automated tests
(window as any).__rc = { get session() { return session; }, get racing() { return racing; }, menu, settings, audio };
