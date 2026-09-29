// Fully procedural sound: Karplus–Strong string, FM bells, filtered-noise
// whooshes and a drifting drone, all routed through a generated reverb.
const PENTA = [0, 2, 4, 7, 9];

export class Audio {
  constructor() { this.ctx = null; this.enabled = false; this.cache = new Map(); }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.dry = ctx.createGain(); this.dry.connect(this.master);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(4.2, 2.6);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.55;
    this.verb.connect(this.wet).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.dry); this.bus.connect(this.verb);
    this.noiseBuf = this.makeNoise(2);
    this.drone();
    this.tension();
  }

  setEnabled(on) {
    this.init();
    if (!this.ctx) return;
    this.enabled = on;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, t, 0.4);
  }

  get ok() { return this.ctx && this.enabled; }

  impulse(sec, decay) {
    const sr = this.ctx.sampleRate, len = sr * sec;
    const b = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  makeNoise(sec) {
    const sr = this.ctx.sampleRate, b = this.ctx.createBuffer(1, sr * sec, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  drone() {
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = 0.05;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 2;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 300;
    lfo.connect(lfoG).connect(lp.frequency); lfo.start();
    for (const [f, type, g] of [[55, 'sawtooth', 0.5], [55.3, 'sawtooth', 0.5], [82.4, 'triangle', 0.6], [110.2, 'sine', 0.5], [164.8, 'sine', 0.2]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const gg = ctx.createGain(); gg.gain.value = g;
      o.connect(gg).connect(lp); o.start();
    }
    lp.connect(out).connect(this.bus);
    // sparse celestial chimes
    const chime = () => {
      if (this.ok && Math.random() < 0.7) {
        const n = PENTA[(Math.random() * 5) | 0] + 12 * (2 + ((Math.random() * 2) | 0));
        this.bell(220 * Math.pow(2, n / 12) / 2, 0.025, 3.5);
      }
      setTimeout(chime, 2500 + Math.random() * 4000);
    };
    setTimeout(chime, 3000);
  }

  tension() {
    const ctx = this.ctx;
    this.tG = ctx.createGain(); this.tG.gain.value = 0;
    this.tO = ctx.createOscillator(); this.tO.type = 'sawtooth'; this.tO.frequency.value = 50;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6; bp.frequency.value = 300;
    this.tBP = bp;
    this.tO2 = ctx.createOscillator(); this.tO2.type = 'sine'; this.tO2.frequency.value = 400;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    this.tO.connect(bp).connect(this.tG);
    this.tO2.connect(g2).connect(this.tG);
    this.tG.connect(this.bus);
    this.tO.start(); this.tO2.start();
  }

  setTension(d, charge = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tG.gain.setTargetAtTime(d > 0.001 ? 0.018 + d * 0.035 + charge * 0.04 : 0, t, 0.05);
    this.tO.frequency.setTargetAtTime(40 + d * 50, t, 0.05);
    this.tBP.frequency.setTargetAtTime(200 + d * 900, t, 0.05);
    this.tO2.frequency.setTargetAtTime(300 + d * 700 + charge * 900, t, 0.08);
  }

  ks(freq) {
    const key = Math.round(freq);
    if (this.cache.has(key)) return this.cache.get(key);
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 2.6);
    const b = this.ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    const N = Math.max(2, Math.round(sr / freq));
    let last = 0;
    for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; last = last * 0.5 + r * 0.5; d[i] = last; }
    for (let i = N; i < len; i++) d[i] = 0.4985 * (d[i - N] + d[i - N + 1 < i ? i - N + 1 : i - N]);
    this.cache.set(key, b);
    return b;
  }

  pluck(freq, vol = 0.4) {
    if (!this.ok) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.ks(freq);
    const g = this.ctx.createGain(); g.gain.value = vol;
    s.connect(g).connect(this.bus); s.start();
  }

  harp(u) {
    const n = PENTA[Math.floor(u * 10) % 5] + 12 * Math.floor(u * 2);
    this.pluck(196 * Math.pow(2, n / 12), 0.28);
  }

  bell(freq, vol = 0.2, dur = 2.2) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const car = ctx.createOscillator(); car.frequency.value = freq;
    const mod = ctx.createOscillator(); mod.frequency.value = freq * 3.5;
    const mg = ctx.createGain(); mg.gain.setValueAtTime(freq * 2.2, t); mg.gain.exponentialRampToValueAtTime(1, t + dur);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g).connect(this.bus);
    car.start(t); mod.start(t); car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
  }

  whoosh(power = 1, dur = 0.5) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(3000 * power + 600, t); bp.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * power + 0.05, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp).connect(g).connect(this.bus); s.start(t); s.stop(t + dur + 0.05);
  }

  boom(vol = 0.6) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g).connect(this.bus); o.start(t); o.stop(t + 1.7);
    this.whoosh(0.6, 1.2);
  }

  release(power, nova) {
    this.pluck(98 + power * 30, 0.5);
    this.whoosh(power, 0.45 + power * 0.2);
    if (nova) { this.boom(0.5); this.bell(880, 0.15, 2.5); }
  }

  hit(combo) {
    const n = PENTA[combo % 5] + 12 * Math.min(2, Math.floor(combo / 5));
    const f = 440 * Math.pow(2, n / 12);
    this.bell(f, 0.22, 2.6);
    this.bell(f * 2, 0.06, 1.4);
  }

  complete() {
    [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => setTimeout(() => this.bell(261.6 * Math.pow(2, n / 12), 0.16, 3.5), i * 110));
    this.boom(0.7);
  }

  miss() { if (this.ok) this.pluck(73, 0.2); }

  tick() {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.value = 2400 + Math.random() * 600;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.02, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(this.dry); o.start(t); o.stop(t + 0.07);
  }
}
