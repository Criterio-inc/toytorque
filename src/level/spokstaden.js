import {
  ArtBatch, makeDesertGround, addTrackDirt, addCreekBed, addBuilding, addMineTunnel, addWaterTower,
  addWindpump, addBarrel, addCrate, addWagonWheel, addHitchingPost, addCactus, addRock, addMesa,
  addScrub, addFence, addGraveCross, addWagon, addSignpost, addTumbleweed, rng,
  addBarnPassage, addStagecoach, addTrough, addHayBale, addRailFence,
} from './westernArt.js';
import { edgeSegments, edgeColliders, addPlankRamp } from './warehouseArt.js';

// ---------------------------------------------------------------------------
// Nivå: Spökstaden. Övergiven västernstad i riktig skala (meter). Starten
// ligger mitt på huvudgatan mellan fasaderna, sedan ut i öknen: ett hopp över
// den trasiga plankbron vid den torra bäcken, över en sandkulle in i en
// doserad sandvall och genom gruvtunneln i berget.
// ---------------------------------------------------------------------------

const ST = -16; // huvudgatans z
const BACK = 21; // bakre rakans z

export const spokstaden = {
  id: 'spokstaden',
  name: 'Spökstaden',
  laps: 3,
  sky: 0xe0bc92,
  skyGradient: [0x86aed4, 0xe6c49a, 0xd8ab7c],
  fog: { near: 30, far: 165, color: 0xdcb88e },
  lighting: {
    sun: { color: 0xffcf98, intensity: 2.5, offset: [-21, 13, 11] },
    hemi: { sky: 0xffe4bc, ground: 0x9a6a40, intensity: 0.85 },
    exposure: 1.0,
    envIntensity: 0.35,
  },
  floor: { size: 170 },

  trackTheme: {
    road: '#a8835a', roadRough: 0.97, side: '#6e4c2e', pillar: '#5a3d24',
    barrierA: '#6b4528', barrierB: '#98703f',
  },

  track: {
    scale: 1,
    roadHalf: 1.7,
    spacing: 0.6,
    checkpoints: 22,
    barrierHeight: 0.2,
    barrierThick: 0.12,
    start: { x: 0, z: ST },
    // Huvudgatan österut, upp längs östra kanten, bakre rakan västerut över
    // bäcken, ett S genom innerfältet och söderut genom gruvtunneln.
    corners: [
      { x: 42, z: ST, r: 7 },
      { x: 44, z: BACK, r: 7 },
      { x: 4, z: BACK, r: 6 },
      { x: -14, z: 10, r: 7 },
      { x: -46, z: BACK, r: 7 },
      { x: -44, z: ST, r: 7 },
    ],
    elevation: [
      // Plankbron över den torra bäcken: rak ramp ända ut i kanten, glapp, landning
      { at: [32, BACK], y: 0 },
      { at: [29, BACK], y: 0.06 },
      { at: [23.5, BACK], y: 0.46, linear: true },
      { at: [22.3, BACK], y: 0.32, linear: true },
      { at: [19.5, BACK], y: 0.14, linear: true },
      { at: [14, BACK], y: 0 },
      // Sandkullen i S:et: uppför, krön där bilarna lättar, och ner i den
      // doserade kurvan
      { at: [0.5, 18.8], y: 0 },
      { at: [-4.5, 15.8], y: 0.75 },
      { at: [-9, 13.1], y: 0.42 },
      { at: [-30, 15.6], y: 0 },
    ],
    gaps: [{ from: [23.5, BACK], to: [22.3, BACK] }],
    // Den doserade kurvan i S:et: en vall av packad sand
    bank: [{ at: [-14, 10], deg: 14, fade: 8 }],
    // Huvudgatan saknar kantvallar, liksom av- och påfarten till genvägen
    // (där står staket och höbalar i stället).
    openings: [
      { from: [-32, ST], to: [30, ST] },
      { from: [42.6, -10], to: [43.5, 6] },
      { from: [19.5, BACK], to: [0, 18.6] },
    ],
    // Genvägen genom ladan: av den östra rakan, in genom ladans portar och ut
    // på baksidan, över bäckfåran på en plankramp och upp på bakre rakan efter
    // hoppet. Raka bitar närmast huvudbanan är bara sand (glapp i genvägens
    // väg) så att dess vallar aldrig hamnar på huvudbanan.
    shortcuts: [{
      from: [42.8, -6], via: [[38.7, 9.45]], to: [10.5, BACK], r: 9, roadHalf: 1.2, ai: 0.35,
      elevation: [
        { at: [28.5, 13.6], y: 0 },
        { at: [26.2, 14.55], y: 0.2, linear: true },
        { at: [25.66, 14.77], y: 0.01 },
      ],
      gaps: [{ from: [42.8, -6], to: [40.2, 3.8] }, { from: [26.2, 14.55], to: [25.66, 14.77] }, { from: [18.35, 17.8], to: [10.5, BACK] }],
    }],
  },

  statics: [],
  props: [],

  environment({ scene, world, RAPIER, track }) {
    const B = scene ? new ArtBatch() : null;
    const loose = [];
    makeDesertGround(scene, world, RAPIER, { size: 170 });
    if (scene) {
      addTrackDirt(scene, track);
      addCreekBed(scene, { points: [[33, 92], [29, 70], [26, 52], [21, 38], [24, 28], [22.9, 21], [24.5, 16.5], [27.5, 12.5], [28.5, 8], [26.5, 3]] });
    }

    // Huvudgatan: södra raden (fronten mot +z) och norra raden (fronten mot -z)
    const south = [
      { x: -37, w: 9, h: 4.6, front: 6.6, sign: 'LIVERY STABLE', tint: [0.78, 0.5, 0.38], door: 'barn' },
      { x: -26.5, w: 6.5, h: 3.6, front: 5.4, sign: 'BARBER', tint: [0.72, 0.78, 0.82] },
      { x: -17, w: 9, h: 6.6, front: 8.4, sign: 'HOTEL', tint: [0.86, 0.8, 0.62], floors: 2, balcony: true },
      { x: -6.5, w: 7.5, h: 4.2, front: 6.4, sign: 'BANK', tint: [0.8, 0.76, 0.7], bars: true },
      { x: 3.5, w: 10, h: 6.8, front: 8.8, sign: 'SALOON', tint: [0.9, 0.62, 0.42], floors: 2, balcony: true, door: 'swing' },
      { x: 14.5, w: 9, h: 4.2, front: 6.6, sign: 'GENERAL STORE', tint: [0.68, 0.74, 0.62], shop: true },
      { x: 24.5, w: 6.5, h: 3.6, front: 5.2, tint: [0.85, 0.82, 0.76], boarded: true },
      { x: 33.5, w: 7.5, h: 3.8, front: 5.8, sign: 'SHERIFF', tint: [0.82, 0.7, 0.56], bars: true },
      { x: 43.5, w: 6, h: 3.4, front: 4.8, tint: [0.7, 0.66, 0.6], boarded: true },
    ];
    const north = [
      { x: -29.5, w: 7, h: 3.8, front: 5.8, sign: 'ASSAY OFFICE', tint: [0.86, 0.74, 0.6] },
      { x: -20.5, w: 6.5, h: 3.4, front: 5.0, tint: [0.66, 0.6, 0.55], boarded: true },
      { x: -11, w: 8.5, h: 6.4, front: 7.8, sign: 'HOTEL', tint: [0.62, 0.7, 0.78], floors: 2, balcony: true, boarded: true },
      { x: -0.5, w: 7, h: 4.0, front: 6.0, sign: 'BAKERY', tint: [0.9, 0.84, 0.7] },
      { x: 9.5, w: 8.5, h: 4.4, front: 6.8, sign: 'DRY GOODS', tint: [0.78, 0.56, 0.44], shop: true },
      { x: 19.5, w: 6.5, h: 3.6, front: 5.4, sign: 'UNDERTAKER', tint: [0.55, 0.52, 0.5] },
      { x: 28, w: 6.5, h: 3.6, front: 5.0, tint: [0.84, 0.76, 0.62], boarded: true },
    ];
    let seed = 1;
    for (const b of south) addBuilding(B, world, RAPIER, { ...b, z: ST - 8, rot: 0, seed: seed++ });
    for (const b of north) addBuilding(B, world, RAPIER, { ...b, z: ST + 8, rot: Math.PI, seed: seed++ });

    // Gatuliv: hästräcken, tunnor, lådor och vagnshjul vid trottoarerna
    for (const x of [-31, -21.5, 0, 9, 20, 29]) addHitchingPost(B, world, RAPIER, { x, z: ST - 4.6, rot: 0 });
    for (const x of [-25, -6, 14.5, 24]) addHitchingPost(B, world, RAPIER, { x, z: ST + 4.6, rot: 0 });
    for (const [x, z, s] of [
      [-33.2, ST - 5.1, 1], [-32.6, ST - 5.5, 1], [-1.6, ST - 5.2, 0], [8.6, ST - 5.3, 1], [18.9, ST - 5.0, 0],
      [-14.6, ST + 5.1, 1], [4.7, ST + 5.2, 0], [5.3, ST + 5.6, 1], [24.4, ST + 5.4, 0], [36.4, ST - 5.4, 1],
    ]) addBarrel(B, world, RAPIER, { x, z, seed: s * 7 + x });
    for (const [x, z, rot, stack] of [[11.8, ST - 5.4, 0.1, 2], [12.5, ST - 5.5, -0.15, 1], [-23.6, ST + 5.3, 0.3, 2], [31.3, ST + 5.0, 0.2, 1], [-38.8, ST - 5.6, 0.05, 3]]) {
      addCrate(B, world, RAPIER, { x, z, rot, stack });
    }
    for (const [x, z, rot] of [[-35.2, ST - 5.45, 0.1], [17.6, ST + 5.45, Math.PI], [-13.4, ST + 5.45, Math.PI - 0.1]]) addWagonWheel(B, { x, z, rot, lean: 0.25 });

    // Innerfältet bakom norra raden
    addWaterTower(B, world, RAPIER, { x: 21, z: 9 });
    addWindpump(B, world, RAPIER, { x: -24, z: 3 });
    addFence(B, world, RAPIER, { points: [[2, 2], [14, 2], [14, 11], [2, 11], [2, 4.5]] });
    addWagon(B, world, RAPIER, { x: 8, z: 6.5, rot: 0.6 });
    for (const [x, z] of [[-33, 3], [-35, 5.5], [-31, 6], [-34, 8.5], [-36.5, 3.5]]) addGraveCross(B, { x, z, rot: (x * 7) % 0.4 - 0.2 });
    addFence(B, world, RAPIER, { points: [[-38.5, 1], [-29, 1], [-29, 10.5], [-38.5, 10.5], [-38.5, 1]], low: true });
    // (ladan står nu på genvägen, se nedan)

    // Gruvtunneln på västra rakan
    const ti = track.nearest(-45.3, 4).index;
    const tp = track.pts[ti], tt = track.tangents[ti];
    addMineTunnel(B, world, RAPIER, { x: tp.x, z: tp.z, heading: Math.atan2(tt.x, tt.z), length: 11, seed: 5 });

    // Skylt vid infarten och ett vagnsvrak i öster
    addSignpost(B, world, RAPIER, { x: -51, z: ST - 4.5, rot: Math.PI / 4, text: 'DRY GULCH  POP. 0' });
    addWagon(B, world, RAPIER, { x: 53, z: 2, rot: 1.9, broken: true });

    // Öknen: kaktusar, stenar, torra buskar och bergen vid horisonten
    const r = rng(77);
    const clearOfTrack = (x, z, m) => track.nearest(x, z).d2 > (track.roadHalf + m) ** 2;
    const inTown = (x, z) => x > -42 && x < 48 && z > ST - 17 && z < ST + 15;
    const freeSpot = (x, z, m) => clearOfTrack(x, z, m) && !inTown(x, z) && !(x > -40 && x < 38 && z > -2 && z < 15);
    let n = 0;
    for (let k = 0; k < 400 && n < 46; k++) {
      const x = (r() - 0.5) * 150, z = (r() - 0.5) * 150;
      if (!freeSpot(x, z, 4)) continue;
      addCactus(B, world, RAPIER, { x, z, kind: r() < 0.55 ? 'saguaro' : r() < 0.6 ? 'pear' : 'barrel', seed: k, h: 2.2 + r() * 2.6 });
      n++;
    }
    n = 0;
    for (let k = 0; k < 600 && n < 60; k++) {
      const x = (r() - 0.5) * 160, z = (r() - 0.5) * 160;
      if (!freeSpot(x, z, 2.5)) continue;
      addRock(B, world, RAPIER, { x, z, size: 0.3 + r() * r() * 2.2, seed: k });
      n++;
    }
    n = 0;
    for (let k = 0; k < 600 && n < 90; k++) {
      const x = (r() - 0.5) * 160, z = (r() - 0.5) * 160;
      if (!clearOfTrack(x, z, 1.2)) continue;
      addScrub(B, { x, z, size: 0.25 + r() * 0.45, seed: k });
      n++;
    }
    for (const [x, z, rx, rz, h] of [
      [-95, -60, 22, 14, 26], [-120, 10, 16, 26, 34], [-88, 78, 26, 12, 20], [-20, 115, 30, 14, 30],
      [55, 108, 18, 16, 24], [112, 60, 14, 22, 38], [118, -25, 18, 30, 28], [80, -95, 26, 14, 22],
      [5, -118, 34, 12, 32], [-60, -110, 14, 14, 40], [-135, -40, 10, 10, 46], [95, 15, 8, 9, 14],
    ]) addMesa(B, world, RAPIER, { x, z, rx, rz, h, seed: seed++ });

    // Staket och höbalar där banan saknar vallar
    const edges = shortcutEdges(track);
    edgeColliders(world, RAPIER, edges, { h: 0.6, thick: 0.16 });
    addRailFence(B, edges);
    for (const [x, z, rot, stack] of [[47.2, -8.5, 1.5, 2], [47, -6.6, 1.62, 1], [46.8, 3.5, 1.5, 1], [12, 24.4, 0.05, 2], [6, 24.3, -0.1, 1], [14.5, 16.4, 0.4, 1], [2.5, 14.8, 0.6, 2]]) {
      addHayBale(B, world, RAPIER, { x, z, rot, stack });
    }

    // Genvägen: ladan den kör igenom och plankrampen över bäckfåran
    const sc = track.shortcuts[0]?.path;
    if (sc) {
      const bi = sc.nearest(32, 12.2).index, bt = sc.tangents[bi], bp = sc.pts[bi];
      addBarnPassage(B, world, RAPIER, { x: bp.x, z: bp.z, heading: Math.atan2(bt.x, bt.z), length: 4.6, clear: 2.05, seed: 40 });
      let k0 = -1, k1 = -1;
      for (let i = 0; i < sc.N - 1; i++) {
        if (!sc.isGap[i] && sc.pts[i].y > 0.005 && k0 < 0) k0 = Math.max(0, i - 1);
        if (!sc.isGap[i] && sc.isGap[i + 1] && sc.pts[i].y > 0.1) k1 = i;
      }
      if (k0 >= 0 && k1 > k0) addPlankRamp(B, sc, k0, k1);
    }

    // Starten: diligensen utanför banken och vattentråget vid salongen
    addStagecoach(B, world, RAPIER, { x: -7.6, z: ST - 4.0, rot: Math.PI / 2 });
    addTrough(B, world, RAPIER, { x: 3.6, z: ST - 4.85, rot: Math.PI / 2 });

    B?.flush(scene);

    // Tumlegräs som bilarna kan putta runt
    for (const [x, z, s] of [[-18, ST + 2.6, 0.42], [12, ST - 2.4, 0.36], [48.5, 24.5, 0.4], [47, BACK + 4, 0.34], [-8, 9.6, 0.38], [-45, -4, 0.4], [-30, BACK - 3.6, 0.32], [26, ST + 2.9, 0.3]]) {
      loose.push(addTumbleweed(scene, world, RAPIER, { x, z, r: s, seed: seed++ }));
    }
    return loose.filter((p) => p && p.body);
  },
};

// Kanter vid genvägens av- och påfart (öppningarna i vallarna). Avfartens
// staket börjar en bit före öppningen så att det går omlott med vallens
// sista bit: annars blev det en ficka mellan dem där bilar fastnade.
function shortcutEdges(track) {
  return [
    ...edgeSegments(track, [42.3, -10.8], [43.5, 6], { side: 1 }),
    ...edgeSegments(track, [42.3, -10.8], [42.7, -7.6], { side: -1 }),
    ...edgeSegments(track, [19.5, BACK], [0, 18.6], { side: 1 }),
    ...edgeSegments(track, [11, BACK], [0, 18.6], { side: -1 }),
  ];
}
