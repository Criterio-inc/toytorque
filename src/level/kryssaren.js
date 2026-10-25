import {
  SHIP, HOUSE, halfWidth, hullEdge, offsetPolyline, makeSea, makeHull, makeRailings, makeSuperstructure,
  addPortholes, addLifeboats, addDeckChairs, addLifeRings, addDeckGear, addLane,
  addForepeak, addCaptainsCorner, addLuggage, addDeckEdges,
} from './shipArt.js';
import { addBeachBall } from './warehouseArt.js';

// ---------------------------------------------------------------------------
// Nivå: Kryssaren. Promenaddäcket på en stor kryssare i riktig skala (meter).
// Banan går runt överbyggnaden: styrbordsrakan med ett hopp under livbåtarna,
// runt fören, babordsrakan under promenaddäckets tak och upp på akterdäcket
// (förbi poolen) via två plankramper. Havet ligger åtta meter under.
// Genvägen skär av stäven genom förpikens täckta passage, babordsrakan har
// ett bordshopp och promenaden kantas av blomlådor i stället för vallar.
// Vid starten står kaptenens podium med jätteankaret.
// ---------------------------------------------------------------------------

const Z = 11;       // rakornas avstånd från mittlinjen
const J = 4;        // hoppkanten på styrbordsrakan
const J2 = 21;      // hoppkanten på babordsrakan (körs mot −x)
const FX = 48.4;    // förpikens tunnel: genvägen tvärs över fördäcket
const SUN = [16, 30, 11]; // solens riktning (används även av havet)
const POOL = { x0: -50.6, x1: -45.6, z0: -4.2, z1: 4.2 };

