// ---------------------------------------------------------------------------
// Banbyggarens bitar. Rutnät med 4 m rutor; varje ruta har högst en bit.
//
// Riktningar: 0 = norr (-z), 1 = öster (+x), 2 = söder (+z), 3 = väster (-x).
// Rad j växer söderut (+z), kolumn i österut (+x).
//
// En bit har ett slag (k) och en rotation (r = 0..3). Raka bitar är öppna mot
// r och r+2 och "framåt" är r (rampens uppförsbacke, hoppets och startens
// färdriktning). Kurvan är öppen mot r och r+1.
//
// Verktyg i paletten kan stämpla flera rutor: S-kurva och hårnål är två
// kurvor, hoppet är tre rutor i rad (ansats, glapp, landning).
// ---------------------------------------------------------------------------

export const CELL = 4; // m per ruta
export const GRID = 24; // rutor per sida
export const RAMP_STEP = 0.45; // höjd per rampruta (lutning ≈ 6,4°)
export const MAX_LEVEL = 3;
export const ROAD_HALF = 1.4;

export const DX = [0, 1, 0, -1];
export const DZ = [-1, 0, 1, 0];

// Bitslag: namn och öppningar vid rotation 0
export const KINDS = {
  straight: { name: 'Raka', open: [0, 2], straight: true },
  curve: { name: 'Kurva', open: [0, 1] },
  start: { name: 'Start/mål', open: [0, 2], straight: true, directed: true },
  rampUp: { name: 'Ramp upp', open: [0, 2], straight: true, directed: true },
  rampDown: { name: 'Ramp ned', open: [0, 2], straight: true, directed: true },
  bridge: { name: 'Bro', open: [0, 2], straight: true },
  jump: { name: 'Hopp', open: [0, 2], straight: true, directed: true },
};

export function openings(cell) {
  return KINDS[cell.k].open.map((d) => (d + cell.r) % 4);
}

// Kurvans rotation för öppningarna a och b
export function curveRot(a, b) {
  return (a + 1) % 4 === b ? a : b;
}

// Palettens verktyg. stamp(rot) ger rutorna [di, dj, slag, rot, del?]
export const TOOLS = [
  { id: 'straight', name: 'Raka', key: '1', stamp: (r) => [[0, 0, 'straight', r % 2]] },
  { id: 'curve', name: 'Kurva', key: '2', stamp: (r) => [[0, 0, 'curve', r]] },
  {
    id: 'sbend', name: 'S-kurva', key: '3',
    stamp: (r) => [
      [[0, 0, 'curve', 1], [1, 0, 'curve', 3]],
      [[0, 0, 'curve', 2], [0, 1, 'curve', 0]],
      [[1, 0, 'curve', 2], [0, 0, 'curve', 0]],
      [[0, 1, 'curve', 3], [0, 0, 'curve', 1]],
    ][r],
  },
  {
    id: 'hairpin', name: 'Hårnål', key: '4',
    stamp: (r) => [
      [[0, 0, 'curve', 1], [1, 0, 'curve', 2]],
      [[0, 0, 'curve', 2], [0, 1, 'curve', 3]],
      [[0, 0, 'curve', 0], [1, 0, 'curve', 3]],
      [[0, 0, 'curve', 1], [0, 1, 'curve', 0]],
    ][r],
  },
  { id: 'rampUp', name: 'Ramp upp', key: '5', stamp: (r) => [[0, 0, 'rampUp', r]] },
  { id: 'rampDown', name: 'Ramp ned', key: '6', stamp: (r) => [[0, 0, 'rampDown', r]] },
  { id: 'bridge', name: 'Bro (upphöjd)', key: '7', stamp: (r) => [[0, 0, 'bridge', r % 2]] },
  // Hoppet läggs framåt från rutan: ansats, glapp, landning
  { id: 'jump', name: 'Hopp', key: '8', stamp: (r) => [0, 1, 2].map((p) => [DX[r] * p, DZ[r] * p, 'jump', r, p]) },
  { id: 'start', name: 'Start/mål', key: '9', stamp: (r) => [[0, 0, 'start', r]] },
  { id: 'erase', name: 'Sudd', key: '0', stamp: () => [] },
];

export const THEMES = {
  tra: {
    name: 'Trä', sky: 0xd9cbb4,
    track: { road: '#9b6f45', roadRough: 0.7, side: 0x6e4a2c, pillar: 0x7a5634, barrierA: 0xc98b4f, barrierB: 0xe8d6b5 },
    floor: { tile: 0.9, grip: 1.0, colorA: '#c39566', colorB: '#b4865a', grout: '#8f6642', gloss: 0.45 },
    walls: 0xeadfca,
    draw: { road: '#a8794b', edge: '#5e3f22' },
  },
  matta: {
    name: 'Matta', sky: 0xc6cbd6,
    track: { road: '#2f4f86', roadRough: 1.0, side: 0x2a3550, pillar: 0x8d8f96, barrierA: 0xe2c044, barrierB: 0xf2f2ee },
    floor: { tile: 1.4, grip: 1.0, colorA: '#b2a58f', colorB: '#ab9e87', grout: '#a39680', gloss: 0.95 },
    walls: 0xd8d2c4,
    draw: { road: '#36588f', edge: '#1c2c4c' },
  },
  asfalt: {
    name: 'Asfalt', sky: 0xbfd4e6,
    track: { road: '#3a3d45', roadRough: 0.8, side: 0x6d6f74, pillar: 0x9b9b9b, barrierA: 0xd23b3b, barrierB: 0xf0f0f0 },
    floor: { tile: 1.2, grip: 1.0, colorA: '#9a9c9e', colorB: '#8f9194', grout: '#7d7f82', gloss: 0.4 },
    walls: 0xc4c0b6,
    draw: { road: '#44474f', edge: '#1e2026' },
  },
};

export const ENVS = {
  rum: { name: 'Tomt rum' },
  lagret: { name: 'Lagerhallen' },
};
