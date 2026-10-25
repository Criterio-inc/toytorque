import * as THREE from 'three';
import { G, groups, GRAVITY } from '../core/physics.js';
import { WEAPONS, TUNE, rollWeapon, tableColumn } from './defs.js';
import { WeaponFx, oilGeometry, oilMaterial } from './weaponFx.js';

// ---------------------------------------------------------------------------
// Vapensystemet: pickuper längs banan, roulette, alla vapen och deras
// effekter, samt när datorförarna använder dem. Fungerar utan grafik
// (scene = null) så att testskriptet kan köra hela kaoset.
//
// Per förare (racer) lagras: weapon {id, shots}, roulette, bomb, fx-timers.
// Varje fysiksteg sätter update() bilarnas mods (turbo, elchock, vått grepp)
// innan bilarna räknar sina krafter.
// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class WeaponSystem {
  constructor({ scene = null, world, RAPIER, track, race, cars, events = null, enabled = true }) {
    this.enabled = enabled;
    this.events = events || { emit() {} };
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.track = track;
    this.race = race;
    this.cars = cars; // [{ vehicle, racer, ai }]
    this.entities = [];
    this.time = 0;
    this.group = scene ? new THREE.Group() : null;
    if (scene) scene.add(this.group);
    this.fx = scene ? new WeaponFx(this.group) : null;
    this.lowFx = false; // Grafik: Enkel
    for (const c of cars) initRacer(c.racer);
    this.pickups = [];
    if (enabled) this._placePickups();
  }

  // --- Pickuper ---------------------------------------------------------------
  _placePickups() {
    const T = this.track;
    const every = Math.round(32 / T.spacing);
    const clearGap = Math.round(12 / T.spacing);
    const nearGap = (i) => { for (let k = -clearGap; k <= clearGap; k++) if (T.isGap[(i + k + T.N) % T.N]) return true; return false; };
    for (let i = Math.round(20 / T.spacing); i < T.N - Math.round(8 / T.spacing); i += every) {
      if (nearGap(i)) continue;
      // Tre i en rad tvärs banan
      for (const lat of [-0.75, 0, 0.75]) {
        const p = T.poseAt(i, Math.max(-T.roadHalf + 0.4, Math.min(T.roadHalf - 0.4, lat)));
        this.pickups.push({ pos: new THREE.Vector3(p.x, p.y + 0.22, p.z), active: true, regrow: 0, mesh: null, scale: 1 });
      }
    }
    if (this.scene) {
      const geo = boltGeometry();
      // Alla blixtar i ett ritanrop
      this.pickupMesh = new THREE.InstancedMesh(geo, pickupMaterial(), Math.max(1, this.pickups.length));
      this.pickupMesh.castShadow = true;
      this.pickupMesh.frustumCulled = false;
      this.group.add(this.pickupMesh);
    }
  }

  // --- Ett fysiksteg ------------------------------------------------------------
  update(dt) {
    this.time += dt;
    const racing = this.race.running;

    // Effekter → bilarnas mods
    for (const c of this.cars) {
      const r = c.racer, v = c.vehicle, f = r.fx;
      for (const k in f) if (f[k] > 0) f[k] = Math.max(0, f[k] - dt);
      v.mods.topMul = (v.baseTopMul ?? 1) * (f.turbo > 0 ? TUNE.turbo.top : 1);
      v.mods.powerMul = (f.zap > 0 ? 0 : 1) * (f.turbo > 0 ? TUNE.turbo.power : 1);
      v.mods.gripMul = f.wet > 0 ? 0.55 : 1;
      if (r.weaponCooldown > 0) r.weaponCooldown -= dt;
    }
    if (!racing) return;

    // Plocka pickuper
    for (const p of this.pickups) {
      if (!p.active) {
        p.regrow -= dt;
        if (p.regrow <= 0) { p.active = true; p.scale = 0; }
        continue;
      }
      for (const c of this.cars) {
        const r = c.racer;
        if (r.weapon || r.roulette > 0 || r.bomb > 0 || r.finished) continue;
        const vp = c.vehicle.position;
        if ((vp.x - p.pos.x) ** 2 + (vp.z - p.pos.z) ** 2 > TUNE.pickupRadius ** 2 || Math.abs(vp.y - p.pos.y) > 0.5) continue;
        p.active = false;
        p.regrow = TUNE.pickupRegrow;
        this.events.emit('pickup', { racer: c.racer });
        if (this.fx) this.fx.pickupBurst(p.pos);
        this._give(c);
        break;
      }
    }

    // Roulette klar → vapnet i handen
    for (const c of this.cars) {
      const r = c.racer;
      if (r.roulette > 0) {
        r.roulette -= dt;
        if (r.roulette <= 0) this._arm(c, r.pending);
      }
    }

    this._updateBombs(dt);
    this._updateElectro(dt);
    this._updateEntities(dt);
    this._aiThink(dt);
  }

  _give(c) {
    const r = c.racer;
    const col = tableColumn(r.position, this.race.racers.length, r.isPlayer);
    const id = rollWeapon(col);
    if (r.isPlayer) { r.roulette = TUNE.rouletteTime; r.pending = id; }
    else this._arm(c, id);
  }

  _arm(c, id) {
    const r = c.racer;
    r.pending = null;
    r.roulette = 0;
    if (WEAPONS[id].onPickup) {
      // Bomben tänds direkt när man plockar den
      r.bomb = TUNE.bomb.fuse;
      r.weapon = null;
      return;
    }
    r.weapon = { id, shots: WEAPONS[id].shots };
    r.weaponHeld = 0;
    this.events.emit('armed', { racer: r, id });
  }

  // --- Avfyra -------------------------------------------------------------------
  fire(c) {
    const r = c.racer;
    if (!r.weapon || r.weaponCooldown > 0 || r.finished) return false;
    const id = r.weapon.id;
    const v = c.vehicle;
    const pos = v.currPos.clone();
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(v.currQuat);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1).applyAxisAngle(UP, v.heading());
    fwd.normalize();
    const vel = v.body.linvel();

    switch (id) {
      case 'shockwave':
        this._spawn({ type: 'shockwave', owner: c, pos: pos.clone().addScaledVector(fwd, 0.4).setY(pos.y + 0.05), vel: fwd.clone().multiplyScalar(TUNE.shockwave.speed), life: TUNE.shockwave.life });
        break;
      case 'firework':
      case 'fireworkPack': {
        const target = this._targetAhead(c, TUNE.firework.lockRange, TUNE.firework.lockCone);
        this._spawn({ type: 'firework', owner: c, target, pos: pos.clone().addScaledVector(fwd, 0.35).setY(pos.y + 0.12), vel: fwd.clone().multiplyScalar(TUNE.firework.speed).add(new THREE.Vector3(0, target ? 1 : 2.5, 0)), life: TUNE.firework.life });
        break;
      }
      case 'electro':
        r.fx.electro = TUNE.electro.time;
        break;
      case 'oil': {
        const at = pos.clone().addScaledVector(fwd, -0.45);
        at.y = this._groundY(at) + 0.01; // fläcken ligger på marken
        this._spawn({ type: 'oil', owner: c, pos: at, life: TUNE.oil.life, radius: 0.15 });
        break;
      }
      case 'balloons':
        this._spawn({ type: 'balloon', owner: c, pos: pos.clone().addScaledVector(fwd, 0.3).setY(pos.y + 0.15), vel: fwd.clone().multiplyScalar(TUNE.balloons.fwd).add(new THREE.Vector3(vel.x * 0.6, TUNE.balloons.up, vel.z * 0.6)), life: 3 });
        break;
      case 'bearing':
        this._spawnBearing(c, pos.clone().addScaledVector(fwd, -0.45).setY(pos.y + 0.12), vel);
        break;
      case 'turbo':
        r.fx.turbo = TUNE.turbo.time;
        break;
      case 'clone':
        this._spawn({ type: 'clone', owner: c, pos: pos.clone().addScaledVector(fwd, -0.5).setY(this._groundY(pos) + 0.22), life: 60, armed: 1 });
        break;
      case 'star':
        if (this.fx) this.fx.starBurst(pos);
        for (const o of this.cars) {
          if (o === c) continue;
          o.racer.fx.zap = TUNE.star.stun;
          if (this.fx) this.fx.starHit(pos, o.vehicle.currPos);
          this._hit(o, 'star');
        }
        break;
      default:
        break;
    }
    r.weapon.shots--;
    r.weaponCooldown = 0.35;
    if (r.weapon.shots <= 0) r.weapon = null;
    r.lastFired = id;
    this.events.emit('fire', { racer: r, id, pos });
    return true;
  }

  // Bilen närmast framför i loppet inom räckvidd och kon
  _targetAhead(c, range, cone) {
    const v = c.vehicle;
    const fwd = _a.set(0, 0, 1).applyQuaternion(v.currQuat);
    let best = null, bestD = range;
    for (const o of this.cars) {
      if (o === c) continue;
      const d = _b.copy(o.vehicle.currPos).sub(v.currPos);
      const dist = d.length();
      if (dist > bestD || dist < 0.3) continue;
      if (d.normalize().dot(fwd) < Math.cos(cone)) continue;
      best = o; bestD = dist;
    }
    return best;
  }

  _carsBehind(c, range) {
    const v = c.vehicle;
    const fwd = _a.set(0, 0, 1).applyQuaternion(v.currQuat);
    for (const o of this.cars) {
      if (o === c) continue;
      const d = _b.copy(o.vehicle.currPos).sub(v.currPos);
      if (d.length() < range && d.normalize().dot(fwd) < -0.6) return true;
    }
    return false;
  }

  // --- Projektiler och föremål ---------------------------------------------------
  _spawn(e) {
    e.age = 0;
    if (this.scene) e.mesh = makeEntityMesh(e);
    if (e.mesh) { e.mesh.position.copy(e.pos); this.group.add(e.mesh); }
    this.entities.push(e);
    return e;
  }

  _remove(e) {
    e.dead = true;
    if (e.mesh) this.group.remove(e.mesh);
    if (e.body) this.world.removeRigidBody(e.body);
  }

  _spawnBearing(c, pos, vel) {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinvel(vel.x * 0.4, 0, vel.z * 0.4).setLinearDamping(0.05).setCcdEnabled(true)
    );
    this.world.createCollider(
      R.ColliderDesc.ball(TUNE.bearing.radius).setDensity(0).setMass(TUNE.bearing.mass).setFriction(0.4).setRestitution(0.3).setCollisionGroups(groups(G.PROP)),
      body
    );
    this._spawn({ type: 'bearing', owner: c, pos, body, life: TUNE.bearing.life });
  }

  _updateEntities(dt) {
    for (const e of this.entities) {
      if (e.dead) continue;
      e.age += dt;
      e.life -= dt;
      if (e.life <= 0) {
        if (e.type === 'firework') this._blast(e.pos, TUNE.firework.blast, TUNE.firework.lift, e.owner, 1);
        else if (e.type === 'shockwave' && this.fx) this.fx.shockBurst(e.pos, e.pos.y - 0.12, 0.5);
        this._remove(e);
        continue;
      }

      if (e.type === 'shockwave') {
        // Rullar längs marken, studsar mot väggar, slungar upp bilar i vägen
        if (this._wallBounce(e, dt) && this.fx) this.fx.sparks(e.pos, [2.6, 5, 10], 14, 2, 0.4, { floor: e.pos.y - 0.12 });
        e.pos.addScaledVector(e.vel, dt);
        e.pos.y = this._groundY(e.pos) + 0.12;
        for (const o of this.cars) {
          if (o === e.owner && e.age < 0.3) continue;
          if (o.vehicle.currPos.distanceTo(e.pos) < TUNE.shockwave.radius && !o.racer.shockHit?.has(e)) {
            (o.racer.shockHit ||= new WeakSet()).add(e);
            this._launch(o, e.pos, TUNE.shockwave.lift, 1.2);
            if (this.fx) this.fx.shockBurst(o.vehicle.currPos, e.pos.y - 0.12);
          }
        }
      } else if (e.type === 'firework') {
        const T = TUNE.firework;
        if (e.target) {
          // Målsökning: vrid farten mot målet
          const want = _a.copy(e.target.vehicle.currPos).add(new THREE.Vector3(0, 0.08, 0)).sub(e.pos).normalize().multiplyScalar(T.speed);
          e.vel.lerp(want, Math.min(1, dt * T.turn));
        } else e.vel.y -= GRAVITY * 0.15 * dt;
        const hitWall = this._rayHit(e.pos, e.vel, e.vel.length() * dt + 0.1);
        e.pos.addScaledVector(e.vel, dt);
        let hit = hitWall || e.pos.y < this._groundY(e.pos) + 0.03;
        for (const o of this.cars) {
          if (o === e.owner && e.age < 0.25) continue;
          if (o.vehicle.currPos.distanceTo(e.pos) < 0.35) hit = true;
        }
        if (hit) { this._blast(e.pos, T.blast, T.lift, e.owner, 1); this._remove(e); }
      } else if (e.type === 'balloon') {
        e.vel.y -= GRAVITY * dt;
        const hitWall = this._rayHit(e.pos, e.vel, e.vel.length() * dt + 0.05);
        e.pos.addScaledVector(e.vel, dt);
        let hit = hitWall || e.pos.y < this._groundY(e.pos) + 0.05;
        for (const o of this.cars) if (o !== e.owner && o.vehicle.currPos.distanceTo(e.pos) < 0.35) hit = true;
        if (hit) {
          for (const o of this.cars) {
            const d = o.vehicle.currPos.distanceTo(e.pos);
            if (d < TUNE.balloons.burst) { o.racer.fx.wet = TUNE.balloons.wet; this._push(o, e.pos, 1.2); this._hit(o, 'wet', false); }
          }
          this.events.emit('splash', { pos: e.pos.clone() });
          if (this.fx) this.fx.splash(e.pos, this._groundY(e.pos));
          this._remove(e);
        }
      } else if (e.type === 'oil') {
        // Fläcken breder ut sig, hjulen som rör den tappar greppet
        e.radius = Math.min(TUNE.oil.radius, e.radius + dt * 1.5);
        for (const o of this.cars) {
          for (const wh of o.vehicle.wheels) {
            if (!wh.grounded) continue;
            if ((wh.contact.x - e.pos.x) ** 2 + (wh.contact.z - e.pos.z) ** 2 < e.radius ** 2 && Math.abs(wh.contact.y - e.pos.y) < 0.3) {
              wh.oily = TUNE.oil.slip;
              // Däcken stänker olja och drar med sig fläckar
              if (this.fx && Math.abs(o.vehicle.speed) > 1.2 && Math.random() < 0.3) {
                const lv = o.vehicle.body.linvel();
                this.fx.oilSplat(wh.contact, lv.x, lv.z, e.pos.y, Math.random() < 0.12);
              }
            }
          }
        }
      } else if (e.type === 'bearing') {
        const t = e.body.translation();
        e.pos.set(t.x, t.y, t.z);
        if (t.y < -3) e.life = 0;
        // Gnistor när kulan smäller i väggar och bilar
        const lv = e.body.linvel();
        if (e.pv) {
          const dv = Math.hypot(lv.x - e.pv.x, lv.y - e.pv.y, lv.z - e.pv.z);
          if (dv > 2.2 && this.fx) this.fx.metalHit(e.pos, Math.min(4, dv / 2), e.pos.y - TUNE.bearing.radius);
          e.pv.x = lv.x; e.pv.y = lv.y; e.pv.z = lv.z;
        } else e.pv = { x: lv.x, y: lv.y, z: lv.z };
      } else if (e.type === 'clone') {
        if (e.armed > 0) e.armed -= dt;
        for (const o of this.cars) {
          if (o === e.owner && e.armed > 0) continue;
          const vp = o.vehicle.currPos;
          if ((vp.x - e.pos.x) ** 2 + (vp.z - e.pos.z) ** 2 < TUNE.pickupRadius ** 2 && Math.abs(vp.y - e.pos.y) < 0.5) {
            this._blast(e.pos, TUNE.clone.blast, TUNE.clone.lift, null, 0.9);
            this._remove(e);
            break;
          }
        }
      }
      if (e.mesh && !e.dead) e.mesh.position.copy(e.pos);
    }
    if (this.entities.some((e) => e.dead)) this.entities = this.entities.filter((e) => !e.dead);
  }

  _updateBombs(dt) {
    for (const c of this.cars) {
      const r = c.racer;
      if (r.bombPass > 0) r.bombPass -= dt;
      if (!(r.bomb > 0)) continue;
      r.bomb -= dt;
      if (r.bomb <= 0) {
        r.bomb = 0;
        this._blast(c.vehicle.currPos.clone(), TUNE.bomb.blast, TUNE.bomb.lift, null, 1.7);
        continue;
      }
      // Blinkar (och piper) allt tätare ju närmare smällen
      r.bombBlink = (r.bombBlink || 0) + dt * (1.4 + 9 * (1 - r.bomb / TUNE.bomb.fuse));
      if (r.bombBlink >= 1) { r.bombBlink -= 1; r.bombBeeps = (r.bombBeeps || 0) + 1; }
      // Smittar vid kontakt (inte direkt tillbaka till den som just gav den)
      for (const o of this.cars) {
        if (o === c || o.racer.bomb > 0 || o.racer.bombPass > 0 || r.bombPass > 0) continue;
        if (o.vehicle.currPos.distanceTo(c.vehicle.currPos) < 0.62) {
          o.racer.bomb = r.bomb;
          r.bomb = 0;
          o.racer.bombPass = TUNE.bomb.passCooldown;
          this.events.emit('bombPass', { from: r, to: o.racer });
          break;
        }
      }
    }
  }

  _updateElectro() {
    for (const c of this.cars) {
      if (!(c.racer.fx.electro > 0)) continue;
      for (const o of this.cars) {
        if (o === c) continue;
        if (o.vehicle.currPos.distanceTo(c.vehicle.currPos) < TUNE.electro.range) {
          if (!(o.racer.fx.zap > 0)) {
            if (this.fx) this.fx.sparks(_a.copy(o.vehicle.currPos).setY(o.vehicle.currPos.y + 0.1), [2.6, 5, 10], 24, 1.8, 0.5);
            this.events.emit('zap', { pos: o.vehicle.currPos.clone() });
            this._hit(o, 'zap');
          }
          o.racer.fx.zap = TUNE.electro.stun;
        }
      }
    }
  }

  // --- Effekter på bilar -----------------------------------------------------------
  // Explosion: knuffar ut och upp, med lite snurr
  // fxSize: hur stor smällen ser ut (1 = fyrverkeri, bomben är större)
  _blast(pos, radius, lift, owner, fxSize = 1) {
    for (const o of this.cars) {
      const d = o.vehicle.currPos.distanceTo(pos);
      if (d > radius) continue;
      this._launch(o, pos, lift * (1 - 0.5 * d / radius), 1);
      this._hit(o, 'blast');
    }
    this.events.emit('explode', { pos: pos.clone(), size: Math.min(1, radius / 1.4) * Math.min(1.3, fxSize) });
    if (this.fx) this.fx.explosion(pos, this._groundY(pos), fxSize);
    void owner;
  }

  // En bil har träffats: händelse (kameraskak) och en kort vit blixt med rökpuff
  _hit(o, kind, flash = true) {
    this.events.emit('hit', { car: o, kind, pos: o.vehicle.currPos.clone() });
    if (this.fx && flash) this.fx.hitFlash(o.vehicle.currPos);
  }

  _launch(o, from, dv, spin) {
    const v = o.vehicle;
    const m = v.def.mass;
    const dir = _a.copy(v.currPos).sub(from); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    dir.normalize();
    v.body.applyImpulse({ x: dir.x * dv * 0.55 * m, y: dv * m, z: dir.z * dv * 0.55 * m }, true);
    const I = v.inertia;
    v.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * 8 * I.x * spin, y: (Math.random() - 0.5) * 6 * I.y * spin, z: (Math.random() - 0.5) * 8 * I.z * spin }, true);
  }

  _push(o, from, dv) {
    const v = o.vehicle;
    const dir = _a.copy(v.currPos).sub(from); dir.y = 0;
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    v.body.applyImpulse({ x: dir.x * dv * v.def.mass, y: 0.3 * v.def.mass, z: dir.z * dv * v.def.mass }, true);
  }

  // --- Hjälpare mot världen ---------------------------------------------------------
  _groundY(p) {
    const ray = new this.RAPIER.Ray({ x: p.x, y: p.y + 0.6, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 3, true, undefined, groups(0xffff, G.WORLD));
    return hit ? p.y + 0.6 - hit.timeOfImpact : 0;
  }

  _rayHit(p, vel, len) {
    const l = vel.length();
    if (l < 1e-4) return false;
    const ray = new this.RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: vel.x / l, y: vel.y / l, z: vel.z / l });
    return !!this.world.castRay(ray, len, true, undefined, groups(0xffff, G.WORLD));
  }

  _wallBounce(e, dt) {
    const l = Math.hypot(e.vel.x, e.vel.z);
    if (l < 1e-4) return;
    const ray = new this.RAPIER.Ray({ x: e.pos.x, y: e.pos.y + 0.05, z: e.pos.z }, { x: e.vel.x / l, y: 0, z: e.vel.z / l });
    const hit = this.world.castRayAndGetNormal(ray, l * dt + 0.15, true, undefined, groups(0xffff, G.WORLD));
    if (hit && Math.abs(hit.normal.y) < 0.6) {
      const n = _b.set(hit.normal.x, 0, hit.normal.z).normalize();
      e.vel.addScaledVector(n, -2 * e.vel.dot(n));
      return true;
    }
    return false;
  }

  // --- Datorförarnas vapenbeslut ----------------------------------------------------
  _aiThink(dt) {
    for (const c of this.cars) {
      const r = c.racer;
      if (!c.ai || !r.weapon) continue;
      r.weaponHeld += dt;
      r.aiThink = (r.aiThink || 0) - dt;
      if (r.aiThink > 0) continue;
      r.aiThink = 0.2 + Math.random() * 0.25;
      const id = r.weapon.id;
      const impatient = r.weaponHeld > 14;
      let go = false;
      if (id === 'firework' || id === 'fireworkPack') go = !!this._targetAhead(c, 18, 0.35) || impatient;
      else if (id === 'shockwave' || id === 'balloons') go = !!this._targetAhead(c, id === 'balloons' ? 9 : 12, 0.2) || impatient;
      else if (id === 'oil' || id === 'bearing' || id === 'clone') go = this._carsBehind(c, 8) || impatient;
      else if (id === 'electro') go = this.cars.some((o) => o !== c && o.vehicle.currPos.distanceTo(c.vehicle.currPos) < 2.5) || impatient;
      else if (id === 'turbo') {
        const T = this.track, i = r.trackIndex >= 0 ? r.trackIndex : 0;
        go = T.lineSpeed[(i + Math.round(8 / T.spacing)) % T.N] > 0.85 * c.vehicle.def.topSpeed || impatient;
      } else if (id === 'star') go = true;
      if (go) this.fire(c);
    }
  }

  // --- Grafik per bild -----------------------------------------------------------------
  render(dt) {
    if (!this.scene) return;
    const t = this.time, fx = this.fx;
    fx.low = this.lowFx;
    // Pickuperna: en instansmesh, studsar in när de växer tillbaka
    const pm = this.pickupMesh;
    if (pm) {
      this.pickups.forEach((p, i) => {
        let s = 0;
        if (p.active) {
          if (p.scale < 1) p.scale = Math.min(1, p.scale + dt / 1.6);
          s = Math.max(0.001, elasticOut(p.scale));
          _b.set(p.pos.x, p.pos.y + Math.sin(t * 3 + p.pos.x) * 0.025, p.pos.z);
          fx.pickupHalo(_b, t);
        } else _b.copy(p.pos);
        _q.setFromAxisAngle(UP, t * 2.6);
        _m.compose(_b, _q, _s.setScalar(s || 1e-4));
        pm.setMatrixAt(i, _m);
      });
      pm.instanceMatrix.needsUpdate = true;
    }
    for (const e of this.entities) {
      if (e.dead) continue;
      if (e.type === 'bearing') {
        const r = e.body.rotation();
        if (e.mesh) e.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        fx.bearing(e.pos, e.body.linvel());
      } else if (e.type === 'firework') {
        if (e.mesh) e.mesh.quaternion.setFromUnitVectors(UP, _a.copy(e.vel).normalize());
        fx.rocket(e, dt);
      } else if (e.type === 'clone') {
        if (e.mesh) e.mesh.rotation.y = t * 2.6;
        fx.pickupHalo(e.pos, t);
      } else if (e.type === 'oil') {
        if (e.mesh) e.mesh.scale.setScalar(e.radius);
      } else if (e.type === 'shockwave') {
        if (e.mesh) e.mesh.scale.setScalar(1 + Math.sin(t * 40) * 0.15);
        fx.shockBall(e, dt, t);
      } else if (e.type === 'balloon' && e.mesh) {
        // Vattnet skvalpar: ballongen töjer sig i farten och darrar
        const w = Math.sin(t * 22 + e.age * 3) * 0.14;
        e.mesh.quaternion.setFromUnitVectors(UP, _a.copy(e.vel).normalize());
        e.mesh.scale.set(1 + w, 1.15 - w, 1 + w);
      }
    }
    // Vapen som syns på bilarna: elfält, ström, turbo, bomb
    this.cars.forEach((c, i) => {
      const f = c.racer.fx, v = c.vehicle;
      const pos = c.model ? c.model.root.position : v.currPos;
      const quat = c.model ? c.model.root.quaternion : v.currQuat;
      if (f.electro > 0) {
        fx.electroAura(pos, quat, t, dt, i + 1);
        for (const o of this.cars) {
          if (o === c || o.vehicle.currPos.distanceTo(v.currPos) > TUNE.electro.range * 1.4) continue;
          fx.electroBolt(pos, o.model ? o.model.root.position : o.vehicle.currPos, t, i * 16 + this.cars.indexOf(o));
        }
      }
      if (f.zap > 0) fx.zapped(pos, t, i + 1);
      if (f.turbo > 0) fx.turbo(pos, quat, v.body.linvel(), dt);
      const bomb = c.racer.bomb > 0;
      if (bomb && !c.bombMark) c.bombMark = makeBombMark(this.group);
      if (c.bombMark) {
        c.bombMark.visible = bomb;
        if (bomb) {
          const on = (c.racer.bombBlink || 0) < 0.4;
          c.bombMark.position.copy(pos).add(_a.set(0, 0.2, 0));
          c.bombMark.rotation.y = t * 1.5;
          c.bombMark.userData.light.visible = on;
          const tip = _a.set(0.02, 0.105, 0).applyQuaternion(c.bombMark.quaternion).add(c.bombMark.position);
          fx.bombFuse(tip, _b.copy(c.bombMark.position).add(_c.set(0, 0.035, 0.045).applyQuaternion(c.bombMark.quaternion)), on, dt);
        }
      }
    });
    fx.update(dt);
  }
}

