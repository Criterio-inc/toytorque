import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------------
// Delar till radiobilarna: chassi, hjul, länkarmar, stötdämpare, drivaxlar,
// motor. Allt är egna primitiver; statiska delar slås ihop per material med
// vertexfärger så att en bil blir några få ritanrop.
// ---------------------------------------------------------------------------

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// Gör geometrin icke-indexerad, sätter vertexfärg och tar bort uv (om inte
// den ska vara kvar) så att allt går att slå ihop.
export function prep(geo, color, keepUv = false) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!keepUv && g.attributes.uv) g.deleteAttribute('uv');
  if (color != null) {
    _c.set(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

// Flytta/vrid/skala en geometri: p = [x,y,z], r = [rx,ry,rz], s = [sx,sy,sz]
export function xf(geo, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  _e.set(r[0], r[1], r[2]);
  _q.setFromEuler(_e);
  _m.compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
  geo.applyMatrix4(_m);
  return geo;
}

export const merge = (list) => {
  const g = mergeGeometries(list, false);
  list.forEach((x) => x.dispose());
  return g;
};

// Cylinder mellan två punkter
export function rod(a, b, r, seg = 6, r2 = r) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1);
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(Y, d.normalize());
  _m.compose(A, _q, _s.set(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

// Cylinder längs x (för hjul, motorer, axlar)
export function cylX(r, len, seg = 16, x = 0, y = 0, z = 0, r2 = r, open = false) {
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, open);
  g.rotateZ(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}
export function cylZ(r, len, seg = 16, x = 0, y = 0, z = 0) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}
export const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
export const rbox = (w, h, d, x = 0, y = 0, z = 0, r = Math.min(w, h, d) * 0.25) =>
  new RoundedBoxGeometry(w, h, d, 2, r).translate(x, y, z);

// Platta i xz-planet ur en 2D-kontur (x, z), tjocklek t, undersida på y0
export function flatPlate(pts, t, y0, holes = []) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, z))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(Math.PI / 2);
  g.translate(0, y0 + t, 0);
  return g;
}
// Stående platta i xy-planet (stötdämpartorn, vingfästen), tjocklek t längs z
export function standPlate(pts, t, z, holes = []) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, z - t / 2);
  return g;
}
// Rundad rektangel som punktlista
export function roundRect(x0, y0, x1, y1, r, n = 3) {
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * Math.PI / 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(x1 - r, y0 + r, -Math.PI / 2);
  corner(x1 - r, y1 - r, 0);
  corner(x0 + r, y1 - r, Math.PI / 2);
  corner(x0 + r, y0 + r, Math.PI);
  return pts;
}

// ---------------------------------------------------------------------------
// Mått som hela bilen byggs kring (ur fysikens hjul- och fjädervärden)
// ---------------------------------------------------------------------------
export function carDims(def) {
  const w = def.wheel, s = def.susp;
  const style = def.style || 'buggy';
  const R = w.radius, W = w.width, X = w.x;
  const yW = w.attachY - (s.rest - s.sag); // hjulcentrum i vila
  const yG = yW - R; // marken
  const S = {
    buggy: { clear: 0.024, pw: 0.05, xi: 0.028, xs: 0.058, ys: 0.95, ysF: 0.68 },
    touring: { clear: 0.008, pw: 0.082, xi: 0.04, xs: 0.06, ys: 0.55 },
    sport: { clear: 0.008, pw: 0.082, xi: 0.04, xs: 0.062, ys: 0.48 },
    truck: { clear: 0.045, pw: 0.05, xi: 0.03, xs: 0.07, ys: 1.25 },
    rally: { clear: 0.016, pw: 0.078, xi: 0.04, xs: 0.06, ys: 0.7 },
    formula: { clear: 0.008, pw: 0.056, xi: 0.034, xs: 0.058, ys: 0.5 },
    saucer: { clear: 0.02, pw: 0.06, xi: 0.035, xs: 0.06, ys: 0.8 },
  }[style] || {};
  const plateY = yG + S.clear;
  const top = plateY + 0.004;
  return {
    style, R, W, X, zF: w.zF, zR: w.zR, attachY: w.attachY, yW, yG,
    plateY, top, pw: S.pw,
    pzF: w.zF + R * (style === 'buggy' ? 0.85 : 1.25),
    pzR: w.zR - R * (style === 'buggy' ? 0.7 : 1.25),
    xi: S.xi, yLi: top + 0.006, // undre länkarmens inre fäste
    xiU: S.xi + 0.004, yUi: yW + R * 0.42, // övre länkens inre fäste
    xo: X - W * 0.32, dyLo: -R * 0.3, dyUo: R * 0.3, // yttre kulleder relativt hjulcentrum
    xs: S.xs, ys: yW + R * S.ys, ysF: yW + R * (S.ysF ?? S.ys), // stötdämparens övre fäste (bak, fram)
    xg: 0.026, // växellådans utgång
    rimR: R * (style === 'truck' ? 0.55 : style === 'buggy' ? 0.6 : 0.7),
  };
}

