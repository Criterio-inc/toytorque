// ---------------------------------------------------------------------------
// Små byggstenar för det procedurella ljudet: brusbuffert, pulsvåg,
// mjuk distorsion, MIDI → Hz och ett röst-objekt som städar efter sig.
// ---------------------------------------------------------------------------

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);

// Vitt brus, delas av alla ljud (loopas med slumpad startpunkt)
export function makeNoise(ctx, sec = 2) {
  const len = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return buf;
}

// Pulsvåg med given pulsbredd (0..1) som PeriodicWave
export function pulseWave(ctx, duty = 0.25, n = 40) {
  const real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return ctx.createPeriodicWave(real, imag);
}

// Mjuk mättning (tanh)
export function softClip(ctx, drive = 3) {
  const ws = ctx.createWaveShaper();
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  ws.curve = c;
  ws.oversample = '2x';
  return ws;
}

// Startar en loopad brus-källa (för kontinuerliga ljud)
export function noiseLoop(ctx, buf) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start(0, Math.random() * buf.duration * 0.9);
  return s;
}

// Mjuk parameterändring utan att kasta fel på icke-ändliga värden
export function glide(param, v, t, tc = 0.05) {
  if (Number.isFinite(v)) param.setTargetAtTime(v, t, tc);
}

// ---------------------------------------------------------------------------
// Voice: ett engångsljud. Allt kopplas till voice.in; volym och panorering
// sätts en gång. När sista källan tagit slut kopplas noderna loss.
// ---------------------------------------------------------------------------
export class VoicePool {
  constructor(ctx, out, noise, max = 28) {
    this.ctx = ctx; this.out = out; this.noise = noise; this.max = max; this.active = 0;
  }

  voice(vol = 1, pan = 0) {
    if (this.active >= this.max || !(vol > 0.002)) return null;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = Math.min(vol, 2);
    let tail = g;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      tail = p;
    }
    tail.connect(this.out);
    this.active++;
    let pending = 0;
    const pool = this;
    return {
      in: g,
      track(src, t0, t1, offset) {
        pending++;
        src.onended = () => {
          if (--pending === 0) { g.disconnect(); if (tail !== g) tail.disconnect(); pool.active--; }
        };
        offset !== undefined ? src.start(t0, offset) : src.start(t0);
        src.stop(t1);
      },
    };
  }

  // Oscillator med frekvensglid och exponentiell envelope
  tone(v, t, { type = 'sine', wave, f, f1, fCurve = 'exp', dur = 0.2, vol = 1, a = 0.004, hold = 0, detune = 0, to }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    if (wave) o.setPeriodicWave(wave); else o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(f, t);
    if (f1) {
      if (fCurve === 'exp') o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    const g = ctx.createGain();
    env(g.gain, t, a, vol, hold, dur);
    o.connect(g).connect(to || v.in);
    v.track(o, t, t + dur + 0.03);
    return o;
  }

  // Filtrerat brus med envelope och filtersvep
  hiss(v, t, { dur = 0.2, vol = 1, a = 0.003, hold = 0, type = 'bandpass', f = 1000, f1, Q = 1, to }) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.Q.value = Q;
    flt.frequency.setValueAtTime(f, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    env(g.gain, t, a, vol, hold, dur);
    s.connect(flt).connect(g).connect(to || v.in);
    v.track(s, t, t + dur + 0.03, Math.random() * this.noise.duration * 0.9);
    return flt;
  }
}

// Attack → (håll) → exponentiellt avklingande
export function env(p, t, a, vol, hold, dur) {
  p.setValueAtTime(0.0001, t);
  p.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a);
  if (hold > 0) p.setValueAtTime(Math.max(0.0002, vol), t + a + hold);
  p.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + hold + 0.01));
}
