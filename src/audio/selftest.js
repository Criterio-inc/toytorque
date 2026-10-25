import { makeNoise } from './synth.js';
import { Sfx } from './sfx.js';
import { EngineVoice } from './engine.js';
import { Music } from './music.js';

// ---------------------------------------------------------------------------
// Självtest utan högtalare: renderar ljuden offline och mäter RMS/NaN.
// Kör i webbläsarens konsol (dev):
//   (await import('/src/audio/selftest.js')).runAudioSelfTest()
// ---------------------------------------------------------------------------

async function render(sec, build) {
  const ctx = new OfflineAudioContext(2, Math.floor(44100 * sec), 44100);
  const noise = makeNoise(ctx, 2);
  build(ctx, ctx.destination, noise);
  const buf = await ctx.startRendering();
  let sum = 0, n = 0, nan = 0, peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      if (!Number.isFinite(x)) { nan++; continue; }
      sum += x * x; n++;
      if (Math.abs(x) > peak) peak = Math.abs(x);
    }
  }
  return { rms: +Math.sqrt(sum / Math.max(1, n)).toFixed(4), peak: +peak.toFixed(3), nan };
}

const SFX = [
  ['countdown'], ['go'], ['lap'], ['finalLap'], ['finish', { first: true }], ['finish', { first: false }],
  ['pickup'], ['rouletteTick'], ['armed'], ['explode', { size: 1 }], ['zap'], ['splash'], ['bombPass'],
  ['impact', { strength: 6 }], ['land', { strength: 4 }], ['respawn'], ['ui', { name: 'move' }], ['ui', { name: 'select' }], ['ui', { name: 'back' }],
  ...['shockwave', 'firework', 'fireworkPack', 'oil', 'balloons', 'bearing', 'turbo', 'electro', 'clone', 'star', 'bomb'].map((id) => ['fire', { id }]),
];

// Låtsasbil för motortestet
function fakeCar(engine, speed, motor, slide = 0) {
  return {
    def: { topSpeed: 15, engine }, speed, motor, grounded: 4,
    wheels: [0, 1, 2, 3].map(() => ({ grounded: true, slide, skid: slide > 1, oily: 0, surface: null })),
  };
}

export async function runAudioSelfTest() {
  const out = {};
  for (const [name, o] of SFX) {
    const key = name + (o?.id ? ':' + o.id : o?.name ? ':' + o.name : o?.first !== undefined ? ':' + (o.first ? '1st' : 'other') : '');
    out[key] = await render(2, (ctx, dest, noise) => new Sfx(ctx, dest, noise).play(name, { t: 0.01, ...o }));
  }
  for (const kind of ['El', 'Glow']) {
    out['engine:' + kind] = await render(2, (ctx, dest, noise) => {
      const v = new EngineVoice(ctx, dest, noise, kind);
      v.update(fakeCar(kind, 10, 1, 1.4), 0.5, {});
    });
  }
  for (const id of ['menu', 'lagret', 'kitchen', 'spokstaden', 'kryssaren', 'tradgarden']) {
    out['music:' + id] = await render(2, (ctx, dest, noise) => {
      const m = new Music(ctx, dest, noise);
      m.play(id);
      m._halt(); // ingen timer offline: schemalägg allt direkt
      m.step = 8 * 16; // del med lead och arp
      m.nextTime = 0.01;
      m.scheduleUntil(1.9);
    });
  }
  const bad = Object.entries(out).filter(([, r]) => !(r.rms > 0) || r.nan > 0).map(([k]) => k);
  return { ok: bad.length === 0, bad, results: out };
}
