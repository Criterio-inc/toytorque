import {
  HoodBatch, makeGround, addTrackSurfaces, addTrackPaint, addTrackSidewalks, addStreet, addStreetPaint,
  addHouse, addOpenGarage, addTree, addHedge, addPicketFence, addGardenWall, addLamp, addMailbox, addHydrant,
  addBin, addBarricade, addBrickStack, addCar, addSwingSet, addSlide, addSandbox, addIsland, addFarHouse,
  addFarTrees, addClouds, addLooseBall, addPlankFence, addCone, addBoomGate, addBooth, addDigger, addDirtPatch,
  addDirtPile, addTunnel, fitShortcutOpenings, VERGE, WALK, rng,
} from './hoodArt.js';

// ---------------------------------------------------------------------------
// Nivå: Kvarteret. Amerikanskt villakvarter en solig eftermiddag i riktig
// skala (meter). Start vid en rödvit bom bredvid en byggplats med en stor
// grävmaskin, plankrampen över ett grävt dike och jordtunneln genom byggkullen
// på Maple Street, skaterampen på Oak Avenue, rondellen, genom ett öppet
// garage och en bakgård, och bakgatan mellan plankstaketen.
// Två genvägar: genom ett garage och ut på baksidan (förbi rondellen) och
// längs grusgången mellan plankstaketen till en uppfart (förbi hörnet vid
// West Street).
// ---------------------------------------------------------------------------

const MAPLE = -40; // södra gatans z
const OAK = 44; // östra gatans x
const ELM = 28; // norra gatans z
const WEST = -44; // västra gatans x
const ALLEY = -14; // bakgatans z
const YARD = -8; // genvägens x (uppfart, garage, bakgård)
const RB = { x: OAK, z: 22, r: 8.5 }; // rondellen
const GARAGE = { z0: 9.4, z1: 16 }; // genomfartsgaraget (bak, fram)
const WALL_Z = 1.6; // trädgårdsmuren under plankrampen
const START_X = -6; // startlinjen på Maple Street
const TRENCH = { x0: 10.5, x1: 11.7 }; // diket på Maple Street (plankrampens krön)
const TUNNEL = { x0: 22, x1: 34 }; // jordtunneln genom byggkullen på Maple Street
const SITE = { x0: -16, x1: 19, z0: -58, z1: MAPLE - 2.6 }; // byggplatsen norr om Maple
const MOUND = { x0: 17, x1: 38, z: MAPLE, dz: 11 }; // byggkullen över Maple Street
// Genvägarna: grusgången (bakgatan → Maple) och garaget (Oak → Elm)
const GRAVEL = { from: [-20, ALLEY], via: [[-29, -18.5], [-34.5, -25.5], [-33.5, -33]], to: [-19, MAPLE] };
const DRIVE = { from: [OAK, 4], via: [[42.8, 11], [37, 17], [29, 23.5]], to: [20, ELM] };

const rbv = (deg) => ({ x: RB.x + Math.cos((deg * Math.PI) / 180) * RB.r, z: RB.z + Math.sin((deg * Math.PI) / 180) * RB.r, r: 6 });

export const kvarteret = {
  id: 'kvarteret',
  name: 'Kvarteret',
  laps: 3,
  sky: 0x9fcdf2,
  skyGradient: [0x2b78d4, 0xa9d5f4, 0xe4efe6],
  fog: { near: 70, far: 185, color: 0xc9deec },
  lighting: {
    sun: { color: 0xffe1b4, intensity: 2.9, offset: [-17, 22, 12] },
    hemi: { sky: 0xd2e8ff, ground: 0x6b8a48, intensity: 0.95 },
    exposure: 1.05,
    envIntensity: 0.5,
  },
  floor: { size: 180 },

  trackTheme: { road: '#505154', roadRough: 0.92, side: 0xa58358, pillar: 0x8a6b45, barrierA: 0xc9c6bf, barrierB: 0xbfbcb4 },

  track: {
    scale: 1,
    roadHalf: 2.0,
    spacing: 0.6,
    checkpoints: 18,
    barrierHeight: 0.15,
    barrierThick: 0.25,
    start: { x: START_X, z: MAPLE },
    // Maple Street österut, norrut på Oak Avenue över skaterampen, moturs i
    // rondellen, västerut på Elm Street, ner genom garaget och bakgården,
    // bakgatan västerut och West Street tillbaka ner till Maple.
    corners: [
      { x: OAK, z: MAPLE, r: 9 },
      { x: OAK, z: 11, r: 6 },
      rbv(-20), rbv(35), rbv(90), rbv(145),
      { x: YARD, z: ELM, r: 6 },
      { x: YARD, z: ALLEY, r: 6 },
      { x: WEST, z: ALLEY, r: 7 },
      { x: WEST, z: MAPLE, r: 9 },
    ],
    elevation: [
      // Plankrampen över diket på Maple Street: rak ramp upp till krönet och
      // brant ner (bilarna lyfter över krönet utan att kunna ramla ner i diket;
      // ett glapp här, mitt i startklungan, gav kedjekrascher)
      { at: [1, MAPLE], y: 0 },
      { at: [4, MAPLE], y: 0.05 },
      { at: [TRENCH.x0, MAPLE], y: 0.45, linear: true },
      { at: [TRENCH.x1 + 1.8, MAPLE], y: 0.12, linear: true },
      { at: [16.5, MAPLE], y: 0 },
      // Skaterampen på Oak Avenue: rak ramp ända ut i kanten, glapp, landning
      { at: [OAK, -21], y: 0 },
      { at: [OAK, -17], y: 0.06 },
      { at: [OAK, -10.5], y: 0.46, linear: true },
      { at: [OAK, -9.3], y: 0.32, linear: true },
      { at: [OAK, -6.5], y: 0.14, linear: true },
      { at: [OAK, -1], y: 0 },
      // Kullen på Elm Street: en plywoodpuckel med krön mitt på gatan
      { at: [18, ELM], y: 0 },
      { at: [11.5, ELM], y: 0.5 },
      { at: [5, ELM], y: 0 },
      // Plankrampen över trädgårdsmuren på bakgården
      { at: [YARD, 8.6], y: 0 },
      { at: [YARD, 2.6], y: 0.32 },
      { at: [YARD, 0.6], y: 0.32 },
      { at: [YARD, -5], y: 0 },
    ],
    gaps: [{ from: [OAK, -10.5], to: [OAK, -9.3] }],
    // Hörnet West Street–Maple Street är en doserad plywoodvall
    bank: [{ at: [WEST, MAPLE], deg: 14, fade: 6 }],
    // Tunneln och bakgatan: väggarna och plankstaketen är kanterna
    openings: [{ from: [TUNNEL.x0, MAPLE], to: [TUNNEL.x1, MAPLE] }, { from: [-14.5, ALLEY], to: [-36, ALLEY] }],
    shortcuts: [
      // Grusgången: av bakgatan, mellan plankstaketen och ut över en plankramp
      // på en uppfart till Maple Street
      {
        ...GRAVEL, r: 5, roadHalf: 1.8, ai: 0.35,
        elevation: [
          { at: [-31.6, -34], y: 0 },
          { at: [-29.2, -35.1], y: 0.3, linear: true },
          { at: [-27.3, -36], y: 0.3 },
          { at: [-24.8, -37.2], y: 0, linear: true },
        ],
      },
      // Garaget: in från Oak Avenue, genom garaget, över bakgården till Elm Street
      { ...DRIVE, r: 6, roadHalf: 1.8, ai: 0.4 },
    ],
  },

  statics: [],
  props: [],

  environment({ scene, world, RAPIER, track }) {
    return buildHood({ scene, world, RAPIER, track });
  },
};

