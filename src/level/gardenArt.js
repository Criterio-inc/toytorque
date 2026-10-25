import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G, groups } from '../core/physics.js';
import { rng } from './warehouseArt.js';
import { bankY } from '../track/track.js';

// ---------------------------------------------------------------------------
// Procedurell grafik för den botaniska trädgården: gräsmatta, grusgång,
// stenmurar med mossa, damm och kanal med krusningar, stenbro, växthus i glas
// och järn, krukor, palmer, häckar och buskar. Allt ritas i canvas.
//
// Samma mönster som warehouseArt.js: (scene, world, RAPIER, opts). Utan scene
// byggs bara fysiken, utan world bara grafiken. Texturer och material cachas
// på modulnivå. Upprepade saker blir InstancedMesh, resten slås ihop per material.
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

const yQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const UP = new THREE.Vector3(0, 1, 0);

function fixedBody(world, RAPIER) {
  return world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
}
function boxCollider(world, RAPIER, body, hx, hy, hz, x, y, z, rotY = 0, friction = 0.7) {
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(yQuat(rotY))
      .setFriction(friction).setRestitution(0.1).setCollisionGroups(groups(G.WORLD)),
    body
  );
}
function cylCollider(world, RAPIER, body, r, h, x, y0, z) {
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(x, y0 + h / 2, z)
      .setFriction(0.6).setRestitution(0.2).setCollisionGroups(groups(G.WORLD)),
    body
  );
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

function wrapDraw(w, h, x, y, rad, fn) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
    if (x + ox + rad < 0 || x + ox - rad > w || y + oy + rad < 0 || y + oy - rad > h) continue;
    fn(x + ox, y + oy);
  }
}

const jit = (r, c, a) => c.map((v) => Math.max(0, Math.min(255, Math.round(v + (r() - 0.5) * a))));
const rgba = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`;

// --- geometrihjälp ---------------------------------------------------------

// Slår ihop geometrier med gemensam uppsättning attribut (allt görs oindexerat)
function mergeAll(geos, attrs = ['position', 'normal', 'uv']) {
  const list = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!attrs.includes(k)) n.deleteAttribute(k);
    return n;
  });
  return mergeGeometries(list);
}

// Vänder trianglarnas varv (efter spegling)
function flipWinding(geo) {
  for (const a of Object.values(geo.attributes)) {
    const s = a.itemSize;
    for (let t = 0; t < a.count; t += 3) for (let k = 0; k < s; k++) {
      const i1 = (t + 1) * s + k, i2 = (t + 2) * s + k;
      const v = a.array[i1]; a.array[i1] = a.array[i2]; a.array[i2] = v;
    }
  }
  return geo;
}

// UV ur världskoordinater (planprojektion uppifrån)
function planarUV(geo, metres, ox = 0, oz = 0) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + ox) / metres; uv[i * 2 + 1] = (p.getZ(i) + oz) / metres; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function boxWorldUV(geo, w, h, d, metres) {
  const uv = geo.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * faces[f][0] / metres, uv.getY(k) * faces[f][1] / metres);
  }
  return geo;
}

// Låda (bjälke) mellan två punkter
const _bm = new THREE.Matrix4(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
function beam(a, b, w, h) {
  _bz.subVectors(b, a);
  const len = _bz.length();
  _bz.normalize();
  _bx.crossVectors(Math.abs(_bz.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : UP, _bz).normalize();
  _by.crossVectors(_bz, _bx);
  const g = new THREE.BoxGeometry(w, h, len);
  _bm.makeBasis(_bx, _by, _bz).setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g.applyMatrix4(_bm);
}

function shadowed(mesh, cast = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

// ===========================================================================
// Texturer
// ===========================================================================

const LAWN_TILE = 5;

function lawnTexture() {
  return cached('lawn', () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [84, 122, 48], { cells: 3, oct: 6, amt: 0.34, grain: 12, seed: 101 });
    const r = rng(102);
    // Mjuka fläckar: torrare och frodigare gräs
    for (let i = 0; i < 36; i++) {
      const x = r() * S, y = r() * S, rad = 60 + r() * 180;
      const dry = r() < 0.45;
      wrapDraw(S, S, x, y, rad, (px, py) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, dry ? 'rgba(150,150,70,0.14)' : 'rgba(30,70,20,0.14)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    // Grässtrån i några färgskikt (en path per skikt)
    const shades = [[46, 82, 28, 0.55], [62, 104, 36, 0.5], [96, 140, 56, 0.45], [128, 168, 72, 0.4], [150, 176, 90, 0.3]];
    ctx.lineCap = 'round';
    for (const [R, G_, B, a] of shades) {
      ctx.strokeStyle = `rgba(${R},${G_},${B},${a})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < 14000; i++) {
        const x = r() * S, y = r() * S, len = 4 + r() * 8, a2 = -Math.PI / 2 + (r() - 0.5) * 1.3;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a2) * len, y + Math.sin(a2) * len);
      }
      ctx.stroke();
    }
    // Klöverplättar
    for (let i = 0; i < 40; i++) {
      const x = r() * S, y = r() * S;
      for (let k = 0; k < 14; k++) {
        ctx.fillStyle = `rgba(${70 + r() * 30},${120 + r() * 30},${50 + r() * 20},0.6)`;
        ctx.beginPath(); ctx.arc(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30, 2 + r() * 2, 0, 7); ctx.fill();
      }
    }
    return toTex(c);
  });
}

function gravelTexture() {
  return cached('gravel', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [168, 152, 124], { cells: 4, oct: 5, amt: 0.25, grain: 16, seed: 111 });
    const r = rng(112);
    const pal = [[214, 200, 172], [190, 172, 140], [228, 220, 202], [160, 146, 120], [184, 172, 154], [148, 130, 106], [206, 190, 164], [172, 164, 156], [196, 150, 112]];
    for (let i = 0; i < 3400; i++) {
      const x = r() * S, y = r() * S, rad = 2.5 + Math.pow(r(), 2) * 8, ry = rad * (0.6 + r() * 0.4), rot = r() * Math.PI;
      const col = jit(r, pal[Math.floor(r() * pal.length)], 22);
      wrapDraw(S, S, x, y, rad + 3, (px, py) => {
        ctx.fillStyle = 'rgba(70,58,40,0.35)';
        ctx.beginPath(); ctx.ellipse(px + 1.2, py + 1.8, rad, ry, rot, 0, 7); ctx.fill();
        ctx.fillStyle = rgba(col);
        ctx.beginPath(); ctx.ellipse(px, py, rad, ry, rot, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,252,240,0.28)';
        ctx.beginPath(); ctx.ellipse(px - rad * 0.3, py - ry * 0.35, rad * 0.45, ry * 0.35, rot, 0, 7); ctx.fill();
      });
    }
    return toTex(c);
  });
}

// Stenmur: 2 m bred, en murhöjd hög (v = 0 nere, 1 uppe), mossa längs krönet
function stoneTextures() {
  return cached('stone', () => {
    const W = 512, H = 256, rows = 4, rowH = H / rows;
    const [c, ctx] = canvas(W, H);
    const [bc, bctx] = canvas(W, H);
    paintNoise(ctx, W, H, [128, 124, 114], { cells: 4, oct: 4, amt: 0.2, grain: 10, seed: 121 });
    bctx.fillStyle = '#202020';
    bctx.fillRect(0, 0, W, H);
    const r = rng(122);
    for (let row = 0; row < rows; row++) {
      const y0 = row * rowH;
      let x = r() * 60;
      const xEnd = x + W;
      while (x < xEnd) {
        const bw = Math.min(xEnd - x, 48 + r() * 70);
        const g = 132 + r() * 40, warm = (r() - 0.5) * 14;
        const col = [g + warm, g + warm * 0.4, g - warm * 0.6 - 6];
        for (const ox of [0, -W]) {
          const bx = x + ox + 2, by = y0 + 2, w = bw - 4, h = rowH - 4;
          ctx.fillStyle = rgba(col.map(Math.round));
          ctx.beginPath(); ctx.roundRect(bx, by, w, h, 5); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,245,0.18)'; ctx.fillRect(bx + 3, by, w - 6, 3);
          ctx.fillStyle = 'rgba(30,30,25,0.22)'; ctx.fillRect(bx + 3, by + h - 4, w - 6, 4);
          // Höjd för bumpmap: kuddiga block
          const gr = bctx.createLinearGradient(0, by, 0, by + h);
          gr.addColorStop(0, '#9a9a9a'); gr.addColorStop(0.2, '#e0e0e0'); gr.addColorStop(0.8, '#d0d0d0'); gr.addColorStop(1, '#808080');
          bctx.fillStyle = gr;
          bctx.beginPath(); bctx.roundRect(bx, by, w, h, 6); bctx.fill();
        }
        x += bw;
      }
    }
    // Brus ovanpå blocken
    const n = valueNoise(W, H, 8, 4, rng(123));
    const img = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < W * H; i++) {
      const k = 0.82 + 0.36 * n[i];
      img.data[i * 4] *= k; img.data[i * 4 + 1] *= k; img.data[i * 4 + 2] *= k;
    }
    ctx.putImageData(img, 0, 0);
    // Mossa: tät längs krönet, glesare nedåt och i fogarna
    for (let i = 0; i < 1600; i++) {
      const x = r() * W;
      const y = Math.pow(r(), 2.6) * H * 0.9;
      const rad = 2 + r() * (y < 30 ? 10 : 5);
      const a = 0.25 + 0.5 * (1 - y / H);
      wrapDraw(W, H, x, y, rad, (px, py) => {
        ctx.fillStyle = `rgba(${60 + r() * 50},${96 + r() * 50},${30 + r() * 20},${a})`;
        ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.fill();
      });
    }
    // Mörka vattenränder under krönet
    for (let i = 0; i < 26; i++) {
      const x = r() * W, len = 20 + r() * 90;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(50,55,40,0.22)'); g.addColorStop(1, 'rgba(50,55,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 3 + r() * 8, len);
    }
    const map = toTex(c);
    const bump = toTex(bc, { srgb: false });
    return { map, bump };
  });
}

