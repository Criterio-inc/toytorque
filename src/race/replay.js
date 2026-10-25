import * as THREE from 'three';
import { formatTime } from '../ui/hud.js';

// ---------------------------------------------------------------------------
// Repris. Under loppet spelas alla bilar in
// med 30 Hz (position, rotation, styrning, fjädring, hjulvarv, markkontakt)
// i Float32Array-block, plus ett litet händelsespår för effekter
// (explosioner, skott, elchocker, vattenballonger, krockar).
//
// Uppspelningen kör inte fysiken. Bilmodellerna kopplas om till låtsasfordon
// (som spöket i ghost.js) som läses ur inspelningen med interpolation.
// Filmkameran växlar mellan följkamera, kameror vid banan som zoomar,
// låg stötfångarkamera och en hög kamera ovanifrån vid hopp.
//
// Tangenter: ←/→ spola ±5 s, ↑/↓ fart, mellanslag paus, C kamerastil,
// 1–8/Tab byt bil, Esc/Enter avsluta.
// ---------------------------------------------------------------------------

const RATE = 30;
const STRIDE = 18; // x y z, qx qy qz qw, styrning, fjäder ×4, hjulvarv ×4, hjul i marken
const CHUNK = 900; // bilder per block (30 s)
const MAX_FRAMES = RATE * 600; // tak: 10 minuter
const TAIL = 3; // sekunder efter spelarens målgång
const SPEEDS = [0.25, 0.5, 1, 2];
const STYLES = [
  ['auto', 'Auto'], ['chase', 'Följ'], ['trackside', 'Vid banan'], ['bumper', 'Stötfångare'], ['overhead', 'Ovanifrån'],
];
const FX_EVENTS = ['explode', 'fire', 'zap', 'splash', 'impact'];
const EV_CODE = { explode: 0, fire: 1, zap: 2, splash: 3, impact: 4 };

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();

