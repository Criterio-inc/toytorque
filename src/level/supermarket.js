import { G, groups } from '../core/physics.js';
import {
  marketCtx, flushMarket, makeStore, addEntrance, addGondola, addAisleSign, addDeptSign, addSign,
  addFreezers, addChestFreezer, addFrostFloor, addPartition, addProduceStand, addBreadRack,
  addCheckout, addTrolley, addBasketStack, addWetFloorSign, addDock, addRollerDoor, addPallet,
  addPalletJack, addCanPyramid, addBanner, addLooseCan, addConcreteFloor, addPoster, addOpeningArch, addCrateStack,
  addLowCeiling, rgb, rng,
} from './marketArt.js';
import { fitShortcutOpenings } from './hoodArt.js';
import { addFloorLines } from './warehouseArt.js';

// ---------------------------------------------------------------------------
// Nivå: Supermarketen. En stor livsmedelsbutik efter stängning i riktig skala
// (meter). Starten ligger under ballongvalvet "STORT ÖPPNANDE" på stråket
// framför kassorna, sedan slalom upp och ner genom gång 8, 7 och 6, upp på
// lastkajen och hoppet från dess kant, genom det frostiga frysrummet med lågt
// tak och halt golv och kampanjhoppet framför kassorna. Genvägen går tvärs
// genom hyllorna mellan gång 7 och gång 6.
// ---------------------------------------------------------------------------

const FRONT = -18; // stråket framför kassorna (z)
const BACK = 26; // stråket längs lastkajen (z)
const WEST = -30; // frysgången (x)
const HALL = { x0: -37.5, x1: 38, z0: -31, z1: 34.5, height: 5.5 };
const ICE = { z0: -5, z1: 15 }; // hal frost på vägen i frysrummet
const DOCK_Y = 0.85;

export const supermarket = {
  id: 'supermarket',
  name: 'Supermarketen',
  laps: 3,
  sky: 0xdfe6ec,
  fog: { near: 40, far: 120, color: 0xdde4ea },
  lighting: {
    sun: { color: 0xf2f7ff, intensity: 1.3, offset: [3, 30, 5] },
    hemi: { sky: 0xf4f8ff, ground: 0xb4b8bc, intensity: 0.95 },
    exposure: 0.92,
    envIntensity: 0.55,
  },
  floor: { size: 84 },

  trackTheme: {
    road: '#7b838c', roadRough: 0.38, side: '#8f959b', pillar: '#7d838a',
    barrierA: '#d23a32', barrierB: '#f2f2f2',
  },

  track: {
    scale: 1,
    roadHalf: 1.5,
    spacing: 0.6,
    checkpoints: 18,
    barrierHeight: 0.16,
    barrierThick: 0.1,
    start: { x: 14, z: FRONT },
    // Kassastråket österut, upp gång 8, ner gång 7, upp gång 6, västerut
    // längs lastkajen och söderut genom frysrummet.
    corners: [
      { x: 28, z: FRONT, r: 5 },
      { x: 28, z: 18, r: 4 },
      { x: 19, z: 18, r: 4 },
      { x: 19, z: -6, r: 4 },
      { x: 10, z: -6, r: 4 },
      { x: 10, z: BACK, r: 5 },
      { x: WEST, z: BACK, r: 5 },
      { x: WEST, z: FRONT, r: 5 },
    ],
    elevation: [
      // Kampanjhoppet på kassastråket: rak ramp ända ut i kanten, glapp, landning
      { at: [-14, FRONT], y: 0 },
      { at: [-11, FRONT], y: 0.06 },
      { at: [-5.5, FRONT], y: 0.46, linear: true },
      { at: [-4.3, FRONT], y: 0.32, linear: true },
      { at: [-0.5, FRONT], y: 0.14, linear: true },
      { at: [6, FRONT], y: 0 },
      // Pallpuckeln mitt i gång 8: uppför, krön och nedför
      { at: [28, -6], y: 0 },
      { at: [28, 0], y: 0.55 },
      { at: [28, 6], y: 0 },
      // Upp på lastkajen, en pallramp ut i kanten, glapp och landning
      { at: [4, BACK], y: 0 },
      { at: [-5, BACK], y: DOCK_Y },
      { at: [-7, BACK], y: DOCK_Y },
      { at: [-10, BACK], y: 1.0, linear: true },
      { at: [-11.2, BACK], y: 0.78, linear: true },
      { at: [-17, BACK], y: 0.25, linear: true },
      { at: [-21, BACK], y: 0 },
    ],
    gaps: [{ from: [-5.5, FRONT], to: [-4.3, FRONT] }, { from: [-10, BACK], to: [-11.2, BACK] }],
    // Kurvan ut ur frysgången är doserad (pallar under vägen)
    bank: [{ at: [WEST, FRONT], deg: 14, fade: 4 }],
    // Genom hyllorna: från gång 7 tvärs över till gång 6 (hoppar över hörnet vid kassorna)
    shortcuts: [{ from: [19, 12], via: [[18.3, 8.3], [11.4, 7.6]], to: [10, 13.6], r: 2.5, roadHalf: 1.3, ai: 0.4 }],
  },

  statics: [],
  props: [],

  environment({ scene, world, RAPIER, track }) {
    return buildMarket({ scene, world, RAPIER, track });
  },
};