function stoneMaterial() {
  return cached('stoneMat', () => {
    const { map, bump } = stoneTextures();
    return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 2.5, roughness: 0.88 });
  });
}

function mossMaterial() {
  return cached('mossMat', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [74, 108, 40], { cells: 4, oct: 5, amt: 0.5, grain: 18, seed: 131 });
    const r = rng(132);
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = r() < 0.7 ? `rgba(${110 + r() * 50},${140 + r() * 40},${50 + r() * 20},0.5)` : 'rgba(40,50,25,0.4)';
      ctx.beginPath(); ctx.arc(r() * S, r() * S, 1 + r() * 3, 0, 7); ctx.fill();
    }
    return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.95 });
  });
}

function soilMaterial() {
  return cached('soilMat', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [74, 54, 38], { cells: 4, oct: 5, amt: 0.4, grain: 20, seed: 141 });
    const r = rng(142);
    for (let i = 0; i < 700; i++) {
      const v = 60 + r() * 70;
      ctx.fillStyle = r() < 0.15 ? `rgba(${v + 60},${v + 40},${v + 10},0.7)` : `rgba(${v * 0.6},${v * 0.42},${v * 0.3},0.6)`;
      ctx.beginPath(); ctx.ellipse(r() * S, r() * S, 1 + r() * 3, 1 + r() * 2, r() * 3, 0, 7); ctx.fill();
    }
    return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 1 });
  });
}

// Oregelbundna stenplattor med mossa i fogarna (2,4 m per textur)
function paveMaterial() {
  return cached('paveMat', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [86, 104, 60], { cells: 4, oct: 4, amt: 0.3, grain: 10, seed: 151 });
    const r = rng(152);
    const split = (x, y, w, h, d) => {
      if (d > 3 || (w < 110 && h < 110) || (d > 1 && r() < 0.2)) {
        const g = 150 + r() * 45, warm = (r() - 0.3) * 18;
        ctx.fillStyle = rgba([g + warm, g + warm * 0.5, g - warm * 0.3 - 8].map(Math.round));
        ctx.beginPath(); ctx.roundRect(x + 3, y + 3, w - 6, h - 6, 6); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,245,0.12)'; ctx.fillRect(x + 6, y + 4, w - 12, 3);
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = `rgba(90,85,75,${0.06 + r() * 0.08})`;
          ctx.beginPath(); ctx.arc(x + r() * w, y + r() * h, 4 + r() * 16, 0, 7); ctx.fill();
        }
        return;
      }
      if (w > h) { const k = w * (0.35 + r() * 0.3); split(x, y, k, h, d + 1); split(x + k, y, w - k, h, d + 1); }
      else { const k = h * (0.35 + r() * 0.3); split(x, y, w, k, d + 1); split(x, y + k, w, h - k, d + 1); }
    };
    split(0, 0, S, S, 0);
    const map = toTex(c);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.85 });
  });
}

function hedgeMaterial() {
  return cached('hedgeMat', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [30, 56, 24], { cells: 4, oct: 4, amt: 0.4, grain: 10, seed: 161 });
    const r = rng(162);
    for (let i = 0; i < 2600; i++) {
      const x = r() * S, y = r() * S, l = 3 + r() * 4;
      const v = r();
      const col = v < 0.3 ? [34, 66, 26] : v < 0.75 ? [58, 98, 40] : [96, 140, 60];
      wrapDraw(S, S, x, y, l, (px, py) => {
        ctx.fillStyle = rgba(jit(r, col, 20), 0.9);
        ctx.beginPath(); ctx.ellipse(px, py, l, l * 0.55, r() * 3.2, 0, 7); ctx.fill();
      });
    }
    return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.9 });
  });
}

// Bladkort med alfa: 'bush' (rund buske), 'fern' (tropiska blad), 'flower' (blommor)
function leafTexture(kind) {
  return cached('leafTex_' + kind, () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    ctx.clearRect(0, 0, S, S);
    const r = rng({ bush: 171, fern: 172, flower: 173 }[kind]);
    const leaf = (x, y, len, wid, a, col) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = rgba(col);
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(wid, -len * 0.45, 0, -len); ctx.quadraticCurveTo(-wid, -len * 0.45, 0, 0);
      ctx.fill();
      ctx.strokeStyle = rgba(col.map((v) => Math.min(255, v + 40)), 0.6); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -len * 0.9); ctx.stroke();
      ctx.restore();
    };
    if (kind === 'fern') {
      for (let k = 0; k < 11; k++) {
        const a = (k / 10 - 0.5) * 2.4 + (r() - 0.5) * 0.2;
        const L = 150 + r() * 90, bx = 128 + (r() - 0.5) * 16;
        const tipx = bx + Math.sin(a) * L, tipy = 256 - Math.cos(a) * L;
        // Stjälk
        ctx.strokeStyle = 'rgb(70,100,40)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(bx, 256); ctx.quadraticCurveTo(bx + Math.sin(a) * L * 0.3, 256 - L * 0.5, tipx, tipy); ctx.stroke();
        // Brett blad längs övre halvan
        const sx = bx + Math.sin(a) * L * 0.35, sy = 256 - Math.cos(a) * L * 0.4;
        const col = jit(r, r() < 0.5 ? [52, 112, 40] : [74, 136, 52], 25);
        const ang = Math.atan2(tipx - sx, -(tipy - sy));
        leaf(sx, sy, Math.hypot(tipx - sx, tipy - sy) * 1.05, 20 + r() * 18, ang, col);
        if (r() < 0.35) leaf(sx, sy, Math.hypot(tipx - sx, tipy - sy) * 0.9, 4, ang, [200, 210, 120]);
      }
    } else {
      for (let i = 0; i < 520; i++) {
        let x, y;
        do { x = r() * S; y = 30 + r() * 226; } while (((x - 128) / 118) ** 2 + ((y - 150) / 112) ** 2 > 1);
        const shade = 0.6 + 0.4 * (1 - (y - 30) / 226) + (r() - 0.5) * 0.25;
        const base = kind === 'flower' ? [44, 96, 36] : [56, 110, 40];
        leaf(x, y, 12 + r() * 10, 5 + r() * 4, r() * 6.3, base.map((v) => Math.round(v * shade + (r() - 0.5) * 16)));
      }
      if (kind === 'flower') {
        const pal = [[232, 64, 90], [250, 140, 170], [255, 214, 70], [250, 250, 240], [200, 60, 160], [255, 120, 50]];
        for (let i = 0; i < 70; i++) {
          let x, y;
          do { x = r() * S; y = 30 + r() * 180; } while (((x - 128) / 110) ** 2 + ((y - 140) / 100) ** 2 > 1);
          const col = pal[Math.floor(r() * pal.length)], pr = 4 + r() * 4;
          ctx.fillStyle = rgba(col);
          for (let p = 0; p < 5; p++) {
            const a = (p / 5) * Math.PI * 2;
            ctx.beginPath(); ctx.arc(x + Math.cos(a) * pr * 0.7, y + Math.sin(a) * pr * 0.7, pr * 0.6, 0, 7); ctx.fill();
          }
          ctx.fillStyle = 'rgb(250,220,80)';
          ctx.beginPath(); ctx.arc(x, y, pr * 0.35, 0, 7); ctx.fill();
        }
      }
    }
    return toTex(c, { repeat: false });
  });
}

function frondTexture() {
  return cached('frondTex', () => {
    const W = 512, H = 128;
    const [c, ctx] = canvas(W, H);
    ctx.clearRect(0, 0, W, H);
    const r = rng(181);
    ctx.lineCap = 'round';
    for (let x = 18; x < 500; x += 6) {
      const u = x / 500;
      const L = 60 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.9 + 0.08)), 0.8) * (1 - u * 0.35);
      for (const s of [1, -1]) {
        const col = jit(r, [62 + u * 20, 118 + u * 10, 40], 26);
        ctx.strokeStyle = rgba(col);
        ctx.lineWidth = 3.2 - u * 1.2;
        const ex = x + L * 0.55, ey = 64 + s * L * (0.95 + (r() - 0.5) * 0.1);
        ctx.beginPath(); ctx.moveTo(x, 64); ctx.quadraticCurveTo(x + L * 0.15, 64 + s * L * 0.6, ex, ey); ctx.stroke();
      }
    }
    // Mittnerv
    ctx.strokeStyle = 'rgb(120,130,60)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(505, 64); ctx.stroke();
    return toTex(c, { repeat: false });
  });
}

