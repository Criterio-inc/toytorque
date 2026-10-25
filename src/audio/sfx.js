import { VoicePool, mtof } from './synth.js';

// ---------------------------------------------------------------------------
// Engångsljud: allt syntetiseras med oscillatorer och filtrerat brus.
// play(namn, {vol, pan, t, ...}) — vol/pan kommer från rumsberäkningen.
// ---------------------------------------------------------------------------

export class Sfx {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.pool = new VoicePool(ctx, out, noise, 32);
  }

  play(name, o = {}) {
    const fn = this[name];
    if (typeof fn !== 'function' || name === 'play') return;
    const t = o.t ?? this.ctx.currentTime + 0.005;
    fn.call(this, t, o);
  }

  // --- Lopp -----------------------------------------------------------------

  countdown(t, { vol = 1 }) {
    const P = this.pool, v = P.voice(0.35 * vol);
    if (!v) return;
    P.tone(v, t, { type: 'square', f: 880, dur: 0.16, hold: 0.09, vol: 0.5 });
    P.tone(v, t, { type: 'sine', f: 440, dur: 0.16, hold: 0.09, vol: 0.5 });
  }

  go(t, { vol = 1 }) {
    const P = this.pool, v = P.voice(0.4 * vol);
    if (!v) return;
    P.tone(v, t, { type: 'square', f: 1760, dur: 0.7, hold: 0.4, vol: 0.45 });
    P.tone(v, t, { type: 'sawtooth', f: 880, dur: 0.7, hold: 0.4, vol: 0.25, detune: 6 });
    P.tone(v, t, { type: 'sine', f: 440, dur: 0.6, hold: 0.3, vol: 0.4 });
  }

  // Klocka: grundton + oharmonisk deltonsserie
  lap(t, { vol = 1 }) {
    const P = this.pool, v = P.voice(0.35 * vol);
    if (!v) return;
    for (const [f, d] of [[1318.5, 0], [1975.5, 0.11]]) {
      P.tone(v, t + d, { f, dur: 0.9, vol: 0.5 });
      P.tone(v, t + d, { f: f * 2.76, dur: 0.35, vol: 0.15 });
      P.tone(v, t + d, { f: f * 5.4, dur: 0.12, vol: 0.06 });
    }
  }

  finalLap(t, { vol = 1 }) {
    const P = this.pool, v = P.voice(0.3 * vol);
    if (!v) return;
    const notes = [72, 76, 79, 84, 79, 84, 88];
    notes.forEach((m, i) => {
      const last = i === notes.length - 1;
      P.tone(v, t + i * 0.085, { type: 'square', f: mtof(m), dur: last ? 0.5 : 0.1, hold: last ? 0.2 : 0.05, vol: 0.35 });
      P.tone(v, t + i * 0.085, { type: 'triangle', f: mtof(m - 12), dur: last ? 0.5 : 0.1, vol: 0.4 });
    });
  }

  // Målgång: segerfanfar för etta, kortare och lugnare för övriga
  finish(t, { vol = 1, first = false }) {
    const P = this.pool, v = P.voice(0.32 * vol);
    if (!v) return;
    const b = 0.13; // ett slag
    const mel = first
      ? [[67, 0, 1], [72, 1, 1], [76, 2, 1], [79, 3, 2], [76, 5, 1], [79, 6, 1], [84, 7, 6]]
      : [[72, 0, 1], [71, 1, 1], [69, 2, 1], [67, 3, 2], [72, 5, 4]];
    const bass = first ? [[48, 0, 3], [53, 3, 2], [55, 5, 2], [48, 7, 6]] : [[45, 0, 3], [43, 3, 2], [48, 5, 4]];
    for (const [m, s, l] of mel) {
      P.tone(v, t + s * b, { type: 'square', f: mtof(m), dur: l * b + 0.12, hold: l * b * 0.6, vol: 0.32 });
      P.tone(v, t + s * b, { type: 'sawtooth', f: mtof(m), dur: l * b + 0.12, hold: l * b * 0.6, vol: 0.14, detune: 8 });
    }
    for (const [m, s, l] of bass) P.tone(v, t + s * b, { type: 'triangle', f: mtof(m), dur: l * b + 0.1, hold: l * b * 0.7, vol: 0.55 });
    if (first) P.hiss(v, t + 7 * b, { type: 'highpass', f: 6000, dur: 1.0, vol: 0.12 }); // cymbal
  }

  // --- Vapen och pickuper ---------------------------------------------------

  pickup(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.3 * vol, pan);
    if (!v) return;
    [84, 88, 91, 96, 100, 103].forEach((m, i) => {
      P.tone(v, t + i * 0.045, { type: 'triangle', f: mtof(m), dur: 0.22, vol: 0.4 });
      P.tone(v, t + i * 0.045, { f: mtof(m + 12), dur: 0.12, vol: 0.12 });
    });
    P.hiss(v, t, { type: 'highpass', f: 7000, dur: 0.4, vol: 0.12, a: 0.05 });
  }

  rouletteTick(t, { vol = 1, pitch = 1 }) {
    const P = this.pool, v = P.voice(0.18 * vol);
    if (!v) return;
    P.tone(v, t, { type: 'square', f: 1400 * pitch, dur: 0.025, a: 0.001, vol: 0.6 });
    P.hiss(v, t, { type: 'highpass', f: 5000, dur: 0.015, a: 0.001, vol: 0.3 });
  }

  armed(t, { vol = 1 }) {
    const P = this.pool, v = P.voice(0.32 * vol);
    if (!v) return;
    P.tone(v, t, { type: 'triangle', f: 1046.5, dur: 0.3, vol: 0.5 });
    P.tone(v, t + 0.08, { type: 'triangle', f: 1568, dur: 0.5, vol: 0.5 });
    P.tone(v, t + 0.08, { f: 3136, dur: 0.3, vol: 0.12 });
  }

  // Avfyrning per vapen-id
  fire(t, o) {
    const id = o.id === 'fireworkPack' ? 'firework' : o.id;
    const fn = this['w_' + id];
    if (fn) fn.call(this, t, o);
  }

  w_shockwave(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.45 * vol, pan);
    if (!v) return;
    P.hiss(v, t, { f: 300, f1: 3200, Q: 3, dur: 0.6, a: 0.05, vol: 0.7 });
    P.tone(v, t, { type: 'sawtooth', f: 70, f1: 420, dur: 0.55, a: 0.04, vol: 0.35 });
    P.tone(v, t, { type: 'square', f: 140, f1: 900, dur: 0.4, vol: 0.12, detune: 15 });
  }

  w_firework(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.4 * vol, pan);
    if (!v) return;
    P.hiss(v, t, { type: 'lowpass', f: 900, dur: 0.06, vol: 0.8 }); // tändning
    P.hiss(v, t + 0.02, { type: 'bandpass', f: 2500, f1: 5500, Q: 0.8, dur: 0.9, a: 0.02, hold: 0.3, vol: 0.55 });
    P.tone(v, t + 0.02, { type: 'sawtooth', f: 300, f1: 900, dur: 0.6, vol: 0.05 });
  }

  w_bomb(t, o) { this.bombPass(t, o); }

  w_oil(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.5 * vol, pan);
    if (!v) return;
    P.tone(v, t, { f: 320, f1: 70, dur: 0.25, vol: 0.6 });
    P.hiss(v, t, { type: 'bandpass', f: 1400, f1: 180, Q: 9, dur: 0.3, vol: 0.9 });
    P.hiss(v, t + 0.1, { type: 'bandpass', f: 900, f1: 250, Q: 7, dur: 0.2, vol: 0.5 });
  }

  w_balloons(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.8 * vol, pan);
    if (!v) return;
    P.hiss(v, t, { f: 400, f1: 1600, Q: 2, dur: 0.18, a: 0.06, vol: 0.6 });
    P.hiss(v, t + 0.15, { f: 1600, f1: 500, Q: 2, dur: 0.2, vol: 0.4 });
  }

  w_bearing(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.45 * vol, pan);
    if (!v) return;
    for (const [f, d] of [[523, 0.5], [1432, 0.3], [2387, 0.2], [3610, 0.12]]) P.tone(v, t, { f, dur: d, a: 0.001, vol: 0.25 });
    P.tone(v, t, { type: 'triangle', f: 140, f1: 60, dur: 0.12, vol: 0.6 }); // duns
    // Rullande: lågpassat brus som skakar
    const flt = P.hiss(v, t + 0.05, { type: 'lowpass', f: 500, Q: 4, dur: 1.0, a: 0.1, hold: 0.4, vol: 0.35 });
    for (let i = 0; i < 10; i++) flt.frequency.setValueAtTime(350 + Math.random() * 400, t + 0.1 + i * 0.09);
  }

  w_turbo(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.35 * vol, pan);
    if (!v) return;
    P.tone(v, t, { type: 'sawtooth', f: 180, f1: 2200, dur: 0.55, a: 0.02, hold: 0.2, vol: 0.4 });
    P.tone(v, t, { type: 'square', f: 360, f1: 4400, dur: 0.5, vol: 0.12 });
    P.hiss(v, t, { f: 1000, f1: 8000, Q: 4, dur: 0.5, vol: 0.3 });
  }

  w_electro(t, o) { this.zap(t, { ...o, vol: (o.vol ?? 1) * 1.2 }); }

  w_clone(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.45 * vol, pan);
    if (!v) return;
    P.tone(v, t, { f: 1100, f1: 180, dur: 0.08, a: 0.001, vol: 0.8 });
    P.hiss(v, t, { type: 'highpass', f: 3000, dur: 0.02, a: 0.001, vol: 0.5 });
  }

  w_star(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.3 * vol, pan);
    if (!v) return;
    for (let i = 0; i < 5; i++) P.tone(v, t + i * 0.03, { f: 500 * (1 + i * 0.5), f1: 2600 * (1 + i * 0.3), dur: 0.8, a: 0.05, vol: 0.18 });
    [96, 100, 103, 108, 103, 108, 112].forEach((m, i) => P.tone(v, t + 0.2 + i * 0.06, { type: 'triangle', f: mtof(m), dur: 0.25, vol: 0.2 }));
    P.hiss(v, t, { type: 'highpass', f: 6000, dur: 1.0, a: 0.2, vol: 0.12 });
  }

  // --- Träffar och fysik ----------------------------------------------------

  explode(t, { vol = 1, pan = 0, size = 0.6 }) {
    const P = this.pool, v = P.voice((0.3 + 0.35 * size) * vol, pan);
    if (!v) return;
    const len = 0.5 + size * 0.9;
    P.hiss(v, t, { type: 'lowpass', f: 4000, f1: 150, Q: 0.7, dur: len, a: 0.003, vol: 0.9 });
    P.hiss(v, t, { type: 'bandpass', f: 900, f1: 120, Q: 1.5, dur: len * 0.7, vol: 0.5 });
    P.tone(v, t, { f: 110, f1: 32, dur: 0.35 + size * 0.4, a: 0.002, vol: 0.9 });
    P.tone(v, t, { type: 'triangle', f: 58, f1: 24, dur: 0.5 + size * 0.5, a: 0.004, vol: 0.7 }); // tryckvåg
    // Skräp och gnistor som sprakar efteråt
    for (let i = 0; i < 6 + size * 6; i++) {
      const d = 0.08 + Math.random() * len * 0.8;
      P.hiss(v, t + d, { type: 'bandpass', f: 1800 + Math.random() * 4000, Q: 2, dur: 0.015 + Math.random() * 0.03, a: 0.001, vol: 0.35 * (1 - d / (len * 1.2)) });
    }
  }

  // Bombens nedräkning: kort pip, ljusare och vassare mot slutet
  bombBeep(t, { vol = 1, pan = 0, urgency = 0 }) {
    const P = this.pool, v = P.voice(0.28 * vol, pan);
    if (!v) return;
    const f = 1300 + urgency * 700;
    P.tone(v, t, { type: 'square', f, dur: 0.07, hold: 0.04, vol: 0.35 });
    P.tone(v, t, { type: 'sine', f: f * 2, dur: 0.05, vol: 0.15 });
  }

  zap(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.35 * vol, pan);
    if (!v) return;
    for (let i = 0; i < 7; i++) {
      const d = Math.random() * 0.28;
      P.hiss(v, t + d, { type: 'bandpass', f: 1500 + Math.random() * 5000, Q: 3, dur: 0.02 + Math.random() * 0.04, a: 0.001, vol: 0.7 });
    }
    P.tone(v, t, { type: 'sawtooth', f: 120, dur: 0.3, hold: 0.15, vol: 0.25 });
    P.tone(v, t, { type: 'square', f: 181, dur: 0.25, vol: 0.12 });
  }

  splash(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.45 * vol, pan);
    if (!v) return;
    P.hiss(v, t, { type: 'bandpass', f: 1800, f1: 300, Q: 1, dur: 0.45, a: 0.003, vol: 0.8 });
    for (let i = 0; i < 5; i++) {
      const f = 400 + Math.random() * 900;
      P.tone(v, t + 0.05 + Math.random() * 0.3, { f, f1: f * 2.2, dur: 0.06, vol: 0.2 }); // bubblor
    }
  }

  bombPass(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.35 * vol, pan);
    if (!v) return;
    const flt = P.hiss(v, t, { type: 'highpass', f: 4000, Q: 1, dur: 0.5, a: 0.01, hold: 0.25, vol: 0.6 });
    for (let i = 0; i < 8; i++) flt.frequency.setValueAtTime(3000 + Math.random() * 4000, t + i * 0.06);
    P.tone(v, t, { type: 'square', f: 1200, dur: 0.05, vol: 0.2 });
  }

  // Plastbil som krockar: kort klick + kaross-duns
  impact(t, { vol = 1, pan = 0, strength = 3 }) {
    const P = this.pool, s = Math.min(1, strength / 8), v = P.voice((0.25 + 0.6 * s) * vol, pan);
    if (!v) return;
    P.hiss(v, t, { type: 'highpass', f: 2500, dur: 0.02, a: 0.0008, vol: 0.8 });
    P.hiss(v, t, { type: 'bandpass', f: 700 + Math.random() * 400, Q: 2.5, dur: 0.07 + s * 0.06, a: 0.001, vol: 0.7 });
    P.tone(v, t, { type: 'triangle', f: 190 + Math.random() * 60, f1: 70, dur: 0.08 + s * 0.08, a: 0.001, vol: 0.6 });
  }

  land(t, { vol = 1, pan = 0, strength = 3 }) {
    const P = this.pool, s = Math.min(1, strength / 6), v = P.voice((0.3 + 0.5 * s) * vol, pan);
    if (!v) return;
    P.tone(v, t, { f: 130, f1: 45, dur: 0.18, a: 0.002, vol: 0.8 });
    P.hiss(v, t, { type: 'lowpass', f: 400, dur: 0.12, vol: 0.6 });
  }

  respawn(t, { vol = 1, pan = 0 }) {
    const P = this.pool, v = P.voice(0.3 * vol, pan);
    if (!v) return;
    P.hiss(v, t, { type: 'bandpass', f: 200, f1: 2800, Q: 2, dur: 0.5, a: 0.25, vol: 0.7 });
    P.tone(v, t, { f: 300, f1: 1200, dur: 0.45, a: 0.2, vol: 0.2 });
  }

  // --- Meny -------------------------------------------------------------------

  ui(t, { vol = 1, name = 'move' }) {
    const P = this.pool, v = P.voice(0.25 * vol);
    if (!v) return;
    if (name === 'select') {
      P.tone(v, t, { type: 'square', f: 880, dur: 0.06, vol: 0.4 });
      P.tone(v, t + 0.06, { type: 'square', f: 1320, dur: 0.12, vol: 0.4 });
    } else if (name === 'back') {
      P.tone(v, t, { type: 'square', f: 660, dur: 0.06, vol: 0.4 });
      P.tone(v, t + 0.06, { type: 'square', f: 440, dur: 0.1, vol: 0.4 });
    } else {
      P.tone(v, t, { type: 'square', f: 990, dur: 0.035, a: 0.001, vol: 0.35 });
    }
  }
}
