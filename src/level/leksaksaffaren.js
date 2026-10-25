import * as THREE from 'three';
import { addUnderlay } from '../track/track.js';
import {
  Batch, C, rng, SIGN, FUR, makePlankFloor, makeStoreHall, addCeilingLights, addPlankLane, addRainbowSection,
  addBrandPlatform, addBrandPyramid, addWallShelf, addGondola, addSign, addBlockWall, addLooseBlock, addTeddy, addRobot,
  addArchTunnel, addRubberBall, addBallPit, addTrainLoop, addRacingSet, addBunting, addNeonTube, addPodium, addToyRocket,
  addStartGate, addRailStraight, addToyStairs, addWindupLoco, addWindupCar, addCarTransporter, addCastleWall,
} from './toystoreArt.js';

// ---------------------------------------------------------------------------
// Nivå: Leksaksaffären. En stor leksaksbutik efter stängning, i riktig skala
// (meter). Startrakan med hoppet går längs kartongpyramiderna och svänger i en
// doserad kurva upp på östra rakan, som klättrar uppför regnbågsrampen till
// övervåningen på jättekartongen. Därifrån flyger banan ut över trappan ner
// till bottenvåningen och landar på trappans nedre steg, sedan förbi
// tågbanan, genom bollhavsviken och in i den gröna borgtunneln vid roboten.
// Genvägen från bucklan hoppar över en tågräls och går genom borgens
// sidoport. Vid starten står uppdragsbilen med jättenyckeln och biltransporten.
// ---------------------------------------------------------------------------

const SIZE = 84, H = 8;
const N = -26;      // startrakans z
const EAST = 34;    // östra rakans x
const WEST = -34;   // västra rakans x
const SOUTH = 30;   // södra rakans z
const J = 4;        // hoppkanten på startrakan
const PLAT = 1.2;   // övervåningens (plattformens) höjd
// Trappan ner från övervåningen på östra rakan (körs mot +z): från kanten z0
// ner till golvet vid z1, glapp från kanten till z0 + gap. Stegnosarna ligger
// på linjen mellan kanten och foten, så landningen följer trappan.
const STAIRS = { z0: 7, z1: 15.5, gap: 2.3 };
const stairY = (z) => PLAT * (STAIRS.z1 - z) / (STAIRS.z1 - STAIRS.z0);
// Foten: en parabel från trappans lutning till plant golv över ±2 m
const STAIR_FOOT = [-2, -1, 0, 1, 2].map((d) => [d, ((PLAT / (STAIRS.z1 - STAIRS.z0)) / 8) * (d - 2) ** 2]);

// Genvägen genom sidoporten: från bucklan i innerfältet rakt mot borgen,
// hopp över en tågräls, genom borgens sidoport och in på norra rakan.
// Hörnen vid borgen delas i två korta brytpunkter så att de blir snävare
// än avfartens mjuka böj (avrundningen begränsas av den korta sträckan).
const SC = {
  A: [3.5, 25], V1: [-5.5, 7], V2a: [-25.41, -3.65], V2b: [-27, -6.3],
  V3a: [-27, -19.6], V3b: [-20.64, -25.96], B: [-12, N],
};
const scAt = (s) => {
  const [x0, z0] = SC.V1, [x1, z1] = SC.V2a, L = Math.hypot(x1 - x0, z1 - z0);
  return [x0 + ((x1 - x0) / L) * s, z0 + ((z1 - z0) / L) * s];
};
const SC_JUMP = 14.5; // hoppkanten (meter efter V1)
const SHORTCUT = {
  from: SC.A, to: SC.B, via: [SC.V1, SC.V2a, SC.V2b, SC.V3a, SC.V3b], r: 30, roadHalf: 1.35, ai: 0.25,
  elevation: [
    { at: scAt(10), y: 0 },
    { at: scAt(11), y: 0.04 },
    { at: scAt(SC_JUMP), y: 0.32, linear: true },
    { at: scAt(SC_JUMP + 1), y: 0.24, linear: true },
    { at: scAt(SC_JUMP + 5), y: 0.08, linear: true },
    { at: scAt(SC_JUMP + 7), y: 0 },
  ],
  gaps: [
    { from: [3.3, 24.6], to: scAt(6.8) }, // avfarten: inga vallar
    { from: scAt(SC_JUMP), to: scAt(SC_JUMP + 1) }, // hoppet över rälsen
    { from: [-24.3, -23.2], to: [-12.3, -25.98] }, // påfarten: inga vallar
  ],
};