export const kryssaren = {
  id: 'kryssaren',
  name: 'Kryssaren',
  laps: 3,
  sky: 0x9cc8ea,
  skyGradient: ['#2a6cbd', '#d3e8f4', '#9cc6e0'],
  fog: { near: 120, far: 320, color: 0xd3e8f4 },
  lighting: {
    sun: { color: 0xfff3de, intensity: 2.6, offset: SUN },
    hemi: { sky: 0xd6ebff, ground: 0x9a7650, intensity: 0.85 },
    exposure: 1.0,
    envIntensity: 0.6,
  },
  floor: { size: 160 },

  track: {
    scale: 1,
    roadHalf: 1.6,
    spacing: 0.6,
    checkpoints: 16,
    barrierHeight: 0.18,
    barrierThick: 0.1,
    start: { x: 26, z: -Z }, // efter hoppet: första varvet når hoppet i full fart
    // Styrbord (−z) mot fören, runt stäven, babord akterut, runt aktern
    corners: [
      { x: 50, z: -Z, r: 8 },
      { x: 61, z: 0, r: 7 },
      { x: 50, z: Z, r: 8 },
      { x: -54, z: Z, r: 6 },
      { x: -54, z: -Z, r: 6 },
    ],
    elevation: [
      // Rampen upp på akterdäcket (babord) och ner igen (styrbord)
      { at: [-31, Z], y: 0 },
      { at: [SHIP.sunX, Z], y: SHIP.sunY },
      { at: [SHIP.sunX, -Z], y: SHIP.sunY },
      { at: [-31, -Z], y: 0 },
      // Lastluckan på styrbordsrakan: uppför, krön och nedför
      { at: [-27, -Z], y: 0 },
      { at: [-19.5, -Z], y: 0.6 },
      { at: [-12.5, -Z], y: 0 },
      // Hoppet: rak ramp ända ut i kanten, glapp, landning nedför
      { at: [J - 8.5, -Z], y: 0 },
      { at: [J - 5.5, -Z], y: 0.06 },
      { at: [J, -Z], y: 0.46, linear: true },
      { at: [J + 1.2, -Z], y: 0.32, linear: true },
      { at: [J + 4, -Z], y: 0.14, linear: true },
      { at: [J + 9.5, -Z], y: 0 },
      // Andra hoppet: ett bordshopp utan glapp på babordsrakan efter fören
      // (genvägens påfart ligger nära, så långsamma bilar får rulla över)
      { at: [J2 + 8.5, Z], y: 0 },
      { at: [J2 + 5.5, Z], y: 0.06 },
      { at: [J2, Z], y: 0.46, linear: true },
      { at: [J2 - 1.4, Z], y: 0.42, linear: true },
      { at: [J2 - 6.5, Z], y: 0.15, linear: true },
      { at: [J2 - 12.5, Z], y: 0 },
    ],
    gaps: [{ from: [J, -Z], to: [J + 1.2, -Z] }],
    // Runt stäven lutar fördäcket inåt (doserad kurva)
    bank: [{ at: [61, 0], deg: 15, fade: 6 }],
    // Under promenadtaket håller däckshuset och blomlådorna bilarna kvar,
    // vid genvägens av- och påfart kistor på ytterkanten
    openings: [{ from: [8, Z], to: [-24, Z] }, { from: [28, -Z], to: [44, -Z] }, { from: [44, Z], to: [30, Z] }],
    // Genväg tvärs över fördäcket genom förpikens tunnel (skär av stäven)
    shortcuts: [{
      from: [27, -Z], to: [31, Z],
      via: [[38, -9.4], [45.5, -7.4], [FX, -2.6], [FX, 2.6], [45.5, 7.4], [38, 9.4]],
      r: 7, roadHalf: 1.35, ai: 0.35,
      // Inga vallar där genvägen delar sig från banan (däcket bär bilarna)
      gaps: [{ from: [27.3, -10.95], to: [42.5, -8.2] }, { from: [42.5, 8.2], to: [31.3, 10.95] }],
    }],
  },
  trackTheme: {
    road: '#8a5a32', roadRough: 0.4, side: '#ece8df', pillar: '#e8e4dc',
    barrierA: 0xc8302c, barrierB: 0xf4f1ea,
  },

  statics: [],
  props: [],

  environment({ scene, world, RAPIER, track }) {
    makeSea(scene, { sunDir: SUN });
    makeHull(scene, world, RAPIER, { pool: POOL });
    makeSuperstructure(scene, world, RAPIER);
    addPortholes(scene, { pts: HOUSE.deck1.pts, y: 1.55, spacing: 2.2, skip: [-30, -18, -6, 6, 17].map((x) => [x, 0.9]) });
    addLane(scene, track);

    // Genvägen genom förpiken: egen plankväg och en täckt passage över mitten
    for (const sc of track.shortcuts) {
      const path = sc.path;
      addLane(scene, path);
      let i0 = -1, i1 = -1;
      for (let i = 0; i < path.N - 1; i++) if (Math.abs(path.pts[i].z) < 6.6) { if (i0 < 0) i0 = i; i1 = i; }
      if (i0 >= 0) addForepeak(scene, world, RAPIER, path, { i0, i1 });
    }

    // Kaptenens hörna vid starten: podium, jätteankare och tågvirke
    addCaptainsCorner(scene, world, RAPIER, {
      x: 30.6, z: -15.0,
      anchor: { x: 35.6, z: -15.4, s: 1.25, lean: 0.12, chainTo: [38.6, 0.05, -13.6] },
      coils: [{ x: 28.4, z: -15.6, r: 0.55 }, { x: 33.3, z: -16.0, r: 0.42, layers: 4 }],
    });
    // Bagage längs styrbords ytterkant
    addLuggage(scene, world, RAPIER, [
      { x: -19, z: -15.4, seed: 3, rot: 0.05 }, { x: 0.8, z: -15.6, seed: 8, rot: -0.04, w: 2.6 },
      { x: -40.5, z: 15.0, seed: 5, rot: 0.1, w: 1.8 },
    ]);
    // Under promenadtaket (utan vallar): blomlådor mellan stolparna och
    // flytvästkistor längs däckshuset håller bilarna kvar
    {
      const planters = [], chests = [];
      for (let x = HOUSE.promenade.x0 + 2.5; x < 8; x += 4) planters.push({ x, z: 13.75, len: 3.3 });
      for (const [x0, x1] of [[-29.2, -18.8], [-17.2, -6.8], [-5.2, 5.2], [6.8, 16.2]]) chests.push({ x: (x0 + x1) / 2, z: 7.8, len: x1 - x0 - 0.4 });
      // Vid genvägens av- och påfart saknas vallar: kistor på ytterkanten
      for (const sz of [-1, 1]) chests.push({ x: sz < 0 ? 33.8 : 36, z: sz * (Z + track.roadHalf + 0.3 + 0.25), len: sz < 0 ? 20.4 : 18 });
      addDeckEdges(scene, world, RAPIER, { planters, chests });
    }

    // Relingar: skrovkanten (med kolliders), akterdäckets framkant, båtdäck,
    // soldäck och promenadtaket
    const inset = (pts) => offsetPolyline(pts, -0.12);
    const { sunX, sunY } = SHIP;
    const w0 = halfWidth(sunX) - 0.12;
    const P = HOUSE.promenade;
    const rails = [
      { pts: inset(hullEdge(sunX, SHIP.tip)), y: 0, collider: true },
      { pts: inset(hullEdge(sunX, SHIP.stern0 - SHIP.sternLen)), y: sunY, collider: true },
      { pts: [[sunX + 0.15, -8.9], [sunX + 0.15, 8.9]], y: sunY, collider: true },
      { pts: [[sunX + 0.15, 13.1], [sunX + 0.15, w0]], y: sunY, collider: true },
      { pts: [[sunX + 0.15, -13.1], [sunX + 0.15, -w0]], y: sunY, collider: true },
      { pts: [[20, -7.38], [-33.88, -7.38], [-33.88, 7.38], [P.x0, 7.38]], y: 2.8 },
      { pts: [[P.x0, P.z0], [P.x0, P.z1 - 0.1], [P.x1, P.z1 - 0.1], [P.x1, P.z0]], y: P.y + 0.18 },
      { pts: [[10, -6.4], [-29.9, -6.4], [-29.9, 6.4], [10, 6.4]], y: 5.4 },
    ];
    makeRailings(scene, world, RAPIER, rails);

    // Livbåtar: styrbord hänger över banan, babord utanför promenaden
    const boats = [];
    for (const x of [-26, -18, -10, -2, 6]) boats.push({ x, z: -10, y: 3.75, davitZ: -7.05, deckY: 2.8 });
    for (const x of [-24, -16, -8, 0, 8]) boats.push({ x, z: 15.9, y: 3.75, davitZ: 14.1, deckY: P.y + 0.18 });
    addLifeboats(scene, boats);

    // Solstolar
    const chairs = [];
    const row = (x0, x1, z, rot, y = 0, step = 1.3) => { for (let x = x0; x <= x1 + 1e-6; x += step) chairs.push({ x, z, y, rot }); };
    row(-26.6, -20.1, 15.4, 0); row(-17.2, -10.7, 15.4, 0); row(-6.3, 1.5, 15.4, 0); row(4.6, 14, 15.4, 0);
    row(-31, -24.5, -15.45, Math.PI); row(-14, -6.2, -15.45, Math.PI); row(9, 20.7, -15.45, Math.PI);
    row(-50.3, -46.4, 6.45, Math.PI, sunY); row(-50.3, -46.4, -6.45, 0, sunY);
    row(-28.5, -23.3, 4.4, 0, 5.4); row(-28.5, -23.3, -4.4, Math.PI, 5.4);
    addDeckChairs(scene, world, RAPIER, chairs);

    // Livbojar längs relingen (var fjortonde meter) och på promenadens stolpar
    const rings = [];
    const edge = inset(hullEdge(sunX, SHIP.tip));
    let acc = 7;
    for (let i = 1; i < edge.length; i++) {
      const [x, z, nx, nz] = edge[i];
      acc += Math.hypot(x - edge[i - 1][0], z - edge[i - 1][1]);
      if (acc < 14 || Math.abs(x - 60) < 9) continue;
      acc = 0;
      rings.push({ x: x - nx * 0.1, y: 0.72, z: z - nz * 0.1, rot: Math.atan2(-nx, -nz) });
    }
    for (const x of [-19.5, -3.5, 12.5]) rings.push({ x, y: 1.4, z: P.posts - 0.13, rot: Math.PI });
    addLifeRings(scene, rings);

    addDeckGear(scene, world, RAPIER, {
      bollards: [
        { x: 40, z: 14.2 }, { x: 40, z: -14.2 }, { x: 24, z: 15.4 }, { x: 24, z: -15.4 },
        { x: -38, z: 15.3 }, { x: -38, z: -15.3 }, { x: -58.3, z: 0, y: sunY, rot: Math.PI / 2 },
      ],
      coils: [{ x: 42.3, z: 14.4 }, { x: 42.3, z: -14.4 }, { x: -35.8, z: 15.4 }, { x: -35.8, z: -15.4 }],
      vents: [
        { x: 40, z: 5, rot: Math.PI }, { x: 40, z: -5, rot: Math.PI }, { x: 28.5, z: 5.6, rot: Math.PI }, { x: 28.5, z: -5.6, rot: Math.PI },
        { x: -10, z: 4.4, y: 5.4, h: 1.6, rot: Math.PI }, { x: -10, z: -4.4, y: 5.4, h: 1.6, rot: Math.PI },
        { x: 4, z: 4.6, y: 5.4, h: 1.2 }, { x: 4, z: -4.6, y: 5.4, h: 1.2 },
      ],
      hatches: [{ x: 34, z: 0, w: 6, d: 4.4 }],
      masts: [{ x: 54.5, z: 0, h: 13 }],
      windlass: { x: 51.2, z: 0 },
      flag: { x: -59.2, z: 0, y: sunY },
      bunting: [
        { from: [54.5, 13, 0], to: [14, 12.4, 0], sag: 1.9 },
        { from: [54.5, 13, 0], to: [75.2, 1.15, 0], sag: 0.5 },
      ],
    });

    // Badbollar som bilarna kan putta runt
    const loose = [];
    loose.push(addBeachBall(scene, world, RAPIER, { x: -47, z: -7.6, y: sunY, r: 0.3 }));
    loose.push(addBeachBall(scene, world, RAPIER, { x: 37, z: 6.8, r: 0.32 }));
    return loose.filter((p) => p && p.body);
  },
};