// --- Hjälpfunktioner ----------------------------------------------------------------

function initRacer(r) {
  r.weapon = null;
  r.roulette = 0;
  r.pending = null;
  r.bomb = 0;
  r.bombPass = 0;
  r.weaponCooldown = 0;
  r.weaponHeld = 0;
  r.fx = { zap: 0, turbo: 0, wet: 0, electro: 0 };
}

const elasticOut = (x) => (x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin(((x * 10 - 0.75) * 2 * Math.PI) / 3) + 1);

let _boltGeo = null;
function boltGeometry() {
  if (_boltGeo) return _boltGeo;
  const s = new THREE.Shape();
  const P = [[0.02, 0.18], [-0.08, -0.01], [-0.005, -0.01], [-0.04, -0.18], [0.09, 0.03], [0.015, 0.03]];
  P.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  _boltGeo = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1 });
  _boltGeo.translate(0, 0, -0.0175);
  _boltGeo.scale(1.2, 1.2, 1.2);
  // Gul topp, röd fot
  const pos = _boltGeo.attributes.position, col = [];
  const top = new THREE.Color(0xffe24a), bot = new THREE.Color(0xff2a12), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { const u = (pos.getY(i) + 0.22) / 0.44; c.copy(bot).lerp(top, Math.max(0, Math.min(1, u))); col.push(c.r, c.g, c.b); }
  _boltGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return _boltGeo;
}

