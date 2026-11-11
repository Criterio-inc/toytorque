import * as THREE from 'three';
import { rng } from './warehouseArt.js';

// ---------------------------------------------------------------------------
// Lövverk: mjuka, knöliga kronklumpar och bladtofsar som bryter upp konturen.
// Ren geometri och canvastextur, inga bildfiler. Används av utomhusbanornas
// art-filer för träd och buskar.
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (k, fn) => (cache.has(k) ? cache.get(k) : (cache.set(k, fn()), cache.get(k)));

// Klotgeometrin har egna hörn per triangel, vilket ger platta fasetter.
// Här får hörn på samma plats dela normal så att ytan ser rund ut.
export function smoothNormals(g) {
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const acc = new Map();
  const key = (i) => `${Math.round(p.getX(i) * 2e3)},${Math.round(p.getY(i) * 2e3)},${Math.round(p.getZ(i) * 2e3)}`;
  const keys = [];
  for (let i = 0; i < p.count; i++) {
    const k = keys[i] = key(i);
    const a = acc.get(k) || acc.set(k, [0, 0, 0]).get(k);
    a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i);
  }
  for (let i = 0; i < p.count; i++) {
    const a = acc.get(keys[i]), l = Math.hypot(a[0], a[1], a[2]) || 1;
    n.setXYZ(i, a[0] / l, a[1] / l, a[2] / l);
  }
  return g;
}

// Tre varianter av en kronklump med radie ungefär 1. Knölarna är rundade
// bulor (som på en blomkål) ovanpå en lätt vågig grundform. Vertexfärgen
// (gråskala) är mörkare i vecken mellan knölarna.
export const crownGeos = (detail = 3) => cached('crown' + detail, () => [11, 23, 37].map((seed) => {
  const r = rng(seed + detail);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const waves = Array.from({ length: 4 }, () => [r() * 5, r() * 5, r() * 5, r() * 6]);
  const lumps = Array.from({ length: 16 }, () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize());
  const col = new Float32Array(p.count * 3);
  const d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    let k = 0.84;
    for (const [a, b, c, ph] of waves) k += Math.sin(d.x * a + d.y * b + d.z * c + ph) * 0.035;
    let m = 0;
    for (const L of lumps) m = Math.max(m, d.dot(L));
    const bulge = Math.max(0, (m - 0.72) / 0.28); // 0 i vecken, 1 mitt på en knöl
    k += 0.2 * Math.sin(bulge * Math.PI / 2);
    p.setXYZ(i, d.x * k, d.y * k, d.z * k);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0.72 + 0.28 * bulge;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return smoothNormals(g);
}));

// Bladtofs med genomskinlig bakgrund: en solfjäder av blad från nederkanten.
// Ljusheten ligger nära lövtexturens så att tofsarna smälter ihop med kronan.
export function leafCardTexture() {
  return cached('leafCard', () => {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const r = rng(733);
    const leaf = (x, y, len, wid, a, col) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(wid, -len * 0.5, 0, -len); ctx.quadraticCurveTo(-wid, -len * 0.5, 0, 0);
      ctx.fill();
      ctx.restore();
    };
    for (let i = 0; i < 230; i++) {
      // Tätast nere i mitten, glesare ut mot kanterna
      const a = (r() - 0.5) * 2.5, d = Math.pow(r(), 0.7) * 150;
      const x = S / 2 + Math.sin(a) * d * 0.8, y = S - 6 - Math.cos(a) * d - r() * 20;
      const k = r();
      const col = k < 0.35 ? [60, 96, 40] : k < 0.85 ? [118, 160, 82] : [176, 205, 120];
      leaf(x, y, 26 + r() * 22, 9 + r() * 6, a + (r() - 0.5) * 1.2, `rgb(${col.map((v) => Math.round(v * (0.85 + r() * 0.3))).join(',')})`);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  });
}

// Bladtofsar runt en klump med mitten (cx, cy, cz) och radien s. Varje tofs
// står rakt ut från ytan och är två plan med ryggen mot varandra, båda med
// normalen utåt från klumpen. Då får tofsen samma ljus som kronan bakom den
// i stället för att bli mörk från ena hållet.
export function leafTufts(r, cx, cy, cz, s, tint, n = 9) {
  const pos = [], nor = [], uv = [], col = [];
  const out = new THREE.Vector3(), side = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    // Mest uppåt och åt sidorna: undersidan syns sällan från en leksaksbil
    out.set(r() - 0.5, r() * 0.9 - 0.25, r() - 0.5).normalize();
    tmp.set(r() - 0.5, r() - 0.5, r() - 0.5);
    side.crossVectors(out, tmp).normalize();
    const w = s * (0.42 + r() * 0.2), h = s * (0.5 + r() * 0.25);
    const bx = cx + out.x * s * 0.72, by = cy + out.y * s * 0.62, bz = cz + out.z * s * 0.72;
    const P = [[-1, 0], [1, 0], [1, 1], [-1, 1]].map(([u, v]) => [bx + side.x * u * w + out.x * v * h, by + side.y * u * w + out.y * v * h, bz + side.z * u * w + out.z * v * h]);
    const T = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const lum = 0.8 + 0.3 * Math.max(0, out.y) + r() * 0.1;
    for (const order of [[0, 1, 2, 0, 2, 3], [0, 2, 1, 0, 3, 2]]) for (const i of order) {
      pos.push(...P[i]); uv.push(...T[i]); nor.push(out.x, out.y * 0.8 + 0.2, out.z);
      col.push(tint[0] * lum, tint[1] * lum, tint[2] * lum);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Rund, avsmalnande gren eller stam mellan två punkter
export function limb(ax, ay, az, bx, by, bz, ra, rb, seg = 7) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1, true).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize()));
  return g.translate(ax, ay, az);
}

// Stam som vidgas mot roten, med UV i meter så att barken inte dras ut
export function trunkGeo(rTop, rBase, h, seg = 14) {
  const g = new THREE.CylinderGeometry(rTop, rBase, h, seg, 8, true).translate(0, h / 2, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(0, 1 - p.getY(i) / (h * 0.22));
    const k = 1 + 0.75 * t * t;
    p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
    uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * h * 0.4);
  }
  g.computeVertexNormals();
  return g;
}
