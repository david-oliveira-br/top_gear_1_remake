// All sound is synthesised with Web Audio: a step sequencer driving an analog-style synth, an engine synth and one-shot effects.

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
const _ = null;
const BASS: Record<Song['bass'], (number | null)[]> = {
  eighth: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 12, _],
  gallop: [0, _, 0, 0, _, 0, 0, _, 0, _, 0, 0, _, 0, 12, _],
  sixteenth: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 12],
  half: [0, _, _, _, _, _, 0, _, 0, _, _, _, _, _, 7, _],
};
// song form in 4-bar blocks: intro, build, verse x2, chorus x2, break, verse x2, chorus x2 (then back to the build)
const FORM = ['intro', 'build', 'verse', 'verse', 'chorus', 'chorus', 'break', 'verse', 'verse', 'chorus', 'chorus'] as const;

export class GameAudio {
  ctx: AudioContext | null = null;
  musicVol = 0.6; sfxVol = 0.8;
  master!: GainNode; private musicBus!: GainNode; private sfxBus!: GainNode; private noiseBuf!: AudioBuffer;
  private reverb!: GainNode; private delay!: DelayNode; private delaySend!: GainNode; private duck!: GainNode; private analyser!: AnalyserNode;
  private song: Song | null = null; private songName = ''; private step = 0; private nextTime = 0; private timer = 0;
  private parsed: ReturnType<typeof parseBar>[][] = []; private lastLead = 0;
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
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048;
    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(comp); comp.connect(this.analyser); this.analyser.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVol * 0.5; this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxVol; this.sfxBus.connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // long dark reverb: decaying noise, low-passed more and more along the tail
    const len = Math.floor(ctx.sampleRate * 3.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const b = ir.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) { const t = i / len, k = 0.5 - 0.42 * t; lp += ((Math.random() * 2 - 1) - lp) * k; b[i] = lp * Math.pow(1 - t, 2.6) * (i < 600 ? i / 600 : 1); }
    }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    this.reverb = ctx.createGain(); this.reverb.gain.value = 1; this.reverb.connect(conv);
    const wet = ctx.createGain(); wet.gain.value = 0.9; conv.connect(wet); wet.connect(this.musicBus);
    // dotted-eighth delay for leads and arps
    this.delay = ctx.createDelay(1.5); this.delaySend = ctx.createGain(); this.delaySend.gain.value = 1; this.delaySend.connect(this.delay);
    const fb = ctx.createGain(); fb.gain.value = 0.38; const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2200;
    this.delay.connect(dl); dl.connect(fb); fb.connect(this.delay);
    const dw = ctx.createGain(); dw.gain.value = 0.55; dl.connect(dw); dw.connect(this.musicBus); dw.connect(this.reverb);
    // pads and bass go through a gain that ducks on every kick (the "pump")
    this.duck = ctx.createGain(); this.duck.connect(this.musicBus);
    const chorus = (rate: number, pan: number) => {
      const dly = ctx.createDelay(0.05); dly.delayTime.value = 0.016;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = rate; lg.gain.value = 0.0045; lfo.connect(lg); lg.connect(dly.delayTime); lfo.start();
      const p = ctx.createStereoPanner(); p.pan.value = pan; const g = ctx.createGain(); g.gain.value = 0.6;
      this.duck.connect(dly); dly.connect(g); g.connect(p); p.connect(this.musicBus);
    };
    chorus(0.31, -0.8); chorus(0.43, 0.8);
    if (this.songName) { const n = this.songName; this.songName = ''; this.play(n); }
    clearInterval(this.timer); this.timer = window.setInterval(() => this.schedule(), 40);
  }

  play(name: string) {
    if (name === this.songName) return;
    this.songName = name;
    const s = SONGS[name]; this.song = s ?? null;
    if (!s || !this.ctx) return;
    this.parsed = s.lead.map((ph) => ph.map(parseBar));
    this.step = 0; this.lastLead = 0; this.nextTime = this.ctx.currentTime + 0.12;
    this.delay.delayTime.value = (60 / s.bpm) * 0.75;
  }
  stopMusic() { this.songName = ''; this.song = null; }
  get current() { return this.songName; }
  /** Output level right now (peak and RMS, 0..1) – used by automated checks. */
  level() {
    if (!this.ctx) return { peak: 0, rms: 0 };
    const b = new Float32Array(this.analyser.fftSize); this.analyser.getFloatTimeDomainData(b);
    let peak = 0, sum = 0; for (const v of b) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
    return { peak, rms: Math.sqrt(sum / b.length) };
  }

  /** One analog-style voice: detuned saws through a resonant low-pass with its own filter and amp envelopes. */
  private voice(freq: number, t: number, dur: number, o: { vol: number; cut: number; cutEnd?: number; cutTime?: number; q?: number; atk?: number; rel?: number;
    detune?: number[]; type?: OscillatorType; out?: AudioNode; rev?: number; dly?: number; from?: number; vib?: boolean }) {
    const ctx = this.ctx!, atk = o.atk ?? 0.005, rel = o.rel ?? 0.08;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o.q ?? 1.5;
    f.frequency.setValueAtTime(o.cut, t); f.frequency.exponentialRampToValueAtTime(Math.max(60, o.cutEnd ?? o.cut), t + (o.cutTime ?? dur));
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.vol, t + atk); g.gain.setValueAtTime(o.vol, t + Math.max(atk, dur)); g.gain.linearRampToValueAtTime(0, t + Math.max(atk, dur) + rel);
    const dets = o.detune ?? [0];
    for (const dt of dets) {
      const osc = ctx.createOscillator(); osc.type = o.type ?? 'sawtooth'; osc.detune.value = dt;
      if (o.from) { osc.frequency.setValueAtTime(o.from, t); osc.frequency.exponentialRampToValueAtTime(freq, t + 0.07); } else osc.frequency.value = freq;
      if (o.vib && dur > 0.35) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.2; lg.gain.setValueAtTime(0, t + 0.2); lg.gain.linearRampToValueAtTime(11, t + 0.5); l.connect(lg); lg.connect(osc.detune); l.start(t); l.stop(t + dur + rel + 0.05); }
      const og = ctx.createGain(); og.gain.value = 1 / Math.sqrt(dets.length); osc.connect(og); og.connect(f);
      osc.start(t); osc.stop(t + dur + rel + 0.05);
    }
    f.connect(g); g.connect(o.out ?? this.musicBus);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(this.reverb); }
    if (o.dly) { const s = ctx.createGain(); s.gain.value = o.dly; g.connect(s); s.connect(this.delaySend); }
  }
  private noise(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, bus: AudioNode, gate = false, rev = 0) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t);
    if (gate) { g.gain.setValueAtTime(vol * 0.8, t + dur * 0.92); g.gain.linearRampToValueAtTime(0, t + dur); } else g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    if (rev) { const r = ctx.createGain(); r.gain.value = rev; g.connect(r); r.connect(this.reverb); }
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  private drum(t: number, f0: number, f1: number, dur: number, vol: number) {
    const ctx = this.ctx!; const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + dur + 0.03);
  }
  private kick(t: number, stepDur: number) {
    this.drum(t, 135, 44, 0.34, 1); this.noise(t, 0.012, 0.25, 'highpass', 3000, this.musicBus);
    const g = this.duck.gain; g.cancelScheduledValues(t); g.setValueAtTime(0.32, t); g.linearRampToValueAtTime(1, t + stepDur * 3.2);
  }
  private snare(t: number) { // big gated-reverb snare
    this.drum(t, 210, 150, 0.12, 0.5);
    this.noise(t, 0.16, 0.5, 'bandpass', 1700, this.musicBus);
    this.noise(t, 0.3, 0.2, 'highpass', 900, this.musicBus, true, 0.25);
  }

  private schedule() {
    const ctx = this.ctx, s = this.song;
    if (!ctx || !s) return;
    if (this.nextTime < ctx.currentTime - 0.3) this.nextTime = ctx.currentTime + 0.05; // tab was asleep
    const sd = 60 / s.bpm / 4;
    const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    const deg = (d: number) => s.scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    while (this.nextTime < ctx.currentTime + 0.18) {
      const st = this.step % 16, bar = Math.floor(this.step / 16), blk = Math.floor(bar / 4), b4 = bar % 4, t = this.nextTime;
      const sec = FORM[blk < FORM.length ? blk : 1 + ((blk - 1) % (FORM.length - 1))];
      const chorus = sec === 'chorus', quiet = sec === 'intro' || sec === 'break';
      const chord = s.prog[chorus ? 1 : 0][b4], root = s.root + deg(chord);
      const fill = b4 === 3 && st >= 12 && !quiet && blk % 2 === 1;

      // drums
      if (!quiet || (sec === 'break' && b4 >= 2)) {
        if (fill) { this.drum(t, [200, 160, 125, 95][st - 12], [120, 95, 75, 58][st - 12], 0.28, 0.7); this.noise(t, 0.2, 0.12, 'highpass', 1200, this.musicBus, true, 0.3); }
        else if (s.drums === 'four') { if (st % 4 === 0) this.kick(t, sd); if (st === 4 || st === 12) this.snare(t); }
        else { if (st === 0 || st === 10) this.kick(t, sd); if (st === 8) this.snare(t); }
        if (st % 4 === 2 && sec !== 'build') this.noise(t, st === 14 && chorus ? 0.22 : 0.05, 0.11, 'highpass', 8000, this.musicBus);
        else if (st % 2 === 0 && chorus) this.noise(t, 0.03, 0.05, 'highpass', 9000, this.musicBus);
        if (st === 0 && b4 === 0 && (chorus || sec === 'verse')) this.noise(t, 1.6, chorus ? 0.2 : 0.1, 'highpass', 4500, this.musicBus, false, 0.4);
      }
      // bass: driving octave line, filter opening in the chorus
      const bn = BASS[s.bass][st];
      if (bn !== null && sec !== 'intro' && !(sec === 'break' && st % 8 !== 0)) {
        const top = chorus ? 1500 : 950;
        this.voice(hz(root - 12 + bn), t, sd * (s.bass === 'half' ? 3.4 : 0.9), { vol: 0.5, cut: top, cutEnd: 170, cutTime: 0.16, q: 6, detune: [-5, 5], out: this.duck });
        this.voice(hz(root - 24 + (bn === 12 ? 12 : 0)), t, sd * 0.9, { vol: 0.3, cut: 300, type: 'sine', out: this.duck });
      }
      // pad: slow, wide minor chords
      if (st === 0) {
        const cut = quiet ? 700 : chorus ? 1900 : 1200;
        for (const k of [0, 2, 4, 7]) this.voice(hz(s.root + 12 + deg(chord + k) - (k === 7 ? 24 : 0)), t, sd * 15.5, { vol: k === 7 ? 0.1 : 0.085, cut: cut * 0.5, cutEnd: cut, cutTime: sd * 10, q: 0.8, atk: 0.35, rel: 0.7, detune: [-11, 0, 11], out: this.duck, rev: 0.5 });
      }
      // arpeggio: muted pluck with delay
      if ((s.arp === 16 || st % 2 === 0) && sec !== 'build') {
        const i = s.arp === 16 ? st : st / 2, pat = [0, 2, 4, 7, 4, 2, 4, 7];
        this.voice(hz(s.root + 12 + deg(chord + pat[i % 8])), t, sd * 0.5, { vol: quiet ? 0.085 : 0.055, cut: chorus ? 2600 : 1700, cutEnd: 300, cutTime: 0.14, q: 3, rel: 0.1, dly: 0.5, rev: 0.25 });
      }
      // lead: sparse, gliding
      if (sec === 'verse' || chorus) {
        for (const n of this.parsed[chorus ? 1 : 0][b4]) if (n.step === st) {
          const f = hz(s.root + 12 + deg(n.deg)), d = sd * n.len * 0.96;
          this.voice(f, t, d, { vol: 0.15, cut: 900, cutEnd: chorus ? 3000 : 2200, cutTime: 0.12, q: 2, atk: 0.03, rel: 0.25, detune: [-8, 8], rev: 0.45, dly: 0.35, vib: true, from: this.lastLead && Math.abs(this.lastLead - f) < f * 0.45 ? this.lastLead : undefined });
          if (chorus) this.voice(f / 2, t, d, { vol: 0.07, cut: 1400, type: 'square', atk: 0.03, rel: 0.25, rev: 0.3 });
          this.lastLead = f;
        }
      }
      this.step++; this.nextTime += sd;
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
  ui(kind: 'move' | 'ok' | 'back') { this.beep(kind === 'move' ? 330 : kind === 'ok' ? 494 : 220, 0.09, 0.1, 'sine'); }
}