export const leksaksaffaren = {
  id: 'leksaksaffaren',
  name: 'Leksaksaffären',
  laps: 3,
  sky: 0x0c0e1c,
  skyGradient: [0x05060d, 0x141831, 0x0c0e1c],
  fog: { near: 34, far: 120, color: 0x121630 },
  lighting: {
    sun: { color: 0xffd9a8, intensity: 0.75, offset: [5, 30, 7] },
    hemi: { sky: 0x4a5aa8, ground: 0x4a2a14, intensity: 0.4 },
    exposure: 0.92,
    envIntensity: 0.32,
  },
  floor: { size: SIZE },

  track: {
    scale: 1,
    roadHalf: 1.6,
    spacing: 0.6,
    checkpoints: 16,
    barrierHeight: 0.2,
    barrierThick: 0.12,
    start: { x: 22, z: N }, // efter hoppet: första varvet når hoppet i full fart
    corners: [
      { x: WEST, z: N, r: 6 },
      { x: EAST, z: N, r: 6 },
      { x: EAST, z: SOUTH, r: 6 },
      { x: 6, z: SOUTH, r: 6 },
      { x: -6, z: 6, r: 6 },
      { x: WEST, z: 16, r: 6 },
    ],
    elevation: [
      // Regnbågsrampen upp till övervåningen och trappan ner (östra rakan)
      { at: [EAST, -16], y: 0 },
      { at: [EAST, -5], y: PLAT },
      { at: [EAST, STAIRS.z0 - 1.4], y: PLAT },
      { at: [EAST, STAIRS.z0], y: PLAT, linear: true },
      { at: [EAST, STAIRS.z0 + STAIRS.gap], y: stairY(STAIRS.z0 + STAIRS.gap), linear: true },
      // Mjuk övergång till golvet vid trappans fot (en knyck kastar upp bilen)
      ...STAIR_FOOT.map(([d, y]) => ({ at: [EAST, STAIRS.z1 + d], y, linear: true })),
      // Hoppet på startrakan: rak ramp ända ut i kanten, glapp, landning nedför
      { at: [J - 8.5, N], y: 0 },
      { at: [J - 5.5, N], y: 0.06 },
      { at: [J, N], y: 0.46, linear: true },
      { at: [J + 1.2, N], y: 0.32, linear: true },
      { at: [J + 4, N], y: 0.14, linear: true },
      { at: [J + 9.5, N], y: 0 },
    ],
    gaps: [{ from: [J, N], to: [J + 1.2, N] }, { from: [EAST, STAIRS.z0], to: [EAST, STAIRS.z0 + STAIRS.gap] }],
    // Hörnet upp mot östra rakan är doserat
    bank: [{ at: [EAST, N], deg: 12, fade: 7 }],
    // Vallarna öppnas där genvägen delar sig och går ihop med banan
    openings: [{ from: [5, 28], to: [-12, 8.1] }, { from: [-30.5, -25], to: [-10, N] }],
    shortcuts: [SHORTCUT],
  },

  trackTheme: {
    road: '#4a2c18', roadRough: 0.5, side: '#3a2414', pillar: '#ffd23f',
    barrierA: 0x1e6fd9, barrierB: 0xffd23f,
  },

  statics: [],
  props: [],

  environment({ scene, world, RAPIER, track }) {
    return buildToyStore({ scene, world, RAPIER, track });
  },
};

