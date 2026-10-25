import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { G, groups } from '../core/physics.js';
import { rng } from './warehouseArt.js';

// ---------------------------------------------------------------------------
// Byggsats för Stuntarenan. Varje hinder byggs av konvexa skal (punktmoln):
// samma punkter blir både kolliderare i Rapier och grafik (ConvexGeometry),
// så det man ser är exakt det bilen kör på. Böjda ytor (quarter pipe, loop,
// spiralramp, skål) delas i smala skivor.
//
// Ram: { x, z, rot } där lokal +z är färdriktningen (heading = rot) och
// lokal +x bilens vänster, som i resten av spelet.
//
// Utan scene byggs bara fysiken (testskriptet), utan world bara grafiken.
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

// Lokal punkt → världen
export function toWorld(f, lx, y, lz) {
  const c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0);
  return [f.x + lx * c + lz * s, y, f.z - lx * s + lz * c];
}

export class StuntKit {
  constructor(scene, world, RAPIER) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.body = world ? world.createRigidBody(RAPIER.RigidBodyDesc.fixed()) : null;
    this.lists = new Map();
    this.failed = 0;
    this.count = 0;
  }

  // Konvext skal ur punkter [[x, y, z], ...] i världen
  hull(pts, { mat = 'paint', color = 0xffffff, friction = 0.9, visual = true, physics = true } = {}) {
    pts = dedupe(pts);
    if (pts.length < 4) return;
    if (this.world && physics) {
      const desc = this.RAPIER.ColliderDesc.convexHull(new Float32Array(pts.flat()));
      if (!desc) this.failed++;
      else {
        this.world.createCollider(desc.setFriction(friction).setRestitution(0.05).setCollisionGroups(groups(G.WORLD)), this.body);
        this.count++;
      }
    }
    if (this.scene && visual) this.add(mat, new ConvexGeometry(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))), color);
  }

  // Ren grafik (lägger till i batchen för materialet)
  add(mat, geo, color = 0xffffff) {
    if (!this.scene) return;
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv || mat !== 'decal') boxUV(g, mat === 'wood' ? 1.2 : 2);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.clearGroups();
    if (!this.lists.has(mat)) this.lists.set(mat, []);
    this.lists.get(mat).push(g);
  }

  flush() {
    if (!this.scene) return;
    for (const [key, list] of this.lists) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list), MATERIALS[key]());
      mesh.castShadow = key !== 'glow';
      mesh.receiveShadow = key !== 'glow';
      this.scene.add(mesh);
    }
    this.lists.clear();
  }

  // Yta som triangelnät ur ett rutnät grid[i][k] (i längs, k tvärs). Normalen
  // (b−a)×(c−a) pekar mot körsidan när i går framåt och k åt vänster. Ett nät
  // med FIX_INTERNAL_EDGES ger släta skarvar (bilens kaross hakar inte i).
  // Med `up` vänds kolumnordningen om första rutans normal pekar fel.
  surface(grid, { mat = 'paint', color = 0xffffff, colors = null, friction = 0.9, up = null } = {}) {
    if (up) {
      const [a, b, c] = [grid[0][0], grid[1][0], grid[0][1]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (n[0] * up[0] + n[1] * up[1] + n[2] * up[2] < 0) {
        grid = grid.map((row) => [...row].reverse());
        if (colors) colors = [...colors].reverse();
      }
    }
    const K = grid[0].length, pos = [], idx = [];
    for (const row of grid) for (const p of row) pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < grid.length - 1; i++) for (let k = 0; k < K - 1; k++) {
      const a = i * K + k, b = (i + 1) * K + k, c = i * K + k + 1, d = (i + 1) * K + k + 1;
      idx.push(a, b, c, b, d, c);
    }
    if (this.world) {
      const desc = this.RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx), this.RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
      this.world.createCollider(desc.setFriction(friction).setRestitution(0.05).setCollisionGroups(groups(G.WORLD)), this.body);
      this.count++;
    }
    if (this.scene) {
      // Grafik per kolumnremsa så att remsorna kan få egna färger
      for (let k = 0; k < K - 1; k++) {
        const g = new THREE.BufferGeometry();
        const P = [], I = [];
        for (let i = 0; i < grid.length; i++) P.push(...grid[i][k], ...grid[i][k + 1]);
        for (let i = 0; i < grid.length - 1; i++) I.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 2, i * 2 + 3, i * 2 + 1);
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setIndex(I);
        g.computeVertexNormals();
        this.add(mat, g, colors ? colors[k] : color);
      }
    }
  }

  // --- Former --------------------------------------------------------------

  // Profil [[lz, y], ...] extruderad i bredd. Ytan blir ett slätt nät; under
  // den fylls volymen ner till golvet (eller `thick` under ytan) med konvexa
  // block vars topp ligger en aning under ytan.
  profile(f, pts, width, opts = {}) {
    const hw = width / 2, base = opts.base ?? 0, inset = 0.02;
    const grid = pts.map(([z, y]) => [toWorld(f, -hw, y, z), toWorld(f, hw, y, z)]);
    this.surface(grid, { ...opts, up: [0, 1, 0] });
    for (let i = 0; i < pts.length - 1; i++) {
      const [z0, y0] = pts[i], [z1, y1] = pts[i + 1];
      const b0 = opts.thick ? y0 - opts.thick : base, b1 = opts.thick ? y1 - opts.thick : base;
      if (y0 - b0 < 0.04 && y1 - b1 < 0.04) continue;
      const t0 = Math.max(b0, y0 - inset), t1 = Math.max(b1, y1 - inset);
      const P = [];
      for (const lx of [-hw, hw]) {
        P.push(toWorld(f, lx, t0, z0), toWorld(f, lx, t1, z1), toWorld(f, lx, b0, z0), toWorld(f, lx, b1, z1));
      }
      this.hull(P, { ...opts, color: opts.sideColor ?? opts.color });
    }
  }

  // Låda (lokal mitt lx, lz; underkant y0, överkant y1)
  box(f, lx, lz, w, d, y0, y1, opts) {
    const P = [];
    for (const a of [-w / 2, w / 2]) for (const b of [-d / 2, d / 2]) for (const y of [y0, y1]) P.push(toWorld(f, lx + a, y, lz + b));
    this.hull(P, opts);
  }

  // Kicker: cirkelbåge från golvet upp till vinkeln ang (rad) och höjden h
  kicker(f, { h, ang, width, segs = 8, deck = 0, ...opts }) {
    const R = h / (1 - Math.cos(ang));
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const a = (ang * i) / segs;
      pts.push([R * Math.sin(a), R * (1 - Math.cos(a))]);
    }
    if (deck) pts.push([pts[pts.length - 1][0] + deck, h]);
    this.profile(f, pts, width, opts);
    return { length: pts[pts.length - 1][0], R };
  }

  // Quarter pipe: båge med radie R upp till vinkeln maxAng, sedan ett däck
  quarterPipe(f, { R, maxAng, width, deck = 1, segs = 14, start = 0, ...opts }) {
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const a = (maxAng * i) / segs;
      pts.push([start + R * Math.sin(a), R * (1 - Math.cos(a))]);
    }
    const top = pts[pts.length - 1];
    if (deck) pts.push([top[0] + deck, top[1]]);
    this.profile(f, pts, width, opts);
    return { lip: top[0], height: top[1], back: top[0] + deck };
  }

  // Stympad pyramid: bas b, topp t (kvadrater), höjd h
  pyramid(f, { base, top, h, ...opts }) {
    const P = [];
    for (const [s, y] of [[base / 2, 0], [top / 2, h]]) for (const a of [-s, s]) for (const b of [-s, s]) P.push(toWorld(f, a, y, b));
    this.hull(P, opts);
  }

  // Loop: inneryta på en klotoidloop (krökningen växer jämnt från 0 till 1/R
  // under `ease`·90° vid in- och utfarten, så fjädringen inte slår i botten).
  // Banan förskjuts mjukt `shift` i sidled över varvet så att utfarten hamnar
  // bredvid infarten. Uppvikta kanter (ett grunt tråg) och loopGuide() nedan
  // håller bilen kvar i spåret. Bilen kör in längs lokal +z.
  loop(f, { R, width, shift, thick = 0.25, segs = 72, ease = 0.6, bank = 0.3, bankAng = 0.45, ...opts }) {
    const hw = width / 2;
    const curve = loopCurve(R, ease, segs);
    const L = curve[curve.length - 1].s;
    const lxAt = loopShift(shift, L);
    const cs = [[-hw - bank * Math.cos(bankAng), bank * Math.sin(bankAng)], [-hw, 0], [hw, 0], [hw + bank * Math.cos(bankAng), bank * Math.sin(bankAng)]];
    const at = (i, lat, up, off) => {
      const c = curve[i];
      // Inåtnormalen för riktningen (cos θ, sin θ) i (z, y) är (−sin θ, cos θ).
      const n = up - off;
      return toWorld(f, lxAt(c.s) + lat, c.y + Math.cos(c.th) * n, c.z - Math.sin(c.th) * n);
    };
    // Körytan som ett slätt nät (fysik + grafik), skivor bakom bara som grafik
    const grid = [];
    for (let i = 0; i <= segs; i++) grid.push(cs.map(([lat, up]) => at(i, lat, up, 0)));
    this.surface(grid, { ...opts, colors: [opts.edgeColor ?? opts.color, opts.color, opts.edgeColor ?? opts.color] });
    if (this.scene) {
      for (let i = 0; i < segs; i++) {
        const P = [];
        for (const j of [i, i + 1]) for (const [lat, up] of [cs[0], cs[3]]) P.push(at(j, lat, up, 0.01), at(j, lat, up, thick));
        this.hull(P, { mat: 'metal', color: 0x8a9099, physics: false });
        for (const side of [-1, 1]) {
          const S = [];
          for (const j of [i, i + 1]) for (const lat of [side * (hw - 0.08), side * hw]) S.push(at(j, lat, -0.004, 0), at(j, lat, -0.004, 0.01));
          this.hull(S, { mat: 'paint', color: i % 2 ? 0xf2f2f2 : 0xd8352a, physics: false });
        }
      }
    }
    return { curve, lxAt, length: L };
  }

  // Spiralramp runt (cx, cz): radier r0..r1, vinkel a0 → a1 (rad, i x/z-planet),
  // höjd y0 → y1. Slät körbana, block under och räcke på ytterkanten.
  spiral({ cx, cz, r0, r1, a0, a1, y0, y1, thick = 0.3, segs, rail = 0.25, ...opts }) {
    const n = segs ?? Math.ceil(Math.abs(a1 - a0) / 0.12);
    const P = (r, a, y) => [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
    const A = (i) => a0 + ((a1 - a0) * i) / n, Y = (i) => y0 + ((y1 - y0) * i) / n;
    const grid = [];
    for (let i = 0; i <= n; i++) grid.push([P(r0, A(i), Y(i)), P(r1, A(i), Y(i))]);
    this.surface(grid, { ...opts, up: [0, 1, 0] });
    for (let i = 0; i < n; i++) {
      const pts = [];
      for (const j of [i, i + 1]) for (const r of [r0, r1]) pts.push(P(r, A(j), Y(j) - 0.02), P(r, A(j), Y(j) - thick));
      this.hull(pts, { ...opts, color: opts.sideColor ?? opts.color });
      if (rail) {
        const rp = [];
        for (const j of [i, i + 1]) for (const r of [r1 - 0.08, r1]) rp.push(P(r, A(j), Y(j) - 0.05), P(r, A(j), Y(j) + rail));
        this.hull(rp, { ...opts, mat: 'metal', color: 0xe8b324 });
      }
    }
  }

  // Skål med brant vägg ("dödsväggen"): golvet inuti är hallens golv.
  // Väggprofilen är en båge med radie Rw från r0 upp till vinkeln maxAng,
  // sedan en kant `lip`. Infarten är en lucka kring vinkeln gapAt.
  bowl({ cx, cz, r0, Rw, maxAng, lip = 0.8, gapAt = 0, gapWidth = 0.6, aSegs = 40, pSegs = 10, ...opts }) {
    const prof = [];
    for (let i = 0; i <= pSegs; i++) {
      const a = (maxAng * i) / pSegs;
      prof.push([r0 + Rw * Math.sin(a), Rw * (1 - Math.cos(a))]);
    }
    const top = prof[prof.length - 1];
    prof.push([top[0] + lip, top[1]]);
    const P = (r, a, y) => [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
    // Vinklar runt skålen, från luckans ena kant runt till den andra
    const start = gapAt + gapWidth / 2, span = Math.PI * 2 - gapWidth;
    const angs = [];
    for (let j = 0; j <= aSegs; j++) angs.push(start + (span * j) / aSegs);
    const grid = angs.map((a) => prof.map(([r, y]) => P(r, a, y)));
    this.surface(grid, { ...opts, up: [0, 1, 0] });
    for (let j = 0; j < aSegs; j++) {
      for (let i = 0; i < prof.length - 1; i++) {
        const [ra, ya] = prof[i], [rb, yb] = prof[i + 1];
        if (ya < 0.05 && yb < 0.05) continue;
        const pts = [];
        for (const a of [angs[j], angs[j + 1]]) pts.push(P(ra, a, Math.max(0, ya - 0.03)), P(rb, a, Math.max(0, yb - 0.03)), P(ra, a, 0), P(rb, a, 0));
        this.hull(pts, { ...opts, color: opts.sideColor ?? opts.color });
      }
    }
    return { top: top[1], rTop: top[0], prof };
  }

  // Lodrät cylinder (prisma med n sidor)
  cylinder(cx, cz, r, y0, y1, opts = {}) {
    const n = opts.sides ?? 16, pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([cx + r * Math.cos(a), y0, cz + r * Math.sin(a)], [cx + r * Math.cos(a), y1, cz + r * Math.sin(a)]);
    }
    this.hull(pts, opts);
  }

  // Ring-sektor (platt däck) mellan radierna r0..r1 och vinklarna a0..a1
  ringDeck({ cx, cz, r0, r1, a0, a1, y, thick = 0.3, rail = 0.25, railSkip = null, ...opts }) {
    const n = Math.ceil(Math.abs(a1 - a0) / 0.2);
    const P = (r, a, yy) => [cx + r * Math.cos(a), yy, cz + r * Math.sin(a)];
    for (let i = 0; i < n; i++) {
      const aa = a0 + ((a1 - a0) * i) / n, ab = a0 + ((a1 - a0) * (i + 1)) / n;
      const pts = [];
      for (const a of [aa, ab]) for (const r of [r0, r1]) pts.push(P(r, a, y), P(r, a, y - thick));
      this.hull(pts, opts);
      if (rail && !(railSkip && railSkip((aa + ab) / 2))) {
        const rp = [];
        for (const a of [aa, ab]) for (const r of [r1 - 0.08, r1]) rp.push(P(r, a, y - 0.05), P(r, a, y + rail));
        this.hull(rp, { ...opts, mat: 'metal', color: 0xe8b324 });
      }
    }
  }
}

