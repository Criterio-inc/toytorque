import { pulseWave, softClip, noiseLoop, glide, clamp } from './synth.js';

// ---------------------------------------------------------------------------
// Motorröst för en bil: byggs en gång och styrs sedan bara via parametrar.
//   El   = gnällig elmotor: sågtand + fyrkant genom lågpass, plus kugghjulsvin
//   Glow = surrig tvåtaktare: pulsvåg i tändfrekvens, amplitudmodulerat brus,
//          mättning — högre och råare
// Varje röst har också däckskrik (bandpassat brus) och vägmuller (lågpassat brus).
// ---------------------------------------------------------------------------

const waves = new WeakMap(); // pulsvåg per AudioContext

export class EngineVoice {
  constructor(ctx, out, noise, kind = 'El') {
    this.ctx = ctx;
    this.kind = kind;
    this.rpm = 0;
    this.nodes = [];
    this.srcs = [];
    const n = (x) => (this.nodes.push(x), x);

    this.pan = n(ctx.createStereoPanner());
    this.pan.connect(out);
    this.vol = n(ctx.createGain());
    this.vol.gain.value = 0;
    this.vol.connect(this.pan);

    const osc = (type, f) => {
      const o = n(ctx.createOscillator());
      if (type === 'pulse') {
        if (!waves.has(ctx)) waves.set(ctx, pulseWave(ctx, 0.22));
        o.setPeriodicWave(waves.get(ctx));
      } else o.type = type;
      o.frequency.value = f;
      o.start();
      this.srcs.push(o);
      return o;
    };
    const gain = (v) => { const g = n(ctx.createGain()); g.gain.value = v; return g; };
    const filt = (type, f, Q = 1) => { const b = n(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; };

    if (kind === 'Glow') {
      this.o1 = osc('pulse', 40);
      this.o2 = osc('square', 20); // halv frekvens ger tvåtaktens ojämna puttrande
      this.o3 = osc('square', 40); // modulerar bruset i takt med tändningen
      this.lp = filt('lowpass', 1200, 2);
      const shape = n(softClip(ctx, 4));
      const g2 = gain(0.35);
      this.o1.connect(shape);
      this.o2.connect(g2).connect(shape);
      // Brus som "pöser" i takt med varvet
      const nz = noiseLoop(ctx, noise); this.srcs.push(nz);
      this.nbp = filt('bandpass', 800, 1.2);
      const am = gain(0.5), depth = gain(0.5);
      this.o3.connect(depth).connect(am.gain);
      this.nzGain = gain(0.5);
      nz.connect(this.nbp).connect(am).connect(this.nzGain).connect(shape);
      shape.connect(this.lp).connect(this.vol);
    } else {
      this.o1 = osc('sawtooth', 80);
      this.o2 = osc('square', 80);
      this.o2.detune.value = 9;
      this.o3 = osc('sine', 320); // kuggvin
      this.lp = filt('lowpass', 1000, 3);
      const g2 = gain(0.3);
      this.whine = gain(0.05);
      this.o1.connect(this.lp);
      this.o2.connect(g2).connect(this.lp);
      this.o3.connect(this.whine).connect(this.vol);
      this.lp.connect(this.vol);
    }

    // Däckskrik
    const sk = noiseLoop(ctx, noise); this.srcs.push(sk);
    this.skidBp = filt('bandpass', 2600, 5);
    this.skid = gain(0);
    sk.connect(this.skidBp).connect(this.skid).connect(this.pan);
    // Vägmuller
    const rb = noiseLoop(ctx, noise); this.srcs.push(rb);
    this.rumbleLp = filt('lowpass', 160, 0.8);
    this.rumble = gain(0);
    rb.connect(this.rumbleLp).connect(this.rumble).connect(this.pan);
  }

  // Läser av fordonet och sätter mål för parametrarna.
  // gain/pan/doppler kommer från rumsberäkningen (spelaren: 1/0/1).
  update(v, dt, { gain = 1, pan = 0, doppler = 1 } = {}) {
    const t = this.ctx.currentTime;
    const top = v.def?.topSpeed || 15;
    const r = Math.min(1.25, Math.abs(v.speed) / top);
    const load = Math.abs(v.motor || 0);
    // I luften varvar motorn fritt efter gasen; på marken följer den hjulen
    const target = v.grounded === 0 ? Math.max(r * 0.5, load * 1.05) : clamp(r + load * 0.12 * (1 - r), 0, 1.25);
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 7 : 4));
    const rpm = this.rpm;
    const jit = 1 + (Math.random() - 0.5) * 0.012; // lite liv i tomgången

    if (this.kind === 'Glow') {
      const f = (38 + 235 * rpm) * doppler * jit;
      glide(this.o1.frequency, f, t);
      glide(this.o2.frequency, f * 0.5, t);
      glide(this.o3.frequency, f, t);
      glide(this.nbp.frequency, 600 + f * 6, t);
      glide(this.lp.frequency, 900 + 4200 * rpm + 1200 * load, t);
      glide(this.nzGain.gain, 0.35 + 0.4 * load, t);
      glide(this.vol.gain, gain * (0.16 + 0.16 * rpm + 0.1 * load), t);
    } else {
      const f = (62 + 560 * rpm) * doppler * jit;
      glide(this.o1.frequency, f, t);
      glide(this.o2.frequency, f * 1.002, t);
      glide(this.o3.frequency, f * 4.3, t);
      glide(this.whine.gain, 0.012 + 0.05 * rpm * (0.4 + load), t);
      glide(this.lp.frequency, 500 + 2600 * rpm + 1400 * load, t);
      glide(this.vol.gain, gain * (0.07 + 0.11 * rpm + 0.06 * load), t);
    }
    glide(this.pan.pan, clamp(pan, -1, 1), t);

    // Däck: glidande hjul i marken skriker, olja dämpar
    let slip = 0, onGround = 0, grip = 0;
    for (const wh of v.wheels || []) {
      if (!wh.grounded) continue;
      onGround++;
      grip += wh.surface?.grip ?? 1;
      let s = wh.skid ? Math.min(1, wh.slide - 0.85) : Math.max(0, wh.slide - 1.05) * 0.4;
      if (wh.oily > 0) s *= 0.3;
      slip += Math.max(0, s);
    }
    const sp = Math.min(1, Math.abs(v.speed) / 3);
    const sq = clamp(slip / 2) * sp;
    glide(this.skid.gain, gain * 0.22 * sq, t, sq > 0.05 ? 0.03 : 0.08);
    glide(this.skidBp.frequency, (2200 + 900 * sq + Math.random() * 300) * doppler, t);
    const g = onGround ? grip / onGround : 1;
    glide(this.rumble.gain, gain * 0.45 * (onGround / 4) * Math.min(1, r * 1.3), t);
    glide(this.rumbleLp.frequency, 90 + 180 * r + (g < 0.9 ? 250 : 0), t);
  }

  silence() {
    const t = this.ctx.currentTime;
    for (const p of [this.vol.gain, this.skid.gain, this.rumble.gain]) glide(p, 0, t, 0.05);
  }

  dispose() {
    this.silence();
    const t = this.ctx.currentTime + 0.3;
    for (const s of this.srcs) { try { s.stop(t); } catch { /* redan stoppad */ } }
    setTimeout(() => { for (const x of this.nodes) x.disconnect(); for (const s of this.srcs) s.disconnect(); }, 400);
  }
}
