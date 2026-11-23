import {
  HoodBatch, makeGround, addTree, addLamp, addPlankFence, addFarTrees, addBin, addTrackPaint,
  addSwingSet, addSlide, addSandbox, addBooth, addHedge, addCar, addHouse,
} from './hoodArt.js';
import { rng } from './warehouseArt.js';
import { hillsAt } from './terrain.js';
import { cartonWall, canPyramid, coneRow, ballGroup } from './stacks.js';
import { addKicker, addMound, addSlab, addPlayTunnel } from './playground.js';

// ---------------------------------------------------------------------------
// Nivå: Skejtparken. En öppen betongbana i ett grönområde utan kantvallar, byggd för fart och
// luft: ett bordshopp på startrakan, en S-kurva över en gräspuckel, ett stort
// hopp och sedan uppför till utsiktsplatån i nordväst, där skålen ligger. Från
// platån går det brant ner till västra rakan, och åt sidorna är det stup. Vägen är bredare än på de andra banorna, så att det finns
// plats att välja linje och köra om.
// ---------------------------------------------------------------------------

const S = -30, N = 32, W = -34; // startrakan (söder), norra rakan och västra rakan

export const skejtparken = {
  id: 'skejtparken',
  name: 'Skejtparken',
  layout: 2, // terräng sedan 2026-11-23: äldre spökbilar gäller inte
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
    // Öppen bana: inga kantvallar, och kontrollpunkterna är så breda att det går att gena
    // över gräset i kurvorna. Hela S-kurvan går inte att hoppa över, då missas kontrollpunkter.
    freeRoam: true,
    // Skålen: den doserade kurvan i nordväst har kvar sin sarg. Utan den blir doseringen en utkastramp.
    closed: [{ from: [-20, N], to: [W, 16] }],
    checkpointHalf: 13,
    start: { x: -10, z: S },
    // Medurs sett uppifrån: startrakan österut med bordshoppet, en S-kurva i öster,
    // norra rakan västerut med stora hoppet och en våg, skålen i nordväst och västra rakan
    // som ren fartsträcka söderut. (En puckel där låg för nära kurvorna i båda ändar.)
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
    ],
    // Utsiktsplatån i nordväst (skålen ligger uppe på den) och en gräspuckel i S-kurvan
    terrain: {
      hills: [
        { terrace: true, x: -30, z: 27, ax: 25, az: 26, ex: 17, ez: 17, h: 3.0 },
        { x: 16, z: 2, rx: 6, rz: 9, h: 0.7 },
      ],
      blend: 3,
    },
    gaps: [{ from: [10, N], to: [8.6, N] }],
    // Hoppen: bilarna hålls plana i luften
    airZones: [{ from: [-2, S], to: [9.5, S] }, { from: [21, N], to: [10.1, N] }],
    // Skålen uppe på platån och kurvan in mot startrakan
    bank: [{ at: [W, N], deg: 16, fade: 5 }, { at: [36, S - 2], deg: 16, fade: 5 }],
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
    // Fotbollsträning på gräset: en rad koner och kvarglömda bollar
    ...coneRow(0.83, { lateral: 5.5, count: 6, gap: 1.2 }),
    ...ballGroup(0.86, { lateral: 6.5, count: 3 }),
    ...ballGroup(0.47, { lateral: -5.5, count: 2 }),
  ],

  evening: true,
  environment({ scene, world, RAPIER, track }) {
    return buildPark({ scene, world, RAPIER, track, night: !!this.night });
  },
};

// Gräskullar på genvägarna över kurvornas insidor (sydöst, nordöst och sydväst)
const MOUNDS = [
  { x: 25.5, z: -21.5, r: 3.4, h: 0.36 },
  { x: 30.5, z: 24.5, r: 3.2, h: 0.34 },
  { x: -25, z: -21, r: 3.4, h: 0.36 },
];
// Skejtytan innanför startrakan: två plywoodramper i rad på betongplattan
const KICKERS = [
  { x: -10, z: S + 7.5, rot: Math.PI / 2, h: 0.5 },
  { x: 6, z: S + 7.5, rot: Math.PI / 2, h: 0.55, w: 2.2 },
];

