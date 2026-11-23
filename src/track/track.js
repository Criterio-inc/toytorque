import * as THREE from 'three';
import { hillsAt } from '../level/terrain.js';
import { GRAVITY } from '../core/physics.js';
import { computeBank, computeRacingLine, findTurnSigns, MU_REF } from './trackLine.js';

// Fysik, grafik och ideallinje ligger i egna filer men nås härifrån som förut
export { buildTrackPhysics, addUnderlay, barrierSegments, edge3, bankY, barrierCenter } from './trackPhysics.js';
export { buildTrackMesh } from './trackMesh.js';
export { MU_REF, MAX_BANK_DEG, bankGain } from './trackLine.js';

// ---------------------------------------------------------------------------
// Banan: en sluten polygon av hörn där varje hörn rundas med en cirkelbåge
// (sluter sig alltid; kurvradien måste vara större än halva vägbredden).
// Ovanpå det en höjdprofil, så att banan kan klättra upp på broar och ramper,
// och glapp där vägen saknas (hopp).
//
// Specen:
//   corners     [{x, z, r}]        hörn i ritningsenheter (× scale = meter)
//   elevation   [[andel, y], ...]  höjd i meter vid andel av varvet (0..1),
//                                  mjukt interpolerad, sluten runt varvet
//   gaps        [[a0, a1], ...]    andelar där vägen saknas (hopp)
//   openings    [[a0, a1], ...]    andelar utan kantvallar
//   freeRoam    true               öppen bana: inga kantvallar, bilarna får lämna vägen
//   closed      [[a0, a1], ...]    sträckor på en öppen bana som ändå har kantvallar (doserade kurvor)
//   checkpointHalf  meter          halva bredden på kontrollpunkterna (öppna banor har breda)
//   embank      [{from, to, slope?}]  upphöjda sträckor med sluttande vallar i stället för
//                                  lodräta sidor (sandbankar på öppna banor), slope = meter ut per meter höjd
//   sideExits   [{zone, from, aim | line: [[x, z], ...], side, speed, auto?}]  avfart mot något vid sidan av vägen (en lucka, ett rör):
//                                  styr spelaren ditåt inne i zonen siktar körhjälpen på aim
//   bank        [{at, deg, len?, fade?}]  doserad kurva: hela kurvan som
//                                  punkten ligger i lutas deg grader (ytterkanten
//                                  upp; negativt = mot kurvan), tonas in/ut
//   autoBank    grader             dosering ur krökningen överallt (max-vinkel)
//   terrain     { hills, ... }     mark med kullar som vägen följer (se level/terrain.js)
//   bridges     [{from, to}]       broar: vägen följer inte marken där, har sidor och pelare
//
// Doseringen ger vägen en sidlutning: en punkt med sidoförskjutning l (längs
// vänsternormalen) ligger på höjden y + l·tan(bank). Vägen lyfts så att den
// låga kanten aldrig hamnar under golvet. Max 25°.
//
// Tre steg så att samma bana kan byggas utan grafik (tester):
//   buildTrackData(spec)              geometri, ideallinje, frågor
//   buildTrackPhysics(world, R, data) väg (trimesh), sidor, vallar, pelare
//   buildTrackMesh(scene, data)       väg, vallar, pelare, mållinje, pilar
// ---------------------------------------------------------------------------

