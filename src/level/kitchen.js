import { buildKitchen } from './kitchenArt.js';

// ---------------------------------------------------------------------------
// Nivå: Köket. Ett stort öppet kök med matsal en solig förmiddag, möblerat i
// riktig skala (meter): bänkar 0,9 m, matbord 0,75 m, stolsits 0,45 m och
// kylskåp 1,85 m. Bilarna kör på golvet. Starten ligger framför altandörrarna,
// sedan slalom runt köksön med barstolarna, längs bänkskåpens sockel förbi
// spisen med hopp över kokböckerna, förbi kylen, längs frukostbaren och rakt
// in under matbordet mellan stolsbenen och över mattan. I nordvästra hörnet
// klättrar banan upp på en skärbrädesplatå med en doserad kurva vid bänkarna
// och ett krön ner mot spisen. Efter matbordet finns en sidoväg för spelaren:
// rakt fram genom husdjursluckan i köksdörren, över altanen och in igen genom
// de öppna pardörrarna.
//
// Banan är öppen: inga lister längs golvet utom på platån och vid hoppet.
// Möblerna och väggarna är kanterna.
// ---------------------------------------------------------------------------

export const ROOM = { x0: -20, x1: 20, z0: -14, z1: 14, H: 2.7 };

const NZ = -11.6; // rakan längs bänkskåpen (norr)
const SZ = 11.6; // rakan framför altandörrarna (söder)
const EX = 17.6; // östra kurvan vid kylen
const WX = -17.6; // västra väggens bänkar
const BAR = -2.5; // frukostbaren (östra mittgången)
const DX = 4; // gången under matbordet
const ISL = -4; // köksöns gång
const SX = -6; // svängen runt köksön
const SN = 4; // gången mellan ön och mattan

// Altanen utanför södra väggen. Efter matbordet går det att köra rakt fram
// genom husdjursluckan i köksdörren, över trädäcket och in igen genom de öppna
// pardörrarna. Vägen är längre än kurvan inne men slipper vattenpölen.
const ALTAN = {
  flap: { x: DX, door: 0.9, w: 0.56, h: 0.34 },
  doors: { x: -12.4, w: 2.2 },
  x0: -15.2, x1: 7.4, depth: 4.6,
};

export const KITCHEN = {
  ROOM, NZ, SZ, EX, WX, BAR, DX, ISL, SX, SN, ALTAN,
  table: { x: DX, z: 4.6, len: 3.4, depth: 1.1, h: 0.75 },
  jump: { lip: 6.5, gap: 1.2 },
  spill: { x0: -10, x1: -7.4 }, // vattenpölen vid kattskålarna (på södra rakan)
};

export const kitchen = {
  id: 'kitchen',
  name: 'Köket',
  layout: 2, // öppen bana sedan 2026-11-23: äldre spökbilar gäller inte
  laps: 3,
  sky: 0xf3ead8,
  fog: { near: 26, far: 70, color: 0xf1e7d6 },
  lighting: {
    // Lågt ljus in från fönstren: möbler och lister kastar långa skuggor över golvet
    sun: { color: 0xffe2b8, intensity: 3.4, offset: [-18, 14, 12] },
    hemi: { sky: 0xfff3e2, ground: 0x8a7458, intensity: 0.5 },
    shadow: { range: 18, size: 2048 },
    exposure: 0.84, // det ljusa golvet blev annars helt vitt och rutmönstret försvann
    envIntensity: 0.6,
  },
  look: { ao: 0.9, contrast: 1.2, saturation: 1.22, bloom: 0.3 },
  floor: { size: 44 },

  // Låga lister i ljus ek som kantvallar
  trackTheme: {
    road: '#b8a58a', roadRough: 0.5, side: 0xc89a62, pillar: 0x9a7448,
    barrierA: 0xd8b98c, barrierB: 0xc4a172,
  },

  track: {
    scale: 1,
    roadHalf: 1.4,
    spacing: 0.6,
    checkpoints: 14, // inget checkpoint ska knuffas ihop med nästa efter hoppet
    barrierHeight: 0.13,
    barrierThick: 0.09,
    start: { x: -5, z: SZ },
    // Medurs sett ovanifrån (norr uppåt): österut längs bänkarna, söderut förbi kylen,
    // västerut längs baren, söderut under matbordet, västerut längs
    // altandörrarna, norrut och runt köksön, och upp till bänkarna igen.
    corners: [
      { x: EX, z: NZ, r: 3.8 },
      { x: EX, z: BAR, r: 3.6 },
      { x: DX, z: BAR, r: 3.6 },
      { x: DX, z: SZ, r: 3.8 },
      { x: WX, z: SZ, r: 3.6 },
      { x: WX, z: SN, r: 3.5 },
      { x: SX, z: SN, r: 3.6 },
      { x: SX, z: ISL, r: 3.6 },
      { x: WX, z: ISL, r: 3.5 },
      { x: WX, z: NZ, r: 3.6 },
    ],
    elevation: [
      // Skärbrädesplatån i nordvästra hörnet: uppför längs köksöns gång, en
      // doserad kurva vid bänkarna och ett krön ner mot spisen
      { at: [-8, ISL], y: 0 },
      { at: [-14, ISL], y: 0.55 },
      { at: [WX, -8], y: 0.55 },
      { at: [-13.5, NZ], y: 0.55 },
      { at: [-8.5, NZ], y: 0 },
      // Hoppet framför spisen: skärbräda på kokböcker ända ut i kanten,
      // glapp, landning på en bakplåt
      { at: [-3, NZ], y: 0 },
      { at: [0, NZ], y: 0.08 },
      { at: [6.5, NZ], y: 0.7, linear: true },
      { at: [7.7, NZ], y: 0.5, linear: true },
      { at: [11.5, NZ], y: 0.2, linear: true },
      { at: [14.2, NZ], y: 0 },
    ],
    gaps: [{ from: [6.5, NZ], to: [7.7, NZ] }],
    airZones: [{ from: [-2, NZ], to: [6.4, NZ] }], // det höga hoppet: bilarna hålls plana i luften
    bank: [{ at: [WX, NZ], deg: 14, fade: 2 }],
    // Öppen bana: skåpen, köksön, stolarna, bordsbenen, kylen och väggarna
    // är kanterna. Bara skärbrädesplatån och hoppet vid spisen har lister,
    // så att ingen kör över kanten och ramlar ner på golvet.
    freeRoam: true,
    closed: [{ from: [-8, ISL], to: [-8.5, NZ] }, { from: [-3, NZ], to: [14.2, NZ] }],
    // Styr spelaren vänster efter matbordet siktar körhjälpen på luckan
    sideExits: [
      { zone: [3.0, 6.1, 5.2, 14.2], from: [ALTAN.flap.x, 6], aim: [ALTAN.flap.x, 15.6], side: 1, speed: 5 },
      // Ute på altanen leder körhjälpen till pardörrarna. Utan lister runt
      // kurvan hamnar en ovan förare annars mot dörrkarmen.
      {
        zone: [ALTAN.x0, 14.05, ALTAN.x1, 14 + ALTAN.depth], auto: true, side: 1, speed: 5,
        line: [[ALTAN.flap.x, 15.4], [0, 17.2], [-9, 16.6], [-11.4, 15.8], [ALTAN.doors.x, 14.0], [ALTAN.doors.x, 12.2]],
      },
    ],
    // Kontrollpunkterna räcker ut över altanen
    checkpointHalf: 7.5,
  },

  statics: [],
  props: [],

  environment({ scene, world, RAPIER, track }) {
    return buildKitchen({ scene, world, RAPIER, track, K: KITCHEN });
  },
};
