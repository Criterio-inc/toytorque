import * as THREE from 'three';
import {
  carDims, tyreGeometry, rimGeometry, armGeometry, shockGeometry, shaftGeometry,
  uprightGeometry, antennaGeometry, chassisGeometry,
} from './carParts.js';
import { buildShell, paintLivery } from './carShell.js';

// ---------------------------------------------------------------------------
// Bilens utseende: en radiostyrd bil i skala 1:10. Bottenplatta med
// stötdämpartorn, länkarmar, stötdämpare med spiralfjädrar, drivaxlar och
// hjul som följer fjädringen; ovanpå sitter ett tunt lackerat lexanskal med
// rutor, nummer och dekaler. Stilar: 'buggy', 'touring', 'sport', 'truck',
// 'rally', 'formula' och 'saucer'.
//
// Ritanrop per bil: kaross, plastdelar, metalldelar, däck, fälgar,
// länkarmar, stötdämpare, drivaxlar, hjulhållare och antenn (10 st).
// Geometrier och texturer delas mellan bilar med samma stil och färger.
// ---------------------------------------------------------------------------

const KIT = new Map(); // geometrier per stil + mått + motor
const LIVERY = new Map(); // lackmaterial per färgsättning
const MATS = {};

function sharedMats() {
  if (!MATS.plastic) {
    MATS.plastic = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
    MATS.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.85 });
    MATS.rim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35 });
  }
  return MATS;
}

const SPRING = {
  buggy: [0xe2b236, 0xc8232b],
  touring: [0xe2b236, 0x2f63d8],
  sport: [0xe8e8ea, 0xc8232b],
  truck: [0xe2b236, 0xc8232b],
  rally: [0x3a8fe0, 0xe8e8ea],
  formula: [0xe8e8ea, 0x111214],
  saucer: [0x66ff7a, 0xb8c4d0],
};

function kitFor(def) {
  const d = carDims(def);
  const key = [d.style, def.engine, def.drive, d.R, d.W, d.X, d.zF, d.zR, d.yW].join('|');
  let k = KIT.get(key);
  if (!k) {
    const shell = buildShell(d);
    const ch = chassisGeometry(d, def, shell.info);
    const [spring, damper] = SPRING[d.style] || SPRING.buggy;
    const tyre = tyreGeometry(d);
    k = {
      d, shell, ...ch, tyre,
      tyreMat: tyreMaterial(d, tyre.userData.tread),
      arm: armGeometry(0x2a2b2f),
      shock: shockGeometry(spring, damper),
      shaft: shaftGeometry(),
      upright: uprightGeometry(d, 0x2a2b2f),
      rims: new Map(),
      antennas: new Map(),
    };
    KIT.set(key, k);
  }
  return k;
}

// Däcktextur: slitbana i mitten (terrängmönster, fin räffling eller slick)
function tyreMaterial(d, [t0, t1]) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#1b1b1c';
  g.fillRect(0, 0, 512, 128);
  const y0 = (1 - t1) * 128, y1 = (1 - t0) * 128;
  // gummikorn
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#222224' : '#151516';
    g.fillRect(Math.random() * 512, Math.random() * 128, 2, 2);
  }
  if (d.style === 'touring') {
    g.fillStyle = '#0c0c0d';
    for (const f of [0.33, 0.67]) g.fillRect(0, y0 + (y1 - y0) * f - 2, 512, 4);
    g.strokeStyle = '#0e0e0f'; g.lineWidth = 2;
    for (let x = 0; x < 512; x += 8) { g.beginPath(); g.moveTo(x, y0 + 3); g.lineTo(x + 6, y1 - 3); g.stroke(); }
  } else if (d.style === 'sport' || d.style === 'formula' || d.style === 'saucer') {
    g.fillStyle = '#262628';
    g.fillRect(0, y0 + 4, 512, y1 - y0 - 8);
  } else {
    g.fillStyle = '#121213';
    for (let x = 0; x < 512; x += 16) g.fillRect(x, y0, 3, y1 - y0);
  }
  // Sidoväggsmärkning på båda sidor
  g.fillStyle = '#8a8c90';
  g.font = 'bold 13px Arial, sans-serif';
  g.textBaseline = 'middle';
  for (const yy of [y0 * 0.5, y1 + (128 - y1) * 0.5]) {
    for (let x = 10; x < 512; x += 128) g.fillText('RC GRIP', x, yy);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map: tex, bumpMap: tex, bumpScale: 1.5, roughness: d.style === 'sport' || d.style === 'formula' ? 0.72 : 0.9, metalness: 0,
  });
}

