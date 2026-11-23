import * as THREE from 'three';
import { G, groups } from '../core/physics.js';

// Banans fysik (väg, sidor, vallar, pelare) och geometrin som både fysiken
// och grafiken bygger på.
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
  if (sides.eIdx.length) {
    world.createCollider(RAPIER.ColliderDesc.trimesh(sides.ePos, sides.eIdx).setFriction(0.9).setCollisionGroups(groups(G.WORLD)), body);
  }
  // Kantvallar som lådor längs kanten, lutade med vägen
  const { height, thick } = data.barrier;
  const off = data.roadHalf + thick / 2;
  for (const seg of barrierSegments(data)) {
    for (const side of [1, -1]) {
      const a = edge3(data, seg.i, side * (off + flareAt(data, seg.i))), b = edge3(data, seg.j, side * (off + flareAt(data, seg.j)));
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
  // En genvägs sista punkt är markerad som glapp bara för att vägen tar slut
  // där. Den är ingen ramp, och på terräng skulle blocken ner till nollhöjd
  // sticka upp bredvid huvudbanan.
  const { N } = data;
  const isGap = data.open ? data.isGap.map((g, k) => g && k !== N - 1) : data.isGap;
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
      RAPIER.ColliderDesc.cuboid(0.06, p.h / 2, 0.06).setTranslation(p.x, p.y0 + p.h / 2, p.z).setCollisionGroups(groups(G.WORLD)),
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


// ---------------------------------------------------------------------------
//  Geometrihjälpare
// ---------------------------------------------------------------------------

// Vägytan: triangelremsa som hoppar över glappen.
export function roadGeometry(data, withUv = false) {
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
export function sideGeometry(data) {
  const { pts, normals, N, roadHalf, isGap } = data;
  const pos = [], idx = [], ePos = [], eIdx = [];
  // På terräng bär marken vägen; bara broar har sidor
  const high = (i) => pts[i % N].y > 0.03 && !isGap[i % N] && (!data.terrain || data.isBridge?.[i % N]);
  const put = (P, I) => (a, b, c, d) => {
    const base = P.length / 3;
    P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const quad = put(pos, idx), equad = put(ePos, eIdx);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    if (!high(i) || !high(j)) continue;
    // Broar på terräng är öppna undertill (ett brodäck), så att inget kan fastna under dem
    const over = overRoad(data, i) || (data.terrain && data.isBridge[i]);
    const slope = data.embank ? Math.max(data.embank[i], data.embank[j]) : 0;
    if (slope && !over) {
      // Sluttande vall ner till marken, lika körbar som vägen
      for (const side of [1, -1]) {
        const a = edge3(data, i, roadHalf * side), b = edge3(data, j, roadHalf * side);
        const out = (e, k) => { const n = normals[k % N], w = Math.max(0, e.y) * slope * side; return { x: e.x + n.x * w, y: 0, z: e.z + n.z * w }; };
        equad(a, b, out(b, j), out(a, i));
      }
      continue;
    }
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
    if (edgeAt < 0 || pts[edgeAt].y < 0.03 || (data.terrain && !data.isBridge?.[edgeAt])) continue;
    const L = edge3(data, edgeAt, roadHalf), R = edge3(data, edgeAt, -roadHalf);
    quad(L, R, { ...R, y: 0 }, { ...L, y: 0 });
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), ePos: new Float32Array(ePos), eIdx: new Uint32Array(eIdx) };
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
export function pillars(data) {
  if (data._pillars) return data._pillars;
  const { pts, normals, N, roadHalf, isGap } = data;
  const out = [];
  const every = Math.round(3 / data.spacing);
  for (let i = 0; i < N; i += every) {
    if (pts[i].y < 0.25 || isGap[i] || data.embank?.[i] || (data.terrain && !data.isBridge?.[i])) continue; // en sandvall eller marken bär vägen själv
    for (const side of [1, -1]) {
      const { x, y: h, z } = edge3(data, i, (roadHalf - 0.1) * side);
      let blocked = false;
      for (let k = 0; k < N && !blocked; k += 2) {
        if (Math.abs(data.dist[k] - data.dist[i]) < 6 || pts[k].y > (data.terrain ? pts[i].y - 0.3 : 0.2)) continue;
        blocked = (pts[k].x - x) ** 2 + (pts[k].z - z) ** 2 < (roadHalf + 0.4) ** 2;
      }
      const y0 = data.groundAt ? data.groundAt(x, z) - 0.1 : 0; // på terräng står pelaren på marken
      if (!blocked && h - y0 > 0.1) out.push({ x, z, h: h - y0, y0 });
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

export const flareAt = (data, i) => (data.flare ? data.flare[((i % data.N) + data.N) % data.N] : 0);

// Mittpunkt för en vallbit (som kolliderarna läggs ut)
export function barrierCenter(data, seg, side) {
  const { height, thick } = data.barrier;
  const off = data.roadHalf + thick / 2;
  const a = edge3(data, seg.i, side * (off + flareAt(data, seg.i))), b = edge3(data, seg.j, side * (off + flareAt(data, seg.j)));
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + height / 2, z: (a.z + b.z) / 2 };
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
export function segmentQuat(a, b) {
  _z.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
  _x.set(0, 1, 0).cross(_z).normalize();
  _y.copy(_z).cross(_x);
  _m.makeBasis(_x, _y, _z);
  const q = new THREE.Quaternion().setFromRotationMatrix(_m);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

