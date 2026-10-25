import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G, groups } from '../core/physics.js';
import { rng } from './warehouseArt.js';
import { bankY } from '../track/track.js';

// ---------------------------------------------------------------------------
// Procedurell grafik för leksaksaffären om natten: lackat plankgolv, hyllor
// med leksakskartonger, jätteklossar, nallar, robot vid en tunnel med grönt
// neon, tågbana, bollhav, bilbana, skyltar och vimplar. Allt ritas i canvas.
//
// Funktionerna tar (B|scene, world, RAPIER, opts). Utan scene/B byggs bara
// fysiken (inget document rörs), utan world bara grafiken. Statiska delar
// samlas i en Batch och slås ihop till en mesh per material.
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

export { rng };
export const C = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const yQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

// --- fysik -----------------------------------------------------------------

function fixedBody(world, RAPIER, x = 0, y = 0, z = 0, rotY = 0) {
  return world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(yQuat(rotY)));
}

export function staticBox(world, RAPIER, hx, hy, hz, x, y, z, rotY = 0, friction = 0.7) {
  if (!world) return null;
  const body = fixedBody(world, RAPIER, x, y, z, rotY);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction).setRestitution(0.15).setCollisionGroups(groups(G.WORLD)),
    body
  );
  return body;
}

// Låda i ett lokalt system (x, z, rot) med lokal förskjutning (lx, lz)
function localBox(world, RAPIER, o, hx, hy, hz, lx, y, lz) {
  const c = Math.cos(o.rot ?? 0), s = Math.sin(o.rot ?? 0);
  return staticBox(world, RAPIER, hx, hy, hz, o.x + lx * c + lz * s, y, o.z - lx * s + lz * c, o.rot ?? 0);
}

// --- canvas-hjälp ----------------------------------------------------------

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Sömlöst värdebrus, 0..1
function valueNoise(w, h, cells, octaves, r) {
  const out = new Float32Array(w * h);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cx = cells << o, cy = Math.max(1, Math.round((cells << o) * h / w));
    const lat = new Float32Array(cx * cy);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * cy, y0 = Math.floor(fy) % cy, y1 = (y0 + 1) % cy;
      let ty = fy - Math.floor(fy); ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cx, x0 = Math.floor(fx) % cx, x1 = (x0 + 1) % cx;
        let tx = fx - Math.floor(fx); tx = tx * tx * (3 - 2 * tx);
        const a = lat[y0 * cx + x0] + (lat[y0 * cx + x1] - lat[y0 * cx + x0]) * tx;
        const b = lat[y1 * cx + x0] + (lat[y1 * cx + x1] - lat[y1 * cx + x0]) * tx;
        out[y * w + x] += amp * (a + (b - a) * ty);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, x, y, maxW, size, weight = '900') {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && s > 8) { s -= 2; ctx.font = `${weight} ${s}px ${FONT}`; }
  ctx.fillText(text, x, y);
}

// Plankor: rader längs u med förskjutna skarvar. Ger tillbaka bilddata.
function paintPlanks(ctx, W, H, { rows, base, seed, along = 'x', seam = 0.42, minLen, maxLen, spread = 0.26 }) {
  const r = rng(seed);
  const n = valueNoise(W, H, 4, 5, rng(seed + 1));
  const img = ctx.createImageData(W, H);
  const L = along === 'x' ? W : H, Wd = along === 'x' ? H : W;
  const pw = Wd / rows;
  const segOf = [], tone = [];
  for (let row = 0; row < rows; row++) {
    const seg = new Uint8Array(L), joints = new Uint8Array(L);
    let pos = Math.floor(r() * L), k = 0;
    const tones = [];
    for (let made = 0; made < 40; made++) {
      const len = Math.floor(minLen + r() * (maxLen - minLen));
      for (let i = 0; i < len && i < L; i++) seg[(pos + i) % L] = k;
      joints[pos % L] = 1;
      tones.push([1 - spread / 2 + r() * spread, (r() - 0.5) * 0.08]);
      pos += len; k++;
      if (pos - L >= Math.floor(r() * L) && made > 0 && pos >= L + 1) break;
    }
    segOf.push([seg, joints]);
    tone.push(tones);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = along === 'x' ? x : y, v = along === 'x' ? y : x;
    const row = Math.min(rows - 1, Math.floor(v / pw)), vv = v - row * pw;
    const [seg, joints] = segOf[row];
    const [tk, hue] = tone[row][seg[u]] || [1, 0];
    const i = y * W + x;
    const streak = Math.sin(u * 0.03 + vv * 0.55 + n[i] * 16) * 0.06 + Math.sin(u * 0.11 + n[i] * 30) * 0.025;
    let k = tk * (0.9 + n[i] * 0.18 + streak);
    if (vv < 1.2 || vv > pw - 1.2) k *= seam;
    else if (vv < 2.6) k *= 1.08; // ljus fasning
    if (joints[u] || joints[(u + 1) % L]) k *= seam + 0.1;
    img.data[i * 4] = Math.min(255, base[0] * k * (1 + hue));
    img.data[i * 4 + 1] = Math.min(255, base[1] * k);
    img.data[i * 4 + 2] = Math.min(255, base[2] * k * (1 - hue));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// ===========================================================================
// Material
// ===========================================================================

function woodTex() {
  return cached('woodTex', () => {
    const [c, ctx] = canvas(256);
    paintPlanks(ctx, 256, 256, { rows: 2, base: [236, 214, 178], seed: 61, seam: 0.8, minLen: 200, maxLen: 260, spread: 0.12 });
    return toTex(c);
  });
}

function furTex() {
  return cached('furTex', () => {
    const [c, ctx] = canvas(128);
    const n = valueNoise(128, 128, 16, 3, rng(71));
    const r = rng(72);
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) {
      const v = 200 + n[i] * 45 + (r() - 0.5) * 40;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTex(c);
  });
}

const MATS = {
  plastic: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0 }),
  matte: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
  metal: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.85 }),
  wood: () => new THREE.MeshStandardMaterial({ vertexColors: true, map: woodTex(), roughness: 0.4 }),
  plush: () => new THREE.MeshStandardMaterial({ vertexColors: true, map: furTex(), roughness: 1 }),
  neon: () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false }),
  boxes: () => new THREE.MeshStandardMaterial({ vertexColors: true, map: boxAtlas(), roughness: 0.5 }),
  blocks: () => new THREE.MeshStandardMaterial({ vertexColors: true, map: blockAtlas(), roughness: 0.38 }),
  brand: () => new THREE.MeshStandardMaterial({ vertexColors: true, map: brandTex(), roughness: 0.35, emissive: 0xffffff, emissiveMap: brandTex(), emissiveIntensity: 0.12 }),
  signs: () => new THREE.MeshStandardMaterial({ vertexColors: true, map: signAtlas(), emissive: 0xffffff, emissiveMap: signAtlas(), emissiveIntensity: 0.85, roughness: 0.5 }),
  flags: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }),
  racetop: () => new THREE.MeshStandardMaterial({ vertexColors: true, map: raceTopTex(), roughness: 0.45 }),
};
const NO_SHADOW = new Set(['neon', 'flags', 'signs']);

// Samlar geometri per material och slår ihop vid flush (en mesh per material)
export class Batch {
  constructor() { this.lists = new Map(); }

  // col: [r, g, b] eller null för att behålla geometrins egna vertexfärger
  add(key, geo, col = [1, 1, 1]) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (col || !g.attributes.color) {
      const c = col || [1, 1, 1];
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2]; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    g.clearGroups();
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(g);
    return g;
  }

  flush(scene) {
    for (const [key, list] of this.lists) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list), cached('mat_' + key, MATS[key]));
      mesh.castShadow = !NO_SHADOW.has(key);
      mesh.receiveShadow = key !== 'neon';
      scene.add(mesh);
    }
    this.lists.clear();
  }
}

// --- geometrihjälp ---------------------------------------------------------

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

// Lokal transform: rotation (rx, ry, rz), skala och förflyttning
function xf(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m4.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
  return geo.applyMatrix4(_m4);
}
// Från objektets lokala system (rot kring y, sedan förflyttning) till världen
function place(geo, o) {
  geo.rotateY(o.rot ?? 0);
  geo.translate(o.x, o.y ?? 0, o.z);
  return geo;
}
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r0, r1, h, seg = 16) => new THREE.CylinderGeometry(r0, r1, h, seg);
const sph = (r, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);

// Färg per BoxGeometry-sida (+x, -x, +y, -y, +z, -z)
function faceColors(geo, cols) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = cols[Math.floor(i / 4)] || [1, 1, 1];
    arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
// Varje BoxGeometry-sida på en egen ruta i en atlas. cells: 6 st [u0,v0,u1,v1]
function atlasUV(geo, cells) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = cells[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
    }
  }
  return geo;
}
const cell4 = (i, pad = 0.004) => {
  const cx = i % 4, cy = Math.floor(i / 4);
  return [cx / 4 + pad, 1 - (cy + 1) / 4 + pad, (cx + 1) / 4 - pad, 1 - cy / 4 - pad];
};

// ===========================================================================
// Golv: lackade plankor i honungston, blankt
// ===========================================================================

const FLOOR_TILE = 4;

function floorTexture() {
  return cached('floorTex', () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    paintPlanks(ctx, S, S, { rows: 22, base: [158, 98, 52], seed: 11, minLen: 300, maxLen: 640 });
    // Slitna stråk och lite smuts i lacken
    const r = rng(13);
    for (let i = 0; i < 18; i++) {
      const x = r() * S, y = r() * S, rad = 60 + r() * 180;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, r() < 0.5 ? 'rgba(255,220,170,0.06)' : 'rgba(40,20,5,0.07)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    return toTex(c);
  });
}

export function makePlankFloor(scene, world, RAPIER, { size }) {
  const half = size / 2;
  if (world) {
    const body = fixedBody(world, RAPIER);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0).setFriction(1).setCollisionGroups(groups(G.WORLD)),
      body
    );
  }
  if (!scene) return;
  const map = floorTexture().clone();
  map.repeat.set(size / FLOOR_TILE, size / FLOOR_TILE);
  map.needsUpdate = true;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshPhysicalMaterial({ map, roughness: 0.62, specularIntensity: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: 1.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

// ===========================================================================
// Väggar och tak: mörkblå tapet med stjärnor, träpanel, färgglad fris
// ===========================================================================

const WALL_TILE = 8;

function wallTexture(H) {
  return cached('wallTex' + H, () => {
    const W = 1024, Hp = 1024;
    const [c, ctx] = canvas(W, Hp);
    const py = Hp / H; // pixlar per meter
    // Tapet
    const g = ctx.createLinearGradient(0, 0, 0, Hp);
    g.addColorStop(0, '#1b1f4a'); g.addColorStop(1, '#2a2f66');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hp);
    const r = rng(81);
    // Lodräta ränder
    for (let x = 0; x < W; x += 64) { ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(x, 0, 30, Hp); }
    // Stjärnor och månar
    const star = (x, y, s, col) => {
      ctx.fillStyle = col; ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? s * 0.45 : s;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
    };
    for (let i = 0; i < 70; i++) {
      const x = r() * W, y = py * 1.4 + r() * (Hp - py * 2.4);
      star(x, y, 6 + r() * 12, ['#ffe27a', '#ffffff', '#ffb3d9', '#9fe7ff'][Math.floor(r() * 4)]);
    }
    // Fris upptill: färgglada fält
    const fy = Hp - py * (H - 0.5);
    const cols = ['#e23b2e', '#f7c51e', '#2b6fd8', '#2fa24c', '#ff7a1a', '#c04bd8'];
    for (let i = 0; i < 16; i++) { ctx.fillStyle = cols[i % 6]; ctx.fillRect(i * 64, 0, 64, fy); }
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, fy - 6, W, 6);
    // Träpanel nertill (1.1 m)
    const wy = Hp - py * 1.1;
    for (let x = 0; x < W; x += 32) {
      ctx.fillStyle = x % 64 ? '#6b3f22' : '#5f381e'; ctx.fillRect(x, wy, 32, Hp - wy);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, wy, 2, Hp - wy);
    }
    ctx.fillStyle = '#3a2112'; ctx.fillRect(0, wy - 10, W, 12);
    ctx.fillStyle = '#2a170c'; ctx.fillRect(0, Hp - 14, W, 14);
    return toTex(c);
  });
}

