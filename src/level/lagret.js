import {
  makeConcreteFloor, makeHallWalls, addLooseBox, addFloorLines,
  edgeSegments, edgeColliders, WarehouseBatch, addBoxStackB, addPalletB, addLoadedPalletB, addForklift,
  addGuardRail, addYardRamp, addLandingDeck, addOpenCarton, addRackRow, addAisleSign,
} from './warehouseArt.js';

// ---------------------------------------------------------------------------
// Nivå: Lagret. Ett varuhuslager i riktig skala (meter): långa rader pallställ,
// sex meter höga, med varor på pallar på varje plan. Banan slingrar sig genom
// gångarna: ut längs huvudgången, upp genom gång 14, runt radens ände, ner
// genom gång 13, runt nästa ände, upp genom gång 12 och tillbaka längs gång 11
// vid väggen, där en körbrygga i stål står mitt i gången.
//
// Genvägen går genom ett tomt fack längst ner i stället mellan gång 14 och 13,
// under en gaffeltrucks upplyfta pall. I gång 12 ligger en tom kartong på
// sidan bredvid vägen som går att köra igenom.
// ---------------------------------------------------------------------------

const ROWS = {
  W: { x: -15, z0: -21.5, z1: 19.5 }, // mellan gång 11 och 12
  A: { x: -5, z0: -10.2, z1: 21 }, // mellan gång 12 och 13
  B: { x: 5, z0: -22, z1: 14.2 }, // mellan gång 13 och 14 (genomfarten)
  E: { x: 15, z0: -22, z1: 22 }, // mellan gång 14 och lastkajen
};
const PASS = { bay: 11, z: 10.0 }; // genomfarten under stället (fack 11 i rad B)
const CART = { x: -12.8, z: 3.0, len: 2.0 }; // kartongen i gång 12

