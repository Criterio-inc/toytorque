import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G, groups } from '../core/physics.js';
import { rng } from './warehouseArt.js';
import { bankY } from '../track/track.js';

export { rng };

// ---------------------------------------------------------------------------
// Procedurell grafik för spökstaden: sandmark med hjulspår, träfasader med
// skyltar och trottoarer, vattentorn, vindsnurra, gruvtunnel, kaktusar,
// stenar, bergsplatåer vid horisonten och tumlegräs. Allt ritas i canvas.
//
// Statisk grafik samlas i en ArtBatch (en sammanslagen mesh per material).
// Funktionerna tar (batch, world, RAPIER, opts): utan batch byggs bara
// fysiken (inget document rörs), utan world bara grafiken.
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

const yQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

function fixedBody(world, RAPIER, x = 0, y = 0, z = 0, rotY = 0) {
  return world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(yQuat(rotY)));
}

// Låda i kroppens lokala ram
function boxCollider(world, RAPIER, body, hx, hy, hz, x, y, z, friction = 0.7) {
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction).setRestitution(0.1).setCollisionGroups(groups(G.WORLD)),
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

function paintNoise(ctx, w, h, [R, G_, B], { cells = 4, oct = 5, amt = 0.22, grain = 6, seed = 1, alpha = null } = {}) {
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
    d[i * 4 + 3] = alpha ? alpha(i % w, Math.floor(i / w), n[i]) : 255;
  }
  ctx.putImageData(img, 0, 0);
}

function wrapDraw(w, h, x, y, rad, fn) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
    if (x + ox + rad < 0 || x + ox - rad > w || y + oy + rad < 0 || y + oy - rad > h) continue;
    fn(x + ox, y + oy);
  }
}

// Småsten: mörk skugga, sten, ljus topp
function pebbles(ctx, w, h, r, count, size, palette) {
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = r() * h, s = size * (0.4 + r() * r() * 1.6), a = r() * Math.PI;
    const col = palette[Math.floor(r() * palette.length)];
    wrapDraw(w, h, x, y, s * 2, (px, py) => {
      ctx.fillStyle = 'rgba(60,40,20,0.25)';
      ctx.beginPath(); ctx.ellipse(px + s * 0.25, py + s * 0.3, s, s * 0.7, a, 0, 7); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(px, py, s, s * 0.7, a, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,245,225,0.3)';
      ctx.beginPath(); ctx.ellipse(px - s * 0.25, py - s * 0.25, s * 0.45, s * 0.3, a, 0, 7); ctx.fill();
    });
  }
}

// ===========================================================================
// Geometrihjälp
// ===========================================================================

// Låda med UV i meter (metres per texturupprepning). swap byter u och v.
function box(w, h, d, x = 0, y = 0, z = 0, { m = 2, swap = false } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    let u = uv.getX(k) * faces[f][0] / m, v = uv.getY(k) * faces[f][1] / m;
    if (swap) [u, v] = [v, u];
    uv.setXY(k, u, v);
  }
  g.translate(x, y, z);
  return g;
}

// Balk mellan två punkter med kvadratiskt tvärsnitt t
const _bm = new THREE.Matrix4(), _ba = new THREE.Vector3(), _bb = new THREE.Vector3(), _bu = new THREE.Vector3();
function beam(ax, ay, az, bx, by, bz, t = 0.1, t2 = t) {
  _ba.set(ax, ay, az); _bb.set(bx, by, bz);
  const len = _ba.distanceTo(_bb);
  const g = box(t, t2, len, 0, 0, 0, { m: 1, swap: true });
  const dir = _bb.clone().sub(_ba).normalize();
  _bu.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.95) _bu.set(1, 0, 0);
  _bm.lookAt(_ba, _bb, _bu);
  g.applyMatrix4(_bm);
  g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  return g;
}

// Plan med UV från en atlasruta [u0, v0, u1, v1]
function atlasPlane(w, h, cell) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const [u0, v0, u1, v1] = cell;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

// Billigt deterministiskt 3D-brus av sinusvågor (för stenar och berg)
function sinNoise(seed) {
  const r = rng(seed);
  const waves = [];
  for (let i = 0; i < 6; i++) {
    const f = 0.8 * 1.9 ** i;
    waves.push([(r() - 0.5) * 2 * f, (r() - 0.5) * 2 * f, (r() - 0.5) * 2 * f, r() * 6.28, 0.6 ** i]);
  }
  return (x, y, z) => {
    let s = 0;
    for (const [a, b, c, p, amp] of waves) s += Math.sin(x * a + y * b + z * c + p) * amp;
    return s / 2;
  };
}

// Stenklump: kantig ikosaeder med brus
// ledge > 0 ger trappade skikt (avsatser) som i sandsten
function rockGeo(seed, detail = 1, rough = 0.28, ledge = 0) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const n = sinNoise(seed), n2 = sinNoise(seed + 7);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + n(x * 1.3, y * 1.3, z * 1.3) * rough + Math.abs(n2(x * 3.1, y * 3.1, z * 3.1)) * rough * 0.5;
    let yy = y * k;
    if (ledge) { const q = Math.round(yy / ledge) * ledge; yy += (q - yy) * 0.55; }
    p.setXYZ(i, x * k * (ledge ? 1 + Math.max(0, -y) * 0.25 : 1), yy, z * k * (ledge ? 1 + Math.max(0, -y) * 0.25 : 1));
  }
  g.computeVertexNormals();
  return g;
}

// Färgar en geometri per vertex efter höjd (bergens skiktning)
const STRATA = [[0.82, 0.55, 0.36], [0.74, 0.42, 0.28], [0.88, 0.7, 0.5], [0.7, 0.44, 0.3], [0.8, 0.6, 0.42], [0.66, 0.38, 0.26]];
function strataColors(geo, { scale = 1, yOff = 0, shade = 1, seed = 1 } = {}) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const n = sinNoise(seed + 100);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + yOff + n(p.getX(i) * 0.08, 0, p.getZ(i) * 0.08) * 1.2 * scale;
    const t = (y / (1.6 * scale)) + 600;
    const a = STRATA[Math.floor(t) % STRATA.length], b = STRATA[(Math.floor(t) + 1) % STRATA.length];
    const u = Math.min(1, (t % 1) * 4);
    for (let k = 0; k < 3; k++) col[i * 3 + k] = (a[k] + (b[k] - a[k]) * u) * shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// ===========================================================================
// Batch: samlar statisk geometri per material och slår ihop vid flush
// ===========================================================================

export class ArtBatch {
  constructor() { this.lists = new Map(); }

  // col: [r, g, b] eller null för att behålla geometrins egna vertexfärger
  add(key, geo, col = [1, 1, 1]) {
    let g = geo.index ? geo.toNonIndexed() : geo;
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
      const mesh = new THREE.Mesh(mergeGeometries(list), MATERIALS[key]());
      mesh.castShadow = key !== 'mesa' && key !== 'shade';
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    this.lists.clear();
  }
}

// ===========================================================================
// Texturer och material
// ===========================================================================

