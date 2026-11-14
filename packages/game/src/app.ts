import * as THREE from 'three/webgpu';
import { CARS, CITIES, EVENTS, FINISH_BEFORE_END, MAX_LEVEL, PART_IDS, RIO, TRACKS, buildSpec, buildTrack, buyPart, canBuy, cityDone, cityOpen, dyno, eventOpen, medal, pointAt, priceOf, ratings, settle,
  WEATHER, allowedWeather, pickWeather, carById, carStats, isCarId, playerSpec, rivalCars, rivalSpec, setupOf, type CarId, type WeatherKind, type Career, type City, type Entrant, type PartId, type RaceEvent, type Track } from '../../sim/src/index';
import { GameAudio } from './audio/audio';
import { CUSTOM, Radio, STATIONS } from './audio/radio';
import { carKit, isHeavy, kindOf, preloadCars } from './car/glb';
import { CarVisual, FINISHES, PAINTS, WHEELS } from './car/visual';
import { Engine, QUALITIES } from './gfx/engine';
import { Globe } from './globe';
import { Controls } from './input';
import { CAM_CYCLE, CAM_NAMES, Session, type CamMode, type Look } from './race/session';
import { type Settings, loadCareer, loadSettings, saveCareer, saveSettings } from './save';
import { clock, h, money } from './ui/dom';
import { makeCoast } from './world/coast';
import { makeRio } from './world/rio';
import { makeRockies } from './world/rockies';
import { makePatagonia } from './world/patagonia';
import type { World } from './world/base';

const PART_INFO: Record<PartId, [string, string]> = {
  engine: ['Motor', 'Mais torque e giro'], turbo: ['Turbo', 'Pressão extra em alta rotação'], gearbox: ['Câmbio', 'Trocas rápidas, marchas próximas'],
  tyres: ['Pneus', 'Aderência em curva e na largada'], suspension: ['Suspensão', 'Carro mais baixo e estável'], brakes: ['Freios', 'Frenagens mais curtas'],
  weight: ['Alívio de peso', 'Menos massa em tudo'], aero: ['Aerodinâmica', 'Pressão para curvas rápidas'], nitro: ['Nitro', 'Mais potência e tanque maior'],
};
const KIND: Record<string, string> = { grid: 'Corrida', duel: 'Duelo', trial: 'Contra o relógio', rival: 'Rival' };
type Screen = 'title' | 'map' | 'garage' | 'race' | 'results' | 'options' | 'loading' | 'cars';
const WX_ICON: Record<WeatherKind, string> = { clear: '☀️', overcast: '☁️', rain: '🌧️', storm: '⛈️', fog: '🌫️', snow: '❄️' };
const CAR_CREDIT: Record<CarId, string> = {
  aurora: 'Modelo "Car Concept" de Eric Chadwick (Khronos), CC BY 4.0.',
  corvette: 'Modelo de amogusstrikesback2 (Sketchfab), CC BY 4.0.', cuda: 'Modelo de amogusstrikesback2 (Sketchfab), CC BY 4.0.', mustang: 'Modelo de amogusstrikesback2 (Sketchfab), CC BY 4.0.',
  golf: 'Modelo de OUTPISTON (Sketchfab), CC BY-NC-SA 4.0.', m635: 'Modelo de OUTPISTON (Sketchfab), CC BY-NC-SA 4.0.', alfa155: 'Modelo de OUTPISTON (Sketchfab), CC BY-NC-SA 4.0.',
};
const PLACE_NAME: Record<string, string> = { rio: 'O RIO', coast: 'A COSTA DO PACÍFICO', rockies: 'AS MONTANHAS ROCHOSAS', patagonia: 'A PATAGÔNIA' };
const MAKE: Record<string, (eng: Engine, track: Track) => World> = { rio: makeRio, coast: makeCoast, rockies: makeRockies, patagonia: makePatagonia };
/** Soundtrack of each region's races. */
const RACE_SONG: Record<string, string> = { rio: 'brazil', coast: 'usa', rockies: 'canada', patagonia: 'andes' };

export class App {
  eng: Engine; world!: World; rioTrack: Track = buildTrack(RIO); track: Track = this.rioTrack; curId = 'rio'; private worlds = new Map<string, { world: World; track: Track }>();
   globe!: Globe; audio = new GameAudio(); radio = new Radio(); controls = new Controls();
  career: Career = loadCareer(); settings = loadSettings(); ui = document.getElementById('ui')!;
  screen: Screen = 'title'; show!: CarVisual; session: Session | null = null; event: RaceEvent | null = null;
  private orbit = 2.2; private orbitAuto = true; private drag = false; private paused = false; private photo = false; private endTimer = 0; private hud: Record<string, HTMLElement> = {};
  private labels = new Map<string, HTMLElement>(); private map!: CanvasRenderingContext2D; private mapPath: [number, number][] = []; private lastBeep = 9; private bestSeen = 0; private msgT = 0;
  private slow = 0; private preview: PartId | null = null; private tab = 0; private last = performance.now(); private frames = 0; private fpsT = 0; private wantShot = false; private q = new URLSearchParams(location.search);

  constructor(canvas: HTMLCanvasElement) { this.eng = new Engine(canvas); }

