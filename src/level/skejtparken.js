import {
  HoodBatch, makeGround, addTree, addLamp, addPlankFence, addFarTrees, addBin, addTrackPaint,
  addSwingSet, addSlide, addSandbox, addBooth, addHedge, addCar, addHouse, addBarricade, addCone,
} from './hoodArt.js';
import { rng } from './warehouseArt.js';
import { cartonWall, canPyramid } from './stacks.js';

// ---------------------------------------------------------------------------
// Nivå: Skejtparken. En bred betongbana i ett grönområde, byggd för fart och
// luft: ett bordshopp på startrakan, en S-kurva, ett stort hopp med våg efter,
// en puckel där bilarna lättar och en bred kurva hem. Vägen är bredare än på de andra banorna, så att det finns
// plats att välja linje och köra om.
// ---------------------------------------------------------------------------

const S = -30, N = 32, W = -34; // startrakan (söder), norra rakan och västra rakan

export const skejtparken = {
  id: 'skejtparken',
  name: 'Skejtparken',
  laps: 3,
  sky: 0x9fcdf2,
  skyGradient: [0x2b78d4, 0xa9d5f4, 0xe4efe6],
  fog: { near: 90, far: 220, color: 0xc4dcef },
  lighting: {
    sun: { color: 0xffe6c0, intensity: 3.4, offset: [20, 16, -14] },
    hemi: { sky: 0x9cc4ff, ground: 0x4c6238, intensity: 0.45 },
    exposure: 1.05,
    envIntensity: 0.45,
    shadow: { range: 24, size: 3072 },
  },
  skyDome: { top: 0x1058c8, horizon: 0x86c2f4, cloud: 0xfffaf0, cloudShade: 0x8fa6c6, coverage: 0.42 },
  look: { ao: 0.8, contrast: 1.12, saturation: 1.16, warmth: 0.02, bloom: 0.28 },
  floor: { size: 130 },

  trackTheme: { road: '#8f908c', roadRough: 0.86, side: 0xb99560, pillar: 0x8a6b45, barrierA: 0xd8d5cc, barrierB: 0xe2792a },

  track: {
    scale: 1,
    roadHalf: 2.6,
    spacing: 0.6,
    checkpoints: 22,
    barrierHeight: 0.16,
    barrierThick: 0.2,
    lineMargin: 0.8,
    start: { x: -10, z: S },
    // Medurs sett uppifrån: startrakan österut med bordshoppet, en S-kurva i öster,
    // norra rakan västerut med stora hoppet och en våg, västra rakan söderut över
    // stora puckeln och en bred kurva tillbaka till starten (ingen dosering: bilar gled
    // över kantvallen på utsidan).
    corners: [
      { x: 34, z: S, r: 10 },
      { x: 34, z: -8, r: 7 },
      { x: 16, z: -8, r: 7 },
      { x: 16, z: 12, r: 7 },
      { x: 38, z: 12, r: 8 },
      { x: 38, z: N, r: 9 },
      { x: W, z: N, r: 11 },
      { x: W, z: S, r: 11 },
    ],
    elevation: [
      // Bordshoppet på startrakan: inget glapp, så startklungan kan rulla över i låg fart
      { at: [-3, S], y: 0 },
      { at: [1, S], y: 0.08 },
      { at: [9, S], y: 0.7, linear: true },
      { at: [10.4, S], y: 0.64, linear: true },
      { at: [16, S], y: 0.2, linear: true },
      { at: [21, S], y: 0 },
      // Stora hoppet på norra rakan: rak ramp ända ut i kanten, glapp, lång landning nedför
      { at: [22, N], y: 0 },
      { at: [18, N], y: 0.1 },
      { at: [10, N], y: 0.8, linear: true },
      { at: [8.6, N], y: 0.58, linear: true },
      { at: [3, N], y: 0.22, linear: true },
      { at: [-2, N], y: 0 },
      // En våg efter landningen
      // (låg och tidigt: en hög våg nära kurvan kastade de snabbaste bilarna rakt ut ur den)
      { at: [-4, N], y: 0 },
      { at: [-9, N], y: 0.28 },
      { at: [-14, N], y: 0 },
      // Stora puckeln på västra rakan: uppför, krön där bilarna lättar, nedför
      // (en bit in på rakan, så att bilarna hunnit räta upp sig efter kurvan)
      { at: [W, 11], y: 0 },
      { at: [W, 0], y: 0.55 },
      { at: [W, -11], y: 0 },
    ],
    gaps: [{ from: [10, N], to: [8.6, N] }],
    // Hoppen och puckeln: bilarna hålls plana i luften
    airZones: [{ from: [-2, S], to: [9.5, S] }, { from: [21, N], to: [10.1, N] }, { from: [W, 10], to: [W, 1] }],
    // Mild dosering i nordvästra kurvan. Brantare än så, och bilarna gled över kantvallen på utsidan.
    bank: [{ at: [W, N], deg: 11, fade: 5 }],
  },

  statics: [],
  // Saker att köra igenom och en badboll som korsar vägen
  // Saker att köra igenom och badbollar som korsar vägen (vid sidan av körlinjen)
  props: [
    ...cartonWall(0.245, { lateral: -1.7, across: 4, layers: 2 }),
    { kind: 'bigball', at: 0.304, lateral: 2.0, color: 0xff5a4a, roll: { period: 6, speed: 3.2 } },
    ...canPyramid(0.37, { lateral: 1.7, base: 4 }),
    { kind: 'bigball', at: 0.664, lateral: -2.0, color: 0xffc533, roll: { period: 7, speed: 3.4, phase: 3 } },
    ...cartonWall(0.762, { lateral: 1.7, across: 4, layers: 2 }),
  ],

  evening: true,
  environment({ scene, world, RAPIER, track }) {
    return buildPark({ scene, world, RAPIER, track, night: !!this.night });
  },
};