export function buildTrackData(spec) {
  spec = { ...spec };
  const s = spec.scale ?? 1;
  const roadHalf = spec.roadHalf;
  const spacing = spec.spacing ?? 0.6;
  const corners = spec.corners.map((c) => ({ x: c.x * s, z: c.z * s, r: c.r * s }));
  const startHint = { x: spec.start.x * s, z: spec.start.z * s };

  const flat = rotateToStart(resample(filletPolygon(corners, spacing), spacing), startHint);
  const N = flat.length;

  // Sträcka längs banan (i planet)
  const dist = new Float32Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const a = flat[i - 1], b = flat[i % N];
    dist[i] = dist[i - 1] + Math.hypot(b.x - a.x, b.z - a.z);
  }
  const length = dist[N];
  const frac = (i) => dist[i] / length;

  // Nycklar kan anges som andel av varvet eller som en punkt {at: [x, z]}
  // (närmaste mittlinjepunkt; välj punkter som bara ligger nära en vägbit).
  const fracAt = (k) => {
    if (typeof k === 'number') return k;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < N; i++) { const d = (flat[i].x - k[0] * s) ** 2 + (flat[i].z - k[1] * s) ** 2; if (d < bestD) { bestD = d; best = i; } }
    return frac(best);
  };
  const keyOf = (e) => (Array.isArray(e) ? [fracAt(e[0]), e[1], !!e[2]] : [fracAt(e.at), e.y, !!e.linear]);
  const rangeOf = (g) => (Array.isArray(g) && typeof g[0] === 'number' ? g : [fracAt(g.from), fracAt(g.to)]);
  spec = { ...spec, gaps: (spec.gaps || []).map(rangeOf), openings: (spec.openings || []).map(rangeOf), closed: (spec.closed || []).map(rangeOf), bridges: (spec.bridges || []).map(rangeOf) };

  // Höjdprofil
  const elev = spec.elevation && spec.elevation.length ? spec.elevation.map(keyOf).sort((a, b) => a[0] - b[0]) : [[0, 0]];
  const heightAt = (f) => {
    const n = elev.length;
    if (n === 1) return elev[0][1];
    let k = elev.findIndex((e) => e[0] > f);
    if (k === -1) k = n; // efter sista nyckeln: mot första (nästa varv)
    const a = elev[(k - 1 + n) % n], b = elev[k % n];
    let fa = a[0], fb = b[0];
    if (k === n) fb += 1;
    if (k === 0) fa -= 1;
    const u = (f - fa) / (fb - fa || 1);
    const sm = b[2] ? u : u * u * (3 - 2 * u); // rak lutning (ramp) eller mjuk övergång
    return a[1] + (b[1] - a[1]) * sm;
  };
  const inRanges = (f, ranges = []) => ranges.some(([a, b]) => (a <= b ? f >= a && f <= b : f >= a || f <= b));

  const pts = flat.map((p, i) => ({ x: p.x, y: heightAt(frac(i)), z: p.z }));
  const isBridge = pts.map((_, i) => inRanges(frac(i), spec.bridges));

  // Terräng: vägen följer kullarna. På en bro tas markhöjden rakt mellan
  // brofästena, så att bron inte sjunker ner i sänkan den går över.
  if (spec.terrain) {
    const hills = spec.terrain.hills || [];
    const g = flat.map((p) => (spec.terrain.base ?? 0) + hillsAt(hills, p.x, p.z));
    for (let i = 0; i < N; i++) {
      if (!isBridge[i] || isBridge[(i - 1 + N) % N]) continue;
      let j = i;
      while (isBridge[j % N] && j - i < N) j++;
      const a = g[(i - 1 + N) % N], b = g[j % N];
      for (let k = i; k < j; k++) g[k % N] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
    }
    // Utjämning (±2 m) så att små gupp i marken inte blir skarpa i vägen
    const w = Math.max(1, Math.round(2 / spacing));
    const sm = g.map((_, i) => { let sum = 0; for (let k = -w; k <= w; k++) sum += g[(i + k + N) % N]; return sum / (2 * w + 1); });
    for (let i = 0; i < N; i++) pts[i].y += sm[i];
  }

  // Dosering (sidlutning) per punkt, och lyft så att låga kanten går fri från golvet
  const bank = computeBank(flat, spacing, spec, (k) => Math.round(fracAt(k) * N) % N);
  const tanB = bank.map(Math.tan);
  // Lyftet tonas in före och ut efter doseringen (8 m), så att ytterkanten
  // stiger och sjunker mjukt i stället för att kasta upp bilen.
  const need = tanB.map((t) => (t ? roadHalf * Math.abs(t) + 0.02 : 0));
  if (need.some((v) => v > 0) && !spec.terrain) { // terrängen följer ändå vägens låga kant
    const W = Math.round(8 / spacing);
    const lift = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (!need[i]) continue;
      for (let k = -W; k <= W; k++) {
        const u = 1 - Math.abs(k) / W, j = (i + k + N) % N;
        lift[j] = Math.max(lift[j], need[i] * u * u * (3 - 2 * u));
      }
    }
    for (let i = 0; i < N; i++) pts[i].y = Math.max(pts[i].y, lift[i]);
  }
  const isGap = pts.map((_, i) => inRanges(frac(i), spec.gaps));
  // Broar har alltid räcken, även på öppna banor, och på terräng börjar
  // räckena 8 m före bron (uppfarten ligger på en vall)
  const nearBridge = isBridge.slice();
  if (spec.terrain) {
    const A = Math.round(8 / spacing);
    for (let i = 0; i < N; i++) if (isBridge[i]) for (let k = -A; k <= A; k++) nearBridge[(i + k + N) % N] = true;
  }
  const isOpen = pts.map((_, i) => (!!spec.freeRoam && !inRanges(frac(i), spec.closed) && !nearBridge[i]) || inRanges(frac(i), spec.openings));
  const embank = new Float32Array(pts.length);
  for (const e of spec.embank || []) { const r = rangeOf(e); for (let i = 0; i < pts.length; i++) if (inRanges(frac(i), [r])) embank[i] = e.slope ?? 3; }

  // Genvägar: avfart och påfart på huvudbanan (öppningar i vallarna där)
  const shortcutSpecs = (spec.shortcuts || []).map((sc) => {
    const near = (k) => { let b = 0, bd = Infinity; for (let i = 0; i < N; i++) { const d = (flat[i].x - k[0] * s) ** 2 + (flat[i].z - k[1] * s) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
    const A = near(sc.from), B = near(sc.to);
    const w = Math.round(Math.max(roadHalf * 2.4, sc.merge ?? 0) / spacing);
    for (const c of [A, B]) for (let k = -w; k <= w; k++) isOpen[(c + k + N) % N] = true;
    return { sc, A, B };
  });

  // Tangent (i planet) och vänsternormal. +x är vänster vid färd mot +z.
  const tangents = [];
  const normals = [];
  for (let i = 0; i < N; i++) {
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
    const t = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    tangents.push(t);
    normals.push(new THREE.Vector3(t.z, 0, -t.x));
  }

  // Korsningar: punkter där en annan del av banan går över eller under (broar).
  // Där får ingen kontrollpunkt ligga, annars kunde den räknas från vägen under.
  const overlap = new Uint8Array(N);
  const lenAll = dist[N];
  for (let i = 0; i < N; i++) for (let k = i + 1; k < N; k++) {
    const dd = Math.abs(dist[k] - dist[i]);
    if (Math.min(dd, lenAll - dd) < 6 || (pts[k].x - pts[i].x) ** 2 + (pts[k].z - pts[i].z) ** 2 > (roadHalf * 2 + 1) ** 2) continue;
    if (Math.abs(pts[k].y - pts[i].y) > 0.3) overlap[i] = overlap[k] = 1;
  }
  const crossings = overlap.some((v) => v);

  // Checkpoints: plan tvärs banan, jämnt fördelade, aldrig mitt i ett glapp.
  const NUM_CP = spec.checkpoints ?? 14;
  const checkpoints = [];
  for (let i = 0; i < NUM_CP; i++) {
    let idx = Math.round((i / NUM_CP) * N) % N;
    // Aldrig i eller strax efter ett glapp: bilen kan passera planet i luften
    const clearBack = Math.round(8 / spacing);
    const nearGap = (j) => { for (let k = 0; k <= clearBack; k++) if (isGap[(j - k + N) % N]) return true; return false; };
    const bad = (j) => nearGap(j) || overlap[j] || overlap[(j + Math.round(3 / spacing)) % N] || overlap[(j - Math.round(3 / spacing) + N) % N];
    for (let k = 0; k < N && bad(idx); k++) idx = (idx + 1) % N;
    checkpoints.push({
      index: idx, x: pts[idx].x, y: pts[idx].y, z: pts[idx].z,
      tangent: tangents[idx], normal: normals[idx], halfWidth: spec.checkpointHalf ?? roadHalf + 0.6,
    });
  }

  // Checkpoints får inte ligga på den bit av huvudbanan som en genväg hoppar
  // över (då skulle genvägen missa dem). De flyttas till strax efter påfarten.
  const inSpan = (i, A, B) => (A <= B ? i > A && i < B : i > A || i < B);
  for (const { A, B } of shortcutSpecs) {
    for (const cp of checkpoints) {
      if (cp.index === 0 || !inSpan(cp.index, A, B)) continue;
      const idx = (B + Math.round(4 / spacing)) % N;
      Object.assign(cp, { index: idx, x: pts[idx].x, y: pts[idx].y, z: pts[idx].z, tangent: tangents[idx], normal: normals[idx] });
    }
  }
  const seen = new Set();
  for (let i = checkpoints.length - 1; i >= 0; i--) { if (seen.has(checkpoints[i].index)) checkpoints.splice(i, 1); else seen.add(checkpoints[i].index); }
  checkpoints.sort((a, b) => a.index - b.index);

  // Räckenas ändar på terrängbanor vinklas utåt (som vägräcken vid ett
  // brofäste), så att en bil som kommer snett glider in i stället för att
  // träffa räckets ände rakt framifrån.
  let flare = null;
  if (spec.terrain) {
    flare = new Float32Array(N);
    const F = Math.round(8 / spacing);
    for (let i = 0; i < N; i++) {
      const rail = (k) => !isOpen[(k + N) % N] && !isGap[(k + N) % N];
      if (!rail(i)) continue;
      for (let k = 1; k <= F; k++) {
        if (rail(i - k) && rail(i + k)) continue;
        const u = 1 - k / F;
        flare[i] = Math.max(flare[i], 2.0 * u * u);
        break;
      }
    }
  }

  const data = {
    flare,
    pts, tangents, normals, dist, length, N, roadHalf, spacing, checkpoints, isGap, isOpen, bank, tanB, freeRoam: !!spec.freeRoam, embank,
    terrain: !!spec.terrain, isBridge, crossings,
    // Markhöjd utan vägen (för bropelare), bara på banor med terräng
    groundAt: spec.terrain ? (x, z) => (spec.terrain.base ?? 0) + hillsAt(spec.terrain.hills || [], x, z) : null,
    sideExits: spec.sideExits || [],
    startHeading: Math.atan2(tangents[0].x, tangents[0].z),
    barrier: { height: spec.barrierHeight ?? 0.22, thick: spec.barrierThick ?? 0.12 },

    // Närmsta mittlinjepunkt. Höjden vägs in så att en bro inte förväxlas med
    // vägen under. Med hint söks bara ett fönster runt hinten.
    // Vägytans höjd vid punkt i och sidoförskjutning lateral (med dosering)
    surfaceY(i, lateral = 0) { const j = ((i % N) + N) % N; return pts[j].y + lateral * tanB[j]; },

    nearest(x, z, hint = -1, window = 40, y = null) {
      let best = 0, bestD = Infinity;
      const scan = (i) => {
        const p = pts[i];
        let d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (y !== null) {
          const lat = Math.max(-roadHalf, Math.min(roadHalf, (x - p.x) * normals[i].x + (z - p.z) * normals[i].z));
          d += ((p.y + lat * tanB[i] - y) * 2.5) ** 2;
        }
        if (d < bestD) { bestD = d; best = i; }
      };
      if (hint < 0) for (let i = 0; i < N; i++) scan(i);
      else for (let k = -window; k <= window; k++) scan((hint + k + N) % N);
      const n = normals[best];
      const lateral = (x - pts[best].x) * n.x + (z - pts[best].z) * n.z;
      return { index: best, lateral, d2: bestD };
    },

    // Position + riktning på vägytan (respawn och startgrid). roll och pitch
    // ställer bilen parallellt med en doserad eller lutande väg.
    poseAt(index, lateral = 0) {
      const i = ((index % N) + N) % N;
      const p = pts[i], n = normals[i], t = tangents[i];
      return {
        x: p.x + n.x * lateral, y: p.y + lateral * tanB[i], z: p.z + n.z * lateral, heading: Math.atan2(t.x, t.z), index: i,
        roll: bank[i], pitch: slopePitch(pts, i, N, isGap),
      };
    },

    // Startgrid: två led bakom mållinjen.
    gridSlot(slot) {
      const row = Math.floor(slot / 2);
      const col = slot % 2 === 0 ? 1 : -1;
      const back = Math.round((1.2 + row * 1.1) / spacing);
      return this.poseAt(-back, col * Math.min(0.55, roadHalf * 0.4));
    },

    // Närmaste respawnpunkt bakåt där inget glapp ligger inom 20 m framåt,
    // så att bilen hinner ta fart före ett hopp.
    safeIndex(index) {
      const ahead = Math.round(20 / spacing);
      const clear = (i) => { for (let k = 0; k <= ahead; k++) if (isGap[(i + k) % N]) return false; return true; };
      let i = ((index % N) + N) % N;
      if (clear(i)) return i;
      // Har vi redan passerat glappet: landningen är säker
      if (!isGap[i]) for (let k = 1; k <= 8; k++) if (isGap[(i - k + N) % N]) return i;
      for (let k = 0; k < N && !clear(i); k++) i = (i - 1 + N) % N;
      return i;
    },
  };

  computeRacingLine(data, spec);
  data.signs = findTurnSigns(data);
  data.shortcuts = shortcutSpecs.map(({ sc, A, B }) => ({ A, B, chance: sc.ai ?? 0.4, path: buildShortcut(data, sc, A, B, s) }));
  return data;
}

// ---------------------------------------------------------------------------
// Genväg: en öppen vägsträcka från huvudbanans punkt A via mellanpunkter till
// punkt B. Byggs som ett eget "data"-objekt med samma form som huvudbanan så
// att väg, vallar, ramper och hopp fungerar likadant. Spec:
//   { from:[x,z], to:[x,z], via:[[x,z],...], r, roadHalf, elevation, gaps, ai, followGround, freeRoam }
// elevation/gaps anges som {at:[x,z]} på genvägen (eller andel 0..1).
// ---------------------------------------------------------------------------
function buildShortcut(main, sc, A, B, s) {
  const spacing = main.spacing;
  const roadHalf = sc.roadHalf ?? main.roadHalf;
  const pa = main.pts[A], pb = main.pts[B];
  const ctrl = [{ x: pa.x, z: pa.z }, ...(sc.via || []).map(([x, z]) => ({ x: x * s, z: z * s, r: (sc.r ?? roadHalf * 3) })), { x: pb.x, z: pb.z }];
  const raw = filletPath(ctrl, spacing);
  const flat = resampleOpen(raw, spacing);
  const N = flat.length + 1; // sista punkten är en spärr så att vägen inte sluter sig
  flat.push({ x: flat[flat.length - 1].x, z: flat[flat.length - 1].z });
  const dist = new Float32Array(N + 1);
  for (let i = 1; i < N; i++) dist[i] = dist[i - 1] + Math.hypot(flat[i].x - flat[i - 1].x, flat[i].z - flat[i - 1].z);
  dist[N] = dist[N - 1];
  const length = dist[N - 1] || 1;
  const frac = (i) => dist[i] / length;
  const fracAt = (k) => {
    if (typeof k === 'number') return k;
    let b = 0, bd = Infinity;
    for (let i = 0; i < N - 1; i++) { const d = (flat[i].x - k[0] * s) ** 2 + (flat[i].z - k[1] * s) ** 2; if (d < bd) { bd = d; b = i; } }
    return frac(b);
  };
  // Höjd: från huvudbanans höjd vid A till höjden vid B, med egna nycklar emellan.
  // Med followGround räknas höjderna ovanför marken och marken läggs till
  // sist; annars går genvägen rakt mellan ändarnas höjder (som förut).
  const G = (sc.followGround && main.groundAt) || (() => 0);
  const keys = [[0, pa.y - G(pa.x, pa.z), false], ...(sc.elevation || []).map((e) => [fracAt(e.at ?? e[0]), e.y ?? e[1], !!(e.linear ?? e[2])]), [1, pb.y - G(pb.x, pb.z), false]].sort((a, b) => a[0] - b[0]);
  const heightAt = (f) => {
    let k = keys.findIndex((e) => e[0] > f);
    if (k <= 0) return k === 0 ? keys[0][1] : keys[keys.length - 1][1];
    const a = keys[k - 1], b = keys[k];
    const u = (f - a[0]) / (b[0] - a[0] || 1);
    return a[1] + (b[1] - a[1]) * (b[2] ? u : u * u * (3 - 2 * u));
  };
  const ranges = (sc.gaps || []).map((g) => [fracAt(g.from), fracAt(g.to)]);
  const pts = flat.map((p, i) => ({ x: p.x, y: heightAt(frac(i)) + G(p.x, p.z), z: p.z }));
  if (sc.followGround) {
    // Huvudbanans höjd avviker några cm från marken. Där vägarna ligger kant
    // i kant tar genvägen huvudbanans höjd, annars blir det ett trappsteg
    // mellan vägytorna som en bil kan fastna på.
    // Bara huvudbanan kring av- och påfarten räknas, inte andra delar av banan som råkar ligga nära
    const M = main.pts.length, around = [];
    for (const c of [A, B]) for (let k = -40; k <= 40; k++) around.push((c + k + M) % M);
    const near = (x, z) => { let b = around[0], bd = Infinity; for (const k of around) { const d = (main.pts[k].x - x) ** 2 + (main.pts[k].z - z) ** 2; if (d < bd) { bd = d; b = k; } } return [main.pts[b].y, Math.sqrt(bd)]; };
    const touch = main.roadHalf + roadHalf;
    for (let i = 0; i < N; i++) {
      const [y, d] = near(pts[i].x, pts[i].z);
      const u = Math.max(0, Math.min(1, (d - touch) / (4 * s)));
      const w = u * u * (3 - 2 * u);
      pts[i].y = (y + 0.008) * (1 - w) + pts[i].y * w; // 8 mm över, så att ytorna inte flimrar
    }
  }
  const isGap = pts.map((_, i) => i === N - 1 || ranges.some(([a, b]) => frac(i) >= a && frac(i) <= b));
  // Utan kanter närmast huvudbanan; en sned påfart behöver längre öppen bit (sc.merge, meter)
  const merge = Math.round((sc.merge ?? roadHalf * 2.4) / spacing);
  // sc.freeRoam: genvägen har inga kanter alls (staket eller hus avgränsar den)
  const isOpen = pts.map((_, i) => !!sc.freeRoam || i <= merge || i >= N - 1 - merge);
  const bank = new Float32Array(N), tanB = new Float32Array(N); // genvägar doseras inte
  const tangents = [], normals = [];
  for (let i = 0; i < N; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 2, i + 1)];
    const t = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    tangents.push(t);
    normals.push(new THREE.Vector3(t.z, 0, -t.x));
  }
  // Fart längs genvägen ur krökningen (datorförarna använder den)
  const line = new Float32Array(N);
  const lineSpeed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = pts[Math.max(0, i - 4)], b = pts[i], c = pts[Math.min(N - 2, i + 4)];
    const Ar = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
    const k = (4 * Ar) / Math.max(1e-6, Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z) * Math.hypot(a.x - c.x, a.z - c.z));
    // Bara riktiga hopp (glapp ovanför golvet) körs i full fart. Glapp i
    // golvhöjd tar bara bort vallarna (av- och påfarter) och kan ligga i en
    // kurva; där gäller kurvfarten, annars kör datorn rakt ut ur böjen.
    // aiSpeed (valfritt i nivådatan) är högsta fart för datorförarna på genvägen, till
    // exempel när ett hopp där slår runt de snabbaste bilarna i full fart.
    lineSpeed[i] = Math.min(sc.aiSpeed ?? 30, isGap[i] && pts[i].y > 0.02 ? 30 : Math.sqrt((MU_REF * GRAVITY * 0.85) / Math.max(k, 1e-4)));
  }
  // Inbromsning bakåt. I luften går det inte att bromsa: farten efter ett
  // hopp måste redan gälla vid hoppkanten, annars landar datorn för fort
  // inför en kurva och tvärbromsar sig i en snurr.
  for (let i = N - 2; i >= 0; i--) {
    const air = isGap[i] && pts[i].y > 0.02;
    lineSpeed[i] = Math.min(lineSpeed[i], air ? lineSpeed[i + 1] : Math.sqrt(lineSpeed[i + 1] ** 2 + 2 * 9 * spacing));
  }
  return {
    pts, tangents, normals, dist, length, N, roadHalf, spacing, isGap, isOpen, line, lineSpeed, bank, tanB,
    barrier: main.barrier, open: true,
    // En genväg som följer marken bärs av marken: inga pelare under den
    terrain: !!(sc.followGround && main.groundAt), groundAt: sc.followGround ? main.groundAt : null,
    surfaceY(i) { return pts[Math.max(0, Math.min(N - 2, i))].y; },
    nearest(x, z, hint = -1, window = 40, y = null) {
      let best = 0, bestD = Infinity;
      const lo = hint < 0 ? 0 : Math.max(0, hint - window), hi = hint < 0 ? N - 2 : Math.min(N - 2, hint + window);
      for (let i = lo; i <= hi; i++) {
        const p = pts[i];
        let d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (y !== null) d += ((p.y - y) * 2.5) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      const n = normals[best];
      return { index: best, lateral: (x - pts[best].x) * n.x + (z - pts[best].z) * n.z, d2: bestD };
    },
    poseAt(index, lateral = 0) {
      const i = Math.max(0, Math.min(N - 2, index));
      const p = pts[i], n = normals[i], t = tangents[i];
      return { x: p.x + n.x * lateral, y: p.y, z: p.z + n.z * lateral, heading: Math.atan2(t.x, t.z), index: i, roll: 0, pitch: 0 };
    },
  };
}

