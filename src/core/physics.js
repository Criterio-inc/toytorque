// ---------------------------------------------------------------------------
// Fysikens grundkonstanter. Allt är i SI-enheter: meter, kilogram, sekunder.
// Bilarna är byggda i riktig RC-skala, ungefär en halv meter långa, och
// gravitationen är lite starkare än jordens för att de ska kännas tunga.
// ---------------------------------------------------------------------------

export const STEP = 1 / 120; // fast fysiksteg; små snabba bilar kräver tätt steg
export const MAX_STEPS_PER_FRAME = 8; // skydd mot "dödsspiral" vid seg frame
export const GRAVITY = 11; // m/s²

// Kollisionsgrupper (bitar). Rapier: groups = (medlemskap << 16) | filter.
export const G = {
  WORLD: 1 << 0,
  CAR: 1 << 1,
  PROP: 1 << 2,
  PICKUP: 1 << 3,
  PROJECTILE: 1 << 4,
};
export const ALL = 0xffff;
export const groups = (member, filter = ALL) => ((member & 0xffff) << 16) | (filter & 0xffff);

// Hjulens strålar ska träffa mark och lösa föremål, aldrig bilar.
export const WHEEL_RAY_GROUPS = groups(ALL, G.WORLD | G.PROP);
// Kamerans strål ska bara stoppas av fasta saker.
export const CAMERA_RAY_GROUPS = groups(ALL, G.WORLD);

export function createWorld(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = STEP;
  // Typisk objektstorlek runt en halvmeter; styr Rapiers toleranser.
  world.lengthUnit = 0.5;
  return world;
}
