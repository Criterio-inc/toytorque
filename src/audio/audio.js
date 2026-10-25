import { makeNoise, noiseLoop, glide, clamp } from './synth.js';
import { Sfx } from './sfx.js';
import { EngineVoice } from './engine.js';
import { Music } from './music.js';

// ---------------------------------------------------------------------------
// Ljudsystemet. Allt procedurellt via Web Audio. Kopplas på spelet utifrån:
// lyssnar på game.events och läser av spelets tillstånd varje bildruta.
//
//   game.audio.setVolume({master, music, sfx})   0..1, sparas i localStorage
//   game.audio.mute(on?)                         växla/sätt tyst läge
//   game.audio.playMusic(id) / stopMusic()       id = nivåns id eller 'menu'
//   game.audio.play(name, opts)                  engångsljud, t.ex. ('ui', {name:'select'})
//
// Graf: motorer → engine → världsgrind ─┐
//       vapen/krockar → sfx ────────────┼→ master → kompressor → ut
//       musik → music → duck ───────────┘
// ---------------------------------------------------------------------------

const STORE = 'revolt.audio';
const AI_VOICES = 3;
const DOPPLER_C = 120; // "ljudhastighet" i RC-skala: överdriven för tydlig effekt
const REF_DIST = 2.5;

export function attachAudio(game) {
  const sys = new AudioSystem(game);
  game.audio = sys.api;
  return sys;
}

class AudioSystem {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.vol = { master: 0.8, music: 0.55, sfx: 0.9, muted: false };
    try { Object.assign(this.vol, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* privat läge */ }
    this.wantMusic = null;
    this.lastImpact = 0;
    this.impactVoices = [];
    this.rouletteNext = 0;
    this.fanfareDuck = 0;
    this.listener = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 1, ry: 0, rz: 0 };
    this.lastFrame = performance.now();

    const s = this;
    this.api = {
      setVolume(v = {}) {
        for (const k of ['master', 'music', 'sfx']) if (Number.isFinite(v[k])) s.vol[k] = clamp(v[k]);
        s._applyVolume();
        s._save();
      },
      getVolume: () => ({ ...s.vol }),
      mute(on) {
        s.vol.muted = on === undefined ? !s.vol.muted : !!on;
        s._applyVolume();
        s._save();
        return s.vol.muted;
      },
      playMusic(id) { s.wantMusic = id; if (s.music) s.music.play(id); },
      stopMusic() { s.wantMusic = null; s.music?.stop(0.6); },
      play(name, opts) { if (s.live) s.sfx.play(name, opts); },
      unlock: () => s.unlock(),
      get context() { return s.ctx; },
      get _sys() { return s; }, // felsökning
    };