// Gator utanför banan (fortsättningar i korsningarna och tvärgator).
// fromTrack: gatan börjar i ett banhörn och spärras av där.
const ARMS = [
  { a: [OAK, MAPLE], b: [130, MAPLE], fromTrack: true },
  { a: [OAK, MAPLE], b: [OAK, -130], fromTrack: true },
  { a: [WEST, MAPLE], b: [-130, MAPLE], fromTrack: true },
  { a: [WEST, MAPLE], b: [WEST, -130], fromTrack: true },
  { a: [WEST, ALLEY], b: [WEST, 130], fromTrack: true },
  { a: [YARD, ELM], b: [-130, ELM], fromTrack: true },
  { a: [OAK, RB.z + 7], b: [OAK, 130], fromTrack: true },
  { a: [RB.x + 7, RB.z], b: [130, RB.z], fromTrack: true },
];
// Gatulinjer som har hus längs sig: [a, b, sidor]
const FRONTAGE = [
  { a: [-100, MAPLE], b: [100, MAPLE] },
  { a: [OAK, -100], b: [OAK, RB.z - 9] },
  { a: [OAK, RB.z + 10], b: [OAK, 100] },
  { a: [RB.x + 10, RB.z], b: [100, RB.z] },
  { a: [-100, ELM], b: [RB.x - 9, ELM] },
  { a: [WEST, -100], b: [WEST, 100] },
];

