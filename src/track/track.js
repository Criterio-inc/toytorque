import * as THREE from 'three';
import { G, groups, GRAVITY } from '../core/physics.js';

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
//   bank        [{at, deg, len?, fade?}]  doserad kurva: hela kurvan som
//                                  punkten ligger i lutas deg grader (ytterkanten
//                                  upp; negativt = mot kurvan), tonas in/ut
//   autoBank    grader             dosering ur krökningen överallt (max-vinkel)
//
// Doseringen ger vägen en sidlutning: en punkt med sidoförskjutning l (längs
// vänsternormalen) ligger på höjden y + l·tan(bank). Vägen lyfts så att den
// låga kanten aldrig hamnar under golvet. Max 18°.
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
  spec = { ...spec, gaps: (spec.gaps || []).map(rangeOf), openings: (spec.openings || []).map(rangeOf) };

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

  // Dosering (sidlutning) per punkt, och lyft så att låga kanten går fri från golvet
  const bank = computeBank(flat, spacing, spec, (k) => Math.round(fracAt(k) * N) % N);
  const tanB = bank.map(Math.tan);
  // Lyftet tonas in före och ut efter doseringen (8 m), så att ytterkanten
  // stiger och sjunker mjukt i stället för att kasta upp bilen.
  const need = tanB.map((t) => (t ? roadHalf * Math.abs(t) + 0.02 : 0));
  if (need.some((v) => v > 0)) {
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
  const isOpen = pts.map((_, i) => inRanges(frac(i), spec.openings));

  // Genvägar: avfart och påfart på huvudbanan (öppningar i vallarna där)
  const shortcutSpecs = (spec.shortcuts || []).map((sc) => {
    const near = (k) => { let b = 0, bd = Infinity; for (let i = 0; i < N; i++) { const d = (flat[i].x - k[0] * s) ** 2 + (flat[i].z - k[1] * s) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
    const A = near(sc.from), B = near(sc.to);
    const w = Math.round((roadHalf * 2.4) / spacing);
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

  // Checkpoints: plan tvärs banan, jämnt fördelade, aldrig mitt i ett glapp.
  const NUM_CP = spec.checkpoints ?? 14;
  const checkpoints = [];
  for (let i = 0; i < NUM_CP; i++) {
    let idx = Math.round((i / NUM_CP) * N) % N;
    // Aldrig i eller strax efter ett glapp: bilen kan passera planet i luften
    const clearBack = Math.round(8 / spacing);
    const nearGap = (j) => { for (let k = 0; k <= clearBack; k++) if (isGap[(j - k + N) % N]) return true; return false; };
    for (let k = 0; k < N && nearGap(idx); k++) idx = (idx + 1) % N;
    checkpoints.push({
      index: idx, x: pts[idx].x, y: pts[idx].y, z: pts[idx].z,
      tangent: tangents[idx], normal: normals[idx], halfWidth: roadHalf + 0.6,
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

  const data = {
    pts, tangents, normals, dist, length, N, roadHalf, spacing, checkpoints, isGap, isOpen, bank, tanB,
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
//   { from:[x,z], to:[x,z], via:[[x,z],...], r, roadHalf, elevation, gaps, ai }
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
  // Höjd: från huvudbanans höjd vid A till höjden vid B, med egna nycklar emellan
  const keys = [[0, pa.y, false], ...(sc.elevation || []).map((e) => [fracAt(e.at ?? e[0]), e.y ?? e[1], !!(e.linear ?? e[2])]), [1, pb.y, false]].sort((a, b) => a[0] - b[0]);
  const heightAt = (f) => {
    let k = keys.findIndex((e) => e[0] > f);
    if (k <= 0) return k === 0 ? keys[0][1] : keys[keys.length - 1][1];
    const a = keys[k - 1], b = keys[k];
    const u = (f - a[0]) / (b[0] - a[0] || 1);
    return a[1] + (b[1] - a[1]) * (b[2] ? u : u * u * (3 - 2 * u));
  };
  const ranges = (sc.gaps || []).map((g) => [fracAt(g.from), fracAt(g.to)]);
  const pts = flat.map((p, i) => ({ x: p.x, y: heightAt(frac(i)), z: p.z }));
  const isGap = pts.map((_, i) => i === N - 1 || ranges.some(([a, b]) => frac(i) >= a && frac(i) <= b));
  const merge = Math.round((roadHalf * 2.4) / spacing);
  const isOpen = pts.map((_, i) => i <= merge || i >= N - 1 - merge);
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
    lineSpeed[i] = isGap[i] && pts[i].y > 0.02 ? 30 : Math.min(30, Math.sqrt((MU_REF * GRAVITY * 0.85) / Math.max(k, 1e-4)));
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

// ---------------------------------------------------------------------------
// Dosering: vinkel (rad) per punkt. + lyfter vänsterkanten (vänster = +normal).
// En nyckel lutar hela kurvan den ligger i (så länge krökningen har samma
// tecken), med ytterkanten uppåt; tonas in och ut över fade meter (standard 10).
// ---------------------------------------------------------------------------
export const MAX_BANK_DEG = 18;
function computeBank(flat, spacing, spec, indexOf) {
  const N = flat.length;
  const bank = new Float32Array(N);
  const keys = spec.bank || [];
  if (!keys.length && !spec.autoBank) return bank;
  const curv = signedCurvature(flat, spacing);
  const deg = new Float32Array(N);
  if (spec.autoBank) {
    const max = Math.min(MAX_BANK_DEG, spec.autoBank === true ? 12 : spec.autoBank);
    const full = 1 / 7; // radie 7 m eller snävare ger full dosering
    for (let i = 0; i < N; i++) deg[i] = Math.sign(curv[i]) * Math.min(max, (max * Math.abs(curv[i])) / full);
  }
  const thr = 0.02;
  const wrap = (i) => ((i % N) + N) % N;
  for (const key of keys) {
    const c = indexOf(key.at);
    // Kurvans riktning: starkaste krökningen inom ±4 m från nyckeln
    let sg = 0, bestK = 0;
    const w = Math.round(4 / spacing);
    for (let k = -w; k <= w; k++) { const v = curv[wrap(c + k)]; if (Math.abs(v) > bestK) { bestK = Math.abs(v); sg = Math.sign(v); } }
    if (!sg) continue;
    let a = c, b = c;
    if (key.len) { const h = Math.round(key.len / 2 / spacing); a = c - h; b = c + h; }
    else {
      while (c - a < N / 2 && curv[wrap(a - 1)] * sg > thr) a--;
      while (b - c < N / 2 && curv[wrap(b + 1)] * sg > thr) b++;
    }
    const fade = Math.max(1, Math.round((key.fade ?? 10) / spacing));
    for (let k = a - fade; k <= b + fade; k++) {
      const u = k < a ? (k - (a - fade)) / fade : k > b ? (b + fade - k) / fade : 1;
      const v = sg * key.deg * u * u * (3 - 2 * u);
      const i = wrap(k);
      if (Math.abs(v) > Math.abs(deg[i])) deg[i] = v;
    }
  }
  // Utjämning (±1,5 m) så att övergångarna blir mjuka, sedan tak
  const sw = Math.max(1, Math.round(1.5 / spacing));
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let k = -sw; k <= sw; k++) sum += deg[wrap(i + k)];
    const d = Math.max(-MAX_BANK_DEG, Math.min(MAX_BANK_DEG, sum / (2 * sw + 1)));
    bank[i] = Math.abs(d) < 0.05 ? 0 : (d * Math.PI) / 180;
  }
  return bank;
}

// Krökning (1/m) med tecken i planet: + = högersväng
function signedCurvature(flat, spacing) {
  const N = flat.length;
  const span = Math.max(2, Math.round(1.5 / spacing));
  const curv = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = flat[(i - span + N) % N], b = flat[i], c = flat[(i + span) % N];
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    const l = Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z) * Math.hypot(c.x - a.x, c.z - a.z);
    curv[i] = (2 * cross) / Math.max(1e-6, l);
  }
  return curv;
}

// Öppen polyline med rundade inre hörn
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
// Ideallinje: sidoförskjutning per punkt som minimerar krökningen inom vägen,
// sedan en fartprofil (kurvfart, acceleration framåt, inbromsning bakåt).
// Används av AI-förarna. Farterna gäller en referensbil med grepp MU_REF.
// ---------------------------------------------------------------------------
export const MU_REF = 1.2;

function computeRacingLine(T, spec) {
  const { pts, normals, N, roadHalf, isGap } = T;
  const margin = spec.lineMargin ?? 0.45;
  const bound = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // Nära glapp och höjdskillnader: håll mitten
    let near = false;
    for (let k = -6; k <= 6 && !near; k++) near = isGap[(i + k + N) % N];
    // I och kring doserade kurvor: håll avstånd till den låga innerkanten,
    // lutningen drar bilen nedåt mot den
    let tb = 0;
    if (T.tanB) for (let k = -12; k <= 12; k++) tb = Math.max(tb, Math.abs(T.tanB[(i + k + N) % N]));
    // Utan vallar (tunnlar, av- och påfarter) står väggar, klossar och
    // staket i kanten: de fjädrar inte som en vall, så håll mer marginal
    let open = false;
    if (T.isOpen) for (let k = -4; k <= 4 && !open; k++) open = T.isOpen[(i + k + N) % N];
    bound[i] = near ? 0 : Math.max(0, roadHalf - margin - Math.min(0.6, tb * 1.8) - (open ? 0.35 : 0));
  }
  const off = new Float32Array(N);
  const k = 3;
  for (let it = 0; it < 400; it++) {
    for (let i = 0; i < N; i++) {
      const a = (i - k + N) % N, b = (i + k) % N;
      const ax = pts[a].x + normals[a].x * off[a], az = pts[a].z + normals[a].z * off[a];
      const bx = pts[b].x + normals[b].x * off[b], bz = pts[b].z + normals[b].z * off[b];
      const mx = (ax + bx) / 2 - pts[i].x, mz = (az + bz) / 2 - pts[i].z;
      const want = mx * normals[i].x + mz * normals[i].z;
      const o = off[i] + (want - off[i]) * 0.6;
      off[i] = Math.max(-bound[i], Math.min(bound[i], o));
    }
  }
  // Krökning längs linjen (omskriven cirkel genom tre punkter)
  const P = (i) => { const j = (i + N) % N; return [pts[j].x + normals[j].x * off[j], pts[j].z + normals[j].z * off[j]]; };
  const speed = new Float32Array(N);
  const vCap = 30;
  for (let i = 0; i < N; i++) {
    const [ax, az] = P(i - 4), [bx, bz] = P(i), [cx, cz] = P(i + 4);
    const A = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
    const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ca = Math.hypot(ax - cx, az - cz);
    const kappa = (4 * A) / Math.max(1e-6, ab * bc * ca);
    // Doserad kurva: lutningen bär en del av sidkraften. Effektivt grepp
    // (μ + tanθ)/(1 − μ·tanθ) med θ positiv när ytterkanten ligger högst.
    const turn = Math.sign((bx - ax) * (cz - bz) - (bz - az) * (cx - bx)); // + = höger
    const gain = bankGain(T.tanB ? T.tanB[i] * turn : 0);
    speed[i] = Math.min(vCap, Math.sqrt((MU_REF * GRAVITY * 0.85 * gain) / Math.max(kappa, 1e-4)));
    if (isGap[i]) speed[i] = vCap; // gasa över hopp
  }
  // Acceleration framåt och inbromsning bakåt (två varv för slutningen)
  const acc = 5, brake = 9;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const j = (i - 1 + N) % N, ds = T.spacing;
      speed[i] = Math.min(speed[i], Math.sqrt(speed[j] ** 2 + 2 * acc * ds));
    }
    for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N, ds = T.spacing;
      speed[i] = Math.min(speed[i], Math.sqrt(speed[j] ** 2 + 2 * brake * ds));
    }
  }
  T.line = off;
  T.lineSpeed = speed;
}

// Hur mycket mer sidkraft en doserad kurva tål (1 = plan väg). tanEff > 0
// när ytterkanten ligger högst. Räknas med lite försiktigt grepp och ett tak.
export function bankGain(tanEff) {
  if (!tanEff) return 1;
  const mu = MU_REF * 0.85;
  const eff = (mu + tanEff) / Math.max(0.2, 1 - mu * tanEff);
  return Math.max(0.5, Math.min(1.3, eff / mu));
}

// Svängpilar före skarpa kurvor (röda pilar i luften).
function findTurnSigns(T) {
  const { tangents, N, spacing, isGap } = T;
  const signs = [];
  const span = Math.round(9 / spacing);
  let lastAt = -1e9;
  for (let i = 0; i < N; i++) {
    const a = tangents[i], b = tangents[(i + span) % N];
    const cross = a.x * b.z - a.z * b.x; // >0: höger när +x är vänster
    const turn = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z)));
    if (turn < 1.0 || T.dist[i] - lastAt < 18) continue;
    const at = (i - Math.round(4 / spacing) + N) % N;
    if (isGap[at]) continue;
    const dir = cross > 0 ? 'right' : 'left';
    signs.push({ index: at, dir, sharp: turn > 1.9 });
    lastAt = T.dist[i];
    i += span;
  }
  return signs;
}