function buildToyStore({ scene, world, RAPIER, track }) {
  const B = scene ? new Batch() : null;
  const half = SIZE / 2;
  const clearance = track.roadHalf + track.barrier.thick;
  const roadDist = (x, z) => Math.sqrt(track.nearest(x, z).d2);
  const offRoad = (x, z, rad = 0.3) => roadDist(x, z) > clearance + rad + 0.4;

  makePlankFloor(scene, world, RAPIER, { size: SIZE });
  makeStoreHall(scene, world, RAPIER, { size: SIZE, height: H });
  addCeilingLights(B, { size: SIZE, height: H });
  addPlankLane(scene, track);

  // --- regnbågsrampen, övervåningen på jättekartongen och trappan ner --------
  const iAt = (x, z) => track.nearest(x, z).index;
  const r0 = iAt(EAST, -17);
  const p0 = iAt(EAST, -5);
  // Kanten: första glappunkten på östra rakan; foten: där vägen når golvet
  let p1 = p0;
  while (!track.isGap[p1 + 1]) p1++;
  let s1 = p1 + 1;
  while (track.pts[s1].y > 0.002) s1++;
  const onPlat = (i) => i >= p0 && i <= p1;
  addRainbowSection(B, scene, track, { i0: r0, i1: p0 + 1, skip: onPlat });
  addBrandPlatform(B, world, RAPIER, track, { a: p0, b: p1 });
  {
    const a = track.pts[p1 + 1], b = track.pts[s1];
    addToyStairs(B, world, RAPIER, { top: { x: a.x, z: a.z }, bottom: { x: b.x, z: b.z }, y: a.y, half: clearance + 1.6 });
    if (world) addUnderlay(world, RAPIER, track, p1, s1, clearance + 1.6);
  }
  {
    const p = track.poseAt(Math.round((p0 + p1) / 2));
    addStartGate(B, world, RAPIER, { x: p.x, z: p.z, heading: p.heading, half: clearance + 0.35, strip: SIGN.brand, base: PLAT, post: 0xd8241c, neon: 0xffd23f });
  }
  addBrandPyramid(B, world, RAPIER, { x: 38.6, z: -8, rot: -Math.PI / 2, rows: 3 });
  // Hoppets ramper i gult och blått
  const j0 = iAt(J - 6, N), j1 = iAt(J + 10, N);
  addRainbowSection(B, scene, track, { i0: j0, i1: j1, palette: [0xffd23f, 0x1e6fd9], keyLen: 2 });

  // --- startportal, uppdragsbilen och biltransporten ------------------------
  {
    const p = track.poseAt(0);
    addStartGate(B, world, RAPIER, { x: p.x, z: p.z, heading: p.heading, half: clearance + 0.35 });
    addWindupCar(B, world, RAPIER, { x: 16.5, z: -31.4, rot: Math.PI / 2 + 0.12, s: 1.15 });
    addCarTransporter(B, world, RAPIER, { x: 12.5, z: -21.6, rot: Math.PI / 2 });
  }

  // --- genvägen: hopp över tågrälsen och borgens sidoport --------------------
  for (const sc of track.shortcuts) {
    const path = sc.path;
    addPlankLane(scene, path);
    // Hoppets ramper i rött och gult, rälsen tvärs under glappet
    let g0 = -1, g1 = -1;
    for (let i = 0; i < path.N - 1; i++) if (path.isGap[i] && path.pts[i].y > 0.02) { if (g0 < 0) g0 = i; g1 = i; }
    if (g0 > 0) {
      const ramp = (i) => path.pts[i].y > 0.005;
      let a = g0, b = g1;
      while (a > 0 && ramp(a - 1)) a--;
      while (b < path.N - 2 && ramp(b + 1)) b++;
      addRainbowSection(B, scene, path, { i0: a, i1: b + 1, palette: [0xe8352b, 0xffd23f], keyLen: 2 });
      // Osynlig svacka i glappet: en långsam bil som inte flyger över rälsen
      // rullar ner och upp igen i stället för att fastna mellan kanterna
      if (world) addUnderlay(world, RAPIER, path, g0 - 1, g1 + 1, path.roadHalf, 0.008, 0.07);
      const m = path.poseAt(Math.round((g0 + g1) / 2));
      addRailStraight(B, { x: m.x, z: m.z, rot: m.heading + Math.PI / 2, len: 9 });
      const side = path.poseAt(Math.round((g0 + g1) / 2), -3.2);
      addWindupLoco(B, world, RAPIER, { x: side.x + Math.sin(m.heading) * 0.0, z: side.z, rot: m.heading + Math.PI / 2, s: 1.1 });
    }
    // Sidoporten: en mindre borgtunnel på genvägens raka bit vid borgen
    let i0 = -1, i1 = -1;
    for (let i = 0; i < path.N - 1; i++) {
      const p = path.pts[i];
      if (Math.abs(p.x - SC.V2b[0]) < 0.05 && p.z < -7.6 && p.z > -15.6) { if (i0 < 0) i0 = i; i1 = i; }
    }
    if (i0 >= 0) {
      const p0 = path.pts[i0], p1 = path.pts[i1];
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const mid = path.poseAt(Math.round((i0 + i1) / 2));
      addArchTunnel(B, world, RAPIER, { x: mid.x, z: mid.z, heading: mid.heading, length: len, innerHalf: path.roadHalf + path.barrier.thick + 0.33 });
      // Borgmur mellan genvägen och västra rakan söder om sidoporten
      addCastleWall(B, world, RAPIER, { a: [-30.4, p1.z - 0.2], b: [-30.4, -19.5], h: 2.4 });
      if (scene) {
        const l = new THREE.PointLight(0x39ff6a, 16, 10, 1.6);
        l.position.set(mid.x, 2.2, mid.z);
        scene.add(l);
      }
    }
    // Klossar på ytterkanten av avfartens böj där vallarna saknas
    // Den sista står närmare vägen där vallen börjar, så att en bil som går
    // ut i böjen leds in innanför vallen i stället för att hamna utanför den.
    for (const [s, lat] of [[0, -2.75], [5.5, -2.75], [7.6, -2.0]]) {
      const [x, z] = scAt(s);
      const k = path.nearest(x, z).index;
      const q = path.poseAt(k, lat);
      addBlockWall(B, world, RAPIER, { x: q.x, z: q.z, rot: q.heading + Math.PI / 2, cols: 3, rows: 1, s: 0.7, seed: 50 + s });
    }
  }
  // Klossmur norr om norra rakan där banan saknar vallar (påfarten)
  for (const [x, cols, txt] of [[-26.2, 5, 'TORQUE!'], [-20.4, 4, null], [-15.4, 4, 'R4'], [-10.4, 4, null]]) {
    addBlockWall(B, world, RAPIER, { x, z: N - 2.55, rot: 0, cols, rows: 2, s: 0.8, seed: 60 + cols, text: txt });
  }

  // --- väggarna: hyllor med kartonger runt hela butiken ---------------------
  const shelfD = 0.7, wallIn = half - shelfD / 2 - 0.02;
  let seed = 1;
  const trims = [0x1e6fd9, 0xe8352b, 0x3fbf4a, 0xffd23f, 0x9440c8];
  // Norra väggen (fronten mot +z), lucka i mitten för märkesskylten
  for (const [x0, x1] of [[-40, -6], [10, 40]]) addWallShelf(B, world, RAPIER, { x: (x0 + x1) / 2, z: -wallIn, rot: 0, len: x1 - x0, seed: seed++, trim: trims[seed % 5] });
  // Södra väggen (fronten mot -z)
  for (const [x0, x1] of [[-40, -14], [-8, 40]]) addWallShelf(B, world, RAPIER, { x: (x0 + x1) / 2, z: wallIn, rot: Math.PI, len: x1 - x0, seed: seed++, trim: trims[seed % 5] });
  // Östra (fronten mot -x) och västra (fronten mot +x)
  for (const [z0, z1] of [[-40, -12], [-4, 40]]) addWallShelf(B, world, RAPIER, { x: wallIn, z: (z0 + z1) / 2, rot: -Math.PI / 2, len: z1 - z0, seed: seed++, trim: trims[seed % 5] });
  for (const [z0, z1] of [[-40, -14], [8, 40]]) addWallShelf(B, world, RAPIER, { x: -wallIn, z: (z0 + z1) / 2, rot: Math.PI / 2, len: z1 - z0, seed: seed++, trim: trims[seed % 5] });
  // Neonlister ovanpå hyllorna
  const nh = 3.22, ni = half - 0.05;
  addNeonTube(B, [-40, nh, -ni], [-6, nh, -ni], 0xff4fd8);
  addNeonTube(B, [10, nh, -ni], [40, nh, -ni], 0x39e6ff);
  addNeonTube(B, [-40, nh, ni], [-14, nh, ni], 0x39ff6a);
  addNeonTube(B, [-8, nh, ni], [40, nh, ni], 0xffd23f);
  addNeonTube(B, [ni, nh, -40], [ni, nh, -12], 0x39ff6a);
  addNeonTube(B, [ni, nh, -4], [ni, nh, 40], 0xff4fd8);
  addNeonTube(B, [-ni, nh, -40], [-ni, nh, -14], 0x39e6ff);
  addNeonTube(B, [-ni, nh, 8], [-ni, nh, 40], 0xffd23f);

  // Butiksnamnet i neon på norra väggen och märket på östra
  addSign(B, { x: 2, y: 5.4, z: -half + 0.12, rot: 0, w: 12, h: 1.5, strip: SIGN.store });
  addSign(B, { x: half - 0.12, y: 5.2, z: -8, rot: -Math.PI / 2, w: 9, h: 1.1, strip: SIGN.brand });
  addSign(B, { x: -half + 0.12, y: 5.2, z: -3, rot: Math.PI / 2, w: 8, h: 1.0, strip: SIGN.sale });
  addSign(B, { x: -11, y: 5.0, z: half - 0.12, rot: Math.PI, w: 8, h: 1.0, strip: SIGN.store });

  // --- norra gången: märkespyramider, bilbana och klossar -------------------
  addBrandPyramid(B, world, RAPIER, { x: 2, z: -38.6, rows: 4 });
  addBrandPyramid(B, world, RAPIER, { x: 26, z: -33, rot: 0.15, rows: 3 });
  addBrandPyramid(B, world, RAPIER, { x: 31.5, z: -31.5, rot: -0.5, rows: 2 });
  addRacingSet(B, world, RAPIER, { x: -20, z: -35.5, rot: 0 });
  addBlockWall(B, world, RAPIER, { x: -31, z: -35, rot: 0.25, cols: 5, rows: 3, s: 0.9, seed: 3, text: 'LEKSA' });
  addBlockWall(B, world, RAPIER, { x: 14, z: -35.8, rot: -0.1, cols: 4, rows: 2, s: 0.8, seed: 4, text: '123!' });
  addSign(B, { x: 2, y: 3.9, z: -36.5, rot: 0, w: 4.2, h: 0.62, strip: SIGN.brand, post: true });

  // --- innerfältet ----------------------------------------------------------
  // Gångar med gondoler: norra innerfältet (nord-sydliga) och sydöstra (öst-västliga)
  const heads = [SIGN.cars, SIGN.blocks, SIGN.plush, SIGN.trains, SIGN.sale];
  let gs = 11;
  for (const gx of [-20, -15.5, -11, 17, 21.5, 26]) {
    addGondola(B, world, RAPIER, { x: gx, z: -15.5, rot: Math.PI / 2, len: 8, seed: gs++, trim: trims[gs % 5], header: gs % 2 ? heads[gs % 5] : null });
  }
  for (const gz of [13, 17.5, 22]) {
    addGondola(B, world, RAPIER, { x: 21, z: gz, rot: 0, len: 11, seed: gs++, trim: trims[gs % 5], header: gz === 13 ? SIGN.trains : null });
  }
  addGondola(B, world, RAPIER, { x: 20, z: 3, rot: Math.PI / 2, len: 10, seed: gs++, trim: 0x3fbf4a, header: SIGN.trains });
  addGondola(B, world, RAPIER, { x: 25, z: 3, rot: Math.PI / 2, len: 10, seed: gs++, trim: 0xe8352b });
  addGondola(B, world, RAPIER, { x: -17, z: -7.5, rot: 0, len: 10, seed: gs++, trim: 0x9440c8, header: SIGN.plush });
  addGondola(B, world, RAPIER, { x: -24, z: 20, rot: 0, len: 9, seed: gs++, trim: 0x1e6fd9, header: SIGN.blocks });
  addGondola(B, world, RAPIER, { x: -36.5, z: 30, rot: Math.PI / 2, len: 8, seed: gs++, trim: 0xe8352b, header: SIGN.plush });
  addGondola(B, world, RAPIER, { x: -2, z: 34.5, rot: 0, len: 8, seed: gs++, trim: 0x3fbf4a, header: SIGN.cars });
  // Klossmurar
  addBlockWall(B, world, RAPIER, { x: 0, z: -6, rot: 0.1, cols: 6, rows: 3, s: 0.95, seed: 21, text: 'LEKSAK' });
  addBlockWall(B, world, RAPIER, { x: 0, z: -16, rot: -0.2, cols: 4, rows: 4, s: 0.8, seed: 22, pyramid: true });
  addBlockWall(B, world, RAPIER, { x: 9, z: 16, rot: 0.9, cols: 3, rows: 2, s: 0.9, seed: 23, text: 'R4' });
  addBlockWall(B, world, RAPIER, { x: -28, z: 6, rot: -0.3, cols: 3, rows: 3, s: 0.8, seed: 24, pyramid: true });
  // Nallemontern
  {
    const [nx, nz] = [-6.5, -11];
    addPodium(B, world, RAPIER, { x: nx, z: nz, r: 2.2, h: 0.35, color: 0xe86aa8, neon: 0xff4fd8 });
    addTeddy(B, world, RAPIER, { x: nx, z: nz, y: 0.35, rot: 0.6, s: 2.4, fur: FUR.honey });
    addTeddy(B, world, RAPIER, { x: nx - 1.1, z: nz + 1.2, y: 0.35, rot: 0.9, s: 0.9, fur: FUR.pink, bow: 0x1e6fd9, collide: false });
    addTeddy(B, world, RAPIER, { x: nx + 1.3, z: nz + 1.2, y: 0.35, rot: 0.2, s: 0.8, fur: FUR.white, bow: 0x3fbf4a, collide: false });
    addTeddy(B, world, RAPIER, { x: nx - 1.4, z: nz - 0.8, y: 0.35, rot: 1.6, s: 0.7, fur: FUR.blue, bow: 0xffd23f, collide: false });
  }
  // Raketmontern
  addPodium(B, world, RAPIER, { x: 12, z: -4, r: 1.3, h: 0.4, color: 0x1e6fd9, neon: 0x39e6ff });
  addToyRocket(B, { x: 12, z: -4, y: 0.4, s: 1.5 });
  // Tågbanan i innerfältet
  addTrainLoop(B, scene, { x: 5.5, z: 7.5, rot: 0, ls: 9, R: 2.6, speed: 1.7 });

  // --- sydvästra viken: bollhav, nallar och en till robot --------------------
  addBallPit(B, scene, world, RAPIER, { x: -20, z: 30, R: 3.2 });
  addSign(B, { x: -20, y: 2.6, z: 30, rot: 0.3, w: 3.4, h: 0.55, strip: SIGN.sale, post: true });
  addTeddy(B, world, RAPIER, { x: -31, z: 36.5, rot: Math.PI - 0.5, s: 1.8, fur: FUR.brown });
  addTeddy(B, world, RAPIER, { x: -8, z: 37, rot: Math.PI + 0.3, s: 1.4, fur: FUR.grey, bow: 0x9440c8 });
  addBlockWall(B, world, RAPIER, { x: -30, z: 24, rot: 0.6, cols: 3, rows: 2, s: 0.9, seed: 31, text: 'VOL' });
  addPodium(B, world, RAPIER, { x: -10, z: 24, r: 1.1, h: 0.35, color: 0xffd23f, neon: 0x39ff6a });
  addRobot(B, world, RAPIER, { x: -10, z: 24, rot: -2.4, s: 0.5 });

  // --- sydöstra gången: tåg- och racingmontrar --------------------------------
  addGondola(B, world, RAPIER, { x: 22, z: 36.2, rot: Math.PI, len: 12, seed: 41, trim: 0xffd23f, header: SIGN.trains });
  addPodium(B, world, RAPIER, { x: 38, z: 36, r: 1.4, h: 0.4, color: 0xe8352b, neon: 0xffd23f });
  addToyRocket(B, { x: 38, z: 36, y: 0.4, s: 1.2 });
  addBrandPyramid(B, world, RAPIER, { x: 38.5, z: 22, rot: -Math.PI / 2, rows: 3 });

  // --- västra rakan: borgtunneln med grönt neon och roboten -----------------
  {
    const ti = iAt(WEST, -4);
    const tp = track.pts[ti], tt = track.tangents[ti];
    addArchTunnel(B, world, RAPIER, { x: tp.x, z: tp.z, heading: Math.atan2(tt.x, tt.z), length: 8, innerHalf: clearance + 0.33 });
    addRobot(B, world, RAPIER, { x: WEST - 5.4, z: 2.4, rot: Math.PI / 2 - 0.5 });
    addTeddy(B, world, RAPIER, { x: WEST + 4.6, z: 3, rot: -Math.PI / 2 - 0.4, s: 1.2, fur: FUR.pink, bow: 0x39ff6a });
  }

  // --- vimplar tvärs över hallen ---------------------------------------------
  addBunting(B, [
    { a: [-half, 5.6, -20], b: [half, 5.6, -20], sag: 0.9 },
    { a: [-half, 5.2, 0], b: [half, 5.2, 0], sag: 1.0 },
    { a: [-half, 5.6, 20], b: [half, 5.6, 20], sag: 0.9 },
    { a: [-24, 6.0, -half], b: [-24, 6.0, half], sag: 1.1 },
    { a: [24, 6.0, -half], b: [24, 6.0, half], sag: 1.1 },
    { a: [-half, 6.2, -half], b: [half, 6.2, half], sag: 1.4 },
    { a: [half, 6.2, -half], b: [-half, 6.2, half], sag: 1.4 },
  ]);

  // Hängande runda lampor i färg
  if (B) {
    for (const [x, z, col] of [[-24, -20, 0xff4fd8], [24, -20, 0x39e6ff], [0, 0, 0xffd23f], [-24, 20, 0x39ff6a], [24, 20, 0xff8a1c], [0, -20, 0x9440c8], [0, 20, 0xe8352b]]) {
      addNeonTube(B, [x, H, z], [x, 5.9, z], 0x333333, 0.01);
      B.add('neon', new THREE.SphereGeometry(0.32, 16, 12).translate(x, 5.6, z), C(col));
    }
  }

  B?.flush(scene);

  // --- ljus: dämpat nattljus med färgade accenter ----------------------------
  if (scene) {
    const add = (light, x, y, z) => { light.position.set(x, y, z); scene.add(light); return light; };
    add(new THREE.PointLight(0x39ff6a, 30, 16, 1.6), WEST, 2.4, -4);
    add(new THREE.PointLight(0x39ff6a, 14, 10, 1.6), WEST - 3, 2.0, 2.5);
    add(new THREE.PointLight(0xff4fd8, 22, 18, 1.6), -18, 3.5, 28);
    add(new THREE.PointLight(0x39e6ff, 18, 18, 1.6), 22, 3.5, -34);
    add(new THREE.PointLight(0xffb060, 18, 20, 1.6), EAST - 4, 4.4, 1);
    add(new THREE.PointLight(0xffc890, 14, 16, 1.6), -12, 4.5, 0);
    add(new THREE.PointLight(0xffb070, 10, 16, 1.6), 4, 4.0, 8);
  }

  // --- lösa saker: gummibollar och klossar vid sidan av banan ----------------
  const loose = [];
  const r = rng(91);
  const ballCols = [0xe8352b, 0x1e6fd9, 0xffd23f, 0x3fbf4a, 0xff8a1c, 0xe86aa8];
  for (const [x, z] of [[-38.5, -30], [38.6, -12], [37.5, 33.5], [-4, 33.2], [-37.5, 18.5], [-26, 13.5], [30, 26.6]]) {
    if (!offRoad(x, z, 0.3)) continue;
    loose.push(addRubberBall(scene, world, RAPIER, { x, z, r: 0.18 + r() * 0.12, color: ballCols[Math.floor(r() * ballCols.length)] }));
  }
  for (const [x, z, g] of [[30.3, -29.6, 0], [30.8, -30.4, 4], [-37.8, 12, 9], [8.6, 33.4, 2]]) {
    if (!offRoad(x, z, 0.3)) continue;
    loose.push(addLooseBlock(scene, world, RAPIER, { x, z, s: 0.34, glyph: g, rotY: r() }));
  }
  return loose.filter((p) => p && p.body);
}