export function makeStoreHall(scene, world, RAPIER, { size, height }) {
  const half = size / 2, T = 0.3;
  const sides = [
    { x: 0, z: -half, rot: 0 }, { x: 0, z: half, rot: Math.PI },
    { x: -half, z: 0, rot: Math.PI / 2 }, { x: half, z: 0, rot: -Math.PI / 2 },
  ];
  if (world) {
    const body = fixedBody(world, RAPIER);
    for (const s of sides) {
      const nx = Math.sin(s.rot), nz = Math.cos(s.rot);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(half + T, height / 2, T / 2)
          .setTranslation(s.x - nx * T / 2, height / 2, s.z - nz * T / 2)
          .setRotation(yQuat(s.rot)).setFriction(0.6).setCollisionGroups(groups(G.WORLD)),
        body
      );
    }
  }
  if (!scene) return;
  const geos = [];
  for (const s of sides) {
    const g = new THREE.PlaneGeometry(size, height);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * size / WALL_TILE);
    g.translate(0, height / 2, 0);
    g.rotateY(s.rot);
    g.translate(s.x, 0, s.z);
    geos.push(g);
  }
  const walls = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: wallTexture(height), roughness: 0.85 }));
  walls.receiveShadow = true;
  scene.add(walls);

  // Tak: mörka takplattor i rutnät
  const tex = cached('ceilTex', () => {
    const [c, ctx] = canvas(128);
    ctx.fillStyle = '#23242c'; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#15161b'; ctx.fillRect(0, 0, 128, 4); ctx.fillRect(0, 0, 4, 128);
    return toTex(c);
  }).clone();
  tex.repeat.set(size / 1.2, size / 1.2);
  tex.needsUpdate = true;
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  roof.rotation.x = Math.PI / 2;
  roof.position.y = height;
  scene.add(roof);
}

// Lysrörsarmaturer i taket: de flesta släckta (natt), några tända
export function addCeilingLights(B, { size, height, on = (i) => i % 3 === 0 }) {
  if (!B) return;
  let i = 0;
  for (let z = -size / 2 + 6; z < size / 2 - 4; z += 6) {
    for (let x = -size / 2 + 5; x < size / 2 - 3; x += 7) {
      B.add('matte', box(2.6, 0.08, 0.5, x, height - 0.04, z), C(0x3c3f48));
      B.add(on(i++) ? 'neon' : 'matte', box(2.4, 0.02, 0.32, x, height - 0.09, z), on(i - 1) ? C(0xfff0cc) : C(0x55585f));
    }
  }
}

// ===========================================================================
// Banans körfält: mörkt lackade plankor längs färdriktningen med tryckta kantlinjer
// ===========================================================================

const LANE_TILE = 4;

function laneTexture() {
  return cached('laneTex', () => {
    const W = 512, H = 1024;
    const [c, ctx] = canvas(W, H);
    paintPlanks(ctx, W, H, { rows: 8, base: [118, 66, 36], seed: 21, along: 'y', minLen: 340, maxLen: 900, seam: 0.38, spread: 0.3 });
    // Tryckta kantlinjer och en streckad mittlinje (lekmattestil)
    ctx.fillStyle = 'rgba(245,240,225,0.92)';
    ctx.fillRect(W * 0.03, 0, W * 0.028, H);
    ctx.fillRect(W * (1 - 0.058), 0, W * 0.028, H);
    ctx.fillStyle = 'rgba(255,210,63,0.75)';
    for (let y = 0; y < H; y += 256) ctx.fillRect(W / 2 - 5, y + 40, 10, 140);
    return toTex(c);
  });
}

export function addPlankLane(scene, track) {
  if (!scene) return;
  const { pts, normals, roadHalf, dist, length } = track;
  // Genvägar (open): glapp på golvnivå (vallöppningar) får plankor, bara
  // hoppets glapp i luften lämnas tomt. Sista punkten är en spärr.
  const N = track.open ? track.N - 1 : track.N;
  const isGap = track.open ? pts.map((p, i) => track.isGap[i] && p.y > 0.02) : track.isGap;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const p = pts[i % N], n = normals[i % N], y = p.y + 0.004, dy = bankY(track, i, roadHalf);
    pos.push(p.x + n.x * roadHalf, y + dy, p.z + n.z * roadHalf, p.x - n.x * roadHalf, y - dy, p.z - n.z * roadHalf);
    const v = (dist[i] ?? length) / LANE_TILE;
    uv.push(0, v, 1, v);
  }
  for (let i = 0; i < (track.open ? N - 1 : N); i++) {
    if (isGap[i] || isGap[(i + 1) % N]) continue;
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const off = track.open ? -2.5 : -3; // huvudbanan överst där de möts
  const m = new THREE.Mesh(g, cached('laneMat' + off, () => new THREE.MeshPhysicalMaterial({
    map: laneTexture(), roughness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.15, envMapIntensity: 0.9,
    polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off,
  })));
  m.receiveShadow = true;
  scene.add(m);
}

// ===========================================================================
// Regnbågsrampen: pianotangenter i regnbågens färger på vägen och staplade
// färgade plankor längs sidorna. Plattformen överst är en jättekartong.
// ===========================================================================

export const RAINBOW = [0xe8352b, 0xff8a1c, 0xffd23f, 0x3fbf4a, 0x1e8fe0, 0x3b4fd0, 0x9440c8];

function keyTexture() {
  return cached('keyTex', () => {
    const [c, ctx] = canvas(64);
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#d8d8d8'); g.addColorStop(0.15, '#ffffff'); g.addColorStop(0.85, '#f2f2f2'); g.addColorStop(1, '#9a9a9a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#1c1c1c'; ctx.fillRect(0, 0, 64, 3); ctx.fillRect(0, 61, 64, 3);
    return toTex(c);
  });
}

/**
 * Tangenter och sidoplankor för de upphöjda delarna i [i0, i1] (index längs banan).
 * keyLen: antal punkter per tangent. skip(i): hoppa över (t.ex. plattformen).
 */
export function addRainbowSection(B, scene, track, { i0, i1, keyLen = 2, palette = RAINBOW, skip = () => false, keys = true, clad = true }) {
  if (!B) return;
  const { pts, normals, tangents, N, roadHalf, isGap } = track;
  const wide = roadHalf + track.barrier.thick + 0.06;
  const pos = [], uv = [], col = [];
  let k = 0;
  for (let a = i0; a < i1; a += keyLen, k++) {
    const b = Math.min(a + keyLen, i1);
    const ia = a % N, ib = b % N;
    if (isGap[ia] || isGap[ib] || skip(ia) || skip(ib)) continue;
    const c = C(palette[k % palette.length]);
    const P = (i, s) => [pts[i].x + normals[i].x * roadHalf * s, pts[i].y + 0.007, pts[i].z + normals[i].z * roadHalf * s];
    if (keys) {
      const q = [P(ia, 1), P(ia, -1), P(ib, -1), P(ib, 1)];
      const quv = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const t of [0, 1, 2, 0, 2, 3]) { pos.push(...q[t]); uv.push(...quv[t]); col.push(...c); }
    }
    if (clad) {
      // Sidoplanka: låda från golvet upp till den lägsta vägkanten i tangenten
      const top = Math.min(pts[ia].y, pts[ib].y) - 0.012;
      if (top < 0.03) continue;
      const mx = (pts[ia].x + pts[ib].x) / 2, mz = (pts[ia].z + pts[ib].z) / 2;
      const t = tangents[ia];
      const len = Math.hypot(pts[ib].x - pts[ia].x, pts[ib].z - pts[ia].z) + 0.02;
      const g = box(wide * 2, top, len, 0, top / 2, 0);
      place(g, { x: mx, z: mz, rot: Math.atan2(t.x, t.z) });
      B.add('wood', g, c);
    }
  }
  if (keys && pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({
      map: keyTexture(), vertexColors: true, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    }));
    m.receiveShadow = true;
    scene.add(m);
  }
}

// --- varumärket: TOYTORQUE ---------------------------------------------

function drawBolt(ctx, x, y, s, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.15, y - s * 0.5); ctx.lineTo(x + s * 0.45, y - s * 0.5); ctx.lineTo(x + s * 0.2, y - s * 0.05);
  ctx.lineTo(x + s * 0.45, y - s * 0.05); ctx.lineTo(x - s * 0.2, y + s * 0.55); ctx.lineTo(x, y + s * 0.08);
  ctx.lineTo(x - s * 0.22, y + s * 0.08); ctx.closePath(); ctx.fill();
}

// Atlas 1024×512: övre halvan en lång banderoll, nedre vänstra en kartongsida,
// nedre högra en röd-vit randig sida
function brandTex() {
  return cached('brandTex', () => {
    const [c, ctx] = canvas(1024, 512);
    // Banderoll
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, 1024, 256);
    for (let x = -40; x < 1100; x += 80) {
      ctx.fillStyle = '#d8241c';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 40, 0); ctx.lineTo(x + 10, 34); ctx.lineTo(x - 30, 34); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, 256); ctx.lineTo(x + 40, 256); ctx.lineTo(x + 70, 222); ctx.lineTo(x + 30, 222); ctx.fill();
    }
    ctx.fillStyle = '#d8241c'; roundRect(ctx, 40, 52, 944, 152, 30); ctx.fill();
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 8; roundRect(ctx, 52, 64, 920, 128, 22); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7a0d08'; fitText(ctx, 'TOYTORQUE', 518, 134, 760, 104);
    ctx.fillStyle = '#ffffff'; fitText(ctx, 'TOYTORQUE', 512, 128, 760, 104);
    drawBolt(ctx, 110, 128, 110, '#ffd23f'); drawBolt(ctx, 914, 128, 110, '#ffd23f');
    // Kartongsida
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 256, 512, 256);
    ctx.fillStyle = '#d8241c'; ctx.fillRect(0, 256, 512, 40); ctx.fillRect(0, 472, 512, 40);
    ctx.fillStyle = '#d8241c'; roundRect(ctx, 30, 316, 452, 136, 24); ctx.fill();
    ctx.fillStyle = '#ffffff'; fitText(ctx, 'LEKSAKS', 256, 360, 400, 64);
    ctx.fillStyle = '#ffd23f'; fitText(ctx, '-TORQUE-', 256, 418, 400, 56);
    // Röd-vita ränder
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f4f1ea' : '#d8241c'; ctx.fillRect(512 + i * 64, 256, 64, 256); }
    const t = toTex(c);
    return t;
  });
}
const BRAND_BANNER = [0, 0.5, 1, 1], BRAND_SIDE = [0.002, 0.002, 0.498, 0.498], BRAND_STRIPES = [0.502, 0.002, 1, 0.498];

/** Jättekartongen under plattformen (sträcker sig längs banan mellan index a och b). */
export function addBrandPlatform(B, world, RAPIER, track, { a, b }) {
  if (!B) return;
  const { pts, tangents, roadHalf } = track;
  const wide = roadHalf + track.barrier.thick + 0.06;
  const h = Math.min(pts[a].y, pts[b].y) - 0.012;
  const mx = (pts[a].x + pts[b].x) / 2, mz = (pts[a].z + pts[b].z) / 2;
  const len = Math.hypot(pts[b].x - pts[a].x, pts[b].z - pts[a].z) + 0.4;
  const t = tangents[a];
  const g = box(wide * 2, h, len, 0, h / 2, 0);
  // Långsidorna får banderollen (upprepad), gavlarna kartongsidan
  const uv = g.attributes.uv;
  const rep = Math.max(1, Math.round(len / (h * 4)));
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    let [u0, v0, u1, v1] = f < 2 ? BRAND_BANNER : f < 4 ? BRAND_STRIPES : BRAND_SIDE;
    const u = uv.getX(k), v = uv.getY(k);
    if (f < 2) uv.setXY(k, u * rep, v0 + v * (v1 - v0)); // banderollen upprepas i u (texturen är en hel bredd)
    else uv.setXY(k, u0 + u * (u1 - u0), v0 + v * (v1 - v0));
  }
  B.add('brand', place(g, { x: mx, z: mz, rot: Math.atan2(t.x, t.z) }));
}

/**
 * Trappan mellan våningarna: stegen går från överplanets kant (top, höjd y)
 * ner till golvet vid bottom (punkter i planet), halvbredd half. Stegen är
 * klossar i regnbågens färger med blank list på nosen, sidorna har
 * plastledstänger. Stegnosarna ligger på linjen top–bottom (nivån lägger en
 * slät yta längs vägen där, se addUnderlay i banmotorn).
 */