// ---------------------------------------------------------------------------
// Hjul
// ---------------------------------------------------------------------------

// Däck: lathe-profil (axel längs x, utsida +x). Terrängdäck får dubbar.
export function tyreGeometry(d) {
  const { style, R, W } = d;
  const knobby = style === 'buggy' || style === 'truck' || style === 'rally';
  const kh = knobby ? R * (style === 'truck' ? 0.1 : style === 'rally' ? 0.06 : 0.08) : 0;
  const Rt = R - kh, rr = d.rimR, hw = W / 2;
  const s = Math.min(W * 0.24, (Rt - rr) * 0.5);
  const P = [];
  P.push([rr - 0.0015, -hw * 0.9], [rr + (Rt - s - rr) * 0.45, -hw * 1.0]);
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * Math.PI / 2;
    P.push([Rt - s + Math.cos(a) * s, -hw + s + Math.sin(a) * s]);
  }
  const t0 = P.length - 1;
  P.push([Rt, -hw * 0.3], [Rt, 0], [Rt, hw * 0.3]);
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * Math.PI / 2;
    P.push([Rt - s + Math.cos(a) * s, hw - s + Math.sin(a) * s]);
  }
  const t1 = P.length - 5;
  P.push([rr + (Rt - s - rr) * 0.45, hw * 1.0], [rr - 0.0015, hw * 0.9]);
  const lathe = new THREE.LatheGeometry(P.map(([r, y]) => new THREE.Vector2(r, y)), 40);
  lathe.rotateZ(-Math.PI / 2);
  const parts = [prep(lathe, null, true)];
  const tread = [t0 / (P.length - 1), t1 / (P.length - 1)];

  if (knobby) {
    // Dubbar i förskjutna rader runt slitbanan
    const n = Math.round((2 * Math.PI * R) / (style === 'truck' ? 0.016 : 0.0105));
    const kw = style === 'truck' ? W * 0.3 : W * 0.17, kd = style === 'truck' ? 0.009 : 0.0058;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rows = style === 'truck'
        ? [[-W * 0.22, i % 2 ? 0.35 : -0.35], [W * 0.22, i % 2 ? -0.35 : 0.35]]
        : i % 2 ? [[-W * 0.36, 0], [0, 0], [W * 0.36, 0]] : [[-W * 0.19, 0], [W * 0.19, 0]];
      for (const [x, yaw] of rows) {
        const k = new THREE.BoxGeometry(kw, kh + 0.0015, kd);
        k.rotateY(yaw);
        k.translate(x, Rt + kh / 2 - 0.0008, 0);
        k.rotateX(a);
        // Dubbarna pekar på ren gummiyta i texturen
        const uv = k.attributes.uv;
        for (let j = 0; j < uv.count; j++) uv.setXY(j, (i / n), 0.5);
        parts.push(prep(k, null, true));
      }
    }
  }
  const g = merge(parts);
  g.userData.tread = tread;
  return g;
}

