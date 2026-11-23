// ---------------------------------------------------------------------------
// Provbana för höjdmotorn (finns bara i dev-läge och i testerna, inte i menyn).
// En åtta på kullig mark: ena slingan går över en kulle och korsar den andra
// på en bro, den andra går ner genom en sänka under bron. Två branta
// doseringar och en lång nedförsbacke. Används för att pröva terrängen,
// broar, kontrollpunkter vid korsningar och doseringar upp till 25°.
// ---------------------------------------------------------------------------

export const provbana = {
  id: 'provbana',
  name: 'Provbanan',
  layout: 1,
  laps: 3,
  sky: 0xbfe3ff,
  fog: { near: 50, far: 160, color: 0xd6ecf5 },
  floor: { size: 104, tile: 1, gloss: 0.9, colorA: 0x8aa86a, colorB: 0x7f9d60, grout: 0x6f8c52 },
  walls: { height: 1.5, color: 0x9c8a6c },
  terrainColor: 0x6f9a4a,
  props: [],
  statics: [],

  track: {
    scale: 1,
    roadHalf: 1.7,
    spacing: 0.6,
    checkpoints: 20,
    lineMargin: 0.8,
    freeRoam: true,
    checkpointHalf: 4,
    start: { x: -32, z: 0 },
    // Åttan: korsningen ligger i origo. Hörnens ordning gör att banan
    // korsar sig själv där.
    corners: [
      { x: -32, z: 24, r: 7 },
      { x: 32, z: -24, r: 7 },
      { x: 32, z: 24, r: 7 },
      { x: -32, z: -24, r: 7 },
    ],
    terrain: {
      hills: [
        { x: 35, z: 0, rx: 10, rz: 15, h: 2.7 }, // kullen i öster som vägen klättrar över (doseringen ligger på plan mark före)
        { x: 0, z: 0, rx: 12, rz: 12, h: -0.9 }, // sänkan vid korsningen
        { x: -42, z: 0, rx: 10, rz: 16, h: 1.2 }, // en lägre ås i väster
        { x: 0, z: 36, r: 10, h: 1.8 }, // kulle utanför banan i norr
      ],
      blend: 5,
    },
    // Den ena diagonalen går på bro över korsningen
    bridges: [{ from: [7, 5.3], to: [-7, -5.3] }], // i färdriktningen
    elevation: [
      { at: [-14, -10.5], y: 0 },
      { at: [-3, -2.25], y: 1.0 }, // inte i själva korsningen: där ligger två vägbitar
      { at: [3, 2.25], y: 1.0 },
      { at: [14, 10.5], y: 0 },
    ],
    bank: [{ at: [34, -24], deg: 25, fade: 4 }, { at: [-34, -24], deg: 22, fade: 4 }],
  },
  trackTheme: { road: '#b6a584', roadRough: 0.9, side: 0x5a5850, pillar: 0x8a857a, barrierA: 0xaaa496, barrierB: 0x938e81 },
};
