// All sound is synthesised with Web Audio: a small step sequencer for music, an engine synth and one-shot effects.

import { SONGS, type Song } from './songs';

function parseBar(s: string): { step: number; deg: number; len: number }[] {
  const out: { step: number; deg: number; len: number }[] = [];
  let step = 0;
  for (const tok of s.trim().split(/\s+/)) {
    const [d, l] = tok.split(':'); const len = Math.max(1, parseInt(l, 10) || 1);
    if (d !== '-' && step < 16) out.push({ step, deg: parseInt(d, 10), len: Math.min(len, 16 - step) });
    step += len;
  }
  return out;
}

export class GameAudio {
  ctx: AudioContext | null = null;
  musicVol = 0.6; sfxVol = 0.8;
  private master!: GainNode; private musicBus!: GainNode; private sfxBus!: GainNode; private delay!: DelayNode; private noiseBuf!: AudioBuffer;
  private song: Song | null = null; private songName = ''; private step = 0; private nextTime = 0; private timer = 0;
  private parsed: ReturnType<typeof parseBar>[][] = [];
  private pulse!: PeriodicWave; private lastLead = 0;
  private engines: { o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; f: BiquadFilterNode; g: GainNode; skid: GainNode; whoosh: GainNode }[] = [];

  constructor() {
    try { const s = JSON.parse(localStorage.getItem('rc_audio') || '{}'); this.musicVol = s.m ?? 0.6; this.sfxVol = s.s ?? 0.8; } catch { /* ignore */ }
  }
  saveVol() {
    localStorage.setItem('rc_audio', JSON.stringify({ m: this.musicVol, s: this.sfxVol }));
    if (this.ctx) { this.musicBus.gain.value = this.musicVol * 0.5; this.sfxBus.gain.value = this.sfxVol; }
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(comp); comp.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVol * 0.5; this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxVol; this.sfxBus.connect(this.master);
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.28;
    const fb = ctx.createGain(); fb.gain.value = 0.32; this.delay.connect(fb); fb.connect(this.delay);
    const wet = ctx.createGain(); wet.gain.value = 0.35; this.delay.connect(wet); wet.connect(this.musicBus);
    const re = new Float32Array(32), im = new Float32Array(32);
    for (let n = 1; n < 32; n++) im[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.27); // 27% duty pulse
    this.pulse = ctx.createPeriodicWave(re, im);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (this.songName) { const n = this.songName; this.songName = ''; this.play(n); }
    clearInterval(this.timer); this.timer = window.setInterval(() => this.schedule(), 40);
  }

  play(name: string) {
    if (name === this.songName) return;
    this.songName = name;
    const s = SONGS[name]; this.song = s ?? null;
    if (!s || !this.ctx) return;
    this.parsed = s.lead.map((ph) => ph.map(parseBar));
    this.step = 0; this.lastLead = 0; this.nextTime = this.ctx.currentTime + 0.1;
    this.delay.delayTime.value = (60 / s.bpm) * 0.75;
  }
  stopMusic() { this.songName = ''; this.song = null; }
  get current() { return this.songName; }