// Fälg (axel längs x, utsida +x) med ekrar, djup disk och sexkantsmutter
export function rimGeometry(d, rimColor) {
  const { style, W } = d;
  const rr = d.rimR;
  const dark = 0x161719, silver = 0xd4d7dc;
  const P = [];
  P.push(prep(cylX(rr * 0.99, W * 0.86, 28, 0, 0, 0, rr * 0.99, true), rimColor));
  const back = new THREE.CircleGeometry(rr * 0.97, 28);
  back.rotateY(Math.PI / 2);
  back.translate(style === 'touring' || style === 'sport' || style === 'formula' ? W * 0.18 : W * 0.06, 0, 0);
  P.push(prep(back, dark));
  for (const sx of [1, -1]) {
    const lip = new THREE.TorusGeometry(rr * 0.98, W * 0.045, 6, 32);
    lip.rotateY(Math.PI / 2);
    lip.translate(sx * W * 0.42, 0, 0);
    P.push(prep(lip, rimColor));
  }
  const hubR = rr * 0.3;
  const spokes = { buggy: [6, 0.34, 0], touring: [10, 0.09, 0], sport: [5, 0.12, 0.16], truck: [8, 0.2, 0], rally: [6, 0.22, 0], formula: [7, 0.1, 0.1], saucer: [3, 0.5, 0] }[style] || [6, 0.3, 0];
  const [n, sw, split] = spokes;
  const len = rr * 0.97 - hubR;
  const sx0 = W * 0.36;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const off of split ? [-split, split] : [0]) {
      const s = new THREE.BoxGeometry(W * 0.12, len, rr * sw);
      s.translate(0, hubR + len / 2, 0);
      s.rotateX(a + off);
      s.translate(sx0, 0, 0);
      P.push(prep(s, rimColor));
    }
  }
  P.push(prep(cylX(hubR, W * 0.2, 16, W * 0.34), rimColor));
  // Sexkantsmutter med bricka och axeltopp
  const nutR = d.R * 0.12;
  P.push(prep(cylX(nutR * 1.35, 0.0015, 14, W * 0.45), silver));
  P.push(prep(cylX(nutR, W * 0.15, 6, W * 0.52), silver));
  P.push(prep(cylX(nutR * 0.45, W * 0.06, 8, W * 0.62), 0x3a3c40));
  if (style === 'truck') {
    // Beadlock-ring med bultar
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      P.push(prep(cylX(0.0016, 0.003, 6, W * 0.47, Math.cos(a) * rr * 0.9, Math.sin(a) * rr * 0.9), silver));
    }
  }
  return merge(P);
}

// ---------------------------------------------------------------------------
// Rörliga upphängningsdelar (instansieras, längd 1 längs sin axel)
// ---------------------------------------------------------------------------
export function armGeometry(color) {
  const L = 0.07, a = 0.016;
  const P = [];
  for (const sz of [-1, 1]) {
    P.push(prep(rod([0, 0, sz * a], [L, 0, 0], 0.0026, 6), color));
    P.push(prep(cylZ(0.0034, 0.008, 8, 0, 0, sz * a), color));
  }
  P.push(prep(rod([L * 0.4, 0, -a * 0.6], [L * 0.4, 0, a * 0.6], 0.002, 5), color));
  P.push(prep(box(0.009, 0.006, 0.009, L - 0.003, 0, 0), color));
  const g = merge(P);
  g.scale(1 / L, 1, 1);
  return g;
}

export function shockGeometry(spring, body) {
  const L = 0.07;
  const P = [];
  P.push(prep(cylZ(0.0028, 0.006, 8, 0, 0.003, 0), 0x202124));
  P.push(prep(new THREE.CylinderGeometry(0.0014, 0.0014, 0.032, 6).translate(0, 0.02, 0), 0xe6e8ec));
  P.push(prep(new THREE.CylinderGeometry(0.0078, 0.0078, 0.0016, 14).translate(0, 0.008, 0), body));
  P.push(prep(new THREE.CylinderGeometry(0.0052, 0.0052, 0.036, 14).translate(0, 0.048, 0), body));
  P.push(prep(new THREE.CylinderGeometry(0.0078, 0.0078, 0.0022, 14).translate(0, 0.052, 0), body));
  P.push(prep(new THREE.CylinderGeometry(0.0062, 0.006, 0.005, 14).translate(0, 0.0665, 0), body));
  P.push(prep(cylZ(0.0026, 0.006, 8, 0, 0.0695, 0), 0x202124));
  // Fjäder som spiral
  const turns = 7, y0 = 0.009, y1 = 0.051, rad = 0.0067;
  const curve = new THREE.Curve();
  curve.getPoint = (t, out = new THREE.Vector3()) =>
    out.set(Math.cos(t * turns * Math.PI * 2) * rad, y0 + (y1 - y0) * t, Math.sin(t * turns * Math.PI * 2) * rad);
  P.push(prep(new THREE.TubeGeometry(curve, turns * 14, 0.0011, 5, false), spring));
  const g = merge(P);
  g.scale(1, 1 / L, 1);
  return g;
}