function barkMaterial() {
  return cached('barkMat', () => {
    const S = 128;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [120, 98, 72], { cells: 4, oct: 4, amt: 0.3, grain: 14, seed: 191 });
    const r = rng(192);
    // Ringar av bladfästen
    for (let row = 0; row < 4; row++) {
      const y = row * 32;
      for (let x = 0; x < S; x += 16) {
        const ox = (row % 2) * 8;
        ctx.fillStyle = `rgba(${150 + r() * 30},${125 + r() * 25},${90 + r() * 20},0.9)`;
        ctx.beginPath(); ctx.moveTo(x + ox - 9, y + 26); ctx.lineTo(x + ox, y + 4); ctx.lineTo(x + ox + 9, y + 26); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = 'rgba(50,38,26,0.6)'; ctx.fillRect(0, y + 26, S, 4);
    }
    return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.95 });
  });
}

function potMaterial() {
  return cached('potMat', () => {
    const S = 128;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [235, 235, 235], { cells: 4, oct: 4, amt: 0.25, grain: 18, seed: 201 });
    const r = rng(202);
    // Kalkutfällning nertill
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(r() * S, S - Math.pow(r(), 2) * 40, 2 + r() * 5, 0, 7); ctx.fill();
    }
    return new THREE.MeshStandardMaterial({ map: toTex(c), vertexColors: true, roughness: 0.85 });
  });
}