export class Replay {
  constructor(game) {
    this.game = game;
    this.cars = game.cars;
    this.nCars = this.cars.length;
    this.frameSize = this.nCars * STRIDE;
    this.chunks = [];
    this.frames = 0;
    this.recT = 0;
    this.recording = false;
    this.closed = false; // inspelningen är klar (målgång + TAIL eller taket)
    this.finishT = null;
    this.ev = []; // { t, type, x, y, z, s }
    this.offs = FX_EVENTS.map((name) => game.events.on(name, (d) => this._onEvent(name, d)));
    this.active = false;
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.active) this.end();
  }

  get duration() { return Math.max(0, (this.frames - 1) / RATE); }

  // --- Inspelning (varje fysiksteg) --------------------------------------------
  record(dt) {
    if (this.closed || this.active) return;
    const g = this.game;
    const st = g.race.state;
    if (!this.recording) {
      if (st === 'intro') return; // från nedräkningen, efter introsvepet
      this.recording = true;
    }
    if (g.racer.finished && this.finishT === null) this.finishT = this.recT;
    if ((this.finishT !== null && this.recT - this.finishT > TAIL) || this.frames >= MAX_FRAMES) { this.closed = true; return; }
    if (this.recT * RATE >= this.frames) this._sample();
    this.recT += dt;
  }

  _sample() {
    const ci = Math.floor(this.frames / CHUNK);
    if (!this.chunks[ci]) this.chunks[ci] = new Float32Array(CHUNK * this.frameSize);
    const a = this.chunks[ci];
    let o = (this.frames % CHUNK) * this.frameSize;
    for (const car of this.cars) {
      const v = car.vehicle, p = v.currPos, q = v.currQuat;
      a[o] = p.x; a[o + 1] = p.y; a[o + 2] = p.z;
      a[o + 3] = q.x; a[o + 4] = q.y; a[o + 5] = q.z; a[o + 6] = q.w;
      a[o + 7] = v.steer;
      for (let w = 0; w < 4; w++) {
        const wh = v.wheels[w];
        a[o + 8 + w] = wh ? wh.suspLen : 0;
        a[o + 12 + w] = wh ? wh.spinVel || 0 : 0;
      }
      a[o + 16] = v.grounded;
      a[o + 17] = 0;
      o += STRIDE;
    }
    this.frames++;
  }

  _onEvent(name, d) {
    if (!this.recording || this.closed || this.active) return;
    const p = d.pos || d.car?.vehicle?.currPos || d.racer?.vehicle?.currPos;
    if (!p) return;
    if (name === 'impact' && !(d.strength > 2.5)) return;
    this.ev.push({ t: this.recT, type: EV_CODE[name], x: p.x, y: p.y, z: p.z, s: d.size ?? d.strength ?? 0 });
  }

  // Läs bil k vid tiden t (interpolerat) in i ett låtsasfordon
  _read(k, t, fake) {
    const f = Math.max(0, Math.min(this.frames - 1.001, t * RATE));
    const i = Math.floor(f), u = f - i;
    const A = this.chunks[Math.floor(i / CHUNK)], ao = (i % CHUNK) * this.frameSize + k * STRIDE;
    const j = Math.min(this.frames - 1, i + 1);
    const B = this.chunks[Math.floor(j / CHUNK)], bo = (j % CHUNK) * this.frameSize + k * STRIDE;
    const L = (n) => A[ao + n] + (B[bo + n] - A[ao + n]) * u;
    // Hopp i position (tillbakaställning på banan): ingen interpolation
    const jump = (B[bo] - A[ao]) ** 2 + (B[bo + 1] - A[ao + 1]) ** 2 + (B[bo + 2] - A[ao + 2]) ** 2 > 1;
    if (jump) fake.currPos.set(A[ao], A[ao + 1], A[ao + 2]);
    else fake.currPos.set(L(0), L(1), L(2));
    _q.set(A[ao + 3], A[ao + 4], A[ao + 5], A[ao + 6]);
    _q2.set(B[bo + 3], B[bo + 4], B[bo + 5], B[bo + 6]);
    fake.currQuat.copy(_q).slerp(_q2, jump ? 0 : u);
    fake.prevPos.copy(fake.currPos);
    fake.prevQuat.copy(fake.currQuat);
    fake.steer = L(7);
    for (let w = 0; w < fake.wheels.length && w < 4; w++) {
      fake.wheels[w].suspLen = L(8 + w);
      fake.wheels[w].spinVel = L(12 + w);
    }
    fake.grounded = A[ao + 16];
    // Fart ur skillnaden mellan bilderna
    if (jump) fake.vel.set(0, 0, 0);
    else fake.vel.set(B[bo] - A[ao], B[bo + 1] - A[ao + 1], B[bo + 2] - A[ao + 2]).multiplyScalar(RATE);
    _fwd.set(0, 0, 1).applyQuaternion(fake.currQuat);
    fake.speed = fake.vel.dot(_fwd);
  }

  // --- Uppspelning ------------------------------------------------------------
  begin(onEnd) {
    if (this.frames < 2) return false;
    const g = this.game;
    this.closed = true;
    this.active = true;
    this.onEnd = onEnd;
    this.t = 0;
    this.speedIdx = 2;
    this.paused = false;
    this.style = 0;
    this.focus = this.nCars - 1; // spelaren
    this.evIdx = 0;
    this.fakes = this.cars.map((c) => makeFakeVehicle(c.vehicle));
    this.cars.forEach((c, k) => { c.model.vehicle = this.fakes[k]; });
    this.hidden = [];
    for (const e of g.weapons.entities) if (e.mesh?.visible) { e.mesh.visible = false; this.hidden.push(e.mesh); }
    for (const c of this.cars) if (c.bombMark?.visible) { c.bombMark.visible = false; this.hidden.push(c.bombMark); }
    this.shot = { kind: null, t: 0, age: 0 };
    this.airT = 0;
    this.camera = g.camera;
    this.baseFov = g.camera.fov;
    // Delad skärm: reprisen visas i helbild (rätt bildformat, ingen HUD för spelare 2)
    if (g.p2) {
      document.body.classList.remove('split');
      g.camera.aspect = window.innerWidth / window.innerHeight;
      g.camera.updateProjectionMatrix();
    }
    g.hud.setVisible(false);
    this._buildUi();
    this.startedAt = performance.now();
    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey, true);
    this._newShot();
    return true;
  }

  end() {
    if (!this.active) return;
    const g = this.game;
    this.active = false;
    window.removeEventListener('keydown', this._onKey, true);
    this.cars.forEach((c) => { c.model.vehicle = c.vehicle; c.model.update(1, 0); });
    for (const m of this.hidden) m.visible = true;
    g.camera.fov = this.baseFov;
    g.camera.updateProjectionMatrix();
    if (g.p2) document.body.classList.add('split'); // _renderSplit sätter bildformatet igen
    g.chase.snap = true;
    g.hud.setVisible(true);
    this.ui?.remove();
    this.ui = null;
    const cb = this.onEnd;
    this.onEnd = null;
    cb?.();
  }

  _key(e) {
    if (performance.now() - this.startedAt < 150) return;
    const k = e.code;
    let used = true;
    if (k === 'Escape' || k === 'Enter' || k === 'NumpadEnter' || k === 'Backspace') { this._stop(); }
    else if (k === 'ArrowLeft') this.seek(this.t - 5);
    else if (k === 'ArrowRight') this.seek(this.t + 5);
    else if (k === 'ArrowUp') this.speedIdx = Math.min(SPEEDS.length - 1, this.speedIdx + 1);
    else if (k === 'ArrowDown') this.speedIdx = Math.max(0, this.speedIdx - 1);
    else if (k === 'Space') this.paused = !this.paused;
    else if (k === 'KeyC') { this.style = (this.style + 1) % STYLES.length; this._newShot(); }
    else if (k === 'Tab') this.setFocus((this.focus + (e.shiftKey ? -1 : 1) + this.nCars) % this.nCars);
    else if (/^Digit[1-8]$/.test(k)) { const n = +k.slice(5) - 1; if (n < this.nCars) this.setFocus(n); }
    else used = false;
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); } // når varken menyn eller spelets tangenter
  }

  _stop() { this.game.stopReplay(); }

  setFocus(k) { this.focus = k; this._newShot(); }

  seek(t) {
    this.t = Math.max(0, Math.min(this.duration, t));
    this.evIdx = this.ev.findIndex((e) => e.t >= this.t);
    if (this.evIdx < 0) this.evIdx = this.ev.length;
    this._newShot();
  }

  // Per bild: flytta tiden, ställ bilarna, effekter, kamera och rita
  render(dt) {
    const g = this.game;
    const sdt = this.paused ? 0 : dt * SPEEDS[this.speedIdx];
    const prevT = this.t;
    this.t = Math.min(this.duration, this.t + sdt);
    this.cars.forEach((c, k) => {
      const f = this.fakes[k];
      this._read(k, this.t, f);
      for (const w of f.wheels) w.spin += (w.spinVel || 0) * sdt;
      c.model.update(1, sdt);
    });
    // Effekter vid sin tid (bara när tiden går framåt i normal takt)
    while (this.evIdx < this.ev.length && this.ev[this.evIdx].t <= this.t) {
      const e = this.ev[this.evIdx++];
      if (e.t >= prevT - 0.05) this._fx(e);
    }
    g.weapons.fx?.update(sdt);
    for (const pr of g.level.props) {
      const t = pr.body.translation(), r = pr.body.rotation();
      pr.mesh.position.set(t.x, t.y, t.z);
      pr.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    g.trackGroup?.userData.animate?.(g.clock.elapsedTime);

    this._direct(dt, sdt);
    const root = this.cars[this.focus].model.root;
    g.sun.target.position.copy(root.position);
    g.sun.position.copy(root.position).add(g.sunOffset);
    this._updateUi();
    g.renderer.render(g.scene, g.camera);
    if (this.t >= this.duration && !this.paused) this._stop();
  }

  _fx(e) {
    const fx = this.game.weapons.fx;
    const p = _p.set(e.x, e.y + 0.08, e.z);
    if (fx) {
      if (e.type === 0) fx.explosion(p, e.y - 0.1, Math.max(0.6, (e.s || 0.86) / 0.86));
      else if (e.type === 1) fx.emit(p, 0xfff0a0, 8, 1, 0.3);
      else if (e.type === 2) fx.shockBurst(p, e.y - 0.1, 0.5);
      else if (e.type === 3) fx.splash(p, e.y - 0.1);
      else if (e.type === 4) fx.emit(p, 0xffd9a0, Math.min(14, 3 + e.s * 2), 1.2, 0.3);
    }
    // Ljud: explosioner, elchocker och plask spelas om
    const ev = this.game.events;
    if (e.type === 0) ev.emit('explode', { pos: p.clone(), size: e.s, replay: true });
    else if (e.type === 2) ev.emit('zap', { pos: p.clone(), replay: true });
    else if (e.type === 3) ev.emit('splash', { pos: p.clone(), replay: true });
    // Smäll nära bilen i bild: byt vinkel
    if (e.type === 0 && STYLES[this.style][0] === 'auto' && this.shot.age > 1.2 &&
        this.fakes[this.focus].currPos.distanceTo(p) < 3) this._newShot('trackside');
  }

  // --- Filmkamera ---------------------------------------------------------------
  _newShot(force) {
    const style = STYLES[this.style][0];
    let kind = style === 'auto' ? force : style;
    if (!kind) {
      const r = Math.random();
      const prev = this.shot.kind;
      kind = r < 0.38 ? 'chase' : r < 0.78 ? 'trackside' : 'bumper';
      if (kind === prev && prev !== 'trackside') kind = 'trackside';
    }
    this.shot = { kind, t: 4 + Math.random() * 3, age: 0, spot: null, side: Math.random() < 0.5 ? 1 : -1, orbit: Math.random() * 6.28, bumper: Math.random() < 0.5 ? 'front' : 'wheel' };
    this.game.chase.snap = true;
    if (kind === 'trackside') this._placeSpot(true);
  }

  // Fast kamera vid sidan av vägen, en bit framför bilen
  _placeSpot(first) {
    const T = this.game.track, f = this.fakes[this.focus];
    const hint = this.shot.trackIdx ?? -1;
    const near = T.nearest(f.currPos.x, f.currPos.z, hint, 40, f.currPos.y);
    this.shot.trackIdx = near.index;
    const ahead = Math.round((first ? 6 + Math.random() * 6 : 9 + Math.random() * 5) / T.spacing);
    this.shot.side = -this.shot.side;
    const pose = T.poseAt(near.index + ahead, this.shot.side * (T.roadHalf + 0.5 + Math.random() * 0.6));
    this.shot.spot = new THREE.Vector3(pose.x, pose.y + 0.25 + Math.random() * 0.55, pose.z);
    this.shot.spotIdx = pose.index;
  }

  _direct(dt, sdt) {
    const S = this.shot;
    const f = this.fakes[this.focus];
    const root = this.cars[this.focus].model.root;
    S.t -= sdt; S.age += sdt;
    // I luften: allt i luften i en stund → kamera ovanifrån
    this.airT = f.grounded === 0 ? this.airT + sdt : 0;
    if (STYLES[this.style][0] === 'auto') {
      if (this.airT > 0.12 && S.kind !== 'overhead' && S.age > 0.6) { this._newShot('overhead'); this.shot.t = 2.2; }
      else if (S.t <= 0 && !(S.kind === 'overhead' && this.airT > 0)) this._newShot();
    }
    const cam = this.camera;
    const kind = this.shot.kind;
    if (kind === 'chase') {
      this.game.chase.update(dt, root.position, root.quaternion, f.vel, f.speed, f.def.topSpeed, { phase: 'race' });
    } else if (kind === 'trackside') {
      const s = this.shot;
      const T = this.game.track;
      const near = T.nearest(f.currPos.x, f.currPos.z, s.trackIdx, 40, f.currPos.y);
      s.trackIdx = near.index;
      // Bilen har passerat kameran: nästa plats längre fram
      const passed = ((near.index - s.spotIdx + T.N) % T.N) < T.N / 2 && s.spot.distanceTo(root.position) > 2.2;
      if (passed || s.spot.distanceTo(root.position) > 22) this._placeSpot(false);
      cam.position.copy(s.spot);
      cam.lookAt(root.position.x, root.position.y + 0.05, root.position.z);
      const d = s.spot.distanceTo(root.position);
      const fov = Math.max(14, Math.min(58, 62 - d * 3.2)); // zoomar in när bilen är långt bort
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    } else if (kind === 'bumper') {
      _fwd.set(0, 0, 1).applyQuaternion(root.quaternion);
      _up.set(0, 1, 0).applyQuaternion(root.quaternion);
      const side = _v.set(1, 0, 0).applyQuaternion(root.quaternion);
      if (this.shot.bumper === 'front') {
        cam.position.copy(root.position).addScaledVector(_fwd, 0.2).addScaledVector(_up, 0.045);
      } else {
        // Vid bakhjulet, utanför karossen
        cam.position.copy(root.position).addScaledVector(_fwd, -0.12).addScaledVector(side, this.shot.side * 0.27).addScaledVector(_up, 0.07);
      }
      _p.copy(root.position).addScaledVector(_fwd, 3).addScaledVector(_up, 0.05);
      cam.up.copy(_up);
      cam.lookAt(_p);
      cam.up.set(0, 1, 0);
      cam.fov += (68 - cam.fov) * Math.min(1, dt * 8);
      cam.updateProjectionMatrix();
    } else if (kind === 'overhead') {
      const s = this.shot;
      s.orbit += sdt * 0.5;
      const r = 2.2, h = 2.4;
      _p.set(root.position.x + Math.sin(s.orbit) * r, root.position.y + h, root.position.z + Math.cos(s.orbit) * r);
      if (s.age < 0.01) cam.position.copy(_p); else cam.position.lerp(_p, 1 - Math.exp(-dt * 6));
      cam.lookAt(root.position);
      cam.fov += (50 - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    }
  }

  // --- Reprisskylt ----------------------------------------------------------------
  _buildUi() {
    const el = document.createElement('div');
    el.id = 'replay';
    el.innerHTML = `<div class="rp-top"><span class="rp-badge">REPRIS</span><span class="rp-info"></span></div>
      <div class="rp-bar"><i></i></div>
      <div class="rp-hint">←→ spola · ↑↓ fart · Mellanslag paus · C kamera · 1–8/Tab bil · Esc avsluta</div>`;
    document.body.appendChild(el);
    this.ui = el;
    this.uiInfo = el.querySelector('.rp-info');
    this.uiBar = el.querySelector('.rp-bar i');
    this.uiTxt = '';
  }

  _updateUi() {
    if (!this.ui) return;
    const name = this.cars[this.focus].racer.name;
    const txt = `${formatTime(this.t)} / ${formatTime(this.duration)} · ${this.paused ? 'PAUS' : SPEEDS[this.speedIdx] + '×'} · ${STYLES[this.style][1]} · ${name}`;
    if (txt !== this.uiTxt) { this.uiInfo.textContent = txt; this.uiTxt = txt; }
    this.uiBar.style.width = `${(this.duration ? this.t / this.duration : 0) * 100}%`;
    this.ui.classList.toggle('blink', !this.paused && Math.floor(performance.now() / 600) % 2 === 0);
  }
}

// Minsta möjliga "fordon" som bilmodellen kan läsa (samma mönster som spöket)
function makeFakeVehicle(real) {
  const vel = new THREE.Vector3();
  return {
    def: real.def,
    id: real.id + '-replay',
    uid: -2,
    steer: 0,
    currPos: new THREE.Vector3().copy(real.currPos), currQuat: new THREE.Quaternion().copy(real.currQuat),
    prevPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(),
    wheels: real.wheels.map((w) => ({ ...w, contact: w.contact?.clone?.(), normal: w.normal?.clone?.(), suspLen: w.suspLen, spin: w.spin, spinVel: 0 })),
    vel,
    body: { linvel: () => vel, angvel: () => ({ x: 0, y: 0, z: 0 }) },
    mods: { topMul: 1, gripMul: 1, powerMul: 1 },
    speed: 0, motor: 0, grounded: 4,
    pose(alpha, outPos, outQuat) { outPos.copy(this.currPos); outQuat.copy(this.currQuat); },
    get position() { return this.currPos; },
  };
}
