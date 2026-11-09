// ---------------------------------------------------------------------------
// Stuntbonus: luftfärder och sladdar fyller en turbomätare i tre steg.
// Ett steg kan sedan brännas som en kort turbo (spelaren med Q eller
// handkontrollens X, datorförarna själva på raka sträckor).
//
// Ren spelregel utan grafik: läser bara bilarnas fysikläge och skriver
// racer.fx.boost, som vapensystemet gör om till fart. Därför kan den köras
// i node-testerna.
//
// Händelser: stunt {car, kind, label, gain}, boost {car}
// ---------------------------------------------------------------------------

export const BONUS = {
  segments: 3,        // mätaren rymmer tre turbor
  boostTime: 1.4,     // sekunder per turbo
  boostTop: 1.15,     // toppfart under turbo (gånger bilens egen)
  boostPower: 1.9,    // dragkraft under turbo
  // Luft: sekunder utan hjul i marken → etikett och påfyllning (andel av ett steg)
  air: [
    { min: 1.4, label: 'MÅNFÄRD!', gain: 1.0 },
    { min: 0.85, label: 'STOR LUFT!', gain: 0.6 },
    { min: 0.45, label: 'LUFT!', gain: 0.3 },
  ],
  landUpright: 0.6,   // bilens upp-axel måste peka minst så här uppåt vid landning
  // Sladd: däcken glider medan bilen girar i fart (samma glid som ritar
  // bromsspår), eller en tydlig slipvinkel. Greppstarka bilar glider sällan
  // av sig själva; en kort inbromsning in i svängen sätter fart på sladden.
  driftAngle: 0.32,   // rad (cirka 18°)
  driftYaw: 0.8,      // rad/s gir
  driftSpeed: 0.35,   // andel av toppfarten
  driftGrace: 0.18,   // kort rak stund bryter inte sladden
  drift: [
    { min: 1.4, label: 'LÅNG SLADD!', gain: 0.6 },
    { min: 0.5, label: 'SLADD!', gain: 0.3 },
  ],
};

export class StuntBonus {
  constructor({ cars, race, track = null, events = null, aiBoost = true }) {
    this.cars = cars;
    this.race = race;
    this.track = track;
    this.events = events || { emit() {} };
    this.aiBoost = aiBoost;
    for (const c of cars) this.init(c);
  }

  init(c) {
    c.stunt = { meter: 0, air: 0, drift: 0, driftGap: 0, aiThink: 0 };
    c.racer.fx ||= {};
    c.racer.fx.boost = 0;
  }

  // Ett fysiksteg, efter world.step()
  step(dt) {
    const running = this.race.running;
    for (const c of this.cars) {
      const s = c.stunt || (this.init(c), c.stunt);
      if (!running || c.racer.finished) { s.air = 0; s.drift = 0; continue; }
      this._air(c, s, dt);
      this._drift(c, s, dt);
      if (c.ai && this.aiBoost) this._aiUse(c, s, dt);
    }
  }

  _air(c, s, dt) {
    const v = c.vehicle;
    // Bilens egen lufttid nollställs när den sätts tillbaka på banan, så ett
    // fall av banan räknas inte som ett hopp
    if (v.grounded === 0) { s.air = v.airTime ?? s.air + dt; return; }
    if (s.air > 0) {
      const t = s.air;
      s.air = 0;
      if (upY(v) < BONUS.landUpright) return; // landade på taket eller sidan: ingen bonus
      const tier = BONUS.air.find((a) => t >= a.min);
      if (tier) this._award(c, 'air', tier, t);
    }
  }

  _drift(c, s, dt) {
    const v = c.vehicle;
    const lv = v.body.linvel();
    const speed = Math.hypot(lv.x, lv.z);
    const q = v.currQuat;
    // Bilens framåtriktning i planet (z-axeln roterad med kvaternionen)
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const fl = Math.hypot(fx, fz) || 1;
    const along = (lv.x * fx + lv.z * fz) / fl;
    const slip = Math.atan2(Math.abs(lv.x * fz - lv.z * fx) / fl, Math.abs(along));
    const skids = v.wheels ? v.wheels.reduce((n, w) => n + (w.skid ? 1 : 0), 0) : 0;
    const yaw = Math.abs(v.body.angvel?.().y ?? 0);
    const sliding = v.grounded >= 3 && along > 0 && speed > BONUS.driftSpeed * v.def.topSpeed
      && (slip > BONUS.driftAngle || (skids >= 2 && yaw > BONUS.driftYaw));
    if (sliding) { s.drift += dt; s.driftGap = 0; return; }
    if (s.drift <= 0) return;
    s.driftGap += dt;
    if (s.driftGap < BONUS.driftGrace && v.grounded >= 2) return;
    const t = s.drift;
    s.drift = 0;
    s.driftGap = 0;
    const tier = BONUS.drift.find((d) => t >= d.min);
    if (tier) this._award(c, 'drift', tier, t);
  }

  _award(c, kind, tier, time) {
    const s = c.stunt;
    s.meter = Math.min(BONUS.segments, s.meter + tier.gain);
    this.events.emit('stunt', { car: c, kind, label: tier.label, gain: tier.gain, time });
  }

  // Bränn ett steg som turbo. Returnerar true om det gick.
  boost(c) {
    const s = c?.stunt;
    if (!s || !this.race.running || c.racer.finished) return false;
    if (s.meter < 1 || c.racer.fx.boost > 0) return false;
    s.meter -= 1;
    c.racer.fx.boost = BONUS.boostTime;
    this.events.emit('boost', { car: c });
    return true;
  }

  // Datorförarna bränner turbo när ideallinjen framåt är snabb (en rak)
  _aiUse(c, s, dt) {
    if (s.meter < 1 || c.racer.fx.boost > 0) return;
    if ((s.aiThink -= dt) > 0) return;
    s.aiThink = 0.3;
    const T = this.track;
    if (!T) return;
    const i = c.racer.trackIndex >= 0 ? c.racer.trackIndex : 0;
    const ahead = T.lineSpeed[(i + Math.round(8 / T.spacing)) % T.N];
    if (ahead > 0.85 * c.vehicle.def.topSpeed && c.vehicle.grounded >= 3) this.boost(c);
  }
}

// Hur mycket bilens upp-axel pekar uppåt (1 = rätt väg, -1 = på taket)
export function upY(v) {
  const q = v.currQuat;
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}
