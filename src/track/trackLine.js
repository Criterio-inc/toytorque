import { GRAVITY } from '../core/physics.js';

// Dosering och ideallinje för banan (delar av buildTrackData i track.js).
// ---------------------------------------------------------------------------
// Dosering: vinkel (rad) per punkt. + lyfter vänsterkanten (vänster = +normal).
// En nyckel lutar hela kurvan den ligger i (så länge krökningen har samma
// tecken), med ytterkanten uppåt; tonas in och ut över fade meter (standard 10).
// ---------------------------------------------------------------------------
export const MAX_BANK_DEG = 25;
export function computeBank(flat, spacing, spec, indexOf) {
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

// ---------------------------------------------------------------------------
// Ideallinje: sidoförskjutning per punkt som minimerar krökningen inom vägen,
// sedan en fartprofil (kurvfart, acceleration framåt, inbromsning bakåt).
// Används av AI-förarna. Farterna gäller en referensbil med grepp MU_REF.
// ---------------------------------------------------------------------------
export const MU_REF = 1.2;

export function computeRacingLine(T, spec) {
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
    let v2 = (MU_REF * GRAVITY * 0.85 * gain) / Math.max(kappa, 1e-4);
    // Terräng: på ett krön blir bilen lätt och tappar grepp (och lyfter till
    // slut), i en svacka trycks den ner. kv är höjdkurvans krökning (1/m).
    if (T.terrain && !isGap[i]) {
      const d4 = 4 * T.spacing;
      const kv = (pts[(i + 4) % N].y - 2 * pts[i].y + pts[(i - 4 + N) % N].y) / (d4 * d4);
      const mu = MU_REF * 0.85 * gain;
      v2 = kappa - mu * kv > 1e-4 ? (mu * GRAVITY) / (kappa - mu * kv) : vCap * vCap;
      if (kv < 0) v2 = Math.min(v2, (GRAVITY * 0.6) / -kv);
    }
    speed[i] = Math.min(vCap, Math.sqrt(v2));
    if (isGap[i]) speed[i] = vCap; // gasa över hopp
  }
  // Acceleration framåt och inbromsning bakåt (två varv för slutningen)
  const acc = 5, brake = 9;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const j = (i - 1 + N) % N, ds = T.spacing;
      // Uppför går accelerationen trögare (bara på terräng, där backarna är långa)
      const up = T.terrain ? (GRAVITY * (pts[i].y - pts[j].y)) / ds : 0;
      speed[i] = Math.min(speed[i], Math.sqrt(speed[j] ** 2 + 2 * Math.max(1, acc - up) * ds));
    }
    for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N, ds = T.spacing;
      // Nedför bromsar bilen sämre
      const down = T.terrain ? (GRAVITY * (pts[i].y - pts[j].y)) / ds : 0;
      speed[i] = Math.min(speed[i], Math.sqrt(speed[j] ** 2 + 2 * Math.max(3, brake - down) * ds));
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
export function findTurnSigns(T) {
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