function woodMaterial() {
  return cached('woodMat', () => {
    const [c, ctx] = canvas(256, 64);
    paintNoise(ctx, 256, 64, [150, 104, 64], { cells: 8, oct: 3, amt: 0.25, grain: 10, seed: 211 });
    const r = rng(212);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(80,50,28,${0.15 + r() * 0.2})`;
      ctx.lineWidth = 1;
      const y = r() * 64;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(80, y + (r() - 0.5) * 6, 170, y + (r() - 0.5) * 6, 256, y); ctx.stroke();
    }
    return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.7 });
  });
}

// ===========================================================================
// Mark: gräsmatta inne i växthuset och en park utanför glaset
// ===========================================================================

export function makeLawn(scene, world, RAPIER, { size }) {
  const half = size / 2;
  if (world) {
    const body = fixedBody(world, RAPIER);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0).setFriction(1).setCollisionGroups(groups(G.WORLD)),
      body
    );
  }
  if (!scene) return;
  const map = lawnTexture().clone();
  map.repeat.set(size / LAWN_TILE, size / LAWN_TILE);
  map.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(size, size, 48, 48);
  geo.rotateX(-Math.PI / 2);
  // Stora färgskiftningar i vertexfärger så upprepningen inte syns
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const n = 0.5 + 0.25 * Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.093) + 0.25 * Math.sin((x + z) * 0.05 + 2);
    col[i * 3] = 0.82 + n * 0.22; col[i * 3 + 1] = 0.86 + n * 0.16; col[i * 3 + 2] = 0.8 + n * 0.12;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const lawn = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.95, envMapIntensity: 0.3 }));
  lawn.receiveShadow = true;
  scene.add(lawn);

  // Parken utanför: stor plan och dunkla trädkronor i diset
  const outer = new THREE.Mesh(new THREE.RingGeometry(half - 0.5, 260, 48, 1), new THREE.MeshStandardMaterial({ color: 0x5f8a3e, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  scene.add(outer);
  const r = rng(221);
  const n = 60;
  // Knöliga kronor: ikosaeder med brus i radien
  const crown = new THREE.IcosahedronGeometry(1, 3);
  const cp = crown.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(cp, i);
    const k = 1 + 0.12 * Math.sin(v.x * 5.1 + v.y * 3.3) * Math.cos(v.z * 4.7 - v.y * 2.1) + 0.06 * Math.sin(v.y * 11 + v.x * 7);
    cp.setXYZ(i, v.x * k, v.y * k * 0.8, v.z * k);
  }
  crown.computeVertexNormals();
  const trees = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0x4d7a36, roughness: 1 }), n);
  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 1, 1, 7).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.1, d = half + 45 + r() * 50, s = 6 + r() * 7;
    m.compose(new THREE.Vector3(Math.cos(a) * d, s * 1.35, Math.sin(a) * d), q, new THREE.Vector3(s, s * (0.9 + r() * 0.5), s));
    trees.setMatrixAt(i, m);
    trees.setColorAt(i, c.setHSL(0.25 + r() * 0.06, 0.4, 0.28 + r() * 0.1));
    m.compose(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), q, new THREE.Vector3(s * 0.12, s * 0.8, s * 0.12));
    stems.setMatrixAt(i, m);
  }
  scene.add(trees, stems);
}

// ===========================================================================
// Grusgången: eget ytskikt ovanpå banans väg
// ===========================================================================

export function makeGravelPath(scene, track, { tile = 1.2 } = {}) {
  if (!scene) return;
  const { pts, normals, N, roadHalf, isGap, dist } = track;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const p = pts[i % N], n = normals[i % N];
    const y = p.y + 0.005, dy = bankY(track, i, roadHalf);
    pos.push(p.x + n.x * roadHalf, y + dy, p.z + n.z * roadHalf, p.x - n.x * roadHalf, y - dy, p.z - n.z * roadHalf);
    const v = (dist[i] ?? track.length) / tile;
    uv.push(0, v, (roadHalf * 2) / tile, v);
  }
  for (let i = 0; i < N; i++) {
    if (isGap[i] || isGap[(i + 1) % N]) continue;
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: gravelTexture(), roughness: 0.93, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -2,
  }));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// ===========================================================================
// Stenmurar, upphöjda bäddar, terrass och trappsteg
// ===========================================================================

/**
 * walls: [{ x, z, w, d, h, rotY, top: 'moss'|'soil'|'pave', y }] (w längs lokala x).
 * En mesh per material: stensidor, mosskrön, jord och plattor. En kolliderare per låda.
 */
export function addStoneWalls(scene, world, RAPIER, walls) {
  if (world) {
    const body = fixedBody(world, RAPIER);
    for (const W of walls) boxCollider(world, RAPIER, body, W.w / 2, W.h / 2, W.d / 2, W.x, (W.y ?? 0) + W.h / 2, W.z, W.rotY ?? 0, 0.6);
  }
  if (!scene) return;
  const sides = [], moss = [], soil = [], pave = [];
  const m4 = new THREE.Matrix4();
  for (const W of walls) {
    const y0 = W.y ?? 0;
    m4.makeRotationY(W.rotY ?? 0).setPosition(W.x, y0, W.z);
    // Sidor: u i meter längs muren (2 m per textur), v över murhöjden
    const hw = W.w / 2, hd = W.d / 2;
    const cs = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const pos = [], uv = [];
    let u = 0;
    for (let k = 0; k < 4; k++) {
      const [ax, az] = cs[k], [bx, bz] = cs[(k + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      // Moturs sett ovanifrån ger utåtvända sidor med ordningen a0, a1, b1 / a0, b1, b0
      pos.push(ax, 0, az, ax, W.h, az, bx, W.h, bz, ax, 0, az, bx, W.h, bz, bx, 0, bz);
      uv.push(u, 0, u, 1, u + len / 2, 1, u, 0, u + len / 2, 1, u + len / 2, 0);
      u += len / 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    sides.push(g.applyMatrix4(m4));

    const top = W.top ?? 'moss';
    if (top === 'moss') {
      const cap = boxWorldUV(new THREE.BoxGeometry(W.w + 0.05, 0.05, W.d + 0.05), W.w + 0.05, 0.05, W.d + 0.05, 0.8);
      cap.translate(0, W.h + 0.015, 0);
      moss.push(cap.applyMatrix4(m4));
    } else {
      const plane = new THREE.PlaneGeometry(W.w, W.d);
      plane.rotateX(-Math.PI / 2);
      plane.translate(0, W.h + 0.002, 0);
      plane.applyMatrix4(m4);
      (top === 'soil' ? soil : pave).push(planarUV(plane, top === 'soil' ? 1.2 : 2.4));
      if (top === 'soil') {
        // Mosskant runt jorden
        const t = 0.16;
        for (const [bw, bd, bx, bz] of [[W.w + 0.04, t, 0, -hd + t / 2], [W.w + 0.04, t, 0, hd - t / 2], [t, W.d, -hw + t / 2, 0], [t, W.d, hw - t / 2, 0]]) {
          const cap = boxWorldUV(new THREE.BoxGeometry(bw, 0.06, bd), bw, 0.06, bd, 0.8);
          cap.translate(bx, W.h + 0.02, bz);
          moss.push(cap.applyMatrix4(m4));
        }
      }
    }
  }
  const add = (list, mat, cast = true) => {
    if (!list.length) return;
    scene.add(shadowed(new THREE.Mesh(mergeAll(list), mat), cast));
  };
  add(sides, stoneMaterial());
  add(moss, mossMaterial());
  add(soil, soilMaterial(), false);
  add(pave, paveMaterial(), false);
}

// Trappa: steg som lådor (för addStoneWalls) upp mot en terrass med höjd h
export function stairs({ x, z, h, rotY = 0, width = 2.4, steps = 3, depth = 0.38 }) {
  const out = [];
  const dir = { x: Math.cos(rotY), z: -Math.sin(rotY) }; // lokala +x: ut från terrassen
  for (let k = 0; k < steps; k++) {
    const sh = h * (steps - k) / (steps + 1);
    const off = depth * (k + 0.5);
    out.push({ x: x + dir.x * off, z: z + dir.z * off, w: depth, d: width, h: sh, rotY, top: 'pave' });
  }
  return out;
}

// ===========================================================================
// Damm, kanal och fontän
// ===========================================================================

const WATER_Y = 0.17;

/** Stenkanter runt dammen och kanalen, som murar för addStoneWalls. */
export function waterRims({ pond, channel, rimW = 0.35, rimH = 0.3 }) {
  const out = [];
  const R = pond.r + rimW / 2;
  const n = 40;
  for (let k = 0; k < n; k++) {
    const th = ((k + 0.5) / n) * Math.PI * 2;
    if (Math.cos(th) > 0 && Math.abs(Math.sin(th)) * R < channel.half + rimW * 0.5) continue;
    out.push({
      x: pond.x + Math.cos(th) * R, z: pond.z + Math.sin(th) * R,
      w: (2 * Math.PI * R) / n + 0.03, d: rimW, h: rimH, rotY: -(th + Math.PI / 2),
    });
  }
  const x0 = pond.x + Math.sqrt(Math.max(0, R * R - (channel.half + rimW / 2) ** 2)) - 0.1;
  const len = channel.x1 - x0;
  for (const s of [1, -1]) out.push({ x: x0 + len / 2, z: channel.z + s * (channel.half + rimW / 2), w: len, d: rimW, h: rimH });
  out.push({ x: channel.x1 + rimW / 2, z: channel.z, w: rimW, d: channel.half * 2 + rimW * 2, h: rimH + 0.1 });
  return out;
}

function waterMaterial() {
  return cached('waterMat', () => {
    const S = 256;
    // Färg: grönt vatten med mörkare och ljusare stråk
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [58, 98, 76], { cells: 3, oct: 5, amt: 0.45, grain: 4, seed: 231 });
    const r = rng(232);
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = `rgba(170,210,170,${0.05 + r() * 0.08})`;
      const x = r() * S, y = r() * S, rad = 6 + r() * 20;
      wrapDraw(S, S, x, y, rad, (px, py) => { ctx.beginPath(); ctx.arc(px, py, rad, r() * 6, r() * 6 + 2); ctx.stroke(); });
    }
    const map = toTex(c);
    // Normalkarta ur sömlöst höjdbrus
    const h = valueNoise(S, S, 6, 3, rng(233));
    const [nc, nctx] = canvas(S);
    const img = nctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const at = (xx, yy) => h[((yy + S) % S) * S + ((xx + S) % S)];
      const dx = (at(x + 1, y) - at(x - 1, y)) * 6, dy = (at(x, y + 1) - at(x, y - 1)) * 6;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
    nctx.putImageData(img, 0, 0);
    const normalMap = toTex(nc, { srgb: false });
    return new THREE.MeshStandardMaterial({
      map, normalMap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.12, metalness: 0.1, envMapIntensity: 1.0,
    });
  });
}

/** Vattenytor, näckrosor och fontän (bara grafik; kanterna kommer från waterRims). */
export function makeWater(scene, { pond, channel }) {
  if (!scene) return;
  const mat = waterMaterial();
  const surf = [];
  const disc = new THREE.CircleGeometry(pond.r + 0.05, 48);
  disc.rotateX(-Math.PI / 2);
  disc.translate(pond.x, WATER_Y, pond.z);
  surf.push(disc);
  const x0 = pond.x + pond.r * 0.6;
  const strip = new THREE.PlaneGeometry(channel.x1 - x0 + 0.05, channel.half * 2 + 0.06);
  strip.rotateX(-Math.PI / 2);
  strip.translate((x0 + channel.x1) / 2, WATER_Y - 0.002, channel.z);
  surf.push(strip);
  // Vatten i fontänens skålar
  const lift = WATER_Y - 0.1;
  for (const [rr, y] of [[1.12, lift + 1.25], [0.52, lift + 1.94]]) {
    const d = new THREE.CircleGeometry(rr, 28);
    d.rotateX(-Math.PI / 2);
    d.translate(pond.x, y, pond.z);
    surf.push(d);
  }
  surf.forEach((g) => planarUV(g, 3.5));
  const water = new THREE.Mesh(mergeAll(surf), mat);
  water.receiveShadow = true;
  water.onBeforeRender = () => {
    const t = performance.now() / 1000;
    mat.map.offset.set(t * 0.012, t * 0.005);
    mat.normalMap.offset.set(-t * 0.03, t * 0.021);
  };
  scene.add(water);

  // Fontän: svarvad sten i två skålar
  const prof = [[0, 0], [0.62, 0], [0.62, 0.22], [0.42, 0.3], [0.24, 0.48], [0.2, 0.9], [0.3, 1.0], [1.18, 1.04], [1.32, 1.22], [1.26, 1.29], [1.12, 1.24],
    [0.2, 1.2], [0.15, 1.28], [0.12, 1.66], [0.2, 1.76], [0.58, 1.82], [0.64, 1.95], [0.58, 1.98], [0.5, 1.9], [0.12, 1.92], [0.09, 2.1], [0.16, 2.2], [0.1, 2.32], [0, 2.38]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const lathe = new THREE.LatheGeometry(prof, 28);
  const uvA = lathe.attributes.uv;
  for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * 3, uvA.getY(i) * 1.6);
  lathe.translate(pond.x, lift, pond.z);
  scene.add(shadowed(new THREE.Mesh(lathe, stoneMaterial())));

  // Rinnande vattenridåer från skålarna (rullande textur)
  const fall = cached('fallTex', () => {
    const [c, ctx] = canvas(64, 128);
    const r = rng(241);
    ctx.clearRect(0, 0, 64, 128);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(235,248,255,${0.15 + r() * 0.4})`;
      ctx.fillRect(r() * 64, r() * 128, 1 + r() * 2, 10 + r() * 40);
    }
    return toTex(c);
  });
  const fallMat = new THREE.MeshStandardMaterial({ map: fall, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.2, emissive: 0x334044 });
  const curtains = mergeAll([
    new THREE.CylinderGeometry(0.62, 0.66, 0.68, 28, 1, true).translate(0, 1.6, 0),
    new THREE.CylinderGeometry(1.3, 1.36, 1.12, 36, 1, true).translate(0, 0.66, 0),
  ]);
  curtains.translate(pond.x, lift, pond.z);
  const cm = new THREE.Mesh(curtains, fallMat);
  cm.onBeforeRender = () => { fall.offset.y = (performance.now() / 1000) * 0.9; };
  scene.add(cm);

  // Näckrosblad och några blommor
  const r = rng(251);
  const pads = [];
  for (let i = 0; i < 60 && pads.length < 34; i++) {
    let x, z;
    if (r() < 0.5) {
      const a = r() * Math.PI * 2, d = 1.8 + r() * (pond.r - 2.3);
      x = pond.x + Math.cos(a) * d; z = pond.z + Math.sin(a) * d;
    } else {
      x = pond.x + pond.r + r() * (channel.x1 - pond.x - pond.r - 1); z = channel.z + (r() - 0.5) * (channel.half * 2 - 0.7);
      if (Math.abs(x - channel.bridgeX) < 3) continue;
    }
    pads.push({ x, z, s: 0.7 + r() * 0.6, a: r() * 6.3 });
  }
  const padGeo = new THREE.CircleGeometry(0.22, 14, 0.3, Math.PI * 2 - 0.45);
  padGeo.rotateX(-Math.PI / 2);
  const padMesh = new THREE.InstancedMesh(padGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, side: THREE.DoubleSide }), pads.length);
  const flowers = pads.filter((_, i) => i % 4 === 0);
  const flMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.06, 0.07, 7).translate(0, 0.03, 0), new THREE.MeshStandardMaterial({ color: 0xf6a6c8, roughness: 0.6, emissive: 0x301018 }), flowers.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  pads.forEach((p, i) => {
    m.compose(new THREE.Vector3(p.x, WATER_Y + 0.006, p.z), q.setFromAxisAngle(UP, p.a), new THREE.Vector3(p.s, 1, p.s));
    padMesh.setMatrixAt(i, m);
    padMesh.setColorAt(i, col.setHSL(0.27 + r() * 0.06, 0.45, 0.28 + r() * 0.1));
  });
  flowers.forEach((p, i) => {
    m.compose(new THREE.Vector3(p.x + 0.05, WATER_Y + 0.01, p.z), q.identity(), new THREE.Vector3(1, 1, 1));
    flMesh.setMatrixAt(i, m);
  });
  padMesh.receiveShadow = true;
  scene.add(padMesh, flMesh);
}