  async start() {
    const loading = h('div.load', null, h('h1', null, 'REDLINE HORIZON'), h('div', null, 'CARREGANDO O RIO…')); this.ui.append(loading);
    const quality = QUALITIES.find((x) => x.id === (this.q.get('q') ?? this.settings.quality)) ?? QUALITIES[2];
    await this.eng.init(quality); (window as any).__backend = this.eng.backend;
    this.world = makeRio(this.eng, this.track); await this.world.build(); this.worlds.set('rio', { world: this.world, track: this.track }); this.showWorld('rio');
    this.globe = new Globe(this.eng);
    await preloadCars();
    if (isCarId(this.q.get('car'))) this.career.car = this.q.get('car') as CarId; // capture helper: ?car=<id> (not saved by itself)
    this.show = new CarVisual(kindOf(this.career.car), true); this.eng.scene.add(this.show.group); this.refreshCar();
    // capture helper: window.__carTris() counts the triangles of the visible car meshes (one pass, no shadows)
    (window as any).__carTris = () => { const out: Record<string, number> = {}; const count = (g: THREE.Object3D) => { let n = 0; g.traverseVisible((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const gm = m.geometry; n += (gm.index ? gm.index.count : gm.attributes.position.count) / 3; } }); return n; };
      if (this.screen === 'garage') out.garage = count(this.show.group); this.session?.visuals.forEach((v, i) => (out['car' + i] = count(v.group))); return out; };
    const unlock = () => { this.audio.unlock(); if (this.session) this.weatherSound(this.session.weather); this.music(this.screen === 'race' ? this.raceSong() : this.screen === 'garage' ? 'showroom' : 'title'); };
    addEventListener('pointerdown', unlock, { once: true }); addEventListener('keydown', unlock, { once: true });
    const cv = this.eng.canvas;
    cv.addEventListener('pointerdown', () => { this.drag = true; this.orbitAuto = false; }); addEventListener('pointerup', () => (this.drag = false));
    addEventListener('pointermove', (e) => { if (this.drag) this.orbit += e.movementX * 0.006; });
    this.radio.onChange = () => this.radioChip();
    this.radio.onFail = () => { this.radioDown = true; this.audio.play(this.screen === 'race' ? this.raceSong() : this.screen === 'garage' ? 'showroom' : 'title'); };
    this.musicBar(); loading.remove();
    if (this.q.get('hideui')) this.ui.style.display = 'none'; // capture helpers: ?hideui=1&orbit=<radians>
    if (this.q.get('orbit')) { this.orbit = +this.q.get('orbit')!; this.orbitAuto = false; }
    const go = this.q.get('go');
    if (go && this.q.get('rep')) this.career.rep = +this.q.get('rep')!; // capture helper: pretend to have this reputation (not saved by itself)
    if (go === 'race') await this.startEvent(EVENTS.find((e) => e.id === this.q.get('ev')) ?? EVENTS[0]); else if (go === 'garage') this.garage(); else if (go === 'cars') this.carsScreen('title'); else if (go === 'map') this.mapScreen(CITIES.find((c) => c.id === this.q.get('city')) ?? undefined); else this.title();
    const skip = +(this.q.get('t') ?? 0); if (this.session) for (let i = 0; i < skip * 60; i++) this.session.update(1 / 60, null);
    requestAnimationFrame(() => this.frame());
  }

  // ---------- shared helpers ----------
  private clear() { this.ui.replaceChildren(); this.hud = {}; this.labels.clear(); }
  private look(): Look { const c = this.career, u = setupOf(c); return { kind: kindOf(c.car), paint: this.q.get('paint') ? +this.q.get('paint')! : u.paint, finish: this.q.get('finish') ? +this.q.get('finish')! : u.finish, wheels: this.q.get('wheels') ? +this.q.get('wheels')! : u.wheels, aero: u.parts.aero, lower: u.parts.suspension }; }
  /** Make the showroom car the selected one, in its own look. */
  private syncShow() { if (this.show.kind !== kindOf(this.career.car)) this.setShow(kindOf(this.career.car)); else { this.refreshCar(); this.placeShow(); } }
  /** Swap the showroom car for model `kind` (and re-pose it). */
  private setShow(kind: number, look: Look = this.look()) {
    this.show.dispose(); this.show = new CarVisual(kind, true); this.eng.scene.add(this.show.group); this.show.setLook({ ...look, kind }); this.placeShow();
  }
  private refreshCar() { this.show.setLook(this.look()); }
  private music(name: string) {
    if (!this.audio.ctx) return;
    if (this.settings.radioOn && this.radio.url && !this.radioDown) { this.audio.stopMusic(); if (!this.radio.el) this.radio.play(this.audio.ctx, this.audio.master); }
    else { this.radio.stop(); this.audio.play(name); }
  }
  private raceSong() { return RACE_SONG[this.curId] ?? 'brazil'; }
  /** Next/previous station; the last stop is the built-in soundtrack. */
  private cycleStation(dir: number) {
    const ids = [...STATIONS.map((x) => x.id), 'game'];
    const cur = this.settings.radioOn && !this.radioDown ? Math.max(0, ids.indexOf(this.radio.station)) : ids.length - 1;
    const id = ids[(cur + dir + ids.length) % ids.length], mname = this.screen === 'race' ? this.raceSong() : this.screen === 'garage' ? 'showroom' : 'title';
    if (id === 'game') { this.settings.radioOn = false; this.radio.stop(); this.audio.play(mname); this.camTag('Trilha do jogo', '♪ '); }
    else { this.settings.radioOn = true; this.radioDown = false; this.radio.choose(id); this.music(mname); this.camTag(this.radio.name, '♪ '); }
    saveSettings(this.settings);
  }
  private radioDown = false; private bar!: HTMLElement; private barT = 0;
  /** Always-visible music status, with a button to start audio when the browser has not allowed it yet. */
  private musicBar() {
    this.bar = h('div.musicbar'); document.body.append(this.bar);
    const draw = () => {
      const a = this.audio, r = this.radio, ok = !!a.ctx && a.ctx.state === 'running';
      let text = '', btn = '';
      if (!ok) { text = '♪ Música desligada pelo navegador'; btn = '▶ Ativar música'; }
      else if (!this.settings.radioOn || this.radioDown) text = '♪ Trilha do jogo' + (r.error ? ' · ' + r.error + (r.detail ? ' (' + r.detail + ')' : '') : '');
      else if (r.playing) text = '♪ ' + r.name + (r.current ? ' · ' + r.current.tag : '') + ' · ao vivo  (R troca)';
      else text = '♪ Conectando à rádio…';
      const key = text + btn; if (this.bar.dataset.k === key) return; this.bar.dataset.k = key;
      this.bar.replaceChildren(text, ...(btn ? [h('button.pri', { onclick: () => { a.unlock(); void a.ctx?.resume(); this.radioDown = false; this.music(this.screen === 'race' ? this.raceSong() : this.screen === 'garage' ? 'showroom' : 'title'); } }, btn)] : []));
    };
    setInterval(() => { draw(); this.bar.style.display = this.screen === 'race' && this.radio.playing && this.audio.ctx?.state === 'running' ? 'none' : ''; }, 400); draw();
  }
  private radioChip() { const el = this.hud.radio; if (el) el.textContent = this.radio.playing ? '♪ ' + this.radio.name + (this.radio.current ? ' · ' + this.radio.current.tag : '') : this.radio.error ? '♪ ' + this.radio.error : this.settings.radioOn ? '♪ Conectando à rádio…' : '♪ Trilha Redline'; }
  private topBar(title: string, back: () => void, extra: HTMLElement[] = []) {
    return h('div.top', null, h('h2', null, title), h('div.chip', { html: `Reputação <b>${this.career.rep}</b>` }), h('div.chip', { html: `<b>${money(this.career.money)}</b>` }), ...extra, h('button', { onclick: back }, 'Voltar'));
  }
  private placeShow() {
    const [x, y, z, yaw] = pointAt(this.rioTrack, 46, 0); this.show.group.visible = true;
    this.show.place(x, y, z, yaw, { speed: 0, steer: 0.25, ax: 0, ay: 0, gradF: 0, gradR: 0, brake: 0, dt: 0.016 });
  }
  /** Make world `id` the visible one (it must be built). */
  private showWorld(id: string) {
    for (const [k, v] of this.worlds) v.world.show(k === id);
    const w = this.worlds.get(id)!; this.world = w.world; this.track = w.track; this.curId = id;
  }
  private showRio() { if (this.curId !== 'rio') this.showWorld('rio'); }
  /** Build a track's world the first time it is needed, then switch to it. */
  private async enterWorld(id: string) {
    if (this.curId === id) return;
    if (!this.worlds.has(id)) {
      // keep Rio (home screens) and the most recently used other world (disposed ones are rebuilt lazily; the session is already over here); free the rest so GPU memory stays bounded
      for (const k of [...this.worlds.keys()]) if (k !== 'rio' && k !== this.lastOther && k !== id) { this.worlds.get(k)!.world.dispose(); this.worlds.delete(k); }
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 40))); // let the loading overlay paint before the long build
      const track = buildTrack(TRACKS[id]), world = (MAKE[id] ?? makeRio)(this.eng, track);
      await world.build(); this.worlds.set(id, { world, track });
    }
    this.showWorld(id); if (id !== 'rio') this.lastOther = id;
  }
  private lastOther = '';
  private endSession() { this.session?.dispose(); this.session = null; this.audio.setEngines(0); this.audio.setWeatherSound(0, 0); for (const v of this.worlds.values()) { v.world.setWeather('clear'); v.world.onThunder = null; } this.paused = false; this.photo = false; }

  // ---------- title ----------
  title() {
    this.endSession(); this.showRio(); this.screen = 'title'; this.clear(); this.globe.show(false); this.syncShow(); this.orbitAuto = true; this.music('title');
    this.ui.append(h('div.title', null, h('h1', { html: 'REDLINE<br><span>HORIZON</span>' }), h('p', null, 'World Tour — comece no Rio, monte o seu carro e conquiste o mundo.'),
      h('div.menu', null, h('button.pri', { onclick: () => this.mapScreen() }, 'Carreira'), h('button', { onclick: () => this.garage() }, 'Garagem'), h('button', { onclick: () => this.carsScreen('title') }, 'Carros'), h('button', { onclick: () => this.options() }, 'Opções'))),
      h('div.hint', null, 'Setas ou WASD dirigem · Shift nitro · Espaço freio de mão · C câmera · B olhar para trás · P modo foto · controle PS/Xbox suportado'));
  }

  // ---------- world map ----------
  mapScreen(city: City = this.globe.selected) {
    this.endSession(); this.showRio(); this.screen = 'map'; this.clear(); this.show.group.visible = false; this.globe.show(true); this.music('title');
    this.globe.paint((c) => (cityDone(this.career, c) ? 'done' : cityOpen(this.career, c) ? 'open' : 'lock'));
    const side = h('div.side');
    this.ui.append(this.topBar('World Tour', () => this.title(), [h('button', { onclick: () => this.garage() }, 'Garagem')]), side);
    for (const c of CITIES) { const el = h('div.lbl' + (cityOpen(this.career, c) ? '' : '.lock'), { onclick: () => pick(c) }, c.name); this.labels.set(c.id, el); this.ui.append(el); }
    const pick = (c: City, animate = true) => {
      this.globe.select(c, animate); for (const [id, el] of this.labels) el.classList.toggle('sel', id === c.id);
      const open = cityOpen(this.career, c), evs = EVENTS.filter((e) => e.city === c.id);
      side.replaceChildren(h('div.panel', null, h('h2', null, c.name), h('div', { style: { color: 'var(--dim)' } }, `${c.country} · ${c.landmark}`),
        open ? null : h('p', null, !c.ready ? 'Em breve. Esta cidade chega na próxima fase do jogo.' : this.career.rep < c.rep ? `Reputação necessária: ${c.rep}` : `Vença "${EVENTS.find((e) => e.id === c.needs)?.name ?? c.needs}" para viajar.`),
        ...(open && evs.length ? [h('div.wxsel', null, h('label', null, 'Clima '), h('select', { onchange: (ev: Event) => { const v = (ev.target as HTMLSelectElement).value; for (const e of evs) { if (v === 'auto') delete this.wxPick[e.id]; else this.wxPick[e.id] = v as WeatherKind; } } },
          h('option', { value: 'auto' }, 'Previsão do dia'), ...Array.from(new Set(evs.flatMap((e) => allowedWeather(TRACKS[e.track])))).map((k) => h('option', { value: k, selected: evs.every((e) => this.wxPick[e.id] === k) }, `${WX_ICON[k]} ${WEATHER[k].name}`))))] : []),
        ...(open ? evs.map((e) => {
          const res = this.career.results[e.id], ok = eventOpen(this.career, e), done = res && res.place === 1;
          return h('div.ev' + (ok ? '' : '.lock'), null, h('div', null, h('h3', null, h('span.tag' + (done ? '.done' : ''), null, KIND[e.kind]), e.name), h('small', null, e.blurb), h('small.wxf', null, `Previsão: ${WEATHER[this.forecast(e)].name} ${WX_ICON[this.forecast(e)]}`),
            h('small', null, `${TRACKS[e.track]?.open ? 'ponto a ponto' : e.laps + ' voltas'} · prêmio ${money(e.prize[0])} · +${e.fame[0]} rep` + (res ? ` · melhor: ${e.kind === 'trial' ? ['ouro', 'prata', 'bronze', 'sem medalha'][res.place - 1] : res.place + 'º'}` : ''))),
            h('button.go' + (ok ? '.pri' : ''), { disabled: !ok, onclick: () => this.startEvent(e) }, ok ? 'Correr' : `Rep ${e.rep}`));
        }) : [])));
    };
    this.ui.append(h('div.cities', null, ...CITIES.map((c) => h('button' + (cityOpen(this.career, c) ? '.pri' : ''), { onclick: () => pick(c) }, c.name))));
    pick(city, false);
  }

  // ---------- garage ----------
  garage() {
    this.endSession(); this.showRio(); this.screen = 'garage'; this.clear(); this.globe.show(false); this.music('showroom');
    this.syncShow();
    const c = this.career, u = setupOf(c), def = carById(c.car), left = h('div.left'), side = h('div.side');
    this.ui.append(this.topBar('Garagem', () => this.title(), [h('button', { onclick: () => this.carsScreen('garage') }, 'Trocar carro'), h('button', { onclick: () => this.mapScreen() }, 'World Tour')]), left, side, h('div.hint', null, 'Arraste para girar o carro · P modo foto'));
    const draw = () => {
      const spec = buildSpec(u.parts, u.tuning, def.spec), now = ratings(spec);
      const parts2 = { ...u.parts }; if (this.preview && parts2[this.preview] < MAX_LEVEL) parts2[this.preview]++;
      const spec2 = buildSpec(parts2, u.tuning, def.spec), nxt = ratings(spec2);
      const bar = (name: string, a: number, b: number) => [h('div.stat', null, h('span', null, name), h('span', null, Math.round(b * 100) + '')), h('div.bar', null, h('i.gain', { style: { width: b * 100 + '%' } }), h('i', { style: { width: a * 100 + '%' } }))];
      const dc = h<'canvas'>('canvas.dyno');
      left.replaceChildren(h('div.panel', null, h('h2', null, def.name), h('div.stat', null, h('span', null, 'Potência'), h('span', { html: `<b style="color:var(--acc2);font-size:20px">${nxt.hp} cv</b>${nxt.hp !== now.hp ? ' (+' + (nxt.hp - now.hp) + ')' : ''}` })),
        h('div.stat', null, h('span', null, 'Peso'), h('span', null, Math.round(spec2.mass) + ' kg')), h('div', { style: { height: '8px' } }),
        ...bar('Aceleração', now.power, nxt.power), ...bar('Velocidade final', now.top, nxt.top), ...bar('Aderência', now.grip, nxt.grip), ...bar('Frenagem', now.braking, nxt.braking), ...bar('Nitro', now.nitro, nxt.nitro)),
        h('div.panel', null, h('h3', null, 'Dinamômetro'), dc));
      requestAnimationFrame(() => this.dyno(dc, spec, spec2));
      const tabs = h('div.tabs', null, ...['Peças', 'Ajuste', 'Visual'].map((t, i) => h('button' + (this.tab === i ? '.on' : ''), { onclick: () => { this.tab = i; draw(); } }, t)));
      let body: HTMLElement[];
      if (this.tab === 0) body = PART_IDS.map((p) => {
        const lv = u.parts[p], max = lv >= MAX_LEVEL;
        return h('div.part', { onmouseenter: () => { if (this.preview !== p) { this.preview = p; draw(); } } }, h('div', null, PART_INFO[p][0], h('small', null, PART_INFO[p][1])),
          h('div.pips', null, ...[0, 1, 2].map((i) => h('i' + (i < lv ? '.on' : '')))), h('button' + (canBuy(c, p) ? '.pri' : ''), { disabled: !canBuy(c, p), onclick: () => { if (buyPart(c, p)) { saveCareer(c); this.audio.ui('ok'); this.refreshCar(); this.garage(); } } }, max ? 'Máx' : money(priceOf(c, p))));
      });
      else if (this.tab === 1) {
        const sl = (name: string, hint: string, min: number, max: number, get: () => number, set: (v: number) => void) => h('label.row', null, h('span', null, name, h('small', { style: { display: 'block', color: 'var(--dim)' } }, hint)),
          h('input', { type: 'range', min, max, step: 0.01, value: get(), oninput: (e: Event) => { set(+(e.target as HTMLInputElement).value); saveCareer(c); }, onchange: () => draw() }));
        body = [sl('Relação final', 'esquerda: mais final · direita: mais arrancada', 0.85, 1.15, () => u.tuning.gearing, (v) => (u.tuning.gearing = v)),
          sl('Asa', 'mais asa: mais curva, menos reta (exige kit aero)', 0, 1, () => u.tuning.wing, (v) => (u.tuning.wing = v)), sl('Freio dianteiro', 'distribuição da frenagem', 0.5, 0.75, () => u.tuning.bias, (v) => (u.tuning.bias = v))];
      } else {
        const kit = carKit(this.show.kind), orig = !!kit?.norm && !kit.norm.paintable, norm = !!kit?.norm;
        body = orig ? [h('h3', null, 'Pintura original'), h('p', { style: { color: 'var(--dim)' } }, 'Este modelo tem a pintura e as rodas gravadas na textura: a cor não pode ser trocada.')]
          : [h('h3', null, 'Cor'), h('div.sw', null, ...PAINTS.map((col, i) => h('i' + (u.paint === i ? '.on' : ''), { style: { background: col }, onclick: () => { u.paint = i; saveCareer(c); this.refreshCar(); draw(); } }))),
            h('h3', { style: { marginTop: '14px' } }, 'Acabamento'), h('div.tabs', null, ...FINISHES.map((f, i) => h('button' + (u.finish === i ? '.on' : ''), { onclick: () => { u.finish = i; saveCareer(c); this.refreshCar(); draw(); } }, f))),
            ...(norm ? [] : [h('h3', null, 'Rodas'), h('div.tabs', null, ...WHEELS.map((f, i) => h('button' + (u.wheels === i ? '.on' : ''), { onclick: () => { u.wheels = i; saveCareer(c); this.refreshCar(); draw(); } }, f)))])];
      }
      side.replaceChildren(h('div.panel', { onmouseleave: () => { if (this.preview) { this.preview = null; draw(); } } }, tabs, ...body));
    };
    draw();
  }

  // ---------- car select ----------
  private carStep: ((d: number) => void) | null = null;
  /** The setup (paint, finish, parts) a car shows in the showroom. */
  private lookFor(id: CarId): Look { const u = this.career.cars[id]; return { kind: kindOf(id), paint: u.paint, finish: u.finish, wheels: u.wheels, aero: u.parts.aero, lower: u.parts.suspension }; }
  carsScreen(from: 'title' | 'garage' = 'title') {
    this.endSession(); this.showRio(); this.screen = 'cars'; this.clear(); this.globe.show(false); this.music('showroom'); this.orbitAuto = true; this.preview = null;
    const back = () => { this.carStep = null; if (from === 'garage') this.garage(); else this.title(); };
    let sel = Math.max(0, CARS.findIndex((x) => x.id === this.career.car));
    const list = h('div.left.carlist'), side = h('div.side');
    this.ui.append(this.topBar('Carros', back), list, side, h('div.hint', null, 'Setas ← → trocam de carro · arraste para girar'));
    const draw = () => {
      const def = CARS[sel], st = carStats(def.spec), credit = CAR_CREDIT[def.id];
      const bar = (name: string, v: number) => [h('div.stat', null, h('span', null, name), h('span', null, v + '')), h('div.bar', null, h('i', { style: { width: v + '%' } }))];
      list.replaceChildren(h('div.panel', null, ...CARS.map((x, i) => h('button.carcard' + (i === sel ? '.on' : ''), { onclick: () => pick(i) },
        h('b', null, x.name), h('small', null, `${x.year} · ${x.drivetrain}` + (x.id === this.career.car ? ' · em uso' : ''))))));
      side.replaceChildren(h('div.panel', null, h('h2', null, def.name), h('div', { style: { color: 'var(--dim)' } }, `${def.year} · tração ${def.drivetrain === 'RWD' ? 'traseira' : def.drivetrain === 'FWD' ? 'dianteira' : 'integral'}`),
        h('p.blurb', null, def.blurb), ...bar('Velocidade', st.speed), ...bar('Aceleração', st.accel), ...bar('Dirigibilidade', st.handling), ...bar('Frenagem', st.braking),
        h('div.nums', null, h('div', null, h('b', null, st.hp + ' cv'), h('small', null, 'potência')), h('div', null, h('b', null, Math.round(def.spec.mass) + ' kg'), h('small', null, 'peso')),
          h('div', null, h('b', null, st.zeroTo100.toFixed(1) + ' s'), h('small', null, '0–100 km/h')), h('div', null, h('b', null, st.topKmh + ' km/h'), h('small', null, 'final'))),
        carKit(kindOf(def.id))?.norm?.paintable === false ? h('small.credit', null, 'Pintura original (não pode ser trocada)') : null, h('small.credit', null, credit),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, h('button.pri', { onclick: () => { this.career.car = def.id; saveCareer(this.career); this.audio.ui('ok'); back(); } }, def.id === this.career.car ? 'Manter' : 'Escolher'), h('button', { onclick: back }, 'Voltar'))));
    };
    const pick = (i: number) => { sel = (i + CARS.length) % CARS.length; this.setShow(kindOf(CARS[sel].id), this.lookFor(CARS[sel].id)); draw(); this.audio.ui('move'); };
    this.carStep = (d) => pick(sel + d);
    this.setShow(kindOf(CARS[sel].id), this.lookFor(CARS[sel].id)); draw();
  }
  private dyno(cv: HTMLCanvasElement, a: ReturnType<typeof buildSpec>, b: ReturnType<typeof buildSpec>) {
    const w = (cv.width = cv.clientWidth * 2), hh = (cv.height = cv.clientHeight * 2), g = cv.getContext('2d')!; if (!w) return;
    const da = dyno(a), db = dyno(b), maxK = Math.max(db.peakKw, da.peakKw, 330) * 1.08, maxT = Math.max(db.peakTq, da.peakTq, 620) * 1.08, maxR = Math.max(a.redline, b.redline);
    g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1; for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(0, (hh * i) / 5); g.lineTo(w, (hh * i) / 5); g.stroke(); }
    const plot = (d: ReturnType<typeof dyno>, ys: number[], max: number, col: string, dash: number[]) => { g.strokeStyle = col; g.lineWidth = 3; g.setLineDash(dash); g.beginPath(); d.rpm.forEach((r, i) => { const x = (r / maxR) * w, y = hh - (ys[i] / max) * hh; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); };
    if (b !== a) { plot(db, db.kw, maxK, '#3ddc97', [10, 8]); plot(db, db.tq, maxT, 'rgba(61,220,151,.5)', [10, 8]); }
    plot(da, da.kw, maxK, '#ffb020', []); plot(da, da.tq, maxT, '#35c8ff', []); g.setLineDash([]);
    g.font = '22px Rajdhani'; g.fillStyle = '#ffb020'; g.fillText('potência', 10, 24); g.fillStyle = '#35c8ff'; g.fillText('torque', 110, 24); g.fillStyle = '#9aa3b2'; g.fillText(Math.round(maxR) + ' rpm', w - 100, hh - 8);
  }

  // ---------- options ----------
  options() {
    this.screen = 'options'; this.clear(); const s = this.settings, a = this.audio, r = this.radio;
    const url = h<'input'>('input', { type: 'text', placeholder: 'https://… endereço do stream (MP3/AAC)', value: r.url }), nm = h<'input'>('input', { type: 'text', placeholder: 'Nome da rádio', value: r.name });
    const row = (label: string, el: HTMLElement) => h('label.row', null, h('span', null, label), el);
    const about = h('p', { style: { color: 'var(--dim)', fontSize: '13px', margin: '4px 0 8px' } }), custom = h('div', { style: { display: r.station === CUSTOM ? '' : 'none' } }, url, h('div', { style: { height: '6px' } }), nm);
    const info = () => { const st = r.current; about.replaceChildren(...(st ? [`${st.note}: ${st.genres}. ${st.about} O jogo trata isso como audição pessoal e não comercial. `, h('a', { href: st.site, target: '_blank', rel: 'noopener', style: { color: 'var(--acc2)' } }, 'Site da rádio'), '.'] : ['Cole o endereço de stream (MP3/AAC) de uma rádio que permita tocar em sites de terceiros.'])); };
    info();
    this.ui.append(h('div.center.panel', null, h('h2', null, 'Opções'),
      row('Qualidade gráfica', h('select', { onchange: (e: Event) => { s.quality = (e.target as HTMLSelectElement).value; saveSettings(s); location.reload(); } }, ...QUALITIES.map((q) => h('option', { value: q.id, selected: q.id === this.eng.quality.id }, q.label)))),
      row('Câmbio automático', h('input', { type: 'checkbox', checked: s.auto, onchange: (e: Event) => { s.auto = (e.target as HTMLInputElement).checked; saveSettings(s); } })),
      row('Música', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: a.musicVol, oninput: (e: Event) => { a.musicVol = +(e.target as HTMLInputElement).value; a.saveVol(); r.setVolume(a.musicVol); } })),
      row('Efeitos', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: a.sfxVol, oninput: (e: Event) => { a.sfxVol = +(e.target as HTMLInputElement).value; a.saveVol(); } })),
      h('h3', { style: { marginTop: '14px' } }, 'Rádio online'),
      row('Estação', h('select', { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v === CUSTOM) { r.station = CUSTOM; } else { r.choose(v); } custom.style.display = v === CUSTOM ? '' : 'none'; info(); } },
        ...STATIONS.map((st) => h('option', { value: st.id, selected: r.station === st.id }, st.name)), h('option', { value: CUSTOM, selected: r.station === CUSTOM }, 'Outra (colar endereço)'))),
      about, custom,
      row('Usar rádio', h('input', { type: 'checkbox', checked: s.radioOn, onchange: (e: Event) => { s.radioOn = (e.target as HTMLInputElement).checked; saveSettings(s); } })),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, h('button.pri', { onclick: () => { if (r.station === CUSTOM) r.set(url.value, nm.value); else r.save(); r.stop(); this.radioDown = false; this.title(); } }, 'Salvar'), h('button', { onclick: () => { if (confirm('Apagar todo o progresso da carreira?')) { localStorage.removeItem('rh_career'); location.reload(); } } }, 'Zerar carreira'))));
  }

  // ---------- race ----------
  /** The day's forecast for an event: stable for the whole day (day of year + a hash of the event id). */
  forecast(ev: RaceEvent): WeatherKind {
    const d = new Date(), doy = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
    let hh = 0; for (const ch of ev.id) hh = (Math.imul(hh, 31) + ch.charCodeAt(0)) | 0;
    return pickWeather(TRACKS[ev.track], doy + (hh >>> 0) % 100000);
  }
  /** Weather the race will use: `?weather=` first, then the player's choice, then the forecast. */
  private chosenWeather(ev: RaceEvent): WeatherKind {
    const q = this.q.get('weather') as WeatherKind | null; if (q && q in WEATHER) return q;
    const pick = this.wxPick[ev.id]; return pick && allowedWeather(TRACKS[ev.track]).includes(pick) ? pick : this.forecast(ev);
  }
  private wxPick: Record<string, WeatherKind> = {};
  private weatherSound(kind: WeatherKind) { const r = kind === 'storm' ? 1 : kind === 'rain' ? 0.65 : 0, w = kind === 'storm' ? 1 : kind === 'rain' ? 0.5 : kind === 'snow' || kind === 'overcast' ? 0.3 : kind === 'fog' ? 0.1 : 0; this.audio.setWeatherSound(r, w); }
  async startEvent(ev: RaceEvent) {
    this.endSession(); this.event = ev; this.clear(); this.globe.show(false); this.show.group.visible = false;
    if (ev.track !== this.curId) {
      this.screen = 'loading'; this.ui.append(h('div.load', null, h('h1', null, 'REDLINE HORIZON'), h('div', null, 'CARREGANDO ' + (PLACE_NAME[ev.track] ?? ev.track.toUpperCase()) + '…')));
      await this.enterWorld(ev.track); this.clear();
    }
    this.screen = 'race'; this.endTimer = 0; this.lastBeep = 9; this.bestSeen = 0; this.finalSaid = false;
    const c = this.career, auto = this.q.get('auto');
    const rc = rivalCars(ev), mine = kindOf(c.car); let heavyN = isHeavy(mine) ? 1 : 0;
    const entrants: Entrant[] = ev.rivals.map((r, i) => ({ spec: rivalSpec(r.parts ?? 0, rc[i]), driver: r.driver, name: r.driver.name, paint: r.paint }));
    // heavy meshes (the Aurora, the 60k+ triangle cars) are capped at 4 on screen; extra rivals keep their own physics but borrow a lighter body
    const looks: Look[] = ev.rivals.map((r, i) => { let kind = kindOf(rc[i]); if (isHeavy(kind)) { if (heavyN >= 4) kind = kindOf('cuda'); else heavyN++; } return { kind, paint: r.paint, finish: i % 4, wheels: i % 3, aero: r.parts, lower: r.parts }; });
    entrants.push({ spec: playerSpec(c), driver: auto ? { name: 'auto', skill: 0.95, aggression: 0.6, consistency: 1 } : null, name: 'Você', paint: setupOf(c).paint }); looks.push(this.look());
    const wx = this.chosenWeather(ev); this.world.setWeather(wx); this.world.onThunder = (d, p) => this.audio.thunder(d, p); this.weatherSound(wx);
    const s = (this.session = new Session(this.eng, this.world, this.track, entrants, ev.laps, looks, entrants.length - 1, (Date.now() & 0xffff) | 1, ev.kind === 'trial' ? 0 : 0.5, wx));
    s.me.car.auto = this.settings.auto; s.cam = this.settings.cam;
    const qc = this.q.get('cam') as CamMode | null; if (qc && CAM_CYCLE.includes(qc)) s.cam = qc; // capture helper: ?cam=chase|far|bumper|hood|cockpit
    if (ev.kind === 'trial' && c.ghost[ev.id]) s.setGhost(c.ghost[ev.id], { ...this.look(), paint: 4 }, 3);
    this.audio.setEngines(1); this.music(this.raceSong());
    const H = this.hud, e = (cls: string, html = '') => h('div.' + cls, { html });
    const tall = this.track.open; this.mapW = tall ? 250 : 380; this.mapH = tall ? 640 : 380;
    const mapCv = h<'canvas'>('canvas.map', { width: this.mapW, height: this.mapH, style: tall ? { width: '110px', height: '282px' } : {} }); this.map = mapCv.getContext('2d')!;
    this.ui.append(h('div.hud', null, (H.pos = e('pos')), (H.lap = e('lap')), (H.time = e('time')), (H.rev = e('rev', '<i></i>')), (H.nos = e('nos', '<i></i>')), (H.gear = e('gear')), (H.speed = e('speed', '<b>0</b><span>KM/H</span>')), mapCv, (H.msg = e('msg')), (H.radio = e('radio')), (H.wx = e('wx', `${WX_ICON[wx]} ${WEATHER[wx].name}`))));
    this.radioChip();
    const t = this.track; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    if (t.open) {
      // point-to-point: rotate so the start-to-finish direction points up, then fit the route in the box
      let ux = t.px[t.n - 1] - t.px[0], uz = t.pz[t.n - 1] - t.pz[0]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const proj = (x: number, z: number): [number, number] => [(x - t.px[0]) * -uz + (z - t.pz[0]) * ux, (x - t.px[0]) * ux + (z - t.pz[0]) * uz];
      let a0 = 1e9, a1 = -1e9; for (let i = 0; i < t.n; i++) { const [c, l] = proj(t.px[i], t.pz[i]); x0 = Math.min(x0, c); x1 = Math.max(x1, c); a0 = Math.min(a0, l); a1 = Math.max(a1, l); }
      const sc = Math.min((this.mapW - 40) / (x1 - x0), (this.mapH - 40) / (a1 - a0)); this.mapXY = (x, z) => { const [c, l] = proj(x, z); return [this.mapW / 2 + (c - (x0 + x1) / 2) * sc, this.mapH / 2 - (l - (a0 + a1) / 2) * sc]; };
    } else {
      for (let i = 0; i < t.n; i++) { x0 = Math.min(x0, t.px[i]); x1 = Math.max(x1, t.px[i]); z0 = Math.min(z0, t.pz[i]); z1 = Math.max(z1, t.pz[i]); }
      const sc = 340 / Math.max(x1 - x0, z1 - z0); this.mapXY = (x, z) => [190 + (x - (x0 + x1) / 2) * sc, 190 + (z - (z0 + z1) / 2) * sc];
    }
    this.mapPath = []; for (let i = 0; i < t.n; i += 4) this.mapPath.push(this.mapXY(t.px[i], t.pz[i]));
    if (t.open) this.mapPath.push(this.mapXY(t.px[t.n - 1], t.pz[t.n - 1]));
  }
  private camTagT = 0;
  private camTag(text: string, prefix = 'Câmera · ') { this.ui.querySelector('.camtag')?.remove(); const e = h('div.hint.camtag', { style: { bottom: 'auto', top: '22%', fontSize: '22px', color: '#fff', fontFamily: 'var(--head)', letterSpacing: '.1em', textTransform: 'uppercase' } }, prefix + text); this.ui.append(e); clearTimeout(this.camTagT); this.camTagT = window.setTimeout(() => e.remove(), 1400); }
  private mapW = 380; private mapH = 380;
  private mapXY: (x: number, z: number) => [number, number] = () => [0, 0];
  private say(text: string, secs = 1.6, color = '#fff') { const m = this.hud.msg; if (!m) return; m.textContent = text; m.style.color = color; m.classList.add('on'); this.msgT = secs; }

  private raceFrame(dt: number) {
    const s = this.session!, r = s.race, me = s.me, c = me.car, H = this.hud, a = this.audio;
    if (this.controls.hit('Escape') || this.controls.padHit(9)) this.pause(!this.paused);
    if (this.controls.hit('KeyP')) this.togglePhoto();
    if (!this.paused && !this.photo) { if (this.controls.padHit(15)) this.cycleStation(1); else if (this.controls.padHit(14)) this.cycleStation(-1); }
    const camNext = this.controls.hit('KeyC'), camPad = this.controls.padHit(8);
    if ((camNext || camPad) && !this.photo) { const i = CAM_CYCLE.indexOf(s.cam); s.cam = CAM_CYCLE[(i + 1) % CAM_CYCLE.length]; this.settings.cam = s.cam as Settings['cam']; saveSettings(this.settings); this.camTag(CAM_NAMES[s.cam]); }
    s.lookBack = this.controls.isDown('KeyB') || !!this.controls.pad?.buttons[11]?.pressed;
    const frozen = this.paused || this.photo, inp = this.controls.out;
    if (this.photo) { s.cam = 'orbit'; if (!this.drag) s.orbit += inp.steer * dt * 1.5; else s.orbit = this.orbit; }
    s.update(frozen ? 0 : dt, me.ai ? null : inp);
    const dbg = this.q.get('dbg'); // capture helper: ?dbg=x,y,z,lookX,lookY,lookZ places the camera in world coordinates
    if (dbg) { const v = dbg.split(',').map(Number); this.eng.camera.position.set(v[0], v[1], v[2]); this.eng.camera.lookAt(v[3], v[4], v[5]); }
    if (frozen) { a.updateEngine(0, 0.12, 0, 0, false); return; }
    // countdown lights
    const n = Math.ceil(r.countdown / 60);
    if (r.countdown > 0) { if (n !== this.lastBeep && n <= 3) { this.lastBeep = n; this.say(String(n), 0.8, '#ffb020'); a.beep(440, 0.14, 0.3); this.radio.duck(1); } }
    else if (this.lastBeep !== 0) { this.lastBeep = 0; this.say('VAI!', 1.1, '#3ddc97'); a.beep(880, 0.4, 0.35); this.radio.duck(0); }
    if (this.msgT > 0 && (this.msgT -= dt) <= 0) H.msg.classList.remove('on');
    // sounds
    const skid = Math.max(c.slipR, c.slipF) > 0.75 && Math.abs(c.vx) > 8 ? Math.min(1, Math.max(c.slipR, c.slipF)) : c.spin > 0.2 ? 0.6 : 0;
    a.updateEngine(0, c.rpm / c.spec.redline, c.throttle, c.offRoad ? 0.3 : skid, c.nitroOn);
    if (c.hit > 1.5) { a.bump(); this.controls.rumble(Math.min(1, c.hit / 8), 0.6, 160); this.radio.duck(0.6); setTimeout(() => this.radio.duck(0), 400); }
    else if (c.offRoad || skid > 0) this.controls.rumble(0.15, 0.4);
    // readouts
    const total = r.racers.length, kmh = Math.abs(c.vx) * 3.6;
    H.speed.firstElementChild!.textContent = String(Math.round(kmh)); H.gear.textContent = c.gear < 0 ? 'R' : String(c.gear);
    (H.rev.firstElementChild as HTMLElement).style.width = Math.min(100, (c.rpm / c.spec.redline) * 100) + '%'; (H.nos.firstElementChild as HTMLElement).style.width = (c.nitro / c.spec.nitroTank) * 100 + '%';
    H.pos.innerHTML = this.event!.kind === 'trial' ? '' : `${me.place}<small>/${total}</small>`;
    H.lap.innerHTML = r.track.open ? `PROGRESSO <b>${Math.max(0, Math.min(100, Math.floor((me.dist / (r.track.len - FINISH_BEFORE_END)) * 100)))}%</b>` : `VOLTA <b>${Math.min(r.laps, me.lap + 1)}</b>/${r.laps}`;
    H.time.innerHTML = `${clock(r.countdown > 0 || me.finished ? 0 : r.tick - me.lapStart)}<small>melhor ${clock(me.best)}</small>`;
    if (me.best && me.best !== this.bestSeen) { if (this.bestSeen) this.say('MELHOR VOLTA', 1.4, '#3ddc97'); this.bestSeen = me.best; }
    if (me.lap === r.laps - 1 && r.laps > 1 && !this.finalSaid) { this.finalSaid = true; this.say('ÚLTIMA VOLTA', 1.6); }
    // minimap
    const g = this.map; g.clearRect(0, 0, this.mapW, this.mapH); g.lineJoin = 'round'; g.beginPath(); this.mapPath.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (!r.track.open) g.closePath();
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 12; g.stroke(); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 5; g.stroke();
    if (r.track.open) { // start (green) and finish line (chequered)
      const tk = r.track, [sx, sy] = this.mapXY(tk.px[0], tk.pz[0]), fi = Math.round((tk.len - FINISH_BEFORE_END) / tk.step), [fx, fy] = this.mapXY(tk.px[fi], tk.pz[fi]);
      g.fillStyle = '#3ddc97'; g.fillRect(sx - 8, sy - 3, 16, 6); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.strokeRect(sx - 8, sy - 3, 16, 6);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(fx - 8 + i * 4, fy - 4 + j * 4, 4, 4); } g.strokeRect(fx - 8, fy - 4, 16, 8);
    }
    r.racers.forEach((q, i) => { const [x, y] = this.mapXY(q.car.x, q.car.z); g.beginPath(); g.arc(x, y, i === s.player ? 9 : 6, 0, 7); g.fillStyle = i === s.player ? '#ff4b2b' : PAINTS[q.paint % PAINTS.length]; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke(); });
    if (me.finished && !this.endTimer) { this.endTimer = 2.6; this.say('CHEGADA!', 2.4, '#ffb020'); }
    if (this.endTimer && (this.endTimer -= dt) <= 0) this.results();
  }
  private finalSaid = false; private padSeen = false;
  /** Drive the menus with a controller: d-pad or stick moves the highlight, A / ✕ selects, B / ○ goes back. */
  private padMenu() {
    const c = this.controls, p = c.pad;
    if (!!p !== this.padSeen) { this.padSeen = !!p; this.ui.querySelector('.padchip')?.remove(); if (p) { const el = h('div.chip.padchip', null, '🎮 ' + (/xbox|xinput/i.test(p.id) ? 'Controle Xbox' : /dualshock|dualsense|054c|wireless controller/i.test(p.id) ? 'Controle PlayStation' : 'Controle') + ' conectado'); this.ui.append(el); setTimeout(() => el.remove(), 4000); } }
    if (!p || (this.screen === 'race' && !this.paused)) return;
    const ay = p.axes[1] ?? 0, ax = p.axes[0] ?? 0, stick = Math.abs(ay) > 0.6 ? Math.sign(ay) : Math.abs(ax) > 0.6 ? Math.sign(ax) : 0, moved = stick !== 0 && this.stickWas === 0; this.stickWas = stick;
    const next = c.padHit(13) || c.padHit(15) || (moved && stick > 0), prev = c.padHit(12) || c.padHit(14) || (moved && stick < 0), ok = c.padHit(0), back = c.padHit(1);
    if (this.screen === 'race' && !this.paused) return;
    const list = Array.from(this.ui.querySelectorAll<HTMLElement>('button:not(:disabled), .sw i, .lbl, input[type=checkbox]')).filter((e) => e.offsetParent !== null);
    if (!list.length) return;
    let i = list.indexOf(document.activeElement as HTMLElement);
    if (next || prev) { i = i < 0 ? 0 : (i + (next ? 1 : -1) + list.length) % list.length; for (const e of list) e.classList.remove('focus'); const e = list[i]; e.tabIndex = 0; e.focus(); e.classList.add('focus'); e.scrollIntoView({ block: 'nearest' }); this.audio.ui('move'); }
    else if (ok && i >= 0) { list[i].click(); this.audio.ui('ok'); }
    else if (back) { const b = list.find((e) => /^(Voltar|Continuar|Sair|Fechar)$/i.test(e.textContent || '')); if (b) { b.click(); this.audio.ui('back'); } }
  }
  private stickWas = 0;
  private pause(on: boolean) {
    if (this.photo) return; this.paused = on; this.ui.querySelector('.pausebox')?.remove();
    if (on) this.ui.append(h('div.center.panel.pausebox', null, h('h2', null, 'Pausa'), h('div.menu', { style: { marginTop: '12px', width: '100%' } }, h('button.pri', { onclick: () => this.pause(false) }, 'Continuar'),
      h('button', { onclick: () => this.startEvent(this.event!) }, 'Reiniciar'), h('button', { onclick: () => this.togglePhoto() }, 'Modo foto'), h('button', { onclick: () => this.mapScreen() }, 'Sair da corrida'))));
  }
  private togglePhoto() {
    this.ui.querySelector('.pausebox')?.remove(); this.paused = false; this.photo = !this.photo; this.eng.vignette.value = this.photo ? 0.6 : 0.35;
    for (const el of Array.from(this.ui.children) as HTMLElement[]) el.style.display = this.photo ? 'none' : '';
    this.ui.querySelector('.photobar')?.remove();
    if (this.photo) { this.orbit = this.session ? this.session.orbit : this.orbit; this.ui.append(h('div.hint.photobar', { style: { pointerEvents: 'auto' } }, 'Modo foto · arraste ou use as setas para girar · ', h('button', { onclick: () => (this.wantShot = true) }, 'Salvar foto'), ' ', h('button', { onclick: () => this.togglePhoto() }, 'Sair'))); }
    else if (this.session) this.session.cam = this.settings.cam;
  }

  private results() {
    const s = this.session!, r = s.race, ev = this.event!, me = s.me, c = this.career; this.endTimer = 0; this.finalSaid = false;
    const place = ev.kind === 'trial' ? medal(ev, me.best) : me.place, got = settle(c, ev, place, me.best);
    if (ev.kind === 'trial' && me.best && (!c.ghost[ev.id] || got.improved || me.best <= (c.results[ev.id]?.best ?? 0))) c.ghost[ev.id] = s.record.filter((_, i) => Math.floor(i / 4) % 3 === 0).map((v) => Math.round(v * 100) / 100);
    saveCareer(c); this.screen = 'results'; this.clear(); this.audio.setEngines(0); this.music('results');
    const order = r.racers.slice().sort((a, b) => a.place - b.place);
    const head = ev.kind === 'trial' ? ['🥇 Ouro', '🥈 Prata', '🥉 Bronze', 'Sem medalha'][place - 1] : place === 1 ? 'Vitória!' : place + 'º lugar';
    this.ui.append(h('div.center.panel', null, h('h2', null, head), h('div', { style: { color: 'var(--dim)' } }, ev.name + (ev.medals ? ` · ouro ${ev.medals[0]}s · prata ${ev.medals[1]}s · bronze ${ev.medals[2]}s` : '')),
      h('table', null, h('tr', null, h('th', null, '#'), h('th', null, 'Piloto'), h('th', null, ev.laps > 1 && !r.track.open ? 'Melhor volta' : 'Tempo'), h('th', null, 'Total')),
        ...order.map((q) => h('tr' + (q === me ? '.me' : ''), null, h('td', null, String(q.place)), h('td', null, q.name), h('td', null, clock(q.best)), h('td', null, q.finished ? clock(q.finishTick) : '—')))),
      h('p', { html: `Prêmio <b style="color:var(--acc2)">${money(got.money)}</b> · Reputação <b style="color:var(--acc2)">+${got.rep}</b>${got.improved ? '' : ' <small>(repetição paga menos)</small>'}` }),
      ev.kind === 'rival' && place === 1 ? h('p', { style: { color: 'var(--ok)' } }, (ev.city === 'rio' ? 'Você é o novo dono da orla. ' : '') + 'Você venceu o dono da região. O World Tour continua: novas cidades chegam em breve.') : null,
      h('div', { style: { display: 'flex', gap: '8px' } }, h('button.pri', { onclick: () => this.mapScreen(CITIES.find((x) => x.id === ev.city) ?? CITIES[0]) }, 'Continuar'), h('button', { onclick: () => this.startEvent(ev) }, 'Repetir'), h('button', { onclick: () => this.garage() }, 'Garagem'))));
  }

  // ---------- frame ----------
  private frame() {
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const eng = this.eng, cam = eng.camera;
    this.controls.read(dt, this.screen === 'race' ? Math.abs(this.session?.me.car.vx ?? 0) : 0); this.padMenu();
    if (this.screen !== 'options' && this.controls.hit('KeyR')) this.cycleStation(1);
    if (this.screen === 'race' || (this.screen === 'results' && this.session)) {
      if (this.screen === 'race') this.raceFrame(dt); else { this.session!.cam = 'orbit'; this.session!.orbit += dt * 0.25; this.session!.update(dt, null); }
    } else if (this.screen === 'map') { this.globe.update(dt, this.labels); eng.blur.value = 0; }
    else {
      if (this.controls.hit('KeyP') && this.screen === 'garage') this.togglePhoto();
      if (this.screen === 'cars') { if (this.controls.hit('ArrowRight') || this.controls.hit('ArrowDown')) this.carStep?.(1); if (this.controls.hit('ArrowLeft') || this.controls.hit('ArrowUp')) this.carStep?.(-1); }
      if (this.orbitAuto) this.orbit += dt * 0.12;
      const g = this.show.group.position, d = this.screen === 'title' ? 7.4 : 6.6, off = (this.screen === 'garage' || this.screen === 'cars') && !this.photo ? 0.9 : this.screen === 'title' ? -1.2 : 0;
      cam.position.set(g.x + Math.cos(this.orbit) * d, g.y + 1.35, g.z + Math.sin(this.orbit) * d); cam.lookAt(g.x, g.y + 0.6, g.z); cam.translateX(off);
      if (cam.fov !== 40 && !this.q.get('gcam')) { cam.fov = 40; cam.updateProjectionMatrix(); }
      const gc = this.q.get('gcam'); // capture helper: ?gcam=x,y,z,lookX,lookY,lookZ in the garage car's own frame (x left, z forward, y up from the ground)
      if (gc) { const v = gc.split(',').map(Number), grp = this.show.group; grp.updateWorldMatrix(true, false); cam.position.copy(grp.localToWorld(new THREE.Vector3(v[0], v[1], v[2]))); cam.lookAt(grp.localToWorld(new THREE.Vector3(v[3], v[4], v[5]))); const fv = v[6] || 40; if (cam.fov !== fv) { cam.fov = fv; cam.updateProjectionMatrix(); } }
      eng.blur.value = 0; this.world.update(g);
    }
    this.world.pulse.value = Math.max(this.radio.beat(), this.audio.ctx && !this.radio.playing ? Math.min(1, this.audio.level().rms * 3) : 0);
    eng.render();
    if (this.wantShot) { this.wantShot = false; eng.canvas.toBlob((b) => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'redline-horizon.png'; a.click(); }); }
    this.frames++; if (now - this.fpsT > 1000) {
      const fps = ((window as any).__fps = Math.round((this.frames * 1000) / (now - this.fpsT))); this.frames = 0; this.fpsT = now;
      // slow machine (often the browser picked the integrated GPU): offer the light preset once
      if (fps < 22 && this.eng.quality.id !== 'low' && !this.q.get('q')) { if (++this.slow === 5 && !this.ui.querySelector('.slow')) this.ui.append(h('div.panel.slow', null, h('b', null, 'Desempenho baixo. '), 'Se o computador tem placa de vídeo dedicada, faça o navegador usá-la (Configurações do Windows › Vídeo › Elementos gráficos). ',
        h('button.pri', { onclick: () => { this.settings.quality = 'low'; saveSettings(this.settings); location.reload(); } }, 'Usar qualidade baixa'), ' ', h('button', { onclick: (e: Event) => (e.target as HTMLElement).parentElement!.remove() }, 'Fechar'))); } else this.slow = 0;
    }
    if (this.frames === 4) (window as any).__ready = true;
    (window as any).__info = { screen: this.screen, money: this.career.money, rep: this.career.rep, place: this.session?.me.place, lap: this.session?.me.lap, finished: this.session?.me.finished, track: this.curId, tris: this.eng.renderer.info.render.triangles, dist: Math.round(this.session?.me.dist ?? 0) };
    requestAnimationFrame(() => this.frame());
  }
}