function buildPark({ scene, world, RAPIER, track, night = false }) {
  const B = scene ? new HoodBatch() : null;
  if (B) B.night = night;
  const r = rng(808);
  const off = (x, z) => Math.sqrt(track.nearest(x, z).d2) - track.roadHalf; // meter utanför vägkanten
  // Gräset har sämre grepp än betongen: vägen är snabbast, men gräset är en möjlighet
  const ground = track.ground;
  const gy = (x, z) => ground.heightAt(x, z);
  // Saker utan egen höjd ställs bara där marken är plan
  const level = (x, z, rad = 1) => [[0, 0], [rad, 0], [-rad, 0], [0, rad], [0, -rad]].every(([a, b]) => Math.abs(gy(x + a, z + b)) < 0.04);
  makeGround(scene, world, RAPIER, { size: 130, grip: 0.72, ground });

  // Plank runt parken
  const P = 56;
  addPlankFence(B, world, RAPIER, { points: [[-P, -P], [P, -P], [P, P], [-P, P], [-P, -P]], h: 1.5, ground });

  // I terrängen, för den som lämnar vägen. Allt är sådant som finns i en park på riktigt:
  // gräskullar på kurvornas insidor, en skejtyta med två ramper på en betongplatta
  // innanför startrakan och en krypgång på lekplatsen.
  for (const m of MOUNDS) addMound(scene, world, RAPIER, m);
  addSlab(scene, { x: -2, z: S + 7.5, rot: Math.PI / 2, w: 4.4, l: 26 });
  for (const k of KICKERS) addKicker(scene, world, RAPIER, k);
  // Stadga i luften efter kullar och ramper, som vid de stora hoppen på vägen
  track.airSpots = [...MOUNDS.map((m) => ({ x: m.x, z: m.z, r: m.r ?? 2.6 })), ...KICKERS.map((k) => ({ x: k.x, z: k.z, r: 2.4 }))];

  // Mittlinje på de plana delarna (ramperna är omålad plywood)
  const ramp = (i) => track.pts[i].y - hillsAt(skejtparken.track.terrain.hills, track.pts[i].x, track.pts[i].z) > 0.02;
  if (B) addTrackPaint(B, track, { centre: (i) => !track.isGap[i] && !ramp(i) });

  // Lekplatsen och kiosken mitt i slingan, långt från vägen, med häckar runt
  // (flyttad söderut och österut, bort från platåns slänt)
  const PLAY = 10, PX = 0, PZ = -6; // lekplatsens halva sida och mitt
  addSandbox(B, world, RAPIER, { x: PX - 5, z: PZ + 3.5, rot: 0.2, s: 2.2 });
  addSwingSet(B, world, RAPIER, { x: PX + 4, z: PZ - 4.5, rot: 0.1 });
  addSlide(B, world, RAPIER, { x: PX + 5.5, z: PZ + 5, rot: -0.6 });
  addBooth(B, world, RAPIER, { x: PX - 6.5, z: PZ - 6.5, rot: 0.5 });
  addPlayTunnel(scene, world, RAPIER, { x: PX - 1, z: PZ - 1.5, rot: 0.9, len: 3.2 }); // krypgången
  for (const [x, z, w, rot] of [[PX, PZ - PLAY, 14, 0], [PX, PZ + PLAY, 14, 0], [PX - PLAY, PZ, 14, Math.PI / 2], [PX + PLAY, PZ, 14, Math.PI / 2]]) {
    addHedge(B, world, RAPIER, { x, z, w, d: 0.7, h: 0.9, rot });
  }

  // Villor bakom planket, så att parken ligger i ett bostadsområde
  const HOUSES = [[-30, -68, 0, 0xe9d3b8], [-6, -68, 0, 0xcfe0ea], [20, -68, 0, 0xf0d3c6], [68, -20, -Math.PI / 2, 0xdfe8c9], [68, 8, -Math.PI / 2, 0xe9d3b8], [-68, 6, Math.PI / 2, 0xf0d3c6], [-12, 68, Math.PI, 0xcfe0ea], [16, 68, Math.PI, 0xdfe8c9]];
  HOUSES.forEach(([x, z, rot, siding], k) => addHouse(B, world, RAPIER, { x, z, rot, w: 9.4, d: 7.6, garage: null, toStreet: 6, seed: 60 + k, siding, roof: 0x55575c, accent: 0x24344f }));
  // Parkerade bilar i full storlek utanför planket ger skalan
  addCar(B, world, RAPIER, { x: -20, z: -60.5, rot: Math.PI / 2, kind: 'sedan', color: 0x2a5d9a });
  addCar(B, world, RAPIER, { x: 8, z: -60.5, rot: Math.PI / 2, kind: 'pickup', color: 0xb23a2c });

  // Träd i gräset, både innanför och utanför slingan, aldrig närmare vägen än sju meter
  let seed = 1;
  for (let k = 0; k < 110; k++) {
    const x = (r() - 0.5) * 104, z = (r() - 0.5) * 104;
    if (off(x, z) < 7 || (Math.abs(x - PX) < PLAY + 2 && Math.abs(z - PZ) < PLAY + 2) || !level(x, z, 1.5)) continue;
    addTree(B, world, RAPIER, { x, z, h: 7 + r() * 4, s: 2.4 + r() * 1.4, seed: seed++, tint: r() * 0.5 });
  }

  // Lyktor längs utsidan av rakorna (tänds på kvällen) och papperskorgar vid dem
  for (let i = 0; i < track.N; i += Math.round(26 / track.spacing)) {
    const p = track.poseAt(i, track.roadHalf + 6), n = track.normals[i]; // en bra bit ut: gräset närmast vägen är körbar yta
    if (ramp(i) || !level(p.x, p.z, 0.6)) continue; // inte bredvid ramperna eller i backarna
    addLamp(B, world, RAPIER, { x: p.x, z: p.z, rot: Math.atan2(-n.x, -n.z) });
    const q = track.poseAt(i + 4, track.roadHalf + 6.3);
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