export function addToyStairs(B, world, RAPIER, { top, bottom, y, half, steps = 9 }) {
  const dx = bottom.x - top.x, dz = bottom.z - top.z, L = Math.hypot(dx, dz);
  const rot = Math.atan2(dx, dz), ang = Math.atan2(y, L);
  const o = { x: top.x, z: top.z, rot };
  if (world) {
    // Plattan och sidoväggarna i trappans eget system (z = nedåt längs trappan)
    const th = 0.1, len = Math.hypot(L, y);
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang);
    const q = qy.multiply(qx);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const put = (hx, hy, hz, lx, ly) => {
      const c = new THREE.Vector3(lx, ly, len / 2).applyQuaternion(q).add(new THREE.Vector3(top.x, y, top.z));
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(0.8).setCollisionGroups(groups(G.WORLD)), body);
    };
    for (const sd of [-1, 1]) put(0.08, 0.35, len / 2, sd * (half + 0.08), 0.25);
  }
  if (!B) return;
  const rise = y / steps, tread = L / steps;
  for (let k = 0; k < steps - 1; k++) {
    const h = y - (k + 1) * rise;
    B.add('plastic', place(box(half * 2, h, tread + 0.02, 0, h / 2, k * tread + tread / 2), o), C(RAINBOW[k % RAINBOW.length]));
    B.add('plastic', place(box(half * 2 + 0.02, 0.03, 0.06, 0, h - 0.01, (k + 1) * tread - 0.03), o), C(0xf6f4ee));
  }
  // Sidostycken och ledstänger
  const len = Math.hypot(L, y);
  for (const sd of [-1, 1]) {
    const side = box(0.16, 0.7, len + 0.1, 0, 0, 0).rotateX(ang).translate(sd * (half + 0.08), y / 2 + 0.22, L / 2);
    B.add('plastic', place(side, o), C(0x1e6fd9));
    const rail = cyl(0.04, 0.04, len + 0.3, 10).rotateX(Math.PI / 2 + ang).translate(sd * (half + 0.08), y / 2 + 0.95, L / 2);
    B.add('plastic', place(rail, o), C(0xffd23f));
    for (let k = 0; k <= 4; k++) {
      const t = k / 4, py = y * (1 - t);
      B.add('plastic', place(cyl(0.035, 0.035, 0.42, 8).translate(sd * (half + 0.08), py + 0.72, t * L), o), C(0xffd23f));
    }
  }
}

/** Pyramid av röd-vita TOYTORQUE-kartonger. */
export function addBrandPyramid(B, world, RAPIER, { x, z, rot = 0, rows = 4, w = 1.0, h = 0.8, d = 0.75 }) {
  const o = { x, z, rot };
  for (let row = 0; row < rows; row++) {
    const n = rows - row;
    if (world) localBox(world, RAPIER, o, (n * w) / 2, h / 2, d / 2, 0, row * h + h / 2, 0);
    if (!B) continue;
    for (let k = 0; k < n; k++) {
      const g = box(w * 0.98, h * 0.99, d, (k - (n - 1) / 2) * w, row * h + h / 2, 0);
      atlasUV(g, [BRAND_STRIPES, BRAND_STRIPES, BRAND_STRIPES, BRAND_STRIPES, BRAND_SIDE, BRAND_SIDE]);
      g.rotateY((k % 2 ? 1 : -1) * 0.03);
      B.add('brand', place(g, o));
    }
  }
}

// ===========================================================================
// Leksakskartonger: atlas med påhittade leksaker
// ===========================================================================

const TOYS = [
  { name: 'ROBO-RUNE', bg: ['#1e6fd9', '#0b2f73'], draw: 'robot' },
  { name: 'TURBO-TOR', bg: ['#e8352b', '#7a0d08'], draw: 'car' },
  { name: 'DINO-DUNDER', bg: ['#3fbf4a', '#145c1d'], draw: 'dino' },
  { name: 'RYMDRAKET X', bg: ['#2a2f66', '#090b24'], draw: 'rocket' },
  { name: 'NALLE-NISSE', bg: ['#ffb3d9', '#c04b88'], draw: 'bear' },
  { name: 'SNABBTÅGET', bg: ['#ffd23f', '#b37a00'], draw: 'train' },
  { name: 'PONNY-PIA', bg: ['#c04bd8', '#5a1470'], draw: 'pony' },
  { name: 'SNURRE TOPP', bg: ['#ff8a1c', '#a3420a'], draw: 'top' },
  { name: 'KLOSS-KUNGEN', bg: ['#18a7b5', '#0a4f57'], draw: 'blocks' },
  { name: 'FLYG-FIA', bg: ['#9fe7ff', '#2b7fbf'], draw: 'plane' },
  { name: 'BÅT-BOSSE', bg: ['#2b6fd8', '#123a80'], draw: 'boat' },
  { name: 'MONSTER-MAX', bg: ['#7d2bd8', '#2a0a5c'], draw: 'monster' },
];
const BOX_SIDE_COLS = [0xe8352b, 0x1e6fd9, 0xffd23f, 0x3fbf4a, 0xff8a1c, 0xc04bd8, 0x18a7b5, 0xf4f1ea];