// Väderbitna lodräta brädor, ljusa så att vertexfärgen ger kulören
function woodTexture() {
  return cached('woodTex', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    const r = rng(101);
    const boards = 8, bw = S / boards;
    const grain = valueNoise(S, S, 2, 5, rng(102));
    const img = ctx.createImageData(S, S);
    const shade = Array.from({ length: boards }, () => 0.86 + r() * 0.2);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const b = Math.floor(x / bw);
      const i = y * S + x;
      // Ådring: brus utdraget längs brädan
      const gx = (x % bw) / bw;
      const streak = Math.sin((gx * 9 + grain[((y * 7) % S) * S + (x % S)] * 6) * Math.PI) * 0.06;
      const k = shade[b] * (0.88 + grain[i] * 0.2 + streak) + (r() - 0.5) * 0.05;
      img.data[i * 4] = 198 * k;
      img.data[i * 4 + 1] = 182 * k;
      img.data[i * 4 + 2] = 160 * k;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Fogar mellan brädorna och skarvar
    for (let b = 0; b < boards; b++) {
      const x = b * bw;
      ctx.fillStyle = 'rgba(40,28,18,0.75)'; ctx.fillRect(x, 0, 3, S);
      ctx.fillStyle = 'rgba(255,240,215,0.18)'; ctx.fillRect(x + 3, 0, 2, S);
      const jy = r() * S;
      ctx.fillStyle = 'rgba(40,28,18,0.6)'; ctx.fillRect(x, jy, bw, 2);
      // Spikar
      ctx.fillStyle = 'rgba(50,40,35,0.8)';
      for (const ny of [jy - 8, jy + 10, (jy + S / 2) % S]) {
        ctx.beginPath(); ctx.arc(x + bw * 0.3, ny, 2.2, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(x + bw * 0.7, ny, 2.2, 0, 7); ctx.fill();
      }
      // Kvistar
      if (r() < 0.6) {
        const kx = x + bw * (0.3 + r() * 0.4), ky = r() * S;
        const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, 9);
        g.addColorStop(0, 'rgba(60,38,20,0.8)'); g.addColorStop(1, 'rgba(60,38,20,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(kx, ky, 6, 12, 0, 0, 7); ctx.fill();
      }
      // Sprickor längs fibrerna
      ctx.strokeStyle = 'rgba(45,30,20,0.35)'; ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const cx = x + 6 + r() * (bw - 12), cy = r() * S;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (r() - 0.5) * 3, cy + 20 + r() * 60); ctx.stroke();
      }
    }
    // Avflagnad färg/smuts nertill: mörkare stråk
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(70,50,30,${0.04 + r() * 0.06})`;
      ctx.fillRect(r() * S, r() * S, 4 + r() * 30, 20 + r() * 120);
    }
    return toTex(c);
  });
}

function roofTexture() {
  return cached('roofTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [150, 140, 128], { cells: 3, oct: 5, amt: 0.3, grain: 10, seed: 111 });
    // Korrugering
    for (let x = 0; x < S; x++) {
      const k = Math.sin((x / S) * Math.PI * 2 * 12);
      ctx.fillStyle = k > 0 ? `rgba(255,250,240,${k * 0.16})` : `rgba(20,15,10,${-k * 0.3})`;
      ctx.fillRect(x, 0, 1, S);
    }
    // Rost
    const r = rng(112);
    for (let i = 0; i < 40; i++) {
      const x = r() * S, y = r() * S, rad = 6 + r() * 34;
      wrapDraw(S, S, x, y, rad, (px, py) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, `rgba(${130 + r() * 40},${60 + r() * 20},25,0.55)`);
        g.addColorStop(1, 'rgba(120,60,25,0)');
        ctx.fillStyle = g; ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    // Plåtskarvar
    ctx.fillStyle = 'rgba(30,20,15,0.6)'; ctx.fillRect(0, 0, S, 2); ctx.fillRect(0, S / 2, S, 2);
    return toTex(c);
  });
}

// Atlas med fönster och dörrar: 4 × 2 rutor à 256 px
const OPEN = { window: 0, boarded: 1, broken: 2, shop: 3, door: 4, swing: 5, barn: 6, barred: 7 };
const openCell = (i) => {
  const cx = i % 4, cy = Math.floor(i / 4);
  const e = 2 / 1024, ev = 2 / 512;
  return [cx / 4 + e, 1 - (cy + 1) / 2 + ev, (cx + 1) / 4 - e, 1 - cy / 2 - ev];
};

function openingsTexture() {
  return cached('openTex', () => {
    const [c, ctx] = canvas(1024, 512);
    const r = rng(121);
    const frame = (x, y, w, h, col = '#d9cbb0') => {
      ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(60,40,25,0.35)'; ctx.fillRect(x, y + h - 8, w, 8);
    };
    const glass = (x, y, w, h, dark = 0) => {
      const g = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
      g.addColorStop(0, `rgb(${92 - dark},${88 - dark},${84 - dark})`);
      g.addColorStop(0.45, `rgb(${40 - dark / 2},${36 - dark / 2},${34 - dark / 2})`);
      g.addColorStop(1, 'rgb(22,18,16)');
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      // Damm och reflex
      ctx.fillStyle = 'rgba(210,180,140,0.12)'; ctx.fillRect(x, y + h * 0.6, w, h * 0.4);
      ctx.strokeStyle = 'rgba(255,240,220,0.18)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(x + w * 0.15, y + h * 0.9); ctx.lineTo(x + w * 0.55, y + h * 0.1); ctx.stroke();
    };
    const sash = (x, y, w, h, cols, rows) => {
      ctx.fillStyle = '#cdbd9e';
      for (let i = 1; i < cols; i++) ctx.fillRect(x + (w * i) / cols - 4, y, 8, h);
      for (let j = 1; j < rows; j++) ctx.fillRect(x, y + (h * j) / rows - 4, w, 8);
    };
    const plank = (x, y, w, h, a) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = `rgb(${130 + r() * 30},${100 + r() * 20},${70 + r() * 15})`;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = 'rgba(50,30,15,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#3a3330';
      for (const sx of [-w / 2 + 10, w / 2 - 10]) { ctx.beginPath(); ctx.arc(sx, 0, 3, 0, 7); ctx.fill(); }
      ctx.restore();
    };
    const cell = (i) => [(i % 4) * 256, Math.floor(i / 4) * 256];

    // 0 fönster med trasig gardin
    let [x, y] = cell(0);
    frame(x, y, 256, 256); glass(x + 22, y + 22, 212, 212); sash(x + 22, y + 22, 212, 212, 2, 2);
    ctx.fillStyle = 'rgba(120,45,35,0.8)';
    ctx.beginPath(); ctx.moveTo(x + 26, y + 26); ctx.lineTo(x + 90, y + 26); ctx.quadraticCurveTo(x + 50, y + 110, x + 70, y + 200); ctx.lineTo(x + 26, y + 220); ctx.fill();
    // 1 igenspikat
    [x, y] = cell(1);
    frame(x, y, 256, 256); glass(x + 22, y + 22, 212, 212, 10);
    plank(x + 128, y + 70, 250, 44, -0.08); plank(x + 128, y + 140, 250, 44, 0.12); plank(x + 128, y + 205, 250, 40, -0.04);
    // 2 krossat fönster
    [x, y] = cell(2);
    frame(x, y, 256, 256); glass(x + 22, y + 22, 212, 212); sash(x + 22, y + 22, 212, 212, 2, 2);
    ctx.fillStyle = '#0d0a09';
    ctx.beginPath(); ctx.moveTo(x + 130, y + 26); ctx.lineTo(x + 230, y + 26); ctx.lineTo(x + 230, y + 120); ctx.lineTo(x + 196, y + 84); ctx.lineTo(x + 170, y + 110); ctx.lineTo(x + 158, y + 60); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 26, y + 160); ctx.lineTo(x + 70, y + 140); ctx.lineTo(x + 60, y + 190); ctx.lineTo(x + 100, y + 230); ctx.lineTo(x + 26, y + 230); ctx.closePath(); ctx.fill();
    // 3 skyltfönster
    [x, y] = cell(3);
    frame(x, y, 256, 256); glass(x + 16, y + 16, 224, 224); sash(x + 16, y + 16, 224, 224, 3, 2);
    ctx.fillStyle = 'rgba(200,170,110,0.55)'; ctx.font = 'bold 26px Georgia, serif'; ctx.textAlign = 'center';
    ctx.fillText('OPEN', x + 128, y + 100);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x + 100, y + 76, 56, 6);
    // 4 dörr med speglar
    [x, y] = cell(4);
    frame(x, y, 256, 256, '#cdbd9e');
    ctx.fillStyle = '#7a5434'; ctx.fillRect(x + 30, y + 20, 196, 236);
    ctx.strokeStyle = 'rgba(40,24,12,0.7)'; ctx.lineWidth = 6;
    for (const [px, py, pw, ph] of [[48, 40, 70, 80], [138, 40, 70, 80], [48, 140, 70, 100], [138, 140, 70, 100]]) ctx.strokeRect(x + px, y + py, pw, ph);
    glass(x + 52, y + 44, 62, 72); glass(x + 142, y + 44, 62, 72);
    ctx.fillStyle = '#c9a050'; ctx.beginPath(); ctx.arc(x + 200, y + 150, 7, 0, 7); ctx.fill();
    // 5 salongsöppning: mörkt innanför
    [x, y] = cell(5);
    frame(x, y, 256, 256, '#cdbd9e');
    const dg = ctx.createLinearGradient(x, y, x, y + 256);
    dg.addColorStop(0, '#120c08'); dg.addColorStop(1, '#2a1c12');
    ctx.fillStyle = dg; ctx.fillRect(x + 22, y + 18, 212, 238);
    ctx.fillStyle = 'rgba(255,190,110,0.12)'; ctx.fillRect(x + 60, y + 60, 40, 30); ctx.fillRect(x + 160, y + 70, 30, 24);
    // 6 ladugårdsport
    [x, y] = cell(6);
    ctx.fillStyle = '#6e3a28'; ctx.fillRect(x, y, 256, 256);
    for (let k = 0; k < 256; k += 32) { ctx.fillStyle = 'rgba(30,15,10,0.6)'; ctx.fillRect(x + k, y, 3, 256); }
    ctx.strokeStyle = '#e8dcc4'; ctx.lineWidth = 12;
    ctx.strokeRect(x + 10, y + 10, 236, 240);
    ctx.beginPath(); ctx.moveTo(x + 128, y + 10); ctx.lineTo(x + 128, y + 250);
    ctx.moveTo(x + 14, y + 14); ctx.lineTo(x + 124, y + 246); ctx.moveTo(x + 242, y + 14); ctx.lineTo(x + 132, y + 246); ctx.stroke();
    // 7 galler
    [x, y] = cell(7);
    frame(x, y, 256, 256); glass(x + 22, y + 22, 212, 212); sash(x + 22, y + 22, 212, 212, 2, 2);
    ctx.fillStyle = '#2b2622';
    for (let k = 0; k < 6; k++) ctx.fillRect(x + 36 + k * 36, y + 18, 9, 222);
    ctx.fillRect(x + 22, y + 60, 212, 8); ctx.fillRect(x + 22, y + 190, 212, 8);
    // Damm över allt
    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? '220,190,150' : '50,35,25'},${0.05 + r() * 0.08})`;
      ctx.fillRect(r() * 1024, r() * 512, 1 + r() * 3, 1 + r() * 3);
    }
    return toTex(c, { repeat: false });
  });
}

// Skyltar: en rad per text
const SIGNS = ['SALOON', 'HOTEL', 'BANK', 'GENERAL STORE', 'SHERIFF', 'BARBER', 'ASSAY OFFICE', 'LIVERY STABLE', 'BAKERY', 'DRY GOODS', 'UNDERTAKER', 'MINE No. 3', 'DRY GULCH  POP. 0'];
const SIGN_STYLES = [
  ['#2a1c14', '#e8d6a8'], ['#e2d3b0', '#5a1f18'], ['#3a4a3a', '#e6d39a'], ['#efe2c2', '#22303a'], ['#5a2a1c', '#f0dcae'], ['#d8c8a2', '#2a1c14'],
];
const signCell = (text) => {
  const i = Math.max(0, SIGNS.indexOf(text));
  const n = SIGNS.length;
  return [0.004, 1 - (i + 1) / n + 0.002, 0.996, 1 - i / n - 0.002];
};

function signTexture() {
  return cached('signTex', () => {
    const W = 1024, RH = 128;
    const [c, ctx] = canvas(W, RH * SIGNS.length);
    const r = rng(131);
    SIGNS.forEach((text, i) => {
      const y = i * RH;
      const [bg, fg] = SIGN_STYLES[i % SIGN_STYLES.length];
      ctx.fillStyle = bg; ctx.fillRect(0, y, W, RH);
      // Brädor i skylten
      for (let k = 1; k < 3; k++) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, y + (RH * k) / 3, W, 2); }
      ctx.strokeStyle = fg; ctx.lineWidth = 5; ctx.strokeRect(10, y + 10, W - 20, RH - 20);
      let size = 92;
      ctx.font = `bold ${size}px Rockwell, "Courier New", Georgia, serif`;
      const wdt = ctx.measureText(text).width;
      if (wdt > W - 90) { size = Math.floor(size * (W - 90) / wdt); ctx.font = `bold ${size}px Rockwell, "Courier New", Georgia, serif`; }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillText(text, W / 2 + 4, y + RH / 2 + 6);
      ctx.fillStyle = fg; ctx.fillText(text, W / 2, y + RH / 2 + 3);
      // Avflagnat
      for (let k = 0; k < 420; k++) {
        ctx.fillStyle = r() < 0.6 ? bg : `rgba(120,90,60,${0.2 + r() * 0.3})`;
        ctx.globalAlpha = 0.3 + r() * 0.6;
        ctx.fillRect(r() * W, y + r() * RH, 2 + r() * 10, 1 + r() * 4);
      }
      ctx.globalAlpha = 1;
      const g = ctx.createLinearGradient(0, y, 0, y + RH);
      g.addColorStop(0, 'rgba(255,240,210,0.1)'); g.addColorStop(1, 'rgba(60,35,20,0.25)');
      ctx.fillStyle = g; ctx.fillRect(0, y, W, RH);
    });
    return toTex(c, { repeat: false });
  });
}