function buildMarket({ scene, world, RAPIER, track }) {
  const C = marketCtx(scene, world, RAPIER);
  const r = rng(404);
  makeStore(C, { ...HALL, ground: 84 });
  // Genvägens av- och påfart: öppna vallarna där vägarna går ihop
  fitShortcutOpenings(C.B, world, RAPIER, track, { key: 'paint', colors: [rgb(0xd23a32), rgb(0xf2f2f2)] });

  // --- gondoler i mittfältet och i banans gångar ----------------------------
  const gondolas = [
    { x: -23, z: 4, len: 25, cats: ['frukost', 'konserver'], endcaps: ['KAMPANJ', 'NYHET!'] },
    { x: -17.5, z: 4, len: 25, cats: ['konserver', 'frukost'], endcaps: ['-25%', 'FYND!'] },
    { x: -12, z: 4, len: 25, cats: ['pasta', 'konserver'], endcaps: ['2 FÖR 30:-', 'KAMPANJ'] },
    { x: -6.5, z: 4, len: 25, cats: ['dryck', 'pasta'], endcaps: ['SUPERPRIS', '-25%'] },
    { x: -1, z: 4, len: 25, cats: ['tvatt', 'dryck'], endcaps: ['NYHET!', '2 FÖR 30:-'] },
    { x: 3.1, z: 4, len: 25, cats: ['frukost', 'tvatt'], endcaps: ['FYND!', 'KAMPANJ'] },
    { x: 7.2, z: 4, len: 25, cats: ['kaffe', 'frukost'], endcaps: ['SUPERPRIS', '-25%'] },
    // Gång 6 och 7: två gondoler mellan varje par av vägar
    // (delade på mitten: genvägens tvärgång)
    { x: 13, z: 14.03, len: 5.25, cats: ['konserver', 'kaffe'], endcaps: ['KAMPANJ', 'FYND!'] },
    { x: 13, z: 1.875, len: 5.45, cats: ['kaffe', 'konserver'], endcaps: ['NYHET!', '-25%'] },
    { x: 16, z: 13.83, len: 4.85, cats: ['sylt', 'pasta'], endcaps: ['-25%', 'NYHET!'] },
    { x: 16, z: 1.875, len: 5.45, cats: ['pasta', 'sylt'], endcaps: ['FYND!', 'SUPERPRIS'] },
    { x: 22, z: 2.9, len: 22.4, cats: ['dryck', 'sylt'], endcaps: ['2 FÖR 30:-', 'SUPERPRIS'] },
    { x: 25, z: 2.9, len: 22.4, cats: ['vatten', 'dryck'], endcaps: ['NYHET!', 'KAMPANJ'] },
  ];
  gondolas.forEach((g, i) => addGondola(C, { ...g, seed: i + 1 }));

  // Hängande gångskyltar
  const aisles = [[-20.25, 1], [-14.75, 2], [-9.25, 3], [-3.75, 4], [1.05, 5]];
  for (const [x, n] of aisles) for (const z of [-3, 11]) addAisleSign(C, { x, z, key: 'g' + n, ceiling: HALL.height });
  addAisleSign(C, { x: 10, z: 3, key: 'g6', ceiling: HALL.height });
  addAisleSign(C, { x: 19, z: 6, key: 'g7', ceiling: HALL.height });
  addAisleSign(C, { x: 28, z: 0, key: 'g8', ceiling: HALL.height });
  addAisleSign(C, { x: WEST, z: 4, y: 2.1, key: 'gF', ceiling: 2.6 });
  // Frysrummet har lågt tak: banan går under det mellan mellanväggarna
  addLowCeiling(C, { x0: HALL.x0, x1: -26.95, z0: -9.6, z1: 17.6, y: 2.6 });

  // --- frysrummet ------------------------------------------------------------
  const frozen = ['PIZZA', 'FISKPINNAR', 'GLASS', 'VANILJ'];
  addFreezers(C, { x: HALL.x0 + 0.5, z: 4, len: 26, rotY: 0, labels: frozen, seed: 3, sign: 'FRYST' });
  addFreezers(C, { x: -27.45, z: 4, len: 26, rotY: Math.PI, labels: frozen, seed: 4 });
  addChestFreezer(C, { x: -34, z: -1.5, len: 8, labels: frozen, seed: 5 });
  addChestFreezer(C, { x: -34, z: 9.5, len: 8, labels: frozen, seed: 6 });
  addPartition(C, { x0: HALL.x0, x1: -26.95, z: -9.6, openA: WEST - 2.3, openB: WEST + 2.25 });
  addPartition(C, { x0: HALL.x0, x1: -26.95, z: 17.6, openA: WEST - 2.3, openB: WEST + 2.25 });
  addFrostFloor(C, { x0: HALL.x0, x1: -26.95, z0: -9.55, z1: 17.55 });
  addFrostFloor(C, { x0: WEST - 1.48, x1: WEST + 1.48, z0: ICE.z0, z1: ICE.z1, y: 0.009 });
  addWetFloorSign(C, { x: -33.6, z: 15.6, rotY: 0.4 });
  addWetFloorSign(C, { x: -26.2, z: -11.2, rotY: -0.3 });

  // Halt golv: en tunn platta strax över vägytan med lågt grepp
  if (world) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const col = world.createCollider(
      RAPIER.ColliderDesc.cuboid(track.roadHalf - 0.02, 0.003, (ICE.z1 - ICE.z0) / 2)
        .setTranslation(WEST, 0.003, (ICE.z0 + ICE.z1) / 2).setFriction(0.3).setCollisionGroups(groups(G.WORLD)),
      body
    );
    world.__surfaces ||= new Map();
    world.__surfaces.set(col.handle, { grip: 0.55 });
  }

  // --- frukt och grönt längs östra väggen ------------------------------------
  const produce = [
    ['apple', 'green', 'orange', 'lemon'], ['tomato', 'lime', 'potato', 'apple'],
    ['orange', 'lemon', 'green', 'tomato'], ['melon', 'cabbage', 'potato', 'apple'], ['lemon', 'orange', 'lime', 'tomato'],
  ];
  [-9, -3.5, 2, 7.5, 13].forEach((z, i) => addProduceStand(C, { x: 31.5, z, rotY: Math.PI, kinds: produce[i], seed: i + 1 }));
  [-9, -3.5, 2, 7.5, 13].forEach((z, i) => addProduceStand(C, { x: 36.9, z, rotY: Math.PI, kinds: produce[(i + 2) % 5], seed: i + 11 }));
  addDeptSign(C, { x: HALL.x1, y: 3.6, z: 2, rotY: -Math.PI / 2, text: 'FRUKT & GRÖNT', w: 6 });

  // --- kyldiskar, bröd och kampanjytan i nordost ----------------------------
  addFreezers(C, { x: 19, z: HALL.z1 - 0.45, len: 22, rotY: Math.PI / 2, open: true, labels: ['MJÖLK', 'FIL', 'JUICE', 'MJÖLK'], seed: 7 });
  addDeptSign(C, { x: 19, y: 3.4, z: HALL.z1, rotY: Math.PI, text: 'MEJERI', w: 4.5 });
  addBreadRack(C, { x: 34, z: HALL.z1 - 0.32, len: 5, rotY: Math.PI / 2, seed: 1 });
  addBreadRack(C, { x: HALL.x1 - 0.32, z: 27, len: 5, rotY: Math.PI, seed: 2 });
  addDeptSign(C, { x: 34, y: 3.0, z: HALL.z1, rotY: Math.PI, text: 'BRÖD', w: 2.6 });
  addCanPyramid(C, { x: 29.5, z: 24.5, levels: 10, rotY: 0.3 });
  addPallet(C, { x: 21.5, z: 23.5, load: 'water', layers: 2, seed: 1 });
  addPallet(C, { x: 23, z: 25, rotY: Math.PI / 2, load: 'cans', layers: 4, seed: 2 });
  addSign(C, 'p_SUPERPRIS', 0.6, 0.6, 21.5, 1.15, 23.1, Math.PI);

  // --- lastkajen längs bakväggen --------------------------------------------
  addConcreteFloor(C, { x0: -26, x1: 6, z0: BACK + 1.95, z1: HALL.z1 });
  addDock(C, { x0: -11, x1: -5, z0: BACK + track.roadHalf + 0.12, z1: HALL.z1, h: DOCK_Y });
  addRollerDoor(C, { x: -8, z: HALL.z1, rotY: Math.PI, w: 3.6, h: 3.6, label: 'dock1' });
  addRollerDoor(C, { x: -20, z: HALL.z1, rotY: Math.PI, w: 3.6, h: 3.4, label: 'dock2' });
  addDeptSign(C, { x: 1.5, y: 3.8, z: HALL.z1, rotY: Math.PI, text: 'LAGER · ENDAST PERSONAL', w: 5.5 });
  let ps = 1;
  for (const [x, z, rotY, load, layers] of [
    [-24, 32.8, 0, 'boxes', 3], [-24, 30.9, 0.05, 'boxes', 2], [-15.5, 33, 0, 'water', 3], [-14, 31.2, 1.57, 'boxes', 4],
    [-2, 32.9, 0, 'boxes', 2], [0.5, 33, 0, 'cans', 5], [2.8, 31, 0.1, 'boxes', 3], [-8, 33.3, 0, 'boxes', 2],
  ]) addPallet(C, { x, z, rotY, load, layers, seed: ps++, y: x === -8 ? DOCK_Y : 0 });
  for (const [x, z, rotY, layers] of [[-24, 29.3, 0.1, 1], [-25.8, 30.9, 0, 4], [3.6, 33.2, 0, 4], [-1.6, 30.6, -0.15, 1]]) {
    addPallet(C, { x, z, rotY, load: 'boxes', layers, seed: ps++ });
  }
  addPallet(C, { x: -17.5, z: 31.2, rotY: 0.2 });
  addPallet(C, { x: -17.5, z: 31.2, y: 0.144, rotY: 0.25 });
  addPallet(C, { x: -17.5, z: 31.2, y: 0.288, rotY: 0.15 });
  addPalletJack(C, { x: -21, z: 30.5, rotY: 0.6 });
  if (scene) {
    addFloorLines(scene, {
      lines: [
        { points: [[-26, BACK + 1.9], [-11.2, BACK + 1.9]], width: 0.1, color: 'yellow' },
        { points: [[-4.8, BACK + 1.9], [5.5, BACK + 1.9]], width: 0.1, color: 'yellow' },
      ],
    });
  }
  addTrolley(C, { x: 4.6, z: 31.5, rotY: 2.4 });

  // --- kassorna och entrén ----------------------------------------------------
  [-22, -16, -10, -4, 2, 8, 14].forEach((x, i) => addCheckout(C, { x, z: -26, num: i + 1, seed: i + 1 }));
  addDeptSign(C, { x: -4, y: 3.5, z: HALL.z0, rotY: 0, text: 'KASSOR', w: 4 });
  addEntrance(C, { x: 30.5, z: HALL.z0, w: 7, h: 2.6 });
  addSign(C, 'exit', 0.8, 0.3, -34, 2.6, HALL.z0 + 0.03);
  addSign(C, 'exit', 0.8, 0.3, HALL.x0 + 0.03, 2.6, -24, Math.PI / 2);
  for (let i = 0; i < 6; i++) addTrolley(C, { x: 21 + i * 0.28, z: -29.4, rotY: Math.PI / 2, collide: i === 0 });
  if (world) world.createCollider(RAPIER.ColliderDesc.cuboid(1.0, 0.5, 0.3).setTranslation(21.9, 0.5, -29.4).setCollisionGroups(groups(G.WORLD)), C.body);
  for (let i = 0; i < 5; i++) addTrolley(C, { x: 36.4, z: -22 + i * 0.28, rotY: 0, collide: i === 0 });
  addTrolley(C, { x: 31.2, z: -21.2, rotY: 2.0 });
  addTrolley(C, { x: -26.5, z: -22.6, rotY: -0.7 });
  addBasketStack(C, { x: 26.4, z: -28.4, n: 7 });
  addBasketStack(C, { x: 26.9, z: -27.6, n: 5, rotY: 0.4 });
  addBasketStack(C, { x: 35.3, z: -28.8, n: 6, color: 0x1e63b5 });
  addBasketStack(C, { x: -27.6, z: -27.2, n: 4, rotY: 0.2 });
  addWetFloorSign(C, { x: 19.8, z: -23.2, rotY: 0.8 });

  // Affischer på väggarna
  addPoster(C, { x: -27, z: HALL.z0, promo: 'SUPERPRIS' });
  addPoster(C, { x: 13, z: HALL.z0, promo: '-25%' });
  addPoster(C, { x: HALL.x0, z: -21, rotY: Math.PI / 2, promo: 'KAMPANJ' });
  addPoster(C, { x: HALL.x0, z: 26, rotY: Math.PI / 2, promo: 'NYHET!' });
  addPoster(C, { x: HALL.x1, z: 24, rotY: -Math.PI / 2, promo: 'FYND!' });

  // Startportalen: ballongvalv med banderoll över startlinjen
  addOpeningArch(C, { x: 14, z: FRONT, rotY: Math.PI / 2, span: 4.0, h: 2.5 });

  // Backstaplar längs kanterna (stråket vid kajen och framför kassorna)
  let cs = 1;
  for (let x = -21; x <= 5; x += 3.3) addCrateStack(C, { x, z: BACK - track.roadHalf - 0.45, rotY: 0.05 * (cs % 3), layers: 2 + (cs % 3), color: [0x1e63b5, 0xd7262e, 0x2e8b3e][cs % 3], seed: cs++ });
  for (let x = -22; x <= 21; x += 3.6) {
    if (Math.abs(x - 14) < 3) continue;
    addCrateStack(C, { x, z: FRONT + track.roadHalf + 0.45, rotY: -0.04 * (cs % 3), layers: 1 + (cs % 3), color: [0xffb300, 0x1e63b5, 0xd7262e][cs % 3], seed: cs++ });
  }

  // Kampanjbanderoll över hoppet
  addBanner(C, { x: -8, z: FRONT, rotY: Math.PI / 2, span: 4.6, y: 1.9 });

  // Kampanjdisplayer längs kassastråket (utanför vallarna)
  addCanPyramid(C, { x: 17.5, z: FRONT - 3.2, levels: 7, label: 'CITRUSKICK', rotY: 0.2 });
  addCanPyramid(C, { x: -14, z: FRONT - 3.0, levels: 6, label: 'PÄRONSODA', rotY: -0.25 });
  addPallet(C, { x: -12.5, z: FRONT - 2.9, load: 'cans', layers: 3, seed: 21 });
  addSign(C, 'p_2 FÖR 30:-', 0.55, 0.55, -12.5, 0.95, FRONT - 2.48, 0);

  flushMarket(C);

  // --- lösa läskburkar i två pyramider vid vägkanten ------------------------
  const loose = [];
  const pyramid = (px, pz, label) => {
    const near = track.nearest(px, pz);
    const i = near.index;
    const side = Math.abs(track.line[i]) > 0.15 ? -Math.sign(track.line[i]) : 1;
    const t = track.tangents[i];
    const base = track.poseAt(i, side * (track.roadHalf - 0.3));
    const sp = 0.07, y0 = track.pts[i].y + 0.004;
    for (let l = 0; l < 4; l++) {
      const n = 4 - l;
      for (let k = 0; k < n; k++) {
        const s = (k - (n - 1) / 2) * sp;
        loose.push(addLooseCan(C, { x: base.x + t.x * s, y: y0 + l * 0.123, z: base.z + t.z * s, label }));
      }
    }
  };
  pyramid(28, 9, 'SKUMMIS');
  pyramid(19, 2, 'BUBBEL');
  void r;
  return loose.filter((p) => p && p.body);
}
