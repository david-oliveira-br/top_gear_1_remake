import * as THREE from 'three/webgpu';
import { BASE, CITIES, EVENTS, MAX_LEVEL, PART_IDS, RIO, buildSpec, buildTrack, buyPart, canBuy, cityOpen, dyno, eventOpen, medal, pointAt, priceOf, ratings, settle,
  type Career, type City, type Entrant, type PartId, type RaceEvent, type Track } from '../../sim/src/index';
import { GameAudio } from './audio/audio';
import { Radio } from './audio/radio';
import { CarVisual, FINISHES, PAINTS } from './car/visual';
import { Engine, QUALITIES } from './gfx/engine';
import { Globe } from './globe';
import { Controls } from './input';
import { Session, type Look } from './race/session';
import { loadCareer, loadSettings, saveCareer, saveSettings } from './save';
import { clock, h, money } from './ui/dom';
import { World } from './world/rio';

const PART_INFO: Record<PartId, [string, string]> = {
  engine: ['Motor', 'Mais torque e giro'], turbo: ['Turbo', 'Pressão extra em alta rotação'], gearbox: ['Câmbio', 'Trocas rápidas, marchas próximas'],
  tyres: ['Pneus', 'Aderência em curva e na largada'], suspension: ['Suspensão', 'Carro mais baixo e estável'], brakes: ['Freios', 'Frenagens mais curtas'],
  weight: ['Alívio de peso', 'Menos massa em tudo'], aero: ['Aerodinâmica', 'Pressão para curvas rápidas'], nitro: ['Nitro', 'Mais potência e tanque maior'],
};
const KIND: Record<string, string> = { grid: 'Corrida', duel: 'Duelo', trial: 'Contra o relógio', rival: 'Rival' };
type Screen = 'title' | 'map' | 'garage' | 'race' | 'results' | 'options';

