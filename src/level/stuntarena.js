import { makeConcreteFloor, makeHallWalls, addFloorLines, addBeachBall } from './warehouseArt.js';
import { StuntKit, loopGuide, addBleachers, addCeilingLights, addBanner, addStripe, toWorld } from './stuntArt.js';

// ---------------------------------------------------------------------------
// Stuntarenan: en stor idrottshall (96 × 96 m) full av hinder för fri körning,
// en stuntarena. Inga varv och inga motståndare: 20 guldstjärnor
// ligger utspridda, några på golvet, några högt upp på plattformar och några i
// luften över hopp. Banan (`track`) är en målad löparbana runt hallen som bara
// används för "närmaste väg" och kameran; stuntläget sätter tillbaka bilen vid
// närmaste startpunkt i `stunt.spawns`.
//
// Hindren (mitt i hallen = origo, +z norrut):
//   Loopen          x 29–34, z −18…−14   klotoidloop, R 2 m, 4,4 m hög
//   Stora hoppet    x −30, z −24…−2      ramp upp till 1,2 m, glapp 5 m, landning
//   Terrassen       sydväst              ramp → platå 1 m → ramp → platå 2 m →
//                                        bro → platå 2 m → lång ramp ner
//   Pyramiderna     (14, −10), (22, −3)
//   Skålen          (−11, 4)             brant vägg ("dödsväggen") med infart i söder
//   Halfpipen       (−22, 24)            längs x, med däck och ramp upp bakifrån
//   Quarter pipen   (0, 33)              85° mot norra väggen
//   Tornet          (26, 22)             spiralramp 1¼ varv upp till 5 m
//   Kickers         huvudhoppet (0, 8), storkickern (6, −6) m.fl.
// ---------------------------------------------------------------------------

const SIZE = 96;

// Senaste byggets statistik (testskriptet kollar att alla skal gick att bygga)
export const BUILD_STATS = { colliders: 0, failed: 0 };
const H = 14;

// Loopen: delas mellan bygget och styrningen i stuntläget
const LOOP_F = { x: 30, z: -18, rot: 0 };
const LOOP = { R: 2.0, width: 1.6, shift: 2.8, ease: 0.6 };

// Tornet
const TOWER = { cx: 26, cz: 22, r0: 3.0, r1: 6.0, top: 5.0, a0: -Math.PI / 2, turns: 1.25 };
const towerA1 = TOWER.a0 + TOWER.turns * Math.PI * 2;

// Halfpipen: tvärsnitt längs z runt zc
const HP = { x: -22, zc: 24, flat: 1.5, R: 2.2, ang: 1.4, deck: 1.5, len: 16 };
const hpLip = HP.flat + HP.R * Math.sin(HP.ang);
const hpTop = HP.R * (1 - Math.cos(HP.ang));

// Skålen
const BOWL = { cx: -11, cz: 4, r0: 3.5, Rw: 3.5, maxAng: 1.25, lip: 0.6, gapAt: -Math.PI / 2, gapWidth: 0.75 };

// Startpunkter (R sätter bilen vid närmaste). heading 0 = norrut (+z).
const SPAWNS = [
  { x: 0, z: -10, heading: 0, name: 'Mitten' },
  { x: -30, z: -44, heading: 0, name: 'Stora hoppet' },
  { x: 30, z: -44, heading: 0, name: 'Loopen' },
  { x: 6, z: -44, heading: 0, name: 'Under bron' },
  { x: 13, z: -44, heading: 0, name: 'Terrassen' },
  { x: 36, z: -30, heading: 0, name: 'Östra kickern' },
  { x: -11, z: -14, heading: 0, name: 'Skålen' },
  { x: -22, z: -2, heading: 0, name: 'Halfpipen' },
  { x: 14, z: 17.5, heading: Math.PI / 2, name: 'Tornet' },
  { x: -36, z: -4, heading: 0, name: 'Västra kickern' },
  { x: 0, z: 20, heading: 0, name: 'Quarter pipen' },
];