// Klotoidloopens mittlinje i (z, y) med vinkeln th, jämnt samplad längs
// sträckan. Övergångarna vrider ease·90° vardera.
export function loopCurve(R, ease, segs) {
  const thT = ease * Math.PI / 2;
  const sT = 2 * R * thT; // klotoid: θ = s²/(2·sT·R)
  const sArc = R * (Math.PI * 2 - 2 * thT);
  const L = 2 * sT + sArc;
  const kappa = (s) => (s < sT ? s / (sT * R) : s > sT + sArc ? (L - s) / (sT * R) : 1 / R);
  const fine = 4000, ds = L / fine;
  const pts = [{ s: 0, th: 0, z: 0, y: 0 }];
  let th = 0, z = 0, y = 0;
  for (let i = 1; i <= fine; i++) {
    const sm = (i - 0.5) * ds;
    const thm = th + kappa(sm) * ds / 2;
    z += Math.cos(thm) * ds; y += Math.sin(thm) * ds;
    th += kappa(sm) * ds;
    pts.push({ s: i * ds, th, z, y });
  }
  const out = [];
  for (let k = 0; k <= segs; k++) out.push(pts[Math.round((k / segs) * fine)]);
  return out;
}

const _q = new THREE.Quaternion(), _f = new THREE.Vector3(), _u = new THREE.Vector3();

