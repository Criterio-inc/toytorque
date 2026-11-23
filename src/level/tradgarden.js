import {
  makeLawn, makeGravelPath, addStoneWalls, stairs, waterRims, makeWater, makePaving, addBridgeFacade,
  greenhouseBase, makeGreenhouse, addPlants, addHedges, addBenches, addLoosePot,
  addPergola, addGardenTools,
} from './gardenArt.js';
import { addStoneBridge } from './stoneBridge.js';
import { rng } from './warehouseArt.js';

// ---------------------------------------------------------------------------
// Nivå: Trädgården. Botanisk trädgård under ett växthustak i riktig skala
// (meter). En slingrig grusgång genom gräsmattor, krukor, palmer och häckar,
// utan kantvallar: gången kantas av gräs, och i kurvorna står låga häckar.
// Banan går över en kanal på en stenbro och hoppar över en ränna på
// vänsterrakan.
// ---------------------------------------------------------------------------

export const tradgarden = {
  id: 'tradgarden',
  name: 'Trädgården',
  layout: 3, // terräng och bro sedan 2026-11-23: äldre spökbilar gäller inte
  laps: 3,
  sky: 0xbfe3ff,
  fog: { near: 45, far: 150, color: 0xd6ecf5 },
  floor: { size: 86 },
  walls: { height: 6 },

  track: {
    scale: 1,
    roadHalf: 1.7,
    spacing: 0.6,
    checkpoints: 24,
    barrierHeight: 0.2,
    barrierThick: 0.14,
    lineMargin: 0.8,
    start: { x: -32, z: -2 },
    // En åtta genom palmhuset. Västra rakan (start) norrut, en lång diagonal
    // ner genom hålvägen i mitten, upp över terrassen i öster och tillbaka
    // över stenbron, som går över hålvägen.
    corners: [
      { x: -32, z: 30, r: 7 },
      { x: -6, z: 13, r: 7 },
      { x: 6, z: -5, r: 7 },
      { x: 32, z: -34, r: 6 },
      { x: 32, z: 28, r: 7 },
      { x: -32, z: -31, r: 7 },
    ],
    // Marken: terrassen i öster (platt överst, brant gräsbank mot väster),
    // hålvägen där diagonalen sänker sig under bron, och en låg kulle i
    // nordväst som hårnålen ligger i.
    terrain: {
      hills: [
        { terrace: true, x: 32, z: -4, ax: 7, az: 22, ex: 2.6, ez: 15, h: 2.6 },
        { x: 2.3, z: 0.6, rx: 15, rz: 5.5, rot: 0.98, h: -1.3 },
        { x: -26, z: 31, r: 9, h: 0.9 },
        { x: -6, z: 30, r: 8, h: 0.6 },
        { x: 18, z: -22, r: 9, h: 0.7 },
      ],
      blend: 4,
    },
    // Stenbron på diagonalen tillbaka, över hålvägen
    bridges: [{ from: [10.5, 8.2], to: [-6, -7.03] }],
    elevation: [
      { at: [18, 15.1], y: 0 },
      { at: [6.5, 4.5], y: 1.2 }, // inte i själva korsningen: där ligger två vägbitar
      { at: [-2, -3.34], y: 1.2 },
      { at: [-13, -13.5], y: 0 },
    ],
    bank: [{ at: [-34, 32], deg: 16, fade: 4 }, { at: [-34, -33], deg: 20, fade: 4 }],
    freeRoam: true,
    checkpointHalf: 6,
  },

  trackTheme: { road: '#b6a584', roadRough: 0.92, side: 0x5a5850, pillar: 0x8a857a, barrierA: 0xaaa496, barrierB: 0x938e81, embank: 0x6f8c48 },
  skyGradient: [0x2f7fd8, 0xa9d6f6, 0xe6f2e2],
  skyDome: { top: 0x1560cc, horizon: 0x8cc6f4, cloud: 0xffffff, cloudShade: 0x93a9c8, coverage: 0.5 },
  lighting: {
    sun: { color: 0xffecc8, intensity: 3.3, offset: [16, 20, 10] },
    hemi: { sky: 0xaecfff, ground: 0x4f6c32, intensity: 0.5 },
    shadow: { range: 24, size: 3072 },
    exposure: 1.08,
    envIntensity: 0.6,
  },

  statics: [],
  props: [],

  evening: true, // banan har en kvällsvariant (level/evening.js), väljs med ◀▶ i banvalet
  environment({ scene, world, RAPIER, track }) {
    return buildGarden({ scene, world, RAPIER, track });
  },
};

