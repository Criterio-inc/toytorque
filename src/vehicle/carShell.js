import * as THREE from 'three';
import { prep, merge } from './carParts.js';

// ---------------------------------------------------------------------------
// Lexankaross: ett tunt skal som loftas ur tvärsnitt längs bilen, plus vinge.
// Allt på karossen (lack, rutor, lampor, nummer, dekaler) målas i en
// canvas-textur per färgsättning.
//
// UV-karta (v uppåt):
//   v 0..SV          skalets omkrets (k = 0 vänster underkant .. 16 höger underkant), u = fram→bak
//   v 0.645..0.775   vingen sedd ovanifrån (u = vänster→höger sett bakifrån)
//   v 0.80..0.98     nosens (u 0.01..0.47) och aktern (u 0.53..0.99) gavlar
// ---------------------------------------------------------------------------

const N = 17; // punkter per tvärsnitt
const SV = 0.62;
const WING_V = [0.645, 0.775];
const NOSE = [0.01, 0.47, 0.8, 0.98];
const TAIL = [0.53, 0.99, 0.8, 0.98];
const TEX = 1024;

const lerp = (a, b, t) => a + (b - a) * t;

// Tvärsnitt ur parametrar: w0/y0 underkant, ws/ys skuldra (bältlinje),
// wr/yr takkant, cr extra höjd på mitten.
function sectionPts(p) {
  const L = [
    [-p.w0, p.y0],
    [-lerp(p.w0, p.ws, 0.75), lerp(p.y0, p.ys, 0.4)],
    [-p.ws, lerp(p.y0, p.ys, 0.8)],
    [-(p.ws - 0.003), p.ys],
    [-lerp(p.ws, p.wr, 0.45), lerp(p.ys, p.yr, 0.3)],
    [-lerp(p.ws, p.wr, 0.85), lerp(p.ys, p.yr, 0.8)],
    [-p.wr, p.yr],
    [-p.wr * 0.52, p.yr + p.cr * 0.8],
    [0, p.yr + p.cr],
  ];
  return [...L, ...L.slice(0, 8).reverse().map(([x, y]) => [-x, y])];
}

