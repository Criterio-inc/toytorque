import * as THREE from 'three';
import { G, GRAVITY, groups, WHEEL_RAY_GROUPS } from './../core/physics.js';

// ---------------------------------------------------------------------------
// Vehicle: ett RC-fordon med fyra strålhjul på en enda stel kropp.
//
// Varje hjul skjuter en stråle nedåt. Träff ger fjäderkraft (fjäder + dämpare
// + bottenstopp) och en däckkraft inom en friktionscirkel: sidogrepp från
// slipvinkeln, drivning och broms längs hjulets riktning. Styrningen är riktiga
// framhjulsvinklar, så bilen girar av däckkrafterna och kan sladda.
//
// Klassen rör aldrig tangentbordet. Den tar en controls-struct:
//   { throttle: -1..1, steer: -1..1 (vänster +) }
// så att spelare och AI kör samma kod.
// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

// Återanvända temporära objekt (inga allokeringar i fysiksteget).
const _placeEuler = new THREE.Euler();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _side = new THREE.Vector3();
const _lv = new THREE.Vector3();
const _av = new THREE.Vector3();
const _com = new THREE.Vector3();
const _attach = new THREE.Vector3();
const _contact = new THREE.Vector3();
const _n = new THREE.Vector3();
const _wf = new THREE.Vector3();
const _wl = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _r = new THREE.Vector3();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _tq = new THREE.Vector3();

let nextUid = 1;

export class Vehicle {
  constructor(world, RAPIER, def, pose) {
    this.world = world;
    this.RAPIER = RAPIER;
    this.def = def;
    this.id = def.id;
    this.uid = nextUid++; // unikt per bil, även om två bilar har samma modell

    const { mass, body: b, wheel: w, susp } = def;
    // Fjäder per hjul så att statisk ihoptryckning blir "sag".
    this.k = (mass / 4) * GRAVITY / susp.sag;
    this.c = 2 * susp.zeta * Math.sqrt(this.k * (mass / 4));
    // Drivkraft: exponentiell närmning mot toppfart, ~95 % efter accTime.
    this.a0 = def.topSpeed / (def.accTime / 3.0);

    // Kollisionslådan täcker hjulen i sidled så de inte klipper in i väggar.
    const halfW = Math.max(b.halfW, w.x + w.width * 0.5);
    this.halfExtents = { x: halfW, y: b.halfH, z: b.halfL };

    // Tröghet som en låda med bilens yttermått, lite förstärkt för lugnare gir.
    const W = halfW * 2, H = b.halfH * 2 + w.radius, L = b.halfL * 2;
    this.inertia = {
      x: (mass / 12) * (H * H + L * L) * 1.3,
      y: (mass / 12) * (W * W + L * L) * 1.3,
      z: (mass / 12) * (W * W + H * H) * 1.3,
    };

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setLinearDamping(0.005)
      .setAngularDamping(0.25)
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(bodyDesc);

    const colDesc = RAPIER.ColliderDesc.cuboid(halfW, b.halfH, b.halfL)
      .setMassProperties(mass, { x: 0, y: def.comY, z: 0 }, this.inertia, { x: 0, y: 0, z: 0, w: 1 })
      // Låg friktion mot väggar och andra bilar: en snedträff glider av i
      // stället för att haka i och vrida runt bilen.
      .setFriction(def.bodyFriction)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(def.restitution)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(groups(G.CAR));
    this.collider = world.createCollider(colDesc, this.body);

    // Hjulen: vänster/höger fram, vänster/höger bak. +x är bilens vänster.
    this.wheels = [
      { x: w.x, z: w.zF, front: true },
      { x: -w.x, z: w.zF, front: true },
      { x: w.x, z: w.zR, front: false },
      { x: -w.x, z: w.zR, front: false },
    ].map((o) => ({
      ...o,
      driven: def.drive === '4WD' || (def.drive === 'FWD' ? o.front : !o.front),
      grounded: false,
      comp: 0,
      suspLen: susp.rest,
      load: 0,
      spin: 0,
      slide: 0, // >1 = däcket glider (friktionscirkeln överskriden)
      skid: false,
      contact: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      surface: null,
    }));
    this.nDriven = this.wheels.filter((wh) => wh.driven).length;

    // Tillstånd
    this.steer = 0; // aktuell styrvinkel (rad)
    this.motor = 0; // "motorspänning" -1..1 som rampar mot gasen
    this.speed = 0; // m/s längs bilens framåtriktning
    this.grounded = 0; // antal hjul i marken
    this.upsideTime = 0;
    this.airTime = 0;
    this.landTime = 0;
    this.autoFlip = true;
    // Spelarens körhjälp 0..1 (inställningen Av/Normal/Mycket). Bilens egen
    // def.assist gäller alltid; det största av de två används.
    this.helper = 0;
    this.wallTime = 0; // tid kvar av dämpningen efter en väggträff
    this.lastYaw = 0; // giret när förra steget lämnade bilen
    // Modifierare för kommande pickups (turbo, olja, elchock).
    this.mods = { topMul: 1, gripMul: 1, powerMul: 1 };

    // För mjuk rendering mellan fysiksteg.
    this.prevPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.currPos = new THREE.Vector3();
    this.currQuat = new THREE.Quaternion();

    this.place(pose);
  }

