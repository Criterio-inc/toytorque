// ---------------------------------------------------------------------------
// Spola tillbaka: efter en krasch kan spelaren backa sin egen bil några
// sekunder längs den väg den just körde, och fortsätta därifrån med farten
// den hade då. Klockan och de andra bilarna står inte still, så det kostar
// tid men mindre än att sättas tillbaka på banan. Ett begränsat antal per lopp.
//
// Ren spelregel utan grafik: läser och skriver bara bilens fysikkropp, så
// den kan köras i node-testerna.
//
// Händelse: rewind {car, phase: 'start'|'end', left}
// ---------------------------------------------------------------------------

export const REWIND = {
  uses: 3,       // gånger per lopp
  rate: 30,      // lägen per sekund som sparas
  keep: 6,       // sekunder som finns kvar att spola i
  back: 3,       // så långt bakåt spolas det normalt
  minBack: 1,    // minsta sparade tid innan det går att spola
  playTime: 1.1, // sekunder som själva spolningen tar på skärmen
  upright: 0.7,  // bilens upp-axel i ett stadigt läge
};

export class Rewind {
  constructor({ cars, race, events = null, uses = REWIND.uses }) {
    this.cars = cars;
    this.race = race;
    this.events = events || { emit() {} };
    for (const c of cars) c.rewind = { uses, buf: [], t: 0, active: null };
  }

  // Ett fysiksteg, direkt efter world.step()
  step(dt) {
    for (const c of this.cars) {
      const s = c.rewind;
      if (s.active) { this._play(c, s, dt); continue; }
      if (!this.race.running || c.racer.finished) continue;
      s.t += dt;
      if (s.t < 1 / REWIND.rate) continue;
      s.t -= 1 / REWIND.rate;
      s.buf.push(sample(c));
      if (s.buf.length > REWIND.keep * REWIND.rate) s.buf.shift();
    }
  }

  // Börja spola. Returnerar true om det gick.
  start(c) {
    const s = c?.rewind;
    if (!s || s.active || s.uses <= 0 || !this.race.running || c.racer.finished) return false;
    const n = s.buf.length;
    if (n < REWIND.minBack * REWIND.rate) return false;
    // Sikta på tre sekunder bakåt. Var bilen redan i luften eller på sidan då
    // letar vi vidare bakåt efter ett läge med hjulen i marken, annars hamnar
    // spelaren mitt i samma krasch igen.
    let target = Math.max(0, n - 1 - Math.round(REWIND.back * REWIND.rate));
    for (let i = target; i >= 0; i--) if (s.buf[i].ok) { target = i; break; }
    s.uses--;
    s.active = { pos: n - 1, target, speed: Math.max(1, n - 1 - target) / REWIND.playTime };
    c.rewinding = true;
    ghost(c, true);
    this.events.emit('rewind', { car: c, phase: 'start', left: s.uses });
    return true;
  }

  // Bilen har satts tillbaka på annat sätt: det sparade spåret gäller inte längre
  clear(c) {
    const s = c?.rewind;
    if (!s) return;
    if (s.active) { s.active = null; c.rewinding = false; ghost(c, false); this.events.emit('rewind', { car: c, phase: 'end', left: s.uses }); }
    s.buf.length = 0;
  }

  _play(c, s, dt) {
    const a = s.active, buf = s.buf, body = c.vehicle.body;
    a.pos = Math.max(a.target, a.pos - a.speed * dt);
    const i = Math.floor(a.pos), f = a.pos - i;
    const A = buf[i], B = buf[Math.min(i + 1, buf.length - 1)];
    const p = A.p.map((v, k) => v + (B.p[k] - v) * f);
    // Kortaste vägen mellan två närliggande rotationer
    const sign = A.q[0] * B.q[0] + A.q[1] * B.q[1] + A.q[2] * B.q[2] + A.q[3] * B.q[3] < 0 ? -1 : 1;
    const q = A.q.map((v, k) => v + (B.q[k] * sign - v) * f);
    const ql = Math.hypot(...q) || 1;
    body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
    body.setRotation({ x: q[0] / ql, y: q[1] / ql, z: q[2] / ql, w: q[3] / ql }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    c.impactCool = 0.2; // förflyttningen är ingen krock
    c.racer.wrongWayTime = 0;
    if (c.stunt) { c.stunt.air = 0; c.stunt.drift = 0; } // ingen stuntbonus för en spolad luftfärd
    if (a.pos > a.target) return;
    // Framme: ge bilen tillbaka farten och loppläget den hade i det ögonblicket
    const T = buf[a.target], v = c.vehicle, r = c.racer;
    body.setLinvel({ x: T.lv[0], y: T.lv[1], z: T.lv[2] }, true);
    body.setAngvel({ x: T.av[0], y: T.av[1], z: T.av[2] }, true);
    v.steer = T.steer; v.motor = T.motor;
    v.airTime = 0; v.upsideTime = 0; v.wallTime = 0;
    r.trackIndex = T.ti; r.lastValidIndex = T.li;
    r.stuckTime = 0; r.bestProgress = -Infinity; r.fell = false;
    const cp = this.race.track?.checkpoints?.[r.nextCp];
    if (cp) r.prevS = Math.min((T.p[0] - cp.x) * cp.tangent.x + (T.p[2] - cp.z) * cp.tangent.z, -1e-3);
    buf.length = a.target + 1;
    s.active = null;
    c.rewinding = false;
    ghost(c, false);
    this.events.emit('rewind', { car: c, phase: 'end', left: s.uses });
  }
}

function sample(c) {
  const v = c.vehicle, b = v.body;
  const t = b.translation(), q = b.rotation(), lv = b.linvel(), av = b.angvel();
  return {
    p: [t.x, t.y, t.z], q: [q.x, q.y, q.z, q.w], lv: [lv.x, lv.y, lv.z], av: [av.x, av.y, av.z],
    steer: v.steer, motor: v.motor, ti: c.racer.trackIndex, li: c.racer.lastValidIndex,
    ok: v.grounded >= 3 && 1 - 2 * (q.x * q.x + q.z * q.z) > REWIND.upright,
  };
}

// Under spolningen ska bilen inte knuffa undan andra bilar på vägen bakåt
function ghost(c, on) {
  const b = c.vehicle.body;
  for (let i = 0; i < (b.numColliders?.() ?? 0); i++) b.collider(i).setSensor(on);
}
