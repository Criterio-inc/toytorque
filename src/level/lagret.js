import {
  makeConcreteFloor, makeHallWalls, addPillar, addLooseBox, addToyBlock, addBeachBall, addFloorLines, PALLET,
  edgeSegments, edgeColliders, WarehouseBatch, addBoxStackB, addPalletB, addLoadedPalletB, addForklift,
  addRackTunnel, addGuardRail, addPlankRamp,
} from './warehouseArt.js';

// ---------------------------------------------------------------------------
// Nivå: Lagret. Leksakslager i riktig skala (meter) med en åtta där banan går
// över sig själv på en bro, och ett hopp över ett glapp på vänsterrakan.
// ---------------------------------------------------------------------------

const C = 26; // hörnens avstånd från mitten

export const lagret = {
  id: 'lagret',
  name: 'Lagret',
  laps: 3,
  sky: 0x9fa6ad,
  fog: { near: 30, far: 85 },
  floor: { size: 74, tile: 1.2, grip: 1.0, colorA: '#9a9c9e', colorB: '#919396', grout: '#7d7f82', gloss: 0.32 },
  walls: { height: 9, color: 0xb9b3a6 },

  track: {
    scale: 1,
    roadHalf: 1.6,
    spacing: 0.6,
    checkpoints: 22,
    barrierHeight: 0.18,
    barrierThick: 0.1,
    start: { x: C, z: 0 },
    // Åtta: höger raka nedåt, diagonal upp till vänster, vänster raka nedåt,
    // diagonal (över bron) upp till höger.
    corners: [
      { x: C, z: -C, r: 6 },
      { x: -C, z: C, r: 4 },
      { x: -C, z: -C, r: 4 },
      { x: C, z: C, r: 6 },
    ],
    elevation: [
      // Bron på diagonalen mot höger (passerar över den andra diagonalen)
      { at: [-15, -15], y: 0 },
      { at: [-6, -6], y: 1.0 },
      { at: [6, 6], y: 1.0 },
      { at: [15, 15], y: 0 },
      // Pallkullen på höger raka före starten: uppför, krön och nedför
      { at: [C, 19], y: 0 },
      { at: [C, 12.5], y: 0.6 },
      { at: [C, 5], y: 0 },
      // Hoppet på vänster raka: rak ramp ända ut i kanten, glapp, landning ner
      { at: [-C, 7], y: 0 },
      { at: [-C, 4], y: 0.06 },
      { at: [-C, -1.5], y: 0.46, linear: true },
      { at: [-C, -2.7], y: 0.32, linear: true },
      { at: [-C, -5.5], y: 0.14, linear: true },
      { at: [-C, -11], y: 0 },
    ],
    gaps: [{ from: [-C, -1.5], to: [-C, -2.7] }],
    // Doserat hörn av lastpallar i sydöstra hörnet
    bank: [{ at: [C, -C], deg: 15, fade: 6 }],
    // Pallställets tunnel på vänster raka: ställets sparklister är kanten.
    // Av- och påfarten till genvägen är öppet golv.
    openings: [
      { from: [-C, 15.8], to: [-C, 7.6] },
      { from: [4.5, -4.5], to: [-6.5, 6.5] },
      { from: [-C, -8.5], to: [-16.5, -16.5] },
    ],
    // Genvägen genom innerfältet: av diagonalen under bron, förbi pelaren
    // och över gaffeltruckens plankramp, in på vänster raka efter hoppet.
    // Smal och med en skarp sväng, men kortare. Raka bitar närmast
    // huvudbanan är bara golv (glapp i genvägens väg) så att dess vallar
    // aldrig hamnar på huvudbanan.
    shortcuts: [{
      from: [2, -2], via: [[-12.7, 6.5]], to: [-C, -13], r: 6.5, roadHalf: 1.3, ai: 0.3,
      elevation: [
        { at: [-18.3, -1.8], y: 0 },
        { at: [-20.2, -4.6], y: 0.24, linear: true },
        { at: [-20.5, -5.05], y: 0.01 },
      ],
      gaps: [{ from: [2, -2], to: [-7.3, 3.4] }, { from: [-20.2, -4.6], to: [-C, -13] }],
    }],
  },

  statics: [],

  // Lagerhallen runt banan. Returnerar lösa saker som ska synkas varje bild.
  environment({ scene, world, RAPIER, track }) {
    const size = 74, H = 9;
    const B = scene ? new WarehouseBatch() : null;
    makeConcreteFloor(scene, world, RAPIER, { size });
    makeHallWalls(scene, world, RAPIER, { size, height: H });
    // Pelare i innerfälten (mellan åttans öglor)
    for (const [x, z] of [[14, 0], [-14, 0], [0, 15], [0, -15]]) addPillar(scene, world, RAPIER, { x, z, size: 0.8, height: H });
    // Kartongstaplar och pallar längs väggarna
    let seed = 1;
    for (const [x, z, rotY, cols, rows, layers] of [
      [-33, -30, 0, 2, 3, 3], [-33, -18, 0, 2, 2, 2], [-33, 10, 0.1, 2, 3, 4], [-32.5, 24, 0, 2, 2, 2],
      [33, -26, 0, 2, 2, 3], [33, 8, -0.05, 2, 3, 2], [33, 28, 0, 2, 2, 4],
      [-20, 33.5, 0, 3, 2, 3], [-6, 33.5, 0, 2, 2, 2], [12, 33.5, 0, 4, 2, 3],
      [-14, -33.5, 0, 3, 2, 2], [6, -33.5, 0, 2, 2, 4], [22, -33, 0.08, 3, 2, 2],
      [9, 4, 0.4, 2, 2, 2], [-9, -4, 0.4, 2, 2, 2],
    ]) addBoxStackB(B, world, RAPIER, { x, z, rotY, cols, rows, layers, seed: seed++ });
    for (const [x, z, rotY] of [[-31, -6, 0.2], [30.5, -12, 0], [-24, -32.5, 0], [26, 32.5, 1.57]]) {
      addPalletB(B, world, RAPIER, { x, z, rotY, seed });
      addBoxStackB(B, world, RAPIER, { x, z, y: PALLET.h, rotY, cols: 1, rows: 1, layers: 2, seed: seed++ });
    }
    // Leksaker som dekor
    addToyBlock(scene, world, RAPIER, { x: 15.5, z: 2.5, size: 0.6, seed: 3 });
    addToyBlock(scene, world, RAPIER, { x: -15.5, z: -2.2, size: 0.5, rotY: 0.6, seed: 7 });

    // Starten: gaffeltruck med en lastad pall i luften, pallstaplar och kartonger
    addForklift(B, world, RAPIER, { x: 30.6, z: 3.2, rot: -Math.PI / 2, forkH: 1.15, load: true, seed: 5 });
    addPalletB(B, world, RAPIER, { x: 30.4, z: 7.2, rotY: 0.04, count: 8, seed: 11 });
    addPalletB(B, world, RAPIER, { x: 31.9, z: 7.0, rotY: -0.06, count: 5, seed: 12 });
    addLoadedPalletB(B, world, RAPIER, { x: 30.3, z: -0.9, rotY: 0.05, layers: 3, seed: 13 });
    addLoadedPalletB(B, world, RAPIER, { x: 31.7, z: -1.3, rotY: -0.1, layers: 2, seed: 14 });
    addBoxStackB(B, world, RAPIER, { x: 33.6, z: 2, cols: 2, rows: 3, layers: 3, seed: 15 });

    // Tunneln genom pallstället på vänster raka och kanterna utan vallar
    addRackTunnel(B, world, RAPIER, { ax: -C, az: 15.5, bx: -C, bz: 8, clear: 1.95, seed: 3 });
    const edges = buildEdges({ world, RAPIER, track });
    addGuardRail(B, edges);

    // Genvägen: lastade pallar längs gränden, plankrampen på pallar och
    // trucken som ställde dit den
    const sc = track.shortcuts[0]?.path;
    const lines = [{ points: [[-8, 22], [8, 22]], color: 'white', dash: [0.6, 0.4] }];
    if (sc) {
      const nearMain = (x, z, m) => Math.sqrt(track.nearest(x, z).d2) < track.roadHalf + m;
      let kick0 = -1, kick1 = -1;
      for (let i = 0; i < sc.N - 1; i++) {
        if (!sc.isGap[i] && sc.pts[i].y > 0.005 && kick0 < 0) kick0 = Math.max(0, i - 1);
        if (!sc.isGap[i] && sc.isGap[i + 1] && sc.pts[i].y > 0.1) kick1 = i;
      }
      if (kick0 >= 0 && kick1 > kick0) addPlankRamp(B, sc, kick0, kick1);
      const step = Math.round(2.3 / sc.spacing);
      let k = 0;
      for (let i = 4; i < sc.N - 4; i += step) {
        const after = i > kick1 + 2; // efter hoppet: golv, pallarna längre ut
        if (sc.isGap[i] && !after) continue;
        for (const side of [1, -1]) {
          if (i > kick0 - 2 && i < kick1 + 3 && side < 0) continue; // trucken står där
          const pose = sc.poseAt(i, side * (sc.roadHalf + (after ? 2.4 : 0.8)));
          if (nearMain(pose.x, pose.z, after ? 2.6 : 1.6) || Math.hypot(pose.x + 14, pose.z) < 1.6 || Math.hypot(pose.x + 15.5, pose.z + 2.2) < 1.3) continue;
          addLoadedPalletB(B, world, RAPIER, { x: pose.x, z: pose.z, rotY: pose.heading + (k % 3) * 0.05, layers: 1 + ((k * 5) % 3), seed: 40 + k });
          k++;
        }
      }
      if (kick1 > 0) {
        const f = sc.poseAt(kick0 + 2, -(sc.roadHalf + 2.4));
        addForklift(B, world, RAPIER, { x: f.x, z: f.z, rot: f.heading + Math.PI / 2, forkH: 0.06, seed: 6 });
      }
      // Målade körfältslinjer där genvägen bara är golv
      for (const side of [1, -1]) {
        for (const [i0, i1] of [[0, kick0], [kick1 + 3, sc.N - 2]]) {
          const pts = [];
          for (let i = i0; i <= i1; i += 3) { if (!sc.isGap[i]) continue; const p = sc.poseAt(i, side * sc.roadHalf); if (!nearMain(p.x, p.z, 0.1)) pts.push([p.x, p.z]); }
          if (pts.length > 1) lines.push({ points: pts, color: 'yellow', width: 0.1, dash: [0.5, 0.35] });
        }
      }
    }
    if (scene) addFloorLines(scene, { lines });
    B?.flush(scene);

    // Lösa saker nära banan som bilarna kan putta på
    const loose = [];
    for (const [x, z, s] of [[28.2, -6, 0.22], [28.4, -5.6, 0.2], [-28.6, 5, 0.24], [-23, -26.5, 0.22], [23.5, 26.8, 0.2]]) {
      loose.push(addLooseBox(scene, world, RAPIER, { x, z, size: s, seed: seed++ }));
    }
    loose.push(addBeachBall(scene, world, RAPIER, { x: 4, z: -20, r: 0.3 }));
    loose.push(addBeachBall(scene, world, RAPIER, { x: -5, z: 21, r: 0.25 }));
    return loose.filter((p) => p && p.body);
  },
  props: [
    { kind: 'block', cp: 4, lateral: -1.3, color: 0xe53935 },
    { kind: 'block', cp: 14, lateral: 1.3, color: 0x1e88e5 },
    { kind: 'ball', cp: 12, lateral: -0.6, color: 0xfdd835 },
    { kind: 'can', cp: 4, lateral: 0.7, color: 0x43a047 },
    { kind: 'cone', cp: 14, lateral: -0.9, color: 0xff7043 },
  ],
};

// Kanter där banan saknar vallar: pallställets sparklister i tunneln och
// påkörningsskydd runt hörnet där genvägen kommer in.
function buildEdges({ world, RAPIER, track }) {
  const segs = [
    ...edgeSegments(track, [-C, 16.2], [-C, 7.2]),
    // Räcket på ytterkanten genom hörnet: något innanför vallarnas linje och
    // en bit in över vallens början, så att ingen ände sticker ut att haka i
    ...edgeSegments(track, [-C, -8.2], [-15.9, -15.9], { side: 1, offset: track.roadHalf + 0.06 }),
  ];
  edgeColliders(world, RAPIER, segs, { h: 0.34, thick: 0.14 }); // lika hög som räcket syns
  return segs;
}
