import {
  makeLawn, makeGravelPath, addStoneWalls, stairs, waterRims, makeWater, makePaving, addBridgeFacade,
  greenhouseBase, makeGreenhouse, addPlants, addHedges, addBenches, addLoosePot,
  addPergola, addPlankKicker, addFlowerBed, addGardenTools, addSteppingStones,
} from './gardenArt.js';
import { rng, edgeSegments } from './warehouseArt.js';

// ---------------------------------------------------------------------------
// Nivå: Trädgården. Botanisk trädgård under ett växthustak i riktig skala
// (meter). Grusgång genom gräsmattor, krukor, palmer och häckar. Banan går
// över en kanal på en stenbro och hoppar över en ränna på vänsterrakan.
// ---------------------------------------------------------------------------

export const tradgarden = {
  id: 'tradgarden',
  name: 'Trädgården',
  laps: 3,
  sky: 0xbfe3ff,
  fog: { near: 45, far: 150, color: 0xd6ecf5 },
  floor: { size: 86 },
  walls: { height: 6 },

  track: {
    scale: 1,
    roadHalf: 1.7,
    spacing: 0.6,
    checkpoints: 22,
    barrierHeight: 0.16,
    barrierThick: 0.12,
    start: { x: -14, z: -30 },
    corners: [
      { x: 8, z: -30, r: 7 },
      { x: 31, z: -14, r: 6 },
      { x: 31, z: 30, r: 7 },
      { x: 4, z: 30, r: 6 },
      { x: -4, z: 12, r: 6 },
      { x: -16, z: 22, r: 6 },
      { x: -31, z: 18, r: 6 },
      { x: -31, z: -30, r: 7 },
    ],
    elevation: [
      // Gräskullen på diagonalen mot östra kurvan: uppför, krön, nedför
      { at: [11.5, -27.9], y: 0 },
      { at: [16.5, -24.4], y: 0.6 },
      { at: [21.5, -20.9], y: 0 },
      // Stenbron över kanalen på högerrakan
      { at: [31, -7], y: 0 },
      { at: [31, 2.5], y: 0.9 },
      { at: [31, 8.5], y: 0.9 },
      { at: [31, 18], y: 0 },
      // Hoppet över rännan på vänsterrakan
      { at: [-31, 1], y: 0 },
      { at: [-31, -2], y: 0.06 },
      { at: [-31, -7.5], y: 0.46, linear: true },
      { at: [-31, -8.7], y: 0.32, linear: true },
      { at: [-31, -11.5], y: 0.14, linear: true },
      { at: [-31, -17], y: 0 },
    ],
    gaps: [{ from: [-31, -7.5], to: [-31, -8.7] }],
    // Hårnålen i V:ets botten ligger i en sluttande gräsvall (doserad)
    bank: [{ at: [-4, 12], deg: 15, fade: 6 }],
    // Pergolan efter starten och genvägens av- och påfart saknar vallar:
    // där står klippta buxbomshäckar i stället.
    openings: [
      { from: [-9.5, -30], to: [2.5, -30] },
      { from: [10, 30], to: [1.2, 23.5] },
      { from: [-14, 20.5], to: [-31, 11] },
    ],
    // Genvägen rakt över V:et: av norra rakan där banan svänger ner, över en
    // plankramp och en blomsterrabatt, genom en lucka i häcken och in på
    // rakan mot västra kurvan. Raka bitar närmast huvudbanan är bara gräs
    // (glapp i genvägens väg) så att dess vallar aldrig hamnar på huvudbanan.
    shortcuts: [{
      from: [8, 30], via: [[-4, 28.8], [-15, 27.8]], to: [-24, 19.8], r: 6, roadHalf: 1.2, ai: 0.35,
      elevation: [
        { at: [-0.95, 29.1], y: 0 },
        { at: [-3.94, 28.8], y: 0.28, linear: true },
        { at: [-4.9, 28.66], y: 0.01 },
      ],
      gaps: [{ from: [8, 30], to: [1, 29.3] }, { from: [-3.94, 28.8], to: [-4.9, 28.66] }, { from: [-18.6, 24.6], to: [-24, 19.8] }],
    }],
  },

  trackTheme: { road: '#b6a584', roadRough: 0.92, side: 0x5a5850, pillar: 0x8a857a, barrierA: 0xaaa496, barrierB: 0x938e81 },
  skyGradient: [0x2f7fd8, 0xa9d6f6, 0xe6f2e2],
  lighting: {
    sun: { color: 0xfff0d4, intensity: 2.7, offset: [12, 28, 8] },
    hemi: { sky: 0xd9edff, ground: 0x5d7c3a, intensity: 0.95 },
    exposure: 1.08,
    envIntensity: 0.6,
  },

  statics: [],
  props: [],

  environment({ scene, world, RAPIER, track }) {
    return buildGarden({ scene, world, RAPIER, track });
  },
};

