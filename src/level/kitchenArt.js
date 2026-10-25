import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G, groups } from '../core/physics.js';
import { rng } from './warehouseArt.js';

// ---------------------------------------------------------------------------
// Procedurell grafik för köket: kakel- och parkettgolv, bänkskåp med lådor,
// diskho, spis med fläkt, kyl, köksö och frukostbar med barstolar, matbord
// med stolar på en vävd matta, soffhörna, fönster mot trädgården och en
// massa saker på golvet. Allt i riktig skala (meter) och ritat i canvas.
//
// Allt går genom en kontext (kctx). Utan scene byggs bara fysiken, utan
// world bara grafiken. Statisk grafik samlas per material och slås ihop.
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

const yQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const _c = new THREE.Color();
const rgb = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };

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

// ===========================================================================
// Kontext, batch och kolliderare
// ===========================================================================

function kctx(scene, world, RAPIER) {
  return {
    scene, world, RAPIER,
    B: scene ? new Batch() : null,
    body: world ? world.createRigidBody(RAPIER.RigidBodyDesc.fixed()) : null,
  };
}

function solid(C, hx, hy, hz, x, y, z, rotY = 0, friction = 0.6) {
  if (!C.world) return null;
  return C.world.createCollider(
    C.RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(yQuat(rotY))
      .setFriction(friction).setRestitution(0.15).setCollisionGroups(groups(G.WORLD)),
    C.body
  );
}

class Batch {
  constructor() { this.lists = new Map(); }

  add(key, geo, col = [1, 1, 1]) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col[0]; arr[i * 3 + 1] = col[1]; arr[i * 3 + 2] = col[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.clearGroups();
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(g);
  }

  flush(scene) {
    for (const [key, list] of this.lists) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list), MATERIALS[key]());
      mesh.castShadow = !NO_SHADOW.has(key);
      mesh.receiveShadow = !['lit', 'view', 'glass'].includes(key);
      if (key === 'glass' || key === 'water' || key === 'sunpatch') mesh.renderOrder = 2;
      scene.add(mesh);
    }
    this.lists.clear();
  }
}
const NO_SHADOW = new Set(['lit', 'view', 'glass', 'wall', 'ceiling', 'tile', 'water', 'sunpatch', 'overlay', 'floorDecal']);

// ===========================================================================
// Geometrihjälp
// ===========================================================================

// Låda med UV i meter (m = meter per texturvarv)
function box(w, h, d, x = 0, y = 0, z = 0, m = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * faces[f][0] / m, uv.getY(k) * faces[f][1] / m);
  }
  g.translate(x, y, z);
  return g;
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vs = new THREE.Vector3(1, 1, 1);

function place(geo, x, y, z, rotY = 0) {
  geo.applyMatrix4(_m4.makeRotationY(rotY).setPosition(x, y, z));
  return geo;
}

// Rund stång mellan två punkter
function rod(ax, ay, az, bx, by, bz, r = 0.01, seg = 6) {
  _va.set(ax, ay, az); _vb.set(bx, by, bz);
  const len = _va.distanceTo(_vb);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  _vb.sub(_va).normalize();
  _q.setFromUnitVectors(_up, _vb);
  _va.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  g.applyMatrix4(_m4.compose(_va, _q, _vs));
  return g;
}

function cyl(rt, rb, h, x, y, z, seg = 16) {
  return new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z);
}

function lathe(profile, x, y, z, seg = 20) {
  return new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg).translate(x, y, z);
}

function atlasPlane(w, h, cell) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const [u0, v0, u1, v1] = cell;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

// Vänd trianglarna (icke-indexerad geometri) så att normalen pekar åt dir
function orient(g, dir) {
  g.computeVertexNormals();
  const n = g.attributes.normal;
  if (n.getX(0) * dir[0] + n.getY(0) * dir[1] + n.getZ(0) * dir[2] >= 0) return g;
  const p = g.attributes.position.array, u = g.attributes.uv?.array;
  for (let t = 0; t < p.length / 9; t++) {
    for (let k = 0; k < 3; k++) { const a = t * 9 + 3 + k, b = t * 9 + 6 + k; [p[a], p[b]] = [p[b], p[a]]; }
    if (u) for (let k = 0; k < 2; k++) { const a = t * 6 + 2 + k, b = t * 6 + 4 + k; [u[a], u[b]] = [u[b], u[a]]; }
  }
  g.computeVertexNormals();
  return g;
}

// Lokal ram för en möbel: (lx, lz) i möbelns ram, framsidan mot +z.
function frame(C, x, z, rotY = 0, y0 = 0) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  return {
    at,
    add(key, geo, col) { if (C.B) C.B.add(key, place(geo, x, y0, z, rotY), col); },
    box(key, w, h, d, lx, ly, lz, col, m = 1) { if (C.B) this.add(key, box(w, h, d, lx, ly, lz, m), col); },
    solid(hx, hy, hz, lx, ly, lz, rot = 0, fr = 0.6) {
      const [wx, wz] = at(lx, lz);
      return solid(C, hx, hy, hz, wx, y0 + ly, wz, rotY + rot, fr);
    },
    // Synlig låda som också är fast
    both(key, w, h, d, lx, ly, lz, col, m = 1) {
      this.box(key, w, h, d, lx, ly, lz, col, m);
      this.solid(w / 2, h / 2, d / 2, lx, ly, lz);
    },
  };
}

// ===========================================================================
// Texturer
// ===========================================================================

// Ek: ljust trä med ådring (tonas med vertexfärg)
function woodTexture() {
  return cached('woodTex', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    const r = rng(11);
    ctx.fillStyle = '#e9d2ad';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 140; i++) {
      const y = r() * S, a = 0.05 + r() * 0.12;
      ctx.strokeStyle = r() < 0.5 ? `rgba(150,105,60,${a})` : `rgba(255,240,215,${a})`;
      ctx.lineWidth = 0.6 + r() * 2.4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= S; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.012 + i) * 3 + (r() - 0.5) * 1.5);
      ctx.stroke();
    }
    for (let i = 0; i < 10; i++) {
      const x = r() * S, y = r() * S;
      ctx.strokeStyle = 'rgba(120,80,40,0.18)';
      ctx.lineWidth = 1;
      for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.ellipse(x, y, k * 6, k * 2, 0, 0, Math.PI * 2); ctx.stroke(); }
    }
    return toTex(c);
  });
}

// Köksgolvet: stora klinkers 60 cm, ljusgrå och vita i schack (1,2 m per varv)
const TILE_REPEAT = 1.2;
function tileFloorTexture() {
  return cached('tileFloor', () => {
    const S = 1024, T = S / 2;
    const [c, ctx] = canvas(S);
    const r = rng(21);
    ctx.fillStyle = '#b9b5ad';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const light = (i + j) % 2 === 0;
      ctx.fillStyle = light ? '#f1efea' : '#cfcdc8';
      ctx.fillRect(i * T + 3, j * T + 3, T - 6, T - 6);
      // Lite marmorering
      for (let k = 0; k < 26; k++) {
        ctx.strokeStyle = light ? `rgba(150,150,145,${0.04 + r() * 0.07})` : `rgba(255,255,255,${0.05 + r() * 0.08})`;
        ctx.lineWidth = 0.6 + r() * 2;
        ctx.beginPath();
        let x = i * T + r() * T, y = j * T + r() * T;
        ctx.moveTo(x, y);
        for (let s = 0; s < 6; s++) { x += (r() - 0.3) * 60; y += (r() - 0.5) * 40; ctx.lineTo(Math.max(i * T + 4, Math.min(i * T + T - 4, x)), Math.max(j * T + 4, Math.min(j * T + T - 4, y))); }
        ctx.stroke();
      }
    }
    return toTex(c);
  });
}

// Matsalen: ekparkett, stavar 15 x 120 cm i förband (1,2 m per varv)
const PARQUET_REPEAT = 1.2;
function parquetTexture() {
  return cached('parquet', () => {
    const S = 1024, rows = 8, H = S / rows;
    const [c, ctx] = canvas(S);
    const r = rng(31);
    for (let j = 0; j < rows; j++) {
      const off = [0, 0.5, 0.25, 0.75, 0.125, 0.625, 0.375, 0.875][j] * S;
      for (let k = -1; k < 2; k++) {
        const x0 = off + k * S * 0.5;
        const tone = 205 + r() * 30;
        ctx.fillStyle = `rgb(${tone},${tone * 0.8},${tone * 0.58})`;
        ctx.fillRect(x0, j * H, S * 0.5, H);
        ctx.fillRect(x0 - S, j * H, S * 0.5, H);
        for (let g = 0; g < 9; g++) {
          const y = j * H + 4 + r() * (H - 8);
          ctx.strokeStyle = `rgba(140,95,50,${0.08 + r() * 0.12})`;
          ctx.lineWidth = 0.6 + r() * 1.6;
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.bezierCurveTo(x0 + S * 0.15, y + (r() - 0.5) * 6, x0 + S * 0.3, y + (r() - 0.5) * 6, x0 + S * 0.5, y + (r() - 0.5) * 4);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(90,60,30,0.55)';
        ctx.fillRect(x0, j * H, 2, H);
        ctx.fillRect(x0 - S, j * H, 2, H);
      }
      ctx.fillStyle = 'rgba(90,60,30,0.45)';
      ctx.fillRect(0, j * H, S, 2);
    }
    return toTex(c);
  });
}

// Vit kakel på väggen ovanför bänken: 15 x 7,5 cm i förband (0,6 m per varv)
function subwayTexture() {
  return cached('subway', () => {
    const S = 512, w = S / 4, h = S / 8;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#c9c6bf';
    ctx.fillRect(0, 0, S, S);
    const r = rng(41);
    for (let j = 0; j < 8; j++) for (let i = -1; i < 4; i++) {
      const x = i * w + (j % 2 ? w / 2 : 0);
      const b = 238 + r() * 10;
      const g = ctx.createLinearGradient(0, j * h, 0, j * h + h);
      g.addColorStop(0, `rgb(${b + 6},${b + 6},${b + 4})`);
      g.addColorStop(1, `rgb(${b - 8},${b - 8},${b - 10})`);
      ctx.fillStyle = g;
      ctx.fillRect(x + 3, j * h + 3, w - 6, h - 6);
    }
    return toTex(c);
  });
}

// Väggfärg: varmvit med svag struktur
function wallTexture() {
  return cached('wallTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    const r = rng(51);
    const img = ctx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const n = (r() - 0.5) * 7;
      img.data[i * 4] = 241 + n; img.data[i * 4 + 1] = 235 + n; img.data[i * 4 + 2] = 224 + n; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTex(c);
  });
}

// Vävd matta (kelim) med bård, romber och frans
function rugTexture() {
  return cached('rugTex', () => {
    const W = 1024, H = 768;
    const [c, ctx] = canvas(W, H);
    const r = rng(61);
    const terra = '#b4553a', indigo = '#2d3b5c', cream = '#efe3c8', ochre = '#d39b3f', rose = '#c98f86';
    ctx.fillStyle = cream; ctx.fillRect(0, 0, W, H);
    // Frans i kortändarna
    ctx.fillStyle = '#e8dcc0';
    for (let y = 0; y < H; y += 6) { ctx.fillRect(0, y, 18, 3); ctx.fillRect(W - 18, y, 18, 3); }
    const m = 22;
    ctx.fillStyle = indigo; ctx.fillRect(m, 0, W - m * 2, H);
    ctx.fillStyle = terra; ctx.fillRect(m + 30, 30, W - m * 2 - 60, H - 60);
    ctx.fillStyle = cream; ctx.fillRect(m + 46, 46, W - m * 2 - 92, H - 92);
    ctx.fillStyle = terra; ctx.fillRect(m + 60, 60, W - m * 2 - 120, H - 120);
    // Tandad bård
    ctx.fillStyle = ochre;
    for (let x = m + 46; x < W - m - 46; x += 24) {
      for (const y of [46, H - 60]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 12, y + 14); ctx.lineTo(x + 24, y); ctx.fill(); }
    }
    // Romber i mittfältet
    const cols = [indigo, cream, ochre, rose];
    const cx0 = m + 60, cy0 = 60, cw = W - m * 2 - 120, ch = H - 120;
    const nx = 5, ny = 3;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = cx0 + (i + 0.5) * cw / nx, y = cy0 + (j + 0.5) * ch / ny;
      for (let k = 3; k >= 0; k--) {
        const s = (k + 1) * 0.24;
        ctx.fillStyle = cols[(k + i + j) % 4];
        ctx.beginPath();
        ctx.moveTo(x, y - (ch / ny / 2 - 8) * s); ctx.lineTo(x + (cw / nx / 2 - 8) * s, y);
        ctx.lineTo(x, y + (ch / ny / 2 - 8) * s); ctx.lineTo(x - (cw / nx / 2 - 8) * s, y);
        ctx.closePath(); ctx.fill();
      }
    }
    // Vävstruktur
    const img = ctx.getImageData(0, 0, W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const n = ((x + y) % 4 < 2 ? 8 : -8) + (r() - 0.5) * 14;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    return toTex(c, { repeat: false });
  });
}

// ---------------------------------------------------------------------------
// Dekalatlas: utsikt, bokryggar, flingpaket, teckningar, tavlor, klockor m.m.
// ---------------------------------------------------------------------------
const AS = 2048;
const CELLS = {
  view: [0, 0, 1024, 512],
  bookstack: [1024, 0, 1024, 512],
  cereal: [0, 512, 256, 384],
  drawing: [256, 512, 256, 256],
  clock: [512, 512, 256, 96],
  art1: [768, 512, 256, 320],
  art2: [1024, 512, 256, 320],
  art3: [1280, 512, 256, 320],
  wallclock: [1536, 512, 256, 256],
  calendar: [1792, 512, 256, 320],
  board: [0, 1024, 512, 512],
  bag: [512, 1024, 256, 320],
  tv: [768, 1024, 512, 288],
  cooktop: [1280, 1024, 512, 320],
  spines: [0, 1536, 1024, 256],
  oven: [1024, 1536, 512, 320],
  magazine: [1536, 1536, 256, 320],
};
function cellUV(key) {
  const [x, y, w, h] = CELLS[key];
  return [x / AS, 1 - (y + h) / AS, (x + w) / AS, 1 - y / AS];
}

