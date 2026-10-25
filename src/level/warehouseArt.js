import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G, groups } from '../core/physics.js';

// ---------------------------------------------------------------------------
// Procedurell grafik för leksakslagret: betonggolv med målade linjer, höga
// väggar med fönsterband, betongpelare, kartongtravar, pallar och lite
// leksaker som dekor. Allt ritas i canvas, inga externa filer.
//
// Alla funktioner tar (scene, world, RAPIER, opts). Utan scene byggs bara
// fysiken (inget document rörs), utan world bara grafiken.
// Texturer och material cachas på modulnivå och delas mellan alla anrop.
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

// Deterministisk slump (mulberry32)
export function rng(seed = 1) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const yQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

function fixedBody(world, RAPIER, x = 0, y = 0, z = 0, rotY = 0) {
  return world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(yQuat(rotY)));
}

function staticBox(world, RAPIER, hx, hy, hz, x, y, z, rotY = 0, friction = 0.8) {
  const body = fixedBody(world, RAPIER, x, y, z, rotY);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction).setRestitution(0.1).setCollisionGroups(groups(G.WORLD)),
    body
  );
  return body;
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

// Sömlöst värdebrus (flera oktaver), värden 0..1
function valueNoise(w, h, baseCells, octaves, r) {
  const out = new Float32Array(w * h);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cx = baseCells << o, cy = Math.max(1, Math.round((baseCells << o) * h / w));
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

// Fyller canvas med färg modulerad av brus + korn
function paintNoise(ctx, w, h, [R, G_, B], { cells = 4, oct = 5, amt = 0.22, grain = 6, seed = 1 } = {}) {
  const r = rng(seed);
  const n = valueNoise(w, h, cells, oct, r);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const k = 1 - amt / 2 + amt * n[i];
    const g = (r() - 0.5) * grain;
    d[i * 4] = R * k + g;
    d[i * 4 + 1] = G_ * k + g;
    d[i * 4 + 2] = B * k + g;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// Ritar med omlindning så att texturen förblir sömlös
function wrapDraw(w, h, x, y, rad, fn) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
    if (x + ox + rad < 0 || x + ox - rad > w || y + oy + rad < 0 || y + oy - rad > h) continue;
    fn(x + ox, y + oy);
  }
}

// Skalar en BoxGeometrys UV så texturen får fast storlek i meter
function boxWorldUV(geo, w, h, d, metres) {
  const uv = geo.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * faces[f][0] / metres, uv.getY(k) * faces[f][1] / metres);
  }
  return geo;
}

// Lägger varje BoxGeometry-sida på en egen ruta i en atlas. cells: 6 st [u0,v0,u1,v1]
function boxAtlasUV(geo, cells) {
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

function tint(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function shadowed(mesh, cast = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

// ===========================================================================
// Golv
// ===========================================================================

const FLOOR_TILE = 8; // meter per texturupprepning (fogarna sågas var 4:e meter)

function floorTexture() {
  return cached('floorTex', () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [128, 129, 126], { cells: 3, oct: 6, amt: 0.26, grain: 7, seed: 11 });
    const r = rng(12);

    // Molnig slipad betong: stora mjuka fläckar
    for (let i = 0; i < 26; i++) {
      const x = r() * S, y = r() * S, rad = 40 + r() * 160;
      const dark = r() < 0.6;
      wrapDraw(S, S, x, y, rad, (px, py) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, dark ? 'rgba(70,68,62,0.10)' : 'rgba(225,225,220,0.08)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    // Glättningsbågar
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 70; i++) {
      const x = r() * S, y = r() * S, rad = 30 + r() * 90, a = r() * Math.PI * 2;
      ctx.strokeStyle = `rgba(${r() < 0.5 ? '255,255,250' : '60,60,55'},0.05)`;
      wrapDraw(S, S, x, y, rad, (px, py) => {
        ctx.beginPath(); ctx.arc(px, py, rad, a, a + 0.6 + r() * 1.2); ctx.stroke();
      });
    }
    // Oljefläckar och smuts
    for (let i = 0; i < 7; i++) {
      const x = r() * S, y = r() * S, rad = 12 + r() * 40;
      wrapDraw(S, S, x, y, rad * 1.6, (px, py) => {
        for (let k = 0; k < 4; k++) {
          const ox = (r() - 0.5) * rad, oy = (r() - 0.5) * rad, rr = rad * (0.4 + r() * 0.6);
          const g = ctx.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rr);
          g.addColorStop(0, 'rgba(48,44,38,0.22)');
          g.addColorStop(0.7, 'rgba(48,44,38,0.08)');
          g.addColorStop(1, 'rgba(48,44,38,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px + ox - rr, py + oy - rr, rr * 2, rr * 2);
        }
      });
    }
    // Däckspår / skrapmärken
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const x = r() * S, y = r() * S, len = 80 + r() * 220, a = r() * Math.PI * 2, bend = (r() - 0.5) * 0.8;
      ctx.strokeStyle = 'rgba(40,40,38,0.07)';
      ctx.lineWidth = 3 + r() * 6;
      wrapDraw(S, S, x, y, len, (px, py) => {
        ctx.beginPath(); ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + Math.cos(a + bend) * len / 2, py + Math.sin(a + bend) * len / 2, px + Math.cos(a) * len, py + Math.sin(a) * len);
        ctx.stroke();
      });
    }
    // Sprickor: slumpvandring
    for (let i = 0; i < 5; i++) {
      let x = r() * S, y = r() * S, a = r() * Math.PI * 2;
      ctx.strokeStyle = 'rgba(55,54,50,0.55)';
      ctx.lineWidth = 1;
      const pts = [[x, y]];
      for (let k = 0; k < 30 + r() * 40; k++) {
        a += (r() - 0.5) * 0.9;
        x += Math.cos(a) * 4; y += Math.sin(a) * 4;
        pts.push([x, y]);
      }
      wrapDraw(S, S, pts[0][0], pts[0][1], 300, (px, py) => {
        const dx = px - pts[0][0], dy = py - pts[0][1];
        ctx.beginPath();
        pts.forEach(([qx, qy], k) => (k ? ctx.lineTo(qx + dx, qy + dy) : ctx.moveTo(qx + dx, qy + dy)));
        ctx.stroke();
      });
    }
    // Sågade fogar var 4:e meter (två per textur) med ljus kant
    const joint = (pos) => {
      ctx.fillStyle = 'rgba(60,60,57,0.85)';
      ctx.fillRect(pos - 1, 0, 3, S); ctx.fillRect(0, pos - 1, S, 3);
      ctx.fillStyle = 'rgba(200,200,195,0.35)';
      ctx.fillRect(pos + 2, 0, 1, S); ctx.fillRect(0, pos + 2, S, 1);
    };
    joint(1); joint(S / 2);
    return toTex(c);
  });
}

function floorRoughness() {
  return cached('floorRough', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    const n = valueNoise(S, S, 3, 5, rng(21));
    const img = ctx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const v = 150 + 105 * Math.pow(n[i], 1.4);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTex(c, { srgb: false });
  });
}

export function makeConcreteFloor(scene, world, RAPIER, { size, y = 0, lines = true } = {}) {
  const half = size / 2;
  if (world) {
    const body = fixedBody(world, RAPIER);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, y - 0.5, 0).setFriction(1).setCollisionGroups(groups(G.WORLD)),
      body
    );
  }
  if (!scene) return;

  // Egna material per golv eftersom repeat beror på storleken
  const map = floorTexture().clone();
  map.repeat.set(size / FLOOR_TILE, size / FLOOR_TILE);
  map.needsUpdate = true;
  const rough = floorRoughness().clone();
  rough.repeat.set(size / 13, size / 13); // annan period bryter mönstret
  rough.needsUpdate = true;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 0.4, metalness: 0, envMapIntensity: 0.8 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = y;
  floor.receiveShadow = true;
  scene.add(floor);

  // Standardlinjer: gul gångväg längs väggarna
  if (lines) {
    const rect = (inset) => [[-half + inset, -half + inset], [half - inset, -half + inset], [half - inset, half - inset], [-half + inset, half - inset]];
    addFloorLines(scene, {
      y,
      lines: [
        { points: rect(1.2), closed: true, width: 0.12, color: 'yellow' },
        { points: rect(1.4), closed: true, width: 0.06, color: 'yellow' },
      ],
    });
  }
}

