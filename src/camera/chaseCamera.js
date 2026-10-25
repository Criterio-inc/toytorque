import * as THREE from 'three';
import { CAMERA_RAY_GROUPS } from '../core/physics.js';

// ---------------------------------------------------------------------------
// Kameran:
//  - Följ: låg och nära, på en fjäder (styvhet 60, dämpning 14). Riktningen
//    hänger efter bilen, så i kurvor svänger kameran ut och bilen glider åt
//    sidan i bild. Längre bak och lite högre i fart, närmare i låg fart.
//  - Intro: ett svep från högt framför startfältet runt och ner bakom bilen.
//  - Mål: kameran cirklar långsamt runt bilen.
// C växlar följlägen. Strål mot världen hindrar att kameran hamnar i väggar.
// ---------------------------------------------------------------------------

const MODES = [
  { name: 'Följ', back: 0.95, backFast: 1.55, up: 0.3, upFast: 0.42, look: 0.1, lead: 0.28, swing: 2.4 },
  { name: 'Nära', back: 0.7, backFast: 1.0, up: 0.22, upFast: 0.28, look: 0.08, lead: 0.2, swing: 3.2 },
  { name: 'Långt', back: 1.8, backFast: 2.6, up: 0.6, upFast: 0.8, look: 0.15, lead: 0.35, swing: 1.8 },
  { name: 'Huv', back: -0.12, up: 0.11, look: 0.1, ahead: 3, rigid: true },
];