// Stjärnorna. reach: hur den nås (för testet och för läsaren).
//   floor = på golvet, deck = på en yta (höjd = ytan + 0,35), air = i luften
//   över ett hopp (placerad på en uppmätt bana), wall = på en lutande vägg.
const towerRampA = TOWER.a0 + Math.PI * 1.25;
const STARS = [
  // Lätta, på golvet
  { x: 0, y: 0.35, z: -4, reach: 'floor' },
  { x: 6, y: 0.35, z: -23, reach: 'floor' }, // under bron
  { x: -22, y: 0.35, z: 24, reach: 'floor' }, // i halfpipens botten
  { x: -11, y: 0.35, z: 4, reach: 'floor' }, // mitt i skålen
  { x: 35, y: 0.35, z: 33, reach: 'floor' },
  // På plattformar och ytor
  { x: -15, y: 1.35, z: -22, reach: 'deck' }, // första platån
  { x: -3, y: 2.35, z: -23, reach: 'deck' }, // andra platån
  { x: 5, y: 2.35, z: -23, reach: 'deck' }, // på bron
  { x: 14, y: 1.65, z: -10, reach: 'deck' }, // pyramidens topp
  { x: TOWER.cx, y: TOWER.top + 0.35, z: TOWER.cz, reach: 'deck' }, // tornets topp
  { x: TOWER.cx + 4.5 * Math.cos(towerRampA), y: 2.5 + 0.3, z: TOWER.cz + 4.5 * Math.sin(towerRampA), reach: 'deck' }, // halvvägs upp
  { x: HP.x, y: hpTop + 0.35, z: HP.zc + hpLip + 0.75, reach: 'deck' }, // halfpipens norra däck
  // I luften och på väggar (placerade på uppmätta banor, se scripts/sim-test.mjs)
  { x: -30, y: 1.58, z: -13.5, reach: 'air', run: 'gap' }, // över glappet
  { x: 0, y: 1.3, z: 14.2, reach: 'air', run: 'main' }, // över huvudhoppet
  { x: 6, y: 2.2, z: 3.9, reach: 'air', run: 'big' }, // över storkickern
  { x: 0, y: 3.0, z: 35.33, reach: 'air', run: 'qp' }, // ovanför quarter pipens kant
  { x: LOOP_F.x + 1.3, y: 4.0, z: LOOP_F.z + 1.85, reach: 'air', run: 'loop' }, // högst upp i loopen
  { x: BOWL.cx, y: 1.45, z: BOWL.cz + 5.9, reach: 'wall' }, // högt på skålens vägg
  { x: HP.x, y: 2.3, z: 21.3, reach: 'air', run: 'halfpipe' }, // i luften över halfpipen, från södra däcket
  { x: 36, y: 1.99, z: 8.3, reach: 'air', run: 'east' }, // över östra kickern
];

export const stuntarena = {
  id: 'stuntarena',
  name: 'Stuntarenan',
  laps: 1,
  sky: 0x2b3038,
  fog: { near: 55, far: 140, color: 0x5d636c },
  lighting: {
    sun: { color: 0xfff4e2, intensity: 1.9, offset: [10, 30, 6] },
    hemi: { sky: 0xf4f1ea, ground: 0x6b6862, intensity: 1.05 },
    exposure: 1.08,
    envIntensity: 0.6,
  },
  floor: { size: SIZE },
  trackTheme: { road: '#9c3f2c', roadRough: 0.85, barrierA: 0xd23b3b, barrierB: 0xf0f0f0 },

  // Löparbanan runt hallen (utan kantvallar, inga svängpilar)
  track: {
    scale: 1,
    roadHalf: 1.6,
    spacing: 0.6,
    checkpoints: 12,
    start: { x: 0, z: -40 },
    corners: [
      { x: 40, z: -40, r: 10 },
      { x: 40, z: 40, r: 10 },
      { x: -40, z: 40, r: 10 },
      { x: -40, z: -40, r: 10 },
    ],
    openings: [[0, 1]],
  },

  statics: [],
  props: [],

  stunt: {
    spawns: SPAWNS,
    stars: STARS,
    guides: [loopGuide(LOOP_F, LOOP)],
    collectRadius: 0.5,
    // Högsta körbara yta (tornets topp) och högsta hopp, för rimlighetskollen
    maxDeck: TOWER.top,
  },

  environment({ scene, world, RAPIER }) {
    return buildArena(scene, world, RAPIER);
  },
};