export const lagret = {
  id: 'lagret',
  name: 'Lagret',
  layout: 2, // banan byggdes om 2026-11-22: äldre spökbilar gäller inte längre
  laps: 3,
  sky: 0x9fa6ad,
  fog: { near: 30, far: 85 },
  lighting: {
    sun: { color: 0xfff0d8, intensity: 2.6, offset: [14, 24, 6] },
    hemi: { sky: 0xeef2f6, ground: 0x6d6457, intensity: 0.6 },
    shadow: { range: 22, size: 2048 },
  },
  look: { ao: 0.9, contrast: 1.12 },
  floor: { size: 64, tile: 1.2, grip: 1.0, colorA: '#9a9c9e', colorB: '#919396', grout: '#7d7f82', gloss: 0.32 },
  walls: { height: 10, color: 0xb9b3a6 },

  // Vägen är lagergolvet; kanterna är gul- och svartrandiga påkörningsskydd
  trackTheme: {
    road: '#9c9d9c', roadRough: 0.42, side: 0x6f7173, pillar: 0x6f7173,
    barrierA: 0xf2b705, barrierB: 0x2a2a2a,
  },

  track: {
    scale: 1,
    roadHalf: 1.6,
    spacing: 0.6,
    checkpoints: 26,
    barrierHeight: 0.16,
    barrierThick: 0.1,
    start: { x: -6, z: -26 },
    // Huvudgången österut, gång 14 norrut, runt rad B, gång 13 söderut, runt
    // rad A, gång 12 norrut och gång 11 söderut tillbaka till huvudgången
    corners: [
      { x: 10, z: -26, r: 4 },
      { x: 10, z: 23, r: 5 },
      { x: 0, z: 23, r: 5 },
      { x: 0, z: -19, r: 5 },
      { x: -10, z: -19, r: 5 },
      { x: -10, z: 23, r: 4 },
      { x: -22, z: 23, r: 4 },
      { x: -22, z: -26, r: 4 },
    ],
    elevation: [
      // Körbryggan i gång 11: rak ramp ända ut i kanten, glapp, plywood ner
      { at: [-22, 9], y: 0 },
      { at: [-22, 6], y: 0.08 },
      { at: [-22, 0.5], y: 0.7, linear: true },
      { at: [-22, -0.7], y: 0.5, linear: true },
      { at: [-22, -4.5], y: 0.2, linear: true },
      { at: [-22, -9], y: 0 },
    ],
    gaps: [{ from: [-22, 0.5], to: [-22, -0.7] }],
    airZones: [{ from: [-22, 8], to: [-22, 0.6] }],
    // Hörnet ut från huvudgången är doserat: en vall av pallar under vägen
    bank: [{ at: [10, -26], deg: 12, fade: 4 }],
    openings: [
      // Ut till kartongen och in igen
      { from: [-10, -2.2], to: [-10, 0.6] }, { from: [-10, 5.2], to: [-10, 8.6] },
    ],
    checkpointHalf: 3.8,
    // Styr spelaren åt höger före kartongen siktar körhjälpen genom den
    sideExits: [{
      zone: [-14, -8, -8.3, 4.8], side: -1, speed: 5,
      line: [[-10.2, -4.5], [-11.4, -1.4], [CART.x, 0.8], [CART.x, CART.z + 1.2]],
    }],
    // Genvägen: av i gång 14, genom det tomma facket under stället och under
    // gaffeltruckens upplyfta pall, in i gång 13. Smal och tvär men kort.
    shortcuts: [{
      from: [10, 4.6], via: [[8.0, PASS.z], [1.9, PASS.z]], to: [0, 4.6], r: 2.0, roadHalf: 1.0, ai: 0.3,
    }],
  },

  statics: [],

  environment({ scene, world, RAPIER, track }) {
    const size = 64, H = 10;
    const B = scene ? new WarehouseBatch() : null;
    makeConcreteFloor(scene, world, RAPIER, { size });
    makeHallWalls(scene, world, RAPIER, { size, height: H });

    // Pallställen. Rad B har en genomfart i golvplanet.
    let seed = 1;
    for (const [k, R] of Object.entries(ROWS)) {
      addRackRow(B, world, RAPIER, {
        cx: R.x, cz: (R.z0 + R.z1) / 2, L: R.z1 - R.z0, open: k === 'B' ? [PASS.bay] : [], seed: seed++,
      });
    }
    // Ställ längs väggarna: väster om gång 11 och norr om banan
    addRackRow(B, world, RAPIER, { cx: -28.6, cz: -1, L: 46, double: false, seed: seed++ });
    addRackRow(B, world, RAPIER, { cx: 2, cz: 29.8, L: 50, rot: Math.PI / 2, double: false, seed: seed++ });

    // Gångskyltar över varje gång, i båda ändar
    for (const [x, n] of [[-22, '11'], [-10, '12'], [0, '13'], [10, '14']]) {
      addAisleSign(scene, { x, z: 17, text: n });
      addAisleSign(scene, { x, z: -17, text: n });
    }

    // Blockstaplade pallar mellan huvudgången och svängen runt rad A
    let k = 0;
    for (let x = -8.6; x <= 0.6; x += 1.3) addLoadedPalletB(B, world, RAPIER, { x, z: -22.6, rotY: (k % 3) * 0.02, layers: 1 + (k++ % 3), seed: seed++ });
    // Lastkajen i öster: travar av tomma pallar, lastade pallar och en truck
    for (const [x, z, n] of [[20, -18, 6], [21.5, -18.2, 9], [20.2, 12, 4], [24, 4, 7]]) addPalletB(B, world, RAPIER, { x, z, count: n, seed: seed++ });
    for (const [x, z, l] of [[20, -8, 3], [21.3, -8.2, 2], [20.1, -2, 2], [24.5, -12, 3], [24.4, 16, 2]]) addLoadedPalletB(B, world, RAPIER, { x, z, rotY: 0.04, layers: l, seed: seed++ });
    addForklift(B, world, RAPIER, { x: 22.5, z: 6.5, rot: Math.PI, forkH: 0.6, load: true, seed: 8 });
    addBoxStackB(B, world, RAPIER, { x: 26, z: -24, cols: 3, rows: 2, layers: 3, seed: seed++ });
    // Söder om huvudgången: kartonger vid väggen
    for (const [x, z, c, l] of [[-20, -30, 3, 3], [-8, -30.2, 2, 2], [4, -30, 4, 3], [16, -30.1, 2, 4]]) addBoxStackB(B, world, RAPIER, { x, z, cols: c, rows: 2, layers: l, seed: seed++ });

    // Genomfarten: truckföraren har just lyft ut pallen ur facket och står
    // med den uppe i gång 13. Bilarna kör in under den.
    addForklift(B, world, RAPIER, { x: 2.75, z: PASS.z + 2.15, rot: Math.PI, forkH: 1.0, load: true, seed: 9 });

    // Körbryggan i gång 11 och landningen på plywood efter glappet
    const at = (x, z) => track.nearest(x, z).index;
    addYardRamp(B, track, at(-22, 8.6), at(-22, 0.55));
    addLandingDeck(B, track, at(-22, -0.75), at(-22, -8.8));

    // Kartongen i gång 12 och påkörningsskydd på andra sidan där kanten är öppen
    addOpenCarton(B, world, RAPIER, { x: CART.x, z: CART.z, len: CART.len, seed: 4 });
    const edges = [
      ...edgeSegments(track, [-10, -2.5], [-10, 0.9], { side: 1, offset: track.roadHalf + 0.06 }),
      ...edgeSegments(track, [-10, 4.9], [-10, 8.9], { side: 1, offset: track.roadHalf + 0.06 }),
    ];
    edgeColliders(world, RAPIER, edges, { h: 0.34, thick: 0.14 });
    addGuardRail(B, edges);

    // Golvmärkning: gula linjer längs ställen och övergångsställen i huvudgången
    const lines = [];
    for (const R of Object.values(ROWS)) {
      for (const s of [-1, 1]) lines.push({ points: [[R.x + s * 2.45, R.z0 + 0.3], [R.x + s * 2.45, R.z1 - 0.3]], color: 'yellow', width: 0.1 });
    }
    lines.push({ points: [[-27.2, -22], [-27.2, 20]], color: 'yellow', width: 0.1 });
    for (const x of [-15, -5, 5]) {
      for (let j = 0; j < 6; j++) lines.push({ points: [[x - 1.2 + j * 0.48, -24.2], [x - 1.2 + j * 0.48, -27.8]], color: 'white', width: 0.24 });
    }
    if (scene) addFloorLines(scene, { lines });
    B?.flush(scene);

    // Lösa kartonger vid gångarnas kanter som bilarna kan putta på
    const loose = [];
    for (const [x, z, s] of [[12.6, -12, 0.24], [12.4, -11.6, 0.2], [-2.7, -4, 0.22], [-7.6, 12, 0.24], [-19.4, -14, 0.22], [7.6, -16, 0.2]]) {
      loose.push(addLooseBox(scene, world, RAPIER, { x, z, size: s, seed: seed++ }));
    }
    return loose.filter((p) => p && p.body);
  },
  props: [],
};
