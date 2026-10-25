import * as THREE from 'three';
import { STEP } from '../core/physics.js';
import { CarModel } from '../vehicle/carModel.js';
import { touchGhost, storeSafely } from './progress.js';

// ---------------------------------------------------------------------------
// Spökbil i tidskörning: spelarens bästa varv spelas upp som en genomskinlig
// bil. Varvet spelas in med 15 Hz (position, rotation, styrning; avrundat för
// att spara plats) och sparas per bana och bil i webbläsaren, högst 20 st
// (äldst använda rensas, se progress.js). Äldre sparningar med 30 Hz läses också.
// ---------------------------------------------------------------------------

const RATE = 15;
const keyFor = (level, car) => `revolt.ghost.${level}.${car}`;

export class Ghost {
  constructor(game) {
    this.game = game;
    this.key = keyFor(game.levelDef.id, game.carId);
    this.rec = [];
    this.recT = 0;
    this.best = load(this.key); // { time, frames: [[x,y,z,qx,qy,qz,qw,steer], ...] }
    this.lapStart = 0;
    this.racer = game.racer;
    this.lastLap = this.racer.lap;
    this.started = false;

    // Spökbilen: en egen bilmodell med genomskinliga material
    this.fake = makeFakeVehicle(game.player);
    this.model = new CarModel(this.fake);
    this.model.root.traverse((o) => {
      if (!o.material) return;
      o.material = [].concat(o.material).map((m) => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = 0.32;
        c.depthWrite = false;
        return c;
      });
      if (o.material.length === 1) o.material = o.material[0];
      o.castShadow = false;
    });
    this.model.root.visible = false;
    game.levelGroup.add(this.model.root);
  }

  get bestTime() { return this.best?.time ?? null; }

  // Varje fysiksteg: spela in och känna av varvbyten
  step() {
    const r = this.racer;
    if (!r.started) return;
    if (!this.started) { this.started = true; this.rec = []; this.recT = 0; }
    if (r.lap !== this.lastLap || r.finished) {
      // Ett varv klart: spara om det var bästa
      const t = r.lastLap;
      if (t != null && (!this.best || t < this.best.time) && this.rec.length > 10) {
        this.best = { time: t, rate: RATE, frames: this.rec };
        save(this.key, this.best);
      }
      this.lastLap = r.lap;
      this.rec = [];
      this.recT = 0;
    }
    this.recT += STEP;
    if (this.recT * RATE >= this.rec.length) {
      const v = this.game.player;
      const p = v.currPos, q = v.currQuat;
      const r = (n, k) => Math.round(n * k) / k;
      this.rec.push([r(p.x, 100), r(p.y, 1000), r(p.z, 100), r(q.x, 1000), r(q.y, 1000), r(q.z, 1000), r(q.w, 1000), r(v.steer, 100)]);
    }
  }

  // Per bild: placera spöket där det var lika långt in på sitt bästa varv
  render() {
    const r = this.racer;
    const fr = this.best?.frames;
    if (!fr || !r.started || r.finished) { this.model.root.visible = false; return; }
    const f = r.lapTime * (this.best.rate || 30);
    const i = Math.floor(f);
    if (i >= fr.length - 1) { this.model.root.visible = false; return; }
    const a = fr[i], b = fr[i + 1], u = f - i;
    const fake = this.fake;
    fake.currPos.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
    fake.currQuat.set(a[3], a[4], a[5], a[6]).slerp(new THREE.Quaternion(b[3], b[4], b[5], b[6]), u);
    fake.prevPos.copy(fake.currPos);
    fake.prevQuat.copy(fake.currQuat);
    fake.steer = a[7];
    for (const w of fake.wheels) w.spin += 0.6;
    this.model.root.visible = true;
    this.model.update(1, 0);
  }
}

// Minsta möjliga "fordon" som bilmodellen kan läsa
function makeFakeVehicle(real) {
  const fake = {
    def: real.def,
    id: real.id + '-ghost',
    uid: -1,
    steer: 0,
    currPos: new THREE.Vector3(), currQuat: new THREE.Quaternion(),
    prevPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(),
    wheels: real.wheels.map((w) => ({ ...w, contact: w.contact.clone(), normal: w.normal.clone(), suspLen: real.def.susp.rest - real.def.susp.sag, grounded: true, spin: 0, skid: false })),
    body: { linvel: () => ({ x: 0, y: 0, z: 0 }), angvel: () => ({ x: 0, y: 0, z: 0 }) },
    mods: { topMul: 1, gripMul: 1, powerMul: 1 },
    speed: 0, motor: 0, grounded: 4,
    pose(alpha, outPos, outQuat) { outPos.copy(this.currPos); outQuat.copy(this.currQuat); },
    get position() { return this.currPos; },
  };
  return fake;
}

// Läs ett sparat spöke; trasig eller okänd data ger null
function load(key) {
  let d = null;
  try { const s = localStorage.getItem(key); d = s ? JSON.parse(s) : null; } catch { return null; }
  const num = (n) => typeof n === 'number' && Number.isFinite(n);
  if (!d || !num(d.time) || d.time <= 0 || !Array.isArray(d.frames) || d.frames.length < 2) return null;
  if (d.rate != null && !(num(d.rate) && d.rate > 0)) return null;
  if (!d.frames.every((f) => Array.isArray(f) && f.length >= 8 && f.every(num))) return null;
  touchGhost(key);
  return d;
}
function save(key, data) {
  // Fullt: äldre spöken rensas först; går det ändå inte hoppar vi över (inget felmeddelande)
  if (storeSafely(key, JSON.stringify(data), { ghost: true })) touchGhost(key);
}
