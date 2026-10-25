// ---------------------------------------------------------------------------
// Startfältet: sju datorförare i samma klass som spelaren, med egna namn,
// lackeringar och lite olika skicklighet. De kör klassens bilar i tur och
// ordning (spelarens egen modell sist i varvet) så att loppen blir jämna.
// Spelaren startar sist.
// ---------------------------------------------------------------------------

import { carsInClass } from '../vehicle/carDefs.js';

const DRIVERS = [
  { name: 'Blixten', body: 0x1fa0e8, trim: 0x101318, accent: 0xffffff, skill: 0.97, lane: 0.15 },
  { name: 'Sotis', body: 0x2a2d33, trim: 0xff6a00, accent: 0xff6a00, skill: 0.95, lane: -0.2 },
  { name: 'Humlan', body: 0xf6c80f, trim: 0x111111, accent: 0x111111, skill: 0.93, lane: 0.25 },
  { name: 'Vrålet', body: 0xc0172b, trim: 0xf2f2f2, accent: 0xf2f2f2, skill: 0.96, lane: -0.1 },
  { name: 'Gnistan', body: 0x7b3fe4, trim: 0x18f0c8, accent: 0x18f0c8, skill: 0.91, lane: 0.05 },
  { name: 'Grodan', body: 0x3fb43a, trim: 0x15301a, accent: 0xf5e663, skill: 0.9, lane: -0.3 },
  { name: 'Flamingon', body: 0xf06bb5, trim: 0x2b2b2b, accent: 0xffffff, skill: 0.92, lane: 0.3 },
];

// Svårighet skalar datorförarnas skicklighet
export const DIFFICULTY = { easy: 0.86, normal: 0.93, hard: 1.0 };

export function buildField(playerDef, count = 7, difficulty = 'hard') {
  const k = DIFFICULTY[difficulty] ?? 1;
  const others = carsInClass(playerDef.cls).filter((c) => c.id !== playerDef.id);
  const pool = [...others, playerDef];
  return DRIVERS.slice(0, count).map((d, i) => {
    const base = pool[i % pool.length];
    return {
      name: d.name,
      def: { ...base, id: `${base.id}-${i}`, name: d.name, colors: { body: d.body, trim: d.trim, accent: d.accent } },
      skill: d.skill * k,
      lane: d.lane,
      topMul: 0.97 + ((i * 37) % 5) * 0.012, // små skillnader i toppfart
    };
  });
}