// --- Fysik: vägyta (trimesh), sidor på upphöjda delar, vallar och pelare -------
export function buildTrackPhysics(world, RAPIER, data) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  physicsFor(world, RAPIER, data, body);
  for (const sc of data.shortcuts || []) physicsFor(world, RAPIER, sc.path, body);
  return body;
}

function physicsFor(world, RAPIER, data, body) {
  const road = roadGeometry(data);
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(road.pos, road.idx).setFriction(1).setCollisionGroups(groups(G.WORLD)),
    body
  );
  const sides = sideGeometry(data);
  if (sides.idx.length) {
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(sides.pos, sides.idx).setFriction(0.4).setCollisionGroups(groups(G.WORLD)),
      body
    );
  }
  // Kantvallar som lådor längs kanten, lutade med vägen
  const { height, thick } = data.barrier;
  const off = data.roadHalf + thick / 2;
  for (const seg of barrierSegments(data)) {
    for (const side of [1, -1]) {
      const a = edge3(data, seg.i, side * off), b = edge3(data, seg.j, side * off);
      const q = segmentQuat(a, b);
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) + thick;
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(thick / 2, height / 2, len / 2)
          .setTranslation((a.x + b.x) / 2, (a.y + b.y) / 2 + height / 2, (a.z + b.z) / 2)
          .setRotation(q)
          .setFriction(0.3).setRestitution(0.3)
          .setCollisionGroups(groups(G.WORLD)),
        body
      );
    }
  }
  // Rampbitarna vid ett glapp fylls med massiva block (vägytan är bara ett
  // skal), så att en bil som inte når över inte kan glida in under rampen.
  const { isGap, N } = data;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const edgeAt = !isGap[i] && isGap[j] ? i : isGap[i] && !isGap[j] ? j : -1;
    if (edgeAt < 0) continue;
    const dir = edgeAt === i ? -1 : 1; // bort från glappet, längs rampen
    for (let k = 0, idx = edgeAt; k < 60; k++, idx = (idx + dir + N) % N) {
      const p = data.pts[idx], t = data.tangents[idx];
      const h = p.y - Math.abs(data.roadHalf * (data.tanB ? data.tanB[idx] : 0)) - 0.06; // toppen strax under vägytans lägsta kant
      if (h < 0.04 || isGap[idx]) break;
      const ang = Math.atan2(t.x, t.z);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(data.roadHalf, h / 2, data.spacing * 0.55)
          .setTranslation(p.x, h / 2, p.z)
          .setRotation({ x: 0, y: Math.sin(ang / 2), z: 0, w: Math.cos(ang / 2) })
          .setFriction(0.4)
          .setCollisionGroups(groups(G.WORLD)),
        body
      );
    }
  }

  for (const p of pillars(data)) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.06, p.h / 2, 0.06).setTranslation(p.x, p.h / 2, p.z).setCollisionGroups(groups(G.WORLD)),
      body
    );
  }
}

