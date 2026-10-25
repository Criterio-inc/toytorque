import { mtof } from './synth.js';

// ---------------------------------------------------------------------------
// Procedurell musik i sena 90-talets racingstil: trummor, acid-aktig bas,
// arpeggio och lead. 16-delssteg, schemaläggs med framförhållning.
//
// Spår: kick/snare/clap/hat/ohat = 16 tecken ('x' slag, 'g' spökslag).
// bass: siffra = skalsteg över ackordets grundton, '8' = oktav upp, '.' = paus.
// prog = ackordens skalsteg (ett per takt). Melodin genereras ur seed.
// ---------------------------------------------------------------------------

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixo: [0, 2, 4, 5, 7, 9, 10],
};

export const TRACKS = {
  menu: {
    bpm: 118, root: 45, scale: 'dorian', prog: [0, 3, 5, 4], swing: 0.12, seed: 7, lead: 'tri',
    kick: 'x.....x...x.....', snare: '....x.......x..g', clap: '', hat: 'x.x.x.x.x.x.x.xx', ohat: '',
    bass: '0..0..8.0..4..3.', arp: 'x.x.x.x.x.x.x.x.',
  },
  lagret: {
    bpm: 134, root: 40, scale: 'minor', prog: [0, 0, 5, 3], swing: 0, seed: 11, lead: 'saw',
    kick: 'x...x...x...x...', snare: '', clap: '....x.......x...', hat: '..x...x...x...x.', ohat: '..x...x...x...x.',
    bass: '0.80.80.0.808.80', arp: 'xxx.xx.xxx.xx.x.',
  },
  stuntarena: {
    bpm: 128, root: 41, scale: 'mixo', prog: [0, 4, 6, 3], swing: 0.06, seed: 77, lead: 'saw',
    kick: 'x...x...x...x.x.', snare: '....x.......x...', clap: '....x.......x..x', hat: 'x.xxx.xxx.xxx.xx', ohat: '..x...x...x...x.',
    bass: '0.0.8.0.4.4.3.2.', arp: 'x.xx.xx.x.xx.xx.',
  },
  kitchen: {
    bpm: 140, root: 43, scale: 'mixo', prog: [0, 3, 6, 3], swing: 0.08, seed: 23, lead: 'square',
    kick: 'x.....x.x.x.....', snare: '....x..g.g..x...', clap: '', hat: 'xxxxxxxxxxxxxxxx', ohat: '......x.......x.',
    bass: '0.0..8.00.4..3.2', arp: 'x..x..x..x..x.x.',
  },
  spokstaden: {
    bpm: 126, root: 38, scale: 'phrygian', prog: [0, 1, 0, 6], swing: 0.05, seed: 5, lead: 'organ',
    kick: 'x..x....x..x....', snare: '....x.......x...', clap: '', hat: '..x...x...x..xx.', ohat: '',
    bass: '0..0..1.0..0.6..', arp: 'x...x.x.x...x.x.',
  },
  kryssaren: {
    bpm: 136, root: 41, scale: 'minor', prog: [0, 5, 2, 6], swing: 0, seed: 31, lead: 'saw',
    kick: 'x...x...x...x..x', snare: '', clap: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx', ohat: '..x...x...x...x.',
    bass: '08080808.8080808', arp: 'xx.xx.xx.xx.xx.x',
  },
  tradgarden: {
    bpm: 142, root: 36, scale: 'lydian', prog: [0, 1, 4, 3], swing: 0.1, seed: 47, lead: 'square',
    kick: 'x.....x...x..x..', snare: '....x.......x..g', clap: '....x.......x...', hat: 'x.x.xxx.x.x.xxx.', ohat: '',
    bass: '0.8..0.4.0.8..5.', arp: 'x.xx.xx.x.xx.xx.',
  },
};