function barrelTexture() {
  return cached('barrelTex', () => {
    const [c, ctx] = canvas(256);
    const r = rng(141);
    const staves = 14, sw = 256 / staves;
    for (let i = 0; i < staves; i++) {
      const k = 0.85 + r() * 0.25;
      ctx.fillStyle = `rgb(${150 * k},${102 * k},${62 * k})`;
      ctx.fillRect(i * sw, 0, sw + 1, 256);
      ctx.fillStyle = 'rgba(40,22,10,0.6)'; ctx.fillRect(i * sw, 0, 2, 256);
      for (let g = 0; g < 6; g++) { ctx.fillStyle = 'rgba(60,35,15,0.18)'; ctx.fillRect(i * sw + r() * sw, 0, 1, 256); }
    }
    for (const v of [0.08, 0.3, 0.7, 0.92]) {
      ctx.fillStyle = '#3b332d'; ctx.fillRect(0, v * 256 - 7, 256, 14);
      ctx.fillStyle = 'rgba(150,80,40,0.5)'; for (let k = 0; k < 30; k++) ctx.fillRect(r() * 256, v * 256 - 7 + r() * 12, 4 + r() * 8, 2);
      ctx.fillStyle = 'rgba(220,210,190,0.25)'; ctx.fillRect(0, v * 256 - 7, 256, 2);
    }
    return toTex(c);
  });
}

function crateTexture() {
  return cached('crateTex', () => {
    const [c, ctx] = canvas(256);
    paintNoise(ctx, 256, 256, [176, 140, 96], { cells: 2, oct: 4, amt: 0.25, grain: 14, seed: 151 });
    for (let k = 0; k < 256; k += 51) { ctx.fillStyle = 'rgba(60,40,20,0.6)'; ctx.fillRect(0, k, 256, 3); }
    ctx.strokeStyle = '#7a5532'; ctx.lineWidth = 26; ctx.strokeRect(13, 13, 230, 230);
    ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(20, 236); ctx.lineTo(236, 20); ctx.stroke();
    ctx.strokeStyle = 'rgba(40,25,10,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(26, 26, 204, 204);
    ctx.fillStyle = 'rgba(40,25,15,0.7)'; ctx.font = 'bold 40px "Courier New", monospace'; ctx.textAlign = 'center';
    ctx.save(); ctx.translate(128, 128); ctx.rotate(-0.0); ctx.fillText('OATS', 0, 50); ctx.restore();
    return toTex(c);
  });
}

function cactusTexture() {
  return cached('cactusTex', () => {
    const [c, ctx] = canvas(256);
    const ribs = 14, rw = 256 / ribs;
    for (let i = 0; i < ribs; i++) {
      const g = ctx.createLinearGradient(i * rw, 0, (i + 1) * rw, 0);
      g.addColorStop(0, '#3e5a2c'); g.addColorStop(0.5, '#7d9a58'); g.addColorStop(1, '#3a5228');
      ctx.fillStyle = g; ctx.fillRect(i * rw, 0, rw + 1, 256);
    }
    const r = rng(161);
    ctx.fillStyle = 'rgba(240,230,190,0.85)';
    for (let i = 0; i < ribs; i++) for (let y = 4; y < 256; y += 12) {
      ctx.fillRect(i * rw + rw / 2 - 1, y + r() * 3, 2, 2);
    }
    return toTex(c);
  });
}

function rockTexture() {
  return cached('rockTex', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [210, 190, 170], { cells: 4, oct: 6, amt: 0.4, grain: 16, seed: 171 });
    const r = rng(172);
    for (let i = 0; i < 40; i++) {
      const y = r() * S;
      ctx.fillStyle = `rgba(${r() < 0.5 ? '255,240,220' : '70,40,25'},${0.06 + r() * 0.1})`;
      ctx.fillRect(0, y, S, 2 + r() * 10);
    }
    ctx.strokeStyle = 'rgba(50,30,20,0.4)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 30; i++) {
      let x = r() * S, y = r() * S;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 30; y += r() * 25; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    return toTex(c);
  });
}

// Kvistar på genomskinlig botten (tumlegräs och torra buskar)
function twigTexture() {
  return cached('twigTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    const r = rng(181);
    ctx.lineCap = 'round';
    for (let i = 0; i < 520; i++) {
      const x = r() * S, y = r() * S, len = 10 + r() * 50, a = r() * Math.PI * 2, bend = (r() - 0.5) * 2;
      const k = 0.7 + r() * 0.5;
      ctx.strokeStyle = `rgb(${170 * k},${130 * k},${82 * k})`;
      ctx.lineWidth = 1 + r() * 2.2;
      wrapDraw(S, S, x, y, len, (px, py) => {
        ctx.beginPath(); ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + Math.cos(a + bend) * len / 2, py + Math.sin(a + bend) * len / 2, px + Math.cos(a) * len, py + Math.sin(a) * len);
        ctx.stroke();
      });
    }
    return toTex(c);
  });
}

const MATERIALS = {
  wood: () => cached('woodMat', () => new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.92, vertexColors: true })),
  roof: () => cached('roofMat', () => new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.7, metalness: 0.25, vertexColors: true, side: THREE.DoubleSide })),
  open: () => cached('openMat', () => new THREE.MeshStandardMaterial({ map: openingsTexture(), roughness: 0.55, vertexColors: true })),
  sign: () => cached('signMat', () => new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.85, vertexColors: true, side: THREE.DoubleSide })),
  barrel: () => cached('barrelMat', () => new THREE.MeshStandardMaterial({ map: barrelTexture(), roughness: 0.8, vertexColors: true })),
  crate: () => cached('crateMat', () => new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.9, vertexColors: true })),
  cactus: () => cached('cactusMat', () => new THREE.MeshStandardMaterial({ map: cactusTexture(), roughness: 0.75, vertexColors: true })),
  rock: () => cached('rockMat', () => new THREE.MeshStandardMaterial({ map: rockTexture(), roughness: 0.95, vertexColors: true, flatShading: true })),
  mesa: () => cached('mesaMat', () => new THREE.MeshStandardMaterial({ map: rockTexture(), roughness: 1, vertexColors: true, flatShading: true })),
  shade: () => cached('shadeMat', () => {
    const [c, ctx] = canvas(64, 256);
    const img = ctx.createImageData(64, 256);
    const ramp = (t, e) => Math.min(1, Math.min(t, 1 - t) / e);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
      const v = 255 * 0.62 * ramp(y / 255, 0.2) * ramp(x / 63, 0.12);
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: toTex(c, { repeat: false, srgb: false }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -8 });
  }),
  iron: () => cached('ironMat', () => new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.6, metalness: 0.5, vertexColors: true })),
  twig: () => cached('twigMat', () => new THREE.MeshStandardMaterial({ map: twigTexture(), roughness: 1, alphaTest: 0.35, side: THREE.DoubleSide, vertexColors: true })),
  hay: () => cached('hayMat', () => new THREE.MeshStandardMaterial({ map: hayTexture(), roughness: 1, vertexColors: true })),
  water: () => cached('waterMat', () => new THREE.MeshStandardMaterial({ color: 0x2c4a50, roughness: 0.08, metalness: 0.3, vertexColors: true })),
};

// Halm: täta strån i olika gula toner
function hayTexture() {
  return cached('hayTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [196, 160, 84], { cells: 4, oct: 4, amt: 0.3, grain: 18, seed: 191 });
    const r = rng(192);
    ctx.lineCap = 'round';
    for (let i = 0; i < 1400; i++) {
      const x = r() * S, y = r() * S, len = 6 + r() * 22, a = (r() - 0.5) * 0.9;
      const k = 0.6 + r() * 0.65;
      ctx.strokeStyle = `rgba(${235 * k},${200 * k},${110 * k},0.85)`;
      ctx.lineWidth = 0.8 + r() * 1.4;
      wrapDraw(S, S, x, y, len, (px, py) => {
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); ctx.stroke();
      });
    }
    return toTex(c);
  });
}

// ===========================================================================
// Mark: sand med småsten, sprickor och gamla hjulspår
// ===========================================================================

const SAND_TILE = 9; // meter per texturupprepning

function sandTexture() {
  return cached('sandTex', () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [212, 172, 122], { cells: 4, oct: 7, amt: 0.22, grain: 14, seed: 201 });
    const r = rng(202);
    // Mjuka fläckar: ljusare drivsand och mörkare packad jord
    for (let i = 0; i < 40; i++) {
      const x = r() * S, y = r() * S, rad = 30 + r() * 150;
      const light = r() < 0.5;
      wrapDraw(S, S, x, y, rad, (px, py) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, light ? 'rgba(240,215,170,0.18)' : 'rgba(150,105,65,0.14)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    // Vindrippel
    ctx.lineWidth = 2;
    for (let i = 0; i < 160; i++) {
      const x = r() * S, y = r() * S, len = 40 + r() * 120;
      ctx.strokeStyle = `rgba(${r() < 0.5 ? '250,230,190' : '140,100,60'},0.12)`;
      wrapDraw(S, S, x, y, len, (px, py) => {
        ctx.beginPath(); ctx.moveTo(px, py);
        ctx.bezierCurveTo(px + len * 0.3, py - 6, px + len * 0.7, py + 6, px + len, py + (r() - 0.5) * 8);
        ctx.stroke();
      });
    }
    // Uttorkade sprickor
    ctx.strokeStyle = 'rgba(110,75,45,0.35)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 18; i++) {
      let x = r() * S, y = r() * S, a = r() * Math.PI * 2;
      const pts = [[x, y]];
      for (let k = 0; k < 14; k++) { a += (r() - 0.5) * 1.4; x += Math.cos(a) * 7; y += Math.sin(a) * 7; pts.push([x, y]); }
      wrapDraw(S, S, pts[0][0], pts[0][1], 120, (px, py) => {
        const dx = px - pts[0][0], dy = py - pts[0][1];
        ctx.beginPath(); pts.forEach(([qx, qy], k) => (k ? ctx.lineTo(qx + dx, qy + dy) : ctx.moveTo(qx + dx, qy + dy))); ctx.stroke();
      });
    }
    // Gamla vagnshjulspår: parallella mörka stråk
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const x = r() * S, y = r() * S, len = 300 + r() * 400, a = r() * Math.PI * 2, bend = (r() - 0.5) * 0.5;
      const nx = -Math.sin(a), ny = Math.cos(a);
      for (const off of [-22, 22]) {
        ctx.strokeStyle = 'rgba(120,85,50,0.16)'; ctx.lineWidth = 7;
        wrapDraw(S, S, x, y, len, (px, py) => {
          const ox = px + nx * off, oy = py + ny * off;
          ctx.beginPath(); ctx.moveTo(ox, oy);
          ctx.quadraticCurveTo(ox + Math.cos(a + bend) * len / 2, oy + Math.sin(a + bend) * len / 2, ox + Math.cos(a) * len, oy + Math.sin(a) * len);
          ctx.stroke();
        });
      }
    }
    pebbles(ctx, S, S, r, 1400, 2.2, ['#a88a6a', '#8c7058', '#c2a888', '#7a6656', '#b59a7c', '#9a7a5c']);
    return toTex(c);
  });
}