/** Stenplattor i en ring runt dammen (bara grafik, plant på marken). */
export function makePaving(scene, { x, z, r0, r1 }) {
  if (!scene) return;
  const g = new THREE.RingGeometry(r0, r1, 48, 2);
  g.rotateX(-Math.PI / 2);
  g.translate(x, 0.008, z);
  planarUV(g, 2.4);
  const mesh = new THREE.Mesh(g, paveMaterial());
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// ===========================================================================
// Stenbro: bröstvärn med valv på båda sidor om den upphöjda vägen
// ===========================================================================

export function addBridgeFacade(scene, track, { at, archAt, span = 2.2, rise = 0.6 }) {
  if (!scene) return;
  const { pts, tangents, normals, N, roadHalf, barrier } = track;
  let ic = track.nearest(at[0], at[1]).index;
  let i0 = ic, i1 = ic;
  while (pts[(i0 - 1 + N) % N].y > 0.02) i0 = (i0 - 1 + N) % N;
  while (pts[(i1 + 1) % N].y > 0.02) i1 = (i1 + 1) % N;
  const t = tangents[ic], O = pts[i0];
  const along = (p) => (p.x - O.x) * t.x + (p.z - O.z) * t.z;
  const shape = new THREE.Shape();
  const run = [];
  for (let i = i0; i !== (i1 + 1) % N; i = (i + 1) % N) run.push([along(pts[i]), pts[i].y]);
  const sEnd = run[run.length - 1][0];
  shape.moveTo(-0.15, -0.02);
  shape.lineTo(-0.15, 0.24);
  for (const [s, y] of run) shape.lineTo(s, y + 0.24);
  shape.lineTo(sEnd + 0.15, 0.24);
  shape.lineTo(sEnd + 0.15, -0.02);
  shape.closePath();
  const sc = along({ x: archAt[0], z: archAt[1] });
  const hole = new THREE.Path();
  hole.moveTo(sc + span, 0.0);
  for (let k = 0; k <= 24; k++) {
    const th = (k / 24) * Math.PI;
    hole.lineTo(sc + Math.cos(th) * span, Math.sin(th) * rise + 0.0);
  }
  hole.closePath();
  shape.holes.push(hole);
  const base = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false, curveSegments: 4 });
  // Fram- och baksida i meter; kanterna (grupp 1) får krönets mossband
  const uv = base.attributes.uv, bp = base.attributes.position;
  const sideStart = base.groups[1]?.start ?? uv.count;
  for (let i = 0; i < uv.count; i++) {
    if (i < sideStart) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 1.2);
    else uv.setXY(i, (bp.getX(i) + bp.getZ(i)) / 2, 0.93 + bp.getZ(i) * 0.2);
  }
  const n = normals[ic];
  const off = roadHalf + barrier.thick + 0.005;
  const geos = [];
  for (const side of [1, -1]) {
    const g = base.clone();
    const nz = new THREE.Vector3(n.x * side, 0, n.z * side);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(t.x, 0, t.z), UP, nz)
      .setPosition(O.x + nz.x * off, 0, O.z + nz.z * off);
    g.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(g);
    geos.push(g);
  }
  scene.add(shadowed(new THREE.Mesh(mergeAll(geos), stoneMaterial())));
}

// ===========================================================================
// Växthuset: stensockel (via addStoneWalls), glasväggar och ett välvt glastak
// på vita järnbågar
// ===========================================================================

export function greenhouseBase(size, h = 0.8) {
  const G_ = size / 2 - 0.2;
  return [
    { x: 0, z: -G_, w: size, d: 0.4, h }, { x: 0, z: G_, w: size, d: 0.4, h },
    { x: -G_, z: 0, w: 0.4, d: size - 0.8, h }, { x: G_, z: 0, w: 0.4, d: size - 0.8, h },
  ];
}

export function makeGreenhouse(scene, world, RAPIER, { size, base = 0.8, eave = 6, crown = 15 }) {
  const G_ = size / 2 - 0.2;
  if (world) {
    const body = fixedBody(world, RAPIER);
    for (const [hx, hz, x, z] of [[G_ + 0.4, 0.2, 0, -G_], [G_ + 0.4, 0.2, 0, G_], [0.2, G_ + 0.4, -G_, 0], [0.2, G_ + 0.4, G_, 0]]) {
      boxCollider(world, RAPIER, body, hx, eave / 2, hz, x, eave / 2, z, 0, 0.5);
    }
  }
  if (!scene) return;
  const vault = (th) => ({ z: G_ * Math.cos(th), y: eave + (crown - eave) * Math.sin(th) });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const frame = [];
  const ARC = 32;
  // Bågar (spröjs) tvärs över, kraftigare var tredje
  const bays = 15, bay = (G_ * 2) / bays;
  for (let k = 0; k <= bays * 3; k++) {
    const x = -G_ + (k / 3) * bay;
    const main = k % 3 === 0;
    for (let i = 0; i < ARC; i++) {
      const a = vault((i / ARC) * Math.PI), b = vault(((i + 1) / ARC) * Math.PI);
      frame.push(beam(V(x, a.y, a.z), V(x, b.y, b.z), main ? 0.1 : 0.035, main ? 0.18 : 0.05));
    }
    // Stolpar i långväggarna
    for (const s of [1, -1]) frame.push(beam(V(x, base, s * G_), V(x, eave, s * G_), main ? 0.1 : 0.04, main ? 0.12 : 0.05));
  }
  // Längsgående åsar i taket
  for (let i = 1; i < 12; i++) {
    const a = vault((i / 12) * Math.PI);
    frame.push(beam(V(-G_, a.y, a.z), V(G_, a.y, a.z), 0.05, 0.07));
  }
  // Takfot och reglar i långväggarna
  for (const s of [1, -1]) for (const [y, w] of [[base + 0.04, 0.12], [(base + eave) / 2, 0.05], [eave, 0.18]]) {
    frame.push(beam(V(-G_, y, s * G_), V(G_, y, s * G_), w, w));
  }
  // Gavlar
  for (const sx of [1, -1]) {
    const x = sx * G_;
    for (let z = -G_; z <= G_ + 0.01; z += bay / 2) {
      const top = eave + (crown - eave) * Math.sqrt(Math.max(0, 1 - (z / G_) ** 2));
      frame.push(beam(V(x, base, z), V(x, top, z), 0.05, 0.06));
    }
    for (const y of [base + 0.04, (base + eave) / 2, eave, 9, 12, 14]) {
      const zz = y <= eave ? G_ : G_ * Math.sqrt(Math.max(0, 1 - ((y - eave) / (crown - eave)) ** 2));
      if (zz > 0.5) frame.push(beam(V(x, y, -zz), V(x, y, zz), 0.06, 0.06));
    }
  }
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ec, roughness: 0.45, metalness: 0.1 });
  const fm = new THREE.Mesh(mergeAll(frame), frameMat);
  fm.castShadow = true;
  scene.add(fm);

  // Glas: ett nät över valvet, långväggar och gavlar
  const glass = [];
  const roof = new THREE.BufferGeometry();
  const rp = [];
  for (let i = 0; i < ARC; i++) {
    const a = vault((i / ARC) * Math.PI), b = vault(((i + 1) / ARC) * Math.PI);
    rp.push(-G_, a.y, a.z, G_, a.y, a.z, G_, b.y, b.z, -G_, a.y, a.z, G_, b.y, b.z, -G_, b.y, b.z);
  }
  roof.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  roof.computeVertexNormals();
  glass.push(roof);
  for (const s of [1, -1]) {
    const w = new THREE.PlaneGeometry(G_ * 2, eave - base);
    w.translate(0, (base + eave) / 2, s * G_);
    glass.push(w);
  }
  const gable = new THREE.Shape();
  gable.moveTo(-G_, base);
  gable.lineTo(G_, base);
  for (let i = 0; i <= ARC; i++) { const a = vault((i / ARC) * Math.PI); gable.lineTo(a.z, a.y); }
  gable.closePath();
  for (const s of [1, -1]) {
    const g = new THREE.ShapeGeometry(gable);
    g.rotateY(Math.PI / 2);
    g.translate(s * G_, 0, 0);
    glass.push(g);
  }
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xdff4ff, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.2,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6,
  });
  const gm = new THREE.Mesh(mergeAll(glass, ['position', 'normal']), glassMat);
  gm.renderOrder = 2;
  scene.add(gm);
}

// ===========================================================================
// Växter: krukor, buskar, ormbunkar, blommor, palmer, cypresser, klotbuxbom
// ===========================================================================