  private note(freq: number, t: number, dur: number, type: OscillatorType | 'pulse', vol: number, cutoff: number, send = 0, detune = 0, o2: { from?: number; vib?: boolean; q?: number; decay?: number } = {}) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    if (type === 'pulse') o.setPeriodicWave(this.pulse); else o.type = type;
    o.detune.value = detune;
    if (o2.from) { o.frequency.setValueAtTime(o2.from, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.035); } else o.frequency.value = freq;
    if (o2.vib && dur > 0.22) {
      const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.6;
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(14, t + Math.min(dur, 0.3));
      l.connect(lg); lg.connect(o.detune); l.start(t); l.stop(t + dur + 0.02);
    }
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o2.q ?? 1;
    f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(Math.max(180, cutoff * 0.35), t + (o2.decay ?? dur));
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.006); g.gain.setValueAtTime(vol, t + dur * 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicBus);
    if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(this.delay); }
    o.start(t); o.stop(t + dur + 0.02);
  }
  private noise(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, bus: AudioNode) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  private drum(t: number, f0: number, f1: number, dur: number, vol: number) {
    const ctx = this.ctx!; const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + dur + 0.03);
  }

  private schedule() {
    const ctx = this.ctx, s = this.song;
    if (!ctx || !s) return;
    if (this.nextTime < ctx.currentTime - 0.3) this.nextTime = ctx.currentTime + 0.05; // tab was asleep
    const stepDur = 60 / s.bpm / 4;
    const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    const deg = (d: number) => s.scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    while (this.nextTime < ctx.currentTime + 0.15) {
      const st = this.step % 16, bar = Math.floor(this.step / 16), section = Math.floor(bar / 4), b4 = bar % 4;
      const t = this.nextTime + (st % 2 ? (s.swing ?? 0) * stepDur : 0);
      // song form: intro, A, A, chorus, A, chorus, bridge, final chorus (up a tone, doubled)
      const sec = section === 0 ? 0 : ((section - 1) % 7) + 1;
      const chorus = sec === 3 || sec === 5 || sec === 7, bridge = sec === 6, final = sec === 7;
      const key = s.root + (final ? 2 : 0);
      const chord = (chorus && s.progB ? s.progB : s.prog)[b4 % 4];
      const fill = b4 === 3 && st >= 12 && sec > 0;
      if (st === 0 && b4 === 0 && sec > 0) this.noise(t, 1.1, chorus ? 0.3 : 0.16, 'highpass', 5200, this.musicBus); // crash
      if (sec > 0 || b4 >= 2) {
        if (fill) { this.drum(t, [230, 180, 140, 105][st - 12], [150, 115, 90, 70][st - 12], 0.2, 0.6); if (st >= 14) this.noise(t, 0.1, 0.3, 'bandpass', 1900, this.musicBus); }
        else {
          if (s.kick[st] === 'x' && !(bridge && b4 < 2)) this.drum(t, 150, 42, 0.22, 0.9);
          if (s.snare[st] === 'x') { this.noise(t, 0.16, 0.4, 'bandpass', 1900, this.musicBus); this.note(190, t, 0.08, 'triangle', 0.25, 900); }
          if (s.hat[st] === 'x') this.noise(t, st % 4 === 2 && chorus ? 0.12 : 0.04, st % 4 === 2 ? 0.16 : 0.09, 'highpass', 7500, this.musicBus);
        }
      }
      const bn = s.bass[st];
      if (bn !== null && !(bridge && b4 < 2 && st % 8 !== 0)) {
        const pop = bn >= 12;
        this.note(hz(key - 12 + deg(chord) + bn), t, stepDur * (pop ? 0.8 : 1.6), 'sawtooth', pop ? 0.26 : 0.34, pop ? 2600 : 1500, 0, 0, { q: 7, decay: 0.11 });
        this.note(hz(key - 24 + deg(chord) + (pop ? 12 : bn)), t, stepDur * 1.4, 'square', 0.14, 500);
      }
      if (sec > 0 || b4 % 2 === 1) this.note(hz(key + 12 + deg(chord + s.arp[st])), t, stepDur * 0.9, 'square', bridge ? 0.1 : 0.06, bridge ? 3400 : 2400, 0.5);
      if (st === 0) for (const k of [0, 2, 4]) this.note(hz(key + deg(chord + k)), t, stepDur * 16, 'sawtooth', chorus ? 0.055 : 0.04, 1100, 0, k * 6 - 6);
      if (sec > 0 && !bridge) {
        const phrase = this.parsed[chorus ? 1 : 0][b4];
        for (const n of phrase) if (n.step === st) {
          const f = hz(key + 12 + deg(n.deg)), d = stepDur * n.len * 0.94;
          this.note(f, t, d, s.wave, 0.15, 3400, 0.4, 0, { from: this.lastLead && Math.abs(this.lastLead - f) < f * 0.35 ? this.lastLead : undefined, vib: true });
          this.note(f, t, d, s.wave === 'pulse' ? 'sawtooth' : s.wave, 0.05, 2600, 0, 9);
          if (final) this.note(f * 2, t, d, 'triangle', 0.07, 4200, 0.3);
          this.lastLead = f;
        }
      }
      this.step++; this.nextTime += stepDur;
    }
  }

  // ---- engine / continuous sounds ----
  setEngines(n: number) {
    const ctx = this.ctx; if (!ctx) return;
    while (this.engines.length > n) { const e = this.engines.pop()!; e.o1.stop(); e.o2.stop(); e.o3.stop(); e.g.disconnect(); e.skid.disconnect(); e.whoosh.disconnect(); }
    while (this.engines.length < n) {
      const pan = ctx.createStereoPanner(); pan.pan.value = n === 2 ? (this.engines.length ? 0.5 : -0.5) : 0; pan.connect(this.sfxBus);
      const g = ctx.createGain(); g.gain.value = 0; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 2;
      const mk = (type: OscillatorType, vol: number) => { const o = ctx.createOscillator(); o.type = type; const v = ctx.createGain(); v.gain.value = vol; o.connect(v); v.connect(f); o.start(); return o; };
      const o1 = mk('sawtooth', 0.5), o2 = mk('square', 0.3), o3 = mk('sawtooth', 0.25);
      f.connect(g); g.connect(pan);
      const loop = (type: BiquadFilterType, freq: number) => {
        const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; const bf = ctx.createBiquadFilter(); bf.type = type; bf.frequency.value = freq; bf.Q.value = 1.5;
        const gg = ctx.createGain(); gg.gain.value = 0; s.connect(bf); bf.connect(gg); gg.connect(pan); s.start(); return gg;
      };
      this.engines.push({ o1, o2, o3, f, g, skid: loop('bandpass', 1400), whoosh: loop('highpass', 2500) });
    }
  }
  updateEngine(i: number, rpm: number, load: number, skid: number, nitro: boolean) {
    const e = this.engines[i], ctx = this.ctx; if (!e || !ctx) return;
    const t = ctx.currentTime, f = 52 + Math.min(1.15, rpm) * 150;
    e.o1.frequency.setTargetAtTime(f, t, 0.03); e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03); e.o3.frequency.setTargetAtTime(f * 1.505, t, 0.03);
    e.f.frequency.setTargetAtTime(350 + rpm * 1500 + load * 900, t, 0.05);
    e.g.gain.setTargetAtTime(0.1 + load * 0.1, t, 0.05);
    e.skid.gain.setTargetAtTime(skid * 0.22, t, 0.05);
    e.whoosh.gain.setTargetAtTime(nitro ? 0.3 : 0, t, 0.08);
  }

  // ---- one-shots ----
  beep(freq: number, dur = 0.15, vol = 0.3, type: OscillatorType = 'square') {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.02);
  }
  bump() { const c = this.ctx; if (!c) return; this.noise(c.currentTime, 0.2, 0.7, 'lowpass', 500, this.sfxBus); this.beep(70, 0.18, 0.6, 'sine'); }
  shift() { const c = this.ctx; if (!c) return; this.noise(c.currentTime, 0.05, 0.25, 'bandpass', 2400, this.sfxBus); }
  nitro() { const c = this.ctx; if (!c) return; this.noise(c.currentTime, 0.6, 0.5, 'bandpass', 900, this.sfxBus); this.beep(220, 0.4, 0.15, 'sawtooth'); }
  ui(kind: 'move' | 'ok' | 'back') { this.beep(kind === 'move' ? 520 : kind === 'ok' ? 780 : 300, 0.07, 0.12, 'triangle'); }
}