function drawToy(ctx, kind, x, y, s) {
  const fill = (c) => { ctx.fillStyle = c; ctx.fill(); };
  const circ = (cx, cy, r, c) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); fill(c); };
  const rect = (rx, ry, w, h, c, rr = 4) => { roundRect(ctx, rx, ry, w, h, rr); fill(c); };
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 100, s / 100);
  switch (kind) {
    case 'robot':
      rect(-30, -50, 60, 40, '#c8ccd4', 8); circ(-13, -32, 7, '#39e6ff'); circ(13, -32, 7, '#39e6ff');
      rect(-36, -6, 72, 50, '#e8352b', 8); rect(-16, 6, 32, 20, '#222'); rect(-52, -2, 14, 40, '#c8ccd4'); rect(38, -2, 14, 40, '#c8ccd4');
      rect(-26, 44, 18, 14, '#888'); rect(8, 44, 18, 14, '#888'); ctx.fillStyle = '#ffd23f'; ctx.fillRect(-2, -66, 4, 16); circ(0, -68, 6, '#ffd23f');
      break;
    case 'car':
      rect(-56, -6, 112, 30, '#ffd23f', 10); rect(-30, -30, 58, 28, '#ffd23f', 10); rect(-24, -26, 22, 20, '#9fe7ff'); rect(4, -26, 20, 20, '#9fe7ff');
      circ(-32, 26, 15, '#222'); circ(32, 26, 15, '#222'); circ(-32, 26, 6, '#bbb'); circ(32, 26, 6, '#bbb');
      ctx.fillStyle = '#e8352b'; ctx.fillRect(-56, 4, 112, 6);
      break;
    case 'dino':
      ctx.beginPath(); ctx.ellipse(0, 10, 44, 28, 0, 0, 7); fill('#8be04a');
      ctx.beginPath(); ctx.moveTo(30, 0); ctx.quadraticCurveTo(50, -40, 40, -56); ctx.lineTo(56, -56); ctx.quadraticCurveTo(64, -30, 44, 10); fill('#8be04a');
      circ(50, -58, 14, '#8be04a'); circ(54, -62, 3, '#111');
      ctx.beginPath(); ctx.moveTo(-40, 10); ctx.lineTo(-70, 26); ctx.lineTo(-36, 24); fill('#8be04a');
      rect(-26, 30, 12, 20, '#6cbf32'); rect(14, 30, 12, 20, '#6cbf32');
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-26 + k * 16, -14); ctx.lineTo(-18 + k * 16, -30); ctx.lineTo(-10 + k * 16, -14); fill('#ff8a1c'); }
      break;
    case 'rocket':
      ctx.beginPath(); ctx.moveTo(0, -64); ctx.quadraticCurveTo(26, -30, 22, 30); ctx.lineTo(-22, 30); ctx.quadraticCurveTo(-26, -30, 0, -64); fill('#f4f1ea');
      circ(0, -18, 10, '#39e6ff');
      ctx.beginPath(); ctx.moveTo(-22, 8); ctx.lineTo(-40, 40); ctx.lineTo(-20, 32); fill('#e8352b');
      ctx.beginPath(); ctx.moveTo(22, 8); ctx.lineTo(40, 40); ctx.lineTo(20, 32); fill('#e8352b');
      ctx.beginPath(); ctx.moveTo(-14, 32); ctx.lineTo(0, 66); ctx.lineTo(14, 32); fill('#ffd23f');
      for (let k = 0; k < 6; k++) circ(-60 + k * 24, -50 + (k % 2) * 90, 3, '#fff');
      break;
    case 'bear':
      circ(0, 18, 34, '#a8703c'); circ(0, -26, 26, '#a8703c'); circ(-22, -46, 10, '#a8703c'); circ(22, -46, 10, '#a8703c');
      circ(0, -18, 10, '#e8c79a'); circ(-9, -32, 3.5, '#111'); circ(9, -32, 3.5, '#111'); circ(0, -21, 4, '#111');
      circ(0, 22, 16, '#e8c79a'); ctx.beginPath(); ctx.moveTo(-12, -2); ctx.lineTo(12, -2); ctx.lineTo(0, 4); fill('#e8352b');
      break;
    case 'train':
      rect(-60, -20, 64, 40, '#e8352b'); rect(4, -40, 42, 60, '#1e6fd9'); rect(12, -34, 26, 18, '#9fe7ff'); rect(-48, -44, 14, 26, '#222');
      circ(-40, 28, 12, '#222'); circ(-10, 28, 12, '#222'); circ(28, 28, 12, '#222');
      break;
    case 'pony':
      ctx.beginPath(); ctx.ellipse(0, 6, 40, 24, 0, 0, 7); fill('#f6d4ec');
      ctx.beginPath(); ctx.moveTo(24, -4); ctx.lineTo(40, -44); ctx.lineTo(60, -36); ctx.lineTo(44, 4); fill('#f6d4ec');
      ctx.beginPath(); ctx.ellipse(54, -40, 18, 11, -0.4, 0, 7); fill('#f6d4ec'); circ(56, -44, 3, '#111');
      for (let k = 0; k < 4; k++) rect(-30 + k * 18, 22, 9, 30, '#f6d4ec');
      ctx.beginPath(); ctx.moveTo(30, -40); ctx.quadraticCurveTo(10, -50, 18, -10); ctx.lineTo(28, -12); fill('#c04bd8');
      ctx.beginPath(); ctx.moveTo(-38, 0); ctx.quadraticCurveTo(-64, 10, -56, 40); ctx.lineTo(-40, 12); fill('#39b6ff');
      break;
    case 'top':
      ctx.beginPath(); ctx.moveTo(-50, -10); ctx.lineTo(50, -10); ctx.lineTo(0, 50); fill('#ffd23f');
      ctx.beginPath(); ctx.ellipse(0, -12, 50, 14, 0, 0, 7); fill('#e8352b');
      ctx.beginPath(); ctx.moveTo(-34, 8); ctx.lineTo(34, 8); ctx.lineTo(24, 20); ctx.lineTo(-24, 20); fill('#1e6fd9');
      rect(-5, -50, 10, 40, '#888');
      break;
    case 'blocks':
      rect(-50, 0, 44, 44, '#e8352b'); rect(4, 0, 44, 44, '#1e6fd9'); rect(-24, -46, 44, 44, '#ffd23f');
      ctx.fillStyle = '#fff'; ctx.font = `900 34px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('A', -28, 23); ctx.fillText('B', 26, 23); ctx.fillText('C', -2, -23);
      break;
    case 'plane':
      rect(-60, -8, 120, 18, '#e8352b', 9); ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(10, 0); ctx.lineTo(-6, 48); ctx.lineTo(-22, 48); fill('#ffd23f');
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(10, 0); ctx.lineTo(-6, -48); ctx.lineTo(-22, -48); fill('#ffd23f');
      ctx.beginPath(); ctx.moveTo(-60, -6); ctx.lineTo(-72, -30); ctx.lineTo(-52, -6); fill('#1e6fd9'); circ(44, 0, 7, '#9fe7ff');
      break;
    case 'boat':
      ctx.beginPath(); ctx.moveTo(-60, 10); ctx.lineTo(60, 10); ctx.lineTo(44, 36); ctx.lineTo(-44, 36); fill('#e8352b');
      ctx.fillStyle = '#ddd'; ctx.fillRect(-2, -56, 4, 66);
      ctx.beginPath(); ctx.moveTo(4, -52); ctx.lineTo(44, 4); ctx.lineTo(4, 4); fill('#fff');
      ctx.beginPath(); ctx.moveTo(-4, -40); ctx.lineTo(-36, 4); ctx.lineTo(-4, 4); fill('#ffd23f');
      ctx.strokeStyle = '#9fe7ff'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-70, 46); ctx.quadraticCurveTo(-35, 36, 0, 46); ctx.quadraticCurveTo(35, 56, 70, 46); ctx.stroke();
      break;
    case 'monster':
      circ(0, 0, 46, '#8be04a'); circ(-16, -12, 14, '#fff'); circ(16, -12, 14, '#fff'); circ(-14, -10, 6, '#111'); circ(18, -10, 6, '#111');
      ctx.beginPath(); ctx.arc(0, 14, 22, 0.1, Math.PI - 0.1); fill('#5a1470');
      ctx.beginPath(); ctx.moveTo(-36, -30); ctx.lineTo(-44, -60); ctx.lineTo(-22, -40); fill('#ffd23f');
      ctx.beginPath(); ctx.moveTo(36, -30); ctx.lineTo(44, -60); ctx.lineTo(22, -40); fill('#ffd23f');
      break;
  }
  ctx.restore();
}

// 4×4 atlas à 256 px: 12 framsidor + 4 neutrala sidor/lock
function boxAtlas() {
  return cached('boxAtlas', () => {
    const S = 1024, Q = 256;
    const [c, ctx] = canvas(S);
    TOYS.forEach((toy, i) => {
      const x = (i % 4) * Q, y = Math.floor(i / 4) * Q;
      const g = ctx.createLinearGradient(x, y, x, y + Q);
      g.addColorStop(0, toy.bg[0]); g.addColorStop(1, toy.bg[1]);
      ctx.fillStyle = g; ctx.fillRect(x, y, Q, Q);
      // Strålar bakom leksaken
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, Q, Q); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(x + Q / 2, y + 140);
        ctx.lineTo(x + Q / 2 + Math.cos(a) * 300, y + 140 + Math.sin(a) * 300);
        ctx.lineTo(x + Q / 2 + Math.cos(a + 0.22) * 300, y + 140 + Math.sin(a + 0.22) * 300); ctx.fill();
      }
      ctx.restore();
      // Fönster med leksaken
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; roundRect(ctx, x + 22, y + 62, Q - 44, 150, 16); ctx.fill();
      drawToy(ctx, toy.draw, x + Q / 2, y + 140, 120);
      // Namnbanderoll
      ctx.fillStyle = '#ffffff'; roundRect(ctx, x + 10, y + 10, Q - 20, 44, 10); ctx.fill();
      ctx.fillStyle = toy.bg[1]; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      fitText(ctx, toy.name, x + Q / 2, y + 33, Q - 34, 30);
      // Märke och ålder
      ctx.fillStyle = '#d8241c'; roundRect(ctx, x + 10, y + Q - 38, 92, 28, 8); ctx.fill();
      ctx.fillStyle = '#fff'; fitText(ctx, 'TORQUE', x + 56, y + Q - 24, 84, 18);
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(x + Q - 30, y + Q - 26, 18, 0, 7); ctx.fill();
      ctx.fillStyle = '#222'; fitText(ctx, '3+', x + Q - 30, y + Q - 25, 30, 18);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 4; ctx.strokeRect(x + 2, y + 2, Q - 4, Q - 4);
    });
    // Neutrala sidor: vit kartong med randkant och liten logga (tonas med vertexfärg)
    for (let i = 12; i < 16; i++) {
      const x = (i % 4) * Q, y = Math.floor(i / 4) * Q;
      ctx.fillStyle = '#f2f0ea'; ctx.fillRect(x, y, Q, Q);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      if (i === 12) for (let k = 0; k < 8; k++) ctx.fillRect(x + k * 32, y, 16, Q);
      if (i === 13) for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(x + 40 + (k % 3) * 88, y + 70 + Math.floor(k / 3) * 120, 26, 0, 7); ctx.fill(); }
      if (i === 14) { ctx.fillRect(x, y + 40, Q, 24); ctx.fillRect(x, y + Q - 64, Q, 24); }
      if (i === 15) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `900 54px ${FONT}`; ctx.fillText('★', x + Q / 2, y + Q / 2); }
    }
    return toTex(c, { repeat: false });
  });
}

/** En leksakskartong i ett lokalt system o (framsidan mot lokal +z). */
function toyBox(B, o, { w, h, d, x, y, z, art, side, ry = 0 }) {
  const g = box(w, h, d);
  const sc = 12 + (art % 4);
  atlasUV(g, [cell4(sc), cell4(sc), cell4(sc), cell4(sc), cell4(art), cell4(art)]);
  const sideCol = C(side);
  faceColors(g, [sideCol, sideCol, sideCol, sideCol, [1, 1, 1], [1, 1, 1]]);
  g.rotateY(ry);
  g.translate(x, y + h / 2, z);
  B.add('boxes', place(g, o), null);
}

// Fyller en hylla (längs lokal x från x0 till x1, djup d, fri höjd hMax) med kartonger
function fillShelf(B, o, r, { x0, x1, y, z, d, hMax }) {
  let x = x0 + 0.03;
  while (x < x1 - 0.2) {
    const w = Math.min(x1 - x - 0.02, 0.26 + r() * 0.42);
    if (w < 0.18) break;
    const h = Math.min(hMax - 0.03, 0.22 + r() * 0.45);
    const dd = Math.min(d - 0.04, 0.2 + r() * 0.3);
    const art = Math.floor(r() * TOYS.length);
    // Ibland en stapel av två platta kartonger
    if (r() < 0.25 && h > 0.3) {
      const hh = h / 2;
      toyBox(B, o, { w, h: hh, d: dd, x: x + w / 2, y, z: z + dd / 2 - d / 2 + 0.02, art, side: BOX_SIDE_COLS[art % 8], ry: (r() - 0.5) * 0.06 });
      toyBox(B, o, { w: w * 0.96, h: hh, d: dd, x: x + w / 2, y: y + hh, z: z + dd / 2 - d / 2 + 0.02, art, side: BOX_SIDE_COLS[art % 8], ry: (r() - 0.5) * 0.1 });
    } else {
      toyBox(B, o, { w, h, d: dd, x: x + w / 2, y, z: z - d / 2 + dd / 2 + (d - dd) * 0.8, art, side: BOX_SIDE_COLS[(art + 3) % 8], ry: (r() - 0.5) * 0.05 });
    }
    x += w + 0.02 + r() * 0.04;
  }
}

/**
 * Vägghylla (sektioner à 2.4 m) med kartonger. Framsidan mot lokal +z.
 * len: total längd, h: höjd, d: djup.
 */
export function addWallShelf(B, world, RAPIER, { x, z, rot = 0, len, h = 2.8, d = 0.7, levels = 5, seed = 1, trim = 0x1e6fd9 }) {
  const o = { x, z, rot };
  if (world) localBox(world, RAPIER, o, len / 2, h / 2, d / 2, 0, h / 2, 0);
  if (!B) return;
  const r = rng(seed);
  const n = Math.max(1, Math.round(len / 2.4)), sw = len / n;
  const shelfYs = Array.from({ length: levels }, (_, k) => 0.12 + k * ((h - 0.3) / levels));
  B.add('wood', place(box(len, h, 0.04, 0, h / 2, -d / 2 + 0.02), o), C(0xd8c8a8)); // bakstycke
  for (let k = 0; k <= n; k++) B.add('wood', place(box(0.05, h, d, -len / 2 + k * sw, h / 2, 0), o), C(0xf0e6d0));
  for (const y of shelfYs) {
    B.add('wood', place(box(len, 0.035, d, 0, y - 0.018, 0), o), C(0xf0e6d0));
    B.add('plastic', place(box(len, 0.06, 0.02, 0, y - 0.03, d / 2), o), C(trim)); // prislist
  }
  B.add('plastic', place(box(len + 0.06, 0.3, d + 0.04, 0, h + 0.15, 0.02), o), C(trim)); // krön
  for (let k = 0; k < n; k++) {
    for (let s = 0; s < levels; s++) {
      const y = shelfYs[s], top = s + 1 < levels ? shelfYs[s + 1] - 0.04 : h - 0.05;
      if (r() < 0.06) continue; // en tom hyllplats här och där
      fillShelf(B, o, r, { x0: -len / 2 + k * sw + 0.03, x1: -len / 2 + (k + 1) * sw - 0.03, y, z: 0, d, hMax: top - y });
    }
  }
}

/** Fristående gondol (dubbelsidig hylla) längs lokal x. */
export function addGondola(B, world, RAPIER, { x, z, rot = 0, len, h = 1.7, seed = 1, trim = 0xe8352b, header }) {
  const o = { x, z, rot };
  const d = 1.1;
  if (world) localBox(world, RAPIER, o, len / 2 + 0.1, h / 2, d / 2, 0, h / 2, 0);
  if (!B) return;
  const r = rng(seed);
  B.add('plastic', place(box(len, 0.12, d, 0, 0.06, 0), o), C(0x2a2d36)); // sockel
  B.add('matte', place(box(len, h, 0.05, 0, h / 2, 0), o), C(0xe8e4dc)); // mittvägg
  for (const sx of [-1, 1]) B.add('plastic', place(box(0.06, h + 0.05, d, sx * len / 2, (h + 0.05) / 2, 0), o), C(trim));
  const ys = [0.14, 0.56, 0.98, 1.38];
  for (const side of [1, -1]) {
    const so = { x, z, rot: rot + (side < 0 ? Math.PI : 0) };
    for (let k = 0; k < ys.length; k++) {
      const y = ys[k];
      B.add('matte', place(box(len, 0.03, d / 2 - 0.03, 0, y - 0.015, d / 4 + 0.01), so), C(0xf2f0ea));
      B.add('plastic', place(box(len, 0.05, 0.02, 0, y - 0.025, d / 2 - 0.01), so), C(trim));
      const top = k + 1 < ys.length ? ys[k + 1] - 0.04 : h - 0.02;
      fillShelf(B, so, r, { x0: -len / 2 + 0.05, x1: len / 2 - 0.05, y, z: d / 4 + 0.02, d: d / 2 - 0.06, hMax: Math.min(0.6, top - y) });
    }
  }
  if (header != null) addSign(B, { x, y: h + 0.45, z, rot, w: 2.6, h: 0.42, strip: header, post: true });
}

// ===========================================================================
// Skyltar: atlas med 8 remsor (1024 × 128)
// ===========================================================================

export const SIGN = { store: 0, brand: 1, cars: 2, plush: 3, blocks: 4, trains: 5, start: 6, sale: 7 };

function signAtlas() {
  return cached('signAtlas', () => {
    const [c, ctx] = canvas(1024, 1024);
    const strip = (k, bg, fg, text, { border = '#ffffff', glow = null, font = 84 } = {}) => {
      const y = k * 128;
      ctx.fillStyle = bg; ctx.fillRect(0, y, 1024, 128);
      ctx.strokeStyle = border; ctx.lineWidth = 8; roundRect(ctx, 8, y + 8, 1008, 112, 20); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 26; }
      ctx.fillStyle = fg; fitText(ctx, text, 512, y + 66, 920, font);
      ctx.shadowBlur = 0;
    };
    strip(0, '#140a24', '#ff4fd8', 'LEKSAKSLANDET', { border: '#39e6ff', glow: '#ff4fd8', font: 96 });
    strip(1, '#d8241c', '#ffffff', '⚡ TOYTORQUE ⚡', { border: '#ffd23f' });
    strip(2, '#1e6fd9', '#ffd23f', 'BILAR & BANOR');
    strip(3, '#e86aa8', '#ffffff', 'GOSEDJUR');
    strip(4, '#3fbf4a', '#ffffff', 'BYGG & KLOSSAR');
    strip(5, '#ffd23f', '#1b1f4a', 'TÅG & RÄLS', { border: '#1b1f4a' });
    // Start/mål: rutigt
    {
      const y = 6 * 128;
      for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { ctx.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; ctx.fillRect(i * 32, y + j * 32, 32, 32); }
      ctx.fillStyle = '#d8241c'; roundRect(ctx, 240, y + 14, 544, 100, 18); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; fitText(ctx, 'START ★ MÅL', 512, y + 66, 500, 76);
    }
    strip(7, '#ffd23f', '#d8241c', 'REA  –50%  PÅ ALLT SOM RULLAR', { border: '#d8241c', font: 70 });
    return toTex(c, { repeat: false });
  });
}

/** Skylt (dubbelsidig) med remsa strip ur atlasen. post: hänger i trådar/står på stolpe. */
export function addSign(B, { x, y, z, rot = 0, w, h, strip, wires = 0, post = false, frame = 0x20232c }) {
  if (!B) return;
  const o = { x, z, rot };
  const v0 = 1 - (strip + 1) / 8 + 0.002, v1 = 1 - strip / 8 - 0.002;
  for (const side of [1, -1]) {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), v0 + uv.getY(i) * (v1 - v0));
    if (side < 0) g.rotateY(Math.PI);
    g.translate(0, y, side * 0.031);
    B.add('signs', place(g, o));
  }
  B.add('plastic', place(box(w + 0.08, h + 0.08, 0.06, 0, y, 0), o), C(frame));
  if (wires) for (const sx of [-1, 1]) B.add('metal', place(box(0.015, wires, 0.015, sx * w * 0.4, y + h / 2 + wires / 2, 0), o), C(0x9aa0a8));
  if (post) B.add('metal', place(box(0.04, y - h / 2, 0.04, 0, (y - h / 2) / 2, 0), o), C(0x9aa0a8));
}

// ===========================================================================
// Jätteklossar med bokstäver och siffror
// ===========================================================================

const BLOCK_COLS = ['#e8352b', '#1e6fd9', '#3fbf4a', '#ffd23f', '#ff8a1c', '#9440c8', '#18a7b5', '#e86aa8'];
export const GLYPHS = 'LEKSAV123R4OT★♥!';

function blockAtlas() {
  return cached('blockAtlas', () => {
    const [c, ctx] = canvas(1024);
    for (let i = 0; i < 16; i++) {
      const x = (i % 4) * 256, y = Math.floor(i / 4) * 256;
      const bg = BLOCK_COLS[i % 8], fg = BLOCK_COLS[(i * 3 + 3) % 8];
      ctx.fillStyle = '#f2e3c4'; ctx.fillRect(x, y, 256, 256); // trä i kanten
      ctx.fillStyle = bg; roundRect(ctx, x + 18, y + 18, 220, 220, 18); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 6; roundRect(ctx, x + 30, y + 30, 196, 196, 14); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `900 170px ${FONT}`;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillText(GLYPHS[i], x + 134, y + 144);
      ctx.fillStyle = fg === bg ? '#ffffff' : fg; ctx.fillText(GLYPHS[i], x + 128, y + 138);
      ctx.fillStyle = 'rgba(255,255,255,0.0)';
    }
    return toTex(c, { repeat: false });
  });
}

/**
 * Mur av staplade jätteklossar längs lokal x. text: valfri sträng av GLYPHS
 * för översta raden (läses från framsidan, lokal +z).
 */
export function addBlockWall(B, world, RAPIER, { x, z, rot = 0, cols = 4, rows = 2, s = 0.9, seed = 1, text = null, pyramid = false }) {
  const o = { x, z, rot };
  const r = rng(seed);
  let maxH = 0;
  for (let row = 0; row < rows; row++) {
    const n = pyramid ? cols - row : cols;
    if (n <= 0) break;
    maxH = (row + 1) * s;
    for (let k = 0; k < n; k++) {
      const lx = (k - (n - 1) / 2) * s * 1.01 + (pyramid ? 0 : (row % 2) * s * 0.12), ly = row * s + s / 2;
      if (!B) continue;
      const g = box(s * 0.98, s * 0.98, s * 0.98);
      const cells = [];
      for (let f = 0; f < 6; f++) cells.push(cell4(Math.floor(r() * 16), 0.01));
      if (text && row === rows - 1 && k < text.length) {
        const gi = GLYPHS.indexOf(text[k]);
        if (gi >= 0) cells[4] = cell4(gi, 0.01);
      }
      atlasUV(g, cells);
      g.rotateY((r() - 0.5) * 0.12);
      g.translate(lx, ly, (r() - 0.5) * 0.06);
      B.add('blocks', place(g, o));
    }
  }
  if (world) localBox(world, RAPIER, o, (cols * s) / 2 + 0.05, maxH / 2, s / 2 + 0.05, 0, maxH / 2, 0);
}

/** Lös jättekloss som bilarna kan knuffa (egen mesh). */
export function addLooseBlock(scene, world, RAPIER, { x, z, s = 0.32, glyph = 0, rotY = 0, mass = 0.4 }) {
  const spawn = { x, y: s / 2 + 0.005, z };
  let body = null, mesh = null;
  if (world) {
    body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y, spawn.z).setRotation(yQuat(rotY)).setLinearDamping(0.1).setAngularDamping(0.3));
    world.createCollider(RAPIER.ColliderDesc.cuboid(s / 2, s / 2, s / 2).setDensity(0).setMass(mass).setFriction(0.6).setRestitution(0.2).setCollisionGroups(groups(G.PROP)), body);
  }
  if (scene) {
    const g = box(s, s, s);
    atlasUV(g, [0, 1, 2, 3, 4, 5].map((f) => cell4((glyph + f * 5) % 16, 0.01)));
    mesh = new THREE.Mesh(g, cached('looseBlockMat', () => new THREE.MeshStandardMaterial({ map: blockAtlas(), roughness: 0.38 })));
    mesh.position.set(spawn.x, spawn.y, spawn.z);
    mesh.rotation.y = rotY;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return { body, mesh, kind: 'block', spawn };
}

// ===========================================================================
// Nallar
// ===========================================================================

export const FUR = { brown: 0x8a5a33, honey: 0xc08a4a, pink: 0xe39ab4, white: 0xeee6d8, blue: 0x6f9fd8, grey: 0x9a948c };

/** Sittande nalle, höjd ungefär s meter. Framsidan mot lokal +z. */
export function addTeddy(B, world, RAPIER, { x, z, y = 0, rot = 0, s = 1, fur = FUR.brown, bow = 0xe8352b, collide = true }) {
  const o = { x, y, z, rot };
  if (world && collide && s > 0.5) staticBox(world, RAPIER, 0.32 * s, 0.5 * s, 0.32 * s, x, y + 0.5 * s, z, rot);
  if (!B) return;
  const F = C(fur), L = C(new THREE.Color(fur).lerp(new THREE.Color(0xfff2dc), 0.55)), D = C(0x1a120c);
  const part = (geo, t, col, key = 'plush') => {
    xf(geo, { ...t, x: (t.x ?? 0) * s, y: (t.y ?? 0) * s, z: (t.z ?? 0) * s, sx: (t.sx ?? 1) * s, sy: (t.sy ?? 1) * s, sz: (t.sz ?? 1) * s });
    B.add(key, place(geo, o), col);
  };
  part(sph(0.3, 16, 12), { y: 0.36, sy: 1.15, sz: 0.92 }, F); // kropp
  part(sph(0.18, 14, 10), { y: 0.33, z: 0.17, sz: 0.55, sy: 1.2 }, L); // mage
  part(sph(0.22, 16, 12), { y: 0.84, z: 0.03 }, F); // huvud
  for (const sx of [-1, 1]) {
    part(sph(0.085, 10, 8), { x: sx * 0.17, y: 1.01, sz: 0.55 }, F); // öron
    part(sph(0.05, 8, 6), { x: sx * 0.17, y: 1.01, z: 0.03, sz: 0.4 }, L);
    part(sph(0.1, 10, 8), { x: sx * 0.31, y: 0.45, z: 0.08, sy: 2.1, rz: sx * 0.5, rx: -0.4 }, F); // armar
    part(sph(0.125, 12, 8), { x: sx * 0.16, y: 0.13, z: 0.22, sz: 1.9 }, F); // ben
    part(sph(0.085, 10, 8), { x: sx * 0.16, y: 0.13, z: 0.44, sz: 0.3 }, L); // trampdynor
    part(sph(0.026, 8, 6), { x: sx * 0.08, y: 0.9, z: 0.2 }, D, 'plastic'); // ögon
  }
  part(sph(0.095, 12, 8), { y: 0.79, z: 0.19, sy: 0.78, sz: 0.85 }, L); // nos
  part(sph(0.036, 8, 6), { y: 0.82, z: 0.275, sx: 1.3 }, D, 'plastic'); // nostipp
  for (const sx of [-1, 1]) part(new THREE.ConeGeometry(0.07, 0.13, 8), { x: sx * 0.07, y: 0.62, z: 0.2, rz: sx * Math.PI / 2 }, C(bow), 'plastic'); // rosett
  part(sph(0.035, 8, 6), { y: 0.62, z: 0.22 }, C(bow), 'plastic');
}

// ===========================================================================
// Roboten och tunneln med grönt neon
// ===========================================================================

/** Stor leksaksrobot (≈3.2 m). Framsidan mot lokal +z. */
export function addRobot(B, world, RAPIER, { x, z, rot = 0, s = 1 }) {
  const o = { x, z, rot };
  if (world) staticBox(world, RAPIER, 0.75 * s, 1.6 * s, 0.55 * s, x, 1.6 * s, z, rot);
  if (!B) return;
  const red = C(0xd8322a), silver = C(0xc4cad2), blue = C(0x1e6fd9), dark = C(0x24262e), yel = C(0xffd23f);
  const P = (key, geo, col, t = {}) => {
    xf(geo, t);
    geo.scale(s, s, s);
    B.add(key, place(geo, o), col);
  };
  for (const sx of [-1, 1]) {
    P('plastic', box(0.42, 0.22, 0.7), blue, { x: sx * 0.32, y: 0.11, z: 0.08 }); // fötter
    P('metal', cyl(0.13, 0.15, 0.9), silver, { x: sx * 0.32, y: 0.65 });
    P('plastic', sph(0.17), dark, { x: sx * 0.32, y: 1.1 }); // knä/höft
    P('metal', cyl(0.12, 0.12, 0.3), silver, { x: sx * 0.32, y: 1.28 });
  }
  P('plastic', box(1.0, 0.28, 0.6), dark, { y: 1.45 });
  P('plastic', box(1.3, 1.1, 0.8), red, { y: 2.12 }); // bål
  P('plastic', box(0.8, 0.55, 0.06), dark, { y: 2.18, z: 0.41 }); // bröstpanel
  P('plastic', box(1.34, 0.12, 0.84), yel, { y: 1.62 }); // bälte
  for (let k = 0; k < 3; k++) P('neon', cyl(0.06, 0.06, 0.04, 12), C([0x39ff6a, 0xffd23f, 0xff3b3b][k]), { x: -0.22 + k * 0.22, y: 2.3, z: 0.45, rx: Math.PI / 2 });
  for (let k = 0; k < 4; k++) P('neon', box(0.5, 0.03, 0.02), C(0x39e6ff), { y: 2.05 - k * 0.07, z: 0.45 });
  // Armar: vänster vinkar, höger hänger
  for (const sx of [-1, 1]) {
    P('plastic', sph(0.24), blue, { x: sx * 0.8, y: 2.5 });
    const up = sx > 0;
    const ang = up ? 2.4 : 0.18;
    const ax = sx * 0.8 + sx * Math.sin(ang) * 0.42, ay = 2.5 - Math.cos(ang) * 0.42;
    P('metal', cyl(0.1, 0.1, 0.84), silver, { x: ax, y: ay, rz: sx * ang });
    const hx = sx * 0.8 + sx * Math.sin(ang) * 0.9, hy = 2.5 - Math.cos(ang) * 0.9;
    P('plastic', box(0.26, 0.26, 0.26), dark, { x: hx, y: hy, rz: sx * ang });
    for (const fz of [-0.08, 0.08]) P('plastic', box(0.06, 0.22, 0.06), yel, { x: hx + sx * Math.sin(ang) * 0.2, y: hy - Math.cos(ang) * 0.2, z: fz, rz: sx * ang });
  }
  P('metal', cyl(0.12, 0.14, 0.18), silver, { y: 2.76 });
  P('metal', box(0.84, 0.62, 0.66), silver, { y: 3.15 }); // huvud
  P('plastic', box(0.66, 0.24, 0.04), dark, { y: 3.2, z: 0.33 });
  for (const sx of [-1, 1]) {
    P('neon', cyl(0.085, 0.085, 0.04, 16), C(0x39ff6a), { x: sx * 0.17, y: 3.2, z: 0.35, rx: Math.PI / 2 }); // ögon
    P('plastic', cyl(0.12, 0.12, 0.1, 14), red, { x: sx * 0.46, y: 3.15, rz: Math.PI / 2 }); // öronbultar
  }
  for (let k = 0; k < 5; k++) P('metal', box(0.05, 0.1, 0.02), dark, { x: -0.2 + k * 0.1, y: 2.97, z: 0.335 });
  P('metal', cyl(0.025, 0.025, 0.5), silver, { y: 3.7 });
  P('neon', sph(0.09), C(0xff3b3b), { y: 3.98 });
}

// Valv (yttre form med valvöppning) som extruderad profil
function archShape(outerHalf, height, innerHalf, spring) {
  const sh = new THREE.Shape();
  sh.moveTo(-outerHalf, 0); sh.lineTo(-innerHalf, 0); sh.lineTo(-innerHalf, spring);
  sh.absarc(0, spring, innerHalf, Math.PI, 0, true);
  sh.lineTo(innerHalf, 0); sh.lineTo(outerHalf, 0); sh.lineTo(outerHalf, height); sh.lineTo(-outerHalf, height); sh.closePath();
  return sh;
}

/**
 * Tunnel/port över banan, centrerad i (x, z), riktad längs heading.
 * Leksaksborg med tinnar, torn och gröna neonbågar inuti.
 */
export function addArchTunnel(B, world, RAPIER, { x, z, heading, length = 8, innerHalf = 2.05, spring = 1.5 }) {
  const o = { x, z, rot: heading };
  const outerHalf = innerHalf + 1.5, H = spring + innerHalf + 1.1;
  if (world) for (const sx of [-1, 1]) localBox(world, RAPIER, o, (outerHalf - innerHalf + 0.6) / 2, H / 2, length / 2 + 0.3, sx * (innerHalf + (outerHalf - innerHalf + 0.6) / 2), H / 2, 0);
  if (!B) return;
  const wallC = C(0x7a44c8), trimC = C(0xffd23f), innerC = C(0x1c1430), green = C(0x39ff6a);
  // Fasader i båda ändar
  for (const ez of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(archShape(outerHalf, H, innerHalf, spring), { depth: 0.5, bevelEnabled: false, curveSegments: 20 });
    g.translate(0, 0, ez > 0 ? length / 2 - 0.5 : -length / 2);
    B.add('plastic', place(g, o), wallC);
    // Tinnar
    for (let k = -3; k <= 3; k++) B.add('plastic', place(box(0.5, 0.45, 0.6, k * (outerHalf / 3.4), H + 0.22, ez * (length / 2 - 0.25)), o), k % 2 ? trimC : wallC);
    // Neonbåge runt öppningen
    const t = new THREE.TorusGeometry(innerHalf + 0.12, 0.05, 6, 32, Math.PI);
    t.translate(0, spring, ez * (length / 2 + 0.03));
    B.add('neon', place(t, o), green);
    for (const sx of [-1, 1]) B.add('neon', place(box(0.1, spring, 0.1, sx * (innerHalf + 0.12), spring / 2, ez * (length / 2 + 0.03)), o), green);
    // Skylt över valvet
  }
  // Valvskal inuti
  const segs = 14, R = innerHalf;
  for (let k = 0; k < segs; k++) {
    const a0 = (k / segs) * Math.PI, a1 = ((k + 1) / segs) * Math.PI, am = (a0 + a1) / 2;
    const chord = 2 * (R + 0.15) * Math.sin((a1 - a0) / 2) + 0.03;
    const g = box(chord, 0.3, length - 0.9);
    g.rotateZ(am - Math.PI / 2);
    g.translate(Math.cos(am) * (R + 0.15), spring + Math.sin(am) * (R + 0.15), 0);
    B.add('matte', place(g, o), innerC);
  }
  for (const sx of [-1, 1]) {
    B.add('matte', place(box(0.3, spring, length - 0.9, sx * (innerHalf + 0.15), spring / 2, 0), o), innerC);
    // Fyllnad mellan valv och fasadens ytterkant (tak och sidor)
    B.add('plastic', place(box(outerHalf - innerHalf - 0.3, H, length - 0.9, sx * (innerHalf + 0.3 + (outerHalf - innerHalf - 0.3) / 2), H / 2, 0), o), wallC);
  }
  B.add('plastic', place(box(outerHalf * 2, H - spring - innerHalf - 0.3, length - 0.9, 0, (H + spring + innerHalf + 0.3) / 2, 0), o), wallC);
  // Gröna neonbågar inuti
  for (let zz = -length / 2 + 1.2; zz < length / 2 - 0.9; zz += 1.3) {
    const t = new THREE.TorusGeometry(R - 0.02, 0.04, 6, 28, Math.PI);
    t.translate(0, spring, zz);
    B.add('neon', place(t, o), green);
    for (const sx of [-1, 1]) B.add('neon', place(box(0.07, spring - 0.25, 0.07, sx * (R - 0.02), spring / 2 + 0.12, zz), o), green);
  }
  // Torn i hörnen
  for (const sx of [-1, 1]) for (const ez of [-1, 1]) {
    const tx = sx * (outerHalf - 0.1), tz = ez * (length / 2 - 0.4);
    B.add('plastic', place(xf(cyl(0.6, 0.6, H + 0.8, 20), { x: tx, y: (H + 0.8) / 2, z: tz }), o), C(0x1e6fd9));
    B.add('plastic', place(xf(new THREE.ConeGeometry(0.78, 1.2, 20), { x: tx, y: H + 1.4, z: tz }), o), C(0xe8352b));
    B.add('plastic', place(xf(cyl(0.65, 0.65, 0.14, 20), { x: tx, y: H + 0.8, z: tz }), o), trimC);
    B.add('neon', place(xf(new THREE.TorusGeometry(0.61, 0.03, 6, 24), { x: tx, y: H * 0.55, z: tz, rx: Math.PI / 2 }), o), green);
    B.add('plastic', place(xf(cyl(0.012, 0.012, 0.6, 5), { x: tx, y: H + 2.2, z: tz }), o), C(0x888888));
    B.add('flags', place(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(tx, H + 2.48, tz), new THREE.Vector3(tx, H + 2.24, tz), new THREE.Vector3(tx + 0.4, H + 2.36, tz),
    ]), o), C(0xffd23f));
  }
}

// ===========================================================================
// Bollar och bollhav
// ===========================================================================

function rubberMaterial(color) {
  return cached('rubber_' + color, () => {
    const tex = cached('rubberTex', () => {
      const [c, ctx] = canvas(256, 128);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = 'rgba(0,0,0,0.0)';
      ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 56, 256, 16);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(32 + k * 64, 30, 10, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(32 + k * 64, 98, 10, 0, 7); ctx.fill(); }
      return toTex(c);
    });
    return new THREE.MeshStandardMaterial({ color, map: tex, roughness: 0.35 });
  });
}

/** Studsboll i gummi som bilarna kan knuffa. */
export function addRubberBall(scene, world, RAPIER, { x, z, r = 0.22, color = 0xe8352b, mass = 0.1 }) {
  const spawn = { x, y: r + 0.005, z };
  let body = null, mesh = null;
  if (world) {
    body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y, spawn.z).setLinearDamping(0.25).setAngularDamping(0.5));
    world.createCollider(RAPIER.ColliderDesc.ball(r).setDensity(0).setMass(mass).setFriction(0.7).setRestitution(0.8).setCollisionGroups(groups(G.PROP)), body);
  }
  if (scene) {
    mesh = new THREE.Mesh(sph(r, 24, 16), rubberMaterial(color));
    mesh.position.set(spawn.x, spawn.y, spawn.z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return { body, mesh, kind: 'ball', spawn };
}

/** Bollhav: vadderad åttkantig sarg fylld med plastbollar (en instansierad mesh). */
export function addBallPit(B, scene, world, RAPIER, { x, z, R = 2.6, h = 0.55, seed = 5 }) {
  if (world) {
    const body = fixedBody(world, RAPIER, x, h / 2, z);
    world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, R + 0.2).setFriction(0.6).setCollisionGroups(groups(G.WORLD)), body);
  }
  if (!B) return;
  const sides = 8;
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2 + Math.PI / 8;
    const len = 2 * (R + 0.15) * Math.tan(Math.PI / sides) + 0.02;
    const g = box(len, h, 0.3, 0, h / 2, 0);
    g.translate(0, 0, R + 0.15);
    g.rotateY(a);
    g.translate(x, 0, z);
    B.add('plastic', g, C([0xe8352b, 0x1e6fd9, 0xffd23f, 0x3fbf4a][k % 4]));
    const t = box(len, 0.08, 0.36, 0, h + 0.04, 0);
    t.translate(0, 0, R + 0.15);
    t.rotateY(a);
    t.translate(x, 0, z);
    B.add('plastic', t, C(0xf4f1ea));
  }
  const r = rng(seed);
  const balls = [];
  const br = 0.11;
  for (let k = 0; k < 420; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (R - 0.12);
    const y = br + (h - br) * (0.5 + 0.5 * r()) + (1 - d / R) * 0.2;
    balls.push([x + Math.cos(a) * d, y, z + Math.sin(a) * d]);
  }
  const inst = new THREE.InstancedMesh(sph(br, 10, 8), cached('pitBallMat', () => new THREE.MeshStandardMaterial({ roughness: 0.25 })), balls.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const cols = [0xe8352b, 0x1e6fd9, 0xffd23f, 0x3fbf4a, 0xff8a1c, 0xe86aa8, 0x9440c8];
  balls.forEach((p, i) => {
    inst.setMatrixAt(i, m.makeTranslation(p[0], p[1], p[2]));
    inst.setColorAt(i, col.set(cols[Math.floor(r() * cols.length)]));
  });
  inst.castShadow = false;
  inst.receiveShadow = true;
  scene.add(inst);
}

// ===========================================================================
// Tågbana med ett tåg som går runt
// ===========================================================================

/** Stadionformad tågbana längs lokal x: raka delar ls, radie R. Tåget animeras. */
export function addTrainLoop(B, scene, { x, z, rot = 0, ls = 14, R = 2.4, speed = 1.6 }) {
  if (!B) return;
  const o = { x, z, rot };
  const P = 2 * ls + 2 * Math.PI * R;
  const pose = (s) => {
    s = ((s % P) + P) % P;
    if (s < ls) return { x: -ls / 2 + s, z: R, h: Math.PI / 2 };
    s -= ls;
    if (s < Math.PI * R) { const a = s / R; return { x: ls / 2 + Math.sin(a) * R, z: Math.cos(a) * R, h: Math.PI / 2 + a }; }
    s -= Math.PI * R;
    if (s < ls) return { x: ls / 2 - s, z: -R, h: -Math.PI / 2 };
    s -= ls;
    const a = s / R;
    return { x: -ls / 2 - Math.sin(a) * R, z: -Math.cos(a) * R, h: -Math.PI / 2 + a };
  };
  // Räls och syllar
  const gauge = 0.36, step = 0.25;
  const sleepers = [];
  for (let s = 0; s < P; s += step) {
    const a = pose(s), b = pose(s + step);
    sleepers.push(a);
    for (const side of [-1, 1]) {
      const nx = Math.cos(a.h) * side * gauge / 2, nz = -Math.sin(a.h) * side * gauge / 2;
      const nbx = Math.cos(b.h) * side * gauge / 2, nbz = -Math.sin(b.h) * side * gauge / 2;
      const ax = a.x + nx, az = a.z + nz, bx = b.x + nbx, bz = b.z + nbz;
      const len = Math.hypot(bx - ax, bz - az) + 0.01;
      const g = box(0.03, 0.04, len, 0, 0.07, 0);
      g.rotateY(Math.atan2(bx - ax, bz - az));
      g.translate((ax + bx) / 2, 0, (az + bz) / 2);
      B.add('metal', place(g, o), C(0xb8bcc4));
    }
  }
  const inst = new THREE.InstancedMesh(box(0.56, 0.05, 0.1, 0, 0.025, 0), cached('sleeperMat', () => new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.8 })), sleepers.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3();
  sleepers.forEach((a, i) => {
    const wx = o.x + a.x * Math.cos(rot) + a.z * Math.sin(rot), wz = o.z - a.x * Math.sin(rot) + a.z * Math.cos(rot);
    inst.setMatrixAt(i, m.compose(p.set(wx, 0, wz), q.setFromAxisAngle(up, a.h + rot), one));
  });
  inst.receiveShadow = true;
  scene.add(inst);

  // Tåget: lok och tre vagnar, egna meshar som flyttas före varje rendering
  const mat = cached('trainMat', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3 }));
  const cars = [];
  const part = (list, geo, col, t) => { xf(geo, t); const n = geo.index ? geo.toNonIndexed() : geo; n.deleteAttribute('uv'); const arr = new Float32Array(n.attributes.position.count * 3); for (let i = 0; i < arr.length; i += 3) arr.set(col, i); n.setAttribute('color', new THREE.BufferAttribute(arr, 3)); list.push(n); };
  const wheels = (list, len, col) => {
    for (const wz of [-len * 0.32, len * 0.32]) for (const sx of [-1, 1]) {
      part(list, cyl(0.1, 0.1, 0.05, 14), C(0x1a1a1a), { x: sx * 0.2, y: 0.18, z: wz, rz: Math.PI / 2 });
      part(list, cyl(0.05, 0.05, 0.06, 10), col, { x: sx * 0.21, y: 0.18, z: wz, rz: Math.PI / 2 });
    }
  };
  { // Lok
    const L = [];
    part(L, box(0.5, 0.12, 1.3), C(0x24262e), { y: 0.24 });
    part(L, cyl(0.22, 0.22, 0.8, 18), C(0xe8352b), { y: 0.5, z: 0.18, rx: Math.PI / 2 });
    part(L, cyl(0.23, 0.23, 0.05, 18), C(0xffd23f), { y: 0.5, z: 0.4, rx: Math.PI / 2 });
    part(L, cyl(0.16, 0.16, 0.04, 18), C(0x24262e), { y: 0.5, z: 0.59, rx: Math.PI / 2 });
    part(L, cyl(0.07, 0.1, 0.3, 12), C(0x24262e), { y: 0.84, z: 0.42 });
    part(L, box(0.52, 0.56, 0.42), C(0x1e6fd9), { y: 0.58, z: -0.38 });
    part(L, box(0.6, 0.06, 0.52), C(0xe8352b), { y: 0.89, z: -0.38 });
    part(L, box(0.53, 0.18, 0.2), C(0x9fe7ff), { y: 0.66, z: -0.38 });
    part(L, sph(0.06, 10, 8), C(0xfff2a0), { y: 0.62, z: 0.62 });
    wheels(L, 1.3, C(0xffd23f));
    cars.push({ geos: L, len: 1.35 });
  }
  for (const [c1, c2] of [[0xffd23f, 0x3fbf4a], [0x3fbf4a, 0xe8352b], [0x1e6fd9, 0xffd23f]]) {
    const L = [];
    part(L, box(0.48, 0.1, 0.95), C(0x24262e), { y: 0.24 });
    part(L, box(0.5, 0.32, 0.9), C(c1), { y: 0.45 });
    part(L, box(0.52, 0.05, 0.92), C(c2), { y: 0.63 });
    for (let k = 0; k < 3; k++) part(L, box(0.18, 0.18, 0.18), C([0xe8352b, 0x1e6fd9, 0xff8a1c][k]), { x: (k - 1) * 0.0, y: 0.74, z: (k - 1) * 0.26, ry: k * 0.4 });
    wheels(L, 0.95, C(c2));
    cars.push({ geos: L, len: 1.0 });
  }
  let off = 0;
  const meshes = cars.map((cdef) => {
    const mesh = new THREE.Mesh(mergeGeometries(cdef.geos), mat);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.off = off;
    off -= cdef.len / 2 + 0.12 + (cars[cars.indexOf(cdef) + 1]?.len ?? 0) / 2;
    scene.add(mesh);
    return mesh;
  });
  const c = Math.cos(rot), sn = Math.sin(rot);
  const t0 = performance.now();
  for (const mesh of meshes) {
    mesh.onBeforeRender = () => {
      const s = ((performance.now() - t0) / 1000) * speed + mesh.userData.off + 1000 * P;
      const a = pose(s);
      mesh.position.set(o.x + a.x * c + a.z * sn, 0, o.z - a.x * sn + a.z * c);
      mesh.rotation.y = a.h + rot;
      mesh.updateMatrixWorld();
    };
    mesh.onBeforeRender();
  }
}

// ===========================================================================
// Bilbana i en monter
// ===========================================================================

function raceTopTex() {
  return cached('raceTopTex', () => {
    const [c, ctx] = canvas(512, 320);
    ctx.fillStyle = '#2f8f3a'; ctx.fillRect(0, 0, 512, 320);
    const lane = (w, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(110, 60); ctx.lineTo(300, 60);
      ctx.bezierCurveTo(470, 60, 470, 260, 300, 260); ctx.lineTo(210, 260);
      ctx.bezierCurveTo(140, 260, 160, 160, 110, 160);
      ctx.bezierCurveTo(30, 160, 30, 60, 110, 60);
      ctx.stroke();
    };
    lane(64, '#e8e8e8'); lane(56, '#3a3d45'); lane(2, '#c8c8c8');
    ctx.strokeStyle = '#ffd23f'; ctx.setLineDash([10, 10]); lane(1.5, '#ffd23f'); ctx.setLineDash([]);
    for (let k = 0; k < 8; k++) { ctx.fillStyle = k % 2 ? '#111' : '#fff'; ctx.fillRect(240, 32 + k * 7, 8, 7); }
    ctx.fillStyle = '#d8241c'; ctx.fillRect(0, 0, 512, 10); ctx.fillRect(0, 310, 512, 10);
    return toTex(c, { repeat: false });
  });
}

/** Monterbord med en bilbana, två små bilar och en kartong. */
export function addRacingSet(B, world, RAPIER, { x, z, rot = 0 }) {
  const o = { x, z, rot };
  const W = 3.4, D = 2.1, H = 0.8;
  if (world) localBox(world, RAPIER, o, W / 2 + 0.05, H / 2, D / 2 + 0.05, 0, H / 2, 0);
  if (!B) return;
  B.add('plastic', place(box(W, 0.08, D, 0, H - 0.04, 0), o), C(0x1b1f4a));
  B.add('plastic', place(box(W - 0.2, H - 0.08, D - 0.2, 0, (H - 0.08) / 2, 0), o), C(0x2a2f66));
  for (const sx of [-1, 1]) B.add('neon', place(box(0.03, 0.03, D - 0.2, sx * (W / 2 - 0.1), 0.05, 0), o), C(0x39e6ff));
  const top = new THREE.PlaneGeometry(W - 0.1, D - 0.1);
  top.rotateX(-Math.PI / 2);
  top.translate(0, H + 0.002, 0);
  B.add('racetop', place(top, o));
  // Små bilar på banan
  for (const [cx, cz, col, ry] of [[0.1, -0.68, 0xe8352b, Math.PI / 2], [-0.3, -0.58, 0x1e6fd9, Math.PI / 2]]) {
    B.add('plastic', place(xf(box(0.08, 0.04, 0.18), { x: cx, y: H + 0.03, z: cz, ry }), o), C(col));
  }
  // Kartong och skylt
  const pk = { x, z, rot };
  toyBox(B, pk, { w: 0.9, h: 0.6, d: 0.2, x: W / 2 - 0.6, y: H, z: D / 2 - 0.25, art: 1, side: 0xe8352b, ry: -0.2 });
  addSign(B, { x: x - Math.sin(rot) * 0, y: H + 1.5, z, rot, w: 2.6, h: 0.42, strip: SIGN.cars, post: true });
}

// ===========================================================================
// Vimplar: flaggspel i snören tvärs över hallen
// ===========================================================================

const FLAG_COLS = [0xe8352b, 0xffd23f, 0x1e6fd9, 0x3fbf4a, 0xff8a1c, 0xe86aa8, 0x9440c8];

export function addBunting(B, spans) {
  if (!B) return;
  let ci = 0;
  for (const { a, b, sag = 0.8 } of spans) {
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(2, Math.floor(len / 0.5));
    const at = (u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - Math.sin(u * Math.PI) * sag, a[2] + (b[2] - a[2]) * u];
    const pos = [], col = [];
    for (let k = 0; k < n; k++) {
      const u0 = (k + 0.1) / n, u1 = (k + 0.9) / n, um = (k + 0.5) / n;
      const p0 = at(u0), p1 = at(u1), pm = at(um);
      const c = C(FLAG_COLS[ci++ % FLAG_COLS.length]);
      pos.push(...p0, ...p1, pm[0], pm[1] - 0.42, pm[2]);
      col.push(...c, ...c, ...c);
      // Snöret
      const q0 = at(k / n), q1 = at((k + 1) / n);
      const sl = Math.hypot(q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]);
      const g = box(0.012, 0.012, sl);
      g.lookAt(new THREE.Vector3(q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]));
      g.translate((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2, (q0[2] + q1[2]) / 2);
      B.add('matte', g, C(0xf4f1ea));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    B.add('flags', g, null);
  }
}

// ===========================================================================
// Neon och montrar
// ===========================================================================

/** Neonrör mellan två punkter. */
export function addNeonTube(B, a, b, color, r = 0.035) {
  if (!B) return;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = box(r * 2, r * 2, len);
  g.lookAt(new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  B.add('neon', g, C(color));
}

/** Rund monterpodie med färgad kant. */
export function addPodium(B, world, RAPIER, { x, z, r = 1.0, h = 0.4, color = 0x1e6fd9, neon = 0xff4fd8 }) {
  if (world) {
    const body = fixedBody(world, RAPIER, x, h / 2, z);
    world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, r).setFriction(0.6).setCollisionGroups(groups(G.WORLD)), body);
  }
  if (!B) return;
  B.add('plastic', xf(cyl(r, r, h, 32), { x, y: h / 2, z }), C(color));
  B.add('plastic', xf(cyl(r * 0.96, r * 0.96, 0.04, 32), { x, y: h + 0.02, z }), C(0xf4f1ea));
  B.add('neon', xf(new THREE.TorusGeometry(r + 0.01, 0.025, 6, 40), { x, y: 0.06, z, rx: Math.PI / 2 }), C(neon));
}

/** Liten raket på en podie (dekor). */
export function addToyRocket(B, { x, z, y = 0, s = 1 }) {
  if (!B) return;
  const P = (key, geo, col, t) => { xf(geo, t); geo.scale(s, s, s); geo.translate(x, y, z); B.add(key, geo, col); };
  P('plastic', cyl(0.3, 0.34, 1.6, 20), C(0xf4f1ea), { y: 0.95 });
  P('plastic', new THREE.ConeGeometry(0.3, 0.7, 20), C(0xe8352b), { y: 2.1 });
  P('plastic', cyl(0.12, 0.12, 0.05, 16), C(0x39e6ff), { y: 1.3, z: 0.31, rx: Math.PI / 2 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    P('plastic', box(0.05, 0.6, 0.45), C(0xe8352b), { x: Math.sin(a) * 0.42, y: 0.4, z: Math.cos(a) * 0.42, ry: a });
  }
  P('neon', new THREE.ConeGeometry(0.2, 0.35, 12), C(0xffb020), { y: 0.0, rx: Math.PI });
}

/** Portal över banan: två stolpar och en banderoll (remsa strip). base: vägens höjd. */
export function addStartGate(B, world, RAPIER, { x, z, heading, half, strip = SIGN.start, base = 0, post = 0x1e6fd9, neon = 0xff4fd8 }) {
  const o = { x, z, rot: heading };
  const H = base + 2.9;
  if (world) for (const sx of [-1, 1]) localBox(world, RAPIER, o, 0.14, H / 2, 0.14, sx * half, H / 2, 0);
  if (!B) return;
  for (const sx of [-1, 1]) {
    B.add('plastic', place(xf(cyl(0.12, 0.14, H, 16), { x: sx * half, y: H / 2 }), o), C(post));
    B.add('plastic', place(xf(sph(0.2), { x: sx * half, y: H + 0.1 }), o), C(0xffd23f));
    B.add('neon', place(box(0.03, H - 0.6, 0.03, sx * (half - 0.13), H / 2, 0), o), C(neon));
  }
  addSign(B, { x, y: H - 0.35, z, rot: heading, w: half * 2 - 0.25, h: 0.5, strip });
}

// ===========================================================================
// Rak tågräls (syllar och skenor) och ett uppdragbart lok som står parkerat.
// Rälsen ligger tvärs under genvägens hopp.
// ===========================================================================

export function addRailStraight(B, { x, z, rot = 0, len = 8, gauge = 0.36 }) {
  if (!B) return;
  const o = { x, z, rot };
  for (let u = -len / 2; u <= len / 2 + 1e-6; u += 0.25) B.add('wood', place(box(gauge + 0.22, 0.03, 0.09, 0, 0.015, u), o), C(0x6a4a2c));
  for (const side of [-1, 1]) {
    B.add('metal', place(box(0.035, 0.045, len + 0.1, side * gauge / 2, 0.055, 0), o), C(0xb8bcc4));
  }
  // Prellbockar i ändarna
  for (const e of [-1, 1]) {
    B.add('plastic', place(box(gauge + 0.3, 0.22, 0.12, 0, 0.14, e * (len / 2 + 0.12)), o), C(0xe8352b));
    B.add('plastic', place(box(gauge + 0.36, 0.06, 0.14, 0, 0.27, e * (len / 2 + 0.12)), o), C(0xffd23f));
  }
}

export function addWindupLoco(B, world, RAPIER, { x, z, rot = 0, s = 1 }) {
  const o = { x, z, rot };
  if (world) localBox(world, RAPIER, o, 0.32 * s, 0.4 * s, 0.75 * s, 0, 0.4 * s, 0);
  if (!B) return;
  const P = (key, geo, col, t = {}) => { xf(geo, t); geo.scale(s, s, s); B.add(key, place(geo, o), col); };
  // Panna, hytt, skorsten och kofångare (lokalt längs z, nosen mot +z)
  P('plastic', cyl(0.26, 0.26, 0.85, 22), C(0x1e6fd9), { y: 0.42, z: 0.2, rx: Math.PI / 2 });
  P('plastic', cyl(0.27, 0.27, 0.06, 22), C(0xffd23f), { y: 0.42, z: 0.62, rx: Math.PI / 2 });
  P('plastic', box(0.58, 0.62, 0.5), C(0xe8352b), { y: 0.47, z: -0.42 });
  P('plastic', box(0.66, 0.06, 0.6), C(0x222222), { y: 0.81, z: -0.42 });
  P('plastic', cyl(0.08, 0.12, 0.32, 14), C(0x222222), { y: 0.8, z: 0.45 });
  P('plastic', box(0.6, 0.12, 1.5), C(0x222222), { y: 0.14, z: 0 });
  P('plastic', new THREE.ConeGeometry(0.2, 0.25, 4), C(0xffd23f), { y: 0.16, z: 0.82, rx: Math.PI / 2 });
  for (const sx of [-1, 1]) for (const wz of [-0.45, 0, 0.45]) {
    P('plastic', cyl(0.14, 0.14, 0.06, 18), C(0xe8352b), { x: sx * 0.31, y: 0.14, z: wz, rz: Math.PI / 2 });
    P('metal', cyl(0.04, 0.04, 0.07, 10), C(0xd8dce4), { x: sx * 0.34, y: 0.14, z: wz, rz: Math.PI / 2 });
  }
  // Fönster i hytten och en uppdragsnyckel på sidan
  for (const sx of [-1, 1]) P('plastic', box(0.02, 0.2, 0.26), C(0xbfe8ff), { x: sx * 0.3, y: 0.58, z: -0.42 });
  P('metal', cyl(0.025, 0.025, 0.25, 8), C(0xd8b23a), { x: 0.42, y: 0.5, z: -0.42, rz: Math.PI / 2 });
  P('metal', xf(new THREE.TorusGeometry(0.09, 0.025, 6, 14), { sx: 1, sy: 1.6 }), C(0xd8b23a), { x: 0.56, y: 0.5, z: -0.42, ry: Math.PI / 2 });
}

// ===========================================================================
// Startplatsen: jättelik uppdragsnyckel i en plåtbil och en biltransport
// lastad med leksaksbilar.
// ===========================================================================

export function addWindupCar(B, world, RAPIER, { x, z, rot = 0, s = 1 }) {
  const o = { x, z, rot };
  if (world) {
    localBox(world, RAPIER, o, 0.9 * s, 0.55 * s, 1.7 * s, 0, 0.55 * s, 0);
    localBox(world, RAPIER, o, 0.12 * s, 1.2 * s, 0.15 * s, 0, 1.6 * s, -0.4 * s);
  }
  if (!B) return;
  const P = (key, geo, col, t = {}) => { xf(geo, t); geo.scale(s, s, s); B.add(key, place(geo, o), col); };
  // Plåtkaross: rundad låda med randig dekor
  const body = new THREE.CapsuleGeometry(0.62, 2.0, 6, 18);
  P('metal', body, C(0xe8352b), { y: 0.62, rx: Math.PI / 2, sx: 1.35, sz: 0.85 });
  P('metal', xf(new THREE.SphereGeometry(0.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), { sx: 1.1, sy: 0.7, sz: 1.3 }), C(0xbfe8ff), { y: 1.05, z: 0.15 });
  for (const sx of [-1, 1]) {
    P('plastic', box(0.03, 0.12, 2.6), C(0xffd23f), { x: sx * 0.84, y: 0.62 });
    P('plastic', box(0.03, 0.06, 2.6), C(0xf4f1ea), { x: sx * 0.845, y: 0.48 });
    for (const wz of [-0.95, 0.95]) {
      P('plastic', cyl(0.36, 0.36, 0.22, 24), C(0x1c1c1c), { x: sx * 0.8, y: 0.36, z: wz, rz: Math.PI / 2 });
      P('metal', cyl(0.2, 0.2, 0.24, 16), C(0xd8dce4), { x: sx * 0.81, y: 0.36, z: wz, rz: Math.PI / 2 });
    }
  }
  // Lyktor
  for (const sx of [-1, 1]) P('neon', cyl(0.1, 0.1, 0.04, 12), C(0xfff2b0), { x: sx * 0.45, y: 0.72, z: 1.55, rx: Math.PI / 2 });
  // Nyckeln: skaft ur taket, krage och två stora öglor
  P('metal', cyl(0.11, 0.11, 1.5, 14), C(0xd8b23a), { y: 1.75, z: -0.4 });
  P('metal', cyl(0.2, 0.2, 0.12, 18), C(0xd8b23a), { y: 1.1, z: -0.4 });
  P('metal', cyl(0.16, 0.16, 0.1, 18), C(0xd8b23a), { y: 2.45, z: -0.4 });
  for (const sx of [-1, 1]) {
    P('metal', xf(new THREE.TorusGeometry(0.42, 0.11, 10, 28), { sx: 1, sy: 0.75 }), C(0xd8b23a), { x: sx * 0.5, y: 2.75, z: -0.4 });
  }
  P('metal', box(0.24, 0.3, 0.16), C(0xd8b23a), { y: 2.65, z: -0.4 });
}

export function addCarTransporter(B, world, RAPIER, { x, z, rot = 0 }) {
  const o = { x, z, rot };
  const L = 9.2, W = 1.9;
  if (world) {
    localBox(world, RAPIER, o, W / 2, 0.75, 1.0, 0, 0.75, L / 2 - 1.0);
    localBox(world, RAPIER, o, W / 2, 1.1, (L - 2.2) / 2, 0, 1.1, -1.1);
  }
  if (!B) return;
  const P = (key, geo, col, t = {}) => { xf(geo, t); B.add(key, place(geo, o), col); };
  // Hytt (fram mot +z)
  const cz = L / 2 - 1.0;
  P('plastic', box(W, 1.0, 1.9), C(0xffd23f), { y: 0.95, z: cz });
  P('plastic', box(W - 0.1, 0.65, 1.2), C(0xffd23f), { y: 1.75, z: cz - 0.3 });
  P('plastic', box(W - 0.2, 0.45, 0.04), C(0x9fd8ff), { y: 1.78, z: cz + 0.31 });
  for (const sx of [-1, 1]) P('plastic', box(0.04, 0.4, 0.8), C(0x9fd8ff), { x: sx * (W / 2 - 0.04), y: 1.78, z: cz - 0.3 });
  P('plastic', box(W + 0.1, 0.3, 0.18), C(0x888c94), { y: 0.55, z: cz + 0.96 });
  for (const sx of [-1, 1]) P('neon', box(0.3, 0.16, 0.03), C(0xfff2b0), { x: sx * 0.6, y: 0.9, z: cz + 0.96 });
  // Släp: två våningar med räcken
  const tz = -1.1, TL = L - 2.3;
  P('plastic', box(W, 0.18, TL), C(0x1e6fd9), { y: 0.55, z: tz });
  P('plastic', box(W, 0.12, TL), C(0x1e6fd9), { y: 1.55, z: tz });
  for (const sx of [-1, 1]) {
    for (let u = -TL / 2; u <= TL / 2 + 1e-6; u += TL / 4) P('metal', box(0.07, 1.6, 0.07), C(0xc8ccd4), { x: sx * (W / 2 - 0.04), y: 1.25, z: tz + u });
    P('metal', box(0.05, 0.05, TL), C(0xc8ccd4), { x: sx * (W / 2 - 0.04), y: 2.05, z: tz });
  }
  // Hjul
  for (const sx of [-1, 1]) for (const wz of [cz - 0.2, tz - TL / 2 + 0.6, tz - TL / 2 + 1.4, tz + 0.6]) {
    P('plastic', cyl(0.36, 0.36, 0.26, 20), C(0x1c1c1c), { x: sx * (W / 2 - 0.05), y: 0.36, z: wz, rz: Math.PI / 2 });
    P('metal', cyl(0.18, 0.18, 0.28, 12), C(0xd8dce4), { x: sx * (W / 2 - 0.05), y: 0.36, z: wz, rz: Math.PI / 2 });
  }
  // Lasten: små leksaksbilar i olika färger på båda våningarna
  const cols = [0xe8352b, 0x3fbf4a, 0xff8a1c, 0x9440c8, 0xf4f1ea, 0x39e6ff];
  let k = 0;
  for (const deck of [0.64, 1.61]) for (let u = -TL / 2 + 0.85; u < TL / 2 - 0.5; u += 1.55, k++) {
    const col = C(cols[k % cols.length]);
    P('plastic', box(0.85, 0.22, 1.25), col, { y: deck + 0.2, z: tz + u });
    P('plastic', box(0.7, 0.2, 0.62), col, { y: deck + 0.4, z: tz + u - 0.08 });
    P('plastic', box(0.66, 0.14, 0.02), C(0x9fd8ff), { y: deck + 0.42, z: tz + u + 0.24 });
    for (const sx of [-1, 1]) for (const wz of [-0.4, 0.4]) P('plastic', cyl(0.13, 0.13, 0.1, 12), C(0x1c1c1c), { x: sx * 0.42, y: deck + 0.11, z: tz + u + wz, rz: Math.PI / 2 });
  }
}

// Borgmur med tinnar mellan två punkter (kolliderar)
export function addCastleWall(B, world, RAPIER, { a, b, h = 2.6, t = 0.8, color = 0x7a44c8 }) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const o = { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, rot: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  if (world) localBox(world, RAPIER, o, t / 2, h / 2, len / 2, 0, h / 2, 0);
  if (!B) return;
  B.add('plastic', place(box(t, h, len, 0, h / 2, 0), o), C(color));
  B.add('plastic', place(box(t + 0.06, 0.12, len, 0, h - 0.06, 0), o), C(0xffd23f));
  const n = Math.max(2, Math.round(len / 0.9));
  for (let k = 0; k < n; k += 2) {
    const u = -len / 2 + (k + 0.5) * (len / n);
    B.add('plastic', place(box(t, 0.4, len / n, 0, h + 0.2, u), o), C(color));
  }
  B.add('neon', place(box(0.04, 0.04, len, t / 2 + 0.02, h * 0.55, 0), o), C(0x39ff6a));
  B.add('neon', place(box(0.04, 0.04, len, -t / 2 - 0.02, h * 0.55, 0), o), C(0x39ff6a));
}