const SIZE = 86;
const POND = { x: 8, z: 5.5, r: 4.5 };
const CHANNEL = { z: 5.5, half: 1.5, x1: 39, bridgeX: 31 };

function buildGarden({ scene, world, RAPIER, track }) {
  const r = rng(77);
  const clearance = track.roadHalf + track.barrier.thick;
  const sc = track.shortcuts[0]?.path;
  const roadDist = (x, z) => Math.min(Math.sqrt(track.nearest(x, z).d2), sc ? Math.sqrt(sc.nearest(x, z).d2) + track.roadHalf - sc.roadHalf : Infinity);
  const offRoad = (x, z, rad = 0.3) => roadDist(x, z) > clearance + rad + 0.35;

  makeLawn(scene, world, RAPIER, { size: SIZE });
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
  }));
  const terrace = { x: -19, z: 0, w: 8, d: 8, h: 0.5, top: 'pave' };
  const walls = [
    ...greenhouseBase(SIZE, 0.8), ...beds, ...islands, terrace,
    ...stairs({ x: terrace.x + terrace.w / 2, z: terrace.z, h: terrace.h, width: 2.6 }),
    ...waterRims({ pond: POND, channel: CHANNEL }),
  ];
  addStoneWalls(scene, world, RAPIER, walls);

  // Ligger punkten på en mur, bädd eller i vattnet?
  const blocked = (x, z, pad = 0.2) => {
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.5 + pad) return true;
    if (x > POND.x && x < CHANNEL.x1 + 0.6 && Math.abs(z - CHANNEL.z) < CHANNEL.half + 0.4 + pad) return true;
    return walls.some((W) => {
      const c = Math.cos(W.rotY ?? 0), s = Math.sin(W.rotY ?? 0);
      const dx = x - W.x, dz = z - W.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return Math.abs(lx) < W.w / 2 + pad && Math.abs(lz) < W.d / 2 + pad;
    });
  };

  // --- vatten och bro ------------------------------------------------------
  makeWater(scene, { pond: POND, channel: CHANNEL });
  makePaving(scene, { x: POND.x, z: POND.z, r0: POND.r + 0.3, r1: POND.r + 1.9 });
  addBridgeFacade(scene, track, { at: [CHANNEL.bridgeX, CHANNEL.z], archAt: [CHANNEL.bridgeX, CHANNEL.z], span: 2.15, rise: 0.58 });

  // --- växter ----------------------------------------------------------------
  const pots = [], bushes = [], ferns = [], flowers = [], palms = [], cypress = [], topiary = [];
  let seed = 1;
  const palm = (x, z, y = 0, h = 5 + r() * 3) => palms.push({ x, z, y, h, seed: seed++ });
  const scatter = (x, z, y, s = 1) => {
    const k = r();
    (k < 0.4 ? ferns : k < 0.72 ? bushes : flowers).push({ x, z, y, s: s * (0.8 + r() * 0.5) });
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
      if (r() < 0.55) flowers.push({ x, z, y: W.h, s: 0.9 + r() * 0.4 });
      else scatter(x, z, W.h);
    }
    palm(W.x, W.z, W.h, 6 + r() * 2);
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
  for (const [x, z, h] of [[1.5, 10, 7], [15, 13, 6.5], [2.5, -2, 6], [21, -2, 7.5], [-7, -12, 8], [-36.5, -36.5, 8.5], [36.5, -36.5, 7], [36.5, 36.5, 8], [-36.5, 36.5, 7.5], [-2, 34, 6]]) {
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
      skip = track.pts[j].y > 0.02 || track.isGap[j] || track.isOpen[j];
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
      hedges.push({ x: mx, z: mz, w: Math.hypot(bx - ax, bz - az), d: 0.55, h: 0.62, rotY: -Math.atan2(bz - az, bx - ax) });
    }
  };
  hedgeLine(-26, -33.8, 5, -33.8);
  hedgeLine(-34.8, -25, -34.8, 13);
  hedgeLine(8, 26.2, 26, 26.2);
  hedgeLine(27.2, -7, 27.2, 2);
  hedgeLine(27.2, 9.5, 27.2, 22);
  hedgeLine(-26, -26.2, -6, -26.2);
  // Låga klippta häckar som kant där banan saknar vallar
  const edgeHedge = (from, to, side) => {
    for (const e of edgeSegments(track, from, to, { side, offset: track.roadHalf + 0.28, step: 1.2 })) {
      const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
      hedges.push({ x: (e.ax + e.bx) / 2, z: (e.az + e.bz) / 2, w: len + 0.12, d: 0.42, h: 0.46, rotY: -Math.atan2(e.bz - e.az, e.bx - e.ax) });
    }
  };
  edgeHedge([-9.5, -30], [2.5, -30], 0);
  edgeHedge([10, 30], [1.2, 23.5], -1);
  edgeHedge([-14, 20.5], [-31, 11], -1);
  edgeHedge([-14, 20.5], [-18.6, 21.3], 1);
  edgeHedge([-25, 19.6], [-31, 11], 1);
  // Luckan i häcken som genvägen går igenom
  hedges.push({ x: -5.5, z: 24.7, w: 3.8, d: 0.55, h: 0.75, rotY: -Math.PI / 2 }, { x: -5.5, z: 32.6, w: 3.8, d: 0.55, h: 0.75, rotY: -Math.PI / 2 });
  addHedges(scene, world, RAPIER, hedges);

  // Pergolan med klätterrosor efter starten
  addPergola(scene, world, RAPIER, { ax: -9, az: -30, bx: 2, bz: -30, clear: 2.62, h: 2.05, flowers, bushes, seed: 4 });

  // Genvägen: plankramp och blomsterrabatt under hoppet
  if (sc) {
    let k0 = -1, k1 = -1;
    for (let i = 0; i < sc.N - 1; i++) {
      if (!sc.isGap[i] && sc.pts[i].y > 0.005 && k0 < 0) k0 = Math.max(0, i - 1);
      if (!sc.isGap[i] && sc.isGap[i + 1] && sc.pts[i].y > 0.1) k1 = i;
    }
    if (k0 >= 0 && k1 > k0) {
      addPlankKicker(scene, sc, k0, k1);
      const e = sc.pts[k1], t = sc.tangents[k1];
      addFlowerBed(scene, { x: e.x + t.x * 0.75, z: e.z + t.z * 0.75, w: 1.0, d: 2.2, rotY: -Math.atan2(t.z, t.x), flowers });
    }
    // Trampstenar där genvägen bara är gräs (utanför huvudbanan)
    const lawn = [];
    let from = -1;
    for (let i = 0; i < sc.N - 1; i++) {
      const p = sc.pts[i];
      const free = sc.isGap[i] && p.y < 0.02 && Math.sqrt(track.nearest(p.x, p.z).d2) > track.roadHalf + 0.5;
      if (free && from < 0) from = i;
      if (!free && from >= 0) { lawn.push([from, i - 1]); from = -1; }
    }
    if (from >= 0) lawn.push([from, sc.N - 2]);
    addSteppingStones(scene, sc, lawn);
  }

  // Starten: skottkärra, vattenkanna och jordsäckar vid gången
  addGardenTools(scene, world, RAPIER, { x: -18.2, z: -27.25, rot: Math.PI / 2 });

  addPlants(scene, world, RAPIER, { pots, bushes, ferns, flowers, palms, cypress, topiary });
  addBenches(scene, world, RAPIER, [
    { x: T.x - 1.8, z: T.z, y: T.h, rotY: Math.PI / 2 },
    { x: POND.x, z: POND.z - (POND.r + 1.1), rotY: 0 },
    { x: POND.x - (POND.r + 1.1), z: POND.z, rotY: Math.PI / 2 },
    { x: POND.x, z: POND.z + POND.r + 1.1, rotY: Math.PI },
  ]);

  // Lösa krukor i kurvornas ytterkant
  const loose = [];
  for (const [cp, s] of [[2, -1], [5, 1], [9, 1], [13, -1]]) {
    const c = track.checkpoints[cp];
    const pose = track.poseAt(c.index, s * (track.roadHalf + 0.55));
    if (track.pts[c.index].y > 0.02 || track.isOpen[c.index] || !offRoad(pose.x, pose.z, -0.2) || blocked(pose.x, pose.z, 0.2)) continue;
    if (pots.some((p) => Math.hypot(p.x - pose.x, p.z - pose.z) < 1)) continue;
    loose.push(addLoosePot(scene, world, RAPIER, { x: pose.x, z: pose.z }));
  }
  return loose;
}