function buildPark({ scene, world, RAPIER, track, night = false }) {
  const B = scene ? new HoodBatch() : null;
  if (B) B.night = night;
  const r = rng(808);
  const off = (x, z) => Math.sqrt(track.nearest(x, z).d2) - track.roadHalf; // meter utanför vägkanten
  makeGround(scene, world, RAPIER, { size: 130 });

  // Plank runt parken
  const P = 56;
  addPlankFence(B, world, RAPIER, { points: [[-P, -P], [P, -P], [P, P], [-P, P], [-P, -P]], h: 1.5 });

  // Mittlinje på de plana delarna (ramperna är omålad plywood)
  if (B) addTrackPaint(B, track, { centre: (i) => !track.isGap[i] && track.pts[i].y < 0.02 });

  // Lekplatsen och kiosken mitt i slingan, långt från vägen, med häckar runt
  const PLAY = 12, PX = -9; // lekplatsens halva sida och mitt (innanför västra rakan och S-kurvan)
  addSandbox(B, world, RAPIER, { x: PX - 6, z: 4, rot: 0.2, s: 2.2 });
  addSwingSet(B, world, RAPIER, { x: PX + 5, z: -5, rot: 0.1 });
  addSlide(B, world, RAPIER, { x: PX + 6.5, z: 6, rot: -0.6 });
  addBooth(B, world, RAPIER, { x: PX - 8, z: -8, rot: 0.5 });
  for (const [x, z, w, rot] of [[PX, -PLAY, 16, 0], [PX, PLAY, 16, 0], [PX - PLAY, 0, 16, Math.PI / 2], [PX + PLAY, 0, 16, Math.PI / 2]]) {
    addHedge(B, world, RAPIER, { x, z, w, d: 0.7, h: 0.9, rot });
  }

  // Avspärrningar och koner vid sidan av ramperna, så att hoppen syns på håll
  for (let i = 1; i < track.N; i++) {
    const lip = track.pts[i].y > 0.6 && track.pts[i].y >= track.pts[i - 1].y && track.pts[(i + 1) % track.N].y < track.pts[i].y;
    if (!lip) continue;
    const n = track.normals[i];
    for (const side of [1, -1]) {
      const a = track.poseAt(i - 6, side * (track.roadHalf + 1.3));
      addBarricade(B, world, RAPIER, { x: a.x, z: a.z, rot: Math.atan2(n.x, n.z) + Math.PI / 2 });
      for (const k of [14, 20, 26]) { const c = track.poseAt(i - k, side * (track.roadHalf + 0.9)); addCone(B, world, RAPIER, { x: c.x, z: c.z }); }
    }
  }

  // Villor bakom planket, så att parken ligger i ett bostadsområde
  const HOUSES = [[-30, -68, 0, 0xe9d3b8], [-6, -68, 0, 0xcfe0ea], [20, -68, 0, 0xf0d3c6], [68, -20, -Math.PI / 2, 0xdfe8c9], [68, 8, -Math.PI / 2, 0xe9d3b8], [-68, 6, Math.PI / 2, 0xf0d3c6], [-12, 68, Math.PI, 0xcfe0ea], [16, 68, Math.PI, 0xdfe8c9]];
  HOUSES.forEach(([x, z, rot, siding], k) => addHouse(B, world, RAPIER, { x, z, rot, w: 9.4, d: 7.6, garage: null, toStreet: 6, seed: 60 + k, siding, roof: 0x55575c, accent: 0x24344f }));
  // Parkerade bilar i full storlek utanför planket ger skalan
  addCar(B, world, RAPIER, { x: -20, z: -60.5, rot: Math.PI / 2, kind: 'sedan', color: 0x2a5d9a });
  addCar(B, world, RAPIER, { x: 8, z: -60.5, rot: Math.PI / 2, kind: 'pickup', color: 0xb23a2c });

  // Träd i gräset, både innanför och utanför slingan, aldrig närmare vägen än tre meter
  let seed = 1;
  for (let k = 0; k < 60; k++) {
    const x = (r() - 0.5) * 104, z = (r() - 0.5) * 104;
    if (off(x, z) < 3.2 || (Math.abs(x - PX) < PLAY + 2 && Math.abs(z) < PLAY + 2)) continue;
    addTree(B, world, RAPIER, { x, z, h: 7 + r() * 4, s: 2.4 + r() * 1.4, seed: seed++, tint: r() * 0.5 });
  }

  // Lyktor längs utsidan av rakorna (tänds på kvällen) och papperskorgar vid dem
  for (let i = 0; i < track.N; i += Math.round(26 / track.spacing)) {
    const p = track.poseAt(i, track.roadHalf + 1.6), n = track.normals[i];
    if (track.pts[i].y > 0.05) continue; // inte bredvid ramperna
    addLamp(B, world, RAPIER, { x: p.x, z: p.z, rot: Math.atan2(-n.x, -n.z) });
    const q = track.poseAt(i + 4, track.roadHalf + 1.8);
    addBin(B, world, RAPIER, { x: q.x, z: q.z, rot: Math.atan2(-n.x, -n.z) });
  }

  if (B) {
    const far = [];
    for (let k = 0; k < 70; k++) {
      const a = r() * Math.PI * 2, d = 66 + r() * 60;
      far.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, s: 4 + r() * 4, seed: k });
    }
    addFarTrees(B, far);
    B.flush(scene);
  }
  return [];
}