const MATS = {};
function mat(key, make) { return (MATS[key] ||= make()); }
// Delade geometrier per projektiltyp (en ny per skott läckte GPU-minne)
const GEOS = {};
function geo(key, make) { return (GEOS[key] ||= make()); }

// Blixtarna lyser lite själva (glorian runt dem ritas av effekterna)
function pickupMaterial() {
  return mat('pickup', () => new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xff5a10, emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.1 }));
}

const hdr = (r, g, b) => new THREE.Color(r, g, b);

function makeEntityMesh(e) {
  switch (e.type) {
    case 'shockwave': {
      // Glödande kärna i ett pulserande skal (glorian och blixtarna ritas av effekterna)
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo('shockCore', () => new THREE.SphereGeometry(0.06, 14, 10)), mat('shockCore', () => new THREE.MeshBasicMaterial({ color: hdr(2, 4.5, 10) }))));
      g.add(new THREE.Mesh(geo('shock', () => new THREE.SphereGeometry(0.13, 18, 12)), mat('shock', () => new THREE.MeshBasicMaterial({ color: hdr(0.3, 0.9, 3.5), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }))));
      return g;
    }
    case 'firework': {
      const g = new THREE.Group();
      const body = new THREE.Mesh(geo('rocket', () => new THREE.CylinderGeometry(0.016, 0.016, 0.11, 10)), mat('rocket', () => new THREE.MeshStandardMaterial({ color: 0xd8241c, emissive: 0x501010, roughness: 0.4 })));
      const tip = new THREE.Mesh(geo('rocketTip', () => new THREE.ConeGeometry(0.019, 0.04, 10)), mat('rocketTip', () => new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x806010, roughness: 0.4 })));
      tip.position.y = 0.075;
      const fins = new THREE.Mesh(geo('rocketFins', () => {
        const f = new THREE.BoxGeometry(0.05, 0.03, 0.004);
        const f2 = f.clone().rotateY(Math.PI / 2);
        const m = new THREE.BufferGeometry();
        const pos = [...f.attributes.position.array, ...f2.attributes.position.array];
        const nor = [...f.attributes.normal.array, ...f2.attributes.normal.array];
        const idx = [...f.index.array, ...f2.index.array.map((x) => x + f.attributes.position.count)];
        m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        m.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        m.setIndex(idx);
        m.translate(0, -0.045, 0);
        return m;
      }), tip.material);
      g.add(body, tip, fins);
      return g;
    }
    case 'oil': {
      const m = new THREE.Mesh(oilGeometry(Math.floor(Math.random() * 3)), oilMaterial());
      m.rotation.y = Math.random() * Math.PI * 2;
      m.position.y += 0.006;
      m.receiveShadow = true;
      const g = new THREE.Group();
      g.add(m);
      return g;
    }
    case 'balloon':
      return new THREE.Mesh(geo('balloon', () => new THREE.SphereGeometry(0.06, 16, 12)), mat('balloon', () => new THREE.MeshPhysicalMaterial({ color: 0x3aa8ff, emissive: 0x0a2a50, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.62, depthWrite: false })));
    case 'bearing':
      return new THREE.Mesh(geo('bearing', () => new THREE.SphereGeometry(TUNE.bearing.radius, 24, 18)), mat('bearing', () => new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.05, metalness: 1, envMapIntensity: 1.8 })));
    case 'clone':
      return new THREE.Mesh(boltGeometry(), pickupMaterial());
    default:
      return null;
  }
}

// Bomben på bilen: svart kula, stubintråd och en röd lampa som blinkar.
// Byggs en gång per bil, första gången den får bomben.
function makeBombMark(group) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(geo('bomb', () => new THREE.SphereGeometry(0.06, 16, 12)), mat('bomb', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.3, metalness: 0.3 })));
  const f = new THREE.Mesh(geo('fuse', () => new THREE.CylinderGeometry(0.005, 0.005, 0.05, 6).rotateZ(-0.35).translate(0.01, 0.08, 0)), mat('fuse', () => new THREE.MeshStandardMaterial({ color: 0xc8a46a })));
  const l = new THREE.Mesh(geo('bombLight', () => new THREE.SphereGeometry(0.014, 10, 8)), mat('bombLight', () => new THREE.MeshBasicMaterial({ color: hdr(9, 0.4, 0.2) })));
  l.position.set(0, 0.035, 0.045);
  g.add(b, f, l);
  g.userData.light = l;
  g.visible = false;
  group.add(g);
  return g;
}
