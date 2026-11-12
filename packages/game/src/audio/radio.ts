/**
 * Internet radio player. The game ships no preset station: stations decide who may embed their stream, so the
 * player pastes the address of a stream they are allowed to use. Falls back to the built-in soundtrack.
 */
export class Radio {
  el: HTMLAudioElement | null = null; url = ''; name = ''; playing = false; error = '';
  private analyser: AnalyserNode | null = null; private gain: GainNode | null = null; private buf = new Uint8Array(64); private avg = 0;
  volume = 0.7; onChange: (() => void) | null = null;
  constructor() { try { const s = JSON.parse(localStorage.getItem('rh_radio') || '{}'); this.url = s.url || ''; this.name = s.name || ''; this.volume = s.vol ?? 0.7; } catch { /* ignore */ } }
  save() { localStorage.setItem('rh_radio', JSON.stringify({ url: this.url, name: this.name, vol: this.volume })); }
  set(url: string, name: string) { this.url = url.trim(); this.name = name.trim() || this.url.replace(/^https?:\/\//, '').split('/')[0]; this.save(); }

  /** Start the stream. With an AudioContext the stream is analysed for the beat when the station allows cross-origin use. */
  play(ctx: AudioContext | null, out: AudioNode | null) {
    this.stop(); if (!/^https?:\/\//.test(this.url)) { this.error = this.url ? 'Endereço inválido' : ''; this.onChange?.(); return; }
    const start = (cors: boolean) => {
      const el = (this.el = new Audio()); if (cors) el.crossOrigin = 'anonymous'; el.src = this.url; el.preload = 'none'; el.volume = cors ? 1 : this.volume;
      el.onplaying = () => { this.playing = true; this.error = ''; this.onChange?.(); };
      el.onerror = () => { if (this.el !== el) return; if (cors) { start(false); return; } this.playing = false; this.error = 'Não foi possível tocar esta rádio'; this.onChange?.(); };
      if (cors && ctx && out) {
        try { const src = ctx.createMediaElementSource(el); this.gain = ctx.createGain(); this.gain.gain.value = this.volume; this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 128; src.connect(this.analyser); this.analyser.connect(this.gain); this.gain.connect(out); }
        catch { this.analyser = null; this.gain = null; }
      } else { this.analyser = null; this.gain = null; }
      void el.play().catch(() => { if (this.el === el && !cors) { this.error = 'Clique para liberar o áudio'; this.onChange?.(); } });
    };
    start(true);
  }
  stop() { if (this.el) { const e = this.el; this.el = null; e.onerror = null; e.pause(); e.removeAttribute('src'); e.load(); } this.gain?.disconnect(); this.gain = null; this.analyser = null; this.playing = false; this.onChange?.(); }
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