// Sidoförskjutning längs loopens sträcka: rakt in, mjukt över, rakt ut
function loopShift(shift, L, from = 0.12, to = 0.88) {
  return (s) => {
    const u = Math.min(1, Math.max(0, (s / L - from) / (to - from)));
    return shift * u * u * (3 - 2 * u);
  };
}

// Styrning i loopen: bilens strålhjul och däckmodell tappar sidfarten på den
// krökta ytan, så vi för bilen i sidled mot spårets mitt (som en leksaksbana
// med styrspår). Påverkar bara sidfarten i loopens ram, aldrig farten framåt.
export function loopGuide(f, { R, ease = 0.6, shift, width }) {
  const curve = loopCurve(R, ease, 360);
  const L = curve[curve.length - 1].s;
  const lxAt = loopShift(shift, L);
  const c = Math.cos(f.rot || 0), sn = Math.sin(f.rot || 0);
  const zMin = Math.min(...curve.map((p) => p.z)) - 1, zMax = Math.max(...curve.map((p) => p.z)) + 1;
  const yMax = Math.max(...curve.map((p) => p.y)) + 1;
  return {
    frame: f, curve, length: L, lxAt,
    // Var i loopen bilen är (null utanför): sträcka s och avstånd från spåret
    locate(p) {
      const dx = p.x - f.x, dz = p.z - f.z;
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      if (lz < zMin || lz > zMax || p.y > yMax || lx < -width - 1 || lx > shift + width + 1) return null;
      let best = -1, bd = Infinity;
      for (let i = 0; i < curve.length; i++) {
        const q = curve[i];
        const d = (lz - q.z) ** 2 + (p.y - q.y) ** 2 + (lx - lxAt(q.s)) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return { s: curve[best].s, i: best, d: Math.sqrt(bd), lx, lz };
    },
    apply(vehicle) {
      const p = vehicle.body.translation();
      const at = this.locate(p);
      if (!at || at.d > 0.6 || at.s < L * 0.04 || at.s > L * 0.96 || !vehicle.grounded) return false;
      const v = vehicle.body.linvel();
      const vlx = v.x * c - v.z * sn; // sidfart i loopens ram
      const q = curve[at.i];
      const along = Math.abs(v.x * sn * Math.cos(q.th) + v.z * c * Math.cos(q.th) + v.y * Math.sin(q.th)); // fart längs profilen
      const ds = 0.05;
      const slope = (lxAt(at.s + ds) - lxAt(at.s - ds)) / (2 * ds);
      const want = slope * along + Math.max(-2, Math.min(2, (lxAt(at.s) - at.lx) * 6));
      const dv = (want - vlx) * 0.35;
      vehicle.body.setLinvel({ x: v.x + dv * c, y: v.y, z: v.z - dv * sn }, true);
      // Nosen följer spåret: girhastighet runt bilens uppåtaxel mot spårets riktning
      const r = vehicle.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _f.set(0, 0, 1).applyQuaternion(_q);
      _u.set(0, 1, 0).applyQuaternion(_q);
      const fxl = _f.x * c - _f.z * sn;
      const wantF = Math.sin(Math.atan(slope)) * Math.sign(_f.x * sn * Math.cos(q.th) + _f.z * c * Math.cos(q.th) + _f.y * Math.sin(q.th) || 1);
      const w = vehicle.body.angvel();
      const yaw = w.x * _u.x + w.y * _u.y + w.z * _u.z;
      const dy = (Math.max(-4, Math.min(4, (wantF - fxl) * 12)) - yaw) * 0.5;
      vehicle.body.setAngvel({ x: w.x + _u.x * dy, y: w.y + _u.y * dy, z: w.z + _u.z * dy }, true);
      return true;
    },
  };
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.some((q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-4)) out.push(p);
  return out;
}

// Lådprojektion: varje triangel får UV ur de två axlar dess normal inte pekar längs
function boxUV(g, tile) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let t = 0; t < p.count; t += 3) {
    const nx = Math.abs(n.getX(t)), ny = Math.abs(n.getY(t)), nz = Math.abs(n.getZ(t));
    for (let k = t; k < t + 3; k++) {
      let u, v;
      if (ny >= nx && ny >= nz) { u = p.getX(k); v = p.getZ(k); }
      else if (nx >= nz) { u = p.getZ(k); v = p.getY(k); }
      else { u = p.getX(k); v = p.getY(k); }
      uv[k * 2] = u / tile; uv[k * 2 + 1] = v / tile;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ===========================================================================
// Texturer och material
// ===========================================================================

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function toTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Målad skatepark-yta: ljus grund med fläckar, repor och däckspår
function paintTexture() {
  return cached('paintTex', () => {
    const S = 256, r = rng(91);
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const k = 200 + Math.floor(r() * 55);
      ctx.fillStyle = `rgba(${k},${k},${k},${0.15 + r() * 0.25})`;
      ctx.fillRect(r() * S, r() * S, 1 + r() * 6, 1 + r() * 6);
    }
    ctx.strokeStyle = 'rgba(60,60,60,0.12)';
    for (let i = 0; i < 40; i++) {
      ctx.lineWidth = 0.5 + r();
      ctx.beginPath();
      const x = r() * S, y = r() * S;
      ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 20); ctx.stroke();
    }
    // Skarvar mellan skivorna
    ctx.fillStyle = 'rgba(40,40,40,0.25)';
    ctx.fillRect(0, 0, S, 2); ctx.fillRect(0, 0, 2, S);
    return toTex(c);
  });
}