// Slät yta strax under vägen mellan punkterna i0..i1 (även genom glapp), halv
// bredd half. Används under trappor: en bil som inte når över glappet landar
// på stegnosarna och rullar vidare nedför i stället för att fastna.
// dip sänker mitten (en svacka i ett kort glapp som en långsam bil rullar
// igenom i stället för att fastna mellan kanterna).
export function addUnderlay(world, RAPIER, data, i0, i1, half, drop = 0.008, dip = 0) {
  const pos = [], idx = [];
  const n = ((i1 - i0 + data.N) % data.N) + 1;
  for (let k = 0; k < n; k++) {
    const i = (i0 + k) % data.N, p = data.pts[i], nn = data.normals[i];
    const y = p.y - drop - dip * Math.sin((Math.PI * k) / Math.max(1, n - 1));
    pos.push(p.x + nn.x * half, y, p.z + nn.z * half, p.x - nn.x * half, y, p.z - nn.z * half);
    if (k > 0) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)).setFriction(0.8).setCollisionGroups(groups(G.WORLD)), body);
}

// --- Grafik --------------------------------------------------------------------
export function buildTrackMesh(scene, data, theme = {}) {
  const group = new THREE.Group();
  const roadMat = new THREE.MeshStandardMaterial({
    map: makeRoadTexture(theme.road ?? '#3a3d45'), roughness: theme.roadRough ?? 0.75,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  meshFor(data, theme, group, roadMat);
  for (const sc of data.shortcuts || []) meshFor(sc.path, theme, group, roadMat);

  // Rutig mållinje vid index 0
  const p0 = data.pts[0], t0 = data.tangents[0];
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(data.roadHalf * 2, 0.35),
    new THREE.MeshStandardMaterial({ map: makeChecker(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 })
  );
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.atan2(t0.x, t0.z);
  line.position.set(p0.x, p0.y + 0.006, p0.z);
  line.receiveShadow = true;
  group.add(line);

  // Svängpilar som svävar på ytterkanten
  const signs = buildSigns(data);
  group.add(signs);
  group.userData.animate = signs.userData.animate;

  scene.add(group);
  return group;
}

// Väg, sidor, vallar och pelare för en vägsträcka (huvudbanan eller en genväg)
function meshFor(data, theme, group, roadMat) {
  const road = roadGeometry(data, true);
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(road.pos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(road.uv, 2));
  roadGeo.setIndex(Array.from(road.idx));
  roadGeo.computeVertexNormals();
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  roadMesh.castShadow = true;
  group.add(roadMesh);

  // Sidor och undersida på upphöjda delar
  const sides = sideGeometry(data);
  if (sides.idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(sides.pos, 3));
    g.setIndex(Array.from(sides.idx));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: theme.side ?? 0x8a6a48, roughness: 0.8, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }

  // Kantvallar: en sammanslagen geometri med röd/vita fält
  const { height, thick } = data.barrier;
  const bPos = [], bCol = [], bIdx = [];
  const red = new THREE.Color(theme.barrierA ?? 0xd23b3b);
  const white = new THREE.Color(theme.barrierB ?? 0xf0f0f0);
  let stripe = 0;
  for (const seg of barrierSegments(data)) {
    const col = stripe++ % 2 === 0 ? red : white;
    for (const side of [1, -1]) {
      const inner = side * data.roadHalf, outer = side * (data.roadHalf + thick);
      const q = [edge3(data, seg.i, inner), edge3(data, seg.j, inner), edge3(data, seg.j, outer), edge3(data, seg.i, outer)];
      const base = bPos.length / 3;
      for (const top of [0, height]) for (const v of q) { bPos.push(v.x, v.y + top, v.z); bCol.push(col.r, col.g, col.b); }
      const f = (a, b, c, d) => bIdx.push(base + a, base + b, base + c, base + a, base + c, base + d);
      f(4, 5, 6, 7); f(0, 1, 5, 4); f(1, 2, 6, 5); f(2, 3, 7, 6); f(3, 0, 4, 7);
    }
  }
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
  bGeo.setAttribute('color', new THREE.Float32BufferAttribute(bCol, 3));
  bGeo.setIndex(bIdx);
  bGeo.computeVertexNormals();
  const barriers = new THREE.Mesh(bGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }));
  barriers.castShadow = barriers.receiveShadow = true;
  group.add(barriers);

  // Pelare under upphöjda delar
  const pl = pillars(data);
  if (pl.length) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1, 0.12), new THREE.MeshStandardMaterial({ color: theme.pillar ?? 0x9b9b9b, roughness: 0.6 }), pl.length);
    const m4 = new THREE.Matrix4();
    pl.forEach((p, i) => inst.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, p.h / 2, p.z), new THREE.Quaternion(), new THREE.Vector3(1, p.h, 1))));
    inst.castShadow = inst.receiveShadow = true;
    group.add(inst);
  }
}