// Enkel deterministisk slump så varje bana alltid låter likadant
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class Music {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.out = out;
    this.noise = noise;
    this.id = null;
    this.timer = null;
    this.paused = false;
    // Delay för lead/arp (skapas en gång)
    this.delay = ctx.createDelay(1);
    this.fb = ctx.createGain();
    this.fb.gain.value = 0.32;
    this.delayLp = ctx.createBiquadFilter();
    this.delayLp.type = 'lowpass';
    this.delayLp.frequency.value = 2500;
    this.delayOut = ctx.createGain();
    this.delayOut.gain.value = 0.3;
    this.delay.connect(this.delayLp).connect(this.fb).connect(this.delay);
    this.delayLp.connect(this.delayOut).connect(out);
  }

  play(id) {
    const T = TRACKS[id] || TRACKS.menu;
    if (id === this.id && this.timer) return;
    this.stop(0.4);
    this.id = id;
    this.T = T;
    this.scale = SCALES[T.scale] || SCALES.minor;
    this.stepDur = 60 / T.bpm / 4;
    this.delay.delayTime.value = this.stepDur * 3;
    this._makeMelody(T);
    const t = this.ctx.currentTime;
    this.bus = this.ctx.createGain();
    this.bus.gain.setValueAtTime(0.0001, t);
    this.bus.gain.exponentialRampToValueAtTime(1, t + 0.4);
    this.bus.connect(this.out);
    this.send = this.ctx.createGain();
    this.send.gain.value = 1;
    this.send.connect(this.delay);
    this.step = 0;
    this.nextTime = t + 0.1;
    this.paused = false;
    this._start();
  }

  stop(fade = 0.5) {
    this._halt();
    if (this.bus) {
      const b = this.bus, s = this.send, t = this.ctx.currentTime;
      b.gain.cancelScheduledValues(t);
      b.gain.setTargetAtTime(0, t, fade / 4);
      setTimeout(() => { b.disconnect(); s.disconnect(); }, fade * 1000 + 600);
      this.bus = null;
    }
    this.id = null;
  }

  // Paus: tona ut och sluta schemalägga; fortsätt där vi var
  pause() {
    if (!this.bus || this.paused) return;
    this.paused = true;
    this._halt();
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(0.0001, t, 0.08);
  }

  resume() {
    if (!this.bus || !this.paused) return;
    this.paused = false;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(1, t + 0.05, 0.1);
    this.nextTime = t + 0.08;
    this._start();
  }

  _start() {
    this._halt();
    this.timer = setInterval(() => this._tick(), 25);
    this._tick();
  }

  _halt() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  _tick() {
    const ahead = this.ctx.currentTime + 0.12;
    // Om fliken legat dold: hoppa fram i stället för att spela ikapp
    if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.02;
    this.scheduleUntil(ahead);
  }

  // Schemalägger alla steg fram till tiden t1 (används också av självtestet)
  scheduleUntil(t1) {
    while (this.nextTime < t1) {
      const swing = this.step % 2 ? this.T.swing * this.stepDur : 0;
      this._playStep(this.step, this.nextTime + swing);
      this.nextTime += this.stepDur;
      this.step++;
    }
  }

  _makeMelody(T) {
    const r = rng(T.seed);
    this.melody = [];
    for (let i = 0; i < 32; i++) {
      const on = i % 4 === 0 ? r() < 0.75 : r() < 0.35;
      this.melody.push(on ? { deg: [0, 2, 4, 4, 7, 1, 5, 2][Math.floor(r() * 8)], len: r() < 0.3 ? 3 : 1 } : null);
    }
  }

  _midi(deg, oct = 0) {
    const sc = this.scale, n = sc.length;
    const o = Math.floor(deg / n);
    return this.T.root + sc[((deg % n) + n) % n] + 12 * (o + oct);
  }

  _playStep(i, t) {
    const T = this.T, s = i % 16, bar = Math.floor(i / 16), sec = bar % 16;
    const chord = T.prog[bar % T.prog.length];
    const hit = (pat) => pat && pat[s] !== '.' && pat[s] !== undefined ? pat[s] : null;
    const intro = bar < 2;
    const breakdown = sec === 14;
    const fill = sec === 15 && s >= 8;

    if (!breakdown) {
      if (hit(T.kick)) this.kick(t);
      const sn = hit(T.snare);
      if (!intro && sn) this.snare(t, sn === 'g' ? 0.3 : 1);
      if (!intro && hit(T.clap)) this.clap(t);
      if (hit(T.hat)) this.hat(t, false, s % 4 === 0 ? 1 : 0.6);
      if (sec >= 8 && hit(T.ohat)) this.hat(t, true, 0.7);
    }
    if (fill) this.snare(t, 0.4 + (s - 8) * 0.08);

    const b = hit(T.bass);
    if (b && !breakdown) {
      const deg = b === '8' ? chord + 7 : chord + +b;
      this.bass(t, mtof(this._midi(deg)), this.stepDur * 0.9, s % 4 === 0 ? 1 : 0.75);
    }
    if (sec >= 2 && hit(T.arp)) {
      const tones = [0, 2, 4, 7];
      this.arp(t, mtof(this._midi(chord + tones[(i >> 0) % 4], 2)), this.stepDur * 0.8);
    }
    if (sec >= 8 && sec < 16) {
      const m = this.melody[(bar % 2) * 16 + s];
      if (m) this.lead(t, mtof(this._midi(chord + m.deg, 2)), this.stepDur * (m.len + 0.5));
    }
    if (breakdown && s === 0) this.pad(t, chord, this.stepDur * 16);
  }

  // --- Instrument (en uppsättning noder per slag) ---------------------------

  _env(t, peak, dur, a = 0.002) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  _osc(type, f, t, dur, dest, extra) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => { dest.disconnect(); extra?.disconnect(); };
    return o;
  }

  _noise(t, dur, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.connect(dest);
    s.start(t, Math.random() * this.noise.duration * 0.8);
    s.stop(t + dur + 0.02);
    s.onended = () => dest.disconnect();
    return s;
  }

  kick(t) {
    const g = this._env(t, 0.7, 0.32);
    g.connect(this.bus);
    const o = this._osc('sine', 150, t, 0.32, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
  }

  snare(t, vel = 1) {
    const g = this._env(t, 0.4 * vel, 0.16);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1300;
    hp.connect(g).connect(this.bus);
    this._noise(t, 0.16, hp);
    const g2 = this._env(t, 0.25 * vel, 0.08);
    g2.connect(this.bus);
    this._osc('triangle', 190, t, 0.08, g2);
  }

  clap(t) {
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 1.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (let k = 0; k < 3; k++) {
      g.gain.setValueAtTime(0.5, t + k * 0.011);
      g.gain.exponentialRampToValueAtTime(0.05, t + k * 0.011 + 0.01);
    }
    g.gain.setValueAtTime(0.4, t + 0.034);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    bp.connect(g).connect(this.bus);
    this._noise(t, 0.2, bp);
  }

  hat(t, open, vel = 1) {
    const dur = open ? 0.18 : 0.045;
    const g = this._env(t, (open ? 0.12 : 0.1) * vel, dur, 0.001);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = open ? 6500 : 8000;
    hp.connect(g).connect(this.bus);
    this._noise(t, dur, hp);
  }

  bass(t, f, dur, vel = 1) {
    const T = this.T;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 9;
    const top = T.scale === 'phrygian' ? 900 : 1800;
    lp.frequency.setValueAtTime(top * vel, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = this._env(t, 0.32 * vel, dur + 0.04, 0.003);
    lp.connect(g).connect(this.bus);
    this._osc('sawtooth', f, t, dur + 0.04, lp);
    const sub = this._env(t, 0.25, dur + 0.04, 0.003);
    sub.connect(this.bus);
    this._osc('square', f / 2, t, dur + 0.04, sub);
  }

  arp(t, f, dur) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const g = this._env(t, 0.06, dur, 0.002);
    lp.connect(g);
    g.connect(this.bus);
    g.connect(this.send);
    this._osc('square', f, t, dur, lp, g);
  }

  lead(t, f, dur) {
    const kind = this.T.lead;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(kind === 'organ' ? 2000 : 4500, t);
    lp.frequency.exponentialRampToValueAtTime(1200, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
    g.gain.setValueAtTime(0.07, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g);
    g.connect(this.bus);
    g.connect(this.send);
    if (kind === 'organ') {
      this._osc('sine', f, t, dur, lp, g);
      this._osc('sine', f * 2, t, dur, lp);
      this._osc('triangle', f * 3, t, dur, lp);
    } else {
      const type = kind === 'tri' ? 'triangle' : kind === 'square' ? 'square' : 'sawtooth';
      this._osc(type, f, t, dur, lp, g).detune.value = -7;
      this._osc(type, f, t, dur, lp).detune.value = 7;
    }
  }

  pad(t, chord, dur) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.linearRampToValueAtTime(2500, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(this.bus);
    for (const d of [0, 2, 4]) this._osc('sawtooth', mtof(this._midi(chord + d, 1)), t, dur, lp);
  }
}
