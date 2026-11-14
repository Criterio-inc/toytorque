import {
  HoodBatch, makeGround, addTree, addLamp, addPlankFence, addFarTrees, addBin, addTrackPaint,
  addSwingSet, addSlide, addSandbox, addBooth, addHedge, addCar,
} from './hoodArt.js';
import { rng } from './warehouseArt.js';
import { cartonWall, canPyramid } from './stacks.js';

// ---------------------------------------------------------------------------
// Nivå: Skejtparken. En bred betongslinga i ett grönområde, byggd för fart och
// luft: två stora hopp, en puckel där bilarna lättar, en vågbana och två
// doserade kurvor. Vägen är bredare än på de andra banorna, så att det finns
// plats att välja linje och köra om.
// ---------------------------------------------------------------------------

const X = 34, Z = 30; // slingans hörn (halva bredden och djupet)

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
    checkpoints: 18,
    barrierHeight: 0.16,
    barrierThick: 0.2,
    lineMargin: 0.8,
    start: { x: -16, z: -Z },
    // Medurs sett uppifrån: startrakan österut, östra rakan norrut, norra rakan
    // västerut och västra rakan söderut. Stora radier, så att farten hålls uppe.
    corners: [
      { x: X, z: -Z, r: 12 },
      { x: X, z: Z, r: 12 },
      { x: -X, z: Z, r: 12 },
      { x: -X, z: -Z, r: 12 },
    ],
    elevation: [
      // Stora hoppet på startrakan: rak ramp ända ut i kanten, glapp, lång landning nedför
      { at: [-4, -Z], y: 0 },
      { at: [0, -Z], y: 0.1 },
      { at: [8, -Z], y: 0.75, linear: true },
      { at: [9.4, -Z], y: 0.54, linear: true },
      { at: [15, -Z], y: 0.24, linear: true },
      { at: [20, -Z], y: 0 },
      // Puckeln på östra rakan: uppför, krön där bilarna lättar, nedför
      { at: [X, -15], y: 0 },
      { at: [X, -4], y: 0.6 },
      { at: [X, 7], y: 0 },
      // Andra hoppet på norra rakan
      // (en bit in på rakan: direkt efter den doserade kurvan kom bilarna snett in i rampen)
      { at: [7, Z], y: 0 },
      { at: [3, Z], y: 0.08 },
      { at: [-4, Z], y: 0.7, linear: true },
      { at: [-5.2, Z], y: 0.5, linear: true },
      { at: [-10, Z], y: 0.2, linear: true },
      { at: [-15, Z], y: 0 },
      // Vågbanan på västra rakan: två låga vågor efter varandra
      { at: [-X, 15], y: 0 },
      { at: [-X, 9], y: 0.4 },
      { at: [-X, 3], y: 0 },
      { at: [-X, -3], y: 0.4 },
      { at: [-X, -9], y: 0 },
    ],
    gaps: [{ from: [8, -Z], to: [9.4, -Z] }, { from: [-4, Z], to: [-5.2, Z] }],
    // De stora hoppen och puckeln: bilarna hålls plana i luften
    airZones: [{ from: [-3, -Z], to: [7.9, -Z] }, { from: [6, Z], to: [-3.9, Z] }, { from: [X, -14], to: [X, -3] }],
    // Doserade kurvor i nordöst och sydväst
    bank: [{ at: [X, Z], deg: 16, fade: 6 }, { at: [-X, -Z], deg: 16, fade: 6 }],
  },

  statics: [],
  // Saker att köra igenom och en badboll som korsar vägen
  props: [
    ...cartonWall(0.23, { lateral: -1.8, across: 4, layers: 2 }),
    ...canPyramid(0.645, { lateral: 1.7, base: 4 }),
    { kind: 'bigball', at: 0.71, lateral: -2.1, color: 0xffc533, roll: { period: 7, speed: 3.4 } },
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
  const PLAY = 13; // lekplatsens halva sida
  addSandbox(B, world, RAPIER, { x: -6, z: 4, rot: 0.2, s: 2.2 });
  addSwingSet(B, world, RAPIER, { x: 5, z: -5, rot: 0.1 });
  addSlide(B, world, RAPIER, { x: 6.5, z: 6, rot: -0.6 });
  addBooth(B, world, RAPIER, { x: -9, z: -8, rot: 0.5 });
  for (const [x, z, w, rot] of [[0, -PLAY, 16, 0], [0, PLAY, 16, 0], [-PLAY, 0, 16, Math.PI / 2], [PLAY, 0, 16, Math.PI / 2]]) {
    addHedge(B, world, RAPIER, { x, z, w, d: 0.7, h: 0.9, rot });
  }
  // Parkerade bilar i full storlek utanför planket ger skalan
  addCar(B, world, RAPIER, { x: -20, z: -60.5, rot: Math.PI / 2, kind: 'sedan', color: 0x2a5d9a });
  addCar(B, world, RAPIER, { x: 8, z: -60.5, rot: Math.PI / 2, kind: 'pickup', color: 0xb23a2c });

  // Träd i gräset, både innanför och utanför slingan, aldrig närmare vägen än tre meter
  let seed = 1;
  for (let k = 0; k < 60; k++) {
    const x = (r() - 0.5) * 104, z = (r() - 0.5) * 104;
    if (off(x, z) < 3.2 || (Math.abs(x) < PLAY + 2 && Math.abs(z) < PLAY + 2)) continue;
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