// Färger
const C = {
  yellow: 0xf2c230, red: 0xd8352a, blue: 0x2d6cdf, green: 0x2fa84f, orange: 0xf07a1c,
  white: 0xeeeeea, grey: 0x9a9ea5, ply: 0xffffff, purple: 0x7a4fc9, teal: 0x1fa3a3,
};

function buildArena(scene, world, RAPIER) {
  makeConcreteFloor(scene, world, RAPIER, { size: SIZE, lines: false });
  makeHallWalls(scene, world, RAPIER, { size: SIZE, height: H });
  const K = new StuntKit(scene, world, RAPIER);

  // --- Kickers -----------------------------------------------------------
  const kick = (x, z, rot, o) => {
    const f = { x, z, rot };
    const k = K.kicker(f, { mat: 'paint', ...o });
    addStripe(K, toWorld(f, -o.width / 2, o.h, k.length - 0.06), toWorld(f, o.width / 2, o.h, k.length - 0.06), 0.1, 0x1b1d22);
    return k;
  };
  kick(0, 8, 0, { h: 0.5, ang: 0.38, width: 2.4, color: C.yellow, sideColor: 0x3a3d45 }); // huvudhoppet
  kick(6, -6, 0, { h: 1.0, ang: 0.42, width: 3, color: C.red, sideColor: 0x3a3d45, segs: 10 }); // storkickern
  kick(14, 10, 0, { h: 0.3, ang: 0.33, width: 2, color: C.blue, sideColor: 0x3a3d45 });
  kick(36, 0, 0, { h: 0.6, ang: 0.4, width: 2.4, color: C.orange, sideColor: 0x3a3d45 }); // östra
  kick(-36, 12, 0, { h: 0.35, ang: 0.35, width: 2.2, color: C.green, sideColor: 0x3a3d45 }); // västra
  kick(-6, 22, Math.PI / 2, { h: 0.25, ang: 0.3, width: 2, color: C.teal, sideColor: 0x3a3d45 });
  kick(18, 30, -Math.PI / 2, { h: 0.4, ang: 0.36, width: 2.2, color: C.purple, sideColor: 0x3a3d45 });

  // --- Stora hoppet: ramp upp till kanten, glapp, landningsramp ------------
  const gapF = { x: -30, z: -24, rot: 0 };
  K.profile(gapF, [[0, 0], [1.5, 0.05], [3, 0.2], [5.5, 0.66], [8, 1.2]], 3, { mat: 'wood', color: C.ply, sideColor: 0x8a6a48 });
  addStripe(K, toWorld(gapF, -1.5, 1.2, 7.94), toWorld(gapF, 1.5, 1.2, 7.94), 0.12, C.yellow);
  const landF = { x: -30, z: -2, rot: Math.PI };
  K.profile(landF, [[0, 0], [1.5, 0.04], [7.5, 0.82], [9, 0.9]], 3, { mat: 'wood', color: C.ply, sideColor: 0x8a6a48 });

  // --- Terrassen: platåer på olika höjd, ramper och en bro ----------------
  const plat = (x, z, w, d, h, color) => K.box({ x, z, rot: 0 }, 0, 0, w, d, 0, h, { mat: 'paint', color });
  K.profile({ x: -24, z: -22, rot: Math.PI / 2 }, [[0, 0], [1, 0.03], [6, 1.0]], 3, { mat: 'wood', color: C.ply, sideColor: 0x8a6a48 });
  plat(-15, -22, 6, 8, 1.0, 0x4f8fd9);
  K.profile({ x: -12, z: -22, rot: Math.PI / 2 }, [[0, 1.0], [6, 2.0]], 3, { mat: 'wood', color: C.ply, sideColor: 0x8a6a48 });
  plat(-3, -23, 6, 6, 2.0, 0x5aa36a);
  // Bron med räcken
  K.box({ x: 5, z: -23, rot: 0 }, 0, 0, 10.2, 2, 1.75, 2.0, { mat: 'paint', color: 0xc9ccd2 });
  for (const s of [-1, 1]) K.box({ x: 5, z: -23 + s * 1.04, rot: 0 }, 0, 0, 10.2, 0.08, 2.0, 2.25, { mat: 'metal', color: C.yellow });
  plat(13, -23, 6, 8, 2.0, 0xd9844f);
  K.profile({ x: 13, z: -37, rot: 0 }, [[0, 0], [1.5, 0.05], [10, 2.0]], 3, { mat: 'wood', color: C.ply, sideColor: 0x8a6a48 });

  // --- Pyramider -----------------------------------------------------------
  K.pyramid({ x: 14, z: -10, rot: 0 }, { base: 8, top: 2, h: 1.3, mat: 'concrete', color: 0xd8d2c4 });
  K.pyramid({ x: 22, z: -3, rot: Math.PI / 4 }, { base: 6, top: 1.5, h: 0.9, mat: 'concrete', color: 0xc8c2b4 });
  K.pyramid({ x: -36, z: 28, rot: 0 }, { base: 5, top: 1.2, h: 0.7, mat: 'concrete', color: 0xc8c2b4 });

  // --- Loopen --------------------------------------------------------------
  K.loop(LOOP_F, { ...LOOP, mat: 'paint', color: 0x2d6cdf, edgeColor: 0xf2c230 });
  // --- Skålen ("dödsväggen") -----------------------------------------------
  K.bowl({ ...BOWL, mat: 'concrete', color: 0xcfd3d8, sideColor: 0x9da3aa });

  // --- Halfpipen -------------------------------------------------------------
  const hpOpts = { R: HP.R, maxAng: HP.ang, width: HP.len, deck: HP.deck, start: HP.flat, mat: 'wood', color: C.ply, sideColor: 0x8a6a48 };
  K.quarterPipe({ x: HP.x, z: HP.zc, rot: 0 }, hpOpts);
  K.quarterPipe({ x: HP.x, z: HP.zc, rot: Math.PI }, hpOpts);
  for (const s of [-1, 1]) addStripe(K, [HP.x - HP.len / 2, hpTop, HP.zc + s * (hpLip + 0.05)], [HP.x + HP.len / 2, hpTop, HP.zc + s * (hpLip + 0.05)], 0.1, 0x1b1d22);
  // Ramp upp till södra däcket bakifrån
  const hpBack = HP.zc - hpLip - HP.deck;
  K.profile({ x: HP.x, z: hpBack - 8, rot: 0 }, [[0, 0], [1.5, 0.05], [3, 0.3], [5.5, 1.0], [8, hpTop]], 4, { mat: 'wood', color: C.ply, sideColor: 0x8a6a48 });

  // Ramp upp till norra däcket från öster
  K.profile({ x: -6, z: HP.zc + hpLip + HP.deck / 2, rot: -Math.PI / 2 }, [[0, 0], [1.5, 0.05], [3, 0.3], [8, hpTop]], HP.deck, { mat: 'wood', color: C.ply, sideColor: 0x8a6a48 });

  // --- Quarter pipe mot norra väggen ----------------------------------------
  const qp = K.quarterPipe({ x: 0, z: 33, rot: 0 }, { R: 2.5, maxAng: 1.62, width: 10, deck: 1.0, segs: 18, mat: 'paint', color: 0xe9e4da, sideColor: 0x3a3d45 });
  addStripe(K, [-5, qp.height, 33 + qp.lip + 0.05], [5, qp.height, 33 + qp.lip + 0.05], 0.1, C.red);

  // --- Tornet med spiralramp ------------------------------------------------
  const T = TOWER;
  K.cylinder(T.cx, T.cz, T.r0, 0, T.top, { mat: 'concrete', color: 0xb9b4aa, sides: 24 });
  K.spiral({ cx: T.cx, cz: T.cz, r0: T.r0, r1: T.r1, a0: T.a0, a1: towerA1, y0: 0, y1: T.top, mat: 'paint', color: 0xd8352a, sideColor: 0x8a2a20 });
  // Däck på toppen (där rampen inte går), med en öppning i räcket mot mitten
  const open = Math.atan2(-T.cz, -T.cx);
  const angd = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  K.ringDeck({ cx: T.cx, cz: T.cz, r0: T.r0, r1: T.r1, a0: towerA1, a1: T.a0 + Math.PI * 4, y: T.top, mat: 'paint', color: 0xd8352a, railSkip: (a) => angd(a, open) < 0.35 });
  // Stöttor utanför rampen
  const approach = Math.atan2(-4.5, -Math.sqrt((T.r1 + 0.18) ** 2 - 4.5 ** 2)); // där anloppet från väster passerar
  for (let i = 0; i < 10; i++) {
    const a = towerA1 + ((T.a0 + Math.PI * 4 - towerA1) * (i + 0.5)) / 10;
    if (angd(a, approach) < 0.35) continue;
    K.cylinder(T.cx + (T.r1 + 0.18) * Math.cos(a), T.cz + (T.r1 + 0.18) * Math.sin(a), 0.1, 0, T.top - 0.05, { mat: 'metal', color: 0x8a9099, sides: 8 });
  }
  for (let i = 0; i < 8; i++) {
    const a = T.a0 + 0.3 + (Math.PI * 1.5 * i) / 8;
    const y = (T.top * (a - T.a0)) / (towerA1 - T.a0) - 0.3;
    if (y > 0.4) K.cylinder(T.cx + (T.r1 - 0.25) * Math.cos(a), T.cz + (T.r1 - 0.25) * Math.sin(a), 0.09, 0, y, { mat: 'metal', color: 0x8a9099, sides: 8 });
  }

  // --- Dekor -----------------------------------------------------------------
  addBleachers(K, { x: 0, z: -SIZE / 2 + 5.6, rot: 0, length: 56, seed: 3 });
  addBleachers(K, { x: 0, z: SIZE / 2 - 5.6, rot: Math.PI, length: 40, seed: 5 });
  addCeilingLights(K, { size: SIZE, height: H });
  K.flush();
  BUILD_STATS.colliders = K.count;
  BUILD_STATS.failed = K.failed;
  if (scene) {
    addBanner(scene, { x: 0, y: 8.5, z: -SIZE / 2 + 0.05, rot: 0, w: 22, h: 3, text: 'STUNTARENAN' });
    addBanner(scene, { x: 0, y: 8.5, z: SIZE / 2 - 0.05, rot: Math.PI, w: 22, h: 3, text: 'STUNTARENAN' });
    addBanner(scene, { x: -SIZE / 2 + 0.05, y: 7.5, z: 0, rot: Math.PI / 2, w: 16, h: 2.4, text: '★ 20 STJÄRNOR ★', bg: '#c62828', fg: '#ffffff' });
    addBanner(scene, { x: SIZE / 2 - 0.05, y: 7.5, z: 0, rot: -Math.PI / 2, w: 16, h: 2.4, text: 'TOYTORQUE', bg: '#111418', fg: '#ffd23f' });
    // Målade linjer: mittcirkel och anloppsfiler
    const circle = (cx, cz, r, n = 48) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2), cz + r * Math.sin((i / n) * Math.PI * 2)]);
    addFloorLines(scene, {
      lines: [
        { points: circle(0, -10, 3), closed: true, width: 0.12, color: 'white' },
        { points: [[0, -14], [0, 7.5]], width: 0.1, color: 'yellow', dash: [0.8, 0.6] },
        { points: [[-30, -40], [-30, -24.5]], width: 0.1, color: 'yellow', dash: [0.8, 0.6] },
        { points: [[30, -40], [30, -18.5]], width: 0.1, color: 'yellow', dash: [0.8, 0.6] },
        { points: [[6, -40], [6, -6.5]], width: 0.1, color: 'yellow', dash: [0.8, 0.6] },
        { points: [[36, -30], [36, -0.5]], width: 0.1, color: 'yellow', dash: [0.8, 0.6] },
        { points: circle(BOWL.cx, BOWL.cz, BOWL.r0 - 0.4), closed: true, width: 0.1, color: 'red' },
      ],
    });
  }

  // Lösa saker att knuffa på
  const loose = [];
  for (const [x, z, r] of [[-4, -8, 0.3], [9, 14, 0.35], [-26, 8, 0.3], [20, -30, 0.3]]) loose.push(addBeachBall(scene, world, RAPIER, { x, z, r }));
  return loose.filter((p) => p && p.body);
}

export const STUNT_LOOP = { frame: LOOP_F, ...LOOP };
export const STUNT_TOWER = TOWER;