    // Ljudet får bara starta efter en användargest
    const gesture = () => this.unlock();
    for (const ev of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(ev, gesture, { capture: true, passive: true });
    window.addEventListener('gamepadconnected', gesture);
    // Dold flik eller fönster utan fokus (Cmd+Tab i Mac-appen): tyst. Ljudet
    // kommer tillbaka när fönstret syns och har fokus igen (eller vid nästa tangent).
    const away = () => { if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {}); };
    const back = () => { if (this.ctx && !document.hidden && document.hasFocus()) this.ctx.resume().catch(() => {}); };
    document.addEventListener('visibilitychange', () => (document.hidden ? away() : back()));
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);

    this._wireEvents();
    const loop = () => { requestAnimationFrame(loop); this.frame(); };
    requestAnimationFrame(loop);
  }

  get live() { return this.ctx && this.ctx.state === 'running'; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this._build();
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  _build() {
    const ctx = this.ctx;
    this.noise = makeNoise(ctx, 2);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10;
    this.comp.ratio.value = 4;
    this.comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(this.comp);
    this.musicBus = ctx.createGain();
    this.duck = ctx.createGain();
    this.musicBus.connect(this.duck).connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.engineBus = ctx.createGain();
    this.worldGate = ctx.createGain(); // tystas vid paus
    this.engineBus.connect(this.worldGate).connect(this.master);
    this._applyVolume();

    this.sfx = new Sfx(ctx, this.sfxBus, this.noise);
    this.music = new Music(ctx, this.musicBus, this.noise);
    this.voices = { player: null, ai: [] };
    this._buildLoops();

    this.seenRace = this.game.race;
    this.seenLevel = this.game.levelDef?.id;
    this.music.play(this.wantMusic || this.seenLevel || 'menu');
  }

  // Kontinuerliga världsljud: elchock-surr och bombstubin
  _buildLoops() {
    const ctx = this.ctx;
    const mk = (type, f, Q) => {
      const src = noiseLoop(ctx, this.noise);
      const flt = ctx.createBiquadFilter();
      flt.type = type; flt.frequency.value = f; flt.Q.value = Q;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner();
      src.connect(flt).connect(g).connect(p).connect(this.worldGate);
      return { flt, g, p };
    };
    this.electro = mk('bandpass', 3000, 2);
    const buzz = ctx.createOscillator();
    buzz.type = 'sawtooth'; buzz.frequency.value = 100; buzz.start();
    const bg = ctx.createGain(); bg.gain.value = 0.25;
    buzz.connect(bg).connect(this.electro.g);
    this.fuse = mk('highpass', 4500, 1);
  }

  _applyVolume() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, v = this.vol;
    glide(this.master.gain, v.muted ? 0 : v.master, t, 0.03);
    glide(this.musicBus.gain, v.music * 0.8, t, 0.03);
    glide(this.sfxBus.gain, v.sfx, t, 0.03);
    glide(this.engineBus.gain, v.sfx * 0.9, t, 0.03);
  }

  _save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.vol)); } catch { /* ignoreras */ }
  }

  // --- Rumsljud ---------------------------------------------------------------

  _updateListener(dt) {
    const cam = this.game.camera;
    if (!cam) return;
    const e = cam.matrixWorld.elements, L = this.listener;
    const x = e[12], y = e[13], z = e[14];
    if (dt > 0) {
      const k = Math.min(1, dt * 10);
      L.vx += ((x - L.x) / dt - L.vx) * k;
      L.vy += ((y - L.y) / dt - L.vy) * k;
      L.vz += ((z - L.z) / dt - L.vz) * k;
      if (Math.hypot(L.vx, L.vy, L.vz) > 60) L.vx = L.vy = L.vz = 0; // kameraklipp
    }
    L.x = x; L.y = y; L.z = z;
    const rl = Math.hypot(e[0], e[1], e[2]) || 1;
    L.rx = e[0] / rl; L.ry = e[1] / rl; L.rz = e[2] / rl;
  }

  // Volym (0..1), panorering och dopplerfaktor för en punkt (och ev. hastighet)
  spatial(pos, vel) {
    const L = this.listener;
    if (!pos) return { gain: 1, pan: 0, doppler: 1, dist: 0 };
    const dx = pos.x - L.x, dy = pos.y - L.y, dz = pos.z - L.z;
    const d = Math.hypot(dx, dy, dz) || 1e-3;
    const gain = REF_DIST / (REF_DIST + Math.max(0, d - REF_DIST) * 1.3);
    const pan = clamp(((dx * L.rx + dy * L.ry + dz * L.rz) / d) * 0.85 * Math.min(1, d / 1.5), -1, 1);
    let doppler = 1;
    if (vel) {
      const ux = dx / d, uy = dy / d, uz = dz / d;
      const vs = vel.x * ux + vel.y * uy + vel.z * uz; // källan bort från lyssnaren
      const vl = L.vx * ux + L.vy * uy + L.vz * uz; // lyssnaren mot källan
      doppler = clamp((DOPPLER_C + vl) / (DOPPLER_C + vs), 0.75, 1.3);
    }
    return { gain, pan, doppler, dist: d };
  }

  _carOf(racer) { return this.game.cars?.find((c) => c.racer === racer); }

  _at(pos, base = 1) {
    const s = this.spatial(pos);
    return { vol: base * s.gain, pan: s.pan, dist: s.dist };
  }

  // --- Händelser --------------------------------------------------------------

  _wireEvents() {
    const ev = this.game.events;
    const on = (name, fn) => ev.on(name, (d) => { if (this.live) fn(d || {}); });
    const S = (name, o) => this.sfx.play(name, o);
    const isP = (r) => r && r.isPlayer;

    on('countdown', () => S('countdown'));
    on('go', () => S('go'));
    on('lap', (d) => { if (isP(d.racer) && d.lap !== this.game.race?.laps) S('lap'); });
    on('finalLap', (d) => { if (isP(d.racer)) S('finalLap'); });
    on('finish', (d) => {
      if (!isP(d.racer)) return;
      S('finish', { first: d.position === 1 });
      this.fanfareDuck = 2.2;
    });
    on('pickup', (d) => {
      if (isP(d.racer)) S('pickup');
      else { const c = this._carOf(d.racer); if (c) S('pickup', this._at(c.vehicle.currPos, 0.5)); }
    });
    on('armed', (d) => { if (isP(d.racer)) S('armed'); });
    on('star', (d) => { S('pickup'); if (d.all) { S('finish', { first: true }); this.fanfareDuck = 2.2; } });
    on('fire', (d) => {
      const c = this._carOf(d.racer);
      const o = isP(d.racer) ? { vol: 1, pan: 0 } : this._at(d.pos || c?.vehicle.currPos, 0.8);
      S('fire', { ...o, id: d.id });
    });
    on('explode', (d) => S('explode', { ...this._at(d.pos, 1.2), size: d.size ?? 0.6 }));
    on('zap', (d) => S('zap', this._at(d.pos)));
    on('splash', (d) => S('splash', this._at(d.pos)));
    on('bombPass', (d) => { const c = this._carOf(d.to); S('bombPass', this._at(c?.vehicle.currPos)); });
    on('impact', (d) => this._impact('impact', d));
    on('land', (d) => this._impact('land', d));
    on('respawn', (d) => {
      const pl = d.car?.vehicle === this.game.player;
      S('respawn', pl ? {} : this._at(d.car?.vehicle.currPos, 0.6));
    });
    on('ui', (d) => S('ui', { name: d.name }));
  }

  // Krockar kan komma i skurar: max en per 50 ms och högst 4 samtidigt
  _impact(kind, d) {
    const now = this.ctx.currentTime;
    const strength = d.strength ?? 2;
    if (now - this.lastImpact < 0.05) return;
    this.impactVoices = this.impactVoices.filter((t) => t > now);
    if (this.impactVoices.length >= 4) return;
    const pl = d.car?.vehicle === this.game.player;
    const pos = d.pos || d.car?.vehicle.currPos;
    const o = pl ? { vol: 1, pan: 0 } : this._at(pos, 0.9);
    if (o.vol * Math.min(1, strength / 4) < 0.04) return;
    this.lastImpact = now;
    this.impactVoices.push(now + 0.2);
    this.sfx.play(kind, { ...o, strength });
  }

  // --- Per bildruta -----------------------------------------------------------

  frame() {
    const nowMs = performance.now();
    const dt = Math.min(0.1, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;
    if (!this.ctx) {
      // Handkontroll som första gest
      const pads = navigator.getGamepads?.() || [];
      for (const p of pads) if (p && p.buttons.some((b) => b.pressed)) { this.unlock(); break; }
      return;
    }
    if (!this.live) return;
    const g = this.game, t = this.ctx.currentTime;

    // Ny bana / omstart
    if (g.race !== this.seenRace) {
      this.seenRace = g.race;
      // Bakom menyn (demo, bilvisning) spelas menylåten
      const id = g.mode === 'demo' || g.mode === 'showroom' ? 'menu' : g.levelDef?.music ?? g.levelDef?.id; // egna banor lånar en låt
      // Nytt lopp spelar banans musik (samma låt fortsätter vid omstart)
      if (id && this.music.id !== id) { this.wantMusic = id; this.music.play(id); }
      this.seenLevel = id;
      this.fanfareDuck = 0;
    }
    if (g.cars !== this.seenCars || g.player !== this.seenPlayer) this._rebuildVoices();

    // Paus (och repris: bilarna står still i fysiken, så motorerna tystas)
    const paused = !!g.paused;
    const mute = paused || !!g.replaying;
    if (mute !== this.wasMuted) {
      this.wasMuted = mute;
      glide(this.worldGate.gain, mute ? 0 : 1, t, 0.06);
    }
    if (paused !== this.wasPaused) {
      this.wasPaused = paused;
      paused ? this.music.pause() : this.music.resume();
    }
    if (mute) return;

    // Musiken duckar under nedräkningen och fanfaren
    if (this.fanfareDuck > 0) this.fanfareDuck -= dt;
    const st = g.race?.state;
    glide(this.duck.gain, this.fanfareDuck > 0 ? 0.3 : st === 'countdown' ? 0.6 : 1, t, 0.15);

    this._updateListener(dt);
    this._updateEngines(dt);
    this._updateRoulette(t);
    this._updateLoops(t);
  }

  _rebuildVoices() {
    const g = this.game;
    this.seenCars = g.cars;
    this.seenPlayer = g.player;
    this.voices.player?.dispose();
    for (const s of this.voices.ai) s.voice?.dispose();
    this.voices.player = g.player ? new EngineVoice(this.ctx, this.engineBus, this.noise, g.player.def?.engine) : null;
    this.voices.ai = Array.from({ length: AI_VOICES }, () => ({ car: null, voice: null }));
    this.reassignIn = 0;
  }

  _vel(v) {
    const p = v.currPos, q = v.prevPos;
    if (!p || !q) return null;
    const k = 60; // ett fysiksteg
    return { x: (p.x - q.x) * k, y: (p.y - q.y) * k, z: (p.z - q.z) * k };
  }

  _updateEngines(dt) {
    const g = this.game;
    if (!g.cars) return;
    if (this.voices.player) this.voices.player.update(g.player, dt, { gain: 1, pan: 0, doppler: 1 });

    // De närmaste datorbilarna får egna röster (byts lugnt, inte varje bildruta)
    this.reassignIn -= dt;
    if (this.reassignIn <= 0) {
      this.reassignIn = 0.25;
      const L = this.listener;
      const near = g.cars
        .filter((c) => c.vehicle !== g.player)
        .map((c) => ({ c, d: (c.vehicle.currPos.x - L.x) ** 2 + (c.vehicle.currPos.y - L.y) ** 2 + (c.vehicle.currPos.z - L.z) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, AI_VOICES)
        .map((x) => x.c);
      const slots = this.voices.ai;
      for (const s of slots) if (s.car && !near.includes(s.car)) { s.car = null; s.voice?.silence(); }
      for (const c of near) {
        if (slots.some((s) => s.car === c)) continue;
        const s = slots.find((x) => !x.car);
        if (!s) break;
        const kind = c.vehicle.def?.engine;
        if (!s.voice || s.voice.kind !== kind) {
          s.voice?.dispose();
          s.voice = new EngineVoice(this.ctx, this.engineBus, this.noise, kind);
        }
        s.voice.rpm = 0.3;
        s.car = c;
      }
    }
    for (const s of this.voices.ai) {
      if (!s.car) continue;
      const v = s.car.vehicle;
      const sp = this.spatial(v.currPos, this._vel(v));
      s.voice.update(v, dt, { gain: 0.75 * Math.pow(sp.gain, 1.2), pan: sp.pan, doppler: sp.doppler });
    }
  }

  // Rouletten tickar allt långsammare tills vapnet är klart
  _updateRoulette(t) {
    const r = this.game.racer;
    if (!r || !(r.roulette > 0)) { this.rouletteNext = 0; return; }
    if (t < this.rouletteNext) return;
    const frac = clamp(r.roulette / 2.2);
    const left = 1 - frac;
    this.sfx.play('rouletteTick', { t, pitch: 1 + 0.25 * frac });
    this.rouletteNext = t + 0.045 + 0.24 * left * left;
  }

  _updateLoops(t) {
    let eBest = null, eD = Infinity, fBest = null, fD = Infinity;
    for (const c of this.game.cars || []) {
      const r = c.racer;
      if (!r) continue;
      const d = this.spatial(c.vehicle.currPos);
      if (r.fx?.electro > 0 && d.dist < eD) { eD = d.dist; eBest = d; }
      if (r.bomb > 0 && d.dist < fD) { fD = d.dist; fBest = d; d.racer = r; }
    }
    const E = this.electro;
    const crackle = Math.random();
    glide(E.g.gain, eBest ? eBest.gain * (crackle < 0.3 ? 0.9 : 0.35) : 0, t, 0.015);
    glide(E.flt.frequency, 1500 + Math.random() * 4500, t, 0.01);
    if (eBest) glide(E.p.pan, eBest.pan, t);
    // Bombens pip följer blinkandet (tätare mot slutet)
    if (fBest) {
      const r = fBest.racer;
      if (r !== this.beepRacer) { this.beepRacer = r; this.beepSeen = r.bombBeeps || 0; }
      if ((r.bombBeeps || 0) !== this.beepSeen) {
        this.beepSeen = r.bombBeeps || 0;
        this.sfx.play('bombBeep', { t, vol: fBest.gain, pan: fBest.pan, urgency: clamp(1 - r.bomb / 10) });
      }
    } else this.beepRacer = null;
    const F = this.fuse;
    glide(F.g.gain, fBest ? fBest.gain * (0.15 + Math.random() * 0.15) : 0, t, 0.02);
    if (fBest) glide(F.p.pan, fBest.pan, t);
  }
}
