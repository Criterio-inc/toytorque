import * as THREE from 'three';
import { MU_REF } from '../track/track.js';
import { aiGrip } from '../vehicle/carDefs.js';

// ---------------------------------------------------------------------------
// AI-förare: följer banans ideallinje (pure pursuit) och dess fartprofil,
// väjer för bilar framför och kör om på den sida där det finns plats.
// Ger samma controls-struct som tangentbordet.
//
//   skill    0..1   andel av ideallinjens fart (0.9 = försiktig, 1 = full)
//   lane     m      personlig förskjutning från ideallinjen (variation i fältet)
//   catchup  -1..1  sätts utifrån varje steg: + = långt efter, − = långt före
// ---------------------------------------------------------------------------

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

function steerCap(d, v) {
  if (!(d.steerAssist > 1.5) || v < 2) return 1;
  const g = ((d.wheel.zF - d.wheel.zR) * d.mu * 9.81) / (v * v);
  const now = Math.min(d.steerMax * (1 - d.steerMod * Math.min(1, v / d.topSpeed)), d.steerAssist * g);
  return Math.min(1, (1.5 * g) / now);
}

export class AiDriver {
  constructor(track, { lookahead = 1.6, skill = 0.92, lane = 0, useLine = true } = {}) {
    this.track = track;
    this.lookahead = lookahead;
    this.skill = skill;
    this.lane = lane;
    this.useLine = useLine;
    this.index = -1;
    this.stuckTime = 0;
    this.reverseTime = 0;
    this.avoid = 0; // aktuell sidoförskjutning för att väja (m)
    this.catchup = 0;
    this.sc = null; // aktiv genväg
    this.scIndex = -1;
    this.scDecided = new Set();
  }