// Monoton kubisk interpolation (ingen översläng) av nyckelvärden längs z
function pchip(xs, ys) {
  const n = xs.length;
  const h = [], dl = [];
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; dl[i] = (ys[i + 1] - ys[i]) / h[i]; }
  const m = new Array(n);
  m[0] = dl[0]; m[n - 1] = dl[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = dl[i - 1] * dl[i] <= 0 ? 0 : (3 * (h[i - 1] + h[i])) / ((2 * h[i] + h[i - 1]) / dl[i - 1] + (h[i] + 2 * h[i - 1]) / dl[i]);
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// ---------------------------------------------------------------------------
// Karossformer per stil. Nycklar: [z, w0, y0, ws, ys, wr, yr, cr]
// ---------------------------------------------------------------------------
function layout(d) {
  const { style, yW, R, zF, zR } = d;
  if (style === 'touring') {
    const b = yW + R + 0.004; // bältlinje strax över däcken
    const y0 = d.yG + 0.013;
    const h = 0.04; // takhöjd över bältlinjen
    return {
      arches: true,
      keys: [
        [0.264, 0.118, y0 + 0.01, 0.124, b - 0.03, 0.104, b - 0.026, 0.002],
        [0.252, 0.136, y0, 0.139, b - 0.01, 0.124, b - 0.007, 0.004],
        [0.2, 0.139, y0, 0.142, b - 0.004, 0.128, b - 0.001, 0.006],
        [0.1, 0.139, y0, 0.142, b - 0.002, 0.125, b + 0.003, 0.006],
        [0.082, 0.139, y0, 0.142, b, 0.108, b + 0.01, 0.006],
        [0.018, 0.139, y0, 0.142, b + 0.001, 0.096, b + h - 0.002, 0.005],
        [-0.075, 0.139, y0, 0.142, b + 0.001, 0.096, b + h, 0.005],
        [-0.15, 0.139, y0, 0.142, b, 0.116, b + 0.009, 0.006],
        [-0.232, 0.139, y0, 0.142, b, 0.126, b + 0.006, 0.004],
        [-0.252, 0.137, y0, 0.139, b + 0.004, 0.124, b + 0.013, 0.0],
        [-0.264, 0.128, y0 + 0.01, 0.132, b - 0.01, 0.116, b + 0.005, 0.0],
      ],
      glass: { front: [0.077, 0.024], roof: [0.024, -0.07], rear: [-0.08, -0.142], side: [0.07, -0.135], sideK: [3.7, 5.85] },
      wing: null,
      lip: { z: -0.256, span: 0.22, chord: 0.022, rx: 0.45 },
      posts: [[0, zF + 0.04], [0, zR - 0.04]],
      antenna: [0.075, -0.1],
      number: { side: -0.03, top: 0.16 },
      headlightsOnHood: false,
    };
  }
  if (style === 'sport') {
    const b = yW + R + 0.004;
    const y0 = d.yG + 0.014;
    return {
      arches: true,
      keys: [
        [0.266, 0.108, y0 + 0.008, 0.115, y0 + 0.024, 0.098, y0 + 0.026, 0.0],
        [0.248, 0.134, y0, 0.14, b - 0.042, 0.124, b - 0.04, -0.002],
        [0.185, 0.14, y0, 0.146, b - 0.004, 0.13, b - 0.005, -0.007],
        [0.1, 0.136, y0, 0.14, b - 0.01, 0.12, b - 0.008, -0.004],
        [0.065, 0.134, y0, 0.138, b - 0.008, 0.098, b - 0.002, 0.002],
        [-0.015, 0.132, y0, 0.136, b - 0.004, 0.084, b + 0.036, 0.003],
        [-0.07, 0.134, y0, 0.138, b - 0.002, 0.084, b + 0.034, 0.002],
        [-0.11, 0.138, y0, 0.142, b, 0.1, b + 0.012, 0.0],
        [-0.175, 0.142, y0, 0.147, b + 0.002, 0.128, b + 0.002, -0.006],
        [-0.24, 0.136, y0, 0.14, b + 0.004, 0.124, b + 0.005, 0.0],
        [-0.262, 0.126, y0 + 0.016, 0.132, b - 0.006, 0.116, b - 0.002, 0.0],
      ],
      glass: { front: [0.058, -0.01], roof: null, rear: [-0.068, -0.105], side: [0.052, -0.095], sideK: [3.7, 5.85] },
      wing: { z: -0.226, y: b + 0.03, span: 0.25, chord: 0.05, rx: 0.1, plate: 0.02, strutX: 0.06, strutY0: b - 0.002, strutD: 0.012 },
      posts: [[0, zF + 0.045], [0, zR - 0.03]],
      antenna: [0.07, -0.13],
      number: { side: -0.035, top: 0.14 },
      headlightsOnHood: true,
    };
  }
  if (style === 'truck') {
    const y0 = yW + R + 0.012;
    return {
      arches: false,
      keys: [
        [0.262, 0.112, y0 + 0.004, 0.118, y0 + 0.024, 0.108, y0 + 0.027, 0.002],
        [0.245, 0.126, y0, 0.13, y0 + 0.036, 0.12, y0 + 0.04, 0.004],
        [0.1, 0.126, y0, 0.13, y0 + 0.04, 0.12, y0 + 0.044, 0.004],
        [0.085, 0.126, y0, 0.13, y0 + 0.042, 0.11, y0 + 0.05, 0.004],
        [0.04, 0.126, y0, 0.13, y0 + 0.042, 0.1, y0 + 0.09, 0.004],
        [-0.035, 0.126, y0, 0.13, y0 + 0.042, 0.1, y0 + 0.092, 0.004],
        [-0.05, 0.126, y0, 0.13, y0 + 0.042, 0.11, y0 + 0.05, 0.002],
        [-0.07, 0.126, y0, 0.13, y0 + 0.038, 0.122, y0 + 0.04, 0.0],
        [-0.248, 0.126, y0, 0.13, y0 + 0.038, 0.122, y0 + 0.04, 0.0],
        [-0.26, 0.114, y0 + 0.004, 0.12, y0 + 0.03, 0.11, y0 + 0.032, 0.0],
      ],
      glass: { front: [0.08, 0.042], roof: null, rear: [-0.036, -0.048], side: [0.072, -0.03], sideK: [3.7, 5.85] },
      wing: null,
      posts: [[0, zF + 0.03], [0, zR - 0.03]],
      antenna: [0.08, -0.12],
      number: { side: 0.17, top: 0.17 },
      headlightsOnHood: false,
    };
  }
  if (style === 'rally') {
    // Halvkombi: lång takrad, brant baklucka, takspoiler (lampramp m.m. i chassit)
    const b = yW + R + 0.004;
    const y0 = d.yG + 0.02;
    const h = 0.046;
    return {
      arches: true,
      keys: [
        [0.252, 0.116, y0 + 0.01, 0.122, b - 0.026, 0.104, b - 0.022, 0.002],
        [0.24, 0.134, y0, 0.137, b - 0.008, 0.122, b - 0.005, 0.004],
        [0.19, 0.137, y0, 0.14, b - 0.002, 0.126, b + 0.001, 0.006],
        [0.11, 0.137, y0, 0.14, b, 0.124, b + 0.004, 0.006],
        [0.09, 0.137, y0, 0.14, b + 0.001, 0.108, b + 0.012, 0.006],
        [0.03, 0.137, y0, 0.14, b + 0.002, 0.098, b + h - 0.002, 0.005],
        [-0.165, 0.137, y0, 0.14, b + 0.002, 0.098, b + h, 0.005],
        [-0.212, 0.137, y0, 0.14, b + 0.002, 0.106, b + h - 0.014, 0.004],
        [-0.236, 0.136, y0, 0.139, b + 0.002, 0.118, b + 0.006, 0.002],
        [-0.25, 0.128, y0 + 0.01, 0.132, b - 0.008, 0.116, b + 0.003, 0.0],
      ],
      glass: { front: [0.086, 0.034], roof: null, rear: [-0.172, -0.228], side: [0.078, -0.16], sideK: [3.7, 5.85] },
      wing: null,
      lip: { z: -0.168, span: 0.19, chord: 0.03, rx: 0.12 },
      posts: [[0, zF + 0.035], [0, zR - 0.035]],
      antenna: [0.075, -0.125],
      number: { side: -0.04, top: 0.14 },
      headlightsOnHood: false,
    };
  }
  if (style === 'formula') {
    // Formelbil: smal nos, sidolådor, luftintag bakom föraren, fram- och bakvinge
    const y0 = d.top + 0.002;
    const b = yW + R + 0.004;
    return {
      arches: false,
      keys: [
        [0.285, 0.016, y0 + 0.012, 0.018, y0 + 0.02, 0.012, y0 + 0.022, 0.002],
        [0.25, 0.024, y0 + 0.008, 0.026, y0 + 0.026, 0.018, y0 + 0.03, 0.004],
        [0.17, 0.034, y0 + 0.004, 0.036, y0 + 0.036, 0.026, y0 + 0.042, 0.006],
        [0.095, 0.044, y0, 0.046, y0 + 0.044, 0.034, y0 + 0.05, 0.008],
        [0.06, 0.08, y0, 0.084, y0 + 0.03, 0.04, y0 + 0.05, 0.008],
        [0.02, 0.088, y0, 0.09, y0 + 0.032, 0.03, y0 + 0.046, 0.006],
        [-0.035, 0.088, y0, 0.09, y0 + 0.032, 0.034, y0 + 0.072, 0.008],
        [-0.095, 0.08, y0, 0.082, y0 + 0.028, 0.032, y0 + 0.058, 0.006],
        [-0.14, 0.042, y0, 0.044, y0 + 0.03, 0.03, y0 + 0.04, 0.004],
        [-0.205, 0.03, y0 + 0.004, 0.032, y0 + 0.024, 0.024, y0 + 0.028, 0.002],
      ],
      glass: { front: null, roof: null, rear: null, side: null, sideK: [3.7, 5.85] },
      cockpit: [0.05, -0.018],
      wing: { z: zR - 0.045, y: b + 0.05, span: 0.22, chord: 0.05, rx: 0.16, plate: 0.034, strutX: 0.022, strutY0: y0 + 0.02, strutD: 0.012 },
      frontWing: { z: zF + R + 0.012, y: d.yG + 0.016, span: 0.27, chord: 0.045, plate: 0.024 },
      posts: [[0, 0.13], [0, -0.13]],
      antenna: [0.05, -0.12],
      number: { side: -0.03, top: 0.2 },
      headlightsOnHood: false,
      noHeadlights: true,
    };
  }
  if (style === 'saucer') {
    // Flygande tefat: rund skiva över hjulen (kupol och lampor i chassit)
    const Rd = 0.2;
    const rimY = yW + R + 0.016;
    const k = (z) => {
      const w = Math.sqrt(Rd * Rd - z * z);
      return [z, w * 0.62, rimY - 0.014, w, rimY, w * 0.5, rimY + 0.022, 0.014];
    };
    return {
      arches: false,
      keys: [0.198, 0.19, 0.17, 0.13, 0.07, 0, -0.07, -0.13, -0.17, -0.19, -0.198].map(k),
      glass: { front: null, roof: null, rear: null, side: null, sideK: [3.7, 5.85] },
      wing: null,
      posts: [[0, 0.1], [0, -0.1]],
      antenna: [0.1, -0.08],
      number: { side: 0, top: 0.12 },
      headlightsOnHood: false,
      noHeadlights: true,
      saucer: { R: Rd, rimY },
    };
  }
  // buggy: smal hytt framåt, motor och växellåda synliga bak, stor vinge
  const y0 = d.top + 0.003;
  const wingY = 0.05 + (yW + 0.065);
  return {
    arches: false,
    keys: [
      [0.222, 0.036, y0 + 0.004, 0.038, y0 + 0.012, 0.03, y0 + 0.014, 0.002],
      [0.2, 0.048, y0, 0.05, y0 + 0.03, 0.042, y0 + 0.033, 0.004],
      [0.13, 0.06, y0, 0.062, y0 + 0.05, 0.054, y0 + 0.054, 0.006],
      [0.07, 0.066, y0, 0.068, y0 + 0.058, 0.058, y0 + 0.064, 0.008],
      [0.025, 0.068, y0, 0.07, y0 + 0.064, 0.052, y0 + 0.108, 0.008],
      [-0.035, 0.07, y0, 0.072, y0 + 0.066, 0.052, y0 + 0.112, 0.008],
      [-0.075, 0.068, y0, 0.07, y0 + 0.058, 0.058, y0 + 0.074, 0.006],
      [-0.118, 0.06, y0, 0.062, y0 + 0.044, 0.052, y0 + 0.048, 0.004],
    ],
    glass: { front: [0.066, 0.03], roof: null, rear: null, side: [0.06, -0.04], sideK: [3.7, 5.85] },
    wing: { z: zR - 0.045, y: wingY, span: 0.2, chord: 0.075, rx: 0.12, plate: 0.034, strutX: 0.03, strutY0: d.top + 0.012, strutD: 0.012, lean: -0.25 },
    posts: [[0, 0.13], [-0.03, -0.1], [0.03, -0.1]],
    antenna: [0.05, -0.06],
    number: { side: -0.005, top: 0.12 },
    headlightsOnHood: true,
  };
}

// ---------------------------------------------------------------------------
export function buildShell(d) {
  const L = layout(d);
  const keys = [...L.keys].reverse(); // stigande z
  const zs = keys.map((k) => k[0]);
  const fn = [1, 2, 3, 4, 5, 6, 7].map((j) => pchip(zs, keys.map((k) => k[j])));
  const zFront = L.keys[0][0], zRear = L.keys[L.keys.length - 1][0];
  const len = zFront - zRear;
  const axles = [d.zF, d.zR];
  const Ra = d.R + 0.006;

  const params = (z) => {
    const [w0, y0b, ws, ys, wr, yr, cr] = fn.map((f) => f(z));
    let y0 = y0b;
    if (L.arches) {
      for (const za of axles) {
        const dz = z - za;
        if (Math.abs(dz) < Ra) y0 = Math.max(y0, Math.min(d.yW + Math.sqrt(Ra * Ra - dz * dz), ys - 0.004));
      }
    }
    return { w0, y0, ws, ys, wr, yr, cr };
  };
  const sectionAt = (z) => sectionPts(params(z));

  // Stationer: jämnt fördelade plus nycklar och hjulhusens kanter
  let st = [];
  for (let i = 0; i <= 56; i++) st.push(lerp(zFront, zRear, i / 56));
  st.push(...zs);
  if (L.arches) for (const za of axles) for (let a = -1; a <= 1; a += 0.125) st.push(za + a * Ra * 0.999);
  st = st.filter((z) => z <= zFront && z >= zRear).sort((a, b) => b - a);
  st = st.filter((z, i) => i === 0 || st[i - 1] - z > 0.0015);
  const sections = st.map(sectionAt);

  // v per punkt efter båglängd i ett referenssnitt mitt på hytten
  const ref = sectionAt(L.glass.side ? L.glass.side[0] * 0.5 + L.glass.side[1] * 0.5 : 0);
  const cum = [0];
  for (let k = 1; k < N; k++) cum.push(cum[k - 1] + Math.hypot(ref[k][0] - ref[k - 1][0], ref[k][1] - ref[k - 1][1]));
  const vk = cum.map((c) => (c / cum[N - 1]) * SV);
  const vAt = (kf) => {
    const k = Math.min(N - 2, Math.max(0, Math.floor(kf)));
    return lerp(vk[k], vk[k + 1], kf - k);
  };
  const uOf = (z) => (zFront - z) / len;

  // Loft (indexerad för mjuka normaler)
  const pos = [], uv = [], idx = [];
  sections.forEach((S, i) => {
    const u = uOf(st[i]);
    for (let k = 0; k < N; k++) { pos.push(S[k][0], S[k][1], st[i]); uv.push(u, vk[k]); }
  });
  for (let i = 0; i < st.length - 1; i++) {
    for (let k = 0; k < N - 1; k++) {
      const a = i * N + k, b = (i + 1) * N + k, c = a + 1, e = b + 1;
      idx.push(a, c, b, b, c, e);
    }
  }
  let loft = new THREE.BufferGeometry();
  loft.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  loft.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  loft.setIndex(idx);
  loft.computeVertexNormals();
  const parts = [prep(loft, null, true)];

  // Gavlar (nos och akter) med plan uv-projektion
  const cap = (S, z, rect, front) => {
    const xmax = Math.max(...S.map((p) => Math.abs(p[0])));
    const ys = S.map((p) => p[1]);
    const ymin = Math.min(...ys), ymax = Math.max(...ys);
    const cy = (ymin + ymax) / 2;
    const P = [], U = [];
    const put = (x, y) => {
      P.push(x, y, z);
      const ux = front ? x : -x;
      U.push(lerp(rect[0], rect[1], (ux / xmax + 1) / 2), lerp(rect[2], rect[3], (y - ymin) / (ymax - ymin)));
    };
    const ring = [...S, S[0]];
    for (let k = 0; k < ring.length - 1; k++) {
      const [a, b] = front ? [ring[k + 1], ring[k]] : [ring[k], ring[k + 1]];
      put(0, cy); put(a[0], a[1]); put(b[0], b[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.computeVertexNormals();
    return { g, xmax, ymin, ymax };
  };
  const nose = cap(sections[0], zFront, NOSE, true);
  const tail = cap(sections[sections.length - 1], zRear, TAIL, false);
  parts.push(nose.g, tail.g);

  // Toppens höjd vid (z, x), för fästen och antenn
  const topAt = (z, x = 0) => {
    const S = sectionAt(Math.min(zFront, Math.max(zRear, z)));
    let y = -Infinity;
    for (let k = 0; k < N - 1; k++) {
      const [x0, y0] = S[k], [x1, y1] = S[k + 1];
      if ((x - x0) * (x - x1) <= 0 && x0 !== x1) y = Math.max(y, lerp(y0, y1, (x - x0) / (x1 - x0)));
    }
    return y === -Infinity ? S[8][1] : y;
  };

  // Vinge / spoilerläpp i lexan (uv projicerad ovanifrån)
  const planarWing = (g, span, z0, chord) => {
    const p = g.attributes.position, t = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      t.setXY(i, Math.min(0.999, Math.max(0.001, 0.5 - p.getX(i) / span)), lerp(WING_V[0], WING_V[1], (p.getZ(i) - z0) / chord));
    }
    return g;
  };
  let wingInfo = null;
  if (L.wing) {
    const w = L.wing;
    const g = [];
    g.push(new THREE.BoxGeometry(w.span, 0.0025, w.chord).rotateX(w.rx).translate(0, w.y, w.z));
    g.push(new THREE.BoxGeometry(w.span, 0.008, 0.0025).translate(0, w.y + 0.004 + Math.sin(w.rx) * w.chord * 0.5, w.z - w.chord / 2 + 0.001));
    for (const sx of [-1, 1]) {
      g.push(new THREE.BoxGeometry(0.0025, w.plate, w.chord * 1.02).translate(sx * (w.span / 2 - 0.001), w.y + w.plate * 0.25, w.z));
    }
    const wing = merge(g.map((x) => prep(x, null, true)));
    parts.push(planarWing(wing, w.span, w.z - w.chord * 0.55, w.chord * 1.1));
    wingInfo = { ...w, y: w.y - 0.002 };
  }
  if (L.lip) {
    const l = L.lip;
    const y = topAt(l.z) - 0.001;
    const g = prep(new THREE.BoxGeometry(l.span, 0.002, l.chord).translate(0, 0, -l.chord / 2).rotateX(l.rx).translate(0, y, l.z + 0.004), null, true);
    parts.push(planarWing(g, l.span, l.z - l.chord, l.chord * 1.2));
  }
  if (L.frontWing) {
    const f = L.frontWing;
    const g = [new THREE.BoxGeometry(f.span, 0.003, f.chord).rotateX(0.08).translate(0, f.y, f.z)];
    g.push(new THREE.BoxGeometry(f.span * 0.92, 0.0025, f.chord * 0.45).rotateX(0.35).translate(0, f.y + 0.008, f.z - f.chord * 0.35));
    for (const sx of [-1, 1]) g.push(new THREE.BoxGeometry(0.0025, f.plate, f.chord * 1.1).translate(sx * (f.span / 2 - 0.001), f.y + f.plate * 0.3, f.z));
    // Pylon upp till nosen
    const yn = topAt(f.z - 0.01) - 0.006;
    for (const sx of [-1, 1]) g.push(new THREE.BoxGeometry(0.0025, Math.max(0.004, yn - f.y), 0.02).translate(sx * 0.008, (yn + f.y) / 2, f.z - 0.01));
    const wing = merge(g.map((x) => prep(x, null, true)));
    parts.push(planarWing(wing, f.span, f.z - f.chord * 0.7, f.chord * 1.4));
  }
  const geo = merge(parts);
  const ant = L.antenna;
  return {
    geo,
    info: {
      tailZ: zRear,
      posts: L.posts,
      topAt,
      wing: wingInfo,
      antenna: [ant[0], topAt(ant[1], ant[0]) + 0.004, ant[1]],
      saucerR: L.saucer?.R,
      rimY: L.saucer?.rimY,
    },
    paint: { L, st, sections, vAt, uOf, len, zFront, zRear, nose, tail, params },
  };
}

// ---------------------------------------------------------------------------
// Lackering: canvas-textur med ränder, startnummer, dekaler, rutor och lampor
// ---------------------------------------------------------------------------
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const FONT = '"Arial Black", "Helvetica Neue", Impact, sans-serif';
const lum = (c) => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
const WORDS = ['VOLTEX', 'GRIP+', 'TURBO', 'NITRO', 'RC PRO', 'MAXAMP', 'SPEED', 'HYPER'];

export function paintLivery(P, d, colors, number) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const g = cv.getContext('2d');
  const { L, vAt, uOf, len, sections, st } = P;
  const body = hex(colors.body), trim = hex(colors.trim), acc = hex(colors.accent);
  const X = (u) => u * TEX, Yv = (v) => (1 - v) * TEX;
  const style = d.style;
  const lightBody = lum(colors.body) > 150;
  const ink = lightBody ? '#111' : '#fff';

  g.fillStyle = body;
  g.fillRect(0, 0, TEX, TEX);

  // Rektangel i (z, k)-koordinater; spegelvänds till höger sida om mirror
  const zkRect = (z0, z1, k0, k1, mirror = true) => {
    const draw = (a, b) => g.fillRect(X(uOf(z0)), Yv(vAt(b)), X(uOf(z1)) - X(uOf(z0)), Yv(vAt(a)) - Yv(vAt(b)));
    draw(k0, k1);
    if (mirror) draw(16 - k1, 16 - k0);
  };
  const zkPoly = (pts, mirror = true) => {
    for (const side of mirror ? [0, 1] : [0]) {
      g.beginPath();
      pts.forEach(([z, k], i) => {
        const kk = side ? 16 - k : k;
        i ? g.lineTo(X(uOf(z)), Yv(vAt(kk))) : g.moveTo(X(uOf(z)), Yv(vAt(kk)));
      });
      g.closePath();
      g.fill();
    }
  };
  // Lokal ram i millimeter: sida 'L' (-x), 'R' (+x) eller 'T' (ovanpå, läsbar bakifrån)
  const stationAt = (z) => {
    let i = 0;
    while (i < st.length - 1 && st[i + 1] > z) i++;
    return sections[i];
  };
  const decal = (z, kf, side, draw) => {
    const S = stationAt(z);
    const k = Math.min(15, Math.max(0, Math.floor(kf)));
    const arc = Math.hypot(S[k + 1][0] - S[k][0], S[k + 1][1] - S[k][1]) * 1000 || 1;
    const mv = ((vAt(k + 1) - vAt(k)) * TEX) / arc;
    const mu = TEX / len / 1000;
    const kk = side === 'R' ? 16 - kf : kf;
    const x0 = X(uOf(z)), y0 = Yv(vAt(kk));
    g.save();
    if (side === 'L') g.setTransform(-mu, 0, 0, mv, x0, y0);
    else if (side === 'R') g.setTransform(mu, 0, 0, -mv, x0, y0);
    else g.setTransform(0, mv, mu, 0, x0, y0);
    draw();
    g.restore();
  };
  const both = (z, kf, draw) => { decal(z, kf, 'L', draw); decal(z, kf, 'R', draw); };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  const label = (text, w, h, bg, fg) => {
    g.fillStyle = bg; rr(-w / 2, -h / 2, w, h, h * 0.25); g.fill();
    g.fillStyle = fg; g.font = `${h * 0.72}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 0, h * 0.04, w * 0.9);
  };
  const roundel = (r) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.lineWidth = r * 0.12; g.strokeStyle = trim; g.stroke();
    g.fillStyle = '#111'; g.font = `${r * 1.25}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(number), 0, r * 0.06, r * 1.7);
  };

  // --- Underkant (tröskel) i trim-färg
  g.fillStyle = trim;
  zkRect(P.zFront, P.zRear, 0, 0.55);

  // --- Mittränder över huv och tak
  const vC = vAt(8);
  const mvTop = (() => {
    const S = stationAt(0);
    return ((vAt(9) - vAt(8)) * TEX) / (Math.hypot(S[9][0] - S[8][0], S[9][1] - S[8][1]) * 1000);
  })();
  const band = (offMm, wMm, color) => {
    g.fillStyle = color;
    g.fillRect(0, Yv(vC) + (offMm - wMm / 2) * mvTop, TEX, wMm * mvTop);
  };
  if (style === 'touring') {
    for (const o of [-11, 11]) { band(o, 15, trim); band(o, 12, acc); }
  } else if (style === 'sport') {
    band(0, 34, trim); band(0, 30, acc); band(0, 4, trim);
  } else if (style === 'buggy') {
    band(0, 26, trim); band(0, 22, acc);
  } else if (style === 'rally') {
    band(-14, 10, acc); band(14, 10, acc); band(0, 14, trim);
  } else if (style === 'formula') {
    band(0, 16, acc); band(0, 6, trim);
  } else if (style === 'saucer') {
    for (const o of [-34, 0, 34]) band(o, 3, trim);
  } else {
    band(0, 20, acc);
  }

  // --- Sidografik
  g.fillStyle = acc;
  if (style === 'touring') {
    zkRect(P.zFront, P.zRear, 2.25, 2.75);
    g.fillStyle = trim;
    zkRect(P.zFront, P.zRear, 2.05, 2.25);
  } else if (style === 'sport') {
    zkPoly([[P.zFront, 0.6], [0.05, 1.2], [-0.2, 2.9], [P.zRear, 3.0], [P.zRear, 2.3], [-0.16, 2.0], [0.04, 0.6]]);
    // Luftintag bakom dörrarna
    g.fillStyle = '#0b0c0e';
    zkPoly([[-0.085, 0.9], [-0.105, 2.6], [-0.15, 2.6], [-0.15, 0.9]]);
    g.fillStyle = '#2a2c30';
    for (let i = 0; i < 4; i++) zkRect(-0.092 - i * 0.014, -0.098 - i * 0.014, 1.0, 2.5);
  } else if (style === 'buggy') {
    zkPoly([[P.zFront, 0.6], [0.12, 1.4], [-0.04, 2.6], [P.zRear, 2.9], [P.zRear, 2.1], [-0.02, 1.7], [0.1, 0.6]]);
  } else if (style === 'rally') {
    // Snedränder i två färger längs sidan
    zkPoly([[0.2, 0.6], [0.12, 3.0], [0.06, 3.0], [0.14, 0.6]]);
    g.fillStyle = trim;
    zkPoly([[0.13, 0.6], [0.05, 3.0], [-0.24, 3.0], [-0.24, 2.4], [0.0, 2.4], [0.07, 0.6]]);
  } else if (style === 'formula') {
    zkPoly([[0.06, 0.6], [0.06, 2.8], [-0.1, 2.8], [-0.12, 0.6]]);
    g.fillStyle = trim;
    zkRect(0.05, -0.09, 1.2, 1.8);
  } else if (style === 'saucer') {
    // Ljusremsa och fönsterrad runt kanten
    g.fillStyle = acc;
    zkRect(P.zFront, P.zRear, 2.6, 3.1);
    g.fillStyle = '#0b1420';
    for (let z = 0.14; z > -0.16; z -= 0.045) zkRect(z, z - 0.022, 4.2, 5.2);
  } else {
    zkPoly([[0.24, 1.0], [0.05, 2.6], [-0.25, 2.6], [-0.25, 1.9], [0.04, 1.9], [0.2, 1.0]]);
  }

  // --- Dekaler (påhittade märken)
  const w = (i) => WORDS[(i + number) % WORDS.length];
  if (style === 'touring' || style === 'sport' || style === 'rally') {
    both(d.zF + 0.002, 1.3, () => label(w(0), 46, 11, '#fff', '#111'));
    both(d.zR - 0.006, 1.25, () => label(w(1), 46, 11, '#111', '#fff'));
    both(P.zFront - 0.03, 2.0, () => label(w(2), 30, 8, acc, ink));
  } else if (style === 'buggy') {
    both(0.13, 1.6, () => label(w(0), 34, 9, '#fff', '#111'));
    both(-0.09, 1.7, () => label(w(1), 30, 8, '#111', '#fff'));
  } else if (style === 'truck') {
    both(-0.15, 1.6, () => label(w(0), 56, 14, '#fff', '#111'));
  } else if (style === 'formula') {
    both(-0.13, 1.8, () => label(w(0), 28, 8, '#fff', '#111'));
  }

  // --- Startnummer
  both(L.number.side, style === 'buggy' ? 2.2 : 1.55, () => roundel(style === 'buggy' ? 15 : 17));
  decal(L.number.top, 8, 'T', () => roundel(style === 'buggy' ? 14 : 18));

  // --- Rutor: mörka med silverkant och en reflex
  const glassFill = (x0, y0, x1, y1) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, '#141b25'); gr.addColorStop(0.45, '#05080c'); gr.addColorStop(0.53, '#1f2a36'); gr.addColorStop(0.6, '#05080c'); gr.addColorStop(1, '#080b10');
    return gr;
  };
  const pane = (z0, z1, v0, v1) => {
    const x0 = X(uOf(z0)), x1 = X(uOf(z1)), y0 = Yv(v1), y1 = Yv(v0);
    g.fillStyle = glassFill(x0, y0, x1, y1);
    rr(x0, y0, x1 - x0, y1 - y0, 6); g.fill();
    g.lineWidth = 3; g.strokeStyle = '#c9ced5'; g.stroke();
  };
  const G = L.glass;
  const [k0, k1] = G.sideK;
  if (G.side) {
    pane(G.side[0], G.side[1], vAt(k0), vAt(k1));
    pane(G.side[0], G.side[1], vAt(16 - k1), vAt(16 - k0));
  }
  if (L.cockpit) {
    // Öppen cockpit: svart öppning med kant
    const [z0, z1] = L.cockpit;
    const x0 = X(uOf(z0)), x1 = X(uOf(z1)), y0 = Yv(vAt(10.2)), y1 = Yv(vAt(5.8));
    g.fillStyle = '#07080a'; rr(x0, y0, x1 - x0, y1 - y0, 14); g.fill();
    g.lineWidth = 5; g.strokeStyle = trim; g.stroke();
  }
  // B-stolpe på sedanen
  if (style === 'touring') { g.fillStyle = '#0a0b0d'; zkRect(-0.03, -0.038, k0, k1); }
  if (G.front && style !== 'formula') pane(G.front[0], G.front[1], vAt(6.15), vAt(9.85));
  if (G.rear) pane(G.rear[0], G.rear[1], vAt(6.25), vAt(9.75));
  if (G.roof && style === 'touring') {
    // Solskydd över vindrutan med text
    decal(G.front[1] + 0.006, 8, 'T', () => label('RC RACING', 120, 12, trim, '#fff'));
  }

  // --- Strålkastare / baklampor på gavlarna
  const capPaint = (cap, rect, lights, front) => {
    const [u0, u1, v0, v1] = rect;
    const cx = (x) => X(lerp(u0, u1, (x / cap.xmax + 1) / 2));
    const cy = (y) => Yv(lerp(v0, v1, (y - cap.ymin) / (cap.ymax - cap.ymin)));
    const H = cap.ymax - cap.ymin;
    g.fillStyle = body;
    g.fillRect(X(u0) - 4, Yv(v1) - 4, X(u1) - X(u0) + 8, Yv(v0) - Yv(v1) + 8);
    // stötfångarläpp
    g.fillStyle = trim;
    g.fillRect(X(u0) - 4, cy(cap.ymin + H * 0.18), X(u1) - X(u0) + 8, cy(cap.ymin) - cy(cap.ymin + H * 0.18) + 4);
    // grill / diffusor
    g.fillStyle = '#0c0d10';
    const gx = cap.xmax * (front ? 0.45 : 0.55);
    rr(cx(-gx), cy(cap.ymin + H * 0.62), cx(gx) - cx(-gx), cy(cap.ymin + H * 0.22) - cy(cap.ymin + H * 0.62), 8); g.fill();
    if (front) {
      g.strokeStyle = '#3a3d44'; g.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        const y = cy(cap.ymin + H * (0.22 + 0.1 * i));
        g.beginPath(); g.moveTo(cx(-gx) + 4, y); g.lineTo(cx(gx) - 4, y); g.stroke();
      }
    }
    if (!lights) return;
    for (const sx of [-1, 1]) {
      const xa = sx * cap.xmax * 0.62, w = cap.xmax * 0.34;
      const x0 = cx(xa - w / 2), x1 = cx(xa + w / 2);
      const y0 = cy(cap.ymin + H * 0.92), y1 = cy(cap.ymin + H * 0.66);
      g.fillStyle = front ? '#fffbe8' : '#e3161c';
      rr(Math.min(x0, x1), y0, Math.abs(x1 - x0), y1 - y0, 6); g.fill();
      g.lineWidth = 3; g.strokeStyle = front ? '#b9bec6' : '#5a0a0c'; g.stroke();
      if (front) { g.fillStyle = '#ffd36a'; rr(Math.min(x0, x1) + 3, y1 - 9, 14, 6, 2); g.fill(); }
    }
  };
  capPaint(P.nose, NOSE, !L.noHeadlights && (!L.headlightsOnHood || style === 'truck'), true);
  capPaint(P.tail, TAIL, true, false);
  if (L.headlightsOnHood) {
    // Lampor ritade på nosens ovansida (låg kil / buggy)
    const z0 = P.zFront - 0.008, z1 = P.zFront - (style === 'buggy' ? 0.026 : 0.034);
    for (const [ka, kb] of [[4.3, 6.4], [16 - 6.4, 16 - 4.3]]) {
      const x0 = X(uOf(z0)), x1 = X(uOf(z1)), y0 = Yv(vAt(kb)), y1 = Yv(vAt(ka));
      g.fillStyle = '#fffbe8'; rr(x0, y0, x1 - x0, y1 - y0, 8); g.fill();
      g.lineWidth = 3; g.strokeStyle = '#9aa0a8'; g.stroke();
    }
  }

  // --- Vingen
  const wy0 = Yv(WING_V[1]), wy1 = Yv(WING_V[0]);
  g.fillStyle = body; g.fillRect(0, wy0, TEX, wy1 - wy0);
  g.fillStyle = acc; g.fillRect(0, wy0 + (wy1 - wy0) * 0.12, TEX, (wy1 - wy0) * 0.3);
  g.fillStyle = trim; g.fillRect(0, wy0, TEX, (wy1 - wy0) * 0.08);
  g.fillRect(0, wy0, 14, wy1 - wy0); g.fillRect(TEX - 14, wy0, 14, wy1 - wy0);
  g.save();
  g.translate(TEX / 2, wy0 + (wy1 - wy0) * 0.66);
  g.scale(1, 0.55);
  g.fillStyle = ink; g.font = `150px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(w(3), 0, 0, TEX * 0.55);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