// Lutning framåt vid punkt i (rad, + = nosen uppåt), mätt över ±1,2 m
function slopePitch(pts, i, N, isGap) {
  if (isGap[i]) return 0;
  const a = pts[(i - 2 + N) % N], b = pts[(i + 2) % N];
  const run = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return Math.atan2(b.y - a.y, run);
}

function filletPath(pts, spacing) {
  const out = [{ x: pts[0].x, z: pts[0].z }];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    const din = norm(sub(cur, prev)), dout = norm(sub(next, cur));
    const turn = Math.acos(clamp(din.x * dout.x + din.z * dout.z, -1, 1));
    if (turn < 0.04) { out.push({ x: cur.x, z: cur.z }); continue; }
    let r = cur.r;
    let t = r * Math.tan(turn / 2);
    const maxT = 0.46 * Math.min(dst(cur, prev), dst(next, cur));
    if (t > maxT) { t = maxT; r = t / Math.tan(turn / 2); }
    const sgn = din.x * dout.z - din.z * dout.x > 0 ? 1 : -1;
    const pIn = { x: cur.x - din.x * t, z: cur.z - din.z * t };
    const nin = { x: -din.z, z: din.x };
    const center = { x: pIn.x + nin.x * r * sgn, z: pIn.z + nin.z * r * sgn };
    const a0 = Math.atan2(pIn.z - center.z, pIn.x - center.x);
    const pOut = { x: cur.x + dout.x * t, z: cur.z + dout.z * t };
    let delta = Math.atan2(pOut.z - center.z, pOut.x - center.x) - a0;
    if (sgn > 0) { while (delta <= 0) delta += Math.PI * 2; } else { while (delta >= 0) delta -= Math.PI * 2; }
    out.push(pIn);
    const steps = Math.max(3, Math.ceil((Math.abs(delta) * r) / spacing));
    for (let k = 1; k <= steps; k++) { const ang = a0 + delta * (k / steps); out.push({ x: center.x + Math.cos(ang) * r, z: center.z + Math.sin(ang) * r }); }
  }
  out.push({ x: pts[pts.length - 1].x, z: pts[pts.length - 1].z });
  return out;
}

