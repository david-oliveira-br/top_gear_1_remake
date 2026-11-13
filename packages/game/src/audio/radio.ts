export interface Station { id: string; name: string; url: string; site: string; genres: string; note: string; }
/**
 * Stations offered in the game. MELODEATH.AI is a non-commercial art project whose tracks are generated with Suno; it
 * publishes no terms of use, so the game treats it as personal, non-commercial listening and credits it on screen.
 */
export const STATIONS: Station[] = [
  { id: 'melodeath', name: 'MELODEATH.AI Radio', url: 'https://a7.asurahosting.com/listen/melodeath.ai_radio_station/radio.mp3', site: 'https://www.ai-metal-radio-station.nl/',
    genres: 'melodic death, power, folk, viking, 80s e cyber metal', note: 'Metal gerado por IA, 24h' },
];
export const CUSTOM = 'custom';

/** Internet radio player. Falls back to the built-in soundtrack through `onFail` when the stream cannot play. */
export class Radio {
  el: HTMLAudioElement | null = null; url = ''; name = ''; playing = false; error = ''; station = STATIONS[0].id; onFail: (() => void) | null = null; private timer = 0;
  private analyser: AnalyserNode | null = null; private gain: GainNode | null = null; private buf = new Uint8Array(64); private avg = 0;
  volume = 0.7; onChange: (() => void) | null = null;
  constructor() {
    try { const s = JSON.parse(localStorage.getItem('rh_radio') || '{}'); this.volume = s.vol ?? 0.7; if (s.station) this.station = s.station; this.url = s.url || ''; this.name = s.name || ''; } catch { /* ignore */ }
    this.apply();
  }
  /** Fill url and name from the chosen station. */
  private apply() { const st = STATIONS.find((x) => x.id === this.station); if (st) { this.url = st.url; this.name = st.name; } else this.station = CUSTOM; }
  get current(): Station | null { return STATIONS.find((x) => x.id === this.station) ?? null; }
  save() { localStorage.setItem('rh_radio', JSON.stringify({ station: this.station, url: this.station === CUSTOM ? this.url : '', name: this.station === CUSTOM ? this.name : '', vol: this.volume })); }
  choose(id: string) { this.stop(); this.station = id; this.apply(); this.save(); }
  set(url: string, name: string) { this.station = CUSTOM; this.url = url.trim(); this.name = name.trim() || this.url.replace(/^https?:\/\//, '').split('/')[0]; this.save(); }

  /** Start the stream. With an AudioContext the stream is analysed for the beat when the station allows cross-origin use. */
  play(ctx: AudioContext | null, out: AudioNode | null) {
    this.stop(); if (!/^https?:\/\//.test(this.url)) { this.error = this.url ? 'Endereço inválido' : ''; this.onChange?.(); return; }
    const start = (cors: boolean) => {
      const el = (this.el = new Audio()); if (cors) el.crossOrigin = 'anonymous'; el.src = this.url; el.preload = 'none'; el.volume = cors ? 1 : this.volume;
      el.onplaying = () => { clearTimeout(this.timer); this.playing = true; this.error = ''; this.onChange?.(); };
      el.onerror = () => { if (this.el !== el) return; if (cors) { start(false); return; } this.fail(); };
      if (cors && ctx && out) {
        try { const src = ctx.createMediaElementSource(el); this.gain = ctx.createGain(); this.gain.gain.value = this.volume; this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 128; src.connect(this.analyser); this.analyser.connect(this.gain); this.gain.connect(out); }
        catch { this.analyser = null; this.gain = null; }
      } else { this.analyser = null; this.gain = null; }
      void el.play().catch(() => { if (this.el === el && !cors) { this.error = 'Clique para liberar o áudio'; this.onChange?.(); } });
    };
    start(true);
    clearTimeout(this.timer); this.timer = window.setTimeout(() => { if (!this.playing && this.el) this.fail(); }, 9000); // no sound after 9 s: give up
  }
  private fail() { clearTimeout(this.timer); this.stop(); this.error = 'Rádio fora do ar — tocando a trilha do jogo'; this.onChange?.(); this.onFail?.(); }
  stop() { clearTimeout(this.timer); if (this.el) { const e = this.el; this.el = null; e.onerror = null; e.pause(); e.removeAttribute('src'); e.load(); } this.gain?.disconnect(); this.gain = null; this.analyser = null; this.playing = false; this.onChange?.(); }
  setVolume(v: number) { this.volume = v; if (this.gain) this.gain.gain.value = v; else if (this.el) this.el.volume = v; this.save(); }
  /** Lower the music briefly (race start, crashes). k = 0..1 */
  duck(k: number) { const v = this.volume * (1 - 0.7 * k); if (this.gain) this.gain.gain.value = v; else if (this.el) this.el.volume = v; }
  /** Bass pulse 0..1 for lights that move with the music; 0 when the stream cannot be analysed. */
  beat() {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getByteFrequencyData(this.buf); const e = (this.buf[1] + this.buf[2] + this.buf[3] + this.buf[4]) / 1020;
    this.avg += (e - this.avg) * 0.05; return Math.max(0, Math.min(1, (e - this.avg) * 4 + 0.15 * e));
  }
}