export function makeDesertGround(scene, world, RAPIER, { size, visual = 560 } = {}) {
  const half = size / 2;
  if (world) {
    const body = fixedBody(world, RAPIER);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half + 10, 0.5, half + 10).setTranslation(0, -0.5, 0).setFriction(0.95).setCollisionGroups(groups(G.WORLD)),
      body
    );
  }
  if (!scene) return;
  const map = sandTexture().clone();
  map.needsUpdate = true;
  const g = new THREE.PlaneGeometry(visual, visual, 140, 140);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  const n = sinNoise(203);
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    uv.setXY(i, x / SAND_TILE, z / SAND_TILE);
    const k = 0.92 + n(x * 0.03, 0, z * 0.03) * 0.12 + n(x * 0.11, 3, z * 0.11) * 0.04;
    const red = n(x * 0.015, 7, z * 0.015) * 0.06;
    col[i * 3] = k + red; col[i * 3 + 1] = k - red * 0.3; col[i * 3 + 2] = k - red;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map, roughness: 1, vertexColors: true }));
  ground.receiveShadow = true;
  scene.add(ground);
}

// ===========================================================================
// Banan: packad jord med hjulspår över vägen, plankdäck på bron
// ===========================================================================

function trackDirtTexture() {
  return cached('dirtTex', () => {
    const W = 256, H = 512;
    const [c, ctx] = canvas(W, H);
    const r = rng(211);
    const n = valueNoise(W, H, 4, 5, rng(212));
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, u = x / W;
      const edge = Math.min(1, Math.min(u, 1 - u) / 0.12);
      // Två hjulspår (mörkare, packade) och en ljus sandrygg emellan
      const rut = Math.max(0, 1 - Math.abs(Math.abs(u - 0.5) - 0.17) / 0.07);
      const mid = Math.max(0, 1 - Math.abs(u - 0.5) / 0.06);
      const k = 0.9 + n[i] * 0.25 - rut * 0.14 + mid * 0.1;
      img.data[i * 4] = 168 * k;
      img.data[i * 4 + 1] = 128 * k;
      img.data[i * 4 + 2] = 86 * k;
      img.data[i * 4 + 3] = 255 * edge * edge * (0.55 + 0.25 * n[i] + rut * 0.3);
    }
    ctx.putImageData(img, 0, 0);
    // Däckmönster i spåren
    for (const cu of [0.33, 0.67]) {
      for (let y = 0; y < H; y += 7) {
        ctx.fillStyle = `rgba(90,62,40,${0.15 + r() * 0.15})`;
        ctx.fillRect(cu * W - 9 + (r() - 0.5) * 3, y, 18, 3);
      }
    }
    pebbles(ctx, W, H, r, 260, 1.8, ['#9a7c5e', '#7e6550', '#b39878', '#8a7462']);
    return toTex(c);
  });
}

export function addTrackDirt(scene, track) {
  const { pts, normals, N, roadHalf, isGap, dist } = track;
  const extra = 0.55, half = roadHalf + extra;
  const dPos = [], dUv = [], dIdx = [];
  const pPos = [], pUv = [], pIdx = [];
  const flat = (i) => pts[i % N].y < 0.02 && !isGap[i % N];
  const high = (i) => pts[i % N].y >= 0.02 && !isGap[i % N];
  for (let i = 0; i <= N; i++) {
    const p = pts[i % N], nn = normals[i % N], v = (dist[i] ?? track.length);
    dPos.push(p.x + nn.x * half, p.y + 0.012 + bankY(track, i, half), p.z + nn.z * half, p.x - nn.x * half, p.y + 0.012 - bankY(track, i, half), p.z - nn.z * half);
    dUv.push(0, v / 6, 1, v / 6);
    pPos.push(p.x + nn.x * roadHalf, p.y + 0.014 + bankY(track, i, roadHalf), p.z + nn.z * roadHalf, p.x - nn.x * roadHalf, p.y + 0.014 - bankY(track, i, roadHalf), p.z - nn.z * roadHalf);
    pUv.push(v / 2, 0, v / 2, (roadHalf * 2) / 2);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    if (flat(i) && flat(i + 1)) dIdx.push(a, b, c, b, d, c);
    else if (!isGap[i] && !isGap[(i + 1) % N] && (high(i) || high(i + 1))) pIdx.push(a, b, c, b, d, c);
  }
  const mk = (pos, uv, idx, mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  mk(dPos, dUv, dIdx, cached('dirtMat', () => new THREE.MeshStandardMaterial({
    map: trackDirtTexture(), roughness: 1, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -4,
  })));
  if (pIdx.length) {
    mk(pPos, pUv, pIdx, cached('deckMat', () => new THREE.MeshStandardMaterial({
      map: woodTexture(), color: 0xb09a80, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    })));
  }
}

// Torr bäckfåra: mörkare sprucken lera och sten, mjuka kanter
function creekTexture() {
  return cached('creekTex', () => {
    const W = 256, H = 512;
    const [c, ctx] = canvas(W, H);
    paintNoise(ctx, W, H, [150, 112, 78], {
      cells: 4, oct: 5, amt: 0.3, grain: 12, seed: 221,
      alpha: (x) => { const u = x / W; const e = Math.min(1, Math.min(u, 1 - u) / 0.3); return 255 * e * e; },
    });
    const r = rng(222);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = 'rgba(80,55,35,0.5)'; ctx.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
      let x = W * (0.25 + r() * 0.5), y = r() * H;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 12; y += (r() - 0.5) * 12; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    pebbles(ctx, W, H, r, 380, 3, ['#9c8a78', '#857160', '#b8a68e', '#6e6054']);
    ctx.globalCompositeOperation = 'source-over';
    return toTex(c);
  });
}

export function addCreekBed(scene, { points, width = 3.4 }) {
  if (!scene) return;
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const n = Math.ceil(curve.getLength() / 0.8);
  const pos = [], uv = [], idx = [];
  const sp = curve.getSpacedPoints(n);
  let along = 0;
  for (let i = 0; i <= n; i++) {
    const p = sp[i], q = sp[Math.min(n, i + 1)], o = sp[Math.max(0, i - 1)];
    const tx = q.x - o.x, tz = q.z - o.z, l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l;
    if (i) along += p.distanceTo(sp[i - 1]);
    const w = width * (0.8 + 0.25 * Math.sin(i * 0.37)) / 2;
    pos.push(p.x + nx * w, 0.006, p.z + nz * w, p.x - nx * w, 0.006, p.z - nz * w);
    uv.push(0, along / 4, 1, along / 4);
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    map: creekTexture(), roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  }));
  m.receiveShadow = true;
  scene.add(m);
}

// ===========================================================================
// Hus: träfasad med falsk front, skylt, fönster, trottoar och veranda
// ===========================================================================

const mul = (c, k) => c.map((v) => v * k);

/**
 * Hus med fronten i (x, z) som vetter åt lokal +z vriden rot.
 * opts: w, d, h (takfot), front (falska frontens höjd), floors, balcony, porch,
 * gable (ladugård utan falsk front), door: 'door'|'swing'|'barn', sign (text),
 * boarded, shop, bars, tint [r,g,b], seed.
 */
