import * as THREE from 'three';
import { G, groups } from '../core/physics.js';

// ---------------------------------------------------------------------------
// Terräng: mark med kullar och sänkor som vägen ligger i, i stället för ett
// platt golv. Banan anger den i sin spec:
//   terrain: { hills: [{ x, z, r | rx+rz, h, rot? }], cell?, blend?, base? }
// h kan vara negativt (en sänka, en bäckfåra). En terrass är platt upptill med
// egna slänter åt sidorna: { terrace: true, x, z, ax, az, ex, ez, h, rot? }
// där ax/az är halva längden och ex/ez slänternas bredd (smal = brant bank). Kullarna lyfter också vägen
// (track.js lägger groundAt till höjdprofilen), så vägen följer marken utan
// att varje backe måste skrivas in för hand. På broar (spec.bridges) följer
// vägen inte marken och marken inte vägen.
//
// Nära vägen tonas marken mot vägytans höjd, så att vägen varken ligger i ett
// dike eller svävar. blend är hur många meter övergången tar.
// ---------------------------------------------------------------------------

// Höjd från kullarna i punkten (x, z). Mjuk cosinusform, inga kanter.
export function hillsAt(hills, x, z) {
  let h = 0;
  for (const k of hills) {
    let dx = x - k.x, dz = z - k.z;
    if (k.rot) { const c = Math.cos(k.rot), s = Math.sin(k.rot); [dx, dz] = [dx * c - dz * s, dx * s + dz * c]; }
    if (k.terrace) {
      const side = (d, a, e) => { const t = Math.abs(d) - (a - e); return t <= 0 ? 1 : t >= e ? 0 : 0.5 * (1 + Math.cos((Math.PI * t) / e)); };
      h += k.h * side(dx, k.ax, k.ex) * side(dz, k.az, k.ez);
      continue;
    }
    const u = Math.hypot(dx / (k.rx ?? k.r), dz / (k.rz ?? k.r));
    if (u < 1) h += k.h * 0.5 * (1 + Math.cos(Math.PI * u));
  }
  return h;
}

