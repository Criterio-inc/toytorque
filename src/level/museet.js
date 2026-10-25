import { buildMuseum } from './museumArt.js';

// ---------------------------------------------------------------------------
// Nivå: Museet. Natur- och rymdmuseum en natt i riktig skala (meter).
// Starten går genom den stora salen med pelare och dinosaurieskelettet,
// norrut genom Egyptensalen, västerut in i rymdutställningen med det
// lila-svarta schackgolvet och hoppet över det svarta hålet, söderut och upp
// i rulltrappan till galleriet, runt läktaren och längs galleriets östra arm
// till entréhallens stora trappa: banan flyger ut från galleriet över
// trappans översta steg och landar på en löparmatta nedför resten av trappan.
// Genvägen går snett genom Egyptensalen i en gravkammare, västra rakan har
// ett bordshopp över en månkrater, nordöstra kurvan i Egyptensalen är doserad
// och vid trappans fot står biljettkiosken.
// ---------------------------------------------------------------------------

export const MUSEUM = {
  size: 88,       // golvets sida (och gränsen för "ut ur världen")
  half: 42,       // innerväggarnas avstånd från mitten
  H: 9,           // takhöjd
  splitZ: -2,     // mellanväggen mellan stora salen och de norra salarna
  splitX: 0,      // mellanväggen mellan rymdsalen och Egyptensalen
  deckY: 1.2,     // galleriets höjd
};

const E = 30, N = -32, W = -32, S = 33, SX = -12, ST = 10;
const J = -8; // hoppkanten på norra rakan
const J3 = -8.5; // hoppkanten på västra rakan (över månkratern, körs mot +z)

// Entréhallens stora trappa på startrakan (körs mot +x): från galleriets kant
// x0 ner till golvet vid x1. Banan hoppar från kanten (glapp till x0 + gap)
// och landar på trappans nedre del; stegnosarna ligger på linjen mellan
// (x0, deckY) och (x1, 0) så att en bil som inte når fram rullar nedför.
export const STAIRS = { x0: 0, x1: 8.5, gap: 2.3, z0: 5, z1: 15, steps: 9 };
const stairY = (x) => MUSEUM.deckY * (STAIRS.x1 - x) / (STAIRS.x1 - STAIRS.x0);
// Foten: en parabel från trappans lutning till plant golv över ±2 m
const STAIR_FOOT = [-2, -1, 0, 1, 2].map((d) => [d, ((MUSEUM.deckY / (STAIRS.x1 - STAIRS.x0)) / 8) * (d - 2) ** 2]);

// Genvägen genom gravkammaren: snett över Egyptensalen från östra rakan
// till norra rakan, genom en lång gravtunnel mellan pelarna.
// V3 gör påfarten nästan parallell med norra rakan: en snett inkommande bil
// hann inte räta upp sig före hoppet 12 m senare och flög över vallen.
export const TOMB = { A: [E, 5], V1: [E, -1], V2: [20.5, -26], V3: [11, -31.2], B: [4, N] };

export const museet = {
  id: 'museet',
  name: 'Museet',
  laps: 3,
  sky: 0x0b0912,
  skyGradient: [0x05040a, 0x0e0b18, 0x0a0812],
  fog: { near: 26, far: 110, color: 0x0d0a14 },
  lighting: {
    sun: { color: 0x9fb2ff, intensity: 0.3, offset: [-9, 26, 13] },
    hemi: { sky: 0x6f6a96, ground: 0x241c26, intensity: 0.26 },
    exposure: 1.1,
    envIntensity: 0.1,
  },
  floor: { size: MUSEUM.size },

  // Sammetsrep (djupröd) och mässing som kantvallar
  trackTheme: {
    road: '#3a3540', roadRough: 0.3, side: 0xcfc6b4, pillar: 0x8c8474,
    barrierA: 0x6a0c18, barrierB: 0x8f6c2c,
  },

  track: {
    scale: 1,
    roadHalf: 1.6,
    spacing: 0.6,
    checkpoints: 18,
    barrierHeight: 0.18,
    barrierThick: 0.14,
    start: { x: 18, z: ST }, // efter trappan: startklungan står på golvet
    // Stora salen österut, norrut genom Egyptensalen, västerut genom
    // rymdsalen, söderut upp på galleriet och ner igen mot starten.
    corners: [
      { x: E, z: ST, r: 6 },
      { x: E, z: N, r: 6 },
      { x: W, z: N, r: 6 },
      { x: W, z: S, r: 6 },
      { x: SX, z: S, r: 6 },
      { x: SX, z: ST, r: 6.5 },
    ],
    elevation: [
      // Hoppet över det svarta hålet: rak ramp ända ut i kanten, glapp, landning
      { at: [J + 8.5, N], y: 0 },
      { at: [J + 5.5, N], y: 0.06 },
      { at: [J, N], y: 0.46, linear: true },
      { at: [J - 1.2, N], y: 0.28, linear: true },
      { at: [J - 6.5, N], y: 0.15, linear: true },
      { at: [J - 12.5, N], y: 0 },
      // Rulltrappan upp till galleriet, runt läktaren, längs östra armen och
      // rakt ut över stora trappans kant: glapp, landning nedför trappan
      { at: [W, 2.5], y: 0 },
      { at: [W, 14], y: MUSEUM.deckY },
      { at: [STAIRS.x0 - 1.4, ST], y: MUSEUM.deckY },
      { at: [STAIRS.x0, ST], y: MUSEUM.deckY, linear: true },
      { at: [STAIRS.x0 + STAIRS.gap, ST], y: stairY(STAIRS.x0 + STAIRS.gap), linear: true },
      // Mjuk övergång till golvet vid trappans fot (en knyck kastar upp bilen)
      ...STAIR_FOOT.map(([d, y]) => ({ at: [STAIRS.x1 + d, ST], y, linear: true })),
      // Månkraterhoppet på västra rakan: ett bordshopp utan glapp (snabba
      // bilar flyger över kratern, långsamma rullar över), före rulltrappan
      { at: [W, J3 - 8.5], y: 0 },
      { at: [W, J3 - 5.5], y: 0.06 },
      { at: [W, J3], y: 0.46, linear: true },
      { at: [W, J3 + 1.4], y: 0.42, linear: true },
      { at: [W, J3 + 5.8], y: 0.14, linear: true },
      { at: [W, J3 + 10.5], y: 0 },
    ],
    gaps: [{ from: [J, N], to: [J - 1.2, N] }, { from: [STAIRS.x0, ST], to: [STAIRS.x0 + STAIRS.gap, ST] }],
    // Egyptensalens nordöstra kurva är doserad (sandstensvall)
    bank: [{ at: [E, N], deg: 15, fade: 5 }],
    // Vallarna öppnas där genvägen delar sig och går ihop med banan;
    // sandstensblock håller bilarna kvar
    openings: [{ from: [E, 6], to: [E, -14] }, { from: [16, N], to: [1.5, N] }],
    shortcuts: [{
      from: TOMB.A, to: TOMB.B, via: [TOMB.V1, TOMB.V2, TOMB.V3], r: 12, roadHalf: 1.35, ai: 0.35,
      gaps: [{ from: [E - 0.1, 4.6], to: [27.5, -7.6] }, { from: [12.4, -29.0], to: [4.3, -31.95] }],
    }],
  },

  statics: [],
  props: [],

  environment({ scene, world, RAPIER, track }) {
    return buildMuseum({ scene, world, RAPIER, track, M: MUSEUM, jumpX: J - 0.6, jumpZ: N, crater: { x: W, z: J3 + 0.6 }, stairs: { ...STAIRS, z: ST } });
  },
};