export function shaftGeometry() {
  const L = 0.07;
  const P = [
    prep(cylX(0.0018, L, 6, L / 2), 0x4c5057),
    prep(cylX(0.0042, 0.009, 10, 0.0045), 0xcfd3d8),
    prep(cylX(0.0036, 0.008, 10, L - 0.004), 0xcfd3d8),
  ];
  const g = merge(P);
  g.scale(1 / L, 1, 1);
  return g;
}

// Hjulhållare i hjulets koordinater (x utåt)
export function uprightGeometry(d, color) {
  const { R, W } = d;
  const x = -W * 0.18;
  return merge([
    prep(box(0.007, R * 0.75, 0.014, x, 0, 0), color),
    prep(box(0.006, 0.005, 0.02, x - 0.002, R * 0.05, -0.014), color),
    prep(new THREE.SphereGeometry(0.003, 8, 6).translate(x - 0.004, R * 0.3, 0), 0xcfd3d8),
    prep(new THREE.SphereGeometry(0.003, 8, 6).translate(x - 0.004, -R * 0.3, 0), 0xcfd3d8),
  ]);
}

// Antenn: svart spö med färgad topp (står i y från 0)
export function antennaGeometry(tip) {
  return merge([
    prep(new THREE.CylinderGeometry(0.0011, 0.0017, 0.2, 6).translate(0, 0.1, 0), 0x0c0c0d),
    prep(new THREE.CylinderGeometry(0.0034, 0.0034, 0.014, 10).translate(0, 0.2, 0), tip),
    prep(new THREE.SphereGeometry(0.0034, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.207, 0), tip),
  ]);
}

