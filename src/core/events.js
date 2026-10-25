// ---------------------------------------------------------------------------
// Enkel händelsekanal. Spelet skickar händelser (vapen, krockar, varv,
// nedräkning); ljud och HUD lyssnar utan att spelkoden känner till dem.
//
// Händelser:
//   countdown {n}            nedräkningens siffra (3, 2, 1)
//   go                       start
//   lap {racer, lap}         nytt varv påbörjat
//   finalLap {racer}
//   finish {racer, position}
//   pickup {racer}           kört över en blixt
//   armed {racer, id}        rouletten klar / vapen i handen
//   fire {racer, id, pos}
//   explode {pos, size}      size 0..1
//   zap {pos}                elchock träffar
//   splash {pos}             vattenballong spricker
//   bombPass {from, to}
//   hit {car, kind, pos}     vapenträff på en bil (blast, zap, wet, star)
//   impact {car, pos, strength}  krock (strength i m/s hastighetsändring)
//   land {car, strength}
//   respawn {car}
//   star {index, count, total, pos, all}  stuntläget: stjärna tagen (all = sista)
//   ui {name}                menyljud: move, select, back
// ---------------------------------------------------------------------------

export class Events {
  constructor() { this.map = new Map(); }
  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name).add(fn);
    return () => this.map.get(name)?.delete(fn);
  }
  emit(name, data = {}) {
    const set = this.map.get(name);
    if (set) for (const fn of set) fn(data);
  }
}

// Tyst kanal för tester och när ingen lyssnar
export const NULL_EVENTS = { on: () => () => {}, emit: () => {} };
