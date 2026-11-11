import { Bits } from '../vehicle/sparks.js';

// ---------------------------------------------------------------------------
// Känsla: det som inte ändrar loppet men gör att det händer något i bild.
// Gnistor vid krockar och väggskrap, kameraskak vid landningar och smällar,
// kameran drar sig bakåt vid turbo, kort slow motion under stora hopp och
// konfetti när spelaren går i mål.
//
// Lyssnar på spelets händelser. Inget här påverkar fysiken eller tiderna:
// slow motion saktar bara ner hur fort simuleringen spelas upp.
// ---------------------------------------------------------------------------

const SLOW = { after: 0.75, scale: 0.42, max: 1.3 }; // sekunder i luften innan, uppspelningsfart, längsta tid

export class Juice {
  constructor(game) {
    const g = this.game = game;
    this.scale = 1;
    this.slowT = 0;
    const on = (name, fn) => g.events.on(name, fn);
    on('explode', (d) => { if (!d.replay) this.shake(d.pos, 0.3 + 0.55 * (d.size ?? 0.6), null); });
    on('hit', (d) => this.shake(null, d.kind === 'blast' ? 0.25 : 0.4, d.car));
    on('impact', (d) => {
      if (d.strength > 1.2) this.sparks?.sparks(d.pos, d.strength);
      this.shake(null, Math.min(0.45, d.strength * 0.07), d.car);
    });
    on('land', (d) => {
      const v = d.car.vehicle;
      if (d.strength > 2.2) this.sparks?.sparks(v.currPos, d.strength * 0.5);
      this.shake(null, Math.min(0.5, d.strength * 0.09), d.car);
    });
    on('boost', (d) => this.shake(null, 0.18, d.car));
    on('finish', (d) => { if (d.racer.isPlayer && g.mode !== 'demo') this.confetti?.confetti(d.racer.vehicle.currPos); });
  }

  // Ny bana: partiklarna hör till banans grupp och försvinner med den
  build(group) {
    this.sparks = new Bits(group, { max: 500, glow: true, gravity: 9, drag: 0.8 });
    this.confetti = new Bits(group, { max: 400, glow: false, gravity: 2.2, drag: 1.6 });
    this.scale = 1;
    this.slowT = 0;
  }

  // Skaka varje kamera efter avståndet från dess bil (delad skärm: var och en för sig)
  shake(pos, amount, car) {
    const g = this.game;
    if (!g.shakeOn || g.replaying) return;
    for (const [cam, own] of [[g.chase, g.p1], [g.chase2, g.p2]]) {
      if (!cam || !own) continue;
      if (car) { if (car === own) cam.addShake(amount); continue; }
      const k = Math.max(0, 1 - own.vehicle.currPos.distanceTo(pos) / 5);
      if (k > 0) cam.addShake(amount * k * k);
    }
  }

  // Hur mycket verklig tid som ska spelas upp den här bilden. Under ett stort
  // hopp går spelet långsammare en kort stund (bara med en spelare).
  time(dt) {
    const g = this.game, v = g.player;
    const solo = v && !g.p2 && (g.mode === 'race' || g.mode === 'timetrial' || g.mode === 'stunt') && g.race?.running;
    const high = solo && v.grounded === 0 && v.airTime > SLOW.after && this.slowT < SLOW.max;
    if (high) this.slowT += dt; else if (!solo || v.grounded > 0) this.slowT = 0;
    this.scale += ((high ? SLOW.scale : 1) - this.scale) * (1 - Math.exp(-dt * (high ? 9 : 6)));
    return dt * this.scale;
  }

  // En gång per bild
  update(dt) {
    const g = this.game;
    for (const car of g.cars) {
      const v = car.vehicle;
      // Skrapar längs en vägg i fart: en tunn rad gnistor
      if (v.wallTime > 0.2 && Math.abs(v.speed) > 3 && Math.random() < dt * 40) this.sparks.sparks(v.currPos, 0.25);
    }
    // Turbo: kameran drar sig bakåt (bredare synfält) så länge den brinner
    if (g.chase) g.chase.kick = g.racer?.fx?.boost > 0 ? 1 : 0;
    if (g.chase2 && g.p2) g.chase2.kick = g.p2.racer.fx?.boost > 0 ? 1 : 0;
    this.sparks.update(dt);
    this.confetti.update(dt);
  }
}