// ---------------------------------------------------------------------------
// Statiskt chassi: plast-delar och metalldelar i var sin sammanslagen geometri
// ---------------------------------------------------------------------------
export function chassisGeometry(d, def, shellInfo) {
  const { style } = d;
  const P = [], M = [];
  const p = (g, c) => P.push(prep(g, c));
  const m = (g, c) => M.push(prep(g, c));
  const glow = def.engine === 'Glow';
  const fourWD = def.drive === '4WD';
  const carbon = 0x17181b, darkPl = 0x26282c, black = 0x111214;
  const alu = 0xb9bdc3, silver = 0xd6d9de, steel = 0x6b6f76;
  const top = d.top;

  // Bottenplatta med urfräsningar
  const plateCol = style === 'buggy' ? 0x2b2d31 : style === 'truck' ? 0x8f949b : carbon;
  const pw = d.pw;
  const nose = style === 'buggy' ? pw * 0.6 : pw * 0.8;
  const plate = [
    [-nose, d.pzF], [nose, d.pzF], [pw, d.pzF - 0.05], [pw, d.pzR + 0.03], [pw * 0.8, d.pzR],
    [-pw * 0.8, d.pzR], [-pw, d.pzR + 0.03], [-pw, d.pzF - 0.05],
  ];
  const slot = (z0, z1, x) => roundRect(x - 0.006, z0, x + 0.006, z1, 0.0055);
  p(flatPlate(plate, 0.004, d.plateY, [slot(0.02, 0.07, -pw * 0.55), slot(0.02, 0.07, pw * 0.55), slot(-0.1, -0.05, -pw * 0.55), slot(-0.1, -0.05, pw * 0.55)]), plateCol);
  // Skruvar i plattan
  for (const [x, z] of [[-pw * 0.8, d.pzF - 0.03], [pw * 0.8, d.pzF - 0.03], [-pw * 0.8, d.pzR + 0.02], [pw * 0.8, d.pzR + 0.02], [-pw * 0.85, 0], [pw * 0.85, 0], [-pw * 0.85, -0.04], [pw * 0.85, -0.04]]) {
    m(new THREE.CylinderGeometry(0.0021, 0.0021, 0.0012, 10).translate(x, top + 0.0006, z), silver);
  }

  // Växellådor fram och bak (fram är styrbulkhead om bilen är bakhjulsdriven)
  for (const z of [d.zF, d.zR]) {
    p(rbox(d.xg * 2, Math.max(0.026, d.yW - top + 0.016), 0.032, 0, (top + d.yW + 0.016) / 2, z, 0.004), darkPl);
    // Fästen för länkarmarna
    for (const sx of [-1, 1]) p(box(0.012, 0.01, 0.044, sx * (d.xi - 0.002), d.yLi, z), darkPl);
  }
  // Mittaxel vid fyrhjulsdrift
  if (fourWD) m(rod([0, top + 0.009, d.zR + 0.016], [0, top + 0.009, d.zF - 0.016], 0.0022, 8), steel);

  // Stötdämpartorn med urtag
  for (const [z, sg, ys] of [[d.zF, 1, d.ysF], [d.zR, -1, d.ys]]) {
    const zt = z + sg * 0.004 + sg * 0.006;
    const x0 = d.xi + 0.006, x1 = d.xs + 0.012, y0 = top, y1 = ys + 0.007;
    const hy0 = Math.max(y0 + 0.008, d.yW + 0.004), hy1 = y1 - 0.009;
    const holes = hy1 - hy0 > 0.008 ? [-1, 1].map((sx) => roundRect(sx > 0 ? 0.006 : -x1 + 0.012, hy0, sx > 0 ? x1 - 0.012 : -0.006, hy1, 0.004)) : [];
    p(standPlate([[-x0, y0], [x0, y0], [x1, y1 - 0.006], [x1 - 0.006, y1], [-x1 + 0.006, y1], [-x1, y1 - 0.006]], 0.0035, zt, holes), carbon);
    for (const sx of [-1, 1]) m(cylZ(0.0022, 0.002, 6, sx * d.xs, ys, zt + sg * 0.003), silver);
  }

  // Stötfångare
  if (style === 'buggy') {
    p(rbox(0.13, 0.012, 0.016, 0, top + 0.012, d.pzF + 0.012, 0.004), black);
    // Snedställd skidplatta från plattan upp mot stötfångaren
    p(xf(box(nose * 2, 0.004, 0.04), [0, top + 0.006, d.pzF - 0.006], [-0.35, 0, 0]), 0x2b2d31);
    p(rbox(0.09, 0.012, 0.014, 0, top + 0.004, d.pzR - 0.006, 0.004), black);
    // Sidoskydd (nerf bars) mellan hjulen
    for (const sx of [-1, 1]) p(rbox(0.038, 0.005, 0.2, sx * (pw + 0.018), top - 0.001, -0.005, 0.002), black);
  } else if (style === 'truck') {
    for (const [z, s] of [[d.pzF + 0.012, 1], [d.pzR - 0.012, -1]]) {
      m(rod([-0.08, top + 0.03, z], [0.08, top + 0.03, z], 0.004, 8), silver);
      for (const sx of [-1, 1]) m(rod([sx * 0.04, top + 0.002, z - s * 0.02], [sx * 0.04, top + 0.03, z], 0.003, 6), silver);
    }
  } else if (style === 'formula' || style === 'saucer') {
    // inga stötfångare: formeln har framvinge, tefatet täcker allt
  } else {
    p(rbox(0.2, 0.016, 0.02, 0, top + 0.008, d.pzF + 0.006, 0.005), black);
    p(rbox(0.16, 0.012, 0.012, 0, top + 0.006, d.pzR - 0.004, 0.004), black);
    if (style === 'sport') p(box(0.22, 0.003, 0.03, 0, d.plateY + 0.004, d.pzF + 0.01), carbon); // splitter
  }

  // Servo med styrservoarm och länkstag
  p(rbox(0.02, 0.018, 0.038, -0.03, top + 0.009, d.zF - 0.045, 0.003), black);
  p(box(0.016, 0.0025, 0.005, -0.03, top + 0.0195, d.zF - 0.03), 0xf2f2f2);
  m(rod([-0.04, top + 0.02, d.zF - 0.028], [d.X - 0.04, top + 0.022, d.zF - 0.016], 0.0013, 5), silver);
  m(rod([-0.02, top + 0.02, d.zF - 0.028], [-d.X + 0.04, top + 0.022, d.zF - 0.016], 0.0013, 5), silver);
  // Mottagare
  p(rbox(0.022, 0.013, 0.028, 0.032, top + 0.0065, d.zF - 0.05, 0.003), 0x2f3136);
  p(box(0.016, 0.0006, 0.012, 0.032, top + 0.0133, d.zF - 0.05), 0xe8e8e8);

  if (glow) {
    // Glödstiftsmotor: vevhus, cylinder, kylhuvud med flänsar, förgasare,
    // svänghjul, bränsletank och resonansrör ut bak.
    const ex = 0.01, ez = -0.005, eb = top;
    m(rbox(0.03, 0.024, 0.034, ex, eb + 0.014, ez, 0.005), alu);
    m(new THREE.CylinderGeometry(0.0105, 0.012, 0.012, 16).translate(ex, eb + 0.032, ez), alu);
    const head = style === 'sport' ? 0xd2262c : 0x2f6be0;
    for (let i = 0; i < 7; i++) m(new THREE.CylinderGeometry(0.0165 - i * 0.0006, 0.0165 - i * 0.0006, 0.0013, 18).translate(ex, eb + 0.039 + i * 0.0027, ez), head);
    m(new THREE.CylinderGeometry(0.0075, 0.0075, 0.02, 12).translate(ex, eb + 0.047, ez), head);
    m(new THREE.CylinderGeometry(0.0024, 0.0024, 0.006, 6).translate(ex, eb + 0.06, ez), 0xd8b25a);
    m(cylZ(0.005, 0.014, 12, ex, eb + 0.026, ez + 0.022), silver);
    m(cylZ(0.017, 0.004, 22, ex, eb + 0.017, ez + 0.022 + 0.006), steel);
    m(cylZ(0.012, 0.01, 18, ex, eb + 0.017, ez - 0.024), 0xc9a24a);
    p(rbox(0.032, 0.026, 0.05, -0.045, top + 0.013, 0.03, 0.006), 0xd8d2c0);
    p(new THREE.CylinderGeometry(0.0055, 0.0055, 0.005, 12).translate(-0.045, top + 0.028, 0.045), 0xd8262a);
    // Resonansrör (kopplat med silikonslang) som mynnar ut bakom karossen
    const tail = shellInfo.tailZ - 0.012;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ex + 0.016, eb + 0.03, ez - 0.002),
      new THREE.Vector3(ex + 0.034, eb + 0.022, ez - 0.012),
      new THREE.Vector3(0.052, eb + 0.012, ez - 0.05),
      new THREE.Vector3(0.056, eb + 0.009, -0.15),
      new THREE.Vector3(0.05, eb + 0.008, tail),
    ]);
    m(new THREE.TubeGeometry(curve, 40, 0.0068, 10, false), 0xc6cad0);
    m(cylZ(0.0035, 0.012, 10, 0.05, eb + 0.008, tail - 0.004), 0x55585e);
    p(rod([ex + 0.03, eb + 0.024, ez - 0.01], [0.047, eb + 0.016, ez - 0.03], 0.0078, 12), 0xd8262a);
    // Mottagarbatteri
    p(rbox(0.024, 0.016, 0.045, 0.05, top + 0.008, 0.055, 0.004), 0x23314f);
  } else {
    // Elmotor med kylflänsar, drev och kugghjul; ackpaket och fartreglage
    const mz = d.zR + 0.045, my = Math.max(d.yW + 0.004, top + 0.019), mx = 0.016;
    m(cylX(0.0175, 0.038, 20, mx, my, mz), 0x2e63d6);
    m(cylX(0.0178, 0.008, 20, mx + 0.022, my, mz), silver);
    for (let i = 0; i < 6; i++) m(cylX(0.021, 0.0016, 20, mx - 0.012 + i * 0.0048, my, mz), 0xc4c8ce);
    m(cylX(0.004, 0.006, 10, mx - 0.022, my, mz), 0xd2a849);
    for (const sx of [-1, 1]) m(cylX(0.0018, 0.004, 6, mx + 0.024, my + sx * 0.009, mz), 0xd2a849);
    // Kugghjul (vitt) på växellådans sida
    const teeth = [];
    const nT = 44, gr = 0.026;
    for (let i = 0; i < nT * 2; i++) {
      const a = (i / (nT * 2)) * Math.PI * 2;
      const r = i % 2 ? gr : gr - 0.0018;
      teeth.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const gear = new THREE.ExtrudeGeometry(new THREE.Shape(teeth.map(([a, b]) => new THREE.Vector2(a, b))), { depth: 0.004, bevelEnabled: false });
    gear.rotateY(Math.PI / 2);
    gear.translate(mx - 0.03, my + 0.004, mz - 0.024);
    p(gear, 0xeeeeee);
    p(cylX(0.006, 0.006, 12, mx - 0.026, my + 0.004, mz - 0.024), black);
    // Batteripaket (krympplast) med etikett
    const bw = style === 'touring' || style === 'sport' ? 0.048 : 0.046;
    p(rbox(bw, 0.024, 0.13, 0, top + 0.012, 0.005, 0.006), 0x1d5fd6);
    p(box(bw * 0.7, 0.0008, 0.05, 0, top + 0.0244, 0.005), 0xf1f1f1);
    p(box(0.006, 0.002, 0.06, 0, top + 0.0002 + 0.024, 0.005), 0x111111);
    // Fartreglage med kylfläns och sladdar
    p(rbox(0.026, 0.012, 0.03, -0.034, top + 0.006, d.zR + 0.075, 0.003), 0x1a1a1c);
    for (let i = 0; i < 5; i++) m(box(0.024, 0.005, 0.0016, -0.034, top + 0.0145, d.zR + 0.064 + i * 0.0055), 0xaeb3ba);
    for (const [c, dx] of [[0xd8262a, -0.004], [0x111111, 0.004]]) {
      const cv = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.034 + dx, top + 0.01, d.zR + 0.06),
        new THREE.Vector3(-0.02 + dx, top + 0.03, d.zR + 0.055),
        new THREE.Vector3(mx + 0.02, my + 0.016, mz + dx),
        new THREE.Vector3(mx + 0.026, my + 0.008, mz + dx),
      ]);
      p(new THREE.TubeGeometry(cv, 16, 0.0013, 5, false), c);
    }
  }

  // Karossfästen med clips
  for (const [x, z] of shellInfo.posts) {
    const yt = shellInfo.topAt(z, x) + 0.009;
    p(new THREE.CylinderGeometry(0.003, 0.003, yt - top, 8).translate(x, (yt + top) / 2, z), 0xf0f0f0);
    const clip = new THREE.TorusGeometry(0.0045, 0.0009, 5, 12, Math.PI * 1.5);
    clip.rotateY(Math.PI / 2);
    clip.translate(x, yt - 0.003, z);
    m(clip, silver);
  }

  // Vingfästen
  if (shellInfo.wing) {
    const W = shellInfo.wing;
    for (const sx of [-1, 1]) {
      const x = sx * W.strutX;
      const g = standPlate([[x - 0.0018, W.strutY0], [x + 0.0018, W.strutY0], [x + 0.0018, W.y], [x - 0.0018, W.y]], W.strutD, 0);
      g.translate(0, -W.y, 0);
      g.rotateX(W.lean || 0);
      g.translate(0, W.y, W.z + 0.004);
      p(g, black);
      m(cylX(0.0022, 0.002, 8, x + sx * 0.0025, W.y - 0.006, W.z + 0.004), silver);
    }
  }

  styleExtras(d, shellInfo, p, m);

  // Antennrör och fäste
  const A = shellInfo.antenna;
  p(rbox(0.012, 0.008, 0.012, A[0], top + 0.004, A[2], 0.002), black);
  p(new THREE.CylinderGeometry(0.0022, 0.0026, A[1] - top, 8).translate(A[0], (A[1] + top) / 2, A[2]), 0x15161a);

  return { plastic: merge(P), metal: merge(M) };
}