function atlas() {
  return cached('atlas', () => {
    const [c, ctx] = canvas(AS);
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, AS, AS);
    const r = rng(71);
    const at = (key, draw) => {
      const [x, y, w, h] = CELLS[key];
      ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      draw(w, h); ctx.restore();
    };
    // Utsikt: sommarhimmel, träd och häck i en trädgård
    at('view', (w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#7fb6ea'); g.addColorStop(0.55, '#cfe6f6'); g.addColorStop(0.56, '#9cc489'); g.addColorStop(1, '#5f9a4c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        const x = r() * w, y = 30 + r() * 120;
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(x + k * 26, y + (k % 2) * 8, 34, 16, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      for (let i = 0; i < 14; i++) {
        const x = r() * w, y = h * 0.56, s = 50 + r() * 80;
        ctx.fillStyle = '#6b4a2e'; ctx.fillRect(x - 5, y - s * 0.6, 10, s * 0.6);
        ctx.fillStyle = ['#3f7a35', '#4f8c3c', '#356b2d'][i % 3];
        ctx.beginPath(); ctx.ellipse(x, y - s * 0.8, s * 0.55, s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#3e6f34'; ctx.fillRect(0, h * 0.62, w, 26);
      ctx.fillStyle = '#cf6a75';
      for (let i = 0; i < 60; i++) { ctx.beginPath(); ctx.arc(r() * w, h * 0.72 + r() * h * 0.25, 3 + r() * 4, 0, Math.PI * 2); ctx.fill(); }
    });
    // Bokstapel från sidan: liggande böcker i olika färger med sidkanter
    at('bookstack', (w, h) => {
      ctx.fillStyle = '#f2ead8'; ctx.fillRect(0, 0, w, h);
      const cols = ['#b23a2e', '#2f5d8a', '#e0b23c', '#3e7d4f', '#7a3f6e', '#d9683a', '#1f2f45', '#8a8f2e', '#c94f6d', '#5a7fa8'];
      let y = 0, k = 0;
      while (y < h) {
        const bh = 18 + r() * 22;
        const col = cols[k++ % cols.length];
        ctx.fillStyle = col; ctx.fillRect(0, y, w, bh);
        ctx.fillStyle = '#f4ecd9'; ctx.fillRect(0, y + 4, w, bh - 8);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        for (let s = y + 6; s < y + bh - 6; s += 3) ctx.fillRect(0, s, w, 1);
        ctx.fillStyle = col; ctx.fillRect(0, y, w, 4); ctx.fillRect(0, y + bh - 4, w, 4);
        y += bh;
      }
    });
    // Flingpaket
    at('cereal', (w, h) => {
      ctx.fillStyle = '#f2b51d'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#d2421f'; ctx.fillRect(0, 0, w, 90);
      ctx.fillStyle = '#fff'; ctx.font = '900 46px Arial Black, Arial'; ctx.textAlign = 'center';
      ctx.fillText('KNAPRA', w / 2, 62);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(w / 2, 230, 92, 70, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d9a14a';
      for (let i = 0; i < 26; i++) { ctx.beginPath(); ctx.arc(w / 2 + (r() - 0.5) * 140, 230 + (r() - 0.5) * 90, 8 + r() * 5, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#2b5fa8'; ctx.font = 'bold 26px Arial'; ctx.fillText('HAVRE & HONUNG', w / 2, 350);
    });
    // Barnteckning med kylskåpsmagneter
    at('drawing', (w, h) => {
      ctx.fillStyle = '#fbfaf5'; ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.strokeStyle = '#2b8be0'; ctx.beginPath(); ctx.moveTo(10, 210); ctx.lineTo(246, 210); ctx.stroke();
      ctx.strokeStyle = '#e04a2b'; ctx.strokeRect(70, 120, 110, 80);
      ctx.beginPath(); ctx.moveTo(60, 125); ctx.lineTo(125, 70); ctx.lineTo(190, 125); ctx.stroke();
      ctx.fillStyle = '#ffcf21'; ctx.beginPath(); ctx.arc(215, 45, 26, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#27a043'; ctx.beginPath(); ctx.moveTo(30, 210); ctx.lineTo(30, 160); ctx.stroke();
      ctx.fillStyle = '#27a043'; ctx.beginPath(); ctx.arc(30, 150, 18, 0, Math.PI * 2); ctx.fill();
      for (const [x, y, col] of [[20, 14, '#e8392f'], [236, 14, '#2f7be8'], [128, 240, '#f2c21b']]) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
      }
    });
    // Ugnens klocka
    at('clock', (w, h) => {
      ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#3cf0ff'; ctx.font = 'bold 66px Courier New, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('10:24', w / 2, h / 2 + 2);
    });
    // Tavlor
    at('art1', (w, h) => {
      ctx.fillStyle = '#f3ede2'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#d9643e'; ctx.beginPath(); ctx.arc(w * 0.4, h * 0.42, 70, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2d4a6b'; ctx.fillRect(w * 0.45, h * 0.5, 90, 110);
      ctx.fillStyle = '#e8b64a'; ctx.fillRect(40, h * 0.75, 120, 22);
    });
    at('art2', (w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f4d6b0'); g.addColorStop(1, '#8fb4c9');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#4f6f8a';
      ctx.beginPath(); ctx.moveTo(0, h * 0.7); ctx.lineTo(w * 0.3, h * 0.45); ctx.lineTo(w * 0.55, h * 0.62); ctx.lineTo(w * 0.8, h * 0.4); ctx.lineTo(w, h * 0.6); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
      ctx.fillStyle = '#fbe9c8'; ctx.beginPath(); ctx.arc(w * 0.7, h * 0.22, 26, 0, Math.PI * 2); ctx.fill();
    });
    at('art3', (w, h) => {
      ctx.fillStyle = '#efe9dd'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#3d6b47'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(w / 2, h - 30); ctx.quadraticCurveTo(w / 2 - 20, h / 2, w / 2 + 10, 40); ctx.stroke();
      ctx.fillStyle = '#5f9a5c';
      for (let i = 0; i < 9; i++) {
        const y = 60 + i * 26, s = i % 2 ? 1 : -1;
        ctx.beginPath(); ctx.ellipse(w / 2 + s * 30, y, 30, 12, s * 0.5, 0, Math.PI * 2); ctx.fill();
      }
    });
    // Väggklocka
    at('wallclock', (w, h) => {
      ctx.fillStyle = '#fafafa'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#222'; ctx.lineWidth = 8; ctx.stroke();
      ctx.fillStyle = '#222';
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ctx.fillRect(w / 2 + Math.cos(a) * 100 - 4, h / 2 + Math.sin(a) * 100 - 4, 8, 8); }
      ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(w / 2, h / 2); ctx.lineTo(w / 2 + 50, h / 2 - 20); ctx.stroke();
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(w / 2, h / 2); ctx.lineTo(w / 2 - 10, h / 2 - 85); ctx.stroke();
    });
    // Almanacka
    at('calendar', (w, h) => {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#7fae8c'; ctx.fillRect(0, 0, w, 120);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.fillText('OKTOBER', w / 2, 75);
      ctx.fillStyle = '#555';
      for (let i = 0; i < 31; i++) { ctx.fillRect(16 + (i % 7) * 33, 140 + Math.floor(i / 7) * 34, 24, 24); }
      ctx.strokeStyle = '#e03a3a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(16 + 4 * 33 + 12, 140 + 1 * 34 + 12, 18, 0, Math.PI * 2); ctx.stroke();
    });
    // Skärbräda (ändträ-ljus ek med saftränna)
    at('board', (w, h) => {
      ctx.fillStyle = '#dcb47c'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(180,130,70,0.35)' : 'rgba(240,210,160,0.3)';
        ctx.fillRect(0, i * (h / 16), w, h / 16);
      }
      for (let i = 0; i < 120; i++) {
        ctx.strokeStyle = `rgba(130,85,40,${0.05 + r() * 0.1})`; ctx.lineWidth = 1;
        const y = r() * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + (r() - 0.5) * 6); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(110,70,30,0.6)'; ctx.lineWidth = 7;
      ctx.strokeRect(22, 22, w - 44, h - 44);
      ctx.fillStyle = 'rgba(200,60,40,0.18)';
      ctx.beginPath(); ctx.ellipse(w * 0.6, h * 0.4, 50, 26, 0.4, 0, Math.PI * 2); ctx.fill();
    });
    // Papperskasse
    at('bag', (w, h) => {
      ctx.fillStyle = '#c49a64'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(90,60,30,${r() * 0.12})`; ctx.fillRect(r() * w, r() * h, 2, 2); }
      ctx.fillStyle = '#2f6b3f'; ctx.beginPath(); ctx.arc(w / 2, h * 0.5, 54, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f3ead4'; ctx.font = 'bold 30px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TORGET', w / 2, h * 0.5);
    });
    // Tv (avstängd, med reflex)
    at('tv', (w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#20242a'); g.addColorStop(0.45, '#0c0e11'); g.addColorStop(0.5, '#262b32'); g.addColorStop(1, '#08090b');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    // Häll: svart glas med fyra plattor
    at('cooktop', (w, h) => {
      ctx.fillStyle = '#0d0d0f'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#4b4b52'; ctx.lineWidth = 4;
      for (const [x, y, rr] of [[0.27, 0.3, 70], [0.73, 0.3, 54], [0.27, 0.72, 54], [0.73, 0.72, 70]]) {
        ctx.beginPath(); ctx.arc(x * w, y * h, rr, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x * w, y * h, rr - 12, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#ff5a2a'; ctx.fillRect(w * 0.45, h * 0.9, 50, 6);
    });
    // Bokryggar i bokhyllan (stående böcker)
    at('spines', (w, h) => {
      ctx.fillStyle = '#3b2b1f'; ctx.fillRect(0, 0, w, h);
      const cols = ['#b23a2e', '#2f5d8a', '#e0b23c', '#3e7d4f', '#7a3f6e', '#d9683a', '#1f2f45', '#efe6d2', '#c94f6d', '#5a7fa8', '#8a8f2e'];
      let x = 0;
      while (x < w) {
        const bw = 14 + r() * 26, bh = h * (0.7 + r() * 0.3);
        ctx.fillStyle = cols[Math.floor(r() * cols.length)];
        ctx.fillRect(x, h - bh, bw - 2, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x + 3, h - bh + 20, bw - 8, 4);
        ctx.fillRect(x + 3, h - 30, bw - 8, 3);
        x += bw;
      }
    });
    // Ugnslucka: svart glas med ljus kant
    at('oven', (w, h) => {
      ctx.fillStyle = '#121316'; ctx.fillRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(0.4, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.05)');
      ctx.fillStyle = g; ctx.fillRect(30, 60, w - 60, h - 90);
      ctx.strokeStyle = '#3a3c42'; ctx.lineWidth = 6; ctx.strokeRect(30, 60, w - 60, h - 90);
    });
    // Tidning
    at('magazine', (w, h) => {
      ctx.fillStyle = '#e9e3d6'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c23b3b'; ctx.fillRect(0, 0, w, 60);
      ctx.fillStyle = '#fff'; ctx.font = '900 40px Arial Black, Arial'; ctx.textAlign = 'center'; ctx.fillText('LANTLIV', w / 2, 45);
      ctx.fillStyle = '#7da35c'; ctx.fillRect(20, 80, w - 40, 160);
      ctx.fillStyle = '#333'; for (let i = 0; i < 5; i++) ctx.fillRect(20, 255 + i * 12, w - 40 - (i % 2) * 60, 6);
    });
    return toTex(c, { repeat: false });
  });
}

// ===========================================================================
// Material
// ===========================================================================

const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
const MATERIALS = {
  paint: () => cached('m_paint', () => std({ roughness: 0.75 })),
  lacquer: () => cached('m_lacq', () => std({ roughness: 0.32 })),
  wood: () => cached('m_wood', () => std({ map: woodTexture(), roughness: 0.55 })),
  steel: () => cached('m_steel', () => std({ roughness: 0.32, metalness: 0.85 })),
  chrome: () => cached('m_chrome', () => std({ roughness: 0.12, metalness: 1 })),
  brass: () => cached('m_brass', () => std({ roughness: 0.3, metalness: 0.9 })),
  black: () => cached('m_black', () => std({ roughness: 0.12, metalness: 0.2 })),
  ceramic: () => cached('m_cer', () => std({ roughness: 0.18 })),
  fabric: () => cached('m_fab', () => std({ roughness: 0.95 })),
  plant: () => cached('m_plant', () => std({ roughness: 0.7, side: THREE.DoubleSide })),
  rubber: () => cached('m_rub', () => std({ roughness: 0.9 })),
  tile: () => cached('m_tile', () => std({ map: subwayTexture(), roughness: 0.2 })),
  wall: () => cached('m_wall', () => std({ map: wallTexture(), roughness: 0.92 })),
  ceiling: () => cached('m_ceil', () => std({ map: wallTexture(), roughness: 0.95, emissive: 0x4a443a })),
  decal: () => cached('m_decal', () => std({ map: atlas(), roughness: 0.55 })),
  overlay: () => cached('m_over', () => std({ map: atlas(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -2 })),
  view: () => cached('m_view', () => new THREE.MeshBasicMaterial({ map: atlas(), vertexColors: true, fog: false })),
  lit: () => cached('m_lit', () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
  glass: () => cached('m_glass', () => std({ roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false, envMapIntensity: 1.6 })),
  water: () => cached('m_water', () => std({ roughness: 0.02, metalness: 0.2, transparent: true, opacity: 0.45, depthWrite: false, envMapIntensity: 2, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -3 })),
  sunpatch: () => cached('m_sun', () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -3 })),
  tray: () => cached('m_tray', () => std({ roughness: 0.3, metalness: 0.8, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -2 })),
  floorDecal: () => cached('m_fdec', () => std({ roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -2 })),
};

// ===========================================================================
// Rummet: golv, väggar, tak, fönster
// ===========================================================================

function addFloors(C, R, tileRect) {
  // Fysik: hela golvet
  solid(C, 22, 0.5, 22, 0, -0.5, 0, 0, 1);
  if (!C.scene) return;
  // Golven ligger en hårsmån över vägytan så att parkett, kakel och matta
  // syns i stället för banans egen yta (vägen finns kvar i fysiken).
  const Y = 0.0052;
  const plane = (x0, x1, z0, z1, rep) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, Y, (z0 + z1) / 2);
    const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / rep, -p.getZ(i) / rep);
    return g;
  };
  const [tx0, tx1, tz0, tz1] = tileRect;
  const tiles = new THREE.Mesh(plane(tx0, tx1, tz0, tz1, TILE_REPEAT), new THREE.MeshStandardMaterial({
    map: tileFloorTexture(), roughness: 0.14, envMapIntensity: 1.0, polygonOffset: true, polygonOffsetFactor: -3,
  }));
  tiles.receiveShadow = true;
  C.scene.add(tiles);
  const parts = [plane(tx1, R.x1, R.z0, R.z1, PARQUET_REPEAT), plane(R.x0, tx1, tz1, R.z1, PARQUET_REPEAT)];
  const parquet = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({
    map: parquetTexture(), roughness: 0.38, envMapIntensity: 0.8, polygonOffset: true, polygonOffsetFactor: -3,
  }));
  parquet.receiveShadow = true;
  C.scene.add(parquet);
  // Tröskellist i mässing mellan kakel och parkett
  C.B.add('brass', box(0.03, 0.004, tz1 - tz0, tx1, 0.007, (tz0 + tz1) / 2), rgb(0xc9a46a));
  C.B.add('brass', box(tx1 - tx0, 0.004, 0.03, (tx0 + tx1) / 2, 0.007, tz1), rgb(0xc9a46a));
}

function addRoom(C, R) {
  const W = R.x1 - R.x0, D = R.z1 - R.z0, cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
  for (const [hx, hz, x, z] of [[W / 2 + 0.3, 0.15, cx, R.z0 - 0.15], [W / 2 + 0.3, 0.15, cx, R.z1 + 0.15], [0.15, D / 2 + 0.3, R.x0 - 0.15, cz], [0.15, D / 2 + 0.3, R.x1 + 0.15, cz]]) {
    solid(C, hx, R.H / 2, hz, x, R.H / 2, z, 0, 0.5);
  }
  if (!C.B) return;
  const sides = [
    { x: cx, z: R.z0, rot: 0, len: W }, { x: cx, z: R.z1, rot: Math.PI, len: W },
    { x: R.x0, z: cz, rot: Math.PI / 2, len: D }, { x: R.x1, z: cz, rot: -Math.PI / 2, len: D },
  ];
  for (const s of sides) {
    const g = new THREE.PlaneGeometry(s.len, R.H);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s.len / 2, uv.getY(i) * R.H / 2);
    C.B.add('wall', place(g.translate(0, R.H / 2, 0), s.x, 0, s.z, s.rot), [1, 1, 1]);
    // Golvsockel och taklist
    C.B.add('paint', place(box(s.len, 0.09, 0.015, 0, 0.045, 0.0075), s.x, 0, s.z, s.rot), rgb(0xf4f1ea));
    C.B.add('paint', place(box(s.len, 0.05, 0.04, 0, R.H - 0.025, 0.02), s.x, 0, s.z, s.rot), rgb(0xf4f1ea));
  }
  const ceil = new THREE.PlaneGeometry(W, D);
  ceil.rotateX(Math.PI / 2);
  C.B.add('ceiling', ceil.translate(cx, R.H, cz), rgb(0xfbf8f2));
  // Infällda spotlights i taket
  for (let x = R.x0 + 3; x < R.x1 - 1; x += 4.5) for (let z = R.z0 + 2.5; z < R.z1 - 1; z += 4.5) {
    C.B.add('lit', cyl(0.045, 0.045, 0.01, x, R.H - 0.012, z, 12), [1.6, 1.5, 1.3]);
    C.B.add('chrome', cyl(0.06, 0.06, 0.006, x, R.H - 0.006, z, 12), rgb(0xdddddd));
  }
}

// Fönster i en vägg: karm, spröjs, glas, utsikt och bänk. (x, z) på väggen,
// framsidan inåt rummet (+z i ramen).
function addWindow(C, { x, z, rotY = 0, w = 1.4, h = 1.2, sill = 1.0, curtains = false, mullions = 1, door = false }) {
  if (!C.B) return;
  const F = frame(C, x, z, rotY);
  const cy = sill + h / 2;
  const view = atlasPlane(w, h, cellUV('view')).translate(0, cy, 0.006);
  F.add('view', view, [1.05, 1.03, 1.0]);
  F.add('glass', new THREE.PlaneGeometry(w, h).translate(0, cy, 0.04), [1, 1, 1]);
  const white = rgb(0xf6f4ef), t = 0.07;
  F.box('lacquer', w + t * 2, t, 0.1, 0, sill - t / 2, 0.05, white);
  F.box('lacquer', w + t * 2, t, 0.1, 0, sill + h + t / 2, 0.05, white);
  F.box('lacquer', t, h, 0.1, -w / 2 - t / 2, cy, 0.05, white);
  F.box('lacquer', t, h, 0.1, w / 2 + t / 2, cy, 0.05, white);
  for (let i = 1; i <= mullions; i++) F.box('lacquer', 0.045, h, 0.06, -w / 2 + (i * w) / (mullions + 1), cy, 0.05, white);
  if (!door) {
    F.box('lacquer', 0.045, 0.045, 0.06, 0, sill + h * 0.62, 0.05, white);
    F.box('paint', w + 0.24, 0.03, 0.2, 0, sill - 0.015, 0.1, white); // fönsterbänk
  } else {
    F.box('chrome', 0.03, 0.22, 0.04, -0.12, 1.0, 0.11, rgb(0xcfcfcf));
    F.box('steel', w + t * 2, 0.02, 0.12, 0, 0.01, 0.06, rgb(0x9a9a9a));
  }
  if (curtains) {
    for (const s of [-1, 1]) {
      const cw = 0.42, ch = sill + h + 0.25;
      const g = new THREE.PlaneGeometry(cw, ch, 12, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 38) * 0.035);
      g.computeVertexNormals();
      F.add('fabric', g.translate(s * (w / 2 + 0.28), ch / 2 + 0.02, 0.16), rgb(0xd9cdb8));
      F.add('fabric', g.clone().rotateY(Math.PI).translate(s * (w / 2 + 0.28), ch / 2 + 0.02, 0.17), rgb(0xd9cdb8));
    }
    F.add('brass', rod(-w / 2 - 0.6, sill + h + 0.3, 0.16, w / 2 + 0.6, sill + h + 0.3, 0.16, 0.012), rgb(0xb8925a));
  }
}

// Solfläckar på golvet framför fönster (additivt sken)
function addSunPatch(C, { x0, x1, z0, z1, skew = 0 }) {
  if (!C.B) return;
  const g = new THREE.BufferGeometry();
  const y = 0.009;
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, y, z1, x1, y, z1, x1 + skew, y, z0, x0, y, z1, x1 + skew, y, z0, x0 + skew, y, z0,
  ], 3));
  g.computeVertexNormals();
  C.B.add('sunpatch', g, [1, 0.86, 0.62]);
}

function addRadiator(C, { x, z, rotY = 0, w = 1.2 }) {
  const F = frame(C, x, z, rotY);
  F.solid(w / 2, 0.3, 0.05, 0, 0.42, 0.07);
  if (!C.B) return;
  const white = rgb(0xf3f1ec);
  F.box('lacquer', w, 0.6, 0.08, 0, 0.42, 0.07, white);
  for (let i = 0; i < w / 0.05; i++) F.box('lacquer', 0.02, 0.56, 0.01, -w / 2 + 0.025 + i * 0.05, 0.42, 0.115, rgb(0xe9e7e1));
  F.box('chrome', 0.02, 0.12, 0.02, w / 2 + 0.04, 0.14, 0.06, rgb(0xd0d0d0));
}

function addFrame(C, { x, y, z, rotY = 0, w, h, art }) {
  if (!C.B) return;
  const F = frame(C, x, z, rotY);
  F.box('paint', w + 0.06, h + 0.06, 0.025, 0, y, 0.0125, rgb(0x2a2420));
  F.add('decal', atlasPlane(w - 0.06, h - 0.06, cellUV(art)).translate(0, y, 0.0265), [1, 1, 1]);
}

// ===========================================================================
// Köksinredning
// ===========================================================================

const SAGE = 0x86a08d, CREAM = 0xf3efe6, OAK = 0xf0d6ae, NAVY = 0x2f4660, BRASSC = 0xc49a5a, STEELC = 0xc9ccd0;

// Bänkskåp längs en vägg. (x, z) = mitten av bakkanten mot väggen.
// segs: [{ w, kind: 'doors'|'drawers'|'sink'|'dish'|'stove'|'corner' }]
function addCounterRun(C, { x, z, rotY = 0, segs, uppers = true, splash = true, skipUpper = [] }) {
  const len = segs.reduce((a, s) => a + s.w, 0);
  const F = frame(C, x, z, rotY);
  const D = 0.6, H = 0.9;
  F.solid(len / 2, H / 2, D / 2 + 0.01, 0, H / 2, D / 2 + 0.01, 0, 0.5);
  if (uppers) F.solid(len / 2, 0.35, 0.175, 0, 1.8, 0.175);
  if (!C.B) return;
  const front = rgb(SAGE), oak = rgb(OAK), handle = rgb(BRASSC), kick = rgb(0x5d6f62);
  F.box('paint', len, 0.1, 0.5, 0, 0.05, 0.25, kick); // sockel, indragen
  F.box('lacquer', len, 0.77, 0.56, 0, 0.1 + 0.385, 0.28, rgb(0xeae6dc)); // stomme
  F.box('wood', len + 0.004, 0.035, D + 0.02, 0, H - 0.0175, (D + 0.02) / 2, oak, 0.9); // bänkskiva
  if (splash) F.add('tile', box(len, 0.55, 0.01, 0, H + 0.275, 0.005, 0.6), [1, 1, 1]);
  let lx = -len / 2;
  for (const s of segs) {
    const cx = lx + s.w / 2;
    const fz = 0.57;
    if (s.kind === 'drawers') {
      const hs = [0.18, 0.27, 0.27];
      let y = 0.11;
      for (const h of hs) {
        F.box('lacquer', s.w - 0.006, h - 0.006, 0.02, cx, y + h / 2, fz, front);
        F.box('brass', s.w * 0.45, 0.012, 0.02, cx, y + h - 0.05, fz + 0.02, handle);
        y += h;
      }
    } else if (s.kind === 'dish') {
      F.box('steel', s.w - 0.006, 0.72, 0.02, cx, 0.11 + 0.36, fz, rgb(STEELC));
      F.box('steel', s.w - 0.1, 0.02, 0.03, cx, 0.76, fz + 0.02, rgb(0xa9adb2));
      F.box('lit', 0.012, 0.012, 0.004, cx + s.w * 0.36, 0.8, fz + 0.012, [0.3, 1.4, 0.4]);
    } else if (s.kind === 'stove') {
      F.add('decal', atlasPlane(s.w - 0.02, 0.56, cellUV('oven')).translate(cx, 0.12 + 0.3, fz + 0.012), [1, 1, 1]);
      F.box('black', s.w - 0.006, 0.6, 0.02, cx, 0.12 + 0.3, fz - 0.002, rgb(0x141518));
      F.box('steel', s.w - 0.006, 0.14, 0.02, cx, 0.8, fz, rgb(STEELC)); // panel
      F.box('steel', s.w * 0.7, 0.018, 0.035, cx, 0.66, fz + 0.03, rgb(0xd5d8dc));
      for (let k = 0; k < 4; k++) F.add('black', cyl(0.018, 0.018, 0.025, 0, 0, 0, 12).rotateX(Math.PI / 2).translate(cx - 0.21 + k * 0.08 + (k > 1 ? 0.18 : 0), 0.8, fz + 0.02), rgb(0x222222));
      F.add('lit', atlasPlane(0.12, 0.045, cellUV('clock')).translate(cx + 0.03, 0.8, fz + 0.012), [1.3, 1.3, 1.3]);
      F.add('decal', atlasPlane(s.w - 0.04, 0.5, cellUV('cooktop')).rotateX(-Math.PI / 2).translate(cx, H + 0.002, 0.31), [1, 1, 1]);
    } else if (s.kind !== 'corner') {
      // Luckor (en eller två)
      const n = s.w > 0.65 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const dw = s.w / n, dx = lx + dw * (k + 0.5);
        F.box('lacquer', dw - 0.006, 0.72, 0.02, dx, 0.11 + 0.36, fz, front);
        const hx = n === 2 ? (k === 0 ? dw / 2 - 0.05 : -dw / 2 + 0.05) : dw / 2 - 0.05;
        F.box('brass', 0.012, 0.16, 0.02, dx + hx, 0.7, fz + 0.02, handle);
      }
      if (s.kind === 'sink') {
        F.box('steel', s.w - 0.12, 0.012, 0.42, cx, H + 0.001, 0.32, rgb(0xb4b8bd));
        F.box('black', s.w - 0.18, 0.006, 0.36, cx, H + 0.006, 0.32, rgb(0x55595e));
        // Kran
        F.add('chrome', cyl(0.018, 0.022, 0.32, cx, H, 0.1, 12), rgb(0xe6e6e6));
        F.add('chrome', new THREE.TorusGeometry(0.12, 0.014, 8, 16, Math.PI).rotateY(Math.PI / 2).translate(cx, H + 0.32, 0.22), rgb(0xe6e6e6));
        F.add('chrome', rod(cx + 0.05, H + 0.2, 0.1, cx + 0.14, H + 0.22, 0.1, 0.008), rgb(0xe6e6e6));
      }
    }
    if (uppers && !skipUpper.includes(segs.indexOf(s))) {
      const n = s.w > 0.65 ? 2 : 1;
      F.box('lacquer', s.w, 0.7, 0.33, cx, 1.8, 0.165, rgb(0xf0ece2));
      for (let k = 0; k < n; k++) {
        const dw = s.w / n, dx = lx + dw * (k + 0.5);
        F.box('lacquer', dw - 0.006, 0.696, 0.02, dx, 1.8, 0.34, rgb(CREAM));
        const hx = n === 2 ? (k === 0 ? dw / 2 - 0.05 : -dw / 2 + 0.05) : dw / 2 - 0.05;
        F.box('brass', 0.012, 0.14, 0.02, dx + hx, 1.55, 0.36, handle);
      }
      F.box('lit', s.w - 0.04, 0.008, 0.02, cx, 1.448, 0.26, [1.5, 1.35, 1.1]); // bänkbelysning
    }
    if (s.kind === 'stove') {
      // Köksfläkt i stål
      F.box('steel', s.w + 0.1, 0.12, 0.5, cx, 1.62, 0.25, rgb(STEELC));
      F.box('steel', 0.32, 0.9, 0.26, cx, 2.13, 0.14, rgb(STEELC));
      F.box('lit', s.w - 0.1, 0.004, 0.3, cx, 1.558, 0.28, [1.6, 1.45, 1.2]);
    }
    lx += s.w;
  }
}

// Högskåp (ugnstorn, skafferi) och kyl. (x, z) = mitten bak mot väggen.
function addTallUnit(C, { x, z, rotY = 0, w = 0.6, kind = 'pantry' }) {
  const F = frame(C, x, z, rotY);
  const H = kind === 'fridge' ? 1.86 : 2.15, D = kind === 'fridge' ? 0.68 : 0.6;
  F.solid(w / 2, H / 2, D / 2, 0, H / 2, D / 2, 0, 0.5);
  if (!C.B) return;
  if (kind === 'fridge') {
    const st = rgb(0xd8dbde);
    F.box('steel', w, H - 0.06, D - 0.04, 0, 0.06 + (H - 0.06) / 2, (D - 0.04) / 2, st);
    F.box('paint', w - 0.04, 0.06, D - 0.08, 0, 0.03, (D - 0.08) / 2, rgb(0x2a2a2a));
    F.box('steel', w - 0.006, 1.12, 0.04, 0, 0.72 + 0.56, D - 0.02, st); // kyldörr
    F.box('steel', w - 0.006, 0.6, 0.04, 0, 0.08 + 0.3, D - 0.02, st); // frysdörr
    F.box('chrome', 0.025, 0.7, 0.04, -w / 2 + 0.06, 1.25, D + 0.03, rgb(0xeeeeee));
    F.box('chrome', 0.025, 0.3, 0.04, -w / 2 + 0.06, 0.55, D + 0.03, rgb(0xeeeeee));
    // Teckning och almanacka med magneter
    F.add('decal', atlasPlane(0.24, 0.24, cellUV('drawing')).translate(0.08, 1.42, D + 0.002), [1, 1, 1]);
    F.add('decal', atlasPlane(0.16, 0.2, cellUV('calendar')).translate(0.12, 1.12, D + 0.002), [1, 1, 1]);
    for (const [mx, my, col] of [[-0.12, 1.62, 0xe53935], [0.2, 1.62, 0x43a047], [0.0, 0.96, 0xfdd835], [-0.1, 1.2, 0x1e88e5]]) {
      F.add('ceramic', new THREE.SphereGeometry(0.018, 10, 8).scale(1, 1, 0.5).translate(mx, my, D + 0.006), rgb(col));
    }
    return;
  }
  F.box('lacquer', w, H - 0.1, D - 0.02, 0, 0.1 + (H - 0.1) / 2, (D - 0.02) / 2, rgb(0xeae6dc));
  F.box('paint', w, 0.1, D - 0.1, 0, 0.05, (D - 0.1) / 2, rgb(0x5d6f62));
  if (kind === 'oven') {
    F.box('lacquer', w - 0.006, 0.7, 0.02, 0, 0.1 + 0.35, D - 0.01, rgb(SAGE));
    F.add('decal', atlasPlane(w - 0.04, 0.5, cellUV('oven')).translate(0, 1.15, D + 0.002), [1, 1, 1]);
    F.box('black', w - 0.006, 0.55, 0.02, 0, 1.15, D - 0.012, rgb(0x141518));
    F.box('steel', w * 0.7, 0.018, 0.035, 0, 1.36, D + 0.02, rgb(0xd5d8dc));
    F.add('lit', atlasPlane(0.12, 0.045, cellUV('clock')).translate(0, 1.47, D + 0.003), [1.3, 1.3, 1.3]);
    F.box('steel', w - 0.006, 0.08, 0.02, 0, 1.47, D - 0.01, rgb(STEELC));
    F.box('lacquer', w - 0.006, 0.6, 0.02, 0, 1.82, D - 0.01, rgb(CREAM));
    F.box('brass', 0.012, 0.14, 0.02, w / 2 - 0.05, 1.6, D + 0.01, rgb(BRASSC));
  } else {
    F.box('lacquer', w - 0.006, 1.3, 0.02, 0, 0.1 + 0.65, D - 0.01, rgb(SAGE));
    F.box('lacquer', w - 0.006, 0.73, 0.02, 0, 0.1 + 1.3 + 0.37, D - 0.01, rgb(CREAM));
    F.box('brass', 0.012, 0.3, 0.02, w / 2 - 0.05, 0.95, D + 0.01, rgb(BRASSC));
    F.box('brass', 0.012, 0.14, 0.02, w / 2 - 0.05, 1.55, D + 0.01, rgb(BRASSC));
  }
}

// Saker på bänken (bara grafik, ovanför bilarna)
function addCounterClutter(C, { x, z, rotY = 0, items }) {
  if (!C.B) return;
  const F = frame(C, x, z, rotY, 0.9);
  for (const it of items) {
    const [lx, lz] = [it.at, it.d ?? 0.32];
    if (it.kind === 'kettle') {
      F.add('steel', lathe([[0, 0], [0.085, 0], [0.09, 0.08], [0.07, 0.2], [0.03, 0.23], [0, 0.24]], lx, 0, lz, 18), rgb(0xd3d6da));
      F.add('black', rod(lx + 0.07, 0.05, lz, lx + 0.07, 0.19, lz, 0.012), rgb(0x222222));
    } else if (it.kind === 'toaster') {
      F.box('lacquer', 0.28, 0.19, 0.16, lx, 0.095, lz, rgb(0xd94c3d));
      F.box('black', 0.2, 0.01, 0.03, lx, 0.192, lz - 0.03, rgb(0x111111));
      F.box('black', 0.2, 0.01, 0.03, lx, 0.192, lz + 0.03, rgb(0x111111));
    } else if (it.kind === 'coffee') {
      F.box('black', 0.22, 0.34, 0.24, lx, 0.17, lz - 0.02, rgb(0x2a2b2e));
      F.add('glass', cyl(0.06, 0.06, 0.14, lx, 0.02, lz + 0.06), [1, 1, 1]);
      F.add('black', cyl(0.055, 0.055, 0.06, lx, 0.02, lz + 0.06), rgb(0x3a2214));
    } else if (it.kind === 'bowl') {
      F.add('ceramic', lathe([[0, 0], [0.07, 0], [0.15, 0.08], [0.16, 0.09], [0.14, 0.085], [0.06, 0.012], [0, 0.012]], lx, 0, lz, 20), rgb(0xf2efe8));
      const fr = rng(it.seed ?? 5);
      for (let k = 0; k < 7; k++) {
        const a = fr() * 6.28, rr = fr() * 0.08;
        F.add('ceramic', new THREE.SphereGeometry(0.038, 12, 10).translate(lx + Math.cos(a) * rr, 0.06 + fr() * 0.04, lz + Math.sin(a) * rr), rgb([0xd8362b, 0xf28c1a, 0x9ccc3c, 0xf2d33a][k % 4]));
      }
    } else if (it.kind === 'board') {
      F.add('decal', atlasPlane(0.42, 0.3, cellUV('board')).rotateX(-Math.PI / 2).translate(lx, 0.022, lz), [1, 1, 1]);
      F.box('wood', 0.42, 0.02, 0.3, lx, 0.01, lz, rgb(0xd8b07a));
    } else if (it.kind === 'knives') {
      F.box('wood', 0.12, 0.22, 0.1, lx, 0.11, lz, rgb(0x6b4a2f));
      for (let k = 0; k < 4; k++) F.box('black', 0.02, 0.08, 0.016, lx - 0.03 + k * 0.02, 0.25, lz, rgb(0x1a1a1a));
    } else if (it.kind === 'jars') {
      for (let k = 0; k < 3; k++) {
        F.add('glass', cyl(0.055, 0.055, 0.2 - k * 0.03, lx + k * 0.13, 0, lz), [1, 1, 1]);
        F.add('paint', cyl(0.05, 0.05, 0.12 - k * 0.025, lx + k * 0.13, 0.005, lz), rgb([0xe9dcc0, 0xc8853a, 0x8a5a2a][k]));
        F.add('wood', cyl(0.057, 0.057, 0.02, lx + k * 0.13, 0.2 - k * 0.03, lz), rgb(0xd9b88a));
      }
    } else if (it.kind === 'plant') {
      F.add('ceramic', lathe([[0, 0], [0.07, 0], [0.085, 0.13], [0.08, 0.14]], lx, 0, lz, 14), rgb(0xe8e2d6));
      const pr = rng(it.seed ?? 3);
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * 6.28, l = 0.1 + pr() * 0.08;
        F.add('plant', new THREE.SphereGeometry(1, 8, 6).scale(0.02, l, 0.045).rotateZ(Math.cos(a) * 0.6).rotateX(Math.sin(a) * 0.6).translate(lx + Math.cos(a) * 0.04, 0.14 + l * 0.8, lz + Math.sin(a) * 0.04), rgb(0x4f8a3c));
      }
    } else if (it.kind === 'rack') {
      F.box('chrome', 0.42, 0.01, 0.3, lx, 0.02, lz, rgb(0xcfd2d5));
      for (let k = 0; k < 6; k++) F.add('ceramic', cyl(0.11, 0.11, 0.012, 0, 0, 0, 20).rotateX(Math.PI / 2 - 0.12).translate(lx - 0.15 + k * 0.05, 0.13, lz), rgb(0xf4f2ec));
    } else if (it.kind === 'bread') {
      F.add('wood', new THREE.SphereGeometry(1, 14, 10).scale(0.16, 0.07, 0.08).translate(lx, 0.05, lz), rgb(0xb7783a));
    } else if (it.kind === 'micro') {
      F.box('steel', 0.5, 0.3, 0.38, lx, 0.15, lz - 0.04, rgb(0xcfd2d5));
      F.box('black', 0.34, 0.24, 0.01, lx - 0.06, 0.15, lz + 0.15, rgb(0x16171a));
    } else if (it.kind === 'bottles') {
      for (let k = 0; k < 3; k++) F.add('glass', lathe([[0, 0], [0.035, 0], [0.035, 0.18], [0.012, 0.24], [0.012, 0.28], [0, 0.28]], lx + k * 0.08, 0, lz, 10), [1, 1, 1]);
      F.add('lacquer', lathe([[0, 0], [0.033, 0], [0.033, 0.17], [0, 0.17]], lx + 0.08, 0, lz, 10), rgb(0x6a8a2a));
    }
  }
}

// Köksö med luckor på ena sidan och överhäng för barstolar på den andra.
function addIsland(C, { x, z, rotY = 0, len = 3.2, depth = 0.95, over = 0.3, color = NAVY }) {
  const F = frame(C, x, z, rotY);
  const H = 0.9;
  F.solid(len / 2, (H - 0.1) / 2, depth / 2, 0, (H - 0.1) / 2 + 0.05, 0);
  F.solid(len / 2 + 0.05, 0.02, (depth + over) / 2 + 0.03, 0, H - 0.02, over / 2);
  if (!C.B) return;
  const col = rgb(color);
  F.box('paint', len - 0.1, 0.1, depth - 0.1, 0, 0.05, 0, rgb(0x2a3646));
  F.box('lacquer', len, 0.8, depth, 0, 0.5, 0, col);
  F.box('wood', len + 0.1, 0.04, depth + over + 0.06, 0, H - 0.02, over / 2, rgb(OAK), 0.9);
  // Luckor och lådor mot köket (-z), panelfält mot stolarna (+z)
  const n = Math.round(len / 0.6);
  for (let k = 0; k < n; k++) {
    const dx = -len / 2 + (k + 0.5) * (len / n);
    F.box('lacquer', len / n - 0.008, 0.72, 0.02, dx, 0.47, -depth / 2 - 0.01, col);
    F.box('brass', len / n * 0.45, 0.012, 0.02, dx, 0.74, -depth / 2 - 0.03, rgb(BRASSC));
    F.box('lacquer', len / n - 0.05, 0.66, 0.012, dx, 0.47, depth / 2 + 0.006, rgb(0x34506d));
  }
}

// Barstol: rund träsits på fyra smala stålben med fotring
function addStool(C, { x, z, rotY = 0, seat = 0.65 }) {
  const F = frame(C, x, z, rotY);
  const foot = 0.22;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    F.solid(0.012, 0.16, 0.012, Math.cos(a) * foot, 0.16, Math.sin(a) * foot);
  }
  F.solid(0.13, 0.06, 0.13, 0, 0.12, 0); // fotringen hindrar bilar att fastna mellan benen
  F.solid(0.19, 0.02, 0.19, 0, seat - 0.02, 0);
  if (!C.B) return;
  const steel = rgb(0x2b2d31);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    F.add('steel', rod(Math.cos(a) * 0.12, seat - 0.04, Math.sin(a) * 0.12, Math.cos(a) * foot, 0, Math.sin(a) * foot, 0.011), steel);
  }
  F.add('steel', new THREE.TorusGeometry(0.175, 0.009, 6, 24).rotateX(Math.PI / 2).translate(0, 0.25, 0), steel);
  F.add('wood', cyl(0.19, 0.18, 0.04, 0, seat - 0.04, 0, 24), rgb(0xd8b384));
}

// Matbord på fyra ben med sarg
function addTable(C, { x, z, rotY = 0, len = 3.4, depth = 1.1, h = 0.75 }) {
  const F = frame(C, x, z, rotY);
  const lx = len / 2 - 0.08, lz = depth / 2 - 0.08, leg = 0.07;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.solid(leg / 2, (h - 0.04) / 2, leg / 2, sx * lx, (h - 0.04) / 2, sz * lz);
  F.solid(len / 2, 0.06, depth / 2, 0, h - 0.06, 0);
  if (!C.B) return;
  const oak = rgb(0xe8c99c);
  F.box('wood', len, 0.04, depth, 0, h - 0.02, 0, oak, 1.2);
  F.box('wood', len - 0.2, 0.08, 0.025, 0, h - 0.08, lz, oak);
  F.box('wood', len - 0.2, 0.08, 0.025, 0, h - 0.08, -lz, oak);
  F.box('wood', 0.025, 0.08, depth - 0.2, lx, h - 0.08, 0, oak);
  F.box('wood', 0.025, 0.08, depth - 0.2, -lx, h - 0.08, 0, oak);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    F.add('wood', new THREE.CylinderGeometry(0.03, 0.022, h - 0.04, 10).translate(sx * lx, (h - 0.04) / 2, sz * lz), oak);
  }
  // Duk, ljusstakar, skål och glas på bordet
  F.box('fabric', 0.45, 0.003, depth + 0.02, 0, h + 0.0015, 0, rgb(0x9fb3a0));
  for (const k of [-0.25, 0.25]) {
    F.add('brass', cyl(0.035, 0.045, 0.06, k, h, 0, 14), rgb(BRASSC));
    F.add('paint', cyl(0.012, 0.012, 0.22, k, h + 0.06, 0, 10), rgb(0xf6f1e4));
  }
  F.add('ceramic', lathe([[0, 0], [0.06, 0], [0.14, 0.07], [0.15, 0.08], [0.06, 0.01], [0, 0.01]], 0.75, h, 0.1, 20), rgb(0xd9643e));
  for (let k = 0; k < 6; k++) F.add('ceramic', new THREE.SphereGeometry(0.036, 12, 10).translate(0.72 + (k % 3) * 0.04 - 0.02, h + 0.06, 0.06 + Math.floor(k / 3) * 0.06), rgb([0xf28c1a, 0xd8362b, 0x9ccc3c][k % 3]));
  for (const [gx, gz] of [[-1.1, 0.3], [-0.9, -0.3], [1.2, -0.3], [-1.4, -0.32]]) {
    F.add('glass', cyl(0.035, 0.03, 0.11, gx, h, gz, 12), [1, 1, 1]);
    F.add('ceramic', cyl(0.12, 0.12, 0.012, gx - 0.12 * Math.sign(gz) * 0, h, gz - Math.sign(gz) * 0.12, 24), rgb(0xf6f4ef));
  }
}

// Stol med pinnrygg. (x, z) = sitsens mitt, framsidan mot +z.
function addChair(C, { x, z, rotY = 0, color = 0xe2c393, paint = false }) {
  const F = frame(C, x, z, rotY);
  const sh = 0.46, lx = 0.19, lz = 0.18, leg = 0.035;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.solid(leg / 2, sh / 2, leg / 2, sx * lx, sh / 2, sz * lz);
  F.solid(lx, 0.07, lz, 0, 0.12, 0); // sargen/slåarna: bilar kan inte gömma sig under stolen
  F.solid(0.22, 0.02, 0.21, 0, sh - 0.02, 0);
  F.solid(0.22, 0.22, 0.02, 0, sh + 0.22, -lz);
  if (!C.B) return;
  const key = paint ? 'lacquer' : 'wood';
  const col = rgb(color);
  F.box(key, 0.44, 0.03, 0.42, 0, sh - 0.015, 0.0, col);
  for (const sx of [-1, 1]) {
    F.add(key, new THREE.CylinderGeometry(0.017, 0.014, sh - 0.03, 8).translate(sx * lx, (sh - 0.03) / 2, lz), col);
    F.add(key, new THREE.CylinderGeometry(0.017, 0.014, 0.9, 8).translate(sx * lx, 0.45, -lz), col);
    F.add(key, rod(sx * lx, 0.15, -lz, sx * lx, 0.15, lz, 0.009), col);
  }
  F.add(key, rod(-lx, 0.2, lz, lx, 0.2, lz, 0.009), col);
  F.box(key, 0.42, 0.06, 0.025, 0, 0.86, -lz, col);
  for (let k = 0; k < 5; k++) F.add(key, rod(-0.12 + k * 0.06, sh, -lz, -0.12 + k * 0.06, 0.83, -lz, 0.008), col);
  F.box('fabric', 0.36, 0.025, 0.34, 0, sh + 0.012, 0.01, rgb(0xc7b79c)); // dyna
}

// Pendellampa: sladd från taket, skärm och glödande lampa
function addPendant(C, { x, z, y = 1.6, ceil = 2.7, color = 0x2f3b36, r = 0.2 }) {
  if (!C.B) return;
  C.B.add('black', rod(x, y + 0.15, z, x, ceil, z, 0.004), rgb(0x111111));
  C.B.add('paint', lathe([[0.02, 0.17], [0.05, 0.16], [r * 0.7, 0.07], [r, 0], [r - 0.006, 0], [r * 0.7 - 0.006, 0.065], [0.045, 0.155], [0.015, 0.165]], x, y, z, 24), rgb(color));
  C.B.add('brass', cyl(0.025, 0.025, 0.04, x, y + 0.15, z, 10), rgb(BRASSC));
  C.B.add('lit', new THREE.SphereGeometry(0.05, 12, 10).translate(x, y + 0.04, z), [2.2, 1.9, 1.4]);
}

// ===========================================================================
// Vardagsrum och övrigt
// ===========================================================================

function addSofa(C, { x, z, rotY = 0, len = 2.3 }) {
  const F = frame(C, x, z, rotY);
  F.solid(len / 2, 0.22, 0.46, 0, 0.22, 0);
  F.solid(len / 2, 0.2, 0.1, 0, 0.6, -0.36);
  if (!C.B) return;
  const fab = rgb(0x6f8197), dark = rgb(0x5c6b80);
  F.box('fabric', len, 0.28, 0.92, 0, 0.2, 0, dark);
  F.box('fabric', len - 0.3, 0.14, 0.7, 0, 0.41, 0.08, fab);
  F.box('fabric', len, 0.45, 0.2, 0, 0.6, -0.36, dark);
  for (const s of [-1, 1]) F.box('fabric', 0.15, 0.32, 0.92, s * (len / 2 - 0.075), 0.5, 0, dark);
  for (const k of [-0.55, 0.0, 0.55]) F.add('fabric', box(0.6, 0.38, 0.14, k, 0.68, -0.22), fab);
  F.add('fabric', box(0.4, 0.36, 0.1, -0.75, 0.68, -0.12).rotateZ(0.0), rgb(0xd28a52));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.add('wood', cyl(0.02, 0.015, 0.06, sx * (len / 2 - 0.08), 0, sz * 0.38, 8), rgb(0x6b4a2f));
}

function addArmchair(C, { x, z, rotY = 0 }) {
  const F = frame(C, x, z, rotY);
  F.solid(0.42, 0.25, 0.42, 0, 0.25, 0);
  F.solid(0.42, 0.25, 0.08, 0, 0.7, -0.34);
  if (!C.B) return;
  const fab = rgb(0xcf8a4a);
  F.box('fabric', 0.84, 0.18, 0.8, 0, 0.32, 0, fab);
  F.box('fabric', 0.84, 0.6, 0.16, 0, 0.66, -0.34, fab);
  for (const s of [-1, 1]) F.box('fabric', 0.12, 0.24, 0.8, s * 0.36, 0.5, 0, fab);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.add('wood', rod(sx * 0.33, 0.23, sz * 0.3, sx * 0.38, 0, sz * 0.36, 0.018), rgb(0x6b4a2f));
}

function addCoffeeTable(C, { x, z, rotY = 0 }) {
  const F = frame(C, x, z, rotY);
  F.solid(0.6, 0.02, 0.32, 0, 0.42, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.solid(0.02, 0.2, 0.02, sx * 0.52, 0.2, sz * 0.25);
  if (!C.B) return;
  F.box('wood', 1.2, 0.04, 0.64, 0, 0.42, 0, rgb(0xc59a6a));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.add('wood', cyl(0.022, 0.018, 0.4, sx * 0.52, 0, sz * 0.25, 8), rgb(0xc59a6a));
  F.add('decal', atlasPlane(0.22, 0.28, cellUV('magazine')).rotateX(-Math.PI / 2).rotateY(0.3).translate(-0.25, 0.443, 0.05), [1, 1, 1]);
  F.add('ceramic', cyl(0.045, 0.04, 0.09, 0.3, 0.44, -0.08, 14), rgb(0xe8d9c5));
}

function addTvBench(C, { x, z, rotY = 0 }) {
  const F = frame(C, x, z, rotY);
  F.both('wood', 1.8, 0.45, 0.42, 0, 0.225 + 0.08, 0, rgb(0xc59a6a));
  F.solid(0.6, 0.38, 0.03, 0, 0.53 + 0.38, -0.05);
  if (!C.B) return;
  for (const sx of [-1, 1]) F.box('paint', 0.04, 0.08, 0.36, sx * 0.8, 0.04, 0, rgb(0x2a2420));
  F.box('lacquer', 0.86, 0.38, 0.02, -0.44, 0.31, 0.22, rgb(0x9fb3a0));
  F.box('lacquer', 0.86, 0.38, 0.02, 0.44, 0.31, 0.22, rgb(0xe8dccb));
  F.box('black', 1.22, 0.71, 0.04, 0, 0.58 + 0.36, -0.05, rgb(0x16171a));
  F.add('decal', atlasPlane(1.18, 0.67, cellUV('tv')).translate(0, 0.94, -0.028), [1, 1, 1]);
  F.box('black', 0.3, 0.02, 0.18, 0, 0.535, -0.05, rgb(0x16171a));
  F.box('black', 0.05, 0.06, 0.03, 0, 0.56, -0.05, rgb(0x16171a));
}

function addBookshelf(C, { x, z, rotY = 0, w = 1.6, h = 1.9, shelves = 5 }) {
  const F = frame(C, x, z, rotY);
  F.solid(w / 2, h / 2, 0.17, 0, h / 2, 0.17);
  if (!C.B) return;
  const col = rgb(0xf3efe6);
  F.box('lacquer', w, h, 0.02, 0, h / 2, 0.01, col);
  for (const s of [-1, 1]) F.box('lacquer', 0.025, h, 0.34, s * (w / 2 - 0.0125), h / 2, 0.17, col);
  for (let k = 0; k <= shelves; k++) {
    const y = 0.04 + k * ((h - 0.06) / shelves);
    F.box('lacquer', w, 0.025, 0.34, 0, y, 0.17, col);
    if (k < shelves) F.add('decal', atlasPlane(w - 0.06, (h - 0.06) / shelves - 0.04, cellUV('spines')).translate(0, y + ((h - 0.06) / shelves) / 2, 0.3), [1, 1, 1]);
  }
}

// Krukväxt: kruka och lövverk (fikus/monstera i grova drag)
function addPlant(C, { x, z, size = 1, seed = 1, pot = 0xe2d5c3 }) {
  const F = frame(C, x, z, 0);
  const pr = 0.18 * size, ph = 0.34 * size;
  F.solid(pr, ph / 2, pr, 0, ph / 2, 0);
  if (!C.B) return;
  F.add('ceramic', lathe([[0, 0], [pr * 0.78, 0], [pr, ph], [pr * 0.92, ph], [0, ph - 0.03]], 0, 0, 0, 20), rgb(pot));
  F.add('paint', cyl(pr * 0.9, pr * 0.9, 0.01, 0, ph - 0.03, 0, 16), rgb(0x3b2a1c));
  const r = rng(seed);
  const top = ph + 1.0 * size;
  F.add('wood', rod(0, ph, 0, 0.05 * size, top, 0.02, 0.02 * size), rgb(0x6a4a2e));
  for (let k = 0; k < 34; k++) {
    const a = r() * Math.PI * 2, rr = (0.1 + r() * 0.35) * size, y = ph + (0.35 + r() * 0.85) * size;
    const leaf = new THREE.SphereGeometry(1, 8, 6).scale(0.11 * size, 0.012, 0.075 * size);
    leaf.rotateX((r() - 0.5) * 1.2).rotateZ((r() - 0.5) * 1.2).rotateY(a);
    F.add('plant', leaf.translate(Math.cos(a) * rr, y, Math.sin(a) * rr), rgb([0x3f7a35, 0x4d8b3f, 0x356b2d][k % 3]));
  }
}

function addDogBed(C, { x, z, rotY = 0 }) {
  const F = frame(C, x, z, rotY);
  F.solid(0.45, 0.1, 0.35, 0, 0.1, 0);
  if (!C.B) return;
  F.add('fabric', new THREE.TorusGeometry(0.36, 0.1, 10, 28).rotateX(Math.PI / 2).scale(1.2, 1, 1).translate(0, 0.1, 0), rgb(0x8a6a52));
  F.add('fabric', cyl(0.34, 0.34, 0.08, 0, 0.0, 0, 28).scale(1.2, 1, 1), rgb(0xe9dfcf));
  F.add('rubber', new THREE.TorusGeometry(0.05, 0.02, 8, 14).translate(0.2, 0.1, 0.05), rgb(0xe53935));
}

function addBowls(C, { x, z, rotY = 0 }) {
  const F = frame(C, x, z, rotY);
  F.solid(0.25, 0.04, 0.1, 0, 0.04, 0);
  if (!C.B) return;
  for (const [k, col, fill] of [[-0.12, 0x2f7be8, 0x7a4b2a], [0.12, 0xe85a4f, 0x9fc6e8]]) {
    F.add('ceramic', lathe([[0, 0], [0.08, 0], [0.095, 0.055], [0.085, 0.06], [0.07, 0.015], [0, 0.015]], k, 0, 0, 20), rgb(col));
    F.add(fill === 0x9fc6e8 ? 'water' : 'paint', cyl(0.072, 0.072, 0.03, k, 0.012, 0, 18), rgb(fill));
  }
  F.box('rubber', 0.55, 0.004, 0.24, 0, 0.002, 0, rgb(0x6b7a6b));
}

function addBench(C, { x, z, rotY = 0, len = 1.6 }) {
  const F = frame(C, x, z, rotY);
  F.solid(len / 2, 0.025, 0.18, 0, 0.43, 0);
  for (const s of [-1, 1]) F.solid(0.02, 0.21, 0.16, s * (len / 2 - 0.1), 0.21, 0);
  if (!C.B) return;
  F.box('wood', len, 0.04, 0.36, 0, 0.43, 0, rgb(0xd7b07c));
  for (const s of [-1, 1]) F.box('wood', 0.04, 0.41, 0.32, s * (len / 2 - 0.1), 0.205, 0, rgb(0xd7b07c));
  F.box('wood', len - 0.2, 0.05, 0.02, 0, 0.18, 0, rgb(0xd7b07c));
}

// Trappstege i trä med två steg
function addStepStool(C, { x, z, rotY = 0 }) {
  const F = frame(C, x, z, rotY);
  F.solid(0.22, 0.23, 0.18, 0, 0.23, 0);
  if (!C.B) return;
  const col = rgb(0xf1f0ea);
  for (const s of [-1, 1]) F.box('lacquer', 0.03, 0.46, 0.36, s * 0.2, 0.23, 0, col);
  F.box('wood', 0.44, 0.025, 0.2, 0, 0.46, -0.08, rgb(0xd7b07c));
  F.box('wood', 0.44, 0.025, 0.18, 0, 0.23, 0.09, rgb(0xd7b07c));
}

function addBroom(C, { x, z, rotY = 0, lean = 0.22 }) {
  const F = frame(C, x, z, rotY);
  F.solid(0.15, 0.06, 0.04, 0, 0.06, 0);
  if (!C.B) return;
  F.box('paint', 0.3, 0.05, 0.06, 0, 0.1, 0, rgb(0xd34b3a));
  F.box('fabric', 0.29, 0.08, 0.05, 0, 0.04, 0, rgb(0xe2c48a));
  F.add('wood', rod(0, 0.12, 0, 0, 1.35, -lean, 0.012), rgb(0xd8b384));
}

// Papperskasse med grönsaker
function addGroceryBag(C, { x, z, rotY = 0, seed = 1 }) {
  const F = frame(C, x, z, rotY);
  F.solid(0.15, 0.17, 0.09, 0, 0.17, 0);
  if (!C.B) return;
  F.box('paint', 0.3, 0.34, 0.18, 0, 0.17, 0, rgb(0xc49a64));
  F.add('decal', atlasPlane(0.26, 0.3, cellUV('bag')).translate(0, 0.18, 0.091), [1, 1, 1]);
  const r = rng(seed);
  F.add('plant', rod(-0.06, 0.25, 0, -0.1, 0.62, -0.04, 0.025), rgb(0x9cc46a)); // purjolök
  F.add('plant', rod(-0.1, 0.62, -0.04, -0.13, 0.75, -0.05, 0.03), rgb(0x3f7a35));
  for (let k = 0; k < 3; k++) F.add('ceramic', new THREE.SphereGeometry(0.05, 10, 8).translate(0.05 + (r() - 0.5) * 0.08, 0.36, (r() - 0.5) * 0.06), rgb([0xd8362b, 0xf28c1a, 0xe9d24a][k]));
  F.add('paint', cyl(0.04, 0.04, 0.24, 0.07, 0.3, 0.02, 12), rgb(0xf4f4f4)); // mjölkpaket i grova drag
}

// Vältat flingpaket med flingor på golvet
function addCereal(C, { x, z, rotY = 0, seed = 3 }) {
  const F = frame(C, x, z, rotY);
  F.solid(0.15, 0.035, 0.2, 0, 0.035, 0);
  if (!C.B) return;
  F.box('paint', 0.3, 0.07, 0.4, 0, 0.035, 0, rgb(0xf2b51d));
  F.add('decal', atlasPlane(0.28, 0.38, cellUV('cereal')).rotateX(-Math.PI / 2).translate(0, 0.0705, 0), [1, 1, 1]);
  const r = rng(seed);
  for (let k = 0; k < 90; k++) {
    const a = (r() - 0.5) * 1.6, d = 0.22 + r() * 0.5;
    F.add('paint', new THREE.SphereGeometry(0.012, 5, 4).scale(1, 0.45, 1).translate(Math.sin(a) * d * 0.8, 0.006, 0.2 + Math.cos(a) * d * 0.6), rgb(0xd9a14a));
  }
}

// Bokstapel (liggande kokböcker)
function addBookStack(C, { x, z, rotY = 0, n = 5, seed = 1 }) {
  const F = frame(C, x, z, rotY);
  F.solid(0.14, n * 0.02, 0.11, 0, n * 0.02, 0);
  if (!C.B) return;
  const r = rng(seed);
  let y = 0;
  for (let k = 0; k < n; k++) {
    const t = 0.03 + r() * 0.02;
    F.box('lacquer', 0.27 + r() * 0.04, t, 0.21 + r() * 0.03, (r() - 0.5) * 0.03, y + t / 2, (r() - 0.5) * 0.03, rgb([0xb23a2e, 0x2f5d8a, 0xe0b23c, 0x3e7d4f, 0x7a3f6e][k % 5]));
    y += t;
  }
}

// ===========================================================================
// Banans egna ytor: skärbrädan och bakplåten på hoppet, bokstaplarna under
// ===========================================================================

function addJumpDress(C, track) {
  if (!C.B) return;
  const { pts, normals, N, roadHalf, isGap, dist } = track;
  const hw = roadHalf + 0.01;
  // Hitta glappet och de två ramperna
  let g0 = -1;
  for (let i = 0; i < N; i++) if (!isGap[i] && isGap[(i + 1) % N]) g0 = i;
  if (g0 < 0) return;
  const surf = (key, from, to, col, uvFn) => {
    for (let i = from; i !== to; i = (i + 1) % N) {
      const j = (i + 1) % N;
      if (isGap[i] || isGap[j]) continue;
      const a = pts[i], b = pts[j], na = normals[i], nb = normals[j];
      const ya = a.y + 0.008, yb = b.y + 0.008;
      const P = [
        [a.x + na.x * hw, ya, a.z + na.z * hw], [a.x - na.x * hw, ya, a.z - na.z * hw],
        [b.x - nb.x * hw, yb, b.z - nb.z * hw], [b.x + nb.x * hw, yb, b.z + nb.z * hw],
      ];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...P[0], ...P[1], ...P[2], ...P[0], ...P[2], ...P[3]], 3));
      const [u0, v0, u1, v1] = uvFn(i, j);
      g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1], 2));
      C.B.add(key, orient(g, [0, 1, 0]), col);
    }
  };
  // Upp: från där rampen börjar till kanten
  let r0 = g0;
  while (pts[(r0 - 1 + N) % N].y > 0.015) r0 = (r0 - 1 + N) % N;
  const [bu0, bv0, bu1, bv1] = cellUV('board');
  const L0 = dist[g0] - dist[r0];
  surf('overlay', r0, g0, [1, 1, 1], (i, j) => [bu0, bv0 + ((dist[i] - dist[r0]) / L0) * (bv1 - bv0), bu1, bv0 + ((dist[j] - dist[r0]) / L0) * (bv1 - bv0)]);
  // Ner: bakplåt i stål
  let g1 = (g0 + 1) % N;
  while (isGap[g1]) g1 = (g1 + 1) % N;
  let e1 = g1;
  while (pts[(e1 + 1) % N].y > 0.015) e1 = (e1 + 1) % N;
  surf('tray', g1, e1, rgb(0x6d7177), () => [0, 0, 1, 1]);
  // Bakplåtens kant och skärbrädans saftränna som tunna lister
  for (const s of [-1, 1]) {
    for (let i = g1; i !== e1; i = (i + 1) % N) {
      const a = pts[i], b = pts[(i + 1) % N], n = normals[i];
      C.B.add('steel', rod(a.x + n.x * hw * s, a.y + 0.02, a.z + n.z * hw * s, b.x + n.x * hw * s, b.y + 0.02, b.z + n.z * hw * s, 0.012, 6), rgb(0x8a8e94));
    }
  }
  // Sidorna: bokstaplar (horisontella ränder i fast höjd)
  const [su0, sv0, su1, sv1] = cellUV('bookstack');
  const sideRun = (from, to) => {
    for (let i = from; i !== to; i = (i + 1) % N) {
      const j = (i + 1) % N;
      if (isGap[i] || isGap[j]) continue;
      const a = pts[i], b = pts[j];
      if (a.y < 0.012 && b.y < 0.012) continue;
      for (const s of [-1, 1]) {
        const na = normals[i], nb = normals[j], o = hw + 0.004;
        const A = [a.x + na.x * o * s, a.z + na.z * o * s], Bp = [b.x + nb.x * o * s, b.z + nb.z * o * s];
        const vA = sv0 + (a.y / 0.5) * (sv1 - sv0), vB = sv0 + (b.y / 0.5) * (sv1 - sv0);
        const uA = su0 + ((dist[i] % 3) / 3) * (su1 - su0), uB = uA + ((dist[j] - dist[i]) / 3) * (su1 - su0);
        const g = new THREE.BufferGeometry();
        const pos = [A[0], 0, A[1], Bp[0], 0, Bp[1], Bp[0], b.y, Bp[1], A[0], 0, A[1], Bp[0], b.y, Bp[1], A[0], a.y, A[1]];
        const uv = [uA, sv0, uB, sv0, uB, vB, uA, sv0, uB, vB, uA, vA];
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        C.B.add('decal', orient(g, [na.x * s, 0, na.z * s]), [1, 1, 1]);
      }
    }
  };
  sideRun(r0, g0);
  sideRun(g1, e1);
  // Fronterna mot glappet
  for (const [i, dir] of [[g0, 1], [g1, -1]]) {
    const p = pts[i], t = track.tangents[i];
    const g = atlasPlane(hw * 2, p.y, [su0, sv0, su1, sv0 + (p.y / 0.5) * (sv1 - sv0)]);
    g.translate(0, p.y / 2, 0).rotateY(Math.atan2(t.x, t.z) + (dir > 0 ? 0 : Math.PI)).translate(p.x + t.x * 0.004 * dir, 0, p.z + t.z * 0.004 * dir);
    C.B.add('decal', g, [1, 1, 1]);
  }
}

// ===========================================================================
// Lösa saker: frukt, boll, mugg och servettrulle
// ===========================================================================

function looseBody(C, desc, col, mass, spawn, fr = 0.5, rest = 0.3, damp = 0.4) {
  if (!C.world) return null;
  const body = C.world.createRigidBody(C.RAPIER.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y, spawn.z)
    .setRotation(spawn.q || { x: 0, y: 0, z: 0, w: 1 }).setLinearDamping(0.3).setAngularDamping(damp).setCanSleep(true));
  C.world.createCollider(desc.setDensity(0).setMass(mass).setFriction(fr).setRestitution(rest).setCollisionGroups(groups(G.PROP)), body);
  return body;
}

function addFruit(C, { x, z, y0 = 0, kind = 'apple' }) {
  const r = kind === 'orange' ? 0.042 : 0.04;
  const spawn = { x, y: y0 + r + 0.006, z };
  const body = looseBody(C, C.world ? C.RAPIER.ColliderDesc.ball(r) : null, 0, 0.1, spawn, 0.6, 0.35, 0.8);
  let mesh = null;
  if (C.scene) {
    const geo = new THREE.SphereGeometry(r, 16, 12);
    if (kind === 'apple') geo.scale(1, 0.92, 1);
    mesh = new THREE.Mesh(geo, cached('fruit_' + kind, () => new THREE.MeshStandardMaterial({ color: kind === 'orange' ? 0xf28c1a : kind === 'green' ? 0x9ccc3c : 0xd8362b, roughness: kind === 'orange' ? 0.6 : 0.28 })));
    const stem = new THREE.Mesh(cached('stemGeo', () => new THREE.CylinderGeometry(0.003, 0.003, 0.02, 5).translate(0, 0.04, 0)), cached('stemMat', () => new THREE.MeshStandardMaterial({ color: 0x5a3d24 })));
    if (kind !== 'orange') mesh.add(stem);
    mesh.position.set(spawn.x, spawn.y, spawn.z);
    mesh.castShadow = mesh.receiveShadow = true;
    C.scene.add(mesh);
  }
  return { body, mesh, kind: 'ball', spawn };
}

function addToyBall(C, { x, z, y0 = 0, r = 0.11 }) {
  const spawn = { x, y: y0 + r + 0.006, z };
  const body = looseBody(C, C.world ? C.RAPIER.ColliderDesc.ball(r) : null, 0, 0.08, spawn, 0.6, 0.75, 0.4);
  let mesh = null;
  if (C.scene) {
    const tex = cached('ballTex', () => {
      const [c, ctx] = canvas(256, 128);
      const cols = ['#e53935', '#fdd835', '#1e88e5', '#43a047'];
      for (let i = 0; i < 8; i++) { ctx.fillStyle = cols[i % 4]; ctx.fillRect(i * 32, 0, 32, 128); }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 256, 14); ctx.fillRect(0, 114, 256, 14);
      return toTex(c, { repeat: false });
    });
    mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), cached('ballMat', () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 })));
    mesh.position.set(spawn.x, spawn.y, spawn.z);
    mesh.castShadow = mesh.receiveShadow = true;
    C.scene.add(mesh);
  }
  return { body, mesh, kind: 'ball', spawn };
}

// Liggande cylinder (pappersmugg, servettrulle)
function addRoll(C, { x, z, y0 = 0, rotY = 0, r = 0.04, len = 0.1, color = 0xffffff, mass = 0.03, cup = false }) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, Math.PI / 2, 'YXZ'));
  const spawn = { x, y: y0 + r + 0.006, z, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
  const body = looseBody(C, C.world ? C.RAPIER.ColliderDesc.cylinder(len / 2, r) : null, 0, mass, spawn, 0.5, 0.2, 1.0);
  let mesh = null;
  if (C.scene) {
    const geo = cup ? new THREE.CylinderGeometry(r, r * 0.72, len, 18, 1, true) : new THREE.CylinderGeometry(r, r, len, 18);
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.75, side: cup ? THREE.DoubleSide : THREE.FrontSide }));
    if (cup) {
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(r * 0.72, 16).rotateX(Math.PI / 2).translate(0, -len / 2, 0), mesh.material);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r * 0.86, len * 0.3, 18, 1, true).translate(0, len * 0.05, 0), new THREE.MeshStandardMaterial({ color: 0xe53935, roughness: 0.7, side: THREE.DoubleSide }));
      mesh.add(bottom, band);
    }
    mesh.position.set(spawn.x, spawn.y, spawn.z);
    mesh.quaternion.copy(q);
    mesh.castShadow = mesh.receiveShadow = true;
    C.scene.add(mesh);
  }
  return { body, mesh, kind: 'can', spawn };
}

// ===========================================================================
// Hela köket
// ===========================================================================

export function buildKitchen({ scene, world, RAPIER, track, K }) {
  const C = kctx(scene, world, RAPIER);
  const R = K.ROOM;
  const { NZ, SZ, EX, WX, BAR, DX, SN, SX, ISL } = K;
  const PI = Math.PI;

  addFloors(C, R, [R.x0, 1.0, R.z0, 6.6]);
  addRoom(C, R);

  // --- norra väggen: bänkskåp, diskho under fönstret, spis med fläkt -------
  const D = 'doors', DR = 'drawers';
  addCounterRun(C, {
    x: -14.1, z: R.z0,
    segs: [
      { w: 0.6, kind: 'corner' }, { w: 0.8, kind: D }, { w: 0.6, kind: DR }, { w: 0.8, kind: D }, { w: 0.6, kind: DR },
      { w: 1.0, kind: 'sink' }, { w: 0.6, kind: 'dish' }, { w: 0.8, kind: D }, { w: 0.6, kind: DR },
      { w: 0.6, kind: DR }, { w: 0.6, kind: 'stove' }, { w: 0.6, kind: DR }, { w: 0.8, kind: D }, { w: 0.6, kind: DR },
      { w: 0.8, kind: D }, { w: 0.6, kind: DR }, { w: 0.8, kind: D },
    ],
    skipUpper: [5, 6],
  });
  // Västra väggen: bänk med mikro och kaffe (fortsättning på L:et)
  addCounterRun(C, {
    x: R.x0, z: -9.9, rotY: PI / 2,
    segs: [{ w: 0.8, kind: D }, { w: 0.6, kind: DR }, { w: 0.8, kind: D }, { w: 0.6, kind: DR }, { w: 0.8, kind: D }, { w: 0.6, kind: DR }, { w: 0.8, kind: D }, { w: 0.6, kind: DR }, { w: 0.8, kind: D }, { w: 0.6, kind: DR }],
    skipUpper: [3, 4, 5],
  });
  // Högskåp och kyl efter bänkraden
  addTallUnit(C, { x: -7.9, z: R.z0, kind: 'oven' });
  addTallUnit(C, { x: -7.3, z: R.z0, kind: 'pantry' });
  addTallUnit(C, { x: -6.63, z: R.z0, w: 0.72, kind: 'fridge' });
  addWindow(C, { x: -16.1, z: R.z0, w: 1.6, h: 1.1, sill: 1.05, mullions: 1 });
  addWindow(C, { x: R.x0, z: -9.6, rotY: PI / 2, w: 1.2, h: 1.0, sill: 1.1, mullions: 1 });

  addCounterClutter(C, {
    x: -14.1, z: R.z0,
    items: [
      { kind: 'jars', at: -5.0, d: 0.18 }, { kind: 'bread', at: -4.3 }, { kind: 'board', at: -3.5 }, { kind: 'knives', at: -3.0, d: 0.15 },
      { kind: 'rack', at: -1.2 }, { kind: 'plant', at: -0.4, d: 0.12, seed: 2 }, { kind: 'bottles', at: 0.4, d: 0.16 },
      { kind: 'kettle', at: 2.2 }, { kind: 'bowl', at: 3.2, seed: 4 }, { kind: 'toaster', at: 4.2 }, { kind: 'jars', at: 5.0, d: 0.16 },
    ],
  });
  addCounterClutter(C, { x: R.x0, z: -9.9, rotY: PI / 2, items: [{ kind: 'micro', at: -1.4, d: 0.3 }, { kind: 'coffee', at: 0.6 }, { kind: 'plant', at: 2.4, seed: 8 }, { kind: 'board', at: -2.9 }] });

  // --- norra väggens matsalsdel: fönster, element, bokhylla med kokböcker ---
  for (const wx of [2.2, 10.8]) {
    addWindow(C, { x: wx, z: R.z0, w: 2.2, h: 1.45, sill: 0.85, mullions: 2, curtains: true });
    addRadiator(C, { x: wx, z: R.z0, w: 1.8 });
  }
  addBookshelf(C, { x: 6.5, z: R.z0, w: 1.8, h: 1.9 });
  addFrame(C, { x: 15.0, y: 1.55, z: R.z0, w: 0.6, h: 0.75, art: 'art2' });
  addFrame(C, { x: 16.2, y: 1.4, z: R.z0, w: 0.45, h: 0.55, art: 'art3' });
  addFrame(C, { x: -1.6, y: 1.6, z: R.z0, w: 0.5, h: 0.62, art: 'art1' });
  if (C.B) C.B.add('decal', place(atlasPlane(0.34, 0.34, cellUV('wallclock')).translate(0, 1.95, 0.02), -2.8, 0, R.z0, 0), [1, 1, 1]);
  // Hoppet: kokböcker utdragna ur hyllan, trappstegen bredvid kanten
  addStepStool(C, { x: K.jump.lip + 0.3, z: NZ + track.roadHalf + 0.62, rotY: 0.2 });
  addBookStack(C, { x: K.jump.lip - 1.2, z: NZ + track.roadHalf + 0.4, rotY: 0.4, n: 6, seed: 2 });
  addBookStack(C, { x: K.jump.lip + 1.4, z: NZ + track.roadHalf + 0.45, rotY: -0.3, n: 3, seed: 5 });
  if (C.B) C.B.add('wood', place(box(0.42, 0.02, 0.3, 0, 0, 0).rotateX(-1.05).translate(0, 0.16, 0.06), K.jump.lip + 0.3, 0, NZ + track.roadHalf + 0.88, 0.2), rgb(0xd8b07a));
  addJumpDress(C, track);

  // --- östra väggen: dörr ut mot hallen, tavla ---------------------------
  if (C.B) {
    const F = frame(C, R.x1, -9.0, -PI / 2);
    F.box('lacquer', 1.0, 2.1, 0.04, 0, 1.05, 0.02, rgb(0xf3f1ec));
    F.box('lacquer', 1.16, 0.08, 0.06, 0, 2.14, 0.03, rgb(0xf6f4ef));
    for (const s of [-1, 1]) F.box('lacquer', 0.08, 2.1, 0.06, s * 0.54, 1.05, 0.03, rgb(0xf6f4ef));
    F.box('brass', 0.14, 0.025, 0.05, -0.36, 1.02, 0.06, rgb(BRASSC));
    F.box('lacquer', 0.8, 0.8, 0.012, 0, 1.45, 0.045, rgb(0xeae7e0));
    F.box('lacquer', 0.8, 0.7, 0.012, 0, 0.55, 0.045, rgb(0xeae7e0));
  }
  addFrame(C, { x: R.x1, y: 1.5, z: 6.2, rotY: -PI / 2, w: 0.9, h: 0.7, art: 'art2' });
  addWindow(C, { x: R.x1, z: 9.8, rotY: -PI / 2, w: 1.6, h: 1.4, sill: 0.85, mullions: 1, curtains: true });

  // --- frukostbaren vid östra mittgången: barbord och tre barstolar --------
  {
    const bx = 10.5, bz = BAR - track.roadHalf - 2.0;
    const F = frame(C, bx, bz, 0);
    F.solid(1.3, 0.02, 0.32, 0, 1.03, 0);
    for (const s of [-1, 1]) F.solid(0.03, 0.5, 0.25, s * 1.15, 0.5, 0);
    if (C.B) {
      F.box('wood', 2.6, 0.04, 0.64, 0, 1.03, 0, rgb(0xe8c99c));
      for (const s of [-1, 1]) {
        F.box('steel', 0.04, 1.01, 0.04, s * 1.15, 0.505, 0, rgb(0x2b2d31));
        F.box('steel', 0.06, 0.02, 0.5, s * 1.15, 0.01, 0, rgb(0x2b2d31));
        F.box('steel', 0.04, 0.03, 0.5, s * 1.15, 0.99, 0, rgb(0x2b2d31));
      }
      F.box('steel', 2.3, 0.03, 0.03, 0, 0.3, 0, rgb(0x2b2d31));
    }
    addCounterClutter(C, { x: bx, z: bz, rotY: 0, items: [{ kind: 'bowl', at: -0.6, d: 0, seed: 9 }, { kind: 'coffee', at: 0.7, d: 0.0 }] });
    for (const k of [-0.8, 0, 0.8]) addStool(C, { x: bx + k, z: BAR - track.roadHalf - 0.62 - (k === 0 ? 0 : 0.12), seat: 0.76, rotY: k * 0.3 });
    addPendant(C, { x: bx - 0.7, z: bz, y: 1.75, color: 0xc49a5a, r: 0.14 });
    addPendant(C, { x: bx + 0.7, z: bz, y: 1.75, color: 0xc49a5a, r: 0.14 });
  }
  addPlant(C, { x: 15.6, z: -6.2, size: 1.2, seed: 4 });
  addDogBed(C, { x: 7.0, z: -7.4, rotY: 0.3 });
  addGroceryBag(C, { x: 13.4, z: -8.6, rotY: -0.4, seed: 2 });
  addGroceryBag(C, { x: 13.8, z: -8.2, rotY: 0.6, seed: 5 });

  // --- matsalen: bordet över gången, stolar dragna ut, mattan --------------
  const T = K.table;
  addTable(C, { x: T.x, z: T.z, len: T.len, depth: T.depth, h: T.h });
  const legOut = T.len / 2 - 0.08; // 1,62 m
  // Gavelstolar
  addChair(C, { x: T.x - T.len / 2 - 0.42, z: T.z + 0.05, rotY: PI / 2 + 0.08 });
  addChair(C, { x: T.x + T.len / 2 + 0.42, z: T.z - 0.06, rotY: -PI / 2 - 0.1, color: 0x2b2b2b, paint: true });
  // Utdragna stolar på båda sidor om gången (benen blir porten in under bordet)
  addChair(C, { x: T.x - legOut - 0.36, z: T.z - T.depth / 2 - 0.5, rotY: PI + 0.35 });
  addChair(C, { x: T.x + legOut + 0.38, z: T.z - T.depth / 2 - 0.55, rotY: PI - 0.4, color: 0x2b2b2b, paint: true });
  addChair(C, { x: T.x - legOut - 0.38, z: T.z + T.depth / 2 + 0.55, rotY: 0.4, color: 0x2b2b2b, paint: true });
  addChair(C, { x: T.x + legOut + 0.36, z: T.z + T.depth / 2 + 0.5, rotY: -0.3 });
  for (const k of [-1.1, 0, 1.1]) addPendant(C, { x: T.x + k, z: T.z, y: 1.55, color: 0x3d4a45, r: 0.2 });
  // Barnstol vid bordets västra hörn
  {
    const F = frame(C, T.x - legOut - 1.25, T.z + 0.9, 0.5);
    F.solid(0.22, 0.4, 0.22, 0, 0.4, 0);
    if (C.B) {
      const w = rgb(0xf3f1ec);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.add('lacquer', rod(sx * 0.15, 0.55, sz * 0.13, sx * 0.24, 0, sz * 0.22, 0.016), w);
      F.box('lacquer', 0.34, 0.03, 0.32, 0, 0.56, 0, w);
      F.box('lacquer', 0.34, 0.32, 0.03, 0, 0.73, -0.15, w);
      F.box('wood', 0.4, 0.025, 0.2, 0, 0.78, 0.2, rgb(0xd7b07c));
    }
  }

  // Mattan under bordet (lite lägre grepp än parketten)
  const rug = { x: T.x, z: T.z, w: 4.8, d: 3.4 };
  if (C.world) {
    const col = solid(C, rug.w / 2, 0.003, rug.d / 2, rug.x, 0.003, rug.z, 0, 0.9);
    world.__surfaces ||= new Map();
    world.__surfaces.set(col.handle, { grip: 0.88 });
  }
  if (C.scene) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(rug.w, rug.d).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.96, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -2 })
    );
    m.position.set(rug.x, 0.0075, rug.z);
    m.receiveShadow = true;
    scene.add(m);
  }

  // --- vardagsrummet i sydost: soffa, tv, fåtölj, bokhylla ---------------
  addSofa(C, { x: 13.2, z: 8.9, rotY: PI });
  addCoffeeTable(C, { x: 13.2, z: 6.9 });
  addTvBench(C, { x: 13.2, z: 3.0, rotY: 0 });
  addArmchair(C, { x: 17.2, z: 6.4, rotY: -PI / 2 - 0.3 });
  addBookshelf(C, { x: R.x1, z: 2.6, rotY: -PI / 2, w: 1.6, h: 2.0 });
  addPlant(C, { x: 18.9, z: 12.9, size: 1.35, seed: 9, pot: 0x6f7f6a });
  addPlant(C, { x: 8.6, z: 2.2, size: 0.9, seed: 12 });
  {
    // Golvlampa
    const F = frame(C, 18.6, 8.6, 0);
    F.solid(0.14, 0.02, 0.14, 0, 0.02, 0);
    F.solid(0.02, 0.8, 0.02, 0, 0.8, 0);
    if (C.B) {
      F.add('black', cyl(0.14, 0.15, 0.03, 0, 0, 0, 18), rgb(0x1e1e1e));
      F.add('black', rod(0, 0.03, 0, 0, 1.5, 0, 0.012), rgb(0x1e1e1e));
      F.add('fabric', lathe([[0.12, 0], [0.18, 0], [0.13, 0.26], [0.09, 0.26]], 0, 1.42, 0, 20), rgb(0xf1e6cf));
      F.add('lit', new THREE.SphereGeometry(0.04, 10, 8).translate(0, 1.5, 0), [2, 1.8, 1.4]);
    }
  }
  if (C.scene) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 2.6).rotateX(-Math.PI / 2),
      cached('livingRug', () => new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -2 }))
    );
    m.position.set(13.2, 0.0075, 6.6);
    m.receiveShadow = true;
    scene.add(m);
  }

  // --- södra väggen: altandörrar, fönster, husdjurshörnan -------------------
  addWindow(C, { x: -13.0, z: R.z1, rotY: PI, w: 1.0, h: 2.1, sill: 0.02, mullions: 0, door: true });
  addWindow(C, { x: -11.8, z: R.z1, rotY: PI, w: 1.0, h: 2.1, sill: 0.02, mullions: 0, door: true, curtains: true });
  addWindow(C, { x: -4.0, z: R.z1, rotY: PI, w: 1.8, h: 1.4, sill: 0.85, mullions: 1, curtains: true });
  addWindow(C, { x: 6.0, z: R.z1, rotY: PI, w: 1.8, h: 1.4, sill: 0.85, mullions: 1, curtains: true });
  addRadiator(C, { x: -4.0, z: R.z1, rotY: PI, w: 1.4 });
  addRadiator(C, { x: 6.0, z: R.z1, rotY: PI, w: 1.4 });
  addFrame(C, { x: 1.0, y: 1.5, z: R.z1, rotY: PI, w: 0.7, h: 0.9, art: 'art1' });
  addSunPatch(C, { x0: -14.0, x1: -10.8, z0: 8.6, z1: R.z1, skew: 1.4 });
  addSunPatch(C, { x0: -5.0, x1: -3.0, z0: 10.2, z1: R.z1 - 0.3, skew: 0.8 });
  addSunPatch(C, { x0: 5.0, x1: 7.0, z0: 10.2, z1: R.z1 - 0.3, skew: 0.8 });
  const spill = K.spill;
  addBowls(C, { x: (spill.x0 + spill.x1) / 2 + 0.6, z: R.z1 - 0.45, rotY: PI });
  addPlant(C, { x: R.x0 + 0.55, z: R.z1 - 0.55, size: 1.25, seed: 6 });
  addBench(C, { x: -16.0, z: R.z1 - 0.3, len: 1.4 });

  // Vattenpölen från vattenskålen: halt golv rakt över vägen
  {
    const len = spill.x1 - spill.x0, cx = (spill.x0 + spill.x1) / 2;
    if (C.world) {
      const col = solid(C, len / 2, 0.003, track.roadHalf - 0.05, cx, 0.003, SZ, 0, 0.3);
      world.__surfaces ||= new Map();
      world.__surfaces.set(col.handle, { grip: 0.55 });
    }
    if (C.B) {
      const shape = new THREE.Shape();
      const r = rng(77);
      const n = 26;
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const rr = 1 + (r() - 0.5) * 0.25;
        const px = Math.cos(a) * (len / 2) * rr, pz = Math.sin(a) * (track.roadHalf + 0.25) * rr;
        if (k === 0) shape.moveTo(px, pz); else shape.lineTo(px, pz);
      }
      const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(cx, 0.0085, SZ + 0.15);
      C.B.add('water', g, rgb(0xcfe6f5));
      // Strimma från skålen
      C.B.add('water', new THREE.PlaneGeometry(0.35, 1.4).rotateX(-Math.PI / 2).translate(cx + 0.5, 0.0085, R.z1 - 1.0), rgb(0xcfe6f5));
    }
  }

  // --- västra väggens södra del: skänk med kaffehörna, tavlor --------------
  {
    const F = frame(C, R.x0, 0.0, PI / 2);
    F.solid(0.9, 0.4, 0.23, 0, 0.4, 0.23);
    if (C.B) {
      F.box('lacquer', 1.8, 0.7, 0.45, 0, 0.45, 0.225, rgb(SAGE));
      F.box('wood', 1.84, 0.03, 0.47, 0, 0.815, 0.235, rgb(OAK));
      for (const s of [-1, 1]) for (const zz of [0.05, 0.4]) F.add('wood', cyl(0.02, 0.016, 0.1, s * 0.82, 0, zz, 8), rgb(0x6b4a2f));
      for (const k of [-0.45, 0.45]) F.box('brass', 0.012, 0.12, 0.02, k + 0.38 * Math.sign(-k), 0.55, 0.46, rgb(BRASSC));
    }
    addCounterClutter(C, { x: R.x0, z: 0, rotY: PI / 2, items: [{ kind: 'plant', at: -0.6, d: 0.22, seed: 14 }, { kind: 'bowl', at: 0.4, d: 0.22, seed: 15 }] });
    addFrame(C, { x: R.x0, y: 1.5, z: -0.5, rotY: PI / 2, w: 0.7, h: 0.9, art: 'art3' });
    addFrame(C, { x: R.x0, y: 1.45, z: 0.6, rotY: PI / 2, w: 0.5, h: 0.6, art: 'art1' });
  }
  addWindow(C, { x: R.x0, z: 8.5, rotY: PI / 2, w: 1.6, h: 1.4, sill: 0.85, mullions: 1, curtains: true });
  addRadiator(C, { x: R.x0, z: 8.5, rotY: PI / 2, w: 1.4 });

  // --- köksön i fickan mellan gångarna, med barstolar ----------------------
  const IX = (WX + SX) / 2 + 0.6, IZ = 0;
  addIsland(C, { x: IX, z: IZ - 0.1, rotY: 0, len: 3.2 });
  for (const k of [-1.0, 0, 1.0]) addStool(C, { x: IX + k, z: IZ + 1.25 + (k === 0 ? 0.45 : 0), rotY: k * 0.5 });
  addCounterClutter(C, { x: IX, z: IZ - 0.1, rotY: 0, items: [{ kind: 'bowl', at: 0.8, d: 0.0, seed: 21 }, { kind: 'board', at: -0.5, d: 0.05 }, { kind: 'plant', at: -1.2, d: -0.1, seed: 22 }] });
  for (const k of [-0.9, 0, 0.9]) addPendant(C, { x: IX + k, z: IZ - 0.05, y: 1.7, color: 0xe9e3d6, r: 0.13 });

  // --- golvet i kökets mitt och mittfältet -----------------------------------
  addBroom(C, { x: -5.85, z: R.z0 + 0.72, rotY: 0, lean: 0.12 });
  addCereal(C, { x: -9.4, z: -6.9, rotY: 0.7 });
  addGroceryBag(C, { x: -3.0, z: -8.3, rotY: 0.3, seed: 7 });
  addGroceryBag(C, { x: -2.6, z: -8.6, rotY: -0.5, seed: 8 });
  addPlant(C, { x: -1.0, z: -6.0, size: 1.3, seed: 3 });
  addBench(C, { x: -1.0, z: 7.5, rotY: PI / 2, len: 1.5 });
  addDogBed(C, { x: -1.2, z: 1.3, rotY: -0.4 });
  addPlant(C, { x: -16.8, z: -1.6, size: 0.8, seed: 17 });

  // Öppen hylla som rumsavdelare mellan köket och mittfältet
  {
    const F = frame(C, -1.2, -7.6, PI / 2);
    const w = 2.8, h = 1.5, d = 0.4;
    F.solid(w / 2, h / 2, d / 2, 0, h / 2, 0);
    if (C.B) {
      const col = rgb(0xf3efe6);
      for (let k = 0; k <= 4; k++) F.box('lacquer', 0.025, h, d, -w / 2 + k * (w / 4), h / 2, 0, col);
      for (let k = 0; k <= 4; k++) F.box('lacquer', w, 0.025, d, 0, 0.04 + k * ((h - 0.06) / 4), 0, col);
      const r = rng(31);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const cx = -w / 2 + (i + 0.5) * (w / 4), cy = 0.055 + j * ((h - 0.06) / 4);
        const kind = r();
        if (kind < 0.35) F.add('fabric', box(0.6, 0.3, 0.34, cx, cy + 0.15, 0), rgb([0xc9b58f, 0x9fb3a0, 0xd9a07a][j % 3]));
        else if (kind < 0.7) for (const s of [-1, 1]) F.add('decal', atlasPlane(0.62, 0.3, cellUV('spines')).rotateY(s < 0 ? Math.PI : 0).translate(cx, cy + 0.16, s * 0.16), [1, 1, 1]);
        else F.add('ceramic', lathe([[0, 0], [0.08, 0], [0.12, 0.12], [0.06, 0.26], [0.04, 0.3]], cx, cy, 0, 16), rgb([0x2f4660, 0xd9643e, 0xe8e2d6][i % 3]));
      }
    }
  }
  // Barnhörna i mittfältet: litet bord med två pallar, leksakslåda
  {
    const F = frame(C, -1.0, 4.6, 0.2);
    F.solid(0.35, 0.25, 0.3, 0, 0.25, 0);
    if (C.B) {
      F.box('lacquer', 0.7, 0.03, 0.6, 0, 0.5, 0, rgb(0xf3efe6));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.add('wood', cyl(0.02, 0.02, 0.485, sx * 0.3, 0, sz * 0.25, 8), rgb(0xd7b07c));
      F.add('decal', atlasPlane(0.24, 0.24, cellUV('drawing')).rotateX(-Math.PI / 2).translate(0.1, 0.517, 0), [1, 1, 1]);
    }
    for (const [lx, lz, col] of [[-0.6, 0.1, 0xe8b64a], [0.6, -0.1, 0x7fae8c]]) {
      const [wx, wz] = F.at(lx, lz);
      const G2 = frame(C, wx, wz, 0.3);
      G2.solid(0.15, 0.15, 0.15, 0, 0.15, 0);
      if (C.B) {
        G2.add('lacquer', cyl(0.15, 0.15, 0.03, 0, 0.27, 0, 18), rgb(col));
        for (let k = 0; k < 3; k++) { const a = k * 2.1; G2.add('wood', cyl(0.015, 0.015, 0.27, Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1, 6), rgb(0xd7b07c)); }
      }
    }
    const T2 = frame(C, 0.8, -2.0, -0.3);
    T2.solid(0.35, 0.22, 0.25, 0, 0.22, 0);
    if (C.B) {
      T2.box('lacquer', 0.7, 0.44, 0.5, 0, 0.22, 0, rgb(0xd9643e));
      T2.box('lacquer', 0.72, 0.04, 0.52, 0, 0.46, -0.02, rgb(0xe8b64a));
      for (let k = 0; k < 4; k++) T2.add('lacquer', box(0.09, 0.09, 0.09, -0.5 + k * 0.12, 0.045, 0.4 + (k % 2) * 0.1).rotateY(k), rgb([0xe53935, 0x1e88e5, 0xfdd835, 0x43a047][k]));
    }
    const L2 = frame(C, -2.6, -3.2, 0);
    L2.solid(0.22, 0.2, 0.22, 0, 0.2, 0);
    if (C.B) {
      L2.add('fabric', lathe([[0, 0], [0.2, 0], [0.23, 0.4], [0.21, 0.4], [0.18, 0.02], [0, 0.02]], 0, 0, 0, 18), rgb(0xd9cdb8));
      L2.add('fabric', new THREE.SphereGeometry(0.2, 10, 6).scale(1, 0.3, 1).translate(0, 0.4, 0), rgb(0x9fb3c9));
    }
  }

  C.B?.flush(C.scene);

  // --- lösa saker vid vägkanten ----------------------------------------------
  const loose = [];
  const edge = (px, pz, side, inset = 0.35) => {
    const i = track.nearest(px, pz).index;
    return track.poseAt(i, side * (track.roadHalf - inset));
  };
  const fruit = [['apple', 6, NZ, -1], ['orange', -13.0, SN, 1], ['green', -12.6, SN, 1], ['orange', 12.6, BAR, 1]];
  for (const [kind, px, pz, side] of fruit) { const p = edge(px, pz, side); loose.push(addFruit(C, { x: p.x, z: p.z, y0: p.y, kind })); }
  { const p = edge(-14.5, ISL, -1, 0.3); loose.push(addToyBall(C, { x: p.x, z: p.z, y0: p.y })); }
  { const p = edge(-2.5, SZ, -1, 0.3); loose.push(addRoll(C, { x: p.x, z: p.z, y0: p.y, rotY: 0.6, r: 0.04, len: 0.1, color: 0xf6f3ea, cup: true })); }
  { const p = edge(EX, -6.5, 1, 0.3); loose.push(addRoll(C, { x: p.x, z: p.z, y0: p.y, rotY: 1.2, r: 0.025, len: 0.22, color: 0xe9e0cf })); }
  void ISL;
  return loose.filter((p) => p && p.body);
}