// Korsade bladkort med normaler som pekar uppåt-utåt (mjukt ljus), och
// baksidor som egna trianglar så att ljuset blir rätt från båda håll.
function cardGeometry(kind) {
  return cached('cardGeo_' + kind, () => {
    const planes = [];
    if (kind === 'fern') {
      for (let k = 0; k < 6; k++) {
        const p = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
        p.rotateX(-0.55 - (k % 2) * 0.25);
        p.rotateY((k / 6) * Math.PI * 2);
        planes.push(p);
      }
    } else {
      for (let k = 0; k < 3; k++) planes.push(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateY((k / 3) * Math.PI));
    }
    const front = mergeAll(planes);
    const back = flipWinding(front.clone());
    const g = mergeGeometries([front, back]);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i), p.getY(i) - 0.25, p.getZ(i)).normalize().add(new THREE.Vector3(0, 0.9, 0)).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    return g;
  });
}

function cardMaterials(map) {
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 0.75 });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
  return { mat, depth };
}

function potGeometry() {
  return cached('potGeo', () => {
    const prof = [[0, 0], [0.17, 0], [0.18, 0.02], [0.235, 0.3], [0.27, 0.31], [0.275, 0.37], [0.255, 0.385], [0.235, 0.35], [0.232, 0.33], [0, 0.33]];
    const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 18);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      const j = i % prof.length;
      const c = j >= 8 ? [0.2, 0.13, 0.08] : j >= 4 ? [0.78, 0.4, 0.24] : [0.72, 0.36, 0.22];
      col.set(c, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
}
export const POT_H = 0.33;

function instanced(scene, geo, mat, items, place, { cast = true, depth = null } = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  items.forEach((it, i) => {
    const tint = place(it, p, q, s, c);
    mesh.setMatrixAt(i, m.compose(p, q, s));
    if (tint) mesh.setColorAt(i, c);
  });
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  if (depth) mesh.customDepthMaterial = depth;
  scene.add(mesh);
  return mesh;
}

/**
 * Växter. Alla listor är [{x, z, y?, s?}]. pots kan ha plant: 'bush'|'fern'|'flower'|'ball'|'cone'.
 * palms: {x, z, y?, h, seed}. cypress: {x, z, y?, h}. Krukor, palmer och cypresser får kolliderare.
 */
export function addPlants(scene, world, RAPIER, { pots = [], bushes = [], ferns = [], flowers = [], palms = [], cypress = [], topiary = [] }) {
  bushes = [...bushes]; ferns = [...ferns]; flowers = [...flowers]; topiary = [...topiary];
  for (const p of pots) {
    const s = p.s ?? 1, y = (p.y ?? 0) + POT_H * s;
    const plant = { x: p.x, z: p.z, y, s: s * (p.plantScale ?? 1.25) };
    if (p.plant === 'bush') bushes.push(plant);
    else if (p.plant === 'fern') ferns.push(plant);
    else if (p.plant === 'flower') flowers.push({ ...plant, s: s * 1.0 });
    else if (p.plant === 'ball' || p.plant === 'cone') topiary.push({ ...plant, kind: p.plant, s: s * 0.95 });
  }
  if (world) {
    const body = fixedBody(world, RAPIER);
    for (const p of pots) { const s = p.s ?? 1; cylCollider(world, RAPIER, body, 0.26 * s, 0.38 * s, p.x, p.y ?? 0, p.z); }
    for (const p of palms) cylCollider(world, RAPIER, body, 0.24, p.h, p.x, p.y ?? 0, p.z);
    for (const p of cypress) cylCollider(world, RAPIER, body, 0.18 * p.h / 4 + 0.15, p.h * 0.6, p.x, p.y ?? 0, p.z);
  }
  if (!scene) return;
  const r = rng(301);

  instanced(scene, potGeometry(), potMaterial(), pots, (it, p, q, s, c) => {
    const k = it.s ?? 1;
    p.set(it.x, it.y ?? 0, it.z); q.setFromAxisAngle(UP, r() * 6.3); s.set(k, k, k);
    c.setRGB(0.92 + r() * 0.16, 0.9 + r() * 0.12, 0.88 + r() * 0.12);
    return true;
  });

  const cards = (kind, list, size, hue, light) => {
    const { mat, depth } = cached('cardMat_' + kind, () => cardMaterials(leafTexture(kind)));
    instanced(scene, cardGeometry(kind === 'flower' ? 'bush' : kind), mat, list, (it, p, q, s, c) => {
      const k = (it.s ?? 1) * size * (0.8 + r() * 0.4);
      p.set(it.x, it.y ?? 0, it.z); q.setFromAxisAngle(UP, r() * 6.3); s.set(k, k * (0.85 + r() * 0.3), k);
      c.setHSL(hue + (r() - 0.5) * 0.06, 0.25 + r() * 0.2, light + r() * 0.15);
      return true;
    }, { depth });
  };
  cards('bush', bushes, 0.8, 0.25, 0.6);
  cards('fern', ferns, 0.9, 0.27, 0.6);
  cards('flower', flowers, 0.6, 0.1, 0.85);

  // Klotbuxbom och kägelbuxbom
  const hedge = hedgeMaterial();
  const ball = cached('ballGeo', () => {
    const g = new THREE.IcosahedronGeometry(0.42, 3).translate(0, 0.42, 0);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 1.5);
    return g;
  });
  const cone = cached('coneGeo', () => {
    const g = new THREE.ConeGeometry(0.36, 1.1, 14, 3).translate(0, 0.55, 0);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.5, uv.getY(i) * 1.5);
    return g;
  });
  for (const [kind, geo] of [['ball', ball], ['cone', cone]]) {
    instanced(scene, geo, hedge, topiary.filter((t) => (t.kind ?? 'ball') === kind), (it, p, q, s, c) => {
      const k = it.s ?? 1;
      p.set(it.x, it.y ?? 0, it.z); q.setFromAxisAngle(UP, r() * 6.3); s.set(k, k, k);
      c.setHSL(0.27, 0.3, 0.75 + r() * 0.2);
      return true;
    });
  }

  // Cypresser: svarvad flamform
  const cyp = cached('cypGeo', () => {
    const prof = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new THREE.Vector2(0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)), 0.8) * (1 - t * 0.35) + 0.01, t * 4)); }
    const g = new THREE.LatheGeometry(prof, 12);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 5);
    return g;
  });
  instanced(scene, cyp, hedge, cypress, (it, p, q, s, c) => {
    const k = it.h / 4;
    p.set(it.x, it.y ?? 0, it.z); q.setFromAxisAngle(UP, r() * 6.3); s.set(k * (0.9 + r() * 0.2), k, k * (0.9 + r() * 0.2));
    c.setHSL(0.3, 0.35, 0.55 + r() * 0.1);
    return true;
  });

  if (palms.length) addPalms(scene, palms);
}