function rimColorFor(def) {
  const c = def.colors;
  if (def.style === 'touring') return (c.body & 0xffffff) === 0xf2f2f2 ? 0x2a2a2a : 0xe9eaec;
  return c.accent;
}

// Startnummer: spelaren har bilens eget (def.num), datorförarna numreras efter id
const AI_NUM = [11, 14, 22, 5, 9, 33, 18, 42];
function raceNumber(def) {
  const m = /^(.*)-(\d+)$/.exec(def.id || '');
  if (m) return AI_NUM[+m[2] % AI_NUM.length];
  return def.num ?? 8;
}

function liveryMat(kit, def) {
  const n = raceNumber(def);
  const c = def.colors;
  const key = [kit.d.style, kit.shell.info.tailZ, c.body, c.trim, c.accent, n].join('|');
  let m = LIVERY.get(key);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({
      map: paintLivery(kit.shell.paint, kit.d, c, n),
      roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.07, side: THREE.DoubleSide,
    });
    LIVERY.set(key, m);
  }
  return m;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);
const BOUNDS = new THREE.Sphere(new THREE.Vector3(), 0.45);

function instanced(geo, mat, count, shadow = false) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.boundingSphere = BOUNDS; // delarna rör sig, men alltid inom bilen
  m.castShadow = shadow;
  return m;
}

export class CarModel {
  constructor(vehicle) {
    this.vehicle = vehicle;
    const def = vehicle.def;
    const kit = kitFor(def);
    const M = sharedMats();
    const d = (this.d = kit.d);

    this.root = new THREE.Group();
    this.chassis = new THREE.Group();
    this.root.add(this.chassis);
    this.shell = new THREE.Group();
    this.chassis.add(this.shell);

    const mesh = (geo, mat, shadow, parent = this.chassis) => {
      const o = new THREE.Mesh(geo, mat);
      o.castShadow = shadow;
      parent.add(o);
      return o;
    };
    mesh(kit.shell.geo, liveryMat(kit, def), true, this.shell);
    mesh(kit.plastic, M.plastic, true);
    mesh(kit.metal, M.metal, false);

    const rc = rimColorFor(def);
    if (!kit.rims.has(rc)) kit.rims.set(rc, rimGeometry(d, rc));
    this.tyres = instanced(kit.tyre, kit.tyreMat, 4, true);
    this.rims = instanced(kit.rims.get(rc), M.rim, 4);
    this.uprights = instanced(kit.upright, M.plastic, 4);
    this.arms = instanced(kit.arm, M.plastic, 8, true);
    this.shocks = instanced(kit.shock, M.metal, 4);
    this.driven = vehicle.wheels.map((w, i) => (w.driven ? i : -1)).filter((i) => i >= 0);
    this.shafts = instanced(kit.shaft, M.metal, Math.max(1, this.driven.length));
    this.shafts.count = this.driven.length;
    this.chassis.add(this.tyres, this.rims, this.uprights, this.arms, this.shocks, this.shafts);

    // Antenn: spö i ett fäste på chassit, svajar med en fjäder
    const ac = def.colors.accent;
    if (!kit.antennas.has(ac)) kit.antennas.set(ac, antennaGeometry(ac));
    this.antennaPivot = new THREE.Group();
    this.antennaPivot.position.set(...kit.shell.info.antenna);
    this.shell.add(this.antennaPivot);
    mesh(kit.antennas.get(ac), M.plastic, false, this.antennaPivot);
    this.ant = { ax: 0, az: 0, vx: 0, vz: 0 };
    this._lastVel = new THREE.Vector3();

    this.update(1, 0);
  }