export class App {
  eng: Engine; world!: World; track: Track = buildTrack(RIO); globe!: Globe; audio = new GameAudio(); radio = new Radio(); controls = new Controls();
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
    this.world = new World(this.eng, this.track); await this.world.build();
    this.globe = new Globe(this.eng);
    this.show = new CarVisual(); this.eng.scene.add(this.show.group); this.refreshCar();
    const unlock = () => { this.audio.unlock(); this.music(this.screen === 'race' ? 'brazil' : this.screen === 'garage' ? 'showroom' : 'title'); };
    addEventListener('pointerdown', unlock, { once: true }); addEventListener('keydown', unlock, { once: true });
    const cv = this.eng.canvas;
    cv.addEventListener('pointerdown', () => { this.drag = true; this.orbitAuto = false; }); addEventListener('pointerup', () => (this.drag = false));
    addEventListener('pointermove', (e) => { if (this.drag) this.orbit += e.movementX * 0.006; });
    this.radio.onChange = () => this.radioChip();
    loading.remove();
    const go = this.q.get('go');
    if (go === 'race') this.startEvent(EVENTS.find((e) => e.id === this.q.get('ev')) ?? EVENTS[0]); else if (go === 'garage') this.garage(); else if (go === 'map') this.mapScreen(); else this.title();
    const skip = +(this.q.get('t') ?? 0); if (this.session) for (let i = 0; i < skip * 60; i++) this.session.update(1 / 60, null);
    requestAnimationFrame(() => this.frame());
  }

  // ---------- shared helpers ----------
  private clear() { this.ui.replaceChildren(); this.hud = {}; this.labels.clear(); }
  private look(): Look { const c = this.career; return { paint: c.paint, finish: c.finish, wheels: c.wheels, aero: c.parts.aero, lower: c.parts.suspension }; }
  private refreshCar() { this.show.setLook(this.look()); }
  private music(name: string) {
    if (!this.audio.ctx) return;
    if (this.settings.radioOn && this.radio.url) { this.audio.stopMusic(); if (!this.radio.el) this.radio.play(this.audio.ctx, this.audio.master); }
    else { this.radio.stop(); this.audio.play(name); }
  }
  private radioChip() { const el = this.hud.radio; if (el) el.textContent = this.radio.playing ? '♪ ' + this.radio.name : this.radio.error ? '♪ ' + this.radio.error : '♪ Trilha Redline'; }
  private topBar(title: string, back: () => void, extra: HTMLElement[] = []) {
    return h('div.top', null, h('h2', null, title), h('div.chip', { html: `Reputação <b>${this.career.rep}</b>` }), h('div.chip', { html: `<b>${money(this.career.money)}</b>` }), ...extra, h('button', { onclick: back }, 'Voltar'));
  }
  private placeShow() {
    const [x, y, z, yaw] = pointAt(this.track, 46, 0); this.show.group.visible = true;
    this.show.place(x, y, z, yaw, { speed: 0, steer: 0.25, ax: 0, ay: 0, gradF: 0, gradR: 0, brake: 0, dt: 0.016 });
  }
  private endSession() { this.session?.dispose(); this.session = null; this.audio.setEngines(0); this.paused = false; this.photo = false; }

  // ---------- title ----------
  title() {
    this.endSession(); this.screen = 'title'; this.clear(); this.globe.show(false); this.placeShow(); this.orbitAuto = true; this.music('title');
    this.ui.append(h('div.title', null, h('h1', { html: 'REDLINE<br><span>HORIZON</span>' }), h('p', null, 'World Tour — comece no Rio, monte o seu carro e conquiste o mundo.'),
      h('div.menu', null, h('button.pri', { onclick: () => this.mapScreen() }, 'Carreira'), h('button', { onclick: () => this.garage() }, 'Garagem'), h('button', { onclick: () => this.options() }, 'Opções'))),
      h('div.hint', null, 'Setas ou WASD dirigem · Shift nitro · Espaço freio de mão · P modo foto · controle PS/Xbox suportado'));
  }

  // ---------- world map ----------
  mapScreen(city: City = this.globe.selected) {
    this.endSession(); this.screen = 'map'; this.clear(); this.show.group.visible = false; this.globe.show(true); this.music('title');
    this.globe.paint((c) => (c.id === 'rio' && this.career.results['rio-rival']?.place === 1 ? 'done' : cityOpen(this.career, c) ? 'open' : 'lock'));
    const side = h('div.side');
    this.ui.append(this.topBar('World Tour', () => this.title(), [h('button', { onclick: () => this.garage() }, 'Garagem')]), side);
    for (const c of CITIES) { const el = h('div.lbl' + (cityOpen(this.career, c) ? '' : '.lock'), { onclick: () => pick(c) }, c.name); this.labels.set(c.id, el); this.ui.append(el); }
    const pick = (c: City, animate = true) => {
      this.globe.select(c, animate); for (const [id, el] of this.labels) el.classList.toggle('sel', id === c.id);
      const open = cityOpen(this.career, c), evs = EVENTS.filter((e) => e.city === c.id);
      side.replaceChildren(h('div.panel', null, h('h2', null, c.name), h('div', { style: { color: 'var(--dim)' } }, `${c.country} · ${c.landmark}`),
        open ? null : h('p', null, !c.ready ? 'Em breve. Esta cidade chega na próxima fase do jogo.' : this.career.results['rio-rival']?.place !== 1 ? 'Vença o Rei da Orla no Rio para viajar.' : `Reputação necessária: ${c.rep}`),
        ...(open ? evs.map((e) => {
          const res = this.career.results[e.id], ok = eventOpen(this.career, e), done = res && res.place === 1;
          return h('div.ev' + (ok ? '' : '.lock'), null, h('div', null, h('h3', null, h('span.tag' + (done ? '.done' : ''), null, KIND[e.kind]), e.name), h('small', null, e.blurb),
            h('small', null, `${e.laps} voltas · prêmio ${money(e.prize[0])} · +${e.fame[0]} rep` + (res ? ` · melhor: ${e.kind === 'trial' ? ['ouro', 'prata', 'bronze', 'sem medalha'][res.place - 1] : res.place + 'º'}` : ''))),
            h('button.go' + (ok ? '.pri' : ''), { disabled: !ok, onclick: () => this.startEvent(e) }, ok ? 'Correr' : `Rep ${e.rep}`));
        }) : [])));
    };
    this.ui.append(h('div.cities', null, ...CITIES.map((c) => h('button' + (cityOpen(this.career, c) ? '.pri' : ''), { onclick: () => pick(c) }, c.name))));
    pick(city, false);
  }

  // ---------- garage ----------
  garage() {
    this.endSession(); this.screen = 'garage'; this.clear(); this.globe.show(false); this.placeShow(); this.music('showroom');
    const c = this.career, left = h('div.left'), side = h('div.side');
    this.ui.append(this.topBar('Garagem', () => this.title(), [h('button', { onclick: () => this.mapScreen() }, 'World Tour')]), left, side, h('div.hint', null, 'Arraste para girar o carro · P modo foto'));
    const draw = () => {
      const spec = buildSpec(c.parts, c.tuning), now = ratings(spec);
      const parts2 = { ...c.parts }; if (this.preview && parts2[this.preview] < MAX_LEVEL) parts2[this.preview]++;
      const spec2 = buildSpec(parts2, c.tuning), nxt = ratings(spec2);
      const bar = (name: string, a: number, b: number) => [h('div.stat', null, h('span', null, name), h('span', null, Math.round(b * 100) + '')), h('div.bar', null, h('i.gain', { style: { width: b * 100 + '%' } }), h('i', { style: { width: a * 100 + '%' } }))];
      const dc = h<'canvas'>('canvas.dyno');
      left.replaceChildren(h('div.panel', null, h('h2', null, 'Vento GT'), h('div.stat', null, h('span', null, 'Potência'), h('span', { html: `<b style="color:var(--acc2);font-size:20px">${nxt.hp} cv</b>${nxt.hp !== now.hp ? ' (+' + (nxt.hp - now.hp) + ')' : ''}` })),
        h('div.stat', null, h('span', null, 'Peso'), h('span', null, Math.round(spec2.mass) + ' kg')), h('div', { style: { height: '8px' } }),
        ...bar('Aceleração', now.power, nxt.power), ...bar('Velocidade final', now.top, nxt.top), ...bar('Aderência', now.grip, nxt.grip), ...bar('Frenagem', now.braking, nxt.braking), ...bar('Nitro', now.nitro, nxt.nitro)),
        h('div.panel', null, h('h3', null, 'Dinamômetro'), dc));
      requestAnimationFrame(() => this.dyno(dc, spec, spec2));
      const tabs = h('div.tabs', null, ...['Peças', 'Ajuste', 'Visual'].map((t, i) => h('button' + (this.tab === i ? '.on' : ''), { onclick: () => { this.tab = i; draw(); } }, t)));
      let body: HTMLElement[];
      if (this.tab === 0) body = PART_IDS.map((p) => {
        const lv = c.parts[p], max = lv >= MAX_LEVEL;
        return h('div.part', { onmouseenter: () => { if (this.preview !== p) { this.preview = p; draw(); } } }, h('div', null, PART_INFO[p][0], h('small', null, PART_INFO[p][1])),
          h('div.pips', null, ...[0, 1, 2].map((i) => h('i' + (i < lv ? '.on' : '')))), h('button' + (canBuy(c, p) ? '.pri' : ''), { disabled: !canBuy(c, p), onclick: () => { if (buyPart(c, p)) { saveCareer(c); this.audio.ui('ok'); this.refreshCar(); this.garage(); } } }, max ? 'Máx' : money(priceOf(c, p))));
      });
      else if (this.tab === 1) {
        const sl = (name: string, hint: string, min: number, max: number, get: () => number, set: (v: number) => void) => h('label.row', null, h('span', null, name, h('small', { style: { display: 'block', color: 'var(--dim)' } }, hint)),
          h('input', { type: 'range', min, max, step: 0.01, value: get(), oninput: (e: Event) => { set(+(e.target as HTMLInputElement).value); saveCareer(c); }, onchange: () => draw() }));
        body = [sl('Relação final', 'esquerda: mais final · direita: mais arrancada', 0.85, 1.15, () => c.tuning.gearing, (v) => (c.tuning.gearing = v)),
          sl('Asa', 'mais asa: mais curva, menos reta (exige kit aero)', 0, 1, () => c.tuning.wing, (v) => (c.tuning.wing = v)), sl('Freio dianteiro', 'distribuição da frenagem', 0.5, 0.75, () => c.tuning.bias, (v) => (c.tuning.bias = v))];
      } else body = [h('h3', null, 'Cor'), h('div.sw', null, ...PAINTS.map((col, i) => h('i' + (c.paint === i ? '.on' : ''), { style: { background: col }, onclick: () => { c.paint = i; saveCareer(c); this.refreshCar(); draw(); } }))),
        h('h3', { style: { marginTop: '14px' } }, 'Acabamento'), h('div.tabs', null, ...FINISHES.map((f, i) => h('button' + (c.finish === i ? '.on' : ''), { onclick: () => { c.finish = i; saveCareer(c); this.refreshCar(); draw(); } }, f))),
        h('h3', null, 'Rodas'), h('div.tabs', null, ...['Prata', 'Grafite', 'Ouro'].map((f, i) => h('button' + (c.wheels === i ? '.on' : ''), { onclick: () => { c.wheels = i; saveCareer(c); this.refreshCar(); draw(); } }, f)))];
      side.replaceChildren(h('div.panel', { onmouseleave: () => { if (this.preview) { this.preview = null; draw(); } } }, tabs, ...body));
    };
    draw();
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
    this.ui.append(h('div.center.panel', null, h('h2', null, 'Opções'),
      row('Qualidade gráfica', h('select', { onchange: (e: Event) => { s.quality = (e.target as HTMLSelectElement).value; saveSettings(s); location.reload(); } }, ...QUALITIES.map((q) => h('option', { value: q.id, selected: q.id === this.eng.quality.id }, q.label)))),
      row('Câmbio automático', h('input', { type: 'checkbox', checked: s.auto, onchange: (e: Event) => { s.auto = (e.target as HTMLInputElement).checked; saveSettings(s); } })),
      row('Música', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: a.musicVol, oninput: (e: Event) => { a.musicVol = +(e.target as HTMLInputElement).value; a.saveVol(); r.setVolume(a.musicVol); } })),
      row('Efeitos', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: a.sfxVol, oninput: (e: Event) => { a.sfxVol = +(e.target as HTMLInputElement).value; a.saveVol(); } })),
      h('h3', { style: { marginTop: '14px' } }, 'Rádio online'), h('p', { style: { color: 'var(--dim)', fontSize: '13px', margin: '4px 0 8px' } }, 'Cole o endereço de stream de uma rádio de metal que permita tocar em sites de terceiros. Sem rádio, toca a trilha própria do jogo.'),
      url, h('div', { style: { height: '6px' } }), nm,
      row('Usar rádio', h('input', { type: 'checkbox', checked: s.radioOn, onchange: (e: Event) => { s.radioOn = (e.target as HTMLInputElement).checked; saveSettings(s); } })),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, h('button.pri', { onclick: () => { r.set(url.value, nm.value); r.stop(); this.title(); } }, 'Salvar'), h('button', { onclick: () => { if (confirm('Apagar todo o progresso da carreira?')) { localStorage.removeItem('rh_career'); location.reload(); } } }, 'Zerar carreira'))));
  }

  // ---------- race ----------
  startEvent(ev: RaceEvent) {
    this.endSession(); this.event = ev; this.screen = 'race'; this.clear(); this.globe.show(false); this.show.group.visible = false; this.endTimer = 0; this.lastBeep = 9; this.bestSeen = 0;
    const c = this.career, auto = this.q.get('auto');
    const lvl = (n: number) => buildSpec({ engine: n, turbo: n, gearbox: n, tyres: n, suspension: n, brakes: n, weight: n, aero: n, nitro: n });
    const entrants: Entrant[] = ev.rivals.map((r) => ({ spec: r.parts ? lvl(r.parts) : BASE, driver: r.driver, name: r.driver.name, paint: r.paint }));
    const looks: Look[] = ev.rivals.map((r, i) => ({ paint: r.paint, finish: i % 4, wheels: i % 3, aero: r.parts, lower: r.parts }));
    entrants.push({ spec: buildSpec(c.parts, c.tuning), driver: auto ? { name: 'auto', skill: 0.95, aggression: 0.6, consistency: 1 } : null, name: 'Você', paint: c.paint }); looks.push(this.look());
    const s = (this.session = new Session(this.eng, this.world, this.track, entrants, ev.laps, looks, entrants.length - 1, (Date.now() & 0xffff) | 1, ev.kind === 'trial' ? 0 : 0.5));
    s.me.car.auto = this.settings.auto; s.cam = this.settings.cam;
    if (ev.kind === 'trial' && c.ghost[ev.id]) s.setGhost(c.ghost[ev.id], { ...this.look(), paint: 4 }, 3);
    this.audio.setEngines(1); this.music('brazil');
    const H = this.hud, e = (cls: string, html = '') => h('div.' + cls, { html });
    const mapCv = h<'canvas'>('canvas.map', { width: 380, height: 380 }); this.map = mapCv.getContext('2d')!;
    this.ui.append(h('div.hud', null, (H.pos = e('pos')), (H.lap = e('lap')), (H.time = e('time')), (H.rev = e('rev', '<i></i>')), (H.nos = e('nos', '<i></i>')), (H.gear = e('gear')), (H.speed = e('speed', '<b>0</b><span>KM/H</span>')), mapCv, (H.msg = e('msg')), (H.radio = e('radio'))));
    this.radioChip();
    const t = this.track; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < t.n; i++) { x0 = Math.min(x0, t.px[i]); x1 = Math.max(x1, t.px[i]); z0 = Math.min(z0, t.pz[i]); z1 = Math.max(z1, t.pz[i]); }
    const sc = 340 / Math.max(x1 - x0, z1 - z0); this.mapXY = (x, z) => [190 + (x - (x0 + x1) / 2) * sc, 190 + (z - (z0 + z1) / 2) * sc];
    this.mapPath = []; for (let i = 0; i < t.n; i += 4) this.mapPath.push(this.mapXY(t.px[i], t.pz[i]));
  }
  private mapXY: (x: number, z: number) => [number, number] = () => [0, 0];
  private say(text: string, secs = 1.6, color = '#fff') { const m = this.hud.msg; if (!m) return; m.textContent = text; m.style.color = color; m.classList.add('on'); this.msgT = secs; }

  private raceFrame(dt: number) {
    const s = this.session!, r = s.race, me = s.me, c = me.car, H = this.hud, a = this.audio;
    if (this.controls.hit('Escape') || this.controls.padHit(9)) this.pause(!this.paused);
    if (this.controls.hit('KeyP')) this.togglePhoto();
    if (this.controls.hit('KeyC') || this.controls.padHit(8)) { s.cam = s.cam === 'chase' ? 'hood' : 'chase'; this.settings.cam = s.cam; saveSettings(this.settings); }
    const frozen = this.paused || this.photo, inp = this.controls.read(dt);
    if (this.photo) { s.cam = 'orbit'; if (!this.drag) s.orbit += inp.steer * dt * 1.5; else s.orbit = this.orbit; }
    s.update(frozen ? 0 : dt, me.ai ? null : inp);
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
    H.lap.innerHTML = `VOLTA <b>${Math.min(r.laps, me.lap + 1)}</b>/${r.laps}`;
    H.time.innerHTML = `${clock(r.countdown > 0 || me.finished ? 0 : r.tick - me.lapStart)}<small>melhor ${clock(me.best)}</small>`;
    if (me.best && me.best !== this.bestSeen) { if (this.bestSeen) this.say('MELHOR VOLTA', 1.4, '#3ddc97'); this.bestSeen = me.best; }
    if (me.lap === r.laps - 1 && r.laps > 1 && !this.finalSaid) { this.finalSaid = true; this.say('ÚLTIMA VOLTA', 1.6); }
    // minimap
    const g = this.map; g.clearRect(0, 0, 380, 380); g.lineJoin = 'round'; g.beginPath(); this.mapPath.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 12; g.stroke(); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 5; g.stroke();
    r.racers.forEach((q, i) => { const [x, y] = this.mapXY(q.car.x, q.car.z); g.beginPath(); g.arc(x, y, i === s.player ? 9 : 6, 0, 7); g.fillStyle = i === s.player ? '#ff4b2b' : PAINTS[q.paint % PAINTS.length]; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke(); });
    if (me.finished && !this.endTimer) { this.endTimer = 2.6; this.say('CHEGADA!', 2.4, '#ffb020'); }
    if (this.endTimer && (this.endTimer -= dt) <= 0) this.results();
  }
  private finalSaid = false;
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
      h('table', null, h('tr', null, h('th', null, '#'), h('th', null, 'Piloto'), h('th', null, 'Melhor volta'), h('th', null, 'Total')),
        ...order.map((q) => h('tr' + (q === me ? '.me' : ''), null, h('td', null, String(q.place)), h('td', null, q.name), h('td', null, clock(q.best)), h('td', null, q.finished ? clock(q.finishTick) : '—')))),
      h('p', { html: `Prêmio <b style="color:var(--acc2)">${money(got.money)}</b> · Reputação <b style="color:var(--acc2)">+${got.rep}</b>${got.improved ? '' : ' <small>(repetição paga menos)</small>'}` }),
      ev.kind === 'rival' && place === 1 ? h('p', { style: { color: 'var(--ok)' } }, 'Você é o novo dono da orla. As próximas cidades do World Tour chegam na fase 2.') : null,
      h('div', { style: { display: 'flex', gap: '8px' } }, h('button.pri', { onclick: () => this.mapScreen(CITIES[0]) }, 'Continuar'), h('button', { onclick: () => this.startEvent(ev) }, 'Repetir'), h('button', { onclick: () => this.garage() }, 'Garagem'))));
  }

  // ---------- frame ----------
  private frame() {
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const eng = this.eng, cam = eng.camera;
    if (this.screen === 'race' || (this.screen === 'results' && this.session)) {
      if (this.screen === 'race') this.raceFrame(dt); else { this.session!.cam = 'orbit'; this.session!.orbit += dt * 0.25; this.session!.update(dt, null); }
    } else if (this.screen === 'map') { this.globe.update(dt, this.labels); eng.blur.value = 0; }
    else {
      if (this.controls.hit('KeyP') && this.screen === 'garage') this.togglePhoto();
      if (this.orbitAuto) this.orbit += dt * 0.12;
      const g = this.show.group.position, d = this.screen === 'title' ? 7.4 : 6.6, off = this.screen === 'garage' && !this.photo ? 0.9 : this.screen === 'title' ? -1.2 : 0;
      cam.position.set(g.x + Math.cos(this.orbit) * d, g.y + 1.35, g.z + Math.sin(this.orbit) * d); cam.lookAt(g.x, g.y + 0.6, g.z); cam.translateX(off);
      if (cam.fov !== 40) { cam.fov = 40; cam.updateProjectionMatrix(); }
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
    (window as any).__info = { screen: this.screen, money: this.career.money, rep: this.career.rep, place: this.session?.me.place, lap: this.session?.me.lap, finished: this.session?.me.finished };
    requestAnimationFrame(() => this.frame());
  }
}