function addPalms(scene, palms) {
  const trunks = [], fronds = [];
  for (const P of palms) {
    const r = rng(P.seed ?? 1);
    const y0 = P.y ?? 0, H = P.h;
    const lean = new THREE.Vector3(r() - 0.5, 0, r() - 0.5).normalize().multiplyScalar(0.3 + r() * 0.9);
    const at = (t) => new THREE.Vector3(P.x + lean.x * t * t, y0 + H * t, P.z + lean.z * t * t);
    // Stam: ringar längs kurvan, smalnar av uppåt med en krage under kronan
    const SEG = 12, RAD = 9;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, c = at(t);
      const rad = 0.2 * (1 - t * 0.35) + (t < 0.08 ? (0.08 - t) * 1.2 : 0) + (t > 0.93 ? 0.06 : 0);
      for (let j = 0; j <= RAD; j++) {
        const a = (j / RAD) * Math.PI * 2;
        pos.push(c.x + Math.cos(a) * rad, c.y, c.z + Math.sin(a) * rad);
        uv.push(j / RAD * 2, t * H / 0.3);
      }
    }
    for (let i = 0; i < SEG; i++) for (let j = 0; j < RAD; j++) {
      const a = i * (RAD + 1) + j, b = a + RAD + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    tg.setIndex(idx);
    tg.computeVertexNormals();
    trunks.push(tg);

    // Blad: böjda remsor med lätt V-veck
    const top = at(1);
    const nF = 11 + Math.floor(r() * 4);
    for (let f = 0; f < nF; f++) {
      const a = (f / nF) * Math.PI * 2 + r() * 0.3;
      const e0 = 0.15 + r() * 0.85, L = 2.2 + r() * 1.1, droop = 0.7 + r() * 0.5, W = 0.75;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const fp = [], fuv = [], fidx = [];
      const S = 8;
      for (let i = 0; i <= S; i++) {
        const s = i / S;
        const c = top.clone().addScaledVector(dir, L * s * Math.cos(e0)).add(new THREE.Vector3(0, L * s * Math.sin(e0) - droop * L * s * s * 0.8, 0));
        const w = W * 0.5 * (1 - s * 0.3);
        for (const k of [-1, 0, 1]) {
          const v = c.clone().addScaledVector(side, k * w);
          v.y -= Math.abs(k) * w * 0.25;
          fp.push(v.x, v.y, v.z);
          fuv.push(s, (k + 1) / 2);
        }
      }
      for (let i = 0; i < S; i++) for (let k = 0; k < 2; k++) {
        const a0 = i * 3 + k, b0 = a0 + 3;
        fidx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
      g.setIndex(fidx);
      const front = g.toNonIndexed();
      front.computeVertexNormals();
      const nrm = front.attributes.normal;
      for (let i = 0; i < nrm.count; i++) {
        const v = new THREE.Vector3(nrm.getX(i), Math.abs(nrm.getY(i)), nrm.getZ(i)).add(new THREE.Vector3(0, 1.2, 0)).normalize();
        nrm.setXYZ(i, v.x, v.y, v.z);
      }
      fronds.push(front, flipWinding(front.clone()));
    }
  }
  scene.add(shadowed(new THREE.Mesh(mergeAll(trunks), barkMaterial())));
  const { mat, depth } = cached('frondMat', () => cardMaterials(frondTexture()));
  mat.color.set(0xd8f0c0);
  const fm = shadowed(new THREE.Mesh(mergeGeometries(fronds), mat));
  fm.customDepthMaterial = depth;
  scene.add(fm);
}

// ===========================================================================
// Häckar och bänkar
// ===========================================================================

/** hedges: [{x, z, w, d, h, rotY}] klippta lådhäckar med kolliderare. */
export function addHedges(scene, world, RAPIER, hedges) {
  if (world) {
    const body = fixedBody(world, RAPIER);
    for (const H of hedges) boxCollider(world, RAPIER, body, H.w / 2, H.h / 2, H.d / 2, H.x, H.h / 2, H.z, H.rotY ?? 0, 0.5);
  }
  if (!scene || !hedges.length) return;
  const geos = hedges.map((H) => {
    const g = boxWorldUV(new THREE.BoxGeometry(H.w, H.h, H.d), H.w, H.h, H.d, 0.9);
    g.rotateY(H.rotY ?? 0);
    g.translate(H.x, H.h / 2, H.z);
    return g;
  });
  scene.add(shadowed(new THREE.Mesh(mergeAll(geos), hedgeMaterial())));
}

/** Parkbänkar av trä med gjutjärnsben: [{x, z, y?, rotY}]. */
export function addBenches(scene, world, RAPIER, benches) {
  if (world) {
    const body = fixedBody(world, RAPIER);
    for (const B of benches) boxCollider(world, RAPIER, body, 0.75, 0.4, 0.3, B.x, (B.y ?? 0) + 0.4, B.z, B.rotY ?? 0, 0.5);
  }
  if (!scene || !benches.length) return;
  const wood = [], iron = [];
  for (const B of benches) {
    const m = new THREE.Matrix4().makeRotationY(B.rotY ?? 0).setPosition(B.x, B.y ?? 0, B.z);
    for (let k = 0; k < 4; k++) wood.push(new THREE.BoxGeometry(1.5, 0.035, 0.09).translate(0, 0.44, -0.16 + k * 0.105).applyMatrix4(m));
    for (let k = 0; k < 3; k++) wood.push(new THREE.BoxGeometry(1.5, 0.08, 0.03).rotateX(-0.2).translate(0, 0.58 + k * 0.11, -0.25 - k * 0.02).applyMatrix4(m));
    for (const sx of [-0.65, 0.65]) {
      iron.push(new THREE.BoxGeometry(0.05, 0.44, 0.05).translate(sx, 0.22, 0.14).applyMatrix4(m));
      iron.push(new THREE.BoxGeometry(0.05, 0.85, 0.05).rotateX(-0.2).translate(sx, 0.42, -0.22).applyMatrix4(m));
      iron.push(new THREE.BoxGeometry(0.05, 0.05, 0.42).translate(sx, 0.42, -0.04).applyMatrix4(m));
      iron.push(new THREE.BoxGeometry(0.05, 0.05, 0.36).translate(sx, 0.62, 0.0).applyMatrix4(m));
    }
  }
  scene.add(shadowed(new THREE.Mesh(mergeAll(wood), woodMaterial())));
  scene.add(shadowed(new THREE.Mesh(mergeAll(iron), new THREE.MeshStandardMaterial({ color: 0x2c3a30, roughness: 0.5, metalness: 0.5 }))));
}

// ===========================================================================
// Lösa krukor som bilarna kan välta
// ===========================================================================

export function addLoosePot(scene, world, RAPIER, { x, z, s = 0.7, mass = 0.4 }) {
  const h = 0.38 * s;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, h / 2 + 0.005, z).setLinearDamping(0.2).setAngularDamping(0.4)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(h / 2, 0.25 * s).setDensity(0).setMass(mass).setFriction(0.6).setRestitution(0.2)
      .setCollisionGroups(groups(G.PROP)),
    body
  );
  let mesh = null;
  if (scene) {
    const geo = potGeometry().clone().scale(s, s, s).translate(0, -h / 2, 0);
    mesh = shadowed(new THREE.Mesh(geo, potMaterial()));
    scene.add(mesh);
  }
  return { body, mesh, kind: 'pot' };
}

// ===========================================================================
// Pergola med klätterväxter, plankramp, blomsterrabatt och trädgårdsredskap
// ===========================================================================

// Trä med vertexfärg (pergola, plankor) och målad plåt/plast (redskap)
function woodVMaterial() {
  return cached('woodVMat', () => {
    const m = woodMaterial().clone();
    m.vertexColors = true;
    return m;
  });
}
function paintedMaterial() {
  return cached('paintedMat', () => new THREE.MeshStandardMaterial({ roughness: 0.55, vertexColors: true }));
}
function tintGeo(g, [r, gg, b]) {
  const n = (g.index ? g.toNonIndexed() : g);
  const c = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < c.length; i += 3) { c[i] = r; c[i + 1] = gg; c[i + 2] = b; }
  n.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return n;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Pergola över banan från (ax, az) till (bx, bz): vita stolpar, balkar och
 * reglar täckta av klätterväxter. Rosor läggs i listan flowers (till addPlants).
 */
export function addPergola(scene, world, RAPIER, { ax, az, bx, bz, clear = 2.6, h = 2.1, flowers = [], bushes = [], seed = 1 }) {
  const L = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / L, uz = (bz - az) / L; // längs vägen
  const nx = -uz, nz = ux; // tvärs
  const at = (u, v, y = 0) => V3(ax + ux * u + nx * v, y, az + uz * u + nz * v);
  const posts = Math.max(2, Math.round(L / 2.2));
  if (world) {
    const body = fixedBody(world, RAPIER);
    for (let k = 0; k <= posts; k++) for (const s of [-1, 1]) {
      const p = at((L * k) / posts, s * clear);
      boxCollider(world, RAPIER, body, 0.08, h / 2, 0.08, p.x, h / 2, p.z, -Math.atan2(uz, ux));
    }
  }
  if (!scene) return;
  const r = rng(seed * 7 + 3);
  const white = [1.25, 1.2, 1.12];
  const wood = [], vines = [];
  for (let k = 0; k <= posts; k++) for (const s of [-1, 1]) {
    const p = at((L * k) / posts, s * clear);
    wood.push(tintGeo(boxWorldUV(new THREE.BoxGeometry(0.15, h, 0.15), 0.15, h, 0.15, 0.6).translate(p.x, h / 2, p.z), white));
    wood.push(tintGeo(boxWorldUV(new THREE.BoxGeometry(0.24, 0.12, 0.24), 0.24, 0.12, 0.24, 0.6).translate(p.x, 0.06, p.z), mul3(white, 0.9)));
    // Klätterväxt som slingrar sig upp längs stolpen (bladkort)
    for (let y = 0.1; y < h - 0.2; y += 0.55) bushes.push({ x: p.x + (r() - 0.5) * 0.12, z: p.z + (r() - 0.5) * 0.12, y, s: 0.55 + r() * 0.25 });
    flowers.push({ x: p.x, z: p.z, y: h * 0.45 + r() * 0.6, s: 0.55 });
  }
  for (const s of [-1, 1]) wood.push(tintGeo(beam(at(-0.3, s * clear, h + 0.08), at(L + 0.3, s * clear, h + 0.08), 0.12, 0.2), white));
  for (let u = 0; u <= L; u += 0.5) wood.push(tintGeo(beam(at(u, -clear - 0.35, h + 0.24), at(u, clear + 0.35, h + 0.24), 0.07, 0.14), mul3(white, 0.97)));
  // Grönska på taket: tät längs balkarna, glesare över mitten
  for (let u = -0.2; u <= L + 0.2; u += 0.42) {
    for (let v = -clear - 0.3; v <= clear + 0.3; v += 0.45) {
      const edge = Math.abs(v) > clear - 0.6;
      if (!edge && r() < 0.45) continue;
      const p = at(u + (r() - 0.5) * 0.3, v + (r() - 0.5) * 0.3, h + 0.28 + r() * 0.1);
      const k = 0.28 + r() * 0.2;
      vines.push(new THREE.IcosahedronGeometry(k, 1).scale(1.5, 0.55, 1.5).translate(p.x, p.y, p.z));
      if (edge && r() < 0.55) bushes.push({ x: p.x, z: p.z, y: h - 0.45 - r() * 0.3, s: 0.5 + r() * 0.3 });
      if (r() < (edge ? 0.5 : 0.25)) flowers.push({ x: p.x, z: p.z, y: p.y + 0.05, s: 0.5 + r() * 0.2 });
    }
  }
  scene.add(shadowed(new THREE.Mesh(mergeAll(wood, ['position', 'normal', 'uv', 'color']), woodVMaterial())));
  const vg = mergeAll(vines);
  planarUV(vg, 0.9);
  scene.add(shadowed(new THREE.Mesh(vg, hedgeMaterial())));
}
const mul3 = (c, k) => c.map((v) => v * k);