  // Stav-instans från a till b: geometrin är 1 lång längs x (rotation runt z)
  _link(mesh, i, a, b, sy = 1, sz = 1) {
    _d.subVectors(b, a);
    _q.setFromAxisAngle(AZ, Math.atan2(_d.y, _d.x));
    _m.compose(a, _q, _s.set(Math.hypot(_d.x, _d.y), sy, sz));
    mesh.setMatrixAt(i, _m);
  }

  // Uppdatera grafiken ur fordonets interpolerade pose.
  update(alpha, dt) {
    const v = this.vehicle;
    const d = this.d;
    v.pose(alpha, this.root.position, this.root.quaternion);

    const attachY = v.def.wheel.attachY;
    let si = 0;
    v.wheels.forEach((wh, i) => {
      const side = wh.x >= 0 ? 1 : -1;
      const yc = attachY - wh.suspLen; // hjulcentrum hänger på fjädern
      const steer = wh.front ? v.steer : 0;

      // Hjul: styrning, spegling för vänster sida och rotation
      _p.set(wh.x, yc, wh.z);
      _q.setFromAxisAngle(AY, steer + (side < 0 ? Math.PI : 0));
      _m.compose(_p, _q, ONE);
      this.uprights.setMatrixAt(i, _m);
      _q2.setFromAxisAngle(AX, side < 0 ? -wh.spin : wh.spin);
      _q.multiply(_q2);
      _m.compose(_p, _q, ONE);
      this.tyres.setMatrixAt(i, _m);
      this.rims.setMatrixAt(i, _m);

      // Länkarmar: undre A-arm och övre länk följer hjulets höjd
      _a.set(side * d.xi, d.yLi, wh.z);
      _b.set(side * d.xo, yc + d.dyLo, wh.z);
      this._link(this.arms, i, _a, _b);
      const lx = _a.x + (_b.x - _a.x) * 0.74, ly = _a.y + (_b.y - _a.y) * 0.74 + 0.004;
      _a.set(side * d.xiU, d.yUi, wh.z);
      _b.set(side * d.xo, yc + d.dyUo, wh.z);
      this._link(this.arms, 4 + i, _a, _b, 0.8, 0.28);

      // Stötdämpare från armen upp till tornet
      const sz = wh.front ? 0.004 : -0.004;
      _a.set(lx, ly, wh.z + sz);
      _b.set(side * d.xs, wh.front ? d.ysF : d.ys, wh.z + sz * 2.5);
      _d.subVectors(_b, _a);
      const len = _d.length();
      _q.setFromUnitVectors(AY, _d.divideScalar(len));
      _m.compose(_a, _q, _s.set(1, len, 1));
      this.shocks.setMatrixAt(i, _m);

      // Drivaxel från växellådan till hjulnavet
      if (wh.driven) {
        _a.set(side * d.xg, d.yW, wh.z);
        _b.set(wh.x - side * d.W * 0.22, yc, wh.z);
        this._link(this.shafts, si++, _a, _b);
      }
    });
    for (const m of [this.tyres, this.rims, this.uprights, this.arms, this.shocks, this.shafts]) m.instanceMatrix.needsUpdate = true;

    // Antennen: fjäder som drivs av bilens acceleration i lokala axlar
    if (dt > 0) {
      const lv = v.body.linvel();
      const acc = new THREE.Vector3(lv.x - this._lastVel.x, lv.y - this._lastVel.y, lv.z - this._lastVel.z).divideScalar(dt);
      this._lastVel.set(lv.x, lv.y, lv.z);
      acc.applyQuaternion(this.root.quaternion.clone().invert());
      const a = this.ant, k = 90, dd = 4.5, g = 0.012;
      a.vx += (-k * a.ax - dd * a.vx + acc.z * g * 8) * dt;
      a.vz += (-k * a.az - dd * a.vz + acc.x * g * 8) * dt;
      a.ax = THREE.MathUtils.clamp(a.ax + a.vx * dt, -0.9, 0.9);
      a.az = THREE.MathUtils.clamp(a.az + a.vz * dt, -0.9, 0.9);
      this.antennaPivot.rotation.set(-a.ax, 0, a.az);
    }
  }
}