function resampleOpen(raw, spacing) {
  const out = [{ x: raw[0].x, z: raw[0].z }];
  let carry = spacing;
  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i], b = raw[i + 1];
    const L = dst(a, b);
    if (L < 1e-6) continue;
    let d = carry;
    while (d <= L) { const u = d / L; out.push({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }); d += spacing; }
    carry = d - L;
  }
  const last = raw[raw.length - 1];
  if (dst(out[out.length - 1], last) > spacing * 0.3) out.push({ x: last.x, z: last.z });
  return out;
}

// ---------------------------------------------------------------------------
//  Mittlinje: polygon med rundade hörn (rak + båge), sedan jämnt resamplad.
// ---------------------------------------------------------------------------
function filletPolygon(corners, spacing) {
  const n = corners.length;
  const raw = [];
  const arcs = corners.map((cur, i) => {
    const prev = corners[(i - 1 + n) % n];
    const next = corners[(i + 1) % n];
    const din = norm(sub(cur, prev));
    const dout = norm(sub(next, cur));
    const cross = din.x * dout.z - din.z * dout.x;
    const turn = Math.acos(clamp(din.x * dout.x + din.z * dout.z, -1, 1));
    if (turn < 0.04) return null;
    let r = cur.r;
    // Tangentlängd för en båge med radie r som vänder vinkeln turn.
    let t = r * Math.tan(turn / 2);
    const maxT = 0.46 * Math.min(dst(cur, prev), dst(next, cur));
    if (t > maxT) { t = maxT; r = t / Math.tan(turn / 2); }
    const sgn = cross > 0 ? 1 : -1;
    const pIn = { x: cur.x - din.x * t, z: cur.z - din.z * t };
    const pOut = { x: cur.x + dout.x * t, z: cur.z + dout.z * t };
    const nin = { x: -din.z, z: din.x };
    const center = { x: pIn.x + nin.x * r * sgn, z: pIn.z + nin.z * r * sgn };
    const a0 = Math.atan2(pIn.z - center.z, pIn.x - center.x);
    const a1 = Math.atan2(pOut.z - center.z, pOut.x - center.x);
    return { pIn, pOut, center, r, a0, a1, sgn };
  });
  for (let i = 0; i < n; i++) {
    const arc = arcs[i];
    const prevArc = arcs[(i - 1 + n) % n];
    const a = prevArc ? prevArc.pOut : corners[(i - 1 + n) % n];
    const b = arc ? arc.pIn : corners[i];
    raw.push({ x: a.x, z: a.z }, { x: b.x, z: b.z });
    if (arc) {
      let delta = arc.a1 - arc.a0;
      if (arc.sgn > 0) { while (delta <= 0) delta += Math.PI * 2; while (delta > Math.PI * 2) delta -= Math.PI * 2; }
      else { while (delta >= 0) delta -= Math.PI * 2; while (delta < -Math.PI * 2) delta += Math.PI * 2; }
      const steps = Math.max(3, Math.ceil((Math.abs(delta) * arc.r) / spacing));
      for (let k = 1; k <= steps; k++) {
        const ang = arc.a0 + delta * (k / steps);
        raw.push({ x: arc.center.x + Math.cos(ang) * arc.r, z: arc.center.z + Math.sin(ang) * arc.r });
      }
    }
  }
  return raw;
}

function resample(raw, spacing) {
  const pts = [raw[0]];
  for (let i = 1; i < raw.length; i++) if (dst(raw[i], pts[pts.length - 1]) > 1e-3) pts.push(raw[i]);
  const out = [];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const segLen = dst(a, b);
    let d = carry;
    while (d < segLen) {
      const u = d / segLen;
      out.push({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u });
      d += spacing;
    }
    carry = d - segLen;
  }
  return out;
}

function rotateToStart(pts, hint) {
  let best = 0, bestD = Infinity;
  pts.forEach((p, i) => { const d = dst(p, hint); if (d < bestD) { bestD = d; best = i; } });
  return pts.slice(best).concat(pts.slice(0, best));
}

const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
const dst = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const norm = (v) => { const l = Math.hypot(v.x, v.z) || 1; return { x: v.x / l, z: v.z / l }; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