const _fwd = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export class ChaseCamera {
  constructor(camera, world, RAPIER) {
    this.camera = camera;
    this.world = world;
    this.RAPIER = RAPIER;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.heading = new THREE.Vector3(0, 0, 1);
    this.baseFov = camera.fov;
    this.snap = true;
    this.orbit = 0;
    this.trauma = 0; // kameraskak 0..1, avtar av sig själv
    this.shakeT = 0;
  }

  addShake(a) { this.trauma = Math.min(1, this.trauma + a); }

  // Skakningen läggs ovanpå den färdiga kamerabilden: förskjutning och lite rull
  _shake(dt) {
    if (this.trauma <= 0) return;
    this.shakeT += dt;
    const s = this.trauma * this.trauma, t = this.shakeT * 28;
    const n = (a, b) => Math.sin(t * a + b) * 0.6 + Math.sin(t * a * 2.13 + b * 1.7) * 0.4;
    this.camera.position.x += s * 0.05 * n(1.0, 0.3);
    this.camera.position.y += s * 0.04 * n(1.13, 1.9);
    this.camera.position.z += s * 0.05 * n(0.91, 4.1);
    this.camera.rotateZ(s * 0.06 * n(0.77, 2.6));
    this.camera.rotateX(s * 0.03 * n(1.27, 5.3));
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
  }

  next() { this.mode = (this.mode + 1) % MODES.length; this.snap = true; return MODES[this.mode].name; }

  // state: { phase: 'intro'|'race'|'finish', introLeft, introLen, gridCenter }
  update(dt, carPos, carQuat, carVel, speed, top, state = {}) {
    if (state.phase === 'intro' && state.introLen > 0) return this._intro(dt, carPos, carQuat, speed, top, state);
    if (state.phase === 'finish') return this._finish(dt, carPos, speed);

    const M = MODES[this.mode];
    if (M.rigid) return this._hood(dt, carPos, carQuat, speed, M);

    this._follow(dt, carPos, carQuat, carVel, speed, top, M);
    this._spring(dt);
    this._apply(dt, speed);
  }

  // Önskad följposition (används även som slutpunkt för introsvepet)
  _desiredFollow(carPos, carQuat, carVel, speed, top, M, dt, snap) {
    // Riktning: bilens nos i markplanet, mot färdriktningen i fart
    _fwd.set(0, 0, 1).applyQuaternion(carQuat); _fwd.y = 0;
    _vel.set(carVel.x, 0, carVel.z);
    const vs = _vel.length();
    if (vs > 2 && speed > 0) _fwd.lerp(_vel.divideScalar(vs), Math.min(1, (vs - 2) / 6) * 0.6);
    if (_fwd.lengthSq() > 1e-4) {
      _fwd.normalize();
      if (snap) this.heading.copy(_fwd);
      else this.heading.lerp(_fwd, 1 - Math.exp(-dt * M.swing)).normalize();
    }
    const f = Math.min(1, Math.abs(speed) / (top || 15));
    const back = M.back + (M.backFast - M.back) * f;
    const up = M.up + (M.upFast - M.up) * f;
    _desired.copy(carPos).addScaledVector(this.heading, -back);
    _desired.y += up;
    _look.copy(carPos).addScaledVector(_vel.set(carVel.x, 0, carVel.z), M.lead * 0.25).addScaledVector(this.heading, 0.35);
    _look.y += M.look;
  }

  _follow(dt, carPos, carQuat, carVel, speed, top, M) {
    this._desiredFollow(carPos, carQuat, carVel, speed, top, M, dt, this.snap);
    this._avoidWalls();
    if (this.snap) {
      this.pos.copy(_desired);
      this.vel.set(0, 0, 0);
      this.lookAt.copy(_look);
      this.snap = false;
    }
  }

  // Svep: högt och framför startfältet → runt → ner till följpositionen
  _intro(dt, carPos, carQuat, speed, top, state) {
    const M = MODES[this.mode].rigid ? MODES[0] : MODES[this.mode];
    const u = ease(1 - Math.max(0, state.introLeft) / state.introLen);
    this._desiredFollow(carPos, carQuat, { x: 0, y: 0, z: 0 }, 0, top, M, dt, true);
    const endPos = _desired.clone(), endLook = _look.clone();
    const c = state.gridCenter || carPos;
    // Vinkel runt mitten av fältet: börjar snett framifrån, slutar bakom spelaren
    const behind = Math.atan2(-this.heading.x, -this.heading.z);
    const ang = behind + (1 - u) * Math.PI * 1.15;
    const r = 1.2 + (1 - u) * 5.5;
    const h = 0.4 + (1 - u) * (1 - u) * 3.2;
    const sweep = new THREE.Vector3(c.x + Math.sin(ang) * r, c.y + h, c.z + Math.cos(ang) * r);
    const look = new THREE.Vector3(c.x, c.y + 0.1, c.z);
    const k = Math.pow(u, 3); // sista biten glider in i följpositionen
    this.pos.lerpVectors(sweep, endPos, k);
    this.lookAt.lerpVectors(look, endLook, k);
    this.vel.set(0, 0, 0);
    this.snap = false;
    this._apply(dt, 0);
  }

  // Målkamera: långsam cirkel runt bilen
  _finish(dt, carPos, speed) {
    this.orbit += dt * 0.45;
    const r = 1.35;
    _desired.set(carPos.x + Math.sin(this.orbit) * r, carPos.y + 0.45, carPos.z + Math.cos(this.orbit) * r);
    _look.copy(carPos); _look.y += 0.06;
    this._avoidWalls();
    if (this.snap) { this.pos.copy(_desired); this.lookAt.copy(_look); this.vel.set(0, 0, 0); this.snap = false; }
    this._spring(dt, 20, 9);
    this._apply(dt, speed * 0.3);
  }

  _hood(dt, carPos, carQuat, speed, M) {
    _fwd.set(0, 0, 1).applyQuaternion(carQuat);
    _up.set(0, 1, 0).applyQuaternion(carQuat);
    this.pos.copy(carPos).addScaledVector(_fwd, -M.back).addScaledVector(_up, M.up);
    _look.copy(carPos).addScaledVector(_fwd, M.ahead).addScaledVector(_up, M.look);
    this.camera.position.copy(this.pos);
    this.camera.up.copy(_up);
    this.camera.lookAt(_look);
    this.camera.up.set(0, 1, 0);
    this.snap = false;
    this._shake(dt);
    this._fov(dt, speed);
  }

  _avoidWalls() {
    _dir.subVectors(_desired, _look);
    const len = _dir.length();
    if (len < 1e-3) return;
    _dir.divideScalar(len);
    const ray = new this.RAPIER.Ray(_look, _dir);
    const hit = this.world.castRay(ray, len, true, undefined, CAMERA_RAY_GROUPS);
    if (hit) _desired.copy(_look).addScaledVector(_dir, Math.max(0.15, hit.timeOfImpact - 0.08));
  }

  _spring(dt, k = 60, d = 14) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel.x += (k * (_desired.x - this.pos.x) - d * this.vel.x) * h;
      this.vel.y += (k * (_desired.y - this.pos.y) - d * this.vel.y) * h;
      this.vel.z += (k * (_desired.z - this.pos.z) - d * this.vel.z) * h;
      this.pos.addScaledVector(this.vel, h);
    }
    // Släpar kameran för långt efter (krasch, respawn) dras den in
    const lag = this.pos.distanceTo(_desired);
    if (lag > 3) this.pos.lerp(_desired, 1 - 3 / lag);
    this.lookAt.lerp(_look, 1 - Math.exp(-dt * 14));
  }

  _apply(dt, speed) {
    if (this.pos.y < 0.06) this.pos.y = 0.06;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.lookAt);
    this._shake(dt);
    this._fov(dt, speed);
  }

  _fov(dt, speed) {
    const target = this.baseFov + Math.min(9, Math.abs(speed) * 0.4);
    this.camera.fov += (target - this.camera.fov) * (1 - Math.exp(-dt * 3));
    this.camera.updateProjectionMatrix();
  }
}