  // Ställ bilen på en position med en riktning (heading = rotation kring y).
  // pitch (+ = nosen upp) och roll (+ = vänster sida upp) lägger bilen
  // parallellt med en lutande eller doserad väg.
  place({ x, y, z, heading = 0, pitch = 0, roll = 0 }) {
    _q.setFromEuler(_placeEuler.set(-pitch, heading, roll, 'YXZ'));
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.motor = 0;
    this.upsideTime = 0;
    this.airTime = 0;
    this.landTime = 0;
    this.wallTime = 0;
    this.lastYaw = 0;
    for (const wh of this.wheels) { wh.grounded = false; wh.comp = 0; }
    this.snapshot();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  // Vänd bilen rätt på samma plats.
  flip() {
    const t = this.body.translation();
    this.place({ x: t.x, y: t.y + 0.25, z: t.z, heading: this.heading() });
  }

  heading() {
    this._readFrame();
    // Om nosen pekar rakt upp/ner: använd taket som riktning i stället.
    const fx = Math.abs(_fwd.y) > 0.95 ? -_up.x * Math.sign(_fwd.y) : _fwd.x;
    const fz = Math.abs(_fwd.y) > 0.95 ? -_up.z * Math.sign(_fwd.y) : _fwd.z;
    return Math.atan2(fx, fz);
  }

  _readFrame() {
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const t = this.body.translation();
    _pos.set(t.x, t.y, t.z);
    _fwd.set(0, 0, 1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _side.set(1, 0, 0).applyQuaternion(_q); // bilens vänster
  }

  _pointVel(p, out) {
    // v = v_com + ω × (p − com)
    _r.subVectors(p, _com);
    return out.crossVectors(_av, _r).add(_lv);
  }

  // Ett fysiksteg. Anropas FÖRE world.step().
  update(dt, controls) {
    const def = this.def;
    const body = this.body;
    body.resetForces(true);
    body.resetTorques(true);

    this._readFrame();
    const lv = body.linvel();
    const av = body.angvel();
    _lv.set(lv.x, lv.y, lv.z);
    _av.set(av.x, av.y, av.z);
    _com.set(0, def.comY, 0).applyQuaternion(_q).add(_pos);

    const fwdSpeed = _lv.dot(_fwd);
    this.speed = fwdSpeed;
    const top = def.topSpeed * this.mods.topMul;
    const absV = Math.abs(fwdSpeed);

    // --- Styrning: rampa mot mål, mindre utslag i hög fart --------------------
    // Fartkänslig styrning: i fart begränsas rattutslaget till ungefär det
    // greppet klarar (radie v²/μg), så fullt utslag på tangentbordet ger en
    // kraftig men kontrollerad sväng i stället för en snurr.
    const assist = Math.max(def.assist, this.helper);
    const wheelbase = def.wheel.zF - def.wheel.zR;
    // Med körhjälp styr bilen aldrig långt förbi greppgränsen
    const steerAssist = def.steerAssist + (Math.min(def.steerAssist, 1.1) - def.steerAssist) * assist;
    const gripSteer = steerAssist * (wheelbase * def.mu * GRAVITY) / Math.max(absV * absV, 1e-3);
    const maxSteer = Math.min(def.steerMax * (1 - def.steerMod * Math.min(1, absV / top)), gripSteer);
    const target = (controls.steer || 0) * maxSteer;
    const back = Math.sign(target) !== Math.sign(this.steer) || target === 0;
    const rate = def.steerRate * def.steerMax * (back ? 1.8 : 1) * dt;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));

    // --- Gas/broms/back -------------------------------------------------------
    const thr = controls.throttle || 0;
    let wantMotor = 0;
    let brake = 0;
    if (thr > 0) wantMotor = thr;
    else if (thr < 0) {
      if (fwdSpeed > 0.4) brake = -thr; // rullar framåt: bromsa
      else wantMotor = thr; // stilla eller backar: backa
    }
    // Teckenbyte nollar motorn först.
    if (wantMotor * this.motor < 0) this.motor = 0;
    const mr = def.engineRate * dt;
    this.motor += Math.max(-mr, Math.min(mr, wantMotor - this.motor));

    let engineF = 0;
    if (this.motor > 0) {
      // Kurvan siktar lite över toppfarten så att friktionsförluster inte
      // håller bilen under den; över toppfarten ger motorn inget.
      const f = Math.max(0, fwdSpeed) / top;
      engineF = f >= 1 ? 0 : def.mass * this.a0 * this.motor * Math.max(0, 1.06 - f);
    } else if (this.motor < 0) {
      const vr = top * def.reverseFrac;
      engineF = def.mass * this.a0 * 0.7 * this.motor * Math.max(0, 1 - Math.max(0, -fwdSpeed) / vr);
    }
    engineF *= this.mods.powerMul;
    const perDriven = engineF / this.nDriven;

    // --- Hjul -----------------------------------------------------------------
    const { radius: wr, attachY } = def.wheel;
    const { rest, travel } = def.susp;
    const maxToi = rest + wr;
    const quarterM = def.mass / 4;
    const staticLoad = quarterM * GRAVITY;
    const ray = this._ray || (this._ray = new this.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
    ray.dir = { x: -_up.x, y: -_up.y, z: -_up.z };

    let grounded = 0;
    for (const wh of this.wheels) {
      _attach.set(wh.x, attachY, wh.z).applyQuaternion(_q).add(_pos);
      ray.origin = { x: _attach.x, y: _attach.y, z: _attach.z };
      const hit = this.world.castRayAndGetNormal(ray, maxToi, true, undefined, WHEEL_RAY_GROUPS, undefined, body);

      if (!hit) {
        wh.grounded = false;
        wh.comp = 0;
        wh.suspLen = rest;
        wh.load = 0;
        wh.slide = 0;
        wh.skid = false;
        // Drivna hjul varvar upp i luften.
        const target = wh.driven ? this.motor * top / wr : wh.spinVel || 0;
        wh.spinVel = (wh.spinVel || 0) + (target - (wh.spinVel || 0)) * Math.min(1, dt * 3);
        wh.spin += wh.spinVel * dt;
        continue;
      }
      grounded++;
      wh.grounded = true;
      const d = hit.timeOfImpact;
      wh.suspLen = Math.max(0, d - wr);
      const comp = rest - wh.suspLen;
      wh.comp = comp;
      // Ihoptryckningshastighet ur fästpunktens fart mot marken (ger dämpning
      // redan första steget efter en landning).
      const compVel = -this._pointVel(_attach, _pv).dot(_up);

      // Fjäder + dämpare (hårdare på returen så landningar inte studsar upp
      // högre än de kom) + progressivt bottenstopp med egen dämpning.
      let Fs = this.k * comp + this.c * compVel * (compVel < 0 ? 1.6 : 1);
      if (comp > travel) {
        const over = comp - travel;
        Fs += this.k * 8 * over + (compVel > 0 ? this.c * 5 * compVel : 0);
      }
      if (Fs < 0) Fs = 0;
      _f.copy(_up).multiplyScalar(Fs);
      body.addForceAtPoint(_f, _attach, true);

      // Last för däcket (begränsad så landningar inte ger orimligt grepp).
      const load = Math.min(Fs, staticLoad * 3);
      wh.load = load;

      _contact.copy(_attach).addScaledVector(_up, -d);
      wh.contact.copy(_contact);
      _n.set(hit.normal.x, hit.normal.y, hit.normal.z);
      wh.normal.copy(_n);
      const surf = hit.collider && this._surfaceOf(hit.collider);
      wh.surface = surf;

      // Hjulets riktning i markplanet
      _wf.copy(_fwd);
      if (wh.front) _wf.applyAxisAngle(_up, this.steer);
      _wf.addScaledVector(_n, -_wf.dot(_n)).normalize();
      _wl.crossVectors(_n, _wf); // vänster i markplanet

      this._pointVel(_contact, _pv);
      const vx = _pv.dot(_wf);
      const vy = _pv.dot(_wl);

      // Sidogrepp ur slipvinkeln (mjukad vid låg fart för stabilitet).
      const slip = Math.atan2(vy, Math.abs(vx) + 1.5);
      let Fy = -def.cornering * (wh.front ? 1 : def.rearGrip) * load * slip;

      // Friktionscirkelns radie (bakdäcken kan ha eget grepp: <1 = sladdglad)
      const mu = def.mu * (wh.front ? 1 : def.rearMu) * (surf ? surf.grip : 1) * this.mods.gripMul * (wh.oily > 0 ? 0.25 : 1);
      const Fmax = mu * load;

      // Längsled: drivning, broms, rullmotstånd
      let Fx = 0;
      if (wh.driven) {
        Fx += perDriven;
        // Antispinn (körhjälp): drivkraften får bara ta det grepp som blir
        // över när sidogreppet fått sitt, så hjulen inte spinner loss.
        if (assist > 0 && Fx !== 0) {
          const room = Math.sqrt(Math.max(0, Fmax * Fmax - Fy * Fy)) * 0.95;
          const capped = Math.sign(Fx) * Math.min(Math.abs(Fx), room);
          Fx += (capped - Fx) * assist;
        }
      }
      const stopF = Math.abs(vx) * quarterM / dt * 0.5; // mer än så vänder riktningen
      if (brake > 0) Fx -= Math.sign(vx) * Math.min(def.brakeMu * def.mu * load * brake, stopF);
      else if (this.motor === 0) Fx -= Math.sign(vx) * Math.min(def.rollResist * quarterM, stopF);

      // Friktionscirkeln
      const total = Math.hypot(Fx, Fy);
      wh.slide = Fmax > 0 ? total / Fmax : 0;
      if (total > Fmax && total > 0) {
        const kin = wh.slide > 1.08 ? 0.9 : 1; // glidande däck tappar lite extra
        const s = (Fmax * kin) / total;
        Fx *= s;
        Fy *= s;
      }
      wh.skid = wh.slide > 1.0 && (Math.abs(vy) > 0.6 || (wh.driven && Math.abs(perDriven) > Fmax && absV < top * 0.5));

      // Angreppspunkt: mellan marken och masscentrums höjd (mindre krängning).
      const h = _r.subVectors(_com, _contact).dot(_up);
      _p.copy(_contact).addScaledVector(_up, h * def.rollCenter);
      _f.copy(_wf).multiplyScalar(Fx).addScaledVector(_wl, Fy);
      body.addForceAtPoint(_f, _p, true);

      // Hjulrotation för grafiken
      wh.spinVel = vx / wr;
      if (wh.driven && wh.slide > 1 && Math.abs(perDriven) > 0) wh.spinVel += this.motor * 25;
      wh.spin += wh.spinVel * dt;
      if (wh.oily > 0) wh.oily -= dt;
    }
    // Landning efter ett hopp: dämpa tippning och roll (inte giret) så att en
    // landning på en axel inte slår runt bilen.
    if (grounded >= 1 && this.airTime > 0.15) this.landTime = def.landTime;
    if (this.landTime > 0 && grounded >= 1) {
      this.landTime -= dt;
      const yaw = _av.dot(_up);
      const keep = Math.exp(-dt * def.landDamp);
      body.setAngvel({
        x: _up.x * yaw + (_av.x - _up.x * yaw) * keep,
        y: _up.y * yaw + (_av.y - _up.y * yaw) * keep,
        z: _up.z * yaw + (_av.z - _up.z * yaw) * keep,
      }, true);
    }
    this.airTime = grounded === 0 ? this.airTime + dt : 0;
    this.grounded = grounded;

    // --- Antisladd (körhjälp): håll giret inom vad greppet klarar ----------
    // Största gir i en stadig kurva är ungefär μg/v. Gir över det (en snurr på
    // väg) och glidvinkel (bakvagnen som går ut) bromsas mjukt bort.
    if (assist > 0 && grounded >= 3 && absV > 1.5) {
      const yaw = _av.dot(_up);
      const latV = _lv.dot(_side);
      const beta = Math.atan2(latV, Math.abs(fwdSpeed)); // + = glider åt vänster
      // Gir som rattutslaget ber om (cykelmodellen), med lite marginal
      const intent = Math.abs(fwdSpeed * Math.tan(this.steer) / wheelbase);
      const yawMax = Math.min((def.mu * GRAVITY / absV) * 1.05 + 0.3, intent * 1.3 + 0.5);
      let excess = yaw - Math.max(-yawMax, Math.min(yawMax, yaw));
      // Bakvagnen glider ut: gir som ökar glidvinkeln motverkas också
      const slideOut = Math.max(0, Math.abs(beta) - 0.06);
      if (slideOut > 0 && fwdSpeed > 0 && Math.sign(yaw) === -Math.sign(beta)) excess += Math.sign(yaw) * slideOut * 2;
      if (excess !== 0) {
        const dYaw = -excess * Math.min(1, dt * 14 * assist);
        _av.addScaledVector(_up, dYaw);
        body.setAngvel({ x: _av.x, y: _av.y, z: _av.z }, true);
      }
      // Glidvinkeln dämpas också direkt: bilen "fångar" sig själv
      if (Math.abs(beta) > 0.08) {
        const cut = latV * (1 - Math.exp(-dt * 3 * assist)) * Math.min(1, (Math.abs(beta) - 0.08) * 6);
        _lv.addScaledVector(_side, -cut);
        body.setLinvel({ x: _lv.x, y: _lv.y, z: _lv.z }, true);
      }
    }

    // --- Väggträff: glid av, snurra inte -----------------------------------------
    // En sned träff mot en vägg ger på ett enda fysiksteg en stor girimpuls
    // som kan vända bilen. Det mesta av det plötsliga girtillskottet tas bort
    // (vanlig styrning ändrar giret mycket långsammare), och tippning och roll
    // dämpas en stund som vid en landning så bilen inte rullar över väggen.
    // Bara med hjul i marken, så hopp och landningar påverkas inte.
    const touching = this._touchingWall();
    if (touching) this.wallTime = 0.3;
    if (this.wallTime > 0) {
      this.wallTime -= dt;
      if (grounded >= 1 && _up.y > 0.3) {
        const yaw = _av.dot(_up);
        const keep = Math.exp(-dt * def.landDamp);
        _av.set(_up.x * yaw + (_av.x - _up.x * yaw) * keep, _up.y * yaw + (_av.y - _up.y * yaw) * keep, _up.z * yaw + (_av.z - _up.z * yaw) * keep);
        const jump = yaw - this.lastYaw;
        if (touching && Math.abs(jump) > 0.8) _av.addScaledVector(_up, -jump * (0.75 + 0.2 * assist));
        // Med körhjälp: gir långt utöver det ratten ber om (bilen har börjat snurra efter
        // smällen) bromsas mot ratten, men aldrig under det ratten ber om
        if (assist > 0 && grounded >= 2 && _lv.length() > 3) {
          const y2 = _av.dot(_up);
          const intent = fwdSpeed * Math.tan(this.steer) / wheelbase;
          const win = 0.6 - 0.4 * assist;
          const lim = Math.max(intent - win, Math.min(intent + win, y2));
          _av.addScaledVector(_up, (lim - y2) * (1 - Math.exp(-dt * (15 + 25 * assist))));
        }
        body.setAngvel({ x: _av.x, y: _av.y, z: _av.z }, true);
      }
    }

    // --- Krängningshämmare per axel ------------------------------------------
    for (let a = 0; a < 4; a += 2) {
      const L = this.wheels[a], R = this.wheels[a + 1];
      if (!L.grounded || !R.grounded) continue;
      const F = def.antiRoll * (L.comp - R.comp);
      _attach.set(L.x, attachY, L.z).applyQuaternion(_q).add(_pos);
      body.addForceAtPoint(_f.copy(_up).multiplyScalar(F), _attach, true);
      _attach.set(R.x, attachY, R.z).applyQuaternion(_q).add(_pos);
      body.addForceAtPoint(_f.copy(_up).multiplyScalar(-F), _attach, true);
    }

    // --- Luftkontroll: gas tippar nosen uppåt, styrning vrider ----------------
    if (grounded === 0) {
      const I = this.inertia;
      // Körhjälpen tar bort det mesta av gasens tippning (nybörjare håller
      // gasen i botten genom hoppen) och rätar mjukt upp bilen i luften.
      const pitchK = 1 - 0.8 * assist;
      _tq.copy(_side).multiplyScalar(-(controls.throttle || 0) * def.airControl * pitchK * I.x);
      _tq.addScaledVector(_up, (controls.steer || 0) * def.airControl * I.y);
      if (assist > 0 && _up.y > 0) {
        // Moment kring axeln upp × lodrätt, plus dämpning av tipp/roll
        _r.set(-_up.z, 0, _up.x); // _up × (0,1,0)
        const yaw = _av.dot(_up);
        _tq.addScaledVector(_r, 25 * assist * I.x);
        _tq.x -= (_av.x - _up.x * yaw) * 4 * assist * I.x;
        _tq.y -= (_av.y - _up.y * yaw) * 4 * assist * I.x;
        _tq.z -= (_av.z - _up.z * yaw) * 4 * assist * I.x;
      }
      body.addTorque(_tq, true);
    }

    // --- Upp och ner för länge: vänd automatiskt ------------------------------
    if (_up.y < 0.3 && _lv.lengthSq() < 0.25) this.upsideTime += dt;
    else this.upsideTime = 0;
    if (this.autoFlip && this.upsideTime > def.flipDelay) this.flip();
    const avEnd = body.angvel();
    this.lastYaw = avEnd.x * _up.x + avEnd.y * _up.y + avEnd.z * _up.z;
  }

  // Rör karossen något fast (vägg, kant) från sidan? Kontakterna kommer från
  // förra fysiksteget.
  _touchingWall() {
    let hit = false;
    this.world.contactPairsWith(this.collider, (other) => {
      if (hit) return;
      const pb = other.parent();
      if (!pb || !pb.isFixed()) return;
      this.world.contactPair(this.collider, other, (m) => {
        if (!hit && m.numContacts() > 0 && Math.abs(m.normal().y) < 0.6) hit = true;
      });
    });
    return hit;
  }

  // Ytor kan ha eget grepp via collider-userData (sätts av banbyggaren).
  _surfaceOf(collider) {
    const map = this.world.__surfaces;
    return map ? map.get(collider.handle) || null : null;
  }

  // Spara pose efter world.step() för interpolering.
  snapshot() {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
  }

  // Interpolerad pose för rendering.
  pose(alpha, outPos, outQuat) {
    outPos.lerpVectors(this.prevPos, this.currPos, alpha);
    outQuat.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }

  get position() { return this.body.translation(); }
  get mph() { return Math.abs(this.speed) / 0.44704; }
  get upY() { this._readFrame(); return _up.y; }
}