export function addBuilding(B, world, RAPIER, o) {
  const {
    x, z, rot = 0, w, d = 7, h, front = h + 1.6, floors = 1, balcony = false, porch = true, gable = false,
    door = 'door', sign = null, boarded = false, shop = false, bars = false, tint = [0.8, 0.72, 0.62], seed = 1,
  } = o;
  const deckH = 0.32, deckD = 2.5, W = w + 0.3;
  if (world) {
    const body = fixedBody(world, RAPIER, x, 0, z, rot);
    boxCollider(world, RAPIER, body, w / 2, h / 2, d / 2, 0, h / 2, -d / 2);
    if (porch) boxCollider(world, RAPIER, body, (W + 0.4) / 2, deckH / 2, deckD / 2, 0, deckH / 2, deckD / 2);
  }
  if (!B) return;
  const r = rng(seed * 13 + 3);
  const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
  const add = (key, geo, col) => { geo.applyMatrix4(M); B.add(key, geo, col); };
  const wall = tint, trim = mul(tint, 0.62), deckCol = [0.72, 0.64, 0.56], dark = [0.45, 0.36, 0.3];

  // Stomme och sadeltak (nock framifrån och bakåt)
  add('wood', box(w, h, d, 0, h / 2, -d / 2), wall);
  const rise = w * 0.26, slope = Math.atan2(rise, w / 2), sl = Math.hypot(w / 2 + 0.35, rise * (1 + 0.35 / (w / 2)));
  for (const s of [-1, 1]) {
    const g = box(sl, 0.08, d + 0.5, 0, 0, 0, { m: 1.6, swap: true });
    g.rotateZ(-s * slope);
    g.translate(s * (w / 4 + 0.17), h + rise / 2 - 0.05, -d / 2);
    add('roof', g, [0.92, 0.88, 0.85]);
  }
  const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)]);
  for (const zz of gable ? [-d, 0.001] : [-d]) {
    const g = new THREE.ShapeGeometry(tri);
    g.scale(1, 1, 1);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
    if (zz < 0) g.rotateY(Math.PI);
    g.translate(0, h, zz);
    add('wood', g, wall);
  }

  // Falsk front med trappad eller rundad topp
  let shoulder = front;
  if (!gable) {
    const variant = Math.floor(r() * 4);
    const pts = [[-W / 2, 0], [W / 2, 0]];
    if (variant === 0) { pts.push([W / 2, front], [-W / 2, front]); }
    else if (variant === 1) { shoulder = front - 0.8; pts.push([W / 2, shoulder], [W * 0.22, shoulder], [W * 0.22, front], [-W * 0.22, front], [-W * 0.22, shoulder], [-W / 2, shoulder]); }
    else if (variant === 2) {
      shoulder = front - 0.7;
      pts.push([W / 2, shoulder]);
      for (let k = 0; k <= 10; k++) { const u = W * 0.3 * (1 - (k / 10) * 2); pts.push([u, shoulder + Math.sin((k / 10) * Math.PI) * 0.7]); }
      pts.push([-W / 2, shoulder]);
    } else { shoulder = front - 0.6; pts.push([W / 2, shoulder], [0, front], [-W / 2, shoulder]); }
    const sh = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: false });
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
    add('wood', g, wall);
    // Taklist och hörnbrädor
    add('wood', box(W + 0.3, 0.2, 0.4, 0, shoulder - 0.1, 0.2, { m: 1, swap: true }), trim);
    add('wood', box(W + 0.1, 0.1, 0.3, 0, shoulder - 0.32, 0.17, { m: 1, swap: true }), trim);
    if (variant === 1) add('wood', box(W * 0.44 + 0.2, 0.16, 0.36, 0, front - 0.08, 0.18, { m: 1, swap: true }), trim);
    for (const s of [-1, 1]) add('wood', box(0.18, shoulder, 0.22, s * (W / 2 - 0.09), shoulder / 2, 0.2, { m: 1 }), trim);
  }

  // Skylt
  if (sign) {
    const signY = floors === 2 ? Math.min(shoulder - 0.9, h + 0.6) : (3.5 + shoulder - 0.4) / 2;
    const sw = Math.min(W * 0.84, sign.length * 0.62 + 1.6), sh = Math.min(1.0, sw / 6.2);
    add('wood', box(sw + 0.2, sh + 0.2, 0.06, 0, signY, 0.2), trim);
    const g = atlasPlane(sw, sh, signCell(sign));
    g.translate(0, signY, 0.24);
    add('sign', g, [1, 1, 1]);
  }

  // Fönster och dörr på bottenvåningen
  const pick = () => {
    if (bars) return OPEN.barred;
    if (boarded) return r() < 0.7 ? OPEN.boarded : OPEN.broken;
    if (shop) return OPEN.shop;
    const k = r();
    return k < 0.6 ? OPEN.window : k < 0.85 ? OPEN.broken : OPEN.boarded;
  };
  const opening = (cell, ww, hh, ox, oy, sill = true) => {
    const g = atlasPlane(ww, hh, openCell(cell));
    g.translate(ox, oy, 0.18);
    add('open', g, [1, 1, 1]);
    if (sill) {
      add('wood', box(ww + 0.24, 0.08, 0.14, ox, oy - hh / 2 - 0.02, 0.24, { m: 1, swap: true }), trim);
      add('wood', box(ww + 0.3, 0.12, 0.1, ox, oy + hh / 2 + 0.06, 0.22, { m: 1, swap: true }), trim);
    }
  };
  const dw = door === 'barn' ? 2.6 : door === 'swing' ? 1.5 : 1.2, dh = door === 'barn' ? 3.0 : 2.4;
  opening(OPEN[door], dw, dh, 0, dh / 2 + (porch ? deckH : 0), false);
  add('wood', box(dw + 0.3, 0.16, 0.12, 0, dh + (porch ? deckH : 0) + 0.08, 0.22, { m: 1, swap: true }), trim);
  const ws = shop ? [w * 0.27] : w >= 9 ? [w * 0.22, w * 0.4] : [w * 0.3];
  for (const wx of ws) for (const s of [-1, 1]) {
    const big = shop;
    opening(pick(), big ? 2.0 : 1.0, big ? 1.8 : 1.5, s * wx, (porch ? deckH : 0) + (big ? 1.45 : 1.6));
  }
  if (door === 'swing') {
    // Salongsdörrar på glänt
    for (const s of [-1, 1]) {
      const g = box(0.66, 0.95, 0.04, s * 0.33, 0, 0, { m: 1 });
      g.rotateY(s * 0.35);
      g.translate(s * 0.39, deckH + 1.3, 0.3);
      add('wood', g, mul(wall, 0.85));
    }
  }
  if (gable) opening(OPEN.barn, 1.4, 1.3, 0, h + 0.7, false);
  // Övervåning
  if (floors === 2) {
    const n = w >= 9 ? 3 : 2;
    for (let k = 0; k < n; k++) opening(pick(), 0.95, 1.45, (k - (n - 1) / 2) * (w / n), 4.85);
  }
  // Baksida
  for (const s of [-1, 1]) {
    const g = atlasPlane(0.9, 1.3, openCell(r() < 0.5 ? OPEN.boarded : OPEN.window));
    g.rotateY(Math.PI);
    g.translate(s * w * 0.28, 1.7, -d - 0.02);
    add('open', g, [0.9, 0.9, 0.9]);
  }

  // Trottoar med veranda eller balkong
  if (porch) {
    add('wood', box(W + 0.4, deckH, deckD, 0, deckH / 2, deckD / 2, { m: 2, swap: true }), deckCol);
    add('wood', box(1.6, 0.16, 0.4, 0, 0.08, deckD + 0.2, { m: 1, swap: true }), mul(deckCol, 0.9));
    const top = balcony ? 4.4 : 3.05;
    const posts = Math.max(2, Math.round(W / 2.6) + 1);
    for (let k = 0; k < posts; k++) {
      const px = -W / 2 - 0.05 + ((W + 0.1) * k) / (posts - 1);
      add('wood', box(0.14, top - deckH, 0.14, px, deckH + (top - deckH) / 2, deckD - 0.12, { m: 1 }), trim);
    }
    if (balcony) {
      const by = 3.3;
      add('wood', box(W + 0.4, 0.14, deckD, 0, by, deckD / 2, { m: 2, swap: true }), deckCol);
      add('wood', box(W + 0.4, 0.07, 0.08, 0, by + 0.95, deckD - 0.12, { m: 1, swap: true }), trim);
      add('wood', box(W + 0.4, 0.05, 0.06, 0, by + 0.2, deckD - 0.12, { m: 1, swap: true }), trim);
      for (let bx = -W / 2; bx <= W / 2; bx += 0.28) add('wood', box(0.04, 0.75, 0.04, bx, by + 0.57, deckD - 0.12, { m: 1 }), mul(trim, 1.2));
      for (const s of [-1, 1]) add('wood', box(0.07, 0.07, deckD, s * (W / 2 + 0.15), by + 0.95, deckD / 2, { m: 1 }), trim);
      opening(OPEN.door, 1.0, 2.1, 0, by + 1.12, false);
    } else {
      // Snett verandatak i plåt
      const len = Math.hypot(deckD + 0.1, 0.4);
      const g = box(W + 0.5, 0.06, len, 0, 0, 0, { m: 1.6 });
      g.rotateX(Math.atan2(0.4, deckD + 0.1));
      g.translate(0, 3.25, (deckD + 0.1) / 2);
      add('roof', g, [0.85, 0.82, 0.8]);
      add('wood', box(W + 0.3, 0.16, 0.16, 0, 3.0, deckD - 0.12, { m: 1, swap: true }), trim);
    }
  }
}

// ===========================================================================
// Gruvtunnel: timrade portaler och stämp genom ett klippigt berg
// ===========================================================================

export function addMineTunnel(B, world, RAPIER, { x, z, heading, length = 11, seed = 1 }) {
  const L = length, half = 2.25, H = 2.9;
  if (world) {
    const body = fixedBody(world, RAPIER, x, 0, z, heading);
    for (const s of [-1, 1]) boxCollider(world, RAPIER, body, 5, 4, L / 2 + 2.5, s * (half + 0.45 + 5), 4, 0);
  }
  if (!B) return;
  const M = new THREE.Matrix4().makeRotationY(heading).setPosition(x, 0, z);
  const add = (key, geo, col) => { geo.applyMatrix4(M); B.add(key, geo, col); };
  const timber = [0.5, 0.4, 0.32], old = [0.34, 0.28, 0.23];
  const r = rng(seed);

  // Stämp: stolpar och hammarband, plankor i tak och väggar
  const sets = Math.round(L / 1.4);
  for (let k = 0; k <= sets; k++) {
    const u = -L / 2 + (L * k) / sets;
    const end = k === 0 || k === sets;
    const t = end ? 0.32 : 0.22;
    for (const s of [-1, 1]) {
      const lean = end ? 0 : 0.03;
      add('wood', beam(s * half, 0, u, s * (half - lean), H, u, t), end ? timber : old);
    }
    add('wood', box(half * 2 + (end ? 1.0 : 0.5), t + 0.04, t, 0, H + t / 2, u, { m: 1, swap: true }), end ? timber : old);
  }
  for (let k = 0; k < 10; k++) {
    const v = -half + 0.1 + (k * (half * 2 - 0.2)) / 9;
    add('wood', box(0.42, 0.06, L, v, H + 0.3, 0, { m: 2, swap: true }), mul(old, 0.8 + r() * 0.3));
  }
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {
    add('wood', box(0.06, 0.45, L, s * (half + 0.2), 0.25 + k * 0.48, 0, { m: 2, swap: true }), mul(old, 0.7 + r() * 0.3));
  }
  // Mörker i tunneln (skuggkameran täcker inte hela berget)
  const shade = new THREE.PlaneGeometry(half * 2 + 0.6, L + 3);
  shade.rotateX(-Math.PI / 2);
  shade.translate(0, 0.03, 0);
  add('shade', shade, [1, 1, 1]);
  // Skylt över ingången (bilarna kör mot +u)
  const sg = atlasPlane(3.2, 0.62, signCell('MINE No. 3'));
  sg.rotateY(Math.PI);
  sg.translate(0, H + 0.75, -L / 2 - 0.22);
  add('sign', sg, [0.95, 0.95, 0.95]);
  add('wood', box(3.4, 0.8, 0.08, 0, H + 0.75, -L / 2 - 0.16), timber);
  for (const s of [-1, 1]) add('wood', box(0.1, 0.9, 0.1, s * 1.3, H + 0.55, -L / 2 - 0.12, { m: 1 }), timber);

  // Berget: stora klumpar, urholkade där tunneln går
  const blobs = [];
  for (const s of [-1, 1]) {
    blobs.push([s * 7, 2.6, -L / 2 + 3.2, 5.0, 4.6, 3.6], [s * 7.5, 2.8, L / 2 - 3.0, 5.5, 4.8, 3.8], [s * 13.5, 2.6, 0, 6.5, 5.6, 7.5], [s * 5.4, 0.8, -L / 2 - 0.6, 2.0, 1.3, 1.5]);
    blobs.push([s * 5.2, 0.9, L / 2 + 0.6, 1.8, 1.2, 1.4], [s * 20, 1.6, -3, 5, 3.4, 6], [s * 3.8, 4.8, -0.5, 3.4, 2.6, L / 2 - 1]);
  }
  blobs.push([0, 5.4, 0, 4.4, 2.6, L / 2 - 0.6], [0, 7.2, 1, 5.5, 2.4, 3.5], [-7, 7.6, 1, 4, 2.6, 4], [8, 6.8, -1, 4, 2.2, 3.5]);
  blobs.forEach(([bx, by, bz, sx, sy, sz], i) => {
    const g = rockGeo(seed * 31 + i, 2, 0.34, 0.22);
    g.scale(sx, sy, sz);
    g.translate(bx, by, bz);
    // Gröp ur tunnelrummet
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const vx = p.getX(k), vy = p.getY(k), vz = p.getZ(k);
      if (Math.abs(vx) < half + 0.3 && vy < H + 0.5) {
        if (Math.abs(vz) <= L / 2 + 0.6) p.setY(k, H + 0.5);
        else p.setX(k, Math.sign(vx || 1) * (half + 1.4));
      }
      if (vy < -0.2) p.setY(k, -0.2);
    }
    g.computeVertexNormals();
    strataColors(g, { scale: 0.7, shade: 0.95, seed: i });
    add('rock', g, null);
  });
}

// ===========================================================================
// Rekvisita
// ===========================================================================

function barrelGeo(r0 = 0.27, r1 = 0.31, h = 0.88) {
  const prof = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    prof.push(new THREE.Vector2(r0 + (r1 - r0) * Math.sin(t * Math.PI), t * h));
  }
  const g = new THREE.LatheGeometry(prof, 16);
  const cap = new THREE.CircleGeometry(r0, 16);
  cap.rotateX(-Math.PI / 2);
  cap.translate(0, h - 0.02, 0);
  return [g, cap];
}