// ---------------------------------------------------------------------------
// Stilunika detaljer som inte är lexan: ralleyns lampramp, takskopa och
// stänkskydd, formelns förarhjälm och tefatets glaskupol och ljusring.
// ---------------------------------------------------------------------------
function styleExtras(d, info, p, m) {
  const { style } = d;
  if (style === 'rally') {
    // Lampramp på huven med fyra extraljus
    const zl = d.zF + 0.012, yl = info.topAt(zl) + 0.012;
    p(rbox(0.15, 0.022, 0.012, 0, yl, zl, 0.004), 0x121214);
    for (const x of [-0.054, -0.018, 0.018, 0.054]) {
      p(cylZ(0.0085, 0.006, 16, x, yl, zl + 0.008), 0x1c1c1e);
      p(cylZ(0.0068, 0.0015, 16, x, yl, zl + 0.0115), 0xfff6c8);
    }
    for (const x of [-0.06, 0.06]) p(box(0.004, 0.012, 0.004, x, yl - 0.012, zl - 0.002), 0x121214);
    // Takskopa
    const zs = -0.02, ys = info.topAt(zs) + 0.006;
    p(rbox(0.05, 0.014, 0.05, 0, ys, zs, 0.005), 0x18191c);
    p(box(0.04, 0.008, 0.002, 0, ys + 0.001, zs + 0.025), 0x050506);
    // Stänkskydd bakom hjulen
    for (const z of [d.zF, d.zR]) {
      for (const sx of [-1, 1]) p(box(0.034, 0.03, 0.002, sx * d.X, d.yW - d.R * 0.15, z - d.R - 0.008), 0xd8262a);
    }
  } else if (style === 'formula') {
    // Förare: hjälm med visir i cockpit
    const zc = 0.01, yc = info.topAt(zc) + 0.006;
    p(new THREE.SphereGeometry(0.019, 16, 12).translate(0, yc, zc), 0xf4f4f4);
    p(new THREE.SphereGeometry(0.0195, 16, 8, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.32, Math.PI * 0.2).translate(0, yc, zc), 0x111418);
    p(box(0.004, 0.006, 0.03, 0, yc + 0.018, zc - 0.004), 0xd8262a);
    // Störtbåge bakom föraren
    m(rod([-0.016, yc - 0.012, zc - 0.03], [0, yc + 0.026, zc - 0.03], 0.0025, 6), 0xd6d9de);
    m(rod([0.016, yc - 0.012, zc - 0.03], [0, yc + 0.026, zc - 0.03], 0.0025, 6), 0xd6d9de);
  } else if (style === 'saucer') {
    // Glaskupol och en ring av blinkande lampor runt kanten
    const yt = info.topAt(0);
    m(new THREE.SphereGeometry(0.062, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, yt - 0.006, -0.01), 0x2a6c8a);
    p(new THREE.TorusGeometry(0.062, 0.004, 6, 32).rotateX(Math.PI / 2).translate(0, yt - 0.005, -0.01), 0xd6d9de);
    // Liten utomjording i kupolen
    p(new THREE.SphereGeometry(0.016, 12, 10).scale(1, 1.2, 1).translate(0, yt + 0.016, -0.01), 0x66ff7a);
    for (const sx of [-1, 1]) p(new THREE.SphereGeometry(0.005, 8, 6).translate(sx * 0.007, yt + 0.022, 0.003), 0x111111);
    const n = 14, rr = info.saucerR ?? 0.2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.sin(a) * rr * 0.97, z = Math.cos(a) * rr * 0.97;
      p(new THREE.SphereGeometry(0.0075, 10, 6).translate(x, info.rimY ?? yt - 0.03, z), i % 2 ? 0xfff27a : 0x66ff7a);
    }
  }
}