// --- målade golvlinjer -------------------------------------------------------

function paintMaterial(color) {
  return cached('paint_' + color, () => {
    const tex = cached('paintWear', () => {
      const S = 256;
      const [c, ctx] = canvas(S);
      paintNoise(ctx, S, S, [235, 235, 235], { cells: 8, oct: 4, amt: 0.35, grain: 18, seed: 31 });
      const r = rng(32);
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(120,120,120,${0.2 + r() * 0.4})`;
        ctx.fillRect(r() * S, r() * S, 1 + r() * 4, 1 + r() * 2);
      }
      return toTex(c);
    });
    const hex = { yellow: 0xf0b400, white: 0xe8e6de, red: 0xc23a2c, black: 0x262626 }[color] ?? color;
    return new THREE.MeshStandardMaterial({
      color: hex, map: tex, roughness: 0.55,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
  });
}

/**
 * Målade linjer på golvet. lines: [{ points: [[x,z],...], width, color: 'yellow'|'white'|'red'|hex,
 * closed, dash: [på, av] i meter }]. En mesh per färg.
 */
export function addFloorLines(scene, { lines, y = 0 }) {
  if (!scene) return [];
  const byColor = new Map();
  for (const L of lines) {
    const pts = L.points.map((p) => (Array.isArray(p) ? p : [p.x, p.z]));
    if (L.closed) pts.push(pts[0]);
    const w = L.width ?? 0.08;
    const list = byColor.get(L.color ?? 'yellow') ?? [];
    byColor.set(L.color ?? 'yellow', list);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-4) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const pieces = [];
      if (L.dash) {
        for (let s = 0; s < len; s += L.dash[0] + L.dash[1]) pieces.push([s, Math.min(len, s + L.dash[0])]);
      } else pieces.push([-w / 2, len + w / 2]); // förlängd så hörnen fylls
      for (const [s0, s1] of pieces) {
        const g = new THREE.PlaneGeometry(s1 - s0, w);
        g.rotateX(-Math.PI / 2);
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (s1 - s0) / 0.8 + s0 / 0.8, uv.getY(k) * 0.12);
        g.rotateY(-Math.atan2(dz, dx));
        const m = (s0 + s1) / 2;
        g.translate(ax + dx * m, y + 0.002, az + dz * m);
        list.push(g);
      }
    }
  }
  const meshes = [];
  for (const [color, geos] of byColor) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geos), paintMaterial(color));
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

// ===========================================================================
// Väggar
// ===========================================================================

const WALL_TILE = 4; // meter per texturupprepning (två paneler à 2 m)

function wallMaterial() {
  return cached('wallMat', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [168, 160, 145], { cells: 2, oct: 5, amt: 0.14, grain: 5, seed: 41 });
    const r = rng(42);
    // Panelfogar
    for (const p of [0, S / 2]) {
      ctx.fillStyle = 'rgba(90,86,78,0.7)'; ctx.fillRect(p, 0, 3, S);
      ctx.fillStyle = 'rgba(255,255,245,0.25)'; ctx.fillRect(p + 3, 0, 2, S);
    }
    ctx.fillStyle = 'rgba(90,86,78,0.6)'; ctx.fillRect(0, 0, S, 3);
    // Skruvar längs fogarna
    ctx.fillStyle = 'rgba(80,78,72,0.6)';
    for (const p of [0, S / 2]) for (let yy = 16; yy < S; yy += 64) {
      ctx.beginPath(); ctx.arc(p + 10, yy, 2, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(p - 7 + (p ? 0 : S), yy, 2, 0, 7); ctx.fill();
    }
    // Rinnande smuts
    for (let i = 0; i < 18; i++) {
      const x = r() * S, len = 30 + r() * 140;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(100,95,85,0.10)'); g.addColorStop(1, 'rgba(100,95,85,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, r() * S, 2 + r() * 6, len);
    }
    return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.85, vertexColors: true });
  });
}

function windowMaterial() {
  return cached('windowMat', () => {
    const [c, ctx] = canvas(512, 256);
    ctx.fillStyle = '#2a2d30';
    ctx.fillRect(0, 0, 512, 256);
    const r = rng(51);
    const cols = 4, rows = 2, f = 10;
    const pw = (512 - f * (cols + 1)) / cols, ph = (256 - f * (rows + 1)) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = f + i * (pw + f), y = f + j * (ph + f);
      const g = ctx.createLinearGradient(x, y, x + pw, y + ph);
      const b = 200 + r() * 40;
      g.addColorStop(0, `rgb(${b},${b + 8},${b + 15})`);
      g.addColorStop(1, `rgb(${b - 40},${b - 28},${b - 15})`);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, pw, ph);
      // Trådglas
      ctx.strokeStyle = 'rgba(80,90,100,0.18)'; ctx.lineWidth = 1;
      for (let k = 0; k < pw + ph; k += 14) {
        ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + k - ph, y + ph); ctx.stroke();
      }
    }
    const tex = toTex(c, { repeat: false });
    return new THREE.MeshStandardMaterial({ color: 0x202224, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.25, roughness: 0.3, fog: false });
  });
}

/**
 * Fyra väggar runt en kvadratisk hall (centrerad i origo), insidan exakt på ±size/2.
 * Mörkare sockel, fönsterband högt upp och takbalkar (beams: false stänger av).
 */
export function makeHallWalls(scene, world, RAPIER, { size, height, windows = true, beams = true, ceiling = true } = {}) {
  const half = size / 2, T = 0.3;
  const sides = [
    { x: 0, z: -half, rot: 0 },            // norra väggen, insidan mot +z
    { x: 0, z: half, rot: Math.PI },
    { x: -half, z: 0, rot: Math.PI / 2 },
    { x: half, z: 0, rot: -Math.PI / 2 },
  ];

  if (world) {
    const body = fixedBody(world, RAPIER);
    for (const s of sides) {
      const nx = Math.sin(s.rot), nz = Math.cos(s.rot); // inåtnormal
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(half + T, height / 2, T / 2)
          .setTranslation(s.x - nx * T / 2, height / 2, s.z - nz * T / 2)
          .setRotation(yQuat(s.rot)).setFriction(0.6).setCollisionGroups(groups(G.WORLD)),
        body
      );
    }
  }
  if (!scene) return;

  // Väggytor: plan med vertexfärg som mörknar mot golvet
  const wallGeos = [], skirtGeos = [], winGeos = [], beamGeos = [];
  const hs = Math.ceil(height);
  for (const s of sides) {
    const g = new THREE.PlaneGeometry(size, height, 1, hs);
    const pos = g.attributes.position, uv = g.attributes.uv;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const yy = pos.getY(i) + height / 2;
      const k = yy < 1.6 ? 0.72 + 0.28 * (yy / 1.6) : 1 - 0.06 * Math.min(1, (yy - 1.6) / (height - 1.6));
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
      uv.setXY(i, uv.getX(i) * size / WALL_TILE, uv.getY(i) * height / WALL_TILE);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.translate(0, height / 2, 0);
    g.rotateY(s.rot);
    g.translate(s.x, 0, s.z);
    wallGeos.push(g);

    // Sockel
    const sk = new THREE.BoxGeometry(size, 0.45, 0.04);
    sk.translate(0, 0.225, 0.02);
    sk.rotateY(s.rot);
    sk.translate(s.x, 0, s.z);
    skirtGeos.push(sk);

    // Fönsterband
    if (windows) {
      const ww = 3.2, wh = Math.min(1.6, height * 0.18), step = 6;
      const n = Math.floor((size - 4) / step);
      for (let i = 0; i < n; i++) {
        const u = -((n - 1) * step) / 2 + i * step;
        const wg = new THREE.PlaneGeometry(ww, wh);
        wg.translate(u, height * 0.82, 0.015);
        wg.rotateY(s.rot);
        wg.translate(s.x, 0, s.z);
        winGeos.push(wg);
      }
    }
  }

  const walls = new THREE.Mesh(mergeGeometries(wallGeos), wallMaterial());
  walls.receiveShadow = true;
  scene.add(walls);

  const skirt = new THREE.Mesh(mergeGeometries(skirtGeos), cached('skirtMat', () => new THREE.MeshStandardMaterial({ color: 0x55594f, roughness: 0.7 })));
  skirt.receiveShadow = true;
  scene.add(skirt);

  if (winGeos.length) scene.add(new THREE.Mesh(mergeGeometries(winGeos), windowMaterial()));

  // Takbalkar i stål tvärs över hallen
  if (beams) {
    const n = Math.floor(size / 6);
    for (let i = 0; i <= n; i++) {
      const z = -half + 3 + i * 6;
      if (z > half - 1) break;
      for (const [w, h, d, yy] of [[size, 0.04, 0.3, height - 0.02], [size, 0.04, 0.3, height - 0.6], [size, 0.56, 0.03, height - 0.31]]) {
        const b = new THREE.BoxGeometry(w, h, d);
        b.translate(0, yy, z);
        beamGeos.push(b);
      }
    }
    const beamsMesh = new THREE.Mesh(mergeGeometries(beamGeos), cached('beamMat', () => new THREE.MeshStandardMaterial({ color: 0x56636e, roughness: 0.6, metalness: 0.4 })));
    scene.add(beamsMesh);
  }

  // Tak: mörk korrugerad plåt ovanför balkarna (kastar ingen skugga)
  if (ceiling) {
    const map = ceilingTexture().clone();
    map.repeat.set(size / 2, 1);
    map.needsUpdate = true;
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map, color: 0x9aa0a6, roughness: 0.7, metalness: 0.3 }));
    roof.rotation.x = Math.PI / 2;
    roof.position.y = height;
    scene.add(roof);
  }
}

function ceilingTexture() {
  return cached('ceilTex', () => {
    const [c, ctx] = canvas(128, 16);
    const g = ctx.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, '#6b7178'); g.addColorStop(0.25, '#8d939a'); g.addColorStop(0.5, '#5b6167'); g.addColorStop(0.75, '#7c828a'); g.addColorStop(1, '#6b7178');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 16);
    return toTex(c);
  });
}

// ===========================================================================
// Pelare
// ===========================================================================

function concreteMaterial() {
  return cached('concreteMat', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [146, 145, 139], { cells: 4, oct: 6, amt: 0.24, grain: 10, seed: 61 });
    const r = rng(62);
    // Porer
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = `rgba(70,70,65,${0.15 + r() * 0.3})`;
      ctx.beginPath(); ctx.arc(r() * S, r() * S, 0.4 + r() * 0.9, 0, 7); ctx.fill();
    }
    // Formskivans skarvar och stagjärnshål (texturen = 1.2 m)
    ctx.fillStyle = 'rgba(95,94,88,0.45)';
    ctx.fillRect(0, 0, S, 2); ctx.fillRect(0, 0, 2, S);
    for (const [x, y] of [[S / 4, S / 4], [3 * S / 4, S / 4], [S / 4, 3 * S / 4], [3 * S / 4, 3 * S / 4]]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 6);
      g.addColorStop(0, 'rgba(60,60,55,0.6)'); g.addColorStop(0.6, 'rgba(80,80,74,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 6, y - 6, 12, 12);
    }
    return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.8 });
  });
}

function hazardMaterial() {
  return cached('hazardMat', () => {
    const [c, ctx] = canvas(256);
    ctx.fillStyle = '#e8b51c';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#1d1d1b';
    for (let k = -256; k < 512; k += 128) {
      ctx.beginPath(); ctx.moveTo(k, 256); ctx.lineTo(k + 64, 256); ctx.lineTo(k + 320, 0); ctx.lineTo(k + 256, 0); ctx.fill();
    }
    // Skavd färg
    const r = rng(71);
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = `rgba(150,145,130,${0.3 + r() * 0.5})`;
      ctx.fillRect(r() * 256, r() * 256, 1 + r() * 5, 1 + r() * 3);
    }
    return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.55 });
  });
}

export function addPillar(scene, world, RAPIER, { x, z, size = 0.8, height } = {}) {
  if (world) staticBox(world, RAPIER, size / 2, height / 2, size / 2, x, height / 2, z, 0, 0.6);
  if (!scene) return;
  const body = new THREE.Mesh(boxWorldUV(new THREE.BoxGeometry(size, height, size), size, height, size, 1.2), concreteMaterial());
  body.position.set(x, height / 2, z);
  scene.add(shadowed(body));
  // Påkörningsskydd: gul-svart band nertill
  const s2 = size + 0.04, bh = 0.6;
  const band = new THREE.Mesh(boxWorldUV(new THREE.BoxGeometry(s2, bh, s2), s2, bh, s2, 0.6), hazardMaterial());
  band.position.set(x, bh / 2, z);
  scene.add(shadowed(band, false));
}

// ===========================================================================
// Kartonger
// ===========================================================================

// Atlas 1024²: fyra sidorutor 512×384 överst, två lockrutor 512×256 nederst
const ATLAS = 1024;
const cellUV = (x, y, w, h) => [x / ATLAS, 1 - (y + h) / ATLAS, (x + w) / ATLAS, 1 - y / ATLAS];
const SIDE_CELLS = [cellUV(0, 0, 512, 384), cellUV(512, 0, 512, 384), cellUV(0, 384, 512, 384), cellUV(512, 384, 512, 384)];
const TOP_CELLS = [cellUV(0, 768, 512, 256), cellUV(512, 768, 512, 256)];

const INK = 'rgba(52,34,20,0.82)';

function drawArrows(ctx, x, y, s) {
  // "Denna sida upp": två pilar på en linje
  ctx.fillStyle = INK; ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.06;
  ctx.strokeRect(x, y, s, s);
  for (const ox of [0.3, 0.7]) {
    const cx = x + s * ox;
    ctx.beginPath();
    ctx.moveTo(cx, y + s * 0.15); ctx.lineTo(cx - s * 0.14, y + s * 0.38); ctx.lineTo(cx + s * 0.14, y + s * 0.38); ctx.fill();
    ctx.fillRect(cx - s * 0.04, y + s * 0.36, s * 0.08, s * 0.38);
  }
  ctx.fillRect(x + s * 0.15, y + s * 0.8, s * 0.7, s * 0.06);
}

function drawGlass(ctx, x, y, s) {
  // Ömtåligt: ett vinglas med spricka
  ctx.strokeStyle = INK; ctx.fillStyle = INK;
  ctx.lineWidth = s * 0.06;
  ctx.strokeRect(x, y, s, s);
  const cx = x + s / 2;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.2, y + s * 0.14);
  ctx.lineTo(cx + s * 0.2, y + s * 0.14);
  ctx.quadraticCurveTo(cx + s * 0.2, y + s * 0.52, cx, y + s * 0.52);
  ctx.quadraticCurveTo(cx - s * 0.2, y + s * 0.52, cx - s * 0.2, y + s * 0.14);
  ctx.fill();
  ctx.fillRect(cx - s * 0.03, y + s * 0.5, s * 0.06, s * 0.26);
  ctx.fillRect(cx - s * 0.16, y + s * 0.74, s * 0.32, s * 0.06);
  ctx.strokeStyle = '#b4895a'; ctx.lineWidth = s * 0.035;
  ctx.beginPath(); ctx.moveTo(cx - s * 0.02, y + s * 0.15); ctx.lineTo(cx + s * 0.06, y + s * 0.28); ctx.lineTo(cx - s * 0.04, y + s * 0.36); ctx.lineTo(cx + s * 0.03, y + s * 0.47); ctx.stroke();
}

function drawUmbrella(ctx, x, y, s) {
  ctx.strokeStyle = INK; ctx.fillStyle = INK;
  ctx.lineWidth = s * 0.06;
  ctx.strokeRect(x, y, s, s);
  const cx = x + s / 2;
  ctx.beginPath(); ctx.arc(cx, y + s * 0.45, s * 0.3, Math.PI, 0); ctx.fill();
  ctx.lineWidth = s * 0.05;
  ctx.beginPath(); ctx.moveTo(cx, y + s * 0.45); ctx.lineTo(cx, y + s * 0.78); ctx.arc(cx - s * 0.07, y + s * 0.78, s * 0.07, 0, Math.PI); ctx.stroke();
  for (const ox of [-0.25, 0, 0.25]) {
    ctx.fillRect(cx + s * ox - s * 0.015, y + s * 0.06, s * 0.03, s * 0.08);
  }
}

function drawLabel(ctx, x, y, w, h, r, lines) {
  ctx.fillStyle = '#efeadc';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#2b2b2b';
  ctx.font = `bold ${Math.round(h * 0.16)}px Arial, sans-serif`;
  ctx.textBaseline = 'top';
  lines.forEach((t, i) => ctx.fillText(t, x + w * 0.07, y + h * (0.08 + i * 0.2)));
  // Streckkod
  let bx = x + w * 0.07;
  const by = y + h * 0.62, bh = h * 0.28;
  while (bx < x + w * 0.93) {
    const bw = 1 + Math.floor(r() * 4);
    if (r() < 0.6) ctx.fillRect(bx, by, bw, bh);
    bx += bw + 1;
  }
}

function kraftBase(ctx, x, y, w, h, r) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  // Wellpappens räfflor
  ctx.fillStyle = 'rgba(90,60,30,0.06)';
  for (let k = x; k < x + w; k += 7) ctx.fillRect(k, y, 2, h);
  // Fläckar
  for (let i = 0; i < 6; i++) {
    const px = x + r() * w, py = y + r() * h, rad = 10 + r() * 50;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, 'rgba(80,50,25,0.12)'); g.addColorStop(1, 'rgba(80,50,25,0)');
    ctx.fillStyle = g; ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  // Mörkare kanter ger lådan form
  const e = 18;
  for (const [gx0, gy0, gx1, gy1, rx, ry, rw, rh] of [
    [x, 0, x + e, 0, x, y, e, h], [x + w, 0, x + w - e, 0, x + w - e, y, e, h],
    [0, y, 0, y + e, x, y, w, e], [0, y + h, 0, y + h - e, x, y + h - e, w, e],
  ]) {
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, 'rgba(60,38,18,0.35)'); g.addColorStop(1, 'rgba(60,38,18,0)');
    ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh);
  }
  ctx.restore();
}

function cardboardMaterial() {
  return cached('cardboardMat', () => {
    const [c, ctx] = canvas(ATLAS);
    paintNoise(ctx, ATLAS, ATLAS, [178, 136, 88], { cells: 8, oct: 5, amt: 0.14, grain: 10, seed: 81 });
    const r = rng(82);
    const font = (px) => `900 ${px}px Impact, "Arial Black", Arial, sans-serif`;

    // Sida 0: symbolrad + etikett
    kraftBase(ctx, 0, 0, 512, 384, r);
    drawArrows(ctx, 34, 40, 92); drawGlass(ctx, 140, 40, 92); drawUmbrella(ctx, 246, 40, 92);
    drawLabel(ctx, 270, 210, 200, 130, r, ['LOT 0427', '24 PCS']);
    ctx.fillStyle = INK; ctx.font = font(44); ctx.textBaseline = 'alphabetic';
    ctx.fillText('TOYS', 40, 300);

    // Sida 1: FRAGILE-stämpel i rött
    kraftBase(ctx, 512, 0, 512, 384, r);
    ctx.save();
    ctx.translate(768, 170); ctx.rotate(-0.12);
    ctx.strokeStyle = 'rgba(180,40,30,0.85)'; ctx.lineWidth = 9;
    ctx.strokeRect(-190, -52, 380, 104);
    ctx.fillStyle = 'rgba(180,40,30,0.85)'; ctx.font = font(84); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('FRAGILE', 0, 4);
    ctx.restore();
    ctx.fillStyle = INK; ctx.font = font(30); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('HANDLE WITH CARE', 560, 320);
    drawArrows(ctx, 900, 270, 80);

    // Sida 2: stora schablonpilar och nummer
    kraftBase(ctx, 0, 384, 512, 384, r);
    ctx.fillStyle = INK;
    for (const ox of [70, 170]) {
      ctx.beginPath(); ctx.moveTo(ox, 430); ctx.lineTo(ox - 38, 490); ctx.lineTo(ox + 38, 490); ctx.fill();
      ctx.fillRect(ox - 12, 486, 24, 80);
    }
    ctx.fillRect(28, 580, 184, 10);
    ctx.font = font(64); ctx.fillText('THIS', 260, 490); ctx.fillText('SIDE UP', 260, 560);
    ctx.font = font(26); ctx.fillText('NO. 18-3305   MADE OF RECYCLED FIBRE', 34, 690);

    // Sida 3: diskret med etikett och tejpremsa
    kraftBase(ctx, 512, 384, 512, 384, r);
    ctx.fillStyle = 'rgba(200,170,110,0.75)';
    ctx.fillRect(712, 384, 112, 90);
    ctx.fillStyle = 'rgba(255,240,200,0.25)';
    ctx.fillRect(716, 384, 30, 90);
    drawLabel(ctx, 560, 560, 230, 150, r, ['PLAY-SET B', 'QTY 6']);
    drawGlass(ctx, 860, 580, 110);

    // Lock: tejp över flikarnas skarv
    for (const [x0, cross] of [[0, false], [512, true]]) {
      kraftBase(ctx, x0, 768, 512, 256, r);
      ctx.fillStyle = 'rgba(60,40,20,0.55)';
      ctx.fillRect(x0, 768 + 127, 512, 3);
      const tape = (x, y, w, h) => {
        ctx.fillStyle = 'rgba(205,172,112,0.92)'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,245,215,0.22)'; ctx.fillRect(x, y + h * 0.15, w, h * 0.2);
      };
      tape(x0, 768 + 100, 512, 56);
      if (cross) { tape(x0 + 40, 768, 50, 256); tape(x0 + 422, 768, 50, 256); }
    }
    return new THREE.MeshStandardMaterial({ map: toTex(c, { repeat: false }), roughness: 0.92, vertexColors: true });
  });
}

// En kartong som geometri med atlas-UV och färgton (för sammanslagning)
function cardboardGeo(w, h, d, r) {
  const g = new THREE.BoxGeometry(w, h, d);
  const side = () => SIDE_CELLS[Math.floor(r() * 4)];
  const sx = side(), sz = side(), top = TOP_CELLS[r() < 0.7 ? 0 : 1];
  boxAtlasUV(g, [sx, sx, top, TOP_CELLS[0], sz, sz]);
  const k = 0.82 + r() * 0.26, warm = (r() - 0.5) * 0.08;
  return tint(g, k * (1 + warm), k, k * (1 - warm));
}

/**
 * Statisk trave kartonger. En collider täcker hela traven; synligt en sammanslagen
 * mesh (ett draw call) med små slumpade förskjutningar.
 */
export function addBoxStack(scene, world, RAPIER, {
  x, z, y = 0, rotY = 0, cols = 2, rows = 2, layers = 2, box = [0.6, 0.45, 0.5], seed = 1,
} = {}) {
  const [bw, bh, bd] = box;
  const W = cols * bw, H = layers * bh, D = rows * bd;
  const out = { body: null, mesh: null, size: [W, H, D] };
  if (world) out.body = staticBox(world, RAPIER, W / 2, H / 2, D / 2, x, y + H / 2, z, rotY, 0.8);
  if (!scene) return out;

  const r = rng(seed * 7919 + 3);
  const geos = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  for (let l = 0; l < layers; l++) for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const s = 0.96 + r() * 0.03; // lite mindre så de inte går in i varandra
    const g = cardboardGeo(bw * s, bh * 0.995, bd * s, r);
    const jit = l === 0 ? 0.01 : 0.025;
    e.set(0, (r() - 0.5) * (l === 0 ? 0.03 : 0.09) + (r() < 0.25 ? Math.PI : 0), 0);
    q.setFromEuler(e);
    p.set(-W / 2 + bw * (i + 0.5) + (r() - 0.5) * jit, bh * (l + 0.5), -D / 2 + bd * (j + 0.5) + (r() - 0.5) * jit);
    g.applyMatrix4(m.compose(p, q, one));
    geos.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), cardboardMaterial());
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  scene.add(shadowed(mesh));
  out.mesh = mesh;
  return out;
}

/** Lös kartong som bilarna kan knuffa runt. Returnerar { body, mesh } för synk varje frame. */
export function addLooseBox(scene, world, RAPIER, { x, z, y = 0, size = 0.25, mass = 0.15, rotY = 0, seed } = {}) {
  const h = size * 0.8;
  const spawn = { x, y: y + h / 2 + 0.005, z };
  let body = null, mesh = null;
  if (world) {
    body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y, spawn.z).setRotation(yQuat(rotY)).setLinearDamping(0.15).setAngularDamping(0.4)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(size / 2, h / 2, size / 2).setDensity(0).setMass(mass).setFriction(0.7).setRestitution(0.1).setCollisionGroups(groups(G.PROP)),
      body
    );
  }
  if (scene) {
    const r = rng(seed ?? Math.round(x * 131 + z * 17));
    mesh = new THREE.Mesh(cardboardGeo(size, h, size, r), cardboardMaterial());
    mesh.position.set(spawn.x, spawn.y, spawn.z);
    mesh.rotation.y = rotY;
    scene.add(shadowed(mesh));
  }
  return { body, mesh, kind: 'box', spawn };
}

// ===========================================================================
// Pall (EUR-mått 1.2 × 0.8 × 0.144 m)
// ===========================================================================

function woodMaterial() {
  return cached('woodMat', () => {
    const [c, ctx] = canvas(256);
    const r = rng(91);
    const n = valueNoise(256, 256, 2, 4, r);
    const img = ctx.createImageData(256, 256);
    for (let yy = 0; yy < 256; yy++) for (let xx = 0; xx < 256; xx++) {
      const i = yy * 256 + xx;
      // Ådring längs u (brädornas längdriktning)
      const grain = 0.5 + 0.5 * Math.sin(yy * 0.35 + n[i] * 14);
      const k = 0.82 + 0.12 * grain + 0.1 * n[i] + (r() - 0.5) * 0.05;
      img.data[i * 4] = 196 * k; img.data[i * 4 + 1] = 160 * k; img.data[i * 4 + 2] = 112 * k; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    for (let i = 0; i < 6; i++) { // kvistar
      const x = r() * 256, y = r() * 256;
      ctx.fillStyle = 'rgba(110,75,40,0.6)';
      ctx.beginPath(); ctx.ellipse(x, y, 5 + r() * 4, 2.5 + r() * 2, 0, 0, 7); ctx.fill();
    }
    return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.9 });
  });
}

export const PALLET = { w: 1.2, h: 0.144, d: 0.8 };

export function addPallet(scene, world, RAPIER, { x, z, y = 0, rotY = 0 } = {}) {
  const { w, h, d } = PALLET;
  const out = { body: null, mesh: null };
  if (world) out.body = staticBox(world, RAPIER, w / 2, h / 2, d / 2, x, y + h / 2, z, rotY, 0.9);
  if (!scene) return out;

  const geos = [];
  const board = (bw, bh, bd, px, py, pz, along = 'x') => {
    const g = boxWorldUV(new THREE.BoxGeometry(bw, bh, bd), bw, bh, bd, 0.5);
    if (along === 'z') { // vrid ådringen
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k), uv.getX(k));
    }
    g.translate(px, py, pz);
    geos.push(g);
  };
  const tb = 0.022, blk = 0.078;
  // Bottenbrädor, klossar, mellanbrädor, däck
  for (const sz of [-1, 0, 1]) board(w, tb, 0.1, 0, tb / 2, sz * (d / 2 - 0.05));
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) board(0.14, blk, sz ? 0.1 : 0.14, sx * (w / 2 - 0.07), tb + blk / 2, sz * (d / 2 - 0.05));
  for (const sx of [-1, 0, 1]) board(0.14, tb, d, sx * (w / 2 - 0.07), tb + blk + tb / 2, 0, 'z');
  const deckY = h - tb / 2;
  for (const [pz, bw2] of [[-d / 2 + 0.05, 0.1], [-0.19, 0.12], [0, 0.14], [0.19, 0.12], [d / 2 - 0.05, 0.1]]) board(w, tb, bw2, 0, deckY, pz);

  const mesh = new THREE.Mesh(mergeGeometries(geos), woodMaterial());
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  scene.add(shadowed(mesh));
  out.mesh = mesh;
  return out;
}

// ===========================================================================
// Dekor: stora leksaksklossar och badbollar
// ===========================================================================

const BLOCK_COLORS = [['#d63a2f', '#ffe9a8'], ['#2f6fd6', '#fff6d6'], ['#2fa04a', '#fffbe0'], ['#f2b81c', '#7a2a12'], ['#e86a1c', '#fff2c8'], ['#7d43c4', '#ffe6f6'], ['#18a7b5', '#fff8dc'], ['#e04b8d', '#fff4d0']];
const BLOCK_GLYPHS = ['A', 'B', 'C', '1', '2', '3', 'R', 'V', 'X', 'K', '★', '●', 'Z', '7', 'E', '♥'];

function blockMaterial() {
  return cached('blockMat', () => {
    const [c, ctx] = canvas(1024);
    for (let i = 0; i < 16; i++) {
      const x = (i % 4) * 256, y = Math.floor(i / 4) * 256;
      const [bg, fg] = BLOCK_COLORS[i % BLOCK_COLORS.length];
      ctx.fillStyle = bg; ctx.fillRect(x, y, 256, 256);
      // Avfasad kant i ljusare trä
      ctx.strokeStyle = 'rgba(255,240,210,0.55)'; ctx.lineWidth = 14; ctx.strokeRect(x + 7, y + 7, 242, 242);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 3; ctx.strokeRect(x + 26, y + 26, 204, 204);
      ctx.fillStyle = fg; ctx.font = '900 170px "Arial Black", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(BLOCK_GLYPHS[i], x + 128, y + 140);
    }
    return new THREE.MeshStandardMaterial({ map: toTex(c, { repeat: false }), roughness: 0.45 });
  });
}

/** Stor leksakskloss (statisk som standard; dynamic: true gör den knuffbar). */
export function addToyBlock(scene, world, RAPIER, { x, z, y = 0, size = 0.5, rotY = 0, seed = 1, dynamic = false, mass = 0.6 } = {}) {
  const spawn = { x, y: y + size / 2 + (dynamic ? 0.005 : 0), z };
  let body = null, mesh = null;
  if (world) {
    if (dynamic) {
      body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y, spawn.z).setRotation(yQuat(rotY)).setLinearDamping(0.1).setAngularDamping(0.3));
      world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2).setDensity(0).setMass(mass).setFriction(0.6).setRestitution(0.15).setCollisionGroups(groups(G.PROP)), body);
    } else body = staticBox(world, RAPIER, size / 2, size / 2, size / 2, spawn.x, spawn.y, spawn.z, rotY, 0.6);
  }
  if (scene) {
    const r = rng(seed * 31 + 5);
    const cells = [];
    for (let f = 0; f < 6; f++) {
      const i = Math.floor(r() * 16);
      cells.push(cellUV((i % 4) * 256 + 2, Math.floor(i / 4) * 256 + 2, 252, 252));
    }
    mesh = new THREE.Mesh(boxAtlasUV(new THREE.BoxGeometry(size, size, size), cells), blockMaterial());
    mesh.position.set(spawn.x, spawn.y, spawn.z);
    mesh.rotation.y = rotY;
    scene.add(shadowed(mesh));
  }
  return { body, mesh, kind: 'block', spawn };
}

function beachBallMaterial() {
  return cached('ballMat', () => {
    const [c, ctx] = canvas(512, 256);
    const gores = ['#e23b2e', '#f4f1e8', '#2b6fd8', '#f7c51e', '#f4f1e8', '#2fa24c'];
    gores.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(i * 512 / 6, 0, 512 / 6 + 1, 256); });
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(0, 0, 512, 22); ctx.fillRect(0, 234, 512, 22);
    return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.3 });
  });
}

/** Badboll (dynamisk som standard). Returnerar { body, mesh } för synk varje frame. */
export function addBeachBall(scene, world, RAPIER, { x, z, y = 0, r = 0.3, mass = 0.08, dynamic = true } = {}) {
  const spawn = { x, y: y + r + (dynamic ? 0.005 : 0), z };
  let body = null, mesh = null;
  if (world) {
    const desc = dynamic
      ? RAPIER.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y, spawn.z).setLinearDamping(0.25).setAngularDamping(0.5)
      : RAPIER.RigidBodyDesc.fixed().setTranslation(spawn.x, spawn.y, spawn.z);
    body = world.createRigidBody(desc);
    let col = RAPIER.ColliderDesc.ball(r).setFriction(0.6).setRestitution(0.75).setCollisionGroups(groups(dynamic ? G.PROP : G.WORLD));
    if (dynamic) col = col.setDensity(0).setMass(mass);
    world.createCollider(col, body);
  }
  if (scene) {
    mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), beachBallMaterial());
    mesh.position.set(spawn.x, spawn.y, spawn.z);
    mesh.rotation.z = 0.4;
    scene.add(shadowed(mesh));
  }
  return { body, mesh, kind: 'ball', spawn };
}

// ===========================================================================
// Kanter som miljön står för: segment längs banans kant (där banan saknar
// vallar) med en collider per segment. Delas av flera nivåer.
// ===========================================================================

/**
 * Kantsegment längs banan från punkten from till to (i körriktningen).
 * side: 1 = vänster, -1 = höger, 0 = båda. offset: avstånd från mittlinjen.
 * Returnerar [{ ax, ay, az, bx, by, bz, side, i }] (ett segment per step meter).
 */
export function edgeSegments(track, from, to, { side = 0, offset = track.roadHalf + 0.12, step = 1.5 } = {}) {
  const { N, pts, normals, spacing } = track;
  const i0 = track.nearest(from[0], from[1]).index, i1 = track.nearest(to[0], to[1]).index;
  const span = (i1 - i0 + N) % N;
  const stride = Math.max(1, Math.round(step / spacing));
  const out = [];
  for (const sd of side ? [side] : [1, -1]) {
    for (let k = 0; k < span; k += stride) {
      const a = (i0 + k) % N, b = (i0 + Math.min(span, k + stride)) % N;
      const p = pts[a], q = pts[b];
      out.push({
        ax: p.x + normals[a].x * offset * sd, ay: p.y, az: p.z + normals[a].z * offset * sd,
        bx: q.x + normals[b].x * offset * sd, by: q.y, bz: q.z + normals[b].z * offset * sd,
        side: sd, i: a,
      });
    }
  }
  return out;
}

/** Colliders för kantsegment: en låda per segment, h hög och thick tjock. */
export function edgeColliders(world, RAPIER, segs, { h = 0.3, thick = 0.14, friction = 0.35 } = {}) {
  if (!world) return;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const s of segs) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az) + thick * 0.6;
    const ang = Math.atan2(s.bx - s.ax, s.bz - s.az);
    const y = Math.min(s.ay, s.by);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(thick / 2, h / 2 + Math.abs(s.by - s.ay) / 2, len / 2)
        .setTranslation((s.ax + s.bx) / 2, y + h / 2 + Math.abs(s.by - s.ay) / 2, (s.az + s.bz) / 2)
        .setRotation(yQuat(ang))
        .setFriction(friction).setRestitution(0.25)
        .setCollisionGroups(groups(G.WORLD)),
      body
    );
  }
}

// ===========================================================================
// Samlad grafik för större rekvisita (truck, pallställ, påkörningsskydd):
// en sammanslagen mesh per material i stället för en per sak.
// ===========================================================================

const BATCH_MATS = {
  card: () => cardboardMaterial(),
  wood: () => cached('woodMatV', () => { const m = woodMaterial().clone(); m.vertexColors = true; return m; }),
  paint: () => cached('paintV', () => new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.08, vertexColors: true })),
  metal: () => cached('metalV', () => new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.75, vertexColors: true })),
  hazard: () => cached('hazardV', () => { const m = hazardMaterial().clone(); m.vertexColors = true; return m; }),
  shade: () => cached('shadeV', () => new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  })),
};

export class WarehouseBatch {
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
  }

  flush(scene) {
    for (const [key, list] of this.lists) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list), BATCH_MATS[key]());
      mesh.castShadow = key !== 'shade';
      mesh.receiveShadow = key !== 'shade';
      scene.add(mesh);
    }
    this.lists.clear();
  }
}

// Låda med UV i meter
function mbox(w, h, d, x = 0, y = 0, z = 0, metres = 1) {
  const g = boxWorldUV(new THREE.BoxGeometry(w, h, d), w, h, d, metres);
  g.translate(x, y, z);
  return g;
}

const place = (x, y, z, rot) => new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);

/** Kartongtrave i en batch (samma utseende som addBoxStack). */
export function addBoxStackB(B, world, RAPIER, { x, z, y = 0, rotY = 0, cols = 2, rows = 2, layers = 2, box = [0.6, 0.45, 0.5], seed = 1 } = {}) {
  const [bw, bh, bd] = box;
  const W = cols * bw, H = layers * bh, D = rows * bd;
  if (world) staticBox(world, RAPIER, W / 2, H / 2, D / 2, x, y + H / 2, z, rotY, 0.8);
  if (!B) return;
  const r = rng(seed * 7919 + 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const M = place(x, y, z, rotY);
  for (let l = 0; l < layers; l++) for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const s = 0.96 + r() * 0.03;
    const g = cardboardGeo(bw * s, bh * 0.995, bd * s, r);
    const jit = l === 0 ? 0.01 : 0.025;
    e.set(0, (r() - 0.5) * (l === 0 ? 0.03 : 0.09) + (r() < 0.25 ? Math.PI : 0), 0);
    q.setFromEuler(e);
    p.set(-W / 2 + bw * (i + 0.5) + (r() - 0.5) * jit, bh * (l + 0.5), -D / 2 + bd * (j + 0.5) + (r() - 0.5) * jit);
    g.applyMatrix4(m.compose(p, q, one));
    g.applyMatrix4(M);
    B.add('card', g, null);
  }
}

function palletGeos() {
  const { w, h, d } = PALLET;
  const geos = [];
  const board = (bw, bh, bd, px, py, pz) => geos.push(mbox(bw, bh, bd, px, py, pz, 0.5));
  const tb = 0.022, blk = 0.078;
  for (const sz of [-1, 0, 1]) board(w, tb, 0.1, 0, tb / 2, sz * (d / 2 - 0.05));
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) board(0.14, blk, sz ? 0.1 : 0.14, sx * (w / 2 - 0.07), tb + blk / 2, sz * (d / 2 - 0.05));
  for (const sx of [-1, 0, 1]) board(0.14, tb, d, sx * (w / 2 - 0.07), tb + blk + tb / 2, 0);
  for (const [pz, bw2] of [[-d / 2 + 0.05, 0.1], [-0.19, 0.12], [0, 0.14], [0.19, 0.12], [d / 2 - 0.05, 0.1]]) board(w, tb, bw2, 0, h - tb / 2, pz);
  return geos;
}

/** Pall (eller en trave tomma pallar) i en batch. */
export function addPalletB(B, world, RAPIER, { x, z, y = 0, rotY = 0, count = 1, seed = 1 } = {}) {
  const { w, h, d } = PALLET;
  if (world) staticBox(world, RAPIER, w / 2, (h * count) / 2, d / 2, x, y + (h * count) / 2, z, rotY, 0.9);
  if (!B) return;
  const r = rng(seed * 37 + 11);
  for (let k = 0; k < count; k++) {
    const M = place(x + (r() - 0.5) * 0.04, y + k * h, z + (r() - 0.5) * 0.04, rotY + (r() - 0.5) * 0.05);
    const tone = 0.85 + r() * 0.2;
    for (const g of palletGeos()) { g.applyMatrix4(M); B.add('wood', g, [tone, tone * 0.97, tone * 0.92]); }
  }
}

/** Pall med kartonger på. */
export function addLoadedPalletB(B, world, RAPIER, { x, z, rotY = 0, layers = 2, seed = 1 } = {}) {
  addPalletB(B, world, RAPIER, { x, z, rotY, seed });
  addBoxStackB(B, world, RAPIER, { x, z, y: PALLET.h, rotY, cols: 2, rows: 1, layers, box: [0.58, 0.42, 0.76], seed });
}

// Pall med kartonger utan collider, placerad med en matris
function loadedPalletGeo(B, M, r, layers, cross = false) {
  const R = new THREE.Matrix4().makeRotationY(cross ? Math.PI / 2 : 0);
  for (const g of palletGeos()) { g.applyMatrix4(R); g.applyMatrix4(M); B.add('wood', g, [0.9, 0.86, 0.8]); }
  for (let l = 0; l < layers; l++) for (let i = 0; i < 2; i++) {
    const g = cardboardGeo(0.54, 0.42, 0.7, r);
    g.translate((i - 0.5) * 0.58, PALLET.h + 0.21 + l * 0.42, 0);
    g.applyMatrix4(R);
    g.applyMatrix4(M);
    B.add('card', g, null);
  }
}

/**
 * Gaffeltruck i verklig storlek (gafflarna mot lokal +z). forkH: gafflarnas
 * höjd, load: en lastad pall på gafflarna.
 */
export function addForklift(B, world, RAPIER, { x, z, rot = 0, forkH = 0.08, load = false, seed = 1 } = {}) {
  if (world) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, z).setRotation(yQuat(rot)));
    const col = (hx, hy, hz, cx, cy, cz) => world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setFriction(0.6).setRestitution(0.1).setCollisionGroups(groups(G.WORLD)), body);
    col(0.6, 0.55, 1.0, 0, 0.55, -0.4); // chassi och motvikt
    col(0.45, 1.15, 0.1, 0, 1.15, 0.68); // masten
    if (forkH < 0.6) col(0.4, 0.05 + (load ? 0.45 : 0), 0.58, 0, forkH + 0.03 + (load ? 0.45 : 0), 1.35);
  }
  if (!B) return;
  const M = place(x, 0, z, rot);
  const add = (key, g, c) => { g.applyMatrix4(M); B.add(key, g, c); };
  const yel = [0.95, 0.66, 0.06], dark = [0.15, 0.15, 0.16], grey = [0.42, 0.43, 0.45], tyre = [0.07, 0.07, 0.075];
  // Chassi, motvikt med rundad rygg och kantlist
  add('paint', mbox(1.1, 0.55, 1.5, 0, 0.5, 0.0), yel);
  add('paint', mbox(1.16, 0.75, 0.5, 0, 0.6, -0.95), yel);
  const back = new THREE.CylinderGeometry(0.375, 0.375, 1.16, 18, 1, false, 0, Math.PI);
  back.rotateZ(Math.PI / 2); back.rotateY(Math.PI / 2); back.translate(0, 0.6, -1.2);
  add('paint', back, yel);
  add('paint', mbox(1.18, 0.08, 1.9, 0, 0.8, -0.2), dark);
  add('paint', mbox(0.9, 0.06, 0.5, 0, 0.82, 0.35), dark);
  add('hazard', mbox(1.17, 0.14, 0.04, 0, 0.32, -1.21, 0.5), [1, 1, 1]);
  // Säte, ratt och rattstång
  add('paint', mbox(0.52, 0.12, 0.46, 0, 0.98, -0.42), dark);
  add('paint', mbox(0.52, 0.5, 0.1, 0, 1.25, -0.66), dark);
  const col = new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8); col.rotateX(-0.5); col.translate(0, 1.05, 0.25); add('metal', col, grey);
  const wheel = new THREE.TorusGeometry(0.16, 0.022, 6, 18); wheel.rotateX(Math.PI / 2 - 0.5); wheel.translate(0, 1.3, 0.12); add('paint', wheel, dark);
  // Skyddstak: fyra stolpar och ett galler, varningsljus
  for (const [px, pz] of [[-0.5, -0.82], [0.5, -0.82], [-0.5, 0.42], [0.5, 0.42]]) add('paint', mbox(0.07, 1.3, 0.07, px, 1.42, pz), dark);
  add('paint', mbox(1.08, 0.06, 1.34, 0, 2.08, -0.2), dark);
  for (let k = -2; k <= 2; k++) add('paint', mbox(0.035, 0.035, 1.3, k * 0.2, 2.12, -0.2), dark);
  add('paint', mbox(0.12, 0.1, 0.12, 0.38, 2.17, -0.75), [1, 0.45, 0.05]);
  // Mast, vagn och gafflar
  for (const s of [-1, 1]) add('metal', mbox(0.09, 2.3, 0.14, s * 0.34, 1.2, 0.68), grey);
  for (const yy of [0.25, 1.3, 2.3]) add('metal', mbox(0.76, 0.07, 0.08, 0, yy, 0.68), grey);
  const fy = forkH;
  add('paint', mbox(0.9, 0.42, 0.05, 0, fy + 0.24, 0.78), dark);
  for (const s of [-1, 1]) {
    add('metal', mbox(0.1, 0.045, 1.1, s * 0.26, fy + 0.02, 1.35), grey);
    add('metal', mbox(0.1, 0.4, 0.045, s * 0.26, fy + 0.22, 0.81), grey);
  }
  // Hjul med fälgar
  const wheelGeo = (R, W, px, pz) => {
    const t = new THREE.CylinderGeometry(R, R, W, 20); t.rotateZ(Math.PI / 2); t.translate(px, R, pz); add('paint', t, tyre);
    const h = new THREE.CylinderGeometry(R * 0.55, R * 0.55, W + 0.02, 12); h.rotateZ(Math.PI / 2); h.translate(px, R, pz); add('paint', h, [0.75, 0.75, 0.72]);
  };
  for (const s of [-1, 1]) { wheelGeo(0.3, 0.24, s * 0.5, 0.38); wheelGeo(0.24, 0.2, s * 0.5, -0.9); }
  if (load) {
    const PM = new THREE.Matrix4().makeTranslation(0, fy + 0.045, 1.35).premultiply(M);
    loadedPalletGeo(B, PM, rng(seed), 2, true);
  }
}

/**
 * Pallställ som banan kör rakt igenom (en tunnel av hyllor). Banan går från
 * (ax, az) till (bx, bz); clear = halva fria bredden.
 */
export function addRackTunnel(B, world, RAPIER, { ax, az, bx, bz, clear = 1.95, depth = 1.15, levels = [1.32, 2.55], top = 3.7, seed = 1 } = {}) {
  const L = Math.hypot(bx - ax, bz - az), rot = Math.atan2(bx - ax, bz - az);
  const cx = (ax + bx) / 2, cz = (az + bz) / 2;
  const deckY = levels[0];
  if (world) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, 0, cz).setRotation(yQuat(rot)));
    const col = (hx, hy, hz, x, y, z) => world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.5).setCollisionGroups(groups(G.WORLD)), body);
    for (const s of [-1, 1]) col(depth / 2 + 0.05, top / 2, L / 2 + 0.05, s * (clear + depth / 2), top / 2, 0);
    col(clear + 0.05, 0.08, L / 2 + 0.05, 0, deckY + 0.08, 0); // däcket över vägen
  }
  if (!B) return;
  const M = place(cx, 0, cz, rot);
  const add = (key, g, c) => { g.applyMatrix4(M); B.add(key, g, c); };
  const blue = [0.12, 0.3, 0.62], orange = [0.93, 0.42, 0.08], grey = [0.5, 0.5, 0.52];
  const bays = Math.max(2, Math.round(L / 2.75));
  const frames = [];
  for (let k = 0; k <= bays; k++) frames.push(-L / 2 + (L * k) / bays);
  // Stolpar (inre och yttre rad på båda sidor) med fotplattor och stag
  for (const v of frames) for (const s of [-1, 1]) {
    for (const u of [clear, clear + depth]) {
      add('paint', mbox(0.09, top, 0.07, s * u, top / 2, v), blue);
      add('metal', mbox(0.16, 0.012, 0.14, s * u, 0.006, v), grey);
    }
    for (let k = 0; k < 4; k++) {
      const y0 = 0.25 + (k * (top - 0.4)) / 4, y1 = y0 + (top - 0.4) / 4;
      const a = new THREE.Vector3(s * clear, k % 2 ? y1 : y0, v), b = new THREE.Vector3(s * (clear + depth), k % 2 ? y0 : y1, v);
      const g = mbox(0.03, a.distanceTo(b), 0.03);
      g.applyMatrix4(new THREE.Matrix4().makeRotationZ(-Math.atan2(b.x - a.x, b.y - a.y)));
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, v);
      add('paint', g, blue);
    }
  }
  // Balkar längs hyllorna och tvärs över vägen, däck av spånskiva
  for (const y of levels) {
    for (const s of [-1, 1]) for (const u of [clear, clear + depth]) add('paint', mbox(0.05, 0.12, L, s * u, y - 0.06, 0), orange);
    for (const v of frames) add('paint', mbox(clear * 2, 0.12, 0.05, 0, y - 0.06, v), orange);
    add('wood', mbox(clear * 2 + depth * 2, 0.03, L, 0, y + 0.015, 0, 1.2), [0.82, 0.7, 0.55]);
  }
  // Lastade pallar: i ytterhyllorna på alla plan, över vägen på hyllplanen
  const r = rng(seed * 101 + 7);
  for (let b = 0; b < bays; b++) {
    const v = (frames[b] + frames[b + 1]) / 2;
    for (const y of [0, ...levels]) {
      const y0 = y ? y + 0.03 : 0;
      for (const s of [-1, 1]) {
        if (r() < 0.15) continue;
        loadedPalletGeo(B, new THREE.Matrix4().makeTranslation(s * (clear + depth / 2), y0, v).premultiply(M), r, 1 + Math.floor(r() * 2.2), true);
      }
      if (!y) continue;
      for (const s of [-1, 1]) {
        if (r() < 0.2) continue;
        loadedPalletGeo(B, new THREE.Matrix4().makeTranslation(s * 0.72, y0, v).premultiply(M), r, 1 + Math.floor(r() * 2.2), false);
      }
    }
  }
  // Mörker under däcket
  const shade = new THREE.PlaneGeometry(clear * 2 + 0.4, L + 1.2);
  shade.rotateX(-Math.PI / 2);
  shade.translate(0, 0.02, 0);
  add('shade', shade, [1, 1, 1]);
}

/** Påkörningsskydd i gult stål längs kantsegment (från edgeSegments). */
export function addGuardRail(B, segs, { h = 0.34 } = {}) {
  if (!B) return;
  const yel = [0.98, 0.72, 0.06], grey = [0.45, 0.45, 0.47];
  for (const s of segs) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az), rot = Math.atan2(s.bx - s.ax, s.bz - s.az);
    const M = place((s.ax + s.bx) / 2, Math.min(s.ay, s.by), (s.az + s.bz) / 2, rot);
    const add = (key, g, c) => { g.applyMatrix4(M); B.add(key, g, c); };
    add('paint', mbox(0.09, h, 0.09, 0, h / 2, -len / 2), yel);
    add('metal', mbox(0.18, 0.01, 0.18, 0, 0.005, -len / 2), grey);
    add('hazard', mbox(0.05, 0.14, len + 0.04, 0, 0.12, 0, 0.5), [1, 1, 1]);
    add('paint', mbox(0.06, 0.09, len + 0.04, 0, h - 0.06, 0), yel);
  }
}

/** Plankor och pallar som klär en hoppramp (vägpunkter i0..i1 längs rampen). */
export function addPlankRamp(B, path, i0, i1) {
  if (!B) return;
  const { pts, normals, roadHalf } = path;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = i0; i < i1; i++) {
    const p = pts[i], q = pts[i + 1];
    const a = new THREE.Vector3(p.x, p.y + 0.016, p.z), b = new THREE.Vector3(q.x, q.y + 0.016, q.z);
    const g = mbox(roadHalf * 2 * 0.98, 0.03, a.distanceTo(b) + 0.012, 0, 0, 0, 0.6);
    g.applyMatrix4(new THREE.Matrix4().lookAt(a, b, up));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    const tone = 0.82 + ((i * 7) % 5) * 0.045;
    B.add('wood', g, [tone, tone * 0.95, tone * 0.88]);
  }
  // Pallar staplade under rampens höga ände
  const e = pts[i1], n = normals[i1];
  const rot = Math.atan2(n.x, n.z);
  const back = Math.hypot(e.x - pts[i1 - 1].x, e.z - pts[i1 - 1].z) || 1;
  const bx = (e.x - pts[i1 - 1].x) / back, bz = (e.z - pts[i1 - 1].z) / back;
  const count = Math.max(1, Math.floor(e.y / PALLET.h));
  for (let k = 0; k < count; k++) {
    const M = place(e.x - bx * 0.42, k * PALLET.h, e.z - bz * 0.42, rot);
    for (const g of palletGeos()) { g.applyMatrix4(M); B.add('wood', g, [0.8, 0.76, 0.7]); }
  }
}