  controls(vehicle, dt = 1 / 120, others = null) {
    const T = this.track;
    const N = T.N;
    const p = vehicle.position;
    let near = T.nearest(p.x, p.z, this.index, 40, p.y);
    this.index = near.index;
    const speed = Math.max(0, vehicle.speed);
    let limit = Math.max(0, T.roadHalf - 0.35);

    // Genvägar: bestäm en gång per passage om vi tar den, följ den sedan
    // till påfarten och fortsätt därifrån på huvudbanan.
    let P = T; // vägen vi följer just nu
    if (!this.sc) {
      for (const sc of T.shortcuts || []) {
        const before = (sc.A - near.index + N) % N;
        if (before > Math.round(14 / T.spacing)) { this.scDecided.delete(sc); continue; }
        if (this.scDecided.has(sc)) continue;
        this.scDecided.add(sc);
        if (Math.random() < sc.chance) { this.sc = sc; this.scIndex = 0; }
      }
    }
    if (this.sc) {
      const path = this.sc.path;
      const pn = path.nearest(p.x, p.z, this.scIndex, 30, p.y);
      // Inte framme vid avfarten än: följ huvudbanan mot den
      const atA = (this.sc.A - near.index + N) % N;
      if (this.scIndex <= 0 && atA > 2 && atA < N / 2) {
        P = T;
      } else if (pn.index >= path.N - 1 - Math.round(2 / T.spacing)) {
        this.index = this.sc.B;
        this.sc = null;
        near = T.nearest(p.x, p.z, this.index, 40, p.y);
      } else {
        this.scIndex = Math.max(this.scIndex, pn.index);
        P = path;
        near = pn;
        limit = Math.max(0, path.roadHalf - 0.35);
      }
    }

    // Väj för bilar framför: välj sida bort från dem, sakta in om det är fullt
    let followSpeed = Infinity;
    let wantAvoid = 0;
    if (others) {
      const myLat = near.lateral;
      const t = P.tangents[near.index], n = P.normals[near.index];
      for (const o of others) {
        if (o === vehicle) continue;
        const op = o.position;
        const dx = op.x - p.x, dz = op.z - p.z;
        const along = dx * t.x + dz * t.z;
        if (along < 0.2 || along > 3.5 + speed * 0.25 || Math.abs(op.y - p.y) > 0.5) continue;
        const lat = dx * n.x + dz * n.z; // + = vänster om oss
        if (Math.abs(lat) > 0.75) continue;
        const otherLat = myLat + lat;
        // Gå åt det håll där det finns mest väg
        const leftRoom = limit - otherLat, rightRoom = otherLat + limit;
        const side = leftRoom > rightRoom ? 1 : -1;
        const target = otherLat + side * 0.7 - (myLat - this.avoid);
        if (Math.abs(target) > Math.abs(wantAvoid)) wantAvoid = target;
        const room = side > 0 ? leftRoom : rightRoom;
        if (room < 0.55 && along < 2) followSpeed = Math.min(followSpeed, Math.max(0, o.speed) * 0.95);
      }
    }
    this.avoid += (wantAvoid - this.avoid) * Math.min(1, dt * (wantAvoid ? 4 : 1.2));

    // Siktpunkt längre fram ju fortare vi kör
    const PN = P.N;
    const step = (i) => (P === T ? (i + PN) % PN : Math.min(PN - 2, i));
    const ahead = step(near.index + Math.round((this.lookahead + speed * 0.12) / T.spacing));
    const base = this.useLine && P === T ? T.line[ahead] : 0;
    const lat = Math.max(-limit, Math.min(limit, base + (P === T ? this.lane : 0) + this.avoid));
    const tp = P.poseAt(ahead, lat);
    const r = vehicle.body.rotation();
    _q.set(r.x, r.y, r.z, r.w).invert();
    _v.set(tp.x - p.x, 0, tp.z - p.z).applyQuaternion(_q);
    const angle = Math.atan2(_v.x, _v.z); // + = vänster
    let steer = Math.max(-1, Math.min(1, angle / (vehicle.def.steerMax * 0.8)));
    // Bilar som kan styra förbi greppgränsen (sladdbilar) kör datorn mjukt:
    // aldrig mer ratt än en vanlig bil (steerAssist 1,5) skulle få.
    steer *= steerCap(vehicle.def, speed);
    // Strax efter en landning: rak ratt tills bilen satt sig
    if (vehicle.landTime > 0) steer *= 0.2;

    // Fart ur profilen, skalad efter bilens grepp, lite framåt för reaktionstid
    const look = step(near.index + Math.round((0.6 + speed * 0.18) / T.spacing));
    const gripScale = Math.sqrt(aiGrip(vehicle.def) / MU_REF);
    const driveScale = vehicle.def.drive === 'RWD' ? 0.9 : 1; // bakhjulsdrivna sladdar ut lättare
    const rubber = 1 + Math.max(-0.06, Math.min(0.06, this.catchup * 0.06));
    let vTarget = Math.min(vehicle.def.topSpeed * vehicle.mods.topMul, P.lineSpeed[look] * gripScale * driveScale * this.skill * rubber);
    vTarget = Math.min(vTarget, followSpeed);

    let throttle = 1;
    if (speed > vTarget + 0.8) throttle = -1;
    else if (speed > vTarget) throttle = 0.2;
    // Antispinn: drivhjul som glider får mindre gas (räddar bakhjulsdrivna)
    if (throttle > 0 && vehicle.wheels.some((w) => w.driven && w.grounded && w.slide > 1.02)) throttle = Math.min(throttle, 0.35);

    // I luften: släpp gas och ratt så bilen inte tippar (gas vrider nosen uppåt)
    if (vehicle.grounded === 0) return { throttle: 0, steer: 0 };

    // Fast mot något: backa loss med motsatt styrning en stund.
    // Backa tills nosen pekar ungefär mot vägen igen (minst 0,7 s, högst 2 s),
    // så att en bil som står med nosen mot en vägg i en smal tunnel kommer loss.
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      if (!(this.reverseTime < 1.3 && Math.abs(angle) < 0.45)) return { throttle: -1, steer: -steer };
      this.reverseTime = 0;
    }
    // Nosen åt fel håll efter en snurr: vänd med en trepunktsvändning (backa
    // med motsatt ratt) i stället för en U-sväng som inte får plats på en
    // smal väg och slutar med nosen i vallen.
    if (Math.abs(angle) > 2 && Math.abs(vehicle.speed) < 2.5) { this.stuckTime = 0; this.reverseTime = 2.0; return { throttle: -1, steer: -steer }; }
    this.stuckTime = throttle > 0 && Math.abs(vehicle.speed) < 0.3 ? this.stuckTime + dt : 0;
    if (this.stuckTime > 0.8) { this.stuckTime = 0; this.reverseTime = 2.0; }
    return { throttle, steer };
  }

  // Efter respawn: börja om sökningen
  reset() { this.index = -1; this.avoid = 0; this.stuckTime = 0; this.reverseTime = 0; this.sc = null; this.scIndex = -1; }
}

// Äldre namn som testskriptet använder
export { AiDriver as PathFollower };