const SIZE = 86;
const POND = { x: -18, z: 3, r: 4.5 };

function buildGarden({ scene, world, RAPIER, track }) {
  const r = rng(77);
  const clearance = track.roadHalf + track.barrier.thick;
  const roadDist = (x, z) => Math.sqrt(track.nearest(x, z).d2);
  const offRoad = (x, z, rad = 0.3) => roadDist(x, z) > clearance + rad + 0.35;
  // Markhöjd: allt som står på gräsmattan lyfts upp på terrängen
  const gy = (x, z) => track.ground.heightAt(x, z);
  const flat = (x, z, w, d, tol = 0.12) => {
    const hs = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([a, b]) => gy(x + a * w / 2, z + b * d / 2));
    return Math.max(...hs) - Math.min(...hs) < tol;
  };

  makeLawn(scene, world, RAPIER, { size: SIZE, ground: track.ground });
  makeGreenhouse(scene, world, RAPIER, { size: SIZE, eave: 6, crown: 15.5 });
  makeGravelPath(scene, track);

  // --- murar, bäddar och terrasser -----------------------------------------
  const B = 0.7, E = SIZE / 2 - 0.4; // bäddhöjd längs glasväggarna, insidan av sockeln
  const beds = [
    { x: 0, z: -(E - 1.6), w: E * 2, d: 3.2, h: B, top: 'soil' },
    { x: 0, z: E - 1.6, w: E * 2, d: 3.2, h: B, top: 'soil' },
    { x: -(E - 1.6), z: 0, w: 3.2, d: E * 2 - 6.4, h: B, top: 'soil' },
    { x: E - 1.6, z: 0, w: 3.2, d: E * 2 - 6.4, h: B, top: 'soil' },
  ];
  const islands = [
    { x: 17, z: -12, w: 9, d: 4.5, h: 0.55, rotY: -0.61, top: 'soil' },
    { x: -17, z: -19, w: 10, d: 5, h: 0.55, top: 'soil' },
    { x: 19, z: 18, w: 10, d: 4.5, h: 0.55, top: 'soil' },
    { x: -13, z: 33, w: 13, d: 4.5, h: 0.6, top: 'soil' },
    { x: -3, z: -19, w: 6, d: 3, h: 0.35, top: 'soil' },
    { x: 0, z: -4, w: 3.5, d: 3.5, h: 0.35, rotY: 0.78, top: 'soil' },
    { x: -21, z: 13, w: 5, d: 2.6, h: 0.35, rotY: 0.2, top: 'soil' },
    { x: 20, z: 34.5, w: 14, d: 2.8, h: 0.45, top: 'soil' },
    { x: -36.5, z: -6, w: 2.6, d: 10, h: 0.45, top: 'soil' },
    { x: 36.2, z: -24, w: 2.6, d: 10, h: 0.45, top: 'soil' },
  ].filter((W) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, b]) => {
    const c = Math.cos(W.rotY ?? 0), s = Math.sin(W.rotY ?? 0), u = a * W.w / 2, v = b * W.d / 2;
    return offRoad(W.x + u * c + v * s, W.z - u * s + v * c, 0.6);
  })).filter((W) => flat(W.x, W.z, W.w, W.d)).map((W) => ({ ...W, y: gy(W.x, W.z) - 0.05 }));
  const terrace = { x: 6, z: 26, w: 8, d: 8, h: 0.5, top: 'pave' };
  const walls = [
    ...greenhouseBase(SIZE, 0.8), ...beds, ...islands, terrace,
    ...stairs({ x: terrace.x + terrace.w / 2, z: terrace.z, h: terrace.h, width: 2.6 }),
    ...waterRims({ pond: POND }),
  ];
  addStoneWalls(scene, world, RAPIER, walls);

  // Ligger punkten på en mur, bädd eller i vattnet?
  const blocked = (x, z, pad = 0.2) => {
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.5 + pad) return true;
    return walls.some((W) => {
      const c = Math.cos(W.rotY ?? 0), s = Math.sin(W.rotY ?? 0);
      const dx = x - W.x, dz = z - W.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return Math.abs(lx) < W.w / 2 + pad && Math.abs(lz) < W.d / 2 + pad;
    });
  };

  // --- vatten och bro ------------------------------------------------------
  makeWater(scene, { pond: POND });
  makePaving(scene, { x: POND.x, z: POND.z, r0: POND.r + 0.3, r1: POND.r + 1.9 });
  addStoneBridge(scene, world, RAPIER, track);

  // --- växter ----------------------------------------------------------------
  const pots = [], bushes = [], ferns = [], flowers = [], palms = [], cypress = [], topiary = [];
  let seed = 1;
  // onBed: y är redan bäddens höjd över havet (öarna), annars räknas y från marken
  const palm = (x, z, y = 0, h = 5 + r() * 3, onBed = false) => palms.push({ x, z, y, h, seed: seed++, onBed });
  const scatter = (x, z, y, s = 1, onBed = false) => {
    const k = r();
    (k < 0.4 ? ferns : k < 0.72 ? bushes : flowers).push({ x, z, y, s: s * (0.8 + r() * 0.5), onBed });
  };

  // Bäddarna längs glasväggarna: palmer, cypresser och tät grönska
  for (const W of beds) {
    const along = W.w > W.d ? 'x' : 'z', L = Math.max(W.w, W.d), D = Math.min(W.w, W.d);
    for (let t = -L / 2 + 0.5; t < L / 2 - 0.4; t += 0.75) {
      for (let k = 0; k < 3; k++) {
        const u = t + (r() - 0.5) * 0.5, v = (k - 1) * D * 0.3 + (r() - 0.5) * 0.4;
        const [x, z] = along === 'x' ? [W.x + u, W.z + v] : [W.x + v, W.z + u];
        scatter(x, z, B, 1.15);
      }
    }
    for (let t = -L / 2 + 5; t < L / 2 - 3; t += 10 + r() * 3) {
      const v = (r() - 0.5) * D * 0.3;
      const [x, z] = along === 'x' ? [W.x + t, W.z + v] : [W.x + v, W.z + t];
      palm(x, z, B, 6 + r() * 4);
      const [cx, cz] = along === 'x' ? [W.x + t + 5, W.z - Math.sign(W.z) * 0.3] : [W.x - Math.sign(W.x) * 0.3, W.z + t + 5];
      if (r() < 0.7 && Math.abs(along === 'x' ? cx : cz) < L / 2 - 1) cypress.push({ x: cx, z: cz, y: B, h: 3.5 + r() * 2 });
    }
  }
  // Öarna i gräsmattan: blommor och buskar, en palm i mitten
  for (const W of islands) {
    const c = Math.cos(W.rotY ?? 0), s = Math.sin(W.rotY ?? 0);
    for (let u = -W.w / 2 + 0.5; u < W.w / 2 - 0.3; u += 0.7) for (let v = -W.d / 2 + 0.5; v < W.d / 2 - 0.3; v += 0.8) {
      const lu = u + (r() - 0.5) * 0.3, lv = v + (r() - 0.5) * 0.3;
      const x = W.x + lu * c + lv * s, z = W.z - lu * s + lv * c;
      if (r() < 0.55) flowers.push({ x, z, y: W.h + W.y, s: 0.9 + r() * 0.4, onBed: true });
      else scatter(x, z, W.h + W.y, 1, true);
    }
    palm(W.x, W.z, W.h + W.y, 6 + r() * 2, true);
  }

  // Terrassen: bänk, krukor med klotbuxbom och cypresser vid trappan
  const T = terrace;
  for (const sz of [1, -1]) {
    pots.push({ x: T.x - 3.2, z: T.z + sz * 3.2, y: T.h, s: 1.8, plant: 'ball' });
    pots.push({ x: T.x + T.w / 2 + 1.5, z: T.z + sz * 1.9, s: 1.4, plant: 'cone' });
    cypress.push({ x: T.x + T.w / 2 - 0.6, z: T.z + sz * 3.2, y: T.h, h: 3.4 });
  }
  palm(T.x - 2.5, T.z, T.h, 8);

  // Palmer i gräsmattan med ormbunkar runt foten
  for (const [x, z, h] of [[-8, -20, 8], [14, -12, 7], [20, 12, 6.5], [-22, 16, 7], [-36.5, -36.5, 8.5], [36.5, -36.5, 7], [36.5, 36.5, 8], [-36.5, 36.5, 7.5], [18, 34, 6], [-10, -34, 6], [34, -6, 7.5]]) {
    if (!offRoad(x, z, 1.2)) continue;
    palm(x, z, 0, h);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + r(), d = 0.6 + r() * 0.6;
      ferns.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, y: 0, s: 0.8 + r() * 0.5 });
    }
  }

  // Buskage utspridda i gräsmattan
  for (let k = 0, made = 0; k < 400 && made < 70; k++) {
    const x = (r() - 0.5) * (SIZE - 10), z = (r() - 0.5) * (SIZE - 10);
    if (!offRoad(x, z, 1.4) || blocked(x, z, 1.2)) continue;
    made++;
    const big = r() < 0.25;
    if (big) palm(x, z, 0, 5 + r() * 3.5);
    for (let j = 0, m = 3 + Math.floor(r() * 5); j < m; j++) {
      const a = r() * Math.PI * 2, d = r() * 1.1;
      scatter(x + Math.cos(a) * d, z + Math.sin(a) * d, 0, big ? 1.1 : 0.9);
    }
  }

  // Blommor runt dammens plattor
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    if (Math.cos(a) > 0.75) continue;
    flowers.push({ x: POND.x + Math.cos(a) * (POND.r + 2.3), z: POND.z + Math.sin(a) * (POND.r + 2.3), y: 0, s: 0.9 + r() * 0.3 });
  }

  // Krukor längs grusgången, varannan sida
  const step = Math.round(6.5 / track.spacing);
  const kinds = ['flower', 'bush', 'fern', 'ball', 'flower', 'fern'];
  let side = 1, n = 0;
  for (let i = Math.round(8 / track.spacing); i < track.N - Math.round(5 / track.spacing); i += step) {
    side = -side;
    let skip = false;
    for (let k = -12; k <= 12 && !skip; k++) {
      const j = (i + k + track.N) % track.N;
      skip = track.isBridge[j] || track.isGap[j];
    }
    if (skip) continue;
    const pose = track.poseAt(i, side * (track.roadHalf + 0.75));
    const near = track.nearest(pose.x, pose.z);
    if (Math.abs(near.index - i) > 6 && Math.sqrt(near.d2) < clearance + 0.6) continue;
    if (blocked(pose.x, pose.z, 0.3)) continue;
    pots.push({ x: pose.x, z: pose.z, s: 1.05, plant: kinds[n++ % kinds.length] });
  }

  // Häckar utanför rakorna
  const hedges = [];
  const hedgeLine = (x0, z0, x1, z1, seg = 5.5) => {
    const len = Math.hypot(x1 - x0, z1 - z0), nseg = Math.max(1, Math.round(len / seg));
    for (let k = 0; k < nseg; k++) {
      const a = (k + 0.08) / nseg, b = (k + 0.92) / nseg;
      const ax = x0 + (x1 - x0) * a, az = z0 + (z1 - z0) * a, bx = x0 + (x1 - x0) * b, bz = z0 + (z1 - z0) * b;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (![[ax, az], [bx, bz], [mx, mz]].every(([x, z]) => offRoad(x, z, 0.5) && !blocked(x, z, 0.1))) continue;
      hedges.push({ x: mx, z: mz, y: Math.min(gy(ax, az), gy(bx, bz)) - 0.03, w: Math.hypot(bx - ax, bz - az), d: 0.55, h: 0.62, rotY: -Math.atan2(bz - az, bx - ax) });
    }
  };
  hedgeLine(-35.4, -22, -35.4, 4); // utanför startrakan
  hedgeLine(35.8, -10, 35.8, 2); // ytterkanten uppe på terrassen (innerkanten är banken)
  hedgeLine(-24, -36, -4, -36);
  // Naturliga kanter ytterst i kurvorna: en låg klippt buxbomshäck med en
  // rabatt framför. Den som tar kurvan för fort kör genom blommorna och
  // stannar i häcken i stället för mot en vall.
  {
    const { N, pts, normals, tangents, spacing, roadHalf } = track;
    const span = Math.round(3 / spacing), step2 = 2;
    const edgeAt = (i, side, off) => ({ x: pts[i].x + normals[i].x * off * side, z: pts[i].z + normals[i].z * off * side });
    const outside = (i) => {
      const a = tangents[(i - span + N) % N], b = tangents[(i + span) % N];
      const ang = Math.asin(Math.max(-1, Math.min(1, a.x * b.z - a.z * b.x)));
      return Math.abs(ang) / (2 * span * spacing) < 1 / 14 || track.isBridge[i] || track.embank?.[i] ? 0 : (ang > 0 ? 1 : -1);
    };
    const off = roadHalf + 2.3;
    for (let i = 0; i < N; i += step2) {
      const j = (i + step2) % N, side = outside(i);
      if (!side || outside(j) !== side) continue;
      const p = edgeAt(i, side, off), q = edgeAt(j, side, off);
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
      if (![p, q, { x: mx, z: mz }].every((c) => roadDist(c.x, c.z) > off - 0.3 && !blocked(c.x, c.z, 0.1))) continue;
      hedges.push({ x: mx, z: mz, y: Math.min(gy(p.x, p.z), gy(q.x, q.z)) - 0.03, w: Math.hypot(q.x - p.x, q.z - p.z) + 0.14, d: 0.42, h: 0.46, rotY: -Math.atan2(q.z - p.z, q.x - p.x) });
      const f = edgeAt(i, side, off - 0.7);
      flowers.push({ x: f.x, z: f.z, y: 0, s: 0.8 + r() * 0.3 });
    }
  }
  addHedges(scene, world, RAPIER, hedges);

  // Pergolan med klätterrosor efter starten
  addPergola(scene, world, RAPIER, { ax: -32, az: 7, bx: -32, bz: 18, clear: 2.62, h: 2.05, flowers, bushes, seed: 4 });

  // Starten: skottkärra, vattenkanna och jordsäckar vid gången
  addGardenTools(scene, world, RAPIER, { x: -29.2, z: -10, rot: 0 });

  for (const list of [pots, bushes, ferns, flowers, palms, cypress, topiary]) for (const p of list) if (!p.onBed) p.y = (p.y ?? 0) + gy(p.x, p.z);
  addPlants(scene, world, RAPIER, { pots, bushes, ferns, flowers, palms, cypress, topiary });
  addBenches(scene, world, RAPIER, [
    { x: T.x - 1.8, z: T.z, y: T.h, rotY: Math.PI / 2 },
    { x: POND.x, z: POND.z - (POND.r + 1.1), rotY: 0 },
    { x: POND.x - (POND.r + 1.1), z: POND.z, rotY: Math.PI / 2 },
    { x: POND.x, z: POND.z + POND.r + 1.1, rotY: Math.PI },
    { x: 37.2, z: -4, rotY: -Math.PI / 2 }, // utsikten från terrassen
  ].map((b) => ({ ...b, y: (b.y ?? 0) + gy(b.x, b.z) })));

  // Lösa krukor i kurvornas ytterkant
  const loose = [];
  for (const [cp, s] of [[2, -1], [5, 1], [9, 1], [13, -1]]) {
    const c = track.checkpoints[cp];
    const pose = track.poseAt(c.index, s * (track.roadHalf + 0.55));
    if (track.isBridge[c.index] || !offRoad(pose.x, pose.z, -0.2) || blocked(pose.x, pose.z, 0.2)) continue;
    if (pots.some((p) => Math.hypot(p.x - pose.x, p.z - pose.z) < 1)) continue;
    loose.push(addLoosePot(scene, world, RAPIER, { x: pose.x, z: pose.z, y: gy(pose.x, pose.z) }));
  }
  return loose;
}