function buildHood({ scene, world, RAPIER, track }) {
  const B = scene ? new HoodBatch() : null;
  const r = rng(2024);
  const { roadHalf } = track;
  const curbOut = roadHalf + track.barrier.thick;
  const near = (x, z) => Math.sqrt(track.nearest(x, z).d2);
  const scs = track.shortcuts || [];
  const scDist = (x, z) => { let d = Infinity; for (const sc of scs) d = Math.min(d, Math.sqrt(sc.path.nearest(x, z).d2)); return d; };
  const nearSc = (x, z) => scDist(x, z) - 1.8; // avstånd utanför genvägarnas vägkant
  const inSite = (x, z) => x > SITE.x0 && x < SITE.x1 && z > SITE.z0 && z < SITE.z1;
  const inMound = (x, z) => x > MOUND.x0 && x < MOUND.x1 && Math.abs(z - MOUND.z) < MOUND.dz;
  // Flacka av- och påfarter: öppna vallarna där vägarna går ihop
  fitShortcutOpenings(B, world, RAPIER, track);

  makeGround(scene, world, RAPIER, { size: 180 });

  // Inspelningsvänliga checkpoints: hela gatan räknas (kantsten till kantsten)
  for (const cp of track.checkpoints) cp.halfWidth = roadHalf + 0.6;

  // --- banans zoner --------------------------------------------------------
  const zoneOf = (p) => {
    if (p.x > MOUND.x0 && p.x < MOUND.x1 && Math.abs(p.z - MOUND.z) < 3.5) return 'tunnel';
    if (Math.abs(p.x - YARD) < 3.5 && p.z < ELM - 5.5 && p.z > ALLEY + 6) return 'yard';
    if (p.z < ALLEY + 6 && p.z > ALLEY - 3 && p.x < YARD + 3 && p.x > WEST + 6.5) return 'alley';
    return 'street';
  };
  const zones = track.pts.map(zoneOf);
  const kindAt = (i) => {
    const p = track.pts[i];
    if (p.y > 0.01) return 'plywood';
    if (zones[i] === 'tunnel') return p.x > TUNNEL.x0 - 0.6 && p.x < TUNNEL.x1 + 0.6 ? 'dirtDark' : 'dirt';
    if (zones[i] === 'alley') return 'concrete';
    if (zones[i] === 'yard') return p.z > GARAGE.z0 - 0.2 ? 'concrete' : 'pavers';
    return 'asphalt';
  };
  addTrackSurfaces(B, track, kindAt);
  // Genvägarnas ytor: grus, plankramp och uppfart; garageuppfart och trädgårdsgång
  if (scs[0]) addTrackSurfaces(B, scs[0].path, (i) => {
    const p = scs[0].path.pts[i];
    return p.y > 0.01 ? 'plywood' : p.z > -21 || p.z < -33.5 ? 'concrete' : 'dirt';
  });
  let garage = null;
  if (scs[1]) {
    const P = scs[1].path;
    const gi = P.nearest(33, 20.3).index, t = P.tangents[gi];
    garage = { x: P.pts[gi].x, z: P.pts[gi].z, rot: Math.atan2(t.x, t.z), d: 6.4, w: 5.4, gi };
    const exit = P.dist[gi] + garage.d / 2 + 0.6;
    addTrackSurfaces(B, P, (i) => (P.dist[i] < exit || P.dist[i] > P.length - 5 ? 'concrete' : 'pavers'));
  }

  // Rondellens ö
  let rbMin = Infinity;
  for (const p of track.pts) rbMin = Math.min(rbMin, Math.hypot(p.x - RB.x, p.z - RB.z));
  const islandR = rbMin - curbOut - 0.35;
  addIsland(B, world, RAPIER, { x: RB.x, z: RB.z, r: islandR });
  const inRB = (x, z, pad = 0) => Math.hypot(x - RB.x, z - RB.z) < islandR + pad;

  // --- linjer och övergångsställen ------------------------------------------
  const idx = (x, z) => track.nearest(x, z).index;
  const crosswalks = [idx(-30, MAPLE), idx(OAK, -29), idx(32, ELM), idx(3, ELM), idx(WEST, -24)].filter((i) => track.pts[i].y < 0.01 && !track.isOpen[i]);
  const nearIdx = (i, list, span) => list.some((j) => { const d = Math.abs(i - j); return Math.min(d, track.N - d) < span; });
  const centre = (i) => {
    const p = track.pts[i];
    return kindAt(i) === 'asphalt' && !inRB(p.x, p.z, 7) && !nearIdx(i, [0], 4) && !nearIdx(i, crosswalks, 4);
  };
  if (B) addTrackPaint(B, track, {
    centre, crosswalks,
    manholes: [[idx(-12, MAPLE), 0.9], [idx(10, ELM), -0.8], [idx(OAK, -34), -0.8], [idx(18, ELM), 0.6], [idx(-6, ELM), -0.4], [idx(WEST, -30), -1.0], [idx(-22, ALLEY), 0.5], [idx(WEST, -20), 0.7]],
  });

  // --- gator utanför banan -----------------------------------------------
  const armBand = (x, z, pad, skip = null) => ARMS.some((A) => {
    if (A === skip) return false;
    const dx = A.b[0] - A.a[0], dz = A.b[1] - A.a[1], len = Math.hypot(dx, dz);
    const tx = dx / len, tz = dz / len;
    const s = (x - A.a[0]) * tx + (z - A.a[1]) * tz, l = (x - A.a[0]) * -tz + (z - A.a[1]) * tx;
    return s > -pad && s < len + pad && Math.abs(l) < 2 + pad;
  });
  const crossings = [];
  for (const A of ARMS) crossings.push(A.a);
  crossings.push([WEST, ELM]);
  const inCrossing = (x, z, pad) => crossings.some(([cx, cz]) => Math.abs(x - cx) < pad && Math.abs(z - cz) < pad);
  for (const A of ARMS) {
    addStreet(B, world, RAPIER, {
      a: A.a, b: A.b, half: 2,
      free: (x, z, what) => {
        const d = near(x, z);
        if (what === 'asphalt') return zoneOf({ x, z }) === 'street' || d > curbOut;
        if (what === 'curb') return d > curbOut + 0.15 && !inCrossing(x, z, 2.3) && !armBand(x, z, 0.3, A) && !inRB(x, z, 1);
        return d > curbOut + VERGE + 0.2 && !armBand(x, z, 0.25 + VERGE + 0.1, A) && !inRB(x, z, 1);
      },
    });
    // Mittlinje och övergångsställe en bit in på gatan
    const len = Math.hypot(A.b[0] - A.a[0], A.b[1] - A.a[1]);
    addStreetPaint(B, { a: A.a, b: A.b, from: 12 / len, to: 1, crossAt: [7.5] });
    // Avspärrning där gatan möter banan
    if (A.fromTrack) {
      const tx = (A.b[0] - A.a[0]) / len, tz = (A.b[1] - A.a[1]) / len;
      let s = 1;
      while (s < 20 && (near(A.a[0] + tx * s, A.a[1] + tz * s) < curbOut + 0.9 || near(A.a[0] + tx * s - tz * 1.6, A.a[1] + tz * s + tx * 1.6) < curbOut + 0.6 || near(A.a[0] + tx * s + tz * 1.6, A.a[1] + tz * s - tx * 1.6) < curbOut + 0.6)) s += 0.25;
      for (const l of [-1, 1]) addBarricade(B, world, RAPIER, { x: A.a[0] + tx * s - tz * l, z: A.a[1] + tz * s + tx * l, rot: Math.atan2(tx, tz) + Math.PI / 2, w: 1.8 });
    }
  }

  // Trottoarer längs banans gator
  addTrackSidewalks(B, track, (i, side) => {
    if (zones[i] !== 'street') return false;
    const p = track.pts[i], n = track.normals[i];
    const off = curbOut + VERGE + WALK / 2;
    const x = p.x + n.x * off * side, z = p.z + n.z * off * side;
    const nn = track.nearest(x, z);
    const di = Math.abs(nn.index - i);
    if (Math.min(di, track.N - di) > 25 || Math.sqrt(nn.d2) < curbOut + VERGE) return false;
    if (zoneOf({ x, z }) !== 'street' || inSite(x, z) || inMound(x, z) || nearSc(x, z) < 0.6) return false;
    return !inRB(x, z, 1.2) && !armBand(x, z, 0.25 + VERGE + 0.2);
  });

  // --- hus längs gatorna ------------------------------------------------------
  const rects = []; // upptagna ytor: {x, z, rot, hw, hd}
  const inRect = (x, z, R, pad = 0) => {
    const c = Math.cos(R.rot), s = Math.sin(R.rot), dx = x - R.x, dz = z - R.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.abs(lx) < R.hw + pad && Math.abs(lz) < R.hd + pad;
  };
  const blocked = (x, z, pad = 0) => rects.some((R) => inRect(x, z, R, pad));
  const rectPoints = (R, step = 1.5) => {
    const out = [];
    const c = Math.cos(R.rot), s = Math.sin(R.rot);
    for (let u = -R.hw; u <= R.hw + 0.01; u += Math.max(0.5, (R.hw * 2) / Math.ceil((R.hw * 2) / step))) for (let v = -R.hd; v <= R.hd + 0.01; v += Math.max(0.5, (R.hd * 2) / Math.ceil((R.hd * 2) / step))) {
      out.push([R.x + u * c + v * s, R.z - u * s + v * c]);
    }
    return out;
  };
  const streetBand = 2 + 0.25 + VERGE + WALK + 0.8;
  const rectFree = (R) => rectPoints(R).every(([x, z]) => near(x, z) > streetBand && !armBand(x, z, streetBand - 2) && !inRB(x, z, 9) && !blocked(x, z, 1.2) && Math.abs(x) < 120 && Math.abs(z) < 120);

  // Reserverat: genvägens tomt (garage, hus och bakgård med lekplats),
  // byggplatsen, grusgången, garagetomten och byggkullen över Elm
  rects.push({ x: -3, z: 5, rot: 0, hw: 9.5, hd: 16.5 });
  rects.push({ x: 3, z: -50.5, rot: 0, hw: 19.5, hd: 8 });
  rects.push({ x: -26.25, z: -27.25, rot: 0, hw: 12.25, hd: 10.75 });
  rects.push({ x: 30, z: 9.75, rot: 0, hw: 12, hd: 16.25 });
  rects.push({ x: 28, z: -51, rot: 0, hw: 10.5, hd: 9 });
  rects.push({ x: 28, z: -32, rot: 0, hw: 10.5, hd: 6 });

  const houses = [];
  let seed = 11;
  for (const F of FRONTAGE) {
    const dx = F.b[0] - F.a[0], dz = F.b[1] - F.a[1], len = Math.hypot(dx, dz);
    const tx = dx / len, tz = dz / len;
    for (const side of [1, -1]) {
      // Normalen mot husets sida; fronten pekar tillbaka mot gatan
      const nx = -tz * side, nz = tx * side;
      const rot = Math.atan2(-nx, -nz);
      for (let s = 4 + r() * 4; s < len - 6;) {
        const w = 9 + r() * 2.5, d = 7.6 + r() * 1.2;
        const garage = r() < 0.78 ? (r() < 0.5 ? 'left' : 'right') : null;
        const lotW = w + (garage ? 6.2 : 0) + 4 + r() * 3;
        const gOff = garage === 'left' ? -3.1 : garage === 'right' ? 3.1 : 0;
        const front = 10.6 + r() * 1.2;
        const off = front + d / 2;
        // Lokal x (husets höger) i världen: vektor (cos rot, -sin rot)
        const rx = Math.cos(rot), rz = -Math.sin(rot);
        const along = s + lotW / 2;
        let cx = F.a[0] + tx * along + nx * off, cz = F.a[1] + tz * along + nz * off;
        cx -= rx * gOff; cz -= rz * gOff;
        const R = { x: cx + rx * gOff, z: cz + rz * gOff, rot, hw: w / 2 + (garage ? 3.1 : 0) + 0.3, hd: d / 2 + 1.6 };
        R.x += -nx * 0.9; R.z += -nz * 0.9; // täck verandan framför huset
        if (rectFree(R)) {
          rects.push(R);
          const h = { x: cx, z: cz, rot, w, d, garage, toStreet: off - curbOut, seed: seed++, front, street: F, side, nx, nz, rx, rz };
          h.hoop = garage && r() < 0.18;
          houses.push(h);
          s += lotW;
        } else s += 3;
      }
    }
  }

  // Genvägens hus och genomfartsgaraget
  const yardHouse = { x: 0.6, z: 12.6, rot: 0, w: 10.2, d: 8, garage: null, toStreet: ELM - curbOut - 12.6, seed: 5, siding: 0xf3e7c4, roof: 0x6b5143, accent: 0x24344f, chimney: true };
  addHouse(B, world, RAPIER, yardHouse);
  addOpenGarage(B, world, RAPIER, { x: YARD, z: (GARAGE.z0 + GARAGE.z1) / 2, rot: 0, w: 6.6, d: GARAGE.z1 - GARAGE.z0, siding: 0xf3e7c4, roof: 0x6b5143 });

  for (const h of houses) addHouse(B, world, RAPIER, h);
  // Husen vid genvägarna: villan bredvid grusgångens uppfart och villan vid garaget
  addHouse(B, world, RAPIER, { x: -20, z: -26, rot: Math.PI, w: 9.4, d: 7.6, garage: null, toStreet: 14 - curbOut, seed: 41, siding: 0xcfe0ea, roof: 0x4f5a66, accent: 0x6a2424 });
  addHouse(B, world, RAPIER, { x: 30.6, z: -1.2, rot: Math.PI / 2, w: 9, d: 7.6, garage: null, toStreet: OAK - 30.6 - curbOut, seed: 42, siding: 0xf0d3c6, roof: 0x55575c, accent: 0x24344f });
  if (garage) addOpenGarage(B, world, RAPIER, { x: garage.x, z: garage.z, rot: garage.rot + Math.PI, w: garage.w, d: garage.d, siding: 0xf0d3c6, roof: 0x55575c });

  // Fullstora bilar: en pickup på en uppfart vid Maple, en personbil på uppfarten intill
  const local = (h, lx, lz) => [h.x + h.rx * lx + (-h.nx) * lz, h.z + h.rz * lx + (-h.nz) * lz];
  const withGarage = houses.filter((h) => h.garage);
  const pickupHouse = withGarage.find((h) => h.street === FRONTAGE[0] && h.side === 1 && h.x > -10 && h.x < 30) || withGarage[0];
  const sedanHouse = withGarage.find((h) => h !== pickupHouse && h.street === FRONTAGE[4] && h.x > 0) || withGarage[1];
  const parked = [];
  for (const [h, kind, color] of [[pickupHouse, 'pickup', 0x2f5d8a], [sedanHouse, 'sedan', 0xb3262a]]) {
    if (!h) continue;
    const gx = (h.garage === 'left' ? -1 : 1) * (h.w / 2 + 3.1);
    const [px, pz] = local(h, gx, h.d / 2 - 0.6 + (kind === 'pickup' ? 3.4 : 3.0));
    const rot = h.rot + Math.PI / 2;
    addCar(B, world, RAPIER, { x: px, z: pz, rot, kind, color });
    parked.push([px, pz]);
  }
  // En personbil parkerad vid kanten på Elms västra del (rakt fram före svängen in på uppfarten)
  addCar(B, world, RAPIER, { x: -19, z: ELM - 1.0, rot: Math.PI, kind: 'sedan', color: 0xe0dccf });
  addCar(B, world, RAPIER, { x: 70, z: MAPLE + 1.0, rot: 0, kind: 'pickup', color: 0x8c1d22 });

  // --- trädgårdar: staket, häckar, träd, brevlådor och soptunnor -------------
  const treeOk = (x, z, rad) => near(x, z) > curbOut + rad && nearSc(x, z) > rad && !inSite(x, z) && !inMound(x, z) && !armBand(x, z, 0.4 + rad) && !inRB(x, z, 2) && !rects.some((R) => inRect(x, z, R, rad * 0.5)) && !parked.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3.5);
  const trees = [];
  for (const h of houses) {
    const gs = h.garage === 'left' ? -1 : h.garage === 'right' ? 1 : 0;
    // Främre tomtgräns: staket eller häck, med öppning för uppfart och gång
    const zl = h.d / 2 + (h.front - curbOut - VERGE - WALK) - 0.45;
    const lotHalf = h.w / 2 + (gs ? 6.2 : 0) / 2 + 2;
    const xc = gs * 3.1;
    const gaps = [[-0.85, 0.85]];
    if (gs) gaps.push([gs * (h.w / 2 + 3.1) - 2.7, gs * (h.w / 2 + 3.1) + 2.7]);
    const k = r();
    const segs = [];
    let x0 = xc - lotHalf;
    for (const [g0, g1] of gaps.sort((a, b) => a[0] - b[0])) { if (g0 > x0 + 0.5) segs.push([x0, g0]); x0 = Math.max(x0, g1); }
    if (xc + lotHalf > x0 + 0.5) segs.push([x0, xc + lotHalf]);
    for (const [a, b] of segs) {
      const [ax, az] = local(h, a, zl), [bx, bz] = local(h, b, zl);
      if (near(ax, az) < curbOut + 1 || near(bx, bz) < curbOut + 1) continue;
      if (k < 0.34) addPicketFence(B, world, RAPIER, { points: [[ax, az], [bx, bz]] });
      else if (k < 0.55) addHedge(B, world, RAPIER, { x: (ax + bx) / 2, z: (az + bz) / 2, w: b - a, d: 0.6, h: 0.85, rot: h.rot });
    }
    // Träd i trädgården
    for (const [lx, lz] of [[-gs * (h.w / 2 + 1.5) + (gs ? 0 : -h.w / 2), h.d / 2 + 3.4], [(r() - 0.5) * h.w, -h.d / 2 - 5]]) {
      const [x, z] = local(h, lx, lz);
      if (treeOk(x, z, 2.2)) trees.push({ x, z, h: 7 + r() * 4, s: 2.4 + r() * 1.4, seed: seed++, tint: r() });
    }
    // Brevlåda vid uppfarten, ibland soptunnor (tömningsdag)
    const mbX = gs ? gs * (h.w / 2 + 3.1) - gs * 3.1 : 1.4;
    const [mx, mz] = local(h, mbX, h.toStreet - VERGE / 2);
    if (near(mx, mz) > curbOut + 0.25 && near(mx, mz) < curbOut + VERGE + 0.6) addMailbox(B, world, RAPIER, { x: mx, z: mz, rot: h.rot, seed: h.seed, color: [0x2b2b2b, 0x24344f, 0x4a5a4a, 0x7a2a22][h.seed % 4] });
    if (gs && r() < 0.35) {
      for (const k2 of [0, 1]) {
        const [bx, bz] = local(h, gs * (h.w / 2 + 3.1) + gs * (3.0 + k2 * 0.75), h.toStreet - 0.75 + 0);
        if (near(bx, bz) > curbOut + 0.45) addBin(B, world, RAPIER, { x: bx, z: bz, rot: h.rot, color: k2 ? 0x2a5d9a : 0x2d6a3e });
      }
    }
  }

  // Gatuträd på gräsremsan, gatlyktor och brandposter längs banan
  const vergeOff = curbOut + VERGE / 2;
  const driveways = houses.filter((h) => h.garage).map((h) => {
    const gx = (h.garage === 'left' ? -1 : 1) * (h.w / 2 + 3.1);
    const [x, z] = local(h, gx, h.d / 2 + (h.toStreet - h.d / 2) / 2);
    return { x, z, rot: h.rot, hw: 3.2, hd: (h.toStreet - h.d / 2) / 2 + 0.5 };
  });
  const walkways = houses.map((h) => { const [x, z] = local(h, h.garage ? -(h.garage === 'left' ? -1 : 1) * h.w * 0.12 : 0, h.toStreet - 1); return { x, z, rot: h.rot, hw: 1.2, hd: 2 }; });
  const vergeFree = (x, z) => !inSite(x, z) && !inMound(x, z) && nearSc(x, z) > 1.2 && !driveways.some((R) => inRect(x, z, R)) && !walkways.some((R) => inRect(x, z, R)) && !armBand(x, z, 1.4) && !inRB(x, z, 2) && zoneOf({ x, z }) === 'street';
  const vergeSpot = (i, side) => {
    const p = track.pts[i], n = track.normals[i];
    const x = p.x + n.x * vergeOff * side, z = p.z + n.z * vergeOff * side;
    const nn = track.nearest(x, z);
    const di = Math.abs(nn.index - i);
    if (Math.min(di, track.N - di) > 20 || Math.sqrt(nn.d2) < curbOut + 0.2) return null;
    return vergeFree(x, z) ? [x, z] : null;
  };
  const step = Math.round(13 / track.spacing);
  let lampSide = 1;
  for (let i = 4; i < track.N; i += step) {
    if (zones[i] !== 'street' || track.pts[i].y > 0.01 || nearIdx(i, crosswalks, 6)) continue;
    for (const side of [1, -1]) {
      const sp = vergeSpot(i, side);
      if (sp && r() < 0.75) trees.push({ x: sp[0], z: sp[1], h: 8 + r() * 3.5, s: 2.6 + r() * 1.2, seed: seed++, tint: r() * 0.5 });
    }
    const j = (i + Math.round(step / 2)) % track.N;
    const sp = zones[j] === 'street' && track.pts[j].y < 0.01 ? vergeSpot(j, lampSide) : null;
    if (sp) {
      const n = track.normals[j];
      addLamp(B, world, RAPIER, { x: sp[0], z: sp[1], rot: Math.atan2(-n.x * lampSide, -n.z * lampSide) });
      lampSide = -lampSide;
    }
  }
  for (const [x, z] of [[-24, MAPLE - 1], [20, MAPLE + 1], [30, MAPLE + 1], [OAK - 1, -32], [OAK + 1, -14], [26, ELM - 1], [WEST + 1, -6], [WEST - 1, -26], [-20, MAPLE + 1]]) {
    const i = idx(x, z), n = track.normals[i], p = track.pts[i];
    const side = Math.sign((x - p.x) * n.x + (z - p.z) * n.z) || 1;
    const hx = p.x + n.x * (curbOut + 0.45) * side, hz = p.z + n.z * (curbOut + 0.45) * side;
    if (vergeFree(hx, hz)) addHydrant(B, world, RAPIER, { x: hx, z: hz });
  }

  // --- genvägen: uppfart, garage, bakgård med mur, lekplats och staket -------
  // Staket mot grannen väster om bakgården och längs bakgatan
  const fenceW = YARD - curbOut - 0.45;
  addPicketFence(B, world, RAPIER, { points: [[fenceW, GARAGE.z0 - 0.3], [fenceW, ALLEY + curbOut + 1.6], [-14.5, ALLEY + curbOut + 1.6]] });
  addPicketFence(B, world, RAPIER, { points: [[-5.6, ALLEY + 2.7], [6.3, ALLEY + 2.7], [6.3, GARAGE.z0 - 1]] });
  addPicketFence(B, world, RAPIER, { points: [[-14.5, ALLEY - curbOut - 1.2], [YARD + 12, ALLEY - curbOut - 1.2]] });
  // Muren under plankrampen och patio vid huset
  addGardenWall(B, world, RAPIER, { h: 0.22, x0: fenceW + 0.2, z0: WALL_Z, x1: YARD - curbOut - 0.05, z1: WALL_Z });
  addGardenWall(B, world, RAPIER, { h: 0.22, x0: YARD + curbOut + 0.05, z0: WALL_Z, x1: 6.1, z1: WALL_Z });
  addSandbox(B, world, RAPIER, { x: -1.6, z: -5.6, rot: 0.15, s: 2 });
  addSwingSet(B, world, RAPIER, { x: 3.4, z: -3.2, rot: 0.05 });
  addSlide(B, world, RAPIER, { x: 2.6, z: 4.6, rot: Math.PI / 2 });
  for (const [x, z, k] of [[-3.6, 2.2, 1], [3.6, -8.6, 2], [-4.6, -9.6, 3], [5.6, 7.4, 4]]) addBrickStack(B, world, RAPIER, { x, z, layers: k % 3 + 1, seed: k });
  trees.push({ x: 1.5, z: -9.4, h: 9, s: 3.2, seed: 901, tint: 0.2 });
  addHedge(B, world, RAPIER, { x: YARD + curbOut + 0.55, z: GARAGE.z1 + 2.6, w: 4.2, d: 0.6, h: 0.75, rot: Math.PI / 2 });
  addHedge(B, world, RAPIER, { x: YARD - curbOut - 0.55, z: GARAGE.z1 + 2.6, w: 4.2, d: 0.6, h: 0.75, rot: Math.PI / 2 });
  // Soptunnor längs bakgatan
  for (const x of [-34, -32.9, -27, -25.9, -19.5, -18.4]) addBin(B, world, RAPIER, { x, z: ALLEY + 3.0, rot: Math.PI, color: [0x2d6a3e, 0x2a5d9a, 0x3a3a3a][Math.abs(Math.round(x)) % 3] });

  buildSite({ B, world, RAPIER, track, near, scDist, nearSc, idx, curbOut });

  // Tegelstenar under rampernas kant (hemmabyggen på Maple och Oak)
  const gapStarts = track.isGap.map((g, i) => (g && !track.isGap[(i - 1 + track.N) % track.N] ? i : -1)).filter((i) => i >= 0);
  for (const gi of gapStarts) for (const side of [1, -1]) for (const k of [-6, -14, -24]) {
    const pz = track.poseAt(gi + k, side * (curbOut + 0.3));
    addBrickStack(B, world, RAPIER, { x: pz.x, z: pz.z, layers: Math.max(1, Math.round(track.pts[(gi + k + track.N) % track.N].y / 0.07)), seed: k + side * 3 + 50 });
  }

  // --- träd, horisont och moln ----------------------------------------------
  for (const t of trees) addTree(B, world, RAPIER, t);
  if (B) {
    // Avlägsna hus längs gatorna och trädridåer i diset
    let fs = 300;
    for (const F of [...ARMS.map((A) => ({ a: A.a, b: A.b }))]) {
      const dx = F.b[0] - F.a[0], dz = F.b[1] - F.a[1], len = Math.hypot(dx, dz), tx = dx / len, tz = dz / len;
      for (const side of [1, -1]) {
        const nx = -tz * side, nz = tx * side;
        for (let s = 0; s < len; s += 15) {
          const x = F.a[0] + tx * s + nx * 15, z = F.a[1] + tz * s + nz * 15;
          if (Math.max(Math.abs(x), Math.abs(z)) < 100 || Math.max(Math.abs(x), Math.abs(z)) > 150) continue;
          addFarHouse(B, { x, z, rot: Math.atan2(-nx, -nz), seed: fs++ });
        }
      }
    }
    const far = [];
    for (let k = 0; k < 90; k++) {
      const a = r() * Math.PI * 2, d = 105 + r() * 70;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (armBand(x, z, 5)) continue;
      far.push({ x, z, s: 4 + r() * 4, seed: k });
    }
    addFarTrees(B, far);
    B.flush(scene);
  }
  addClouds(scene, { count: 11, dist: 175 });

  // Lösa fotbollar vid trottoarkanten
  const loose = [];
  for (const [i, lat] of [[idx(28, MAPLE), 1.6], [idx(-22, ALLEY), -1.5]]) {
    const pz = track.poseAt(i, lat);
    loose.push(addLooseBall(scene, world, RAPIER, { x: pz.x, z: pz.z }));
  }
  return loose.filter((p) => p && p.body);
}