// Plywood för ramperna
function woodTexture() {
  return cached('woodTex', () => {
    const S = 256, r = rng(17);
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#d7b37c'; ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 2) {
      const k = Math.sin(y * 0.11 + Math.sin(y * 0.031) * 3) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(150,100,50,${0.05 + k * 0.12})`;
      ctx.fillRect(0, y, S, 2);
    }
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = 'rgba(120,80,40,0.25)';
      ctx.beginPath(); ctx.ellipse(r() * S, r() * S, 3 + r() * 5, 1.5 + r() * 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(80,55,30,0.5)';
    ctx.fillRect(0, 0, S, 2); ctx.fillRect(0, 0, 2, S);
    // Skruvar
    ctx.fillStyle = 'rgba(70,70,70,0.7)';
    for (const x of [10, S / 2, S - 10]) for (const y of [10, S - 10]) ctx.fillRect(x - 1, y - 1, 3, 3);
    return toTex(c);
  });
}

function concreteTexture() {
  return cached('concTex', () => {
    const S = 256, r = rng(23);
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#b9b7b1'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2500; i++) {
      const k = 140 + Math.floor(r() * 90);
      ctx.fillStyle = `rgba(${k},${k},${k - 4},${0.2 + r() * 0.3})`;
      ctx.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 3);
    }
    ctx.fillStyle = 'rgba(90,90,85,0.35)';
    ctx.fillRect(0, 0, S, 2);
    return toTex(c);
  });
}

const MATERIALS = {
  paint: () => cached('m.paint', () => new THREE.MeshStandardMaterial({ map: paintTexture(), vertexColors: true, roughness: 0.55 })),
  wood: () => cached('m.wood', () => new THREE.MeshStandardMaterial({ map: woodTexture(), vertexColors: true, roughness: 0.7 })),
  concrete: () => cached('m.concrete', () => new THREE.MeshStandardMaterial({ map: concreteTexture(), vertexColors: true, roughness: 0.85 })),
  metal: () => cached('m.metal', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6 })),
  seats: () => cached('m.seats', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 })),
  glow: () => cached('m.glow', () => new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })),
};

// ===========================================================================
// Dekor (bara grafik): läktare, banderoller, lampor och resultattavla
// ===========================================================================

export function addBleachers(kit, { x, z, rot, length, rows = 7, seed = 1 }) {
  if (!kit.scene) return;
  const r = rng(seed);
  const f = { x, z, rot };
  const cols = [0xd23b3b, 0x2d6cdf, 0xf2c230, 0x2fa84f, 0xe8e8e8];
  for (let i = 0; i < rows; i++) {
    const y = 0.45 * (i + 1), d = 0.8;
    // Steg i betong
    const g = new THREE.BoxGeometry(length, y, d);
    g.translate(0, y / 2, -i * d);
    kit.add('concrete', place(g, f), 0xa9a69f);
    // Sittplatser i block av samma färg
    const n = Math.floor(length / 0.55);
    const seat = [];
    for (let k = 0; k < n; k++) {
      const s = new THREE.BoxGeometry(0.45, 0.12, 0.4);
      s.translate(-length / 2 + 0.3 + k * 0.55, y + 0.06, -i * d - 0.1);
      const b = new THREE.BoxGeometry(0.45, 0.35, 0.06);
      b.translate(-length / 2 + 0.3 + k * 0.55, y + 0.25, -i * d - 0.33);
      seat.push(s, b);
    }
    const blockCol = cols[Math.floor(r() * cols.length)];
    kit.add('seats', place(mergeGeometries(seat.map((s) => s.toNonIndexed())), f), blockCol);
  }
}

function place(g, f) {
  g.rotateY(f.rot);
  g.translate(f.x, 0, f.z);
  return g;
}

// Taklampor: lysande paneler som syns (ljuset kommer från nivåns belysning)
export function addCeilingLights(kit, { size, height }) {
  if (!kit.scene) return;
  const geos = [];
  for (let x = -size / 2 + 8; x <= size / 2 - 8; x += 12) for (let z = -size / 2 + 8; z <= size / 2 - 8; z += 12) {
    const g = new THREE.BoxGeometry(2.4, 0.08, 0.6);
    g.translate(x, height - 0.7, z);
    geos.push(g.toNonIndexed());
  }
  kit.add('glow', mergeGeometries(geos), 0xfff6dc);
}

// Banderoll med text på väggen (canvas-textur, en mesh)
export function addBanner(scene, { x, y, z, rot, w, h, text, bg = '#1d3f8f', fg = '#ffd23f' }) {
  if (!scene) return;
  const [c, ctx] = canvas(1024, Math.round((1024 * h) / w));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = fg; ctx.lineWidth = 10; ctx.strokeRect(14, 14, c.width - 28, c.height - 28);
  ctx.fillStyle = fg;
  ctx.font = `900 ${Math.round(c.height * 0.55)}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }));
  m.position.set(x, y, z);
  m.rotation.y = rot;
  scene.add(m);
}

// Gula/svarta varningsränder på kanter (ren grafik, platt remsa)
export function addStripe(kit, a, b, width = 0.12, color = 0xf2c230) {
  if (!kit.scene) return;
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const len = Math.hypot(dx, dz);
  const g = new THREE.BoxGeometry(len, 0.02, width);
  g.rotateY(-Math.atan2(dz, dx));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.005, (a[2] + b[2]) / 2);
  kit.add('paint', g, color);
}