/** Plankor som klär en hoppramp (vägpunkter i0..i1 längs genvägen). */
export function addPlankKicker(scene, path, i0, i1) {
  if (!scene) return;
  const { pts, roadHalf } = path;
  const geos = [];
  for (let i = i0; i < i1; i++) {
    const p = pts[i], q = pts[i + 1];
    const a = V3(p.x, p.y + 0.016, p.z), b = V3(q.x, q.y + 0.016, q.z);
    const tone = 0.85 + ((i * 7) % 5) * 0.04;
    geos.push(tintGeo(beam(a, b, roadHalf * 2 * 0.98, 0.03), [tone, tone * 0.96, tone * 0.9]));
  }
  // Klossar under plankornas höga ände
  const e = pts[i1], d = pts[i1 - 1];
  const ang = Math.atan2(e.x - d.x, e.z - d.z);
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(0.14, e.y, 0.14).translate(s * (roadHalf - 0.12), e.y / 2, -0.1).rotateY(ang).translate(e.x, 0, e.z);
    geos.push(tintGeo(g, [0.7, 0.6, 0.5]));
  }
  scene.add(shadowed(new THREE.Mesh(mergeAll(geos, ['position', 'normal', 'uv', 'color']), woodVMaterial())));
}

/** Liten rabatt utan kolliderare (jordyta med stenkant), t.ex. under ett hopp. */
export function addFlowerBed(scene, { x, z, w, d, rotY = 0, flowers }) {
  if (!scene) return;
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z);
  const soil = planarUV(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(0, 0.07, 0).applyMatrix4(m), 1.2);
  scene.add(shadowed(new THREE.Mesh(soil, soilMaterial()), false));
  const stones = [];
  const t = 0.14;
  for (const [bw, bd, bx, bz] of [[w + t, t, 0, -d / 2], [w + t, t, 0, d / 2], [t, d, -w / 2, 0], [t, d, w / 2, 0]]) {
    stones.push(boxWorldUV(new THREE.BoxGeometry(bw, 0.1, bd), bw, 0.1, bd, 0.8).translate(bx, 0.05, bz).applyMatrix4(m));
  }
  scene.add(shadowed(new THREE.Mesh(mergeAll(stones), stoneMaterial())));
  const r = rng(Math.round(x * 13 + z * 7));
  for (let u = -w / 2 + 0.25; u < w / 2 - 0.1; u += 0.38) for (let v = -d / 2 + 0.25; v < d / 2 - 0.1; v += 0.38) {
    const p = V3(u + (r() - 0.5) * 0.15, 0.07, v + (r() - 0.5) * 0.15).applyMatrix4(m);
    flowers.push({ x: p.x, z: p.z, y: 0.07, s: 0.7 + r() * 0.3 });
  }
}

/**
 * Trädgårdsredskap vid starten: skottkärra med jord, vattenkanna och säckar.
 * Allt i lokal ram (x, z, rot), kärran längs lokal +z.
 */
export function addGardenTools(scene, world, RAPIER, { x, z, rot = 0 }) {
  const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
  const loc = (lx, lz) => V3(lx, 0, lz).applyMatrix4(M);
  if (world) {
    const body = fixedBody(world, RAPIER);
    const c1 = loc(0, 0), c2 = loc(0.1, -1.4), c3 = loc(0.05, 1.5);
    boxCollider(world, RAPIER, body, 0.36, 0.33, 0.75, c1.x, 0.33, c1.z, rot);
    cylCollider(world, RAPIER, body, 0.18, 0.36, c2.x, 0, c2.z);
    boxCollider(world, RAPIER, body, 0.4, 0.22, 0.35, c3.x, 0.22, c3.z, rot);
  }
  if (!scene) return;
  const paint = [], metal = [], dirt = [];
  const P = (g, col) => paint.push(tintGeo(g.applyMatrix4(M), col));
  const green = [0.2, 0.45, 0.25], red = [0.72, 0.16, 0.12], wood = [0.75, 0.6, 0.42], tyre = [0.08, 0.08, 0.08];
  // Skottkärra: trågformad låda, hjul fram, handtag och ben bak
  const tray = new THREE.CylinderGeometry(0.42, 0.28, 0.36, 4, 1, true).rotateY(Math.PI / 4).scale(0.95, 1, 1.55).translate(0, 0.5, 0.05);
  P(tray, green);
  P(new THREE.BoxGeometry(0.5, 0.03, 0.7).translate(0, 0.33, 0.05), mul3(green, 0.8));
  const soil = new THREE.SphereGeometry(0.36, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.05, 0.35, 1.6).translate(0, 0.6, 0.05).applyMatrix4(M);
  dirt.push(planarUV(soil, 0.8));
  const wheel = new THREE.TorusGeometry(0.17, 0.06, 8, 20).rotateY(Math.PI / 2).translate(0, 0.2, 0.78);
  P(wheel, tyre);
  P(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10).rotateZ(Math.PI / 2).translate(0, 0.2, 0.78), red);
  for (const s of [-1, 1]) {
    P(beam(V3(s * 0.12, 0.2, 0.78), V3(s * 0.27, 0.42, -0.85), 0.05, 0.05), wood);
    P(new THREE.BoxGeometry(0.04, 0.32, 0.04).translate(s * 0.22, 0.16, -0.32), wood);
    P(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 8).rotateX(Math.PI / 2).translate(s * 0.28, 0.43, -0.92), [0.15, 0.15, 0.15]);
  }
  // Vattenkanna i galvaniserad plåt
  const can = (g) => { metal.push(tintGeo(g.translate(0.1, 0, -1.4).applyMatrix4(M), [0.78, 0.8, 0.8])); };
  can(new THREE.CylinderGeometry(0.15, 0.17, 0.32, 18).translate(0, 0.16, 0));
  can(new THREE.TorusGeometry(0.12, 0.018, 6, 14, Math.PI).translate(0, 0.32, 0));
  can(beam(V3(0, 0.08, 0.13), V3(0, 0.38, 0.42), 0.035, 0.035));
  can(new THREE.CylinderGeometry(0.055, 0.03, 0.05, 12).rotateX(-0.9).translate(0, 0.4, 0.45));
  // Jordsäckar och krukor i en trave
  for (const [lx, ly, lz, rz] of [[-0.05, 0.1, 1.4, 0.05], [0.25, 0.1, 1.62, -0.1], [0.08, 0.28, 1.5, 0.15]]) {
    const g = new THREE.SphereGeometry(0.3, 12, 8).scale(1.25, 0.35, 0.75).rotateY(rz).translate(lx, ly, lz);
    P(g, [0.42, 0.32, 0.2]);
  }
  scene.add(shadowed(new THREE.Mesh(mergeAll(paint, ['position', 'normal', 'uv', 'color']), paintedMaterial())));
  scene.add(shadowed(new THREE.Mesh(mergeAll(metal, ['position', 'normal', 'uv', 'color']),
    cached('canMat', () => new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.7, vertexColors: true })))));
  scene.add(shadowed(new THREE.Mesh(mergeAll(dirt), soilMaterial())));
}

/** Trampstenar i gräset längs en genvägs glapp (bara grafik). */
export function addSteppingStones(scene, path, ranges) {
  if (!scene) return;
  const geos = [];
  const r = rng(77);
  for (const [i0, i1] of ranges) {
    for (let i = i0, k = 0; i <= i1; i += 2, k++) {
      const p = path.poseAt(i, (k % 2 ? 1 : -1) * path.roadHalf * 0.35 + (r() - 0.5) * 0.15);
      const rad = 0.32 + r() * 0.08;
      geos.push(new THREE.CylinderGeometry(rad, rad * 1.04, 0.05, 10).scale(1, 1, 0.8 + r() * 0.3).rotateY(r() * 3).translate(p.x, 0.02, p.z));
    }
  }
  if (!geos.length) return;
  const g = mergeAll(geos);
  planarUV(g, 1.2);
  scene.add(shadowed(new THREE.Mesh(g, stoneMaterial()), false));
}