// Byggplatsen vid starten, diket, jordtunneln och staketen längs bakgatan och
// genvägarna (staketen och tunnelväggarna är banans kanter där vallarna saknas).
function buildSite({ B, world, RAPIER, track, near, scDist, nearSc, idx, curbOut }) {
  const scs = track.shortcuts || [];

  // --- start: bom, vaktkur, grävmaskin och jordhögar ------------------------
  addBoomGate(B, world, RAPIER, { x: START_X - 0.8, z: MAPLE - curbOut - 0.7, rot: -Math.PI / 2, len: 4.7, raise: 1.22 });
  addBooth(B, world, RAPIER, { x: START_X - 3.4, z: MAPLE - curbOut - 3.2, rot: 0 });
  addDirtPatch(B, { x: 3, z: -50.5, rx: 18, rz: 7, seed: 3 });
  addDirtPatch(B, { x: 3, z: MAPLE - curbOut - 0.75, rx: 18.5, rz: 0.9, seed: 4, y: 0.014 });
  addDigger(B, world, RAPIER, { x: 5, z: -49.5, rot: -1.27, swing: 0 });
  addDirtPile(B, world, RAPIER, { x: 13, z: -47.2, r: 1.9, h: 1.3, seed: 1 });
  addDirtPile(B, world, RAPIER, { x: 16.5, z: -51, r: 2.4, h: 1.7, seed: 2 });
  addDirtPile(B, world, RAPIER, { x: -5, z: -53, r: 2.8, h: 1.8, seed: 3 });
  addDirtPile(B, world, RAPIER, { x: 8.5, z: -55, r: 2.0, h: 1.2, seed: 4 });
  addDirtPile(B, world, RAPIER, { x: 13.4, z: MAPLE + curbOut + 1.9, r: 1.0, h: 0.6, seed: 5 });
  addCar(B, world, RAPIER, { x: -10.5, z: -51.5, rot: 0.35, kind: 'sedan', color: 0xc4202a });
  for (const [x, z, l] of [[-1.5, -47, 3], [-0.9, -47.4, 2], [18.5, -46, 4]]) addBrickStack(B, world, RAPIER, { x, z, layers: l, seed: x * 7 });
  // Koner längs byggplatsen och vid diket
  for (let x = SITE.x0 + 1; x < SITE.x1; x += 2.6) {
    if ((x > 4 && x < 8.5) || (x > START_X - 6 && x < START_X + 1) || x > 16) continue;
    addCone(B, world, RAPIER, { x, z: MAPLE - curbOut - 1.35 });
  }
  for (const x of [8.6, 13.6]) addCone(B, world, RAPIER, { x, z: MAPLE + curbOut + 0.6 });
  addBarricade(B, world, RAPIER, { x: 11.1, z: MAPLE + curbOut + 0.75, rot: Math.PI / 2, w: 1.8 });
  // Diket bredvid plankrampen: mörk jord på båda sidor
  for (const s of [-1, 1]) addDirtPatch(B, { x: (TRENCH.x0 + TRENCH.x1) / 2, z: MAPLE + s * (curbOut + 0.9), rx: 1.1, rz: 0.7, seed: 8 + s, col: [0.5, 0.42, 0.34], y: 0.016 });

  // --- jordtunneln under byggkullen på Maple Street ---------------------------
  // Väggarna står en bit utanför vägkanten: ideallinjen går 0,45 m från
  // kanten, och med väggen precis i kanten skrapade bilarna i den och
  // snurrade in med nosen i tunnelmynningen.
  addTunnel(B, world, RAPIER, {
    track, i0: idx(TUNNEL.x0, MAPLE), i1: idx(TUNNEL.x1, MAPLE), height: 2.5, wallOff: 2.35, mound: 3.9, fall: [4.5, 3], side: 10.5,
    roadNear: (x, z) => Math.min(near(x, z), scDist(x, z)),
  });

  // --- plankstaket: bakgatan och genvägarna ---------------------------------
  const runs = (pts, ok) => {
    const out = [];
    let cur = [];
    for (const p of pts) { if (ok(p[0], p[1])) cur.push(p); else { if (cur.length > 1) out.push(cur); cur = []; } }
    if (cur.length > 1) out.push(cur);
    return out;
  };
  const fence = (pts, ok) => { for (const run of runs(pts, ok)) addPlankFence(B, world, RAPIER, { points: run }); };
  for (const side of [-1, 1]) {
    const line = [];
    for (let x = -14.5; x >= -36; x -= 0.5) line.push([x, ALLEY + side * 2.12]);
    fence(line, (x, z) => nearSc(x, z) > 0.5);
  }
  // Längs genvägarna: på båda sidor, en bit från huvudgatorna
  scs.forEach((sc, k) => {
    const P = sc.path;
    for (const side of [-1, 1]) {
      const line = [];
      for (let i = 0; i < P.N - 1; i += 2) {
        const p = P.pts[i], n = P.normals[i];
        line.push([p.x + n.x * side * (P.roadHalf + 0.5), p.z + n.z * side * (P.roadHalf + 0.5)]);
      }
      fence(line, (x, z) => near(x, z) > (k === 0 && z > -22 ? 3.2 : 5) && (k === 0 || garageFree(x, z)));
    }
  });
  function garageFree(x, z) {
    const P = scs[1]?.path;
    if (!P) return true;
    const gi = P.nearest(33, 20.3).index, q = P.nearest(x, z);
    return Math.abs(P.dist[q.index] - P.dist[gi]) > 4.2 && !(P.dist[q.index] < P.dist[gi]);
  }
  // Soptunnor och tegel längs grusgången (utanför staketet)
  for (const [x, z, c] of [[-37.4, -20.6, 0x2d6a3e], [-37.4, -21.4, 0x2a5d9a], [-27.4, -30.2, 0x3a3a3a], [-26.6, -30.2, 0x2d6a3e]]) {
    if (nearSc(x, z) > 0.9) addBin(B, world, RAPIER, { x, z, rot: Math.PI / 2, color: c });
  }
}