export function addBarrel(B, world, RAPIER, { x, z, seed = 1, tipped = false }) {
  if (world) {
    const body = fixedBody(world, RAPIER, x, 0, z);
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.44, 0.3).setTranslation(0, 0.44, 0).setFriction(0.6).setCollisionGroups(groups(G.WORLD)), body);
  }
  if (!B) return;
  const r = rng(Math.floor(seed * 17) + 5);
  const k = 0.85 + r() * 0.25;
  for (const g of barrelGeo()) {
    g.rotateY(r() * 6.28);
    if (tipped) { g.rotateZ(Math.PI / 2); g.translate(0.44, 0.3, 0); }
    g.translate(x, 0, z);
    B.add('barrel', g, [k, k * 0.97, k * 0.94]);
  }
}

export function addCrate(B, world, RAPIER, { x, z, rot = 0, stack = 1, s = 0.7 }) {
  if (world) {
    const body = fixedBody(world, RAPIER, x, 0, z, rot);
    boxCollider(world, RAPIER, body, s / 2, (s * stack) / 2, s / 2, 0, (s * stack) / 2, 0);
  }
  if (!B) return;
  for (let k = 0; k < stack; k++) {
    const g = box(s, s, s, 0, s / 2 + k * s, 0, { m: s });
    g.rotateY(rot + (k % 2 ? 0.2 : 0));
    g.translate(x, 0, z);
    B.add('crate', g, mul([1, 0.95, 0.9], 0.85 + (k % 3) * 0.08));
  }
}

function wheelGeos(R = 0.55) {
  const out = [];
  const rim = new THREE.TorusGeometry(R, 0.045, 6, 28);
  out.push(['wood', rim], ['iron', new THREE.TorusGeometry(R + 0.03, 0.022, 4, 28)]);
  const hub = new THREE.CylinderGeometry(0.09, 0.09, 0.18, 10);
  hub.rotateX(Math.PI / 2);
  out.push(['wood', hub]);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    out.push(['wood', beam(0, 0, 0, Math.cos(a) * R, Math.sin(a) * R, 0, 0.04)]);
  }
  return out;
}

export function addWagonWheel(B, { x, z, rot = 0, lean = 0.2, R = 0.55 }) {
  if (!B) return;
  const M = new THREE.Matrix4().makeRotationY(rot).multiply(new THREE.Matrix4().makeRotationX(-lean));
  for (const [key, g] of wheelGeos(R)) {
    g.translate(0, R + 0.02, 0);
    g.applyMatrix4(M);
    g.translate(x, 0, z);
    B.add(key, g, key === 'iron' ? [0.5, 0.48, 0.46] : [0.62, 0.5, 0.4]);
  }
}

export function addHitchingPost(B, world, RAPIER, { x, z, rot = 0, len = 2.6 }) {
  if (world) {
    const body = fixedBody(world, RAPIER, x, 0, z, rot);
    for (const s of [-1, 1]) boxCollider(world, RAPIER, body, 0.07, 0.5, 0.07, s * (len / 2 - 0.15), 0.5, 0);
  }
  if (!B) return;
  const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
  const col = [0.55, 0.45, 0.36];
  for (const s of [-1, 1]) { const g = box(0.13, 1.05, 0.13, s * (len / 2 - 0.15), 0.525, 0, { m: 1 }); g.applyMatrix4(M); B.add('wood', g, col); }
  const rail = new THREE.CylinderGeometry(0.05, 0.05, len, 8);
  rail.rotateZ(Math.PI / 2);
  rail.translate(0, 0.98, 0);
  rail.applyMatrix4(M);
  B.add('wood', rail, mul(col, 1.1));
}

export function addWaterTower(B, world, RAPIER, { x, z, H = 6.2 }) {
  const foot = 1.8, topw = 1.3;
  if (world) {
    const body = fixedBody(world, RAPIER, x, 0, z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) boxCollider(world, RAPIER, body, 0.15, H / 2, 0.15, sx * (foot + topw) / 2, H / 2, sz * (foot + topw) / 2);
  }
  if (!B) return;
  const add = (key, g, col) => { g.translate(x, 0, z); B.add(key, g, col); };
  const tim = [0.52, 0.42, 0.34];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) add('wood', beam(sx * foot, 0, sz * foot, sx * topw, H, sz * topw, 0.24), tim);
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
    const at = (y) => foot + (topw - foot) * (y / H);
    for (const [y0, y1] of [[0.4, H * 0.5], [H * 0.5, H - 0.2]]) {
      add('wood', beam(ax * at(y0), y0, az * at(y0), bx * at(y1), y1, bz * at(y1), 0.1), mul(tim, 0.9));
      add('wood', beam(bx * at(y0), y0, bz * at(y0), ax * at(y1), y1, az * at(y1), 0.1), mul(tim, 0.9));
    }
    add('wood', beam(ax * at(H * 0.5), H * 0.5, az * at(H * 0.5), bx * at(H * 0.5), H * 0.5, bz * at(H * 0.5), 0.14), tim);
  }
  add('wood', box(3.4, 0.18, 3.4, 0, H + 0.09, 0, { m: 2, swap: true }), [0.6, 0.52, 0.44]);
  const [tank, cap] = barrelGeo(1.55, 1.6, 2.7);
  tank.translate(0, H + 0.18, 0);
  add('barrel', tank, [0.9, 0.82, 0.74]);
  void cap;
  const roof = new THREE.ConeGeometry(1.85, 1.0, 18, 1, true);
  roof.translate(0, H + 0.18 + 2.7 + 0.45, 0);
  add('roof', roof, [0.85, 0.8, 0.75]);
  // Pip och stege
  add('iron', beam(1.2, H - 0.2, 0, 2.1, H - 1.4, 0, 0.14), [0.5, 0.45, 0.4]);
  for (const s of [-1, 1]) add('wood', beam(2.05 + s * 0, 0, s * 0.25, 1.45, H, s * 0.25, 0.06), tim);
  for (let y = 0.4; y < H; y += 0.4) {
    const t = y / H, xx = 2.05 + (1.45 - 2.05) * t;
    add('wood', box(0.05, 0.05, 0.56, xx, y, 0, { m: 1 }), tim);
  }
}

export function addWindpump(B, world, RAPIER, { x, z, H = 7.5, rot = 0.6 }) {
  if (world) {
    const body = fixedBody(world, RAPIER, x, 0, z);
    boxCollider(world, RAPIER, body, 0.9, H / 2, 0.9, 0, H / 2, 0);
  }
  if (!B) return;
  const add = (key, g, col) => { g.translate(x, 0, z); B.add(key, g, col); };
  const tim = [0.5, 0.42, 0.36];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) add('wood', beam(sx * 1.0, 0, sz * 1.0, sx * 0.2, H, sz * 0.2, 0.14), tim);
  for (let y = 1.2; y < H - 0.5; y += 1.6) {
    const a = 1.0 + (0.2 - 1.0) * (y / H);
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
      add('wood', beam(ax * a, y, az * a, bx * a, y, bz * a, 0.07), tim);
    }
  }
  add('wood', box(0.8, 0.1, 0.8, 0, H, 0, { m: 1 }), tim);
  // Rotor med blad och stjärt
  const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, H + 0.5, z);
  const rotor = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const g = box(0.24, 1.1, 0.02, 0, 0.95, 0, { m: 1 });
    g.rotateY(0.35);
    g.rotateZ(a);
    rotor.push(g);
  }
  const ring = new THREE.TorusGeometry(1.45, 0.03, 4, 32);
  const ring2 = new THREE.TorusGeometry(0.45, 0.03, 4, 24);
  const hub = new THREE.CylinderGeometry(0.16, 0.16, 0.3, 10);
  hub.rotateX(Math.PI / 2);
  const tail = box(0.03, 0.9, 1.5, 0, 0.1, -1.6, { m: 1 });
  const boom = beam(0, 0, 0, 0, 0, -1.0, 0.06);
  for (const g of [...rotor, ring, ring2, hub, tail, boom]) {
    g.translate(0, 0, 0.35);
    g.applyMatrix4(M);
    B.add('iron', g, [0.72, 0.68, 0.62]);
  }
  // Vattentrå vid foten
  const trough = box(2.4, 0.5, 0.8, 1.9, 0.25, 0.8, { m: 1, swap: true });
  trough.translate(x, 0, z);
  B.add('wood', trough, [0.5, 0.4, 0.32]);
}