function buildSigns(data) {
  const g = new THREE.Group();
  const tex = { left: makeArrowTexture(false), right: makeArrowTexture(true) };
  const mats = {
    left: new THREE.MeshBasicMaterial({ map: tex.left, transparent: true, side: THREE.DoubleSide, fog: true }),
    right: new THREE.MeshBasicMaterial({ map: tex.right, transparent: true, side: THREE.DoubleSide, fog: true }),
  };
  const geo = new THREE.PlaneGeometry(0.7, 0.7);
  for (const s of data.signs) {
    const lateral = (s.dir === 'right' ? 1 : -1) * (data.roadHalf * 0.55); // på ytterkanten av svängen
    const p = data.poseAt(s.index, lateral);
    const m = new THREE.Mesh(geo, mats[s.dir]);
    m.position.set(p.x, p.y + 0.95, p.z);
    m.rotation.y = p.heading + Math.PI; // vänd mot inkommande bilar
    m.userData.bob = Math.random() * 6;
    m.userData.y = m.position.y;
    g.add(m);
  }
  g.userData.animate = (t) => g.children.forEach((m) => { m.position.y = m.userData.y + Math.sin(t * 2 + m.userData.bob) * 0.04; });
  return g;
}

// ---------------------------------------------------------------------------
//  Geometrihjälpare
// ---------------------------------------------------------------------------

