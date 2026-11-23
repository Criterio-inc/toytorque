import * as THREE from 'three';
import { stoneMaterial, shadowed, boxCollider, fixedBody, mergeAll } from './gardenArt.js';

// ---------------------------------------------------------------------------
// Stenbro på terräng: murade brosidor från marken upp till brodäcket, med ett
// valv där en lägre vägbit går under. Sidorna är massiva (egna kolliderare)
// utom i valvet, så att en bil nere i sänkan inte kan köra igenom muren.
// ---------------------------------------------------------------------------

export function addStoneBridge(scene, world, RAPIER, track) {
  const { pts, tangents, normals, N, roadHalf, isBridge, barrier } = track;
  const G = track.ground;
  if (!G || !isBridge.some(Boolean)) return;
  let i0 = isBridge.findIndex((b, i) => b && !isBridge[(i - 1 + N) % N]);
  const run = [];
  for (let i = i0; isBridge[i % N] && run.length < N; i++) run.push(i % N);

  // Var korsar den lägre vägen? Närmaste punkt utanför bron som ligger lägre.
  let best = null;
  for (const i of run) for (let k = 0; k < N; k++) {
    if (isBridge[k] || pts[k].y > pts[i].y - 0.5) continue;
    const d = (pts[k].x - pts[i].x) ** 2 + (pts[k].z - pts[i].z) ** 2;
    if (!best || d < best.d) best = { d, i, k };
  }
  const sOf = (i) => track.dist[i];
  let arch = null;
  if (best) {
    const a = tangents[best.i], b = tangents[best.k];
    const sin = Math.max(0.35, Math.abs(a.x * b.z - a.z * b.x));
    const yLow = pts[best.k].y - 0.05;
    arch = { s: sOf(best.i), half: (roadHalf + 0.7) / sin, yLow, top: pts[best.i].y - 0.32 };
  }
  const bottomAt = (i, x, z) => {
    let y = G.heightAt(x, z) - 0.25;
    if (arch) {
      const u = (sOf(i) - arch.s) / arch.half;
      if (Math.abs(u) < 1) y = Math.max(y, arch.yLow + (arch.top - arch.yLow) * Math.sqrt(1 - u * u));
    }
    return y;
  };

  const inner = roadHalf - 0.05, outer = roadHalf + barrier.thick + 0.12;
  const body = world ? fixedBody(world, RAPIER) : null;
  const geos = [];
  for (const side of [1, -1]) {
    const pos = [], uv = [];
    const P = (i, off) => {
      const p = pts[i], n = normals[i];
      const x = p.x + n.x * off * side, z = p.z + n.z * off * side;
      return { x, z, top: track.surfaceY(i, roadHalf * side) - 0.01, bot: bottomAt(i, x, z) };
    };
    for (let k = 0; k + 1 < run.length; k++) {
      const i = run[k], j = run[k + 1];
      const ao = P(i, outer), bo = P(j, outer), ai = P(i, inner), bi = P(j, inner);
      const u0 = sOf(i) / 2, u1 = sOf(j) / 2;
      const quad = (a, b, c, d, ua, ub) => {
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
        uv.push(ua, a.y / 1.2, ub, b.y / 1.2, ub, c.y / 1.2, ua, a.y / 1.2, ub, c.y / 1.2, ua, d.y / 1.2);
      };
      const v = (q, y) => ({ x: q.x, y, z: q.z });
      quad(v(ao, ao.bot), v(bo, bo.bot), v(bo, bo.top), v(ao, ao.top), u0, u1); // utsida
      quad(v(bi, bi.bot), v(ai, ai.bot), v(ai, ai.top), v(bi, bi.top), u1, u0); // insida
      quad(v(ai, ai.bot), v(bi, bi.bot), v(bo, bo.bot), v(ao, ao.bot), u0, u1); // undersida (valvet)
      // Massiv mur där den når marken (inte i valvet)
      if (body && !(arch && Math.abs(sOf(i) - arch.s) < arch.half + 0.3)) {
        const mx = (ao.x + bo.x + ai.x + bi.x) / 4, mz = (ao.z + bo.z + ai.z + bi.z) / 4;
        const t = tangents[i], len = Math.hypot(bo.x - ao.x, bo.z - ao.z) + 0.05;
        const bot = Math.min(ao.bot, bo.bot), top = Math.min(ao.top, bo.top);
        if (top - bot > 0.05) boxCollider(world, RAPIER, body, len / 2, (top - bot) / 2, (outer - inner) / 2, mx, (top + bot) / 2, mz, Math.atan2(-t.z, t.x), 0.6);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    // Insidan och utsidan har motsatt varv beroende på sida
    if (side < 0) { const p = g.attributes.position; for (let q = 0; q < p.count; q += 3) { const t = [p.getX(q + 1), p.getY(q + 1), p.getZ(q + 1)]; p.setXYZ(q + 1, p.getX(q + 2), p.getY(q + 2), p.getZ(q + 2)); p.setXYZ(q + 2, ...t); } const w = g.attributes.uv; for (let q = 0; q < w.count; q += 3) { const t = [w.getX(q + 1), w.getY(q + 1)]; w.setXY(q + 1, w.getX(q + 2), w.getY(q + 2)); w.setXY(q + 2, ...t); } }
    g.computeVertexNormals();
    geos.push(g);
  }
  if (scene) scene.add(shadowed(new THREE.Mesh(mergeAll(geos), stoneMaterial())));
}