/** Saguaro, fikonkaktus eller tunnkaktus. */
export function addCactus(B, world, RAPIER, { x, z, kind = 'saguaro', h = 3, seed = 1 }) {
  const r = rng(seed * 7 + 1);
  const rt = kind === 'saguaro' ? 0.2 + h * 0.03 : 0.3;
  if (world && kind === 'saguaro') {
    const body = fixedBody(world, RAPIER, x, 0, z);
    world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, rt).setTranslation(0, h / 2, 0).setCollisionGroups(groups(G.WORLD)), body);
  }
  if (!B) return;
  const col = [0.85 + r() * 0.2, 0.9 + r() * 0.15, 0.8 + r() * 0.15];
  const add = (g) => { g.translate(x, 0, z); B.add('cactus', g, col); };
  if (kind === 'saguaro') {
    const t = new THREE.CylinderGeometry(rt * 0.95, rt * 1.08, h, 14, 4);
    t.translate(0, h / 2, 0);
    add(t);
    const top = new THREE.SphereGeometry(rt * 0.95, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    top.translate(0, h, 0);
    add(top);
    const arms = 1 + Math.floor(r() * 3);
    for (let k = 0; k < arms; k++) {
      const a = r() * Math.PI * 2, y0 = h * (0.35 + r() * 0.3), out = 0.45 + r() * 0.3, up = h * (0.2 + r() * 0.25), ra = rt * 0.72;
      const dx = Math.cos(a), dz = Math.sin(a);
      const hz = new THREE.CylinderGeometry(ra, ra, out, 10);
      hz.rotateZ(Math.PI / 2); hz.rotateY(-a);
      hz.translate(dx * out / 2, y0, dz * out / 2);
      add(hz);
      const el = new THREE.SphereGeometry(ra, 10, 8);
      el.translate(dx * out, y0, dz * out);
      add(el);
      const v = new THREE.CylinderGeometry(ra, ra, up, 10);
      v.translate(dx * out, y0 + up / 2, dz * out);
      add(v);
      const tp = new THREE.SphereGeometry(ra, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      tp.translate(dx * out, y0 + up, dz * out);
      add(tp);
    }
  } else if (kind === 'pear') {
    const pads = 5 + Math.floor(r() * 6);
    const at = [[0, 0.3, 0]];
    for (let k = 0; k < pads; k++) {
      const [px, py, pz] = at[Math.floor(r() * at.length)];
      const a = r() * Math.PI * 2;
      const np = [px + Math.cos(a) * 0.25, py + 0.25 + r() * 0.15, pz + Math.sin(a) * 0.25];
      at.push(np);
      const g = new THREE.SphereGeometry(0.22, 10, 8);
      g.scale(1, 1.25, 0.32);
      g.rotateZ((r() - 0.5) * 0.8);
      g.rotateY(r() * Math.PI);
      g.translate(...np);
      add(g);
    }
  } else {
    const s = 0.3 + r() * 0.25;
    const g = new THREE.SphereGeometry(s, 14, 10);
    g.scale(1, 1.3, 1);
    g.translate(0, s * 1.1, 0);
    add(g);
  }
}

export function addRock(B, world, RAPIER, { x, z, size = 1, seed = 1 }) {
  const r = rng(seed * 5 + 9);
  const sy = size * (0.45 + r() * 0.4);
  if (world && size > 0.5) {
    const body = fixedBody(world, RAPIER, x, 0, z);
    boxCollider(world, RAPIER, body, size * 0.7, sy * 0.8, size * 0.7, 0, sy * 0.4, 0);
  }
  if (!B) return;
  const g = rockGeo(seed, 1, 0.35);
  g.scale(size, sy, size * (0.7 + r() * 0.5));
  g.rotateY(r() * 6.28);
  g.translate(x, sy * 0.35, z);
  strataColors(g, { scale: 0.3, shade: 0.9 + r() * 0.15, seed });
  B.add('rock', g, null);
}

export function addMesa(B, world, RAPIER, { x, z, rx, rz, h, seed = 1 }) {
  if (!B) return;
  const g = new THREE.CylinderGeometry(1, 1, 1, 44, 10);
  const n = sinNoise(seed);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    const a = Math.atan2(pz, px), rr = Math.hypot(px, pz), yn = py + 0.5;
    const wob = 1 + n(Math.cos(a) * 2, yn * 0.6, Math.sin(a) * 2) * 0.22;
    const flare = yn < 0.4 ? 1 + ((0.4 - yn) / 0.4) ** 1.5 * 0.9 : 1 - (yn - 0.4) * 0.12;
    const step = yn > 0.55 && yn < 0.7 ? 0.95 : 1;
    p.setXYZ(i, Math.cos(a) * rr * wob * flare * step * rx, yn * h * (rr < 0.99 && py > 0.4 ? 1 + n(px * 3, 1, pz * 3) * 0.02 : 1), Math.sin(a) * rr * wob * flare * step * rz);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (rx + rz) * 0.6, uv.getY(i) * h / 5);
  strataColors(g, { scale: h / 10, shade: 1.0, seed });
  g.translate(x, -0.5, z);
  B.add('mesa', g, null);
}

export function addScrub(B, { x, z, size = 0.4, seed = 1 }) {
  if (!B) return;
  const r = rng(seed * 3 + 2);
  const g = new THREE.IcosahedronGeometry(1, 1);
  g.scale(size, size * (0.55 + r() * 0.3), size);
  g.translate(x, size * 0.35, z);
  const k = 0.75 + r() * 0.3;
  B.add('twig', g, r() < 0.5 ? [k * 0.85, k * 0.8, k * 0.6] : [k * 0.7, k * 0.72, k * 0.55]);
}

export function addFence(B, world, RAPIER, { points, low = false }) {
  const H = low ? 0.8 : 1.2;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az), rot = Math.atan2(bx - ax, bz - az);
    if (world) {
      const body = fixedBody(world, RAPIER, (ax + bx) / 2, 0, (az + bz) / 2, rot);
      boxCollider(world, RAPIER, body, 0.06, H / 2, len / 2, 0, H / 2, 0);
    }
    if (!B) continue;
    const n = Math.max(1, Math.round(len / 2.2));
    const col = [0.58, 0.5, 0.42];
    for (let k = 0; k <= n; k++) {
      const t = k / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      B.add('wood', box(0.12, H + 0.1, 0.12, px, (H + 0.1) / 2, pz, { m: 1 }), mul(col, 0.9));
    }
    for (const y of low ? [H * 0.7] : [H * 0.45, H * 0.9]) B.add('wood', beam(ax, y, az, bx, y, bz, 0.06, 0.12), col);
  }
}

export function addGraveCross(B, { x, z, rot = 0 }) {
  if (!B) return;
  const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
  const col = [0.6, 0.54, 0.48];
  for (const g of [box(0.08, 0.95, 0.06, 0, 0.47, 0, { m: 1 }), box(0.5, 0.08, 0.06, 0, 0.7, 0, { m: 1 })]) { g.applyMatrix4(M); B.add('wood', g, col); }
  const mound = rockGeo(Math.floor(x * 10 + z), 1, 0.2);
  mound.scale(0.45, 0.14, 0.9);
  mound.translate(0, 0, -0.75);
  mound.applyMatrix4(M);
  B.add('rock', mound, [0.85, 0.66, 0.48]);
}

export function addWagon(B, world, RAPIER, { x, z, rot = 0, broken = false }) {
  if (world) {
    const body = fixedBody(world, RAPIER, x, 0, z, rot);
    boxCollider(world, RAPIER, body, 0.8, 0.6, 1.7, 0, 0.6, 0);
  }
  if (!B) return;
  const tilt = broken ? 0.22 : 0;
  const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z).multiply(new THREE.Matrix4().makeRotationZ(tilt));
  const add = (key, g, col) => { g.applyMatrix4(M); B.add(key, g, col); };
  const col = [0.6, 0.48, 0.38];
  add('wood', box(1.4, 0.12, 3.0, 0, 0.85, 0, { m: 1, swap: true }), col);
  for (const s of [-1, 1]) add('wood', box(0.06, 0.45, 3.0, s * 0.67, 1.12, 0, { m: 1, swap: true }), mul(col, 0.9));
  for (const s of [-1, 1]) add('wood', box(1.4, 0.45, 0.06, 0, 1.12, s * 1.47, { m: 1 }), mul(col, 0.9));
  add('wood', beam(0, 0.6, 1.5, 0, 0.35, 3.2, 0.08), col);
  // Hjul (det trasiga saknar ett framhjul som ligger på marken)
  for (const [sx, sz, R] of [[-1, -1, 0.6], [1, -1, 0.6], [-1, 1, 0.48], [1, 1, 0.48]]) {
    if (broken && sx === -1 && sz === 1) continue;
    for (const [key, g] of wheelGeos(R)) {
      g.rotateY(Math.PI / 2);
      g.translate(sx * 0.82, R, sz * 1.05);
      add(key, g, key === 'iron' ? [0.5, 0.48, 0.46] : col);
    }
  }
  if (broken) {
    for (const [key, g] of wheelGeos(0.48)) {
      g.rotateX(Math.PI / 2);
      g.translate(-1.6, 0.05, 1.6);
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z));
      B.add(key, g, key === 'iron' ? [0.5, 0.48, 0.46] : col);
    }
  } else {
    // Presenning över bågar
    for (const zz of [-1.2, 0, 1.2]) {
      const arc = new THREE.TorusGeometry(0.7, 0.025, 4, 12, Math.PI);
      arc.translate(0, 1.3, zz);
      add('wood', arc, col);
    }
  }
}

export function addSignpost(B, world, RAPIER, { x, z, rot = 0, text }) {
  if (world) {
    const body = fixedBody(world, RAPIER, x, 0, z, rot);
    for (const s of [-1, 1]) boxCollider(world, RAPIER, body, 0.08, 1.2, 0.08, s * 1.9, 1.2, 0);
  }
  if (!B) return;
  const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
  const add = (key, g, col) => { g.applyMatrix4(M); B.add(key, g, col); };
  for (const s of [-1, 1]) add('wood', box(0.16, 2.6, 0.16, s * 1.9, 1.3, 0, { m: 1 }), [0.5, 0.42, 0.34]);
  add('wood', box(4.1, 0.75, 0.08, 0, 1.95, 0), [0.55, 0.45, 0.36]);
  for (const s of [-1, 1]) {
    const g = atlasPlane(3.8, 0.6, signCell(text));
    if (s < 0) g.rotateY(Math.PI);
    g.translate(0, 1.95, s * 0.045);
    add('sign', g, [1, 1, 1]);
  }
}

// ===========================================================================
// Tumlegräs: lätta kvistbollar som bilarna kan putta runt
// ===========================================================================