// Vägytan: triangelremsa som hoppar över glappen.
function roadGeometry(data, withUv = false) {
  const { pts, normals, N, roadHalf, isGap } = data;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const p = pts[i % N], n = normals[i % N];
    const y = p.y + 0.004, dy = roadHalf * (data.tanB ? data.tanB[i % N] : 0);
    pos.push(p.x + n.x * roadHalf, y + dy, p.z + n.z * roadHalf, p.x - n.x * roadHalf, y - dy, p.z - n.z * roadHalf);
    if (withUv) { const v = (data.dist[i] ?? data.length) / 0.9; uv.push(0, v, (roadHalf * 2) / 0.9, v); }
  }
  for (let i = 0; i < N; i++) {
    if (isGap[i] || isGap[(i + 1) % N]) continue;
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  return { pos: new Float32Array(pos), uv, idx: new Uint32Array(idx) };
}

// Vertikala sidor från vägkanten ner till golvet där vägen ligger högt,
// plus en front vid varje glapp.
function sideGeometry(data) {
  const { pts, normals, N, roadHalf, isGap } = data;
  const pos = [], idx = [];
  const high = (i) => pts[i % N].y > 0.03 && !isGap[i % N];
  const quad = (a, b, c, d) => {
    const base = pos.length / 3;
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    if (!high(i) || !high(j)) continue;
    const over = overRoad(data, i);
    for (const side of [1, -1]) {
      const a = edge3(data, i, roadHalf * side), b = edge3(data, j, roadHalf * side);
      const ya = over ? a.y - 0.08 : 0, yb = over ? b.y - 0.08 : 0;
      quad(a, b, { ...b, y: yb }, { ...a, y: ya });
    }
    if (over) {
      // Undersida på bron
      const L = (k, sd) => { const e = edge3(data, k, roadHalf * sd); e.y -= 0.08; return e; };
      quad(L(i, 1), L(j, 1), L(j, -1), L(i, -1));
    }
  }
  // Fronter vid glappens kanter
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const edgeAt = !isGap[i] && isGap[j] ? i : isGap[i] && !isGap[j] ? j : -1;
    if (edgeAt < 0 || pts[edgeAt].y < 0.03) continue;
    const L = edge3(data, edgeAt, roadHalf), R = edge3(data, edgeAt, -roadHalf);
    quad(L, R, { ...R, y: 0 }, { ...L, y: 0 });
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

// Vallsegment var tredje punkt, utom i glapp och öppningar. Exporteras så att
// nivåer som flyttar vallar (hoodArt) räknar exakt som banmotorn.
export function barrierSegments(data) {
  const { N, isGap, isOpen } = data;
  const out = [];
  const stride = 3;
  for (let i = 0; i < N; i += stride) {
    const j = Math.min(i + stride, N) % N;
    let skip = false;
    for (let k = i; k <= i + stride && !skip; k++) skip = isGap[k % N] || isOpen[k % N];
    if (!skip) out.push({ i, j });
  }
  return out;
}

// Pelare under vägkanten där vägen ligger högt, men aldrig på en annan vägbit.
function pillars(data) {
  if (data._pillars) return data._pillars;
  const { pts, normals, N, roadHalf, isGap } = data;
  const out = [];
  const every = Math.round(3 / data.spacing);
  for (let i = 0; i < N; i += every) {
    if (pts[i].y < 0.25 || isGap[i]) continue;
    for (const side of [1, -1]) {
      const { x, y: h, z } = edge3(data, i, (roadHalf - 0.1) * side);
      let blocked = false;
      for (let k = 0; k < N && !blocked; k += 2) {
        if (Math.abs(data.dist[k] - data.dist[i]) < 6 || pts[k].y > 0.2) continue;
        blocked = (pts[k].x - x) ** 2 + (pts[k].z - z) ** 2 < (roadHalf + 0.4) ** 2;
      }
      if (!blocked && h > 0.1) out.push({ x, z, h });
    }
  }
  data._pillars = out;
  return out;
}

// Ligger punkt i ovanför en annan (lägre) del av banan?
function overRoad(data, i) {
  data._over = data._over || new Map();
  if (data._over.has(i)) return data._over.get(i);
  const { pts, N, roadHalf } = data;
  let hit = false;
  if (pts[i].y > 0.4) {
    for (let k = 0; k < N && !hit; k++) {
      if (Math.abs(data.dist[k] - data.dist[i]) < 8 || pts[k].y > pts[i].y - 0.4) continue;
      hit = (pts[k].x - pts[i].x) ** 2 + (pts[k].z - pts[i].z) ** 2 < (roadHalf * 2 + 0.6) ** 2;
    }
  }
  data._over.set(i, hit);
  return hit;
}

// Punkt på vägytan (eller dess förlängning) off meter till vänster om mittlinjen
export const edge3 = (data, i, off) => {
  const k = i % data.N, p = data.pts[k], n = data.normals[k];
  return { x: p.x + n.x * off, y: p.y + off * (data.tanB ? data.tanB[k] : 0), z: p.z + n.z * off };
};

// Höjdtillägg från doseringen off meter till vänster om mittlinjen vid punkt i
// (för nivåernas egna vägskinn som annars läggs plant över vägen)
export const bankY = (data, i, off) => (data.tanB ? off * data.tanB[((i % data.N) + data.N) % data.N] : 0);

// Mittpunkt för en vallbit (som kolliderarna läggs ut)
export function barrierCenter(data, seg, side) {
  const { height, thick } = data.barrier;
  const off = side * (data.roadHalf + thick / 2);
  const a = edge3(data, seg.i, off), b = edge3(data, seg.j, off);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + height / 2, z: (a.z + b.z) / 2 };
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
function segmentQuat(a, b) {
  _z.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
  _x.set(0, 1, 0).cross(_z).normalize();
  _y.copy(_z).cross(_x);
  _m.makeBasis(_x, _y, _z);
  const q = new THREE.Quaternion().setFromRotationMatrix(_m);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
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

function makeRoadTexture(base) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  // Fint brus som asfalt, plus några ljusare stenar
  const img = ctx.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16 + (Math.random() < 0.02 ? 26 : 0);
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeChecker() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 16;
  const ctx = c.getContext('2d');
  for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) {
    ctx.fillStyle = (x + y) % 2 === 0 ? '#111' : '#eee';
    ctx.fillRect(x * 8, y * 8, 8, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

// Röd böjd pil med vit kant (riktning i bild: höger eller vänster)
function makeArrowTexture(right) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (!right) { ctx.translate(128, 0); ctx.scale(-1, 1); }
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(40, 116);
    ctx.lineTo(40, 64);
    ctx.quadraticCurveTo(40, 34, 70, 34);
    ctx.lineTo(78, 34);
    ctx.lineTo(78, 14);
    ctx.lineTo(118, 48);
    ctx.lineTo(78, 82);
    ctx.lineTo(78, 62);
    ctx.lineTo(72, 62);
    ctx.quadraticCurveTo(66, 62, 66, 70);
    ctx.lineTo(66, 116);
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  path(); ctx.lineWidth = 10; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  path(); ctx.fillStyle = '#e1251b'; ctx.fill();
  path(); ctx.lineWidth = 2; ctx.strokeStyle = '#7a0d08'; ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