// Rutnät av markhöjder runt banan. size är golvets sida i meter.
export function buildTerrainData(track, spec, size) {
  const cell = spec.cell ?? 0.5;
  const blend = spec.blend ?? 4;
  const base = spec.base ?? 0;
  const hills = spec.hills || [];
  const n = Math.ceil(size / cell);
  const half = (n * cell) / 2;
  const { pts, normals, N, roadHalf, isGap } = track;
  const bridge = track.isBridge || [];

  // Vägpunkter i fack om 4 m så att närmaste punkt hittas snabbt
  const B = 4, buckets = new Map();
  const key = (bx, bz) => bx * 4096 + bz;
  for (let i = 0; i < N; i++) {
    if (isGap[i] || bridge[i]) continue;
    const k = key(Math.floor(pts[i].x / B), Math.floor(pts[i].z / B));
    (buckets.get(k) || buckets.set(k, []).get(k)).push(i);
  }
  const reach = roadHalf + blend + B;
  const R = Math.ceil(reach / B);

  const extra = (track.shortcuts || []).map((sc) => sc.path).filter((P) => P.terrain);
  const heights = new Float32Array((n + 1) * (n + 1));
  for (let ix = 0; ix <= n; ix++) {
    for (let iz = 0; iz <= n; iz++) {
      const x = -half + ix * cell, z = -half + iz * cell;
      const g = base + hillsAt(hills, x, z);
      // Närmaste vägpunkt (i planet) bland facken runt omkring
      let best = -1, bd = reach * reach;
      const bx = Math.floor(x / B), bz = Math.floor(z / B);
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
        const list = buckets.get(key(bx + a, bz + b));
        if (list) for (const i of list) { const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
      }
      let h = g, uMain = 1;
      if (best >= 0) {
        const lat = (x - pts[best].x) * normals[best].x + (z - pts[best].z) * normals[best].z;
        // Vägens plan (med dosering) fortsätter en bit ut, så att kanten möter marken
        const c = Math.max(-roadHalf - 0.3, Math.min(roadHalf + 0.3, lat));
        // Strax under vägytan, så att vägen alltid ligger överst
        // Lutningen längs vägen läggs till, annars sticker marken upp mellan
        // vägpunkterna i branta backar
        const t = track.tangents[best], along = (x - pts[best].x) * t.x + (z - pts[best].z) * t.z;
        const ahead = (best + (along > 0 ? 1 : -1) + N) % N;
        const ds = Math.hypot(pts[ahead].x - pts[best].x, pts[ahead].z - pts[best].z) || 1;
        const w = Math.min(1, Math.abs(along) / ds);
        const roadY = track.surfaceY(best, c) * (1 - w) + track.surfaceY(ahead, c) * w - 0.012;
        const out = Math.max(0, Math.abs(lat) - roadHalf - 0.3);
        const u = Math.min(1, out / blend);
        h = roadY + (g - roadY) * u * u * (3 - 2 * u);
        uMain = u;
      }
      // Genvägar som följer marken: marken tonas mot dem också, annars ligger
      // genvägen som en list i backen och bilar kan fastna med underredet
      for (const P of extra) {
        const q = P.nearest(x, z), d = Math.sqrt(q.d2);
        const out = Math.max(0, d - P.roadHalf - 0.3);
        if (out >= blend) continue;
        const i = q.index, t = P.tangents[i];
        const along = (x - P.pts[i].x) * t.x + (z - P.pts[i].z) * t.z;
        const j = Math.max(0, Math.min(P.N - 2, i + (along > 0 ? 1 : -1)));
        const ds = Math.hypot(P.pts[j].x - P.pts[i].x, P.pts[j].z - P.pts[i].z) || 1;
        const w = Math.min(1, Math.abs(along) / ds);
        const roadY = P.pts[i].y * (1 - w) + P.pts[j].y * w - 0.012;
        const u = out / blend;
        if (u < uMain) { h = roadY + (g - roadY) * u * u * (3 - 2 * u); uMain = u; }
      }
      heights[iz + ix * (n + 1)] = h;
    }
  }

  return {
    n, cell, half, heights, size: n * cell,
    // Markhöjd i (x, z), bilinjärt mellan rutnätets punkter
    heightAt(x, z) {
      const fx = Math.max(0, Math.min(n - 1e-6, (x + half) / cell)), fz = Math.max(0, Math.min(n - 1e-6, (z + half) / cell));
      const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
      const H = (a, b) => heights[b + a * (n + 1)];
      return (H(ix, iz) * (1 - u) + H(ix + 1, iz) * u) * (1 - v) + (H(ix, iz + 1) * (1 - u) + H(ix + 1, iz + 1) * u) * v;
    },
  };
}

// Kollision: ett trimesh av samma rutnät. Rapiers höjdkarta missar lodräta
// strålar i stora rutnät (hjulens strålar), så den används inte.
export function buildTerrainPhysics(world, RAPIER, T) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const g = terrainGeometry(T);
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(g.attributes.position.array, new Uint32Array(g.index.array))
      .setFriction(1).setCollisionGroups(groups(G.WORLD)),
    body
  );
  g.dispose();
  return body;
}

// Grafik: samma rutnät som kollisionen, så att det man ser är det man kör på
export function terrainGeometry(T, uvTile = 2) {
  const { n, cell, half, heights } = T;
  const pos = new Float32Array((n + 1) * (n + 1) * 3), uv = new Float32Array((n + 1) * (n + 1) * 2);
  const idx = [];
  for (let iz = 0; iz <= n; iz++) for (let ix = 0; ix <= n; ix++) {
    const v = iz * (n + 1) + ix, x = -half + ix * cell, z = -half + iz * cell;
    pos.set([x, heights[iz + ix * (n + 1)], z], v * 3);
    uv.set([x / uvTile, z / uvTile], v * 2);
  }
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const a = iz * (n + 1) + ix, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Enkel mark för banor utan egen miljö (provbanan): färgad efter höjd
export function buildTerrainMesh(scene, T, color = 0x6f9a4a) {
  const g = terrainGeometry(T);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color(color), hsl = {};
  c.getHSL(hsl);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    c.setHSL(hsl.h, hsl.s, Math.max(0.15, Math.min(0.75, hsl.l + y * 0.05)));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