export function addTumbleweed(scene, world, RAPIER, { x, z, r = 0.4, mass = 0.05, seed = 1 }) {
  const spawn = { x, y: r + 0.01, z };
  let body = null, mesh = null;
  if (world) {
    body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y, spawn.z).setLinearDamping(0.35).setAngularDamping(0.25));
    world.createCollider(RAPIER.ColliderDesc.ball(r * 0.9).setDensity(0).setMass(mass).setFriction(0.6).setRestitution(0.35).setCollisionGroups(groups(G.PROP)), body);
  }
  if (scene) {
    const outer = rockGeo(seed, 2, 0.12);
    outer.scale(r, r, r);
    const inner = new THREE.IcosahedronGeometry(r * 0.62, 1);
    inner.rotateY(seed);
    const geos = [outer, inner].map((g) => {
      const gg = g.index ? g.toNonIndexed() : g;
      const n = gg.attributes.position.count;
      const col = new Float32Array(n * 3).fill(0.95);
      gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return gg;
    });
    mesh = new THREE.Mesh(mergeGeometries(geos), MATERIALS.twig());
    mesh.position.set(spawn.x, spawn.y, spawn.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return { body, mesh, kind: 'ball', spawn };
}

// ===========================================================================
// Ladan som genvägen kör rakt igenom, diligensen, vattentråget, höbalar och
// gärdesgårdar längs banans kant
// ===========================================================================

/**
 * Lada med öppna portar i båda gavlarna; vägen går längs lokal +z genom den.
 * clear: halva fria bredden mellan väggarna.
 */
export function addBarnPassage(B, world, RAPIER, { x, z, heading, length = 4.6, clear = 2.1, h = 3.0, tint = [0.62, 0.34, 0.26], seed = 1 }) {
  const L = length, rise = clear * 0.75, W = clear + 0.12;
  if (world) {
    const body = fixedBody(world, RAPIER, x, 0, z, heading);
    for (const s of [-1, 1]) boxCollider(world, RAPIER, body, 0.12, h / 2, L / 2, s * W, h / 2, 0);
    boxCollider(world, RAPIER, body, W + 0.1, 0.1, L / 2, 0, h + 0.1, 0); // loftgolv/tak för kameran
  }
  if (!B) return;
  const M = new THREE.Matrix4().makeRotationY(heading).setPosition(x, 0, z);
  const add = (key, geo, col) => { geo.applyMatrix4(M); B.add(key, geo, col); };
  const r = rng(seed * 19 + 5);
  const trim = mul(tint, 0.55), white = [0.86, 0.82, 0.74];
  // Långväggar, sadeltak och nock
  for (const s of [-1, 1]) add('wood', box(0.2, h, L, s * W, h / 2, 0, { m: 2 }), mul(tint, 0.92 + r() * 0.12));
  const sl = Math.hypot(W + 0.45, rise);
  for (const s of [-1, 1]) {
    const g = box(sl, 0.09, L + 0.7, 0, 0, 0, { m: 1.6, swap: true });
    g.rotateZ(-s * Math.atan2(rise, W + 0.45));
    g.translate(s * (W + 0.45) / 2, h + rise / 2 + 0.02, 0);
    add('roof', g, [0.78, 0.74, 0.7]);
  }
  add('wood', box(0.14, 0.14, L + 0.7, 0, h + rise + 0.05, 0, { m: 1, swap: true }), trim);
  // Gavlar: portöppning med vita ramar, triangel ovanför med höluckan
  const doorH = 2.55;
  for (const e of [-1, 1]) {
    const zz = e * L / 2;
    for (const s of [-1, 1]) add('wood', box(0.22, h, 0.22, s * (W - 0.02), h / 2, zz, { m: 1 }), white);
    add('wood', box(W * 2 + 0.2, h - doorH, 0.16, 0, doorH + (h - doorH) / 2, zz, { m: 2 }), tint);
    add('wood', box(W * 2, 0.18, 0.22, 0, doorH, zz, { m: 1, swap: true }), white);
    const tri = new THREE.Shape([new THREE.Vector2(-W - 0.1, 0), new THREE.Vector2(W + 0.1, 0), new THREE.Vector2(0, rise)]);
    const g = new THREE.ExtrudeGeometry(tri, { depth: 0.14, bevelEnabled: false });
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
    g.translate(0, h, zz - 0.07);
    add('wood', g, tint);
    const loft = atlasPlane(0.9, 0.8, openCell(OPEN.barn));
    if (e < 0) loft.rotateY(Math.PI);
    loft.translate(0, h + 0.45, zz + e * 0.09);
    add('open', loft, [1, 1, 1]);
    // Portblad uppslagna mot väggarna, med vitt kryss
    for (const s of [-1, 1]) {
      const dw = W * 0.95;
      const leaf = box(0.08, doorH - 0.1, dw, 0, (doorH - 0.1) / 2, 0, { m: 2 });
      leaf.translate(s * (W + 0.18), 0, zz + e * dw / 2);
      add('wood', leaf, mul(tint, 1.05));
      const px = s * (W + 0.24), z0 = zz + e * 0.1, z1 = zz + e * (dw - 0.1);
      add('wood', beam(px, 0.2, z0, px, doorH - 0.3, z1, 0.05, 0.1), white);
      add('wood', beam(px, doorH - 0.3, z0, px, 0.2, z1, 0.05, 0.1), white);
    }
  }
  // Höbalar längs väggarna inne i ladan och mörker under taket
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    if (r() < 0.3) continue;
    const g = box(0.42, 0.4, 0.95, s * (W - 0.33), 0.2, (k - 1) * 1.3, { m: 0.8 });
    add('hay', g, [0.95, 0.9, 0.85]);
  }
  const shade = new THREE.PlaneGeometry(W * 2, L + 1.6);
  shade.rotateX(-Math.PI / 2);
  shade.translate(0, 0.03, 0);
  add('shade', shade, [1, 1, 1]);
}

/** Diligens utan hästar: vagnskorg på stora hjul, kuskbock och bagagehylla. */
export function addStagecoach(B, world, RAPIER, { x, z, rot = 0 }) {
  if (world) {
    const body = fixedBody(world, RAPIER, x, 0, z, rot);
    boxCollider(world, RAPIER, body, 0.85, 1.0, 1.55, 0, 1.0, 0);
  }
  if (!B) return;
  const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
  const add = (key, g, col) => { g.applyMatrix4(M); B.add(key, g, col); };
  const red = [0.62, 0.2, 0.15], yel = [0.85, 0.66, 0.3], dark = [0.25, 0.2, 0.17];
  // Korgen med rundad underdel, fönster och dörr
  add('wood', box(1.36, 1.15, 2.0, 0, 1.45, 0, { m: 1 }), red);
  const belly = new THREE.CylinderGeometry(0.68, 0.68, 2.0, 16, 1, false, Math.PI / 2, Math.PI);
  belly.rotateX(Math.PI / 2); belly.scale(1, 0.45, 1); belly.translate(0, 0.9, 0);
  add('wood', belly, mul(red, 0.85));
  add('wood', box(1.5, 0.1, 2.2, 0, 2.08, 0, { m: 1, swap: true }), dark);
  for (const s of [-1, 1]) {
    for (const zz of [-0.55, 0.55]) {
      const win = atlasPlane(0.48, 0.45, openCell(OPEN.window));
      win.rotateY(s * Math.PI / 2);
      win.translate(s * 0.69, 1.65, zz);
      add('open', win, [0.8, 0.8, 0.8]);
    }
    add('wood', box(0.04, 0.06, 2.02, s * 0.69, 1.2, 0, { m: 1, swap: true }), yel);
  }
  // Bagagehylla med kistor på taket, kuskbock fram, bagagelucka bak
  for (const s of [-1, 1]) add('wood', box(0.04, 0.16, 2.0, s * 0.68, 2.2, 0, { m: 1, swap: true }), dark);
  add('crate', box(0.6, 0.36, 0.5, -0.25, 2.31, -0.4, { m: 0.6 }), [0.9, 0.85, 0.8]);
  add('crate', box(0.5, 0.3, 0.45, 0.3, 2.28, 0.3, { m: 0.5 }), [0.8, 0.75, 0.72]);
  add('wood', box(1.3, 0.12, 0.6, 0, 2.15, 1.32, { m: 1 }), dark);
  add('wood', box(1.3, 0.5, 0.1, 0, 2.38, 1.05, { m: 1 }), red);
  add('wood', box(1.3, 0.08, 0.7, 0, 1.55, 1.38, { m: 1 }), dark);
  add('wood', box(1.2, 0.8, 0.5, 0, 1.25, -1.28, { m: 1 }), mul(red, 0.8));
  // Hjul och axlar, draget framåt
  for (const [zz, R] of [[-0.95, 0.66], [0.95, 0.52]]) {
    for (const s of [-1, 1]) for (const [key, g] of wheelGeos(R)) {
      g.rotateY(Math.PI / 2);
      g.translate(s * 0.86, R, zz);
      add(key, g, key === 'iron' ? [0.5, 0.48, 0.46] : yel);
    }
    add('iron', box(1.8, 0.08, 0.08, 0, zz < 0 ? 0.66 : 0.52, zz, { m: 1 }), [0.4, 0.38, 0.36]);
  }
  add('wood', beam(0, 0.5, 1.1, 0, 0.12, 3.1, 0.08), dark);
  add('wood', box(1.0, 0.06, 0.06, 0, 0.14, 3.0, { m: 1 }), dark);
}

/** Vattentråg av plankor med en handpump. */
export function addTrough(B, world, RAPIER, { x, z, rot = 0, len = 1.8 }) {
  if (world) {
    const body = fixedBody(world, RAPIER, x, 0, z, rot);
    boxCollider(world, RAPIER, body, 0.3, 0.28, len / 2, 0, 0.28, 0);
  }
  if (!B) return;
  const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
  const add = (key, g, col) => { g.applyMatrix4(M); B.add(key, g, col); };
  const col = [0.5, 0.4, 0.32];
  for (const s of [-1, 1]) add('wood', box(0.06, 0.5, len, s * 0.27, 0.3, 0, { m: 1, swap: true }), col);
  for (const s of [-1, 1]) add('wood', box(0.6, 0.5, 0.06, 0, 0.3, s * (len / 2 - 0.03), { m: 1 }), col);
  add('wood', box(0.5, 0.06, len - 0.1, 0, 0.08, 0, { m: 1 }), mul(col, 0.8));
  for (const s of [-1, 1]) add('wood', box(0.7, 0.1, 0.12, 0, 0.05, s * (len / 2 - 0.25), { m: 1 }), mul(col, 0.8));
  const w = new THREE.PlaneGeometry(0.48, len - 0.12);
  w.rotateX(-Math.PI / 2);
  w.translate(0, 0.46, 0);
  add('water', w, [1, 1, 1]);
  // Handpump vid ena änden
  add('iron', box(0.12, 1.0, 0.12, 0, 0.5, len / 2 + 0.2, { m: 1 }), [0.32, 0.36, 0.34]);
  add('iron', beam(0, 0.92, len / 2 + 0.2, 0, 0.75, len / 2 - 0.15, 0.05), [0.32, 0.36, 0.34]);
  add('iron', beam(0, 1.0, len / 2 + 0.2, 0.0, 1.25, len / 2 + 0.6, 0.035), [0.32, 0.36, 0.34]);
}

/** Höbal (eller en trave) med snören. */
export function addHayBale(B, world, RAPIER, { x, z, rot = 0, stack = 1, collide = true }) {
  const w = 0.95, hh = 0.42, d = 0.48;
  if (world && collide) {
    const body = fixedBody(world, RAPIER, x, 0, z, rot);
    boxCollider(world, RAPIER, body, w / 2, (hh * stack) / 2, d / 2, 0, (hh * stack) / 2, 0);
  }
  if (!B) return;
  const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
  for (let k = 0; k < stack; k++) {
    const t = k % 2 ? 0.08 : -0.04;
    const parts = [[box(w, hh, d, 0, hh / 2 + k * hh, 0, { m: 0.8 }), 'hay', [0.98 - k * 0.05, 0.93, 0.85]]];
    for (const u of [-0.25, 0.25]) parts.push([box(0.03, hh + 0.01, d + 0.01, u, hh / 2 + k * hh, 0, { m: 1 }), 'wood', [0.45, 0.35, 0.25]]);
    for (const [g, key, col] of parts) { g.rotateY(t); g.applyMatrix4(M); B.add(key, g, col); }
  }
}

/** Gärdesgård längs kantsegment (från edgeSegments), lite ojämn som en gammal hage. */
export function addRailFence(B, segs, { h = 0.9, seed = 3 } = {}) {
  if (!B) return;
  const r = rng(seed);
  const col = [0.6, 0.5, 0.4];
  for (const s of segs) {
    const lean = (r() - 0.5) * 0.06;
    B.add('wood', box(0.13, h, 0.13, 0, h / 2, 0, { m: 1 }).rotateZ(lean).translate(s.ax, s.ay, s.az), mul(col, 0.85 + r() * 0.15));
    for (const y of [h * 0.38, h * 0.82]) {
      B.add('wood', beam(s.ax, s.ay + y + (r() - 0.5) * 0.04, s.az, s.bx, s.by + y + (r() - 0.5) * 0.04, s.bz, 0.07, 0.11), mul(col, 0.9 + r() * 0.15));
    }
  }
}
