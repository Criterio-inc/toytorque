import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G, groups } from '../core/physics.js';
import { rng } from './warehouseArt.js';
import { barrierSegments, barrierCenter, edge3, bankY } from '../track/track.js';

export { rng };

// ---------------------------------------------------------------------------
// Procedurell grafik för kvarteret: gräsmattor, asfalt med målade linjer,
// trottoarer, tvåvåningsvillor med sadeltak, verandor och garage, staket,
// häckar, lövträd, gatlyktor, brevlådor, brandpost, soptunnor, fullstora
// bilar, basketkorg, lekplats och en molnig horisont. Allt ritas i canvas.
//
// Statisk grafik samlas i en HoodBatch (en sammanslagen mesh per material).
// Funktionerna tar (batch, world, RAPIER, opts): utan batch byggs bara
// fysiken (inget document rörs), utan world bara grafiken.
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

const yQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

function fixedBody(world, RAPIER, x = 0, z = 0, rot = 0) {
  return world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, z).setRotation(yQuat(rot)));
}
// Låda i kroppens lokala ram (rotY runt egen mittpunkt)
function boxCollider(world, RAPIER, body, hx, hy, hz, x, y, z, rotY = 0, friction = 0.6) {
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(yQuat(rotY))
      .setFriction(friction).setRestitution(0.1).setCollisionGroups(groups(G.WORLD)),
    body
  );
}
function cylCollider(world, RAPIER, body, r, h, x, z) {
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(x, h / 2, z).setFriction(0.5).setRestitution(0.1).setCollisionGroups(groups(G.WORLD)),
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

// ===========================================================================
// Texturer
// ===========================================================================

export const GRASS_TILE = 3;
function grassTexture() {
  return cached('grassTex', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [92, 142, 58], { cells: 4, oct: 6, amt: 0.3, grain: 14, seed: 301 });
    const r = rng(302);
    // Grässtrån i ljusa och mörka toner
    for (let i = 0; i < 9000; i++) {
      const x = r() * S, y = r() * S, l = 3 + r() * 6, a = -Math.PI / 2 + (r() - 0.5) * 0.9;
      const light = r() < 0.5;
      ctx.strokeStyle = light ? `rgba(${150 + r() * 50},${190 + r() * 40},${80 + r() * 30},0.5)` : `rgba(${40 + r() * 20},${80 + r() * 25},${25 + r() * 15},0.45)`;
      ctx.lineWidth = 1 + r() * 0.8;
      wrapDraw(S, S, x, y, l, (px, py) => {
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke();
      });
    }
    // Klöver och små torrfläckar
    for (let i = 0; i < 60; i++) {
      const x = r() * S, y = r() * S, rad = 3 + r() * 9;
      wrapDraw(S, S, x, y, rad, (px, py) => {
        ctx.fillStyle = r() < 0.6 ? 'rgba(70,120,45,0.35)' : 'rgba(170,160,90,0.18)';
        ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.fill();
      });
    }
    return toTex(c);
  });
}

const ASPHALT_TILE = 5;
function asphaltTexture() {
  return cached('asphaltTex', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [86, 87, 90], { cells: 3, oct: 6, amt: 0.22, grain: 26, seed: 311 });
    const r = rng(312);
    // Ballast: ljusa och mörka korn
    for (let i = 0; i < 5000; i++) {
      const x = r() * S, y = r() * S, s = 0.6 + r() * 1.4;
      ctx.fillStyle = r() < 0.5 ? `rgba(200,198,190,${0.15 + r() * 0.25})` : `rgba(20,20,22,${0.2 + r() * 0.3})`;
      ctx.fillRect(x, y, s, s);
    }
    // Lagningar och oljefläckar
    for (let i = 0; i < 5; i++) {
      const x = r() * S, y = r() * S, w = 30 + r() * 80, h = 20 + r() * 50;
      wrapDraw(S, S, x, y, Math.max(w, h), (px, py) => {
        ctx.fillStyle = 'rgba(40,40,44,0.22)';
        ctx.fillRect(px, py, w, h);
      });
    }
    for (let i = 0; i < 6; i++) {
      const x = r() * S, y = r() * S, rad = 8 + r() * 22;
      wrapDraw(S, S, x, y, rad, (px, py) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, 'rgba(25,25,28,0.3)'); g.addColorStop(1, 'rgba(25,25,28,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.fill();
      });
    }
    // Tunna sprickor
    ctx.strokeStyle = 'rgba(25,25,28,0.55)';
    for (let i = 0; i < 8; i++) {
      let x = r() * S, y = r() * S;
      ctx.lineWidth = 0.8 + r();
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    return toTex(c);
  });
}

// Betongplattor med fogar: en platta per textur
function concreteTexture() {
  return cached('concreteTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [184, 181, 173], { cells: 3, oct: 5, amt: 0.16, grain: 12, seed: 321 });
    const r = rng(322);
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(120,115,105,0.25)' : 'rgba(255,255,250,0.25)';
      ctx.fillRect(r() * S, r() * S, 1, 1);
    }
    ctx.fillStyle = 'rgba(90,86,80,0.7)';
    ctx.fillRect(0, 0, S, 2); ctx.fillRect(0, 0, 2, S);
    ctx.fillStyle = 'rgba(255,255,250,0.3)';
    ctx.fillRect(0, 2, S, 1); ctx.fillRect(2, 0, 1, S);
    return toTex(c);
  });
}

function paversTexture() {
  return cached('paversTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#7b6a5a';
    ctx.fillRect(0, 0, S, S);
    const r = rng(331);
    const bw = 64, bh = 32;
    for (let row = 0; row < S / bh; row++) {
      const off = (row % 2) * bw / 2;
      for (let k = -1; k < S / bw + 1; k++) {
        const x = k * bw + off, y = row * bh;
        const t = 0.82 + r() * 0.3;
        ctx.fillStyle = `rgb(${158 * t},${86 * t},${62 * t})`;
        ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        ctx.fillStyle = 'rgba(255,230,210,0.12)';
        ctx.fillRect(x + 2, y + 2, bw - 4, 3);
      }
    }
    return toTex(c);
  });
}

function plywoodTexture() {
  return cached('plyTex', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    const n = valueNoise(S, S, 2, 5, rng(341));
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const ring = Math.sin((x * 0.02 + n[i] * 9) * Math.PI) * 0.05;
      const k = 0.9 + n[i] * 0.15 + ring;
      img.data[i * 4] = 196 * k; img.data[i * 4 + 1] = 150 * k; img.data[i * 4 + 2] = 98 * k; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Skivskarvar och skruvrader
    ctx.fillStyle = 'rgba(70,45,25,0.7)';
    ctx.fillRect(0, 0, S, 3); ctx.fillRect(0, S / 2, S, 3); ctx.fillRect(0, 0, 3, S);
    ctx.fillStyle = 'rgba(60,55,50,0.8)';
    for (let x = 16; x < S; x += 40) for (const y of [10, S / 2 - 8, S / 2 + 12, S - 8]) { ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill(); }
    // Skosulor
    const r = rng(342);
    for (let i = 0; i < 25; i++) {
      ctx.strokeStyle = `rgba(40,30,25,${0.05 + r() * 0.12})`;
      ctx.lineWidth = 2 + r() * 6;
      const x = r() * S, y = r() * S;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 40, y + 30 + r() * 80); ctx.stroke();
    }
    return toTex(c);
  });
}

// Liggande panel (lockpanel): ljus bas som tonas med vertexfärg
function sidingTexture() {
  return cached('sidingTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [238, 236, 230], { cells: 2, oct: 4, amt: 0.06, grain: 6, seed: 351 });
    const boards = 10, bh = S / boards;
    for (let b = 0; b < boards; b++) {
      const y = b * bh;
      const g = ctx.createLinearGradient(0, y, 0, y + bh);
      g.addColorStop(0, 'rgba(255,255,255,0.18)');
      g.addColorStop(0.75, 'rgba(0,0,0,0)');
      g.addColorStop(0.92, 'rgba(40,40,40,0.18)');
      g.addColorStop(1, 'rgba(30,30,30,0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, S, bh);
    }
    return toTex(c);
  });
}

function shingleTexture() {
  return cached('shingleTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#6a6a6a';
    ctx.fillRect(0, 0, S, S);
    const r = rng(361);
    const rows = 12, rh = S / rows, tw = S / 8;
    for (let row = 0; row < rows; row++) {
      const off = (row % 2) * tw / 2;
      for (let k = -1; k < 9; k++) {
        const t = 0.75 + r() * 0.4;
        const v = Math.round(200 * t);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(k * tw + off + 1, row * rh, tw - 2, rh - 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(k * tw + off + 1, row * rh + rh - 4, tw - 2, 2);
      }
    }
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(r() * S, r() * S, 1.2, 1.2);
    }
    return toTex(c);
  });
}

function brickTexture() {
  return cached('brickTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#cfc6b8';
    ctx.fillRect(0, 0, S, S);
    const r = rng(371);
    const bw = 64, bh = 20;
    for (let row = 0; row < Math.ceil(S / bh); row++) {
      const off = (row % 2) * bw / 2;
      for (let k = -1; k < 5; k++) {
        const t = 0.8 + r() * 0.35;
        ctx.fillStyle = `rgb(${172 * t},${78 * t},${58 * t})`;
        ctx.fillRect(k * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
      }
    }
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,230,200,0.15)';
      ctx.fillRect(r() * S, r() * S, 1.5, 1.5);
    }
    return toTex(c);
  });
}

// Fönsteratlas 2×2: vit karm, spröjs, himmelsreflex och gardiner
function windowTexture() {
  return cached('windowTex', () => {
    const S = 512, H = 256;
    const [c, ctx] = canvas(S);
    const r = rng(381);
    const curtains = ['#f3e6c8', '#c9dbe8', '#e8c9c9', null];
    for (let v = 0; v < 4; v++) {
      const x0 = (v % 2) * H, y0 = Math.floor(v / 2) * H;
      ctx.fillStyle = '#f4f2ec';
      ctx.fillRect(x0, y0, H, H);
      const gx = x0 + 20, gy = y0 + 18, gw = H - 40, gh = H - 40;
      const g = ctx.createLinearGradient(gx, gy, gx + gw * 0.4, gy + gh);
      g.addColorStop(0, '#a9c7e0'); g.addColorStop(0.45, '#40566c'); g.addColorStop(1, '#2a3440');
      ctx.fillStyle = g;
      ctx.fillRect(gx, gy, gw, gh);
      // Inredning skymtar
      ctx.fillStyle = 'rgba(20,18,16,0.35)';
      ctx.fillRect(gx, gy + gh * 0.55, gw, gh * 0.45);
      if (curtains[v]) {
        ctx.fillStyle = curtains[v];
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + gw * 0.28, gy); ctx.quadraticCurveTo(gx + gw * 0.1, gy + gh * 0.5, gx + gw * 0.2, gy + gh); ctx.lineTo(gx, gy + gh); ctx.fill();
        ctx.beginPath(); ctx.moveTo(gx + gw, gy); ctx.lineTo(gx + gw * 0.72, gy); ctx.quadraticCurveTo(gx + gw * 0.9, gy + gh * 0.5, gx + gw * 0.8, gy + gh); ctx.lineTo(gx + gw, gy + gh); ctx.fill();
      }
      // Reflexstrimma
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath(); ctx.moveTo(gx + gw * 0.15, gy); ctx.lineTo(gx + gw * 0.38, gy); ctx.lineTo(gx + gw * 0.05, gy + gh * 0.6); ctx.lineTo(gx, gy + gh * 0.6); ctx.lineTo(gx, gy + gh * 0.25); ctx.fill();
      // Spröjs: sex över sex eller två luft
      ctx.fillStyle = '#f4f2ec';
      ctx.fillRect(gx, gy + gh / 2 - 5, gw, 10);
      if (v !== 3) {
        for (const f of [1 / 3, 2 / 3]) ctx.fillRect(gx + gw * f - 3, gy, 6, gh);
        for (const f of [0.25, 0.75]) ctx.fillRect(gx, gy + gh * f - 3, gw, 6);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 3;
      ctx.strokeRect(gx, gy, gw, gh);
      void r;
    }
    const t = toTex(c, { repeat: false });
    return t;
  });
}
const WIN_CELLS = [[0, 0.5, 0.5, 1], [0.5, 0.5, 1, 1], [0, 0, 0.5, 0.5], [0.5, 0, 1, 0.5]];

// Dörratlas: vänster ytterdörr, höger garageport (vita, tonas med vertexfärg)
function doorTexture() {
  return cached('doorTex', () => {
    const W = 512, H = 256;
    const [c, ctx] = canvas(W, H);
    // Ytterdörr med sex speglar och fönsterruta
    ctx.fillStyle = '#ece9e2'; ctx.fillRect(0, 0, 256, H);
    const panel = (x, y, w, h) => {
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
      ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(x + 8, y + 8, w - 16, h - 16);
    };
    ctx.fillStyle = '#4a6176'; ctx.fillRect(70, 14, 116, 48);
    ctx.fillStyle = '#ece9e2'; ctx.fillRect(126, 14, 4, 48);
    for (const y of [76, 160]) { panel(64, y, 56, 70); panel(136, y, 56, 70); }
    ctx.fillStyle = '#c9a54a'; ctx.beginPath(); ctx.arc(176, 150, 7, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(48, 0, 4, H); ctx.fillRect(204, 0, 4, H);
    ctx.fillStyle = '#f7f5f0'; ctx.fillRect(0, 0, 48, H); ctx.fillRect(208, 0, 48, H);
    // Garageport: fyra sektioner, fönsterrad överst
    ctx.fillStyle = '#efedE8'.toLowerCase(); ctx.fillRect(256, 0, 256, H);
    for (let s = 0; s < 4; s++) {
      const y = s * 64;
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(256, y + 60, 256, 4);
      for (let k = 0; k < 4; k++) {
        const x = 256 + 10 + k * 61;
        if (s === 0) { ctx.fillStyle = '#3d4e5e'; ctx.fillRect(x + 6, y + 14, 46, 32); }
        else { ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fillRect(x + 4, y + 10, 50, 40); ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(x + 6, y + 12, 46, 3); }
      }
    }
    return toTex(c, { repeat: false });
  });
}
const DOOR_CELL = [0, 0, 0.5, 1], GARAGE_CELL = [0.5, 0, 1, 1];

function woodTexture() {
  return cached('woodTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [205, 190, 168], { cells: 2, oct: 5, amt: 0.2, grain: 8, seed: 391 });
    const boards = 8, bw = S / boards;
    for (let b = 0; b < boards; b++) {
      ctx.fillStyle = 'rgba(50,35,20,0.45)'; ctx.fillRect(b * bw, 0, 2, S);
      ctx.fillStyle = `rgba(0,0,0,${(b * 37 % 7) * 0.012})`; ctx.fillRect(b * bw, 0, bw, S);
    }
    return toTex(c);
  });
}

function leafTexture() {
  return cached('leafTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [118, 160, 82], { cells: 4, oct: 5, amt: 0.4, grain: 12, seed: 401 });
    const r = rng(402);
    for (let i = 0; i < 1600; i++) {
      const x = r() * S, y = r() * S, s = 2 + r() * 4, a = r() * Math.PI;
      const k = r();
      ctx.fillStyle = k < 0.45 ? `rgba(40,70,25,${0.4 + r() * 0.3})` : k < 0.85 ? `rgba(130,175,85,${0.4 + r() * 0.3})` : 'rgba(215,235,160,0.5)';
      wrapDraw(S, S, x, y, s, (px, py) => { ctx.beginPath(); ctx.ellipse(px, py, s, s * 0.55, a, 0, 7); ctx.fill(); });
    }
    return toTex(c);
  });
}

function barkTexture() {
  return cached('barkTex', () => {
    const W = 128, H = 256;
    const [c, ctx] = canvas(W, H);
    paintNoise(ctx, W, H, [120, 104, 88], { cells: 3, oct: 5, amt: 0.35, grain: 14, seed: 411 });
    const r = rng(412);
    ctx.strokeStyle = 'rgba(40,30,22,0.5)';
    for (let i = 0; i < 40; i++) {
      const x = r() * W; ctx.lineWidth = 1 + r() * 2;
      ctx.beginPath(); ctx.moveTo(x, 0);
      for (let y = 0; y <= H; y += 16) ctx.lineTo(x + Math.sin(y * 0.05 + i) * 4, y);
      ctx.stroke();
    }
    return toTex(c);
  });
}

function hedgeTexture() {
  return cached('hedgeTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [70, 112, 50], { cells: 4, oct: 5, amt: 0.45, grain: 16, seed: 421 });
    const r = rng(422);
    for (let i = 0; i < 2600; i++) {
      const x = r() * S, y = r() * S, s = 1.5 + r() * 3;
      ctx.fillStyle = r() < 0.5 ? 'rgba(25,50,18,0.55)' : 'rgba(140,185,90,0.5)';
      wrapDraw(S, S, x, y, s, (px, py) => { ctx.beginPath(); ctx.arc(px, py, s, 0, 7); ctx.fill(); });
    }
    return toTex(c);
  });
}

function sandTexture() {
  return cached('sandTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [236, 226, 200], { cells: 4, oct: 5, amt: 0.2, grain: 30, seed: 431 });
    return toTex(c);
  });
}

// Packad jord och grus (byggplats, tunnel och bakgårdsgång)
function dirtTexture() {
  return cached('dirtTex', () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [132, 104, 76], { cells: 3, oct: 5, amt: 0.38, grain: 22, seed: 451 });
    const r = rng(452);
    for (let i = 0; i < 900; i++) {
      const x = r() * S, y = r() * S, s = 0.8 + r() * 2.4;
      ctx.fillStyle = r() < 0.5 ? `rgba(70,55,40,${0.3 + r() * 0.4})` : `rgba(200,180,150,${0.25 + r() * 0.35})`;
      wrapDraw(S, S, x, y, s, (px, py) => { ctx.beginPath(); ctx.arc(px, py, s, 0, 7); ctx.fill(); });
    }
    // Hjulspår
    ctx.strokeStyle = 'rgba(60,45,32,0.18)';
    for (const x of [70, 96, 170, 196]) { ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke(); }
    return toTex(c);
  });
}

function stripeTexture() {
  return cached('stripeTex', () => {
    const [c, ctx] = canvas(128, 32);
    ctx.fillStyle = '#f6f3ea'; ctx.fillRect(0, 0, 128, 32);
    ctx.fillStyle = '#ea6a1c';
    for (let x = -32; x < 160; x += 32) { ctx.beginPath(); ctx.moveTo(x, 32); ctx.lineTo(x + 16, 0); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 16, 32); ctx.fill(); }
    return toTex(c);
  });
}

// ===========================================================================
// Material och batch
// ===========================================================================

const decal = (f) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
const MATERIALS = {
  asphalt: () => cached('m.asphalt', () => new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.93, ...decal(-4) })),
  concrete: () => cached('m.concrete', () => new THREE.MeshStandardMaterial({ map: concreteTexture(), vertexColors: true, roughness: 0.9, ...decal(-5) })),
  pavers: () => cached('m.pavers', () => new THREE.MeshStandardMaterial({ map: paversTexture(), roughness: 0.9, ...decal(-4) })),
  plywood: () => cached('m.plywood', () => new THREE.MeshStandardMaterial({ map: plywoodTexture(), roughness: 0.75, ...decal(-5) })),
  paint: () => cached('m.paint', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, ...decal(-8) })),
  siding: () => cached('m.siding', () => new THREE.MeshStandardMaterial({ map: sidingTexture(), vertexColors: true, roughness: 0.75 })),
  roof: () => cached('m.roof', () => new THREE.MeshStandardMaterial({ map: shingleTexture(), vertexColors: true, roughness: 0.92 })),
  trim: () => cached('m.trim', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })),
  window: () => cached('m.window', () => new THREE.MeshStandardMaterial({ map: windowTexture(), roughness: 0.15, metalness: 0.15, envMapIntensity: 1.4 })),
  door: () => cached('m.door', () => new THREE.MeshStandardMaterial({ map: doorTexture(), vertexColors: true, roughness: 0.5 })),
  brick: () => cached('m.brick', () => new THREE.MeshStandardMaterial({ map: brickTexture(), vertexColors: true, roughness: 0.9 })),
  wood: () => cached('m.wood', () => new THREE.MeshStandardMaterial({ map: woodTexture(), vertexColors: true, roughness: 0.8 })),
  metal: () => cached('m.metal', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.65 })),
  plastic: () => cached('m.plastic', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 })),
  carPaint: () => cached('m.carPaint', () => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 })),
  glass: () => cached('m.glass', () => new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.7, envMapIntensity: 1.6 })),
  rubber: () => cached('m.rubber', () => new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.92 })),
  glow: () => cached('m.glow', () => new THREE.MeshBasicMaterial({ vertexColors: true })),
  leaves: () => cached('m.leaves', () => new THREE.MeshStandardMaterial({ map: leafTexture(), vertexColors: true, roughness: 0.85 })),
  bark: () => cached('m.bark', () => new THREE.MeshStandardMaterial({ map: barkTexture(), vertexColors: true, roughness: 0.95 })),
  hedge: () => cached('m.hedge', () => new THREE.MeshStandardMaterial({ map: hedgeTexture(), vertexColors: true, roughness: 0.92 })),
  sand: () => cached('m.sand', () => new THREE.MeshStandardMaterial({ map: sandTexture(), vertexColors: true, roughness: 1 })),
  dirt: () => cached('m.dirt', () => new THREE.MeshStandardMaterial({ map: dirtTexture(), vertexColors: true, roughness: 1, ...decal(-4) })),
  earth: () => cached('m.earth', () => new THREE.MeshStandardMaterial({ map: dirtTexture(), vertexColors: true, roughness: 1 })),
  stripes: () => cached('m.stripes', () => new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.55 })),
  far: () => cached('m.far', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })),
};
const NO_SHADOW = new Set(['asphalt', 'pavers', 'plywood', 'paint', 'glow', 'far', 'dirt']);

export class HoodBatch {
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
      mesh.castShadow = !NO_SHADOW.has(key);
      mesh.receiveShadow = key !== 'glow';
      scene.add(mesh);
    }
    this.lists.clear();
  }
}

// ===========================================================================
// Geometrihjälp
// ===========================================================================

// Låda med UV i meter (m meter per texturupprepning)
function box(w, h, d, x = 0, y = 0, z = 0, { m = 1, swap = false } = {}) {
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

// Balk mellan två punkter
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

function cyl(rt, rb, h, x, y, z, seg = 12) {
  return new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z);
}

// Plan som vetter mot +z med UV ur en atlasruta
function cellPlane(w, h, cell) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const [u0, v0, u1, v1] = cell;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

// Lokal ram: rotation runt y och flytt (för hus, bilar och annat som vrids)
function frame(x, z, rot, y = 0) {
  return new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
}

const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Plan remsa på marken från punktlista längs en linje (för trottoarer m.m.)
function groundQuad(ax, az, bx, bz, cx, cz, dx, dz, y, uvs) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([ax, y, az, bx, y, bz, cx, y, cz, ax, y, az, cx, y, cz, dx, y, dz], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs ?? [ax, az, bx, bz, cx, cz, ax, az, cx, cz, dx, dz], 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  return g;
}
// Rektangel på marken (axelparallell före rotation) med plan-UV i meter
function groundRect(cx, cz, w, d, rot, y, tile) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.rotateY(rot);
  g.translate(cx, y, cz);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tile, -p.getZ(i) / tile);
  return g;
}

// ===========================================================================
// Mark: gräsmatta överallt (fysik + grafik)
// ===========================================================================

export function makeGround(scene, world, RAPIER, { size, visual = 700, grip = 0.9 } = {}) {
  const half = size / 2;
  if (world) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const col = world.createCollider(
      RAPIER.ColliderDesc.cuboid(half + 15, 0.5, half + 15).setTranslation(0, -0.5, 0).setFriction(0.9).setCollisionGroups(groups(G.WORLD)),
      body
    );
    world.__surfaces ||= new Map();
    world.__surfaces.set(col.handle, { grip });
  }
  if (!scene) return;
  const map = grassTexture();
  const g = new THREE.PlaneGeometry(visual, visual, 120, 120);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    uv.setXY(i, x / GRASS_TILE, z / GRASS_TILE);
    const n = 0.5 + 0.25 * Math.sin(x * 0.13 + 1.3) * Math.cos(z * 0.11) + 0.25 * Math.sin((x - z) * 0.045 + 2);
    const far = Math.min(1, Math.max(0, (Math.hypot(x, z) - 110) / 120));
    col[i * 3] = 0.84 + n * 0.2 + far * 0.05; col[i * 3 + 1] = 0.9 + n * 0.14; col[i * 3 + 2] = 0.78 + n * 0.12;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.95, envMapIntensity: 0.3 }));
  ground.receiveShadow = true;
  scene.add(ground);
}

// ===========================================================================
// Banans ytskikt: asfalt, betong, marksten och plywood ovanpå vägen
// ===========================================================================

// kindAt(i) → 'asphalt' | 'concrete' | 'pavers' | 'plywood' | 'dirt' | 'dirtDark'
// Fungerar även för genvägar (öppna vägsträckor, data.open).
export function addTrackSurfaces(B, track, kindAt) {
  if (!B) return;
  const { pts, normals, N, roadHalf, isGap, dist } = track;
  const lists = {};
  const h = roadHalf + 0.02;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    if (track.open && i >= N - 2) continue;
    // Under ett hoppglapp: asfalt på marken
    const gap = isGap[i] || isGap[j];
    const kind = gap ? 'asphalt' : kindAt(i);
    const a = pts[i], b = pts[j], na = normals[i], nb = normals[j];
    const ya = gap ? 0.008 : a.y + 0.012, yb = gap ? 0.008 : b.y + 0.012;
    const da = gap ? 0 : bankY(track, i, h), db = gap ? 0 : bankY(track, j, h);
    const L = (p, n, s) => [p.x + n.x * h * s, p.z + n.z * h * s];
    const [a1x, a1z] = L(a, na, 1), [a2x, a2z] = L(a, na, -1), [b1x, b1z] = L(b, nb, 1), [b2x, b2z] = L(b, nb, -1);
    let uv;
    const tile = { asphalt: ASPHALT_TILE, concrete: 1.5, pavers: 1.2, plywood: 2.4, dirt: 3, dirtDark: 3 }[kind];
    if (kind === 'plywood' || kind === 'concrete' || kind === 'dirt' || kind === 'dirtDark') {
      // Längs banan (skivor och plattor följer vägen)
      const va = dist[i] / tile, vb = (dist[j] || track.length) / tile, w = (h * 2) / tile;
      uv = [0, va, w, va, w, vb, 0, va, w, vb, 0, vb];
    } else {
      uv = [a1x / tile, a1z / tile, a2x / tile, a2z / tile, b2x / tile, b2z / tile, a1x / tile, a1z / tile, b2x / tile, b2z / tile, b1x / tile, b1z / tile];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([a1x, ya + da, a1z, a2x, ya - da, a2z, b2x, yb - db, b2z, a1x, ya + da, a1z, b2x, yb - db, b2z, b1x, yb + db, b1z], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    // Vänd så att normalen pekar upp
    if (g.attributes.normal.getY(0) < 0) {
      const p = g.attributes.position.array, u = g.attributes.uv.array;
      for (const t of [0, 3]) {
        for (let k = 0; k < 3; k++) { const s = p[(t + 1) * 3 + k]; p[(t + 1) * 3 + k] = p[(t + 2) * 3 + k]; p[(t + 2) * 3 + k] = s; }
        for (let k = 0; k < 2; k++) { const s = u[(t + 1) * 2 + k]; u[(t + 1) * 2 + k] = u[(t + 2) * 2 + k]; u[(t + 2) * 2 + k] = s; }
      }
      g.computeVertexNormals();
    }
    (lists[kind] ||= []).push(g);
  }
  if (!B) return;
  const tint = { concrete: [0.9, 0.89, 0.87], dirt: [1, 1, 1], dirtDark: [0.34, 0.3, 0.26] };
  for (const [kind, list] of Object.entries(lists)) {
    const key = kind === 'dirtDark' ? 'dirt' : kind;
    B.add(key, mergeGeometries(list), tint[kind] ?? [1, 1, 1]);
  }
}

// Mittlinje (streckad gul), övergångsställen och brunnslock
export function addTrackPaint(B, track, { centre, crosswalks = [], manholes = [] }) {
  const { pts, tangents, normals, N, dist } = track;
  const yellow = hex(0xe8b622), white = hex(0xf2f0ea);
  const dash = 1.6, gapLen = 1.6, lw = 0.065;
  for (let i = 0; i < N; i++) {
    if (!centre(i)) continue;
    const s = dist[i] % (dash + gapLen);
    if (s > dash) continue;
    const j = (i + 1) % N;
    if (!centre(j)) continue;
    const a = pts[i], b = pts[j], n = normals[i];
    const y = Math.max(a.y, b.y) + 0.02;
    B.add('paint', groundQuad(a.x + n.x * lw, a.z + n.z * lw, a.x - n.x * lw, a.z - n.z * lw, b.x - n.x * lw, b.z - n.z * lw, b.x + n.x * lw, b.z + n.z * lw, y), yellow);
  }
  // Övergångsställen: breda vita balkar i färdriktningen
  for (const idx of crosswalks) {
    const p = pts[idx], t = tangents[idx], n = normals[idx];
    for (let k = -3; k <= 3; k++) {
      const c = { x: p.x + n.x * k * 0.58, z: p.z + n.z * k * 0.58 };
      const hw = 0.2, hl = 0.9;
      B.add('paint', groundQuad(
        c.x + n.x * hw - t.x * hl, c.z + n.z * hw - t.z * hl, c.x - n.x * hw - t.x * hl, c.z - n.z * hw - t.z * hl,
        c.x - n.x * hw + t.x * hl, c.z - n.z * hw + t.z * hl, c.x + n.x * hw + t.x * hl, c.z + n.z * hw + t.z * hl, p.y + 0.02), white);
    }
  }
  for (const [idx, lat] of manholes) {
    const p = track.poseAt(idx, lat);
    const g = new THREE.CircleGeometry(0.32, 18).rotateX(-Math.PI / 2).translate(p.x, p.y + 0.018, p.z);
    B.add('metal', g, hex(0x3c3a36));
    for (let k = -2; k <= 2; k++) B.add('metal', box(0.5 - Math.abs(k) * 0.08, 0.004, 0.025, p.x, p.y + 0.022, p.z + k * 0.1), hex(0x2a2826));
  }
}

// Trottoarer längs banan: gräsremsa vid kantstenen, sedan betongplattor.
// ok(i, side) avgör var de får ligga.
export const VERGE = 1.0, WALK = 1.5;
export function addTrackSidewalks(B, track, ok) {
  const { pts, normals, N, roadHalf, barrier, dist } = track;
  const a0 = roadHalf + barrier.thick + VERGE, a1 = a0 + WALK;
  const list = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    for (const s of [1, -1]) {
      if (!ok(i, s) || !ok(j, s)) continue;
      const p = pts[i], q = pts[j], n = normals[i], m = normals[j];
      const va = dist[i] / 1.5, vb = (dist[j] || track.length) / 1.5;
      const P = (pt, nn, off) => [pt.x + nn.x * off * s, pt.z + nn.z * off * s];
      const [ax, az] = P(p, n, a0), [bx, bz] = P(p, n, a1), [cx, cz] = P(q, m, a1), [dx, dz] = P(q, m, a0);
      const g = groundQuad(ax, az, bx, bz, cx, cz, dx, dz, 0.016, [0, va, 1, va, 1, vb, 0, va, 1, vb, 0, vb]);
      if (s > 0) { // vänd lindningen så att normalen pekar upp
        const pos = g.attributes.position.array, uv = g.attributes.uv.array;
        for (const t of [0, 3]) {
          for (let k = 0; k < 3; k++) { const v = pos[(t + 1) * 3 + k]; pos[(t + 1) * 3 + k] = pos[(t + 2) * 3 + k]; pos[(t + 2) * 3 + k] = v; }
          for (let k = 0; k < 2; k++) { const v = uv[(t + 1) * 2 + k]; uv[(t + 1) * 2 + k] = uv[(t + 2) * 2 + k]; uv[(t + 2) * 2 + k] = v; }
        }
      }
      list.push(g);
    }
  }
  if (B && list.length) B.add('concrete', mergeGeometries(list), [0.98, 0.97, 0.95]);
}

// Gata utanför banan (rak, axelparallell): asfalt, kantsten och trottoar.
// free(x, z, what) får säga nej nära banan och korsningar.
export function addStreet(B, world, RAPIER, { a, b, half = 2, free }) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const tx = dx / len, tz = dz / len, nx = -tz, nz = tx;
  const body = world ? world.createRigidBody(RAPIER.RigidBodyDesc.fixed()) : null;
  const rot = Math.atan2(tx, tz);
  const step = 1;
  // Kantstenens kollision: en låda per sammanhängande sträcka
  const run = { 1: null, '-1': null };
  const flush = (side, s1) => {
    const s0 = run[side];
    run[side] = null;
    if (s0 === null || !world) return;
    const m = (s0 + s1) / 2, o = side * (half + 0.125);
    boxCollider(world, RAPIER, body, 0.125, 0.075, (s1 - s0) / 2, a[0] + tx * m + nx * o, 0.075, a[1] + tz * m + nz * o, rot);
  };
  for (let s = 0; s < len; s += step) {
    const cx = a[0] + tx * (s + step / 2), cz = a[1] + tz * (s + step / 2);
    // Asfalt (ritas även i korsningar, världs-UV gör skarvarna osynliga)
    if (B && free(cx, cz, 'asphalt')) B.add('asphalt', groundRect(cx, cz, half * 2 + 0.02, step + 0.02, rot, 0.006, ASPHALT_TILE));
    for (const side of [1, -1]) {
      const kx = cx + nx * side * (half + 0.125), kz = cz + nz * side * (half + 0.125);
      if (free(kx, kz, 'curb')) {
        if (B) B.add('concrete', box(0.25, 0.15, step, 0, 0.075, 0, { m: 1.5 }).rotateY(rot).translate(kx, 0, kz), [0.9, 0.89, 0.86]);
        if (run[side] === null) run[side] = s;
      } else flush(side, s);
      const off = half + 0.25 + VERGE + WALK / 2;
      const wx = cx + nx * side * off, wz = cz + nz * side * off;
      if (B && free(wx, wz, 'walk')) {
        const g = new THREE.PlaneGeometry(WALK, step).rotateX(-Math.PI / 2);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), (s + uv.getY(i) * step) / 1.5);
        B.add('concrete', g.rotateY(rot).translate(wx, 0.019, wz), [0.98, 0.97, 0.95]);
      }
    }
  }
  for (const side of [1, -1]) flush(side, Math.ceil(len));
}

// Mittlinje och övergångsställe på en gata utanför banan
export function addStreetPaint(B, { a, b, from = 0, to = 1, crossAt = [] }) {
  if (!B) return;
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const tx = dx / len, tz = dz / len, nx = -tz, nz = tx;
  const yellow = hex(0xe8b622), white = hex(0xf2f0ea);
  for (let s = len * from; s < len * to - 1.6; s += 3.2) {
    const cx = a[0] + tx * (s + 0.8), cz = a[1] + tz * (s + 0.8);
    B.add('paint', groundRect(cx, cz, 0.13, 1.6, Math.atan2(tx, tz), 0.02, 1), yellow);
  }
  for (const s of crossAt) {
    const cx = a[0] + tx * s, cz = a[1] + tz * s;
    for (let k = -3; k <= 3; k++) B.add('paint', groundRect(cx + nx * k * 0.58, cz + nz * k * 0.58, 0.4, 1.8, Math.atan2(tx, tz), 0.02, 1), white);
  }
}

// ===========================================================================
// Villor
// ===========================================================================

const SIDING = [0xf3e7c4, 0xcfe0ea, 0xf4f1ea, 0xd5e6cf, 0xd9d6cf, 0xe9d3b8, 0xf0d3c6, 0xbcd0dc, 0xe8e2a8];
const ROOFS = [0x55575c, 0x6b5143, 0x4f5a66, 0x7b4a3c, 0x3f4247, 0x6e665c];
const ACCENT = [0x2e4a3a, 0x24344f, 0x6a2424, 0x2a2a2a, 0x5a6f7f, 0x8a6b2b];
export const HOUSE_COLORS = { SIDING, ROOFS, ACCENT };

/**
 * Tvåvåningsvilla med sadeltak. Lokal ram: fronten mot +z, origo mitt i
 * huskroppen på marken. o: {x, z, rot, w, d, floors, garage: 'left'|'right'|null,
 * toStreet (avstånd fram till trottoarens innerkant), porch, chimney, seed}
 */
export function addHouse(B, world, RAPIER, o) {
  const r = rng(o.seed ?? 1);
  const w = o.w ?? 10, d = o.d ?? 8, floors = o.floors ?? 2;
  const plinth = 0.45, h = floors === 2 ? 5.4 : 3.0;
  const top = plinth + h;
  const gw = 6.2, gd = 6.6, gh = 2.9;
  const gSide = o.garage === 'left' ? -1 : o.garage === 'right' ? 1 : 0;
  const gx = gSide * (w / 2 + gw / 2), gz = d / 2 - gd / 2 - 0.6;

  if (world) {
    const body = fixedBody(world, RAPIER, o.x, o.z, o.rot);
    boxCollider(world, RAPIER, body, w / 2, top / 2, d / 2, 0, top / 2, 0);
    if (gSide) boxCollider(world, RAPIER, body, gw / 2, gh / 2, gd / 2, gx, gh / 2, gz);
    if (o.porch !== false) boxCollider(world, RAPIER, body, w * 0.32, 0.25, 1.0, 0, 0.25, d / 2 + 1.0);
  }
  if (!B) return;
  const M = frame(o.x, o.z, o.rot);
  const add = (key, g, col) => B.add(key, g.applyMatrix4(M), col);

  const siding = hex(o.siding ?? SIDING[Math.floor(r() * SIDING.length)]);
  const roofC = hex(o.roof ?? ROOFS[Math.floor(r() * ROOFS.length)]);
  const accent = hex(o.accent ?? ACCENT[Math.floor(r() * ACCENT.length)]);
  const white = [0.96, 0.95, 0.92];
  const pitch = 0.55 + r() * 0.2;

  // Sockel, väggar, våningsband och hörnbrädor
  add('brick', box(w + 0.12, plinth, d + 0.12, 0, plinth / 2, 0, { m: 1 }), [0.92, 0.9, 0.88]);
  add('siding', box(w, h, d, 0, plinth + h / 2, 0, { m: 2 }), siding);
  if (floors === 2) add('trim', box(w + 0.06, 0.14, d + 0.06, 0, plinth + h / 2, 0), white);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add('trim', box(0.16, h, 0.16, sx * (w / 2 - 0.05), plinth + h / 2, sz * (d / 2 - 0.05)), white);

  // Sadeltak med nock längs x och gavlar på kortsidorna
  addGableRoof(add, { w, d, y: top, pitch, over: 0.45, roofC, siding, white });

  // Skorsten av tegel på ena gaveln
  if (o.chimney !== false) {
    const cs = r() < 0.5 ? -1 : 1, rise = (d / 2) * pitch;
    add('brick', box(1.0, top + rise + 0.9, 0.8, cs * (w / 2 + 0.38), (top + rise + 0.9) / 2, -0.3 - r() * 1.2, { m: 1 }), [1, 1, 1]);
  }

  // Fönster: helpers placerar ruta + fönsterbräda + luckor
  const win = (x, y, z, face, ww = 0.95, wh = 1.35, shutters = false) => {
    const g = cellPlane(ww, wh, WIN_CELLS[Math.floor(r() * 4)]);
    const rot = face === 'front' ? 0 : face === 'back' ? Math.PI : face === 'left' ? -Math.PI / 2 : Math.PI / 2;
    const m = frame(x, z, rot, y);
    add('window', g.applyMatrix4(m));
    add('trim', box(ww + 0.16, 0.06, 0.1, 0, -wh / 2 - 0.03, 0.04).applyMatrix4(m), white);
    add('trim', box(ww + 0.12, 0.08, 0.05, 0, wh / 2 + 0.04, 0.015).applyMatrix4(m), white);
    if (shutters) for (const s of [-1, 1]) add('trim', box(ww * 0.42, wh, 0.04, s * (ww / 2 + ww * 0.24), 0, 0.02).applyMatrix4(m), accent);
  };
  const yF = [plinth + 1.55, plinth + h / 2 + 1.35];
  const nF = floors === 2 ? 2 : 1;
  const z0 = d / 2 + 0.012;
  // Fram: dörr i mitten, fönster på sidorna
  const doorX = gSide ? -gSide * w * 0.12 : 0;
  for (let f = 0; f < nF; f++) {
    const xs = f === 0 ? [doorX - w * 0.3, doorX + w * 0.3].map((x) => Math.max(-w / 2 + 1, Math.min(w / 2 - 1, x))) : [-w * 0.32, 0, w * 0.32];
    for (const x of xs) win(x, yF[f], z0, 'front', 0.95, f === 0 ? 1.4 : 1.25, true);
  }
  for (let f = 0; f < nF; f++) {
    for (const x of [-w * 0.3, w * 0.3]) win(x, yF[f], -z0, 'back');
    for (const s of [-1, 1]) {
      if (gSide === s && f === 0) continue;
      for (const zz of [-d * 0.22, d * 0.22]) win(s * (w / 2 + 0.012), yF[f], zz, s < 0 ? 'left' : 'right', 0.9, 1.2);
    }
  }
  // Vindsfönster i gaveln
  for (const s of [-1, 1]) win(s * (w / 2 + 0.012), top + 0.65, 0, s < 0 ? 'left' : 'right', 0.6, 0.6);

  // Ytterdörr med foder och lampa
  const dm = frame(doorX, z0 + 0.005, 0, plinth + 1.05);
  add('door', cellPlane(1.0, 2.1, DOOR_CELL).applyMatrix4(dm), accent);
  add('trim', box(1.3, 0.14, 0.08, 0, 1.12, 0.02).applyMatrix4(dm), white);
  for (const s of [-1, 1]) add('trim', box(0.12, 2.2, 0.08, s * 0.6, 0, 0.02).applyMatrix4(dm), white);

  // Veranda: trädäck, stolpar, räcke och eget tak
  if (o.porch !== false) {
    const pw = Math.min(w * 0.64, 6.5), pd = 2.0, px = doorX;
    add('wood', box(pw, plinth, pd, px, plinth / 2, d / 2 + pd / 2, { m: 1.5 }), [0.8, 0.82, 0.84]);
    for (let k = 0; k < 2; k++) add('concrete', box(1.4, plinth * (1 - k * 0.5) - 0.02, 0.35, px + (doorX - px), plinth * (1 - k * 0.5) / 2, d / 2 + pd + 0.17 + k * 0.35), [0.92, 0.91, 0.88]);
    const ph = 2.7;
    for (const t of [-1, -0.33, 0.33, 1]) {
      if (Math.abs(t) < 0.5 && Math.abs(px + t * (pw / 2 - 0.1) - doorX) < 0.8) continue;
      add('trim', box(0.16, ph, 0.16, px + t * (pw / 2 - 0.1), plinth + ph / 2, d / 2 + pd - 0.1), white);
    }
    for (const s of [-1, 1]) {
      const rx = px + s * (pw / 4 + 0.35);
      add('trim', box(pw / 2 - 1.1, 0.06, 0.06, rx, plinth + 0.85, d / 2 + pd - 0.1), white);
      for (let k = 0; k < Math.floor((pw / 2 - 1.1) / 0.14); k++) add('trim', box(0.04, 0.8, 0.04, rx - (pw / 2 - 1.1) / 2 + 0.07 + k * 0.14, plinth + 0.43, d / 2 + pd - 0.1), white);
    }
    const roofY = plinth + ph;
    const g = box(pw + 0.4, 0.12, pd + 0.4, 0, 0, 0, { m: 2 });
    g.rotateX(0.22);
    add('roof', g.translate(px, roofY + 0.25, d / 2 + pd / 2 - 0.05), roofC);
    add('trim', box(pw + 0.4, 0.22, 0.06, px, roofY + 0.02, d / 2 + pd + 0.15), white);
  }

  // Garage på sidan: egen sadel med gavel mot gatan, port
  if (gSide) {
    add('brick', box(gw + 0.08, 0.2, gd + 0.08, gx, 0.1, gz, { m: 1 }), [0.92, 0.9, 0.88]);
    add('siding', box(gw, gh - 0.2, gd, gx, 0.2 + (gh - 0.2) / 2, gz, { m: 2 }), siding);
    addGableRoof(add, { w: gd, d: gw, y: gh, pitch: 0.5, over: 0.35, roofC, siding, white, rotY: Math.PI / 2, x: gx, z: gz });
    const gm = frame(gx, gz + gd / 2 + 0.012, 0, 1.15);
    add('door', cellPlane(4.8, 2.25, GARAGE_CELL).applyMatrix4(gm), white);
    add('trim', box(5.1, 0.16, 0.08, 0, 1.2, 0.02).applyMatrix4(gm), white);
    for (const s of [-1, 1]) add('trim', box(0.16, 2.4, 0.08, s * 2.5, 0, 0.02).applyMatrix4(gm), white);
    if (o.hoop) addHoopLocal(add, gx, gz + gd / 2, gh);
  }

  // Uppfart och gångväg fram till trottoaren
  const toStreet = o.toStreet ?? 9;
  if (gSide) {
    const z1 = gz + gd / 2, len = toStreet - z1;
    add('concrete', groundRect(gx, z1 + len / 2, 5.0, len, 0, 0.022, 1.5), [0.95, 0.94, 0.92]);
  }
  const wz1 = d / 2 + 2.6, wl = toStreet - wz1;
  if (wl > 0.3) add('concrete', groundRect(doorX, wz1 + wl / 2, 1.1, wl, 0, 0.02, 1.5), [0.95, 0.94, 0.92]);

  // Rabatter med buskar och blommor längs fasaden
  const bed = (x0, x1) => {
    if (x1 - x0 < 1) return;
    add('sand', groundRect((x0 + x1) / 2, d / 2 + 0.6, x1 - x0, 1.0, 0, 0.03, 1), [0.42, 0.3, 0.2]);
    for (let x = x0 + 0.5; x < x1 - 0.3; x += 0.9 + r() * 0.5) {
      if (r() < 0.65) addShrub(add, x, d / 2 + 0.6, 0.4 + r() * 0.25, r);
      else addFlowers(add, x, d / 2 + 0.6, r);
    }
  };
  const pw = o.porch !== false ? Math.min(w * 0.64, 6.5) : 1.6;
  bed(-w / 2 + 0.2, doorX - pw / 2 - 0.1);
  bed(doorX + pw / 2 + 0.1, w / 2 - 0.2);
}

// Sadeltak: två lutande skivor, gavelspetsar och vindskivor
function addGableRoof(add, { w, d, y, pitch, over, roofC, siding, white, rotY = 0, x = 0, z = 0 }) {
  const rise = (d / 2) * pitch;
  const ang = Math.atan(pitch);
  const slope = (d / 2 + over) / Math.cos(ang);
  const M = frame(x, z, rotY);
  for (const s of [-1, 1]) {
    const g = box(w + over * 2, 0.14, slope, 0, 0, 0, { m: 2, swap: false });
    g.rotateX(s * ang);
    g.translate(0, y + rise / 2 + 0.07 - (over * pitch) / 2, s * (d / 2 + over) / 2);
    add('roof', g.applyMatrix4(M), roofC);
    // Takfot med vit vindskiva
    add('trim', box(w + over * 2 + 0.02, 0.2, 0.05, 0, y - over * pitch - 0.02, s * (d / 2 + over)).applyMatrix4(M), white);
  }
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, rise)]);
    const g = new THREE.ShapeGeometry(shape);
    const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 2, p.getY(i) / 2);
    g.rotateY(s * Math.PI / 2);
    g.translate(s * (w / 2), y, 0);
    add('siding', g.applyMatrix4(M), siding);
    // Vindskivor längs gavelns takkant
    for (const t of [-1, 1]) {
      add('trim', beam(s * (w / 2 + over), y - over * pitch, t * (d / 2 + over), s * (w / 2 + over), y + rise, 0, 0.06, 0.2).applyMatrix4(M), white);
    }
  }
}

function addShrub(add, x, z, s, r) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * s * (1 + r() * 0.1), Math.max(-0.3, p.getY(i)) * s * 0.85, p.getZ(i) * s * (1 + r() * 0.1));
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i));
  add('leaves', g.translate(x, s * 0.6, z), [0.55 + r() * 0.15, 0.75 + r() * 0.15, 0.5]);
}
function addFlowers(add, x, z, r) {
  const cols = [[1, 0.45, 0.6], [1, 0.9, 0.3], [0.95, 0.3, 0.3], [1, 1, 1], [0.7, 0.5, 1]];
  const c = cols[Math.floor(r() * cols.length)];
  for (let k = 0; k < 5; k++) {
    const g = new THREE.IcosahedronGeometry(0.11, 0);
    add('plastic', g.translate(x + (r() - 0.5) * 0.6, 0.18 + r() * 0.12, z + (r() - 0.5) * 0.5), c);
  }
  add('leaves', new THREE.IcosahedronGeometry(0.28, 1).scale(1.2, 0.6, 1).translate(x, 0.1, z), [0.6, 0.85, 0.5]);
}

// Basketkorg ovanför en garageport (lokala koordinater i husets ram)
function addHoopLocal(add, x, zFront, gh) {
  const bb = [0.98, 0.98, 0.98];
  add('plastic', box(1.2, 0.8, 0.05, x, gh + 0.7, zFront + 0.3), bb);
  add('paint', box(0.5, 0.36, 0.01, x, gh + 0.6, zFront + 0.33), hex(0xe2541c));
  add('metal', box(0.08, 0.08, 0.35, x, gh + 0.7, zFront + 0.12), hex(0x555555));
  const rim = new THREE.TorusGeometry(0.23, 0.018, 6, 20).rotateX(Math.PI / 2).translate(x, gh + 0.38, zFront + 0.6);
  add('metal', rim, hex(0xe2541c));
  const net = new THREE.CylinderGeometry(0.23, 0.16, 0.4, 12, 1, true).translate(x, gh + 0.18, zFront + 0.6);
  add('trim', net, [0.95, 0.95, 0.95]);
}

/**
 * Genomfartsgaraget: väggar, tak, uppfälld port fram och öppen bakport.
 * Lokal ram: fronten mot +z. {x, z, rot, w, d, h}
 */
export function addOpenGarage(B, world, RAPIER, { x, z, rot = 0, w = 6.6, d = 6.6, h = 2.8, siding = 0xe9d3b8, roof = 0x55575c, hoop = true }) {
  const t = 0.16;
  if (world) {
    const body = fixedBody(world, RAPIER, x, z, rot);
    for (const s of [-1, 1]) boxCollider(world, RAPIER, body, t / 2, h / 2, d / 2, s * (w / 2 - t / 2), h / 2, 0);
  }
  if (!B) return;
  const M = frame(x, z, rot);
  const add = (key, g, col) => B.add(key, g.applyMatrix4(M), col);
  const sc = hex(siding), rc = hex(roof), white = [0.96, 0.95, 0.92];
  for (const s of [-1, 1]) {
    add('siding', box(t, h, d, s * (w / 2 - t / 2), h / 2, 0, { m: 2 }), sc);
    // Hyllor, burkar och verktygstavla inne längs väggarna
    add('wood', box(0.45, 0.04, d - 1.2, s * (w / 2 - t - 0.25), 1.2, 0, { m: 1 }), [0.75, 0.62, 0.45]);
    add('wood', box(0.45, 0.04, d - 1.2, s * (w / 2 - t - 0.25), 1.8, 0, { m: 1 }), [0.75, 0.62, 0.45]);
    for (let k = 0; k < 6; k++) {
      const cz = -d / 2 + 0.9 + k * (d - 1.8) / 5;
      add('plastic', cyl(0.1, 0.1, 0.22, s * (w / 2 - t - 0.25), 1.22, cz, 10), [[0.85, 0.2, 0.2], [0.2, 0.45, 0.85], [0.95, 0.85, 0.3], [0.3, 0.6, 0.35]][k % 4]);
      add('plastic', box(0.35, 0.3, 0.35, s * (w / 2 - t - 0.25), 1.82 + 0.15, cz + 0.3), [0.75, 0.6, 0.4]);
    }
  }
  // Framgavel och bakgavel ovanför portöppningarna
  for (const s of [-1, 1]) add('siding', box(w, 0.5, t, 0, h - 0.25, s * (d / 2 - t / 2), { m: 2 }), sc);
  // Tak: platt innertak och sadel ovanpå
  add('trim', box(w - 0.2, 0.06, d - 0.2, 0, h - 0.03, 0), [0.88, 0.86, 0.82]);
  add('glow', box(1.2, 0.03, 0.2, 0, h - 0.07, 0), [1, 0.97, 0.88]);
  addGableRoof(add, { w: d, d: w, y: h, pitch: 0.5, over: 0.35, roofC: rc, siding: sc, white, rotY: Math.PI / 2 });
  // Uppfälld port under taket och skenor
  add('door', cellPlane(w - 0.6, 2.2, GARAGE_CELL).rotateX(Math.PI / 2).translate(0, h - 0.12, d / 2 - 1.3), white);
  for (const s of [-1, 1]) add('metal', box(0.05, 0.05, 2.4, s * (w / 2 - 0.35), h - 0.15, d / 2 - 1.3), hex(0x777777));
  for (const s of [-1, 1]) for (const e of [-1, 1]) add('trim', box(0.16, h, 0.2, s * (w / 2 - 0.08), h / 2, e * (d / 2 + 0.02)), white);
  if (hoop) addHoopLocal(add, 0, d / 2, h + 0.4);
}

// ===========================================================================
// Träd, häckar, staket
// ===========================================================================

const crowns = () => cached('crownGeos', () => [11, 23, 37].map((seed) => {
  const r = rng(seed);
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const waves = Array.from({ length: 4 }, () => [r() * 6, r() * 6, r() * 6, r() * 6]);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let k = 1;
    for (const [a, b, c, ph] of waves) k += Math.sin(x * a + y * b + z * c + ph) * 0.05;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}));

/** Lövträd: {x, z, h, s (kronans radie), seed, tint} */
export function addTree(B, world, RAPIER, { x, z, h = 7, s = 3, seed = 1, tint = 0 }) {
  if (world) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    cylCollider(world, RAPIER, body, 0.22 * s / 3, 2.5, x, z);
  }
  if (!B) return;
  const r = rng(seed);
  const tr = 0.2 * s / 3 + 0.05;
  const trunk = cyl(tr * 0.7, tr, h * 0.62, 0, 0, 0, 9);
  const uv = trunk.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * h * 0.4);
  B.add('bark', trunk.translate(x, 0, z), [1, 1, 1]);
  // Grenar ut mot kronklumparna
  const cy = h - s * 0.85;
  const blobs = [];
  const n = 5 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.6, d = s * (0.35 + r() * 0.35);
    blobs.push([Math.cos(a) * d, cy + (r() - 0.3) * s * 0.6, Math.sin(a) * d, s * (0.5 + r() * 0.25)]);
  }
  blobs.push([0, cy + s * 0.45, 0, s * 0.65]);
  for (const [bx, by, bz] of blobs.slice(0, 4)) B.add('bark', beam(x, h * 0.5, z, x + bx * 0.8, by - 0.2, z + bz * 0.8, tr * 0.5), [1, 1, 1]);
  const hue = [0.62 + tint * 0.1 + r() * 0.08, 0.86 + r() * 0.1, 0.5 + r() * 0.08];
  for (const [bx, by, bz, bs] of blobs) {
    const g = crowns()[Math.floor(r() * 3)].clone();
    g.scale(bs, bs * 0.85, bs);
    g.rotateY(r() * 6);
    g.translate(x + bx, by, z + bz);
    // Mörkare undertill, ljusare i solen överst
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const k = 0.62 + 0.5 * Math.max(0, Math.min(1, (p.getY(i) - (cy - s * 0.6)) / (s * 1.6)));
      col[i * 3] = hue[0] * k; col[i * 3 + 1] = hue[1] * k; col[i * 3 + 2] = hue[2] * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const uv2 = g.attributes.uv;
    for (let i = 0; i < uv2.count; i++) uv2.setXY(i, uv2.getX(i) * 3 * bs, uv2.getY(i) * 2 * bs);
    B.add('leaves', g, null);
  }
}

/** Häck: {x, z, w, d, h, rot} */
export function addHedge(B, world, RAPIER, { x, z, w, d = 0.7, h = 1.0, rot = 0 }) {
  if (world) boxCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), w / 2, h / 2, d / 2, x, h / 2, z, rot);
  if (!B) return;
  const g = box(w, h, d, 0, h / 2, 0, { m: 1.2 });
  // Rundade överkanter: dra in topphörnen lite
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > h - 0.01) { p.setX(i, p.getX(i) * (1 - 0.06 / w)); p.setZ(i, p.getZ(i) * 0.82); }
  g.computeVertexNormals();
  B.add('hedge', g.rotateY(rot).translate(x, 0, z), [1, 1, 1]);
}

const picket = () => cached('picketGeo', () => {
  const a = box(0.085, 0.8, 0.022, 0, 0.4, 0);
  const tip = new THREE.ConeGeometry(0.06, 0.1, 4).rotateY(Math.PI / 4).scale(1, 1, 0.26).translate(0, 0.85, 0);
  return mergeGeometries([a.toNonIndexed(), tip.toNonIndexed()]);
});

/** Vitt staket längs en polyline: points [[x, z], ...], gaps: index på delar som lämnas öppna */
export function addPicketFence(B, world, RAPIER, { points, color = 0xf4f2ec, skip = [] }) {
  const body = world ? world.createRigidBody(RAPIER.RigidBodyDesc.fixed()) : null;
  const col = hex(color);
  for (let k = 0; k < points.length - 1; k++) {
    if (skip.includes(k)) continue;
    const [ax, az] = points[k], [bx, bz] = points[k + 1];
    const len = Math.hypot(bx - ax, bz - az), rot = Math.atan2(bx - ax, bz - az);
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    if (world) boxCollider(world, RAPIER, body, 0.05, 0.45, len / 2, (ax + bx) / 2, 0.45, (az + bz) / 2, rot);
    if (!B) continue;
    const posts = Math.max(1, Math.round(len / 2.4));
    for (let p = 0; p <= posts; p++) {
      const x = ax + (bx - ax) * (p / posts), z = az + (bz - az) * (p / posts);
      B.add('trim', box(0.1, 1.0, 0.1, x, 0.5, z), col);
      B.add('trim', box(0.13, 0.04, 0.13, x, 1.02, z), col);
    }
    for (const y of [0.25, 0.65]) B.add('trim', beam(ax, y, az, bx, y, bz, 0.03, 0.08), mix(col, [0.6, 0.6, 0.6], 0.15));
    const nP = Math.floor(len / 0.15);
    for (let p = 0; p < nP; p++) {
      const s = (p + 0.5) * (len / nP);
      const g = picket().clone().rotateY(rot + Math.PI / 2);
      B.add('trim', g.translate(ax + tx * s + tz * 0.04, 0.02, az + tz * s - tx * 0.04), col);
    }
  }
}

/** Låg trädgårdsmur av tegel: {x0, z0, x1, z1, h} */
export function addGardenWall(B, world, RAPIER, { x0, z0, x1, z1, h = 0.3, t = 0.24 }) {
  const len = Math.hypot(x1 - x0, z1 - z0), rot = Math.atan2(x1 - x0, z1 - z0);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (world) boxCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), t / 2, h / 2, len / 2, cx, h / 2, cz, rot);
  if (!B) return;
  B.add('brick', box(t, h, len, 0, h / 2, 0, { m: 1 }).rotateY(rot).translate(cx, 0, cz), [1, 1, 1]);
  B.add('concrete', box(t + 0.06, 0.05, len + 0.04, 0, h + 0.025, 0, { m: 1.5 }).rotateY(rot).translate(cx, 0, cz), [0.9, 0.88, 0.84]);
}

// ===========================================================================
// Gatumöbler
// ===========================================================================

export function addLamp(B, world, RAPIER, { x, z, rot = 0 }) {
  if (world) cylCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), 0.1, 3, x, z);
  if (!B) return;
  const M = frame(x, z, rot);
  const c = hex(0x2f3a33);
  B.add('metal', cyl(0.07, 0.11, 5.2, 0, 0, 0, 10).applyMatrix4(M), c);
  B.add('metal', cyl(0.16, 0.16, 0.5, 0, 0, 0, 10).applyMatrix4(M), c);
  B.add('metal', beam(0, 5.0, 0, 0, 5.25, 1.3, 0.06).applyMatrix4(M), c);
  B.add('metal', box(0.32, 0.14, 0.62, 0, 5.2, 1.45).applyMatrix4(M), c);
  B.add('glow', box(0.26, 0.02, 0.5, 0, 5.12, 1.45).applyMatrix4(M), [1, 0.96, 0.82]);
}

export function addMailbox(B, world, RAPIER, { x, z, rot = 0, color = 0x2b2b2b, seed = 1 }) {
  if (world) boxCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), 0.1, 0.6, 0.25, x, 0.6, z, rot);
  if (!B) return;
  const M = frame(x, z, rot);
  B.add('wood', box(0.1, 1.05, 0.1, 0, 0.525, 0).applyMatrix4(M), [0.8, 0.78, 0.74]);
  B.add('metal', box(0.22, 0.16, 0.48, 0, 1.13, 0.05).applyMatrix4(M), hex(color));
  const top = new THREE.CylinderGeometry(0.11, 0.11, 0.48, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2).rotateY(0);
  B.add('metal', top.translate(0, 1.21, 0.05).applyMatrix4(M), hex(color));
  const up = (seed % 3) === 0;
  B.add('plastic', box(0.02, up ? 0.2 : 0.05, up ? 0.05 : 0.18, 0.12, up ? 1.32 : 1.18, -0.05).applyMatrix4(M), [0.9, 0.15, 0.12]);
}

export function addHydrant(B, world, RAPIER, { x, z }) {
  if (world) cylCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), 0.16, 0.75, x, z);
  if (!B) return;
  const red = hex(0xd22f22);
  B.add('metal', cyl(0.2, 0.22, 0.08, x, 0, z), red);
  B.add('metal', cyl(0.13, 0.14, 0.55, x, 0.08, z), red);
  B.add('metal', cyl(0.16, 0.16, 0.06, x, 0.6, z), red);
  B.add('metal', new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, 0.66, z), red);
  B.add('metal', cyl(0.03, 0.03, 0.06, x, 0.78, z, 6), red);
  for (const a of [0, Math.PI / 2, Math.PI]) {
    const g = new THREE.CylinderGeometry(0.06, 0.06, 0.14, 10).rotateZ(Math.PI / 2).translate(0.15, 0.42, 0).rotateY(a);
    B.add('metal', g.translate(x, 0, z), a === Math.PI / 2 ? hex(0xe8c040) : red);
  }
}

export function addBin(B, world, RAPIER, { x, z, rot = 0, color = 0x2d6a3e }) {
  if (world) boxCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), 0.32, 0.53, 0.36, x, 0.53, z, rot);
  if (!B) return;
  const M = frame(x, z, rot);
  const c = hex(color);
  const body = new THREE.CylinderGeometry(0.42, 0.34, 0.95, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 1.1).translate(0, 0.55, 0);
  B.add('plastic', body.applyMatrix4(M), c);
  B.add('plastic', box(0.66, 0.06, 0.74, 0, 1.05, 0.02).applyMatrix4(M), mix(c, [0, 0, 0], 0.2));
  for (const s of [-1, 1]) B.add('rubber', new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10).rotateZ(Math.PI / 2).translate(s * 0.26, 0.1, -0.34).applyMatrix4(M));
}

// Avspärrning (sågbock) med orange-vita brädor: {x, z, rot, w}
export function addBarricade(B, world, RAPIER, { x, z, rot = 0, w = 1.8 }) {
  if (world) boxCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), w / 2, 0.45, 0.25, x, 0.45, z, rot);
  if (!B) return;
  const M = frame(x, z, rot);
  for (const y of [0.55, 0.85]) {
    const g = box(w, 0.2, 0.03, 0, y, 0);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 2, uv.getY(i));
    B.add('stripes', g.applyMatrix4(M));
  }
  for (const s of [-1, 1]) for (const f of [-1, 1]) B.add('metal', beam(s * (w / 2 - 0.1), 0.95, 0, s * (w / 2 - 0.1), 0, f * 0.3, 0.04).applyMatrix4(M), hex(0x8a8a8a));
  B.add('glow', box(0.1, 0.1, 0.08, -w / 2 + 0.1, 1.0, 0).applyMatrix4(M), [1, 0.7, 0.2]);
}

// Tegelstenar staplade (som under en hemmabyggd ramp)
export function addBrickStack(B, world, RAPIER, { x, z, rot = 0, layers = 3, seed = 1 }) {
  if (world) boxCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), 0.12, layers * 0.035, 0.1, x, layers * 0.035, z, rot);
  if (!B) return;
  const r = rng(seed);
  for (let l = 0; l < layers; l++) {
    const g = box(0.22, 0.065, 0.1, 0, l * 0.07 + 0.035, 0, { m: 0.25 }).rotateY(rot + (l % 2) * Math.PI / 2 + (r() - 0.5) * 0.15);
    B.add('brick', g.translate(x + (r() - 0.5) * 0.03, 0, z + (r() - 0.5) * 0.03), [1, 0.95, 0.9]);
  }
}

// ===========================================================================
// Fullstora bilar (personbil och pickup) som skalreferens
// ===========================================================================

function profileGeo(points, depth, bevel = 0.04) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** {x, z, rot, kind: 'sedan'|'pickup', color} — längden längs lokal x */
export function addCar(B, world, RAPIER, { x, z, rot = 0, kind = 'sedan', color = 0x8c1d22 }) {
  const P = kind === 'pickup';
  const L = P ? 5.6 : 4.8, W = P ? 1.95 : 1.8, wr = P ? 0.4 : 0.33;
  if (world) {
    const body = fixedBody(world, RAPIER, x, z, rot);
    boxCollider(world, RAPIER, body, L / 2, 0.7, W / 2, 0, 0.75, 0);
  }
  if (!B) return;
  const M = frame(x, z, rot);
  const add = (key, g, col) => B.add(key, g.applyMatrix4(M), col);
  const paint = hex(color);
  const cl = P ? 0.32 : 0.2; // markfrigång under karossen
  if (!P) {
    add('carPaint', profileGeo([[-2.35, cl], [2.35, cl], [2.38, 0.62], [2.2, 0.86], [1.25, 0.95], [-1.3, 0.98], [-2.25, 0.92], [-2.38, 0.66]], W - 0.1), paint);
    add('glass', profileGeo([[-1.25, 0.95], [1.15, 0.94], [0.45, 1.36], [-0.75, 1.38]], W - 0.24, 0.02));
    add('carPaint', profileGeo([[-0.8, 1.36], [0.48, 1.34], [0.46, 1.42], [-0.76, 1.44]], W - 0.3, 0.03), paint);
  } else {
    add('carPaint', profileGeo([[-2.75, cl], [2.75, cl], [2.8, 0.85], [2.65, 1.2], [1.6, 1.25], [1.6, 1.25], [-0.3, 1.25], [-0.3, 1.0], [-2.75, 1.0]], W - 0.1), paint);
    add('glass', profileGeo([[-0.25, 1.24], [1.5, 1.24], [0.85, 1.78], [-0.15, 1.8]], W - 0.24, 0.02));
    add('carPaint', profileGeo([[-0.18, 1.78], [0.88, 1.76], [0.86, 1.86], [-0.16, 1.88]], W - 0.3, 0.03), paint);
    // Flaket: golv och kanter
    add('carPaint', box(2.4, 0.1, 0.1, -1.55, 1.3, W / 2 - 0.1), paint);
    add('carPaint', box(2.4, 0.1, 0.1, -1.55, 1.3, -W / 2 + 0.1), paint);
    add('metal', box(2.35, 0.03, W - 0.3, -1.55, 1.02, 0), hex(0x333333));
  }
  // Hjul, fälgar och hjulhus
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wx = sx * (P ? 1.85 : 1.5), wz = sz * (W / 2 - 0.1);
    add('rubber', new THREE.CylinderGeometry(wr, wr, 0.26, 18).rotateX(Math.PI / 2).translate(wx, wr, wz));
    add('metal', new THREE.CylinderGeometry(wr * 0.58, wr * 0.58, 0.27, 12).rotateX(Math.PI / 2).translate(wx, wr, wz), hex(0xc8c8c8));
    add('rubber', box(wr * 2.4, 0.08, 0.2, wx, wr * 2 + 0.04, wz * 1.04));
  }
  // Lyktor och stötfångare
  const fx = L / 2 + 0.01;
  for (const sz of [-1, 1]) {
    add('glow', box(0.06, 0.12, 0.32, fx, P ? 0.95 : 0.72, sz * (W / 2 - 0.3)), [1, 0.97, 0.88]);
    add('plastic', box(0.06, 0.14, 0.3, -fx, P ? 0.95 : 0.76, sz * (W / 2 - 0.28)), [0.85, 0.08, 0.08]);
  }
  for (const s of [-1, 1]) add('metal', box(0.16, 0.16, W - 0.05, s * (L / 2 + 0.03), cl + 0.12, 0), P ? hex(0xbdbdbd) : hex(0x2a2a2a));
  add('metal', box(0.03, 0.22, 0.8, fx + 0.02, (P ? 0.75 : 0.55), 0), hex(0x222222));
  // Backspeglar
  for (const sz of [-1, 1]) add('carPaint', box(0.12, 0.1, 0.2, P ? 1.2 : 0.95, P ? 1.35 : 1.05, sz * (W / 2 + 0.05)), paint);
}

// ===========================================================================
// Lekplats
// ===========================================================================

export function addSwingSet(B, world, RAPIER, { x, z, rot = 0 }) {
  const w = 3.2, h = 2.2;
  if (world) {
    const body = fixedBody(world, RAPIER, x, z, rot);
    for (const s of [-1, 1]) boxCollider(world, RAPIER, body, 0.08, h / 2, 0.7, s * w / 2, h / 2, 0);
  }
  if (!B) return;
  const M = frame(x, z, rot);
  const c = hex(0x3a7fc2), y = hex(0xf2c230);
  for (const s of [-1, 1]) for (const f of [-1, 1]) B.add('metal', beam(s * w / 2, h, 0, s * (w / 2 + 0.1), 0, f * 0.85, 0.07).applyMatrix4(M), c);
  B.add('metal', beam(-w / 2 - 0.1, h, 0, w / 2 + 0.1, h, 0, 0.08).applyMatrix4(M), c);
  for (const sx of [-0.8, 0.8]) {
    for (const k of [-0.22, 0.22]) B.add('metal', beam(sx + k, h, 0, sx + k, 0.5, 0, 0.015).applyMatrix4(M), hex(0x999999));
    B.add('plastic', box(0.5, 0.04, 0.2, sx, 0.5, 0).applyMatrix4(M), y);
  }
}

export function addSlide(B, world, RAPIER, { x, z, rot = 0 }) {
  if (world) boxCollider(world, RAPIER, fixedBody(world, RAPIER, x, z, rot), 0.4, 0.8, 1.5, 0, 0.8, 0);
  if (!B) return;
  const M = frame(x, z, rot);
  const red = hex(0xd23a2a), grey = hex(0x8c8c8c);
  // Stege och plattform
  for (const s of [-1, 1]) B.add('metal', beam(s * 0.25, 0, -1.4, s * 0.25, 1.6, -0.9, 0.05).applyMatrix4(M), grey);
  for (let k = 1; k < 5; k++) B.add('metal', box(0.5, 0.03, 0.06, 0, k * 0.32, -1.4 + k * 0.1).applyMatrix4(M), grey);
  B.add('plastic', box(0.7, 0.06, 0.6, 0, 1.6, -0.75).applyMatrix4(M), hex(0xf2c230));
  // Rutschkanan
  const len = Math.hypot(2.2, 1.55), ang = Math.atan2(1.55, 2.2);
  const g = box(0.55, 0.05, len, 0, 0, 0).rotateX(ang);
  B.add('plastic', g.translate(0, 0.85, 0.65).applyMatrix4(M), red);
  for (const s of [-1, 1]) B.add('plastic', box(0.04, 0.15, len, 0, 0, 0).rotateX(ang).translate(s * 0.28, 0.92, 0.65).applyMatrix4(M), red);
}

export function addSandbox(B, world, RAPIER, { x, z, rot = 0, s = 2 }) {
  if (world) {
    const body = fixedBody(world, RAPIER, x, z, rot);
    for (const [hx, hz, px, pz] of [[s / 2, 0.06, 0, s / 2], [s / 2, 0.06, 0, -s / 2], [0.06, s / 2, s / 2, 0], [0.06, s / 2, -s / 2, 0]]) boxCollider(world, RAPIER, body, hx, 0.12, hz, px, 0.12, pz);
  }
  if (!B) return;
  const M = frame(x, z, rot);
  for (const [w, d, px, pz] of [[s + 0.12, 0.12, 0, s / 2], [s + 0.12, 0.12, 0, -s / 2], [0.12, s, s / 2, 0], [0.12, s, -s / 2, 0]]) B.add('wood', box(w, 0.24, d, px, 0.12, pz, { m: 1 }).applyMatrix4(M), [0.85, 0.7, 0.5]);
  const sand = new THREE.PlaneGeometry(s - 0.1, s - 0.1, 6, 6).rotateX(-Math.PI / 2);
  const p = sand.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, 0.15 + Math.sin(p.getX(i) * 3) * Math.cos(p.getZ(i) * 2.5) * 0.03);
  sand.computeVertexNormals();
  B.add('sand', sand.applyMatrix4(M), [1, 0.98, 0.94]);
  // Hink och spade
  B.add('plastic', cyl(0.11, 0.08, 0.18, 0.4, 0.15, 0.3, 12).applyMatrix4(M), hex(0x2a8ad8));
  B.add('plastic', box(0.06, 0.03, 0.35, -0.3, 0.2, -0.2).rotateY(0.6).applyMatrix4(M), hex(0xf0d020));
  B.add('plastic', new THREE.SphereGeometry(0.16, 12, 8).translate(-0.5, 0.31, 0.4).applyMatrix4(M), hex(0xe04050));
}

// ===========================================================================
// Rondellens ö: kantsten, gräs, blommor och en flaggstång
// ===========================================================================

export function addIsland(B, world, RAPIER, { x, z, r }) {
  if (world) cylCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), r, 0.18, x, z);
  if (!B) return;
  const ring = new THREE.CylinderGeometry(r, r, 0.18, 40, 1, true).translate(x, 0.09, z);
  B.add('concrete', ring, [0.92, 0.91, 0.88]);
  B.add('concrete', new THREE.RingGeometry(r - 0.25, r, 40).rotateX(-Math.PI / 2).translate(x, 0.181, z), [0.92, 0.91, 0.88]);
  const lawn = new THREE.CircleGeometry(r - 0.25, 40).rotateX(-Math.PI / 2).translate(x, 0.2, z);
  B.add('hedge', lawn, [1.15, 1.25, 1.0]);
  const rr = rng(77);
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2, d = r - 0.7;
    const add = (key, g, col) => B.add(key, g.translate(0, 0.18, 0), col);
    if (k % 2) addFlowers(add, x + Math.cos(a) * d, z + Math.sin(a) * d, rr);
    else addShrub(add, x + Math.cos(a) * d, z + Math.sin(a) * d, 0.35, rr);
  }
  B.add('metal', cyl(0.05, 0.07, 7, x, 0.18, z, 8), [0.9, 0.9, 0.9]);
  B.add('metal', new THREE.SphereGeometry(0.1, 8, 6).translate(x, 7.25, z), hex(0xd8b040));
  // Vimpel (enkel flagga i trafikgult och blått)
  const flag = box(1.4, 0.8, 0.02, x + 0.75, 6.6, z);
  B.add('plastic', flag, hex(0x2a5db0));
  B.add('plastic', box(1.42, 0.2, 0.025, x + 0.75, 6.6, z), hex(0xf2c230));
}

// ===========================================================================
// Horisont: enkla hus och trädkronor i diset, plus moln
// ===========================================================================

export function addFarHouse(B, { x, z, rot, w = 10, d = 8, h = 5.6, seed = 1 }) {
  if (!B) return;
  const r = rng(seed);
  const M = frame(x, z, rot);
  const sc = hex(SIDING[Math.floor(r() * SIDING.length)]), rc = hex(ROOFS[Math.floor(r() * ROOFS.length)]);
  B.add('far', box(w, h, d, 0, h / 2, 0).applyMatrix4(M), sc);
  const rise = d * 0.32;
  const shape = new THREE.Shape([new THREE.Vector2(-d / 2 - 0.4, 0), new THREE.Vector2(d / 2 + 0.4, 0), new THREE.Vector2(0, rise)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: w + 0.6, bevelEnabled: false }).translate(0, 0, -(w + 0.6) / 2).rotateY(Math.PI / 2).translate(0, h, 0);
  B.add('far', g.applyMatrix4(M), rc);
  // Fönsterrader som mörka band
  for (const y of [1.6, 4.2]) B.add('far', box(w * 0.75, 0.9, 0.05, 0, y, d / 2 + 0.03).applyMatrix4(M), mix(sc, [0.2, 0.25, 0.3], 0.7));
}

export function addFarTrees(B, list) {
  if (!B) return;
  for (const { x, z, s, seed } of list) {
    const r = rng(seed);
    const g = crowns()[seed % 3].clone().scale(s, s * 0.9, s).translate(x, s * 1.3, z);
    const c = [0.24 + r() * 0.06, 0.38 + r() * 0.08, 0.2];
    B.add('far', g, c);
    B.add('far', cyl(s * 0.1, s * 0.14, s * 0.6, x, 0, z, 6), [0.36, 0.3, 0.24]);
  }
}

function cloudTexture() {
  return cached('cloudTex', () => {
    const [c, ctx] = canvas(256, 128);
    const r = rng(501);
    for (let i = 0; i < 26; i++) {
      const x = 40 + r() * 176, y = 50 + r() * 40 - Math.abs(x - 128) * 0.15, rad = 18 + r() * 30;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.6, 'rgba(250,250,255,0.5)'); g.addColorStop(1, 'rgba(240,245,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    }
    return toTex(c, { repeat: false });
  });
}

export function addClouds(scene, { count = 10, dist = 170, seed = 7 } = {}) {
  if (!scene) return;
  const r = rng(seed);
  const mat = new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
  const geos = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + r() * 0.4, d = dist * (0.85 + r() * 0.15);
    const w = 40 + r() * 40;
    const g = new THREE.PlaneGeometry(w, w * 0.4);
    g.lookAt(new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)));
    g.translate(Math.cos(a) * d, 28 + r() * 30, Math.sin(a) * d);
    geos.push(g);
  }
  const m = new THREE.Mesh(mergeGeometries(geos), mat);
  m.renderOrder = -1;
  scene.add(m);
}

// ===========================================================================
// Lösa saker: fotboll och plastkon som bilarna kan putta på
// ===========================================================================

function ballTexture() {
  return cached('ballTex', () => {
    const [c, ctx] = canvas(256, 128);
    ctx.fillStyle = '#f6f6f2'; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#1e1e1e';
    for (let i = 0; i < 12; i++) {
      const x = (i % 6) * 44 + (Math.floor(i / 6) % 2) * 22 + 10, y = Math.floor(i / 6) * 64 + 30;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 - Math.PI / 2; ctx.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13); }
      ctx.fill();
    }
    return toTex(c, { repeat: false });
  });
}

export function addLooseBall(scene, world, RAPIER, { x, z, r = 0.11, mass = 0.07 }) {
  let body = null;
  if (world) {
    body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, r + 0.01, z).setLinearDamping(0.25).setAngularDamping(0.4));
    world.createCollider(RAPIER.ColliderDesc.ball(r).setDensity(0).setMass(mass).setFriction(0.6).setRestitution(0.65).setCollisionGroups(groups(G.PROP)), body);
  }
  let mesh = null;
  if (scene) {
    mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.5 }));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(x, r + 0.01, z);
    scene.add(mesh);
  }
  return { body, mesh, kind: 'ball', spawn: { x, y: r + 0.01, z } };
}

// ===========================================================================
// Byggplatsen: plankstaket, koner, bom, grävmaskin, jordhögar och tunnel
// ===========================================================================

/** Tätt brädstaket (plankstaket) längs en polyline, med kollision. */
export function addPlankFence(B, world, RAPIER, { points, h = 1.6, color = 0xb59a7a }) {
  const body = world ? world.createRigidBody(RAPIER.RigidBodyDesc.fixed()) : null;
  const col = hex(color), post = mix(col, [0.2, 0.15, 0.1], 0.35);
  for (let k = 0; k < points.length - 1; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const rot = Math.atan2(bx - ax, bz - az);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    if (world) boxCollider(world, RAPIER, body, 0.04, h / 2, len / 2, cx, h / 2, cz, rot);
    if (!B) continue;
    B.add('wood', box(0.04, h, len, 0, h / 2, 0, { m: 1.3 }).rotateY(rot).translate(cx, 0, cz), col);
    // Överliggare och stolpar
    B.add('wood', box(0.09, 0.05, len + 0.02, 0, h + 0.02, 0, { m: 1 }).rotateY(rot).translate(cx, 0, cz), post);
    const posts = Math.max(1, Math.round(len / 2.4));
    for (let p = 0; p <= posts; p++) {
      const x = ax + (bx - ax) * (p / posts), z = az + (bz - az) * (p / posts);
      B.add('wood', box(0.11, h + 0.12, 0.11, 0, (h + 0.12) / 2, 0).rotateY(rot).translate(x, 0, z), post);
    }
  }
}

/** Fullstor trafikkon (fast, står alltid utanför vägen). */
export function addCone(B, world, RAPIER, { x, z, s = 1 }) {
  if (world) cylCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), 0.17 * s, 0.7 * s, x, z);
  if (!B) return;
  B.add('rubber', box(0.42 * s, 0.04 * s, 0.42 * s, x, 0.02 * s, z));
  B.add('plastic', new THREE.ConeGeometry(0.17 * s, 0.66 * s, 10, 1, true).translate(x, 0.37 * s, z), hex(0xff6a12));
  B.add('plastic', new THREE.CylinderGeometry(0.083 * s, 0.11 * s, 0.13 * s, 10, 1, true).translate(x, 0.43 * s, z), [0.97, 0.97, 0.95]);
}

// Bom i rött och vitt: stolpe med motvikt och en uppfälld arm (armen pekar mot lokal +x)
export function addBoomGate(B, world, RAPIER, { x, z, rot = 0, len = 4.6, raise = 1.25 }) {
  if (world) boxCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), 0.28, 0.6, 0.28, x, 0.6, z, rot);
  if (!B) return;
  const M = frame(x, z, rot);
  const add = (key, g, col) => B.add(key, g.applyMatrix4(M), col);
  const red = hex(0xd3201c), white = [0.96, 0.96, 0.94];
  add('metal', box(0.5, 1.05, 0.45, 0, 0.525, 0), hex(0xe9e6df));
  add('metal', box(0.52, 0.12, 0.47, 0, 0.98, 0), red);
  add('metal', box(0.5, 0.06, 0.45, 0, 0.03, 0), hex(0x444444));
  const py = 1.12, c = Math.cos(raise), s = Math.sin(raise);
  add('metal', new THREE.CylinderGeometry(0.1, 0.1, 0.5, 10).rotateX(Math.PI / 2).translate(0, py, 0), hex(0x555555));
  // Motvikt bakom vridpunkten
  add('metal', beam(-c * 0.25, py - s * 0.25, 0, -c * 0.85, py - s * 0.85, 0, 0.26, 0.2), hex(0x3a3a3a));
  const segs = 9;
  for (let k = 0; k < segs; k++) {
    const u0 = 0.1 + (k / segs) * len, u1 = 0.1 + ((k + 1) / segs) * len;
    add('plastic', beam(c * u0, py + s * u0, 0, c * u1, py + s * u1, 0, 0.11, 0.07), k % 2 ? white : red);
  }
  add('glow', box(0.08, 0.08, 0.1, c * (len + 0.1), py + s * (len + 0.1), 0), [1, 0.25, 0.15]);
}

// Vaktkur vid bommen: vit kur med fönster och rödvit list
export function addBooth(B, world, RAPIER, { x, z, rot = 0 }) {
  const W = 1.6, D = 1.6, H = 2.3;
  if (world) boxCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), W / 2, H / 2, D / 2, x, H / 2, z, rot);
  if (!B) return;
  const M = frame(x, z, rot);
  const add = (key, g, col) => B.add(key, g.applyMatrix4(M), col);
  add('siding', box(W, H, D, 0, H / 2, 0, { m: 2 }), [0.96, 0.95, 0.92]);
  add('trim', box(W + 0.3, 0.12, D + 0.3, 0, H + 0.06, 0), [0.25, 0.27, 0.3]);
  for (const [lx, lz, ry] of [[0, D / 2 + 0.01, 0], [W / 2 + 0.01, 0, Math.PI / 2], [-W / 2 - 0.01, 0, -Math.PI / 2]]) {
    add('window', cellPlane(1.0, 0.9, WIN_CELLS[0]).rotateY(ry).translate(lx, 1.45, lz));
  }
  for (let k = 0; k < 8; k++) add('plastic', box(W / 8 + 0.002, 0.16, D + 0.03, -W / 2 + (k + 0.5) * W / 8, H - 0.18, 0), k % 2 ? [0.96, 0.96, 0.94] : hex(0xd3201c));
}

/** Stor gul grävmaskin på band. Lokal ram: armen pekar mot +x. */
export function addDigger(B, world, RAPIER, { x, z, rot = 0, swing = 0 }) {
  if (world) {
    const body = fixedBody(world, RAPIER, x, z, rot);
    boxCollider(world, RAPIER, body, 2.0, 1.2, 1.45, 0, 1.2, 0);
    boxCollider(world, RAPIER, body, 0.6, 0.6, 0.6, Math.cos(swing) * 5.2, 0.6, -Math.sin(swing) * 5.2, swing);
  }
  if (!B) return;
  const M = frame(x, z, rot);
  const add = (key, g, col) => B.add(key, g.applyMatrix4(M), col);
  const yellow = hex(0xf2b705), dark = hex(0x2b2b2b), steel = hex(0x5b5e62), black = [0.08, 0.08, 0.08];
  // Band och hjul
  for (const s of [-1, 1]) {
    const tz = s * 1.05;
    add('rubber', box(3.6, 0.55, 0.62, 0, 0.42, tz));
    for (const ex of [-1.55, 1.55]) add('rubber', new THREE.CylinderGeometry(0.42, 0.42, 0.62, 14).rotateX(Math.PI / 2).translate(ex, 0.42, tz));
    for (let k = -1; k <= 1; k++) add('metal', new THREE.CylinderGeometry(0.15, 0.15, 0.66, 8).rotateX(Math.PI / 2).translate(k * 0.75, 0.32, tz), steel);
    add('metal', box(3.2, 0.12, 0.3, 0, 0.66, tz * 0.82), yellow);
  }
  add('metal', box(2.2, 0.4, 1.5, 0, 0.62, 0), dark);
  // Överdel (vriden swing runt y)
  const U = new THREE.Matrix4().makeRotationY(swing);
  const up = (key, g, col) => add(key, g.applyMatrix4(U), col);
  up('metal', new THREE.CylinderGeometry(0.9, 0.9, 0.22, 16).translate(0, 0.93, 0), dark);
  up('carPaint', box(3.0, 1.05, 2.4, -0.35, 1.58, 0), yellow);
  up('carPaint', box(0.75, 1.0, 2.4, -2.1, 1.55, 0), mix(yellow, [0.2, 0.18, 0.1], 0.25)); // motvikt
  up('metal', box(0.04, 0.12, 2.42, -2.47, 1.3, 0), black);
  // Hytt med glas
  up('carPaint', box(1.15, 1.55, 1.0, 0.45, 2.88, 0.64), yellow);
  up('glass', box(1.17, 0.95, 1.02, 0.47, 3.05, 0.64));
  up('carPaint', box(1.2, 0.08, 1.05, 0.45, 3.68, 0.64), yellow);
  up('metal', cyl(0.06, 0.06, 0.7, -1.2, 2.1, -0.7, 8), dark); // avgasrör
  up('metal', box(1.3, 0.25, 0.9, -1.0, 2.2, -0.45), mix(yellow, [0, 0, 0], 0.1));
  // Bom, sticka och skopa
  const bz = -0.25;
  const P = [[1.0, 1.85], [2.6, 3.9], [4.4, 3.95], [5.3, 1.5]];
  up('carPaint', beam(P[0][0], P[0][1], bz, P[1][0], P[1][1], bz, 0.42, 0.5), yellow);
  up('carPaint', beam(P[1][0], P[1][1], bz, P[2][0], P[2][1], bz, 0.42, 0.45), yellow);
  up('carPaint', beam(P[2][0] - 0.1, P[2][1] + 0.1, bz, P[3][0], P[3][1], bz, 0.32, 0.36), yellow);
  // Hydraulcylindrar
  up('metal', beam(0.9, 1.4, bz, 2.25, 3.35, bz, 0.13), steel);
  up('metal', beam(1.6, 2.85, bz, 2.35, 3.8, bz, 0.09), [0.85, 0.85, 0.87]);
  up('metal', beam(2.9, 4.25, bz, 4.25, 4.35, bz, 0.12), steel);
  up('metal', beam(4.6, 3.6, bz, 5.1, 2.1, bz, 0.1), steel);
  // Skopa: kil med tänder
  const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.75, 0.15), new THREE.Vector2(0.8, 0.7), new THREE.Vector2(0.1, 0.75)]);
  const bucket = new THREE.ExtrudeGeometry(sh, { depth: 0.9, bevelEnabled: false }).translate(-0.4, -0.75, -0.45);
  up('metal', bucket.translate(P[3][0], P[3][1], bz), mix(yellow, [0.2, 0.2, 0.2], 0.55));
  for (let k = 0; k < 4; k++) up('metal', box(0.18, 0.08, 0.07, P[3][0] - 0.38, P[3][1] - 0.77, bz - 0.33 + k * 0.22), [0.7, 0.7, 0.7]);
  // Varningsljus på taket
  up('glow', box(0.14, 0.12, 0.14, 0.2, 3.78, 0.4), [1, 0.6, 0.1]);
}

/** Jordfläck på marken (dekal) som en oregelbunden ellips. */
export function addDirtPatch(B, { x, z, rx, rz, rot = 0, seed = 1, y = 0.012, col = [1, 1, 1] }) {
  if (!B) return;
  const r = rng(seed);
  const g = new THREE.CircleGeometry(1, 28);
  const p = g.attributes.position;
  const ph = r() * 6, ph2 = r() * 6;
  for (let i = 1; i < p.count; i++) {
    const a = Math.atan2(p.getY(i), p.getX(i));
    const k = 1 + 0.12 * Math.sin(a * 3 + ph) + 0.07 * Math.sin(a * 7 + ph2);
    p.setXY(i, p.getX(i) * rx * k, p.getY(i) * rz * k);
  }
  g.rotateX(-Math.PI / 2).rotateY(rot).translate(x, y, z);
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 3, p.getZ(i) / 3);
  B.add('dirt', g, col);
}

/** Jordhög: knölig kulle. */
export function addDirtPile(B, world, RAPIER, { x, z, r: rad = 1.5, h = 1.0, seed = 1, collide = true }) {
  if (world && collide) cylCollider(world, RAPIER, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()), rad * 0.75, h * 0.7, x, z);
  if (!B) return;
  const r = rng(seed);
  const g = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position;
  const ph = r() * 6;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const k = 1 + 0.15 * Math.sin(a * 3 + ph) + (r() - 0.5) * 0.08;
    p.setXYZ(i, p.getX(i) * rad * k, p.getY(i) * h * (0.9 + r() * 0.2), p.getZ(i) * rad * k);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 2 + x, p.getZ(i) / 2 + p.getY(i));
  B.add('earth', g.translate(x, -0.02, z), [0.95, 0.9, 0.85]);
}

/**
 * Jordtunnel genom en kulle: vägen mellan index i0 och i1 (framåt) går genom
 * ett timrat schakt med svaga lampor. Kullen byggs som ett höjdfält som aldrig
 * täcker vägen utanför tunneln. roadNear(x, z): avstånd till närmaste väg.
 */
export function addTunnel(B, world, RAPIER, { track, i0, i1, height = 2.5, wallOff = 2.45, mound = 3.8, fall = [5, 4], side = 11, roadNear }) {
  const { pts, normals, tangents, N } = track;
  const idx = [], wall = [];
  for (let i = i0; ; i = (i + 1) % N) { idx.push(i); if (i === i1) break; }
  // Väggarna går en bit ut förbi portalerna (timrade stödmurar i schaktet)
  const wx = Math.round(3 / track.spacing);
  for (let k = -wx; k < idx.length + wx; k++) wall.push((i0 + k + N) % N);
  // Väggar (kollision) längs tunneln
  if (world) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (let k = 0; k < wall.length - 1; k += 2) {
      const a = pts[wall[k]], b = pts[wall[Math.min(wall.length - 1, k + 2)]];
      const len = Math.hypot(b.x - a.x, b.z - a.z), rot = Math.atan2(b.x - a.x, b.z - a.z);
      const n = normals[wall[Math.min(wall.length - 1, k + 1)]];
      for (const s of [-1, 1]) {
        boxCollider(world, RAPIER, body, 0.2, height / 2, len / 2 + 0.05, (a.x + b.x) / 2 + n.x * s * (wallOff + 0.2), height / 2, (a.z + b.z) / 2 + n.z * s * (wallOff + 0.2), rot);
      }
    }
  }
  if (!B) return;
  const plank = [0.24, 0.18, 0.13], earthC = [0.5, 0.4, 0.3], timber = [0.36, 0.27, 0.19];
  // Brädfodrade väggar (även stödmurarna utanför) och jordtak
  for (let k = 0; k < wall.length - 1; k += 2) {
    const a = pts[wall[k]], b = pts[wall[Math.min(wall.length - 1, k + 2)]], n = normals[wall[k]];
    for (const s of [-1, 1]) {
      const o = s * (wallOff + 0.1);
      B.add('wood', beam(a.x + n.x * o, height / 2, a.z + n.z * o, b.x + n.x * o, height / 2, b.z + n.z * o, 0.2, height), plank);
    }
  }
  for (let k = 0; k < idx.length - 1; k += 2) {
    const a = pts[idx[k]], b = pts[idx[Math.min(idx.length - 1, k + 2)]];
    B.add('earth', beam(a.x, height + 0.12, a.z, b.x, height + 0.12, b.z, wallOff * 2 + 0.6, 0.24), [0.32, 0.26, 0.2]);
  }
  // Timmerramar och lampor
  const L = track.dist[idx[idx.length - 1]] - track.dist[idx[0]] || 1;
  let lastFrame = -9, lastLamp = -9;
  for (const i of idx) {
    const s = track.dist[i] - track.dist[idx[0]];
    if (s - lastFrame < 2.2 && s < L - 0.3) continue;
    lastFrame = s;
    const p = pts[i], n = normals[i];
    for (const sd of [-1, 1]) {
      const o = sd * (wallOff - 0.1);
      B.add('wood', box(0.24, height, 0.24, p.x + n.x * o, height / 2, p.z + n.z * o), timber);
    }
    B.add('wood', beam(p.x + n.x * (wallOff + 0.1), height - 0.14, p.z + n.z * (wallOff + 0.1), p.x - n.x * (wallOff + 0.1), height - 0.14, p.z - n.z * (wallOff + 0.1), 0.26, 0.26), timber);
    if (s - lastLamp > 4.5 && s > 1 && s < L - 1) {
      lastLamp = s;
      B.add('metal', box(0.03, 0.25, 0.03, p.x, height - 0.38, p.z), [0.15, 0.15, 0.15]);
      B.add('glow', box(0.2, 0.14, 0.2, p.x, height - 0.56, p.z), [1.0, 0.72, 0.38]);
      B.add('metal', box(0.26, 0.04, 0.26, p.x, height - 0.48, p.z), [0.2, 0.2, 0.2]);
    }
  }
  // Portaler: timmerram och jordvägg ovanför öppningen
  for (const [i, dir] of [[idx[0], -1], [idx[idx.length - 1], 1]]) {
    const p = pts[i], n = normals[i], t = tangents[i];
    const ox = p.x + t.x * dir * 0.15, oz = p.z + t.z * dir * 0.15;
    const rot = Math.atan2(n.x, n.z);
    const wide = wallOff * 2 + 3;
    // box(w, h, d): lokal z längs normalen (tvärs vägen)
    B.add('earth', box(0.5, mound - height + 0.4, wide, 0, height + (mound - height + 0.4) / 2, 0, { m: 2 }).rotateY(rot).translate(ox, 0, oz), earthC);
    for (const s of [-1, 1]) {
      const o = s * (wallOff + 0.9);
      B.add('earth', box(0.5, height, 1.6, 0, height / 2, 0, { m: 2 }).rotateY(rot).translate(ox + n.x * o, 0, oz + n.z * o), earthC);
      B.add('wood', box(0.34, height + 0.25, 0.34, ox + n.x * s * (wallOff + 0.05), (height + 0.25) / 2, oz + n.z * s * (wallOff + 0.05)), timber);
    }
    B.add('wood', beam(ox + n.x * (wallOff + 0.4), height + 0.12, oz + n.z * (wallOff + 0.4), ox - n.x * (wallOff + 0.4), height + 0.12, oz - n.z * (wallOff + 0.4), 0.38, 0.38), timber);
  }
  // Kullen: höjdfält kring tunneln
  const cl = idx.map((i) => pts[i]);
  const ref = (x, z) => {
    let best = 0, bd = Infinity;
    for (let k = 0; k < cl.length; k++) { const d = (cl[k].x - x) ** 2 + (cl[k].z - z) ** 2; if (d < bd) { bd = d; best = k; } }
    const i = idx[best], t = tangents[i], n = normals[i];
    const dx = x - pts[i].x, dz = z - pts[i].z;
    return { s: track.dist[i] - track.dist[idx[0]] + dx * t.x + dz * t.z, d: dx * n.x + dz * n.z };
  };
  const sm = (e0, e1, v) => { const u = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };
  const t0 = tangents[idx[0]], n0 = normals[idx[0]], c0 = pts[idx[0]];
  const ext = fall[0] + 1, ext2 = fall[1] + 1;
  const cols = Math.ceil((L + ext + ext2) / 0.8), rows = Math.ceil((side * 2) / 0.8);
  const r = rng(991);
  const V = [];
  for (let a = 0; a <= cols; a++) for (let b = 0; b <= rows; b++) {
    const ss = -ext + (a / cols) * (L + ext + ext2), dd = -side + (b / rows) * side * 2;
    const x = c0.x + t0.x * ss + n0.x * dd, z = c0.z + t0.z * ss + n0.z * dd;
    const q = ref(x, z);
    const out = q.s < 0 ? -q.s : q.s > L ? q.s - L : 0;
    // Rundad fotplatta: avstånd utanför platån, normerat per riktning
    const os = out / (q.s < 0 ? fall[0] : fall[1]), od = Math.max(0, Math.abs(q.d) - wallOff - 1.2) / (side - wallOff - 1.2);
    const rr2 = Math.hypot(os, od);
    let h = mound * (1 - sm(0, 1, rr2)) * (0.92 + 0.16 * Math.sin(x * 0.7 + z * 0.4) * Math.cos(z * 0.9 - x * 0.3)) + (r() - 0.5) * 0.06;
    const inside = q.s >= -0.2 && q.s <= L + 0.2 && Math.abs(q.d) <= wallOff + 0.6;
    if (inside) h = Math.max(h, height + 0.35);
    else if (roadNear(x, z) < wallOff + 0.3) h = 0;
    V.push({ x, z, h: Math.max(0, h), inside });
  }
  const pos = [], uvs = [], colr = [];
  const vtx = (v) => {
    pos.push(v.x, v.h, v.z); uvs.push(v.x / 2.5, v.z / 2.5 + v.h / 2.5);
    const k = 0.75 + Math.min(1, v.h / mound) * 0.3;
    colr.push(0.62 * k, 0.5 * k, 0.38 * k);
  };
  for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
    const A = V[a * (rows + 1) + b], Bv = V[(a + 1) * (rows + 1) + b], C = V[(a + 1) * (rows + 1) + b + 1], D = V[a * (rows + 1) + b + 1];
    for (const tri of [[A, Bv, C], [A, C, D]]) {
      if (Math.max(tri[0].h, tri[1].h, tri[2].h) < 0.05) continue;
      // Portalens öppning: ingen yta mellan taket och marken framför tunneln
      if (tri.some((v) => v.inside) && tri.some((v) => !v.inside && v.h < 0.05)) continue;
      for (const v of tri) vtx(v);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  // Alla trianglar med normalen uppåt
  const P = g.attributes.position.array, U = g.attributes.uv.array;
  for (let t = 0; t < P.length / 9; t++) {
    const o = t * 9;
    const ux = P[o + 3] - P[o], uz = P[o + 5] - P[o + 2], vx = P[o + 6] - P[o], vz = P[o + 8] - P[o + 2];
    if (uz * vx - ux * vz >= 0) continue;
    for (let k = 0; k < 3; k++) { const tmp = P[o + 3 + k]; P[o + 3 + k] = P[o + 6 + k]; P[o + 6 + k] = tmp; }
    for (let k = 0; k < 2; k++) { const tmp = U[t * 6 + 2 + k]; U[t * 6 + 2 + k] = U[t * 6 + 4 + k]; U[t * 6 + 4 + k] = tmp; }
  }
  g.computeVertexNormals();
  B.add('earth', g, null);
  // Buskar på krönet
  const rr = rng(992);
  for (let k = 0; k < 12; k++) {
    const ss = 1 + rr() * (L - 2), dd = (rr() - 0.5) * 2 * (wallOff + 2.5);
    const x = c0.x + t0.x * ss + n0.x * dd, z = c0.z + t0.z * ss + n0.z * dd;
    const add = (key, gg, col) => B.add(key, gg.translate(0, mound * 0.9, 0), col);
    addShrub(add, x, z, 0.4 + rr() * 0.4, rr);
  }
}


// ===========================================================================
// Genvägarnas av- och påfarter
// ===========================================================================

/**
 * Kantsten längs en vägsträcka (huvudbanan eller en genväg) mellan index i0
 * och i1 (framåt) på en sida (+1 vänster, -1 höger). ok(x, z) får säga nej
 * per bit. Ersätter vallen där banan är öppen mot en genväg på andra sidan.
 */
export function addTrackCurb(B, world, RAPIER, { track, i0, i1, side, h = track.barrier.height, t = track.barrier.thick, ok = () => true, key = 'concrete', colors = [[0.88, 0.87, 0.84]] }) {
  const { N } = track;
  let stripe = 0;
  const body = world ? world.createRigidBody(RAPIER.RigidBodyDesc.fixed()) : null;
  const off = track.roadHalf + t / 2;
  const count = (i1 - i0 + N) % N;
  for (let k = 0; k < count; k += 3) {
    const i = (i0 + k) % N, j = (i0 + Math.min(k + 3, count)) % N;
    const ea = edge3(track, i, off * side), eb = edge3(track, j, off * side);
    const ax = ea.x, az = ea.z, bx = eb.x, bz = eb.z;
    const len = Math.hypot(bx - ax, bz - az) + 0.05, rot = Math.atan2(bx - ax, bz - az);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, y = (ea.y + eb.y) / 2;
    if (!ok(cx, cz)) continue;
    if (world) boxCollider(world, RAPIER, body, t / 2, h / 2, len / 2, cx, y + h / 2, cz, rot, 0.3);
    if (B) B.add(key, box(t, h, len, 0, h / 2, 0, { m: 1.5 }).rotateY(rot).translate(cx, y, cz), colors[stripe++ % colors.length]);
  }
}

// Vallbitarnas mittpunkter, exakt som banmotorn lägger ut kolliderarna
function barrierCenters(data) {
  const out = new Map();
  for (const s of barrierSegments(data)) for (const side of [1, -1]) out.set(`${s.i}:${side}`, barrierCenter(data, s, side));
  return out;
}

/**
 * Öppnar vallarna där en genväg och huvudbanan går in i varandra (motorn
 * öppnar bara en kort bit), så att av- och påfarter kan vara flacka. Vallar
 * som ligger på den andra vägen tas bort, både i fysiken och (via isOpen) i
 * grafiken, och ersätts med kantsten på den bortre sidan.
 * Körs från nivåns environment (efter banans fysik, före dess grafik).
 */
export function fitShortcutOpenings(B, world, RAPIER, track, { margin = 0.45, key, colors } = {}) {
  const look = key ? { key, colors } : {};
  const scs = track.shortcuts || [];
  if (!scs.length) return;
  const datas = [track, ...scs.map((sc) => sc.path)];
  const before = datas.map(barrierCenters);
  const dist = (data, x, z) => Math.sqrt(data.nearest(x, z).d2);
  const N = track.N, off = track.roadHalf + track.barrier.thick / 2;
  const mainOpen = [];
  for (const sc of scs) {
    const P = sc.path, poff = P.roadHalf + P.barrier.thick / 2;
    for (const m of [sc.A, sc.B]) {
      let lo = 0, hi = 0;
      for (let k = -50; k <= 50; k++) {
        const i = (m + k + N) % N, p = track.pts[i], n = track.normals[i];
        for (const s of [1, -1]) {
          if (dist(P, p.x + n.x * off * s, p.z + n.z * off * s) < P.roadHalf + margin) { track.isOpen[i] = true; lo = Math.min(lo, k); hi = Math.max(hi, k); }
        }
      }
      const w = Math.round((track.roadHalf * 2.4) / track.spacing);
      mainOpen.push({ i0: (m + Math.min(lo, -w) - 3 + N) % N, i1: (m + Math.max(hi, w) + 3) % N });
    }
    for (let i = 0; i < P.N - 1; i++) {
      const p = P.pts[i], n = P.normals[i];
      for (const s of [1, -1]) if (dist(track, p.x + n.x * poff * s, p.z + n.z * poff * s) < track.roadHalf + margin) P.isOpen[i] = true;
    }
  }
  // Ta bort kolliderare för vallbitar som inte längre ska finnas
  const drop = [];
  datas.forEach((d, k) => { const after = barrierCenters(d); for (const [key, c] of before[k]) if (!after.has(key)) drop.push(c); });
  if (world && drop.length) {
    const kill = [];
    world.forEachCollider((c) => {
      if (c.shape.type !== RAPIER.ShapeType.Cuboid) return;
      const t = c.translation();
      if (drop.some((d) => Math.abs(t.x - d.x) < 1e-3 && Math.abs(t.z - d.z) < 1e-3 && Math.abs(t.y - d.y) < 1e-3)) kill.push(c);
    });
    for (const c of kill) world.removeCollider(c, false);
  }
  // Kantsten där vallen saknas, utom där den skulle ligga på den andra vägen
  const onSc = (x, z, skip) => scs.some((sc) => sc !== skip && dist(sc.path, x, z) < sc.path.roadHalf + 0.25);
  for (const o of mainOpen) for (const s of [1, -1]) addTrackCurb(B, world, RAPIER, { track, i0: o.i0, i1: o.i1, side: s, ok: (x, z) => !onSc(x, z, null), ...look });
  for (const sc of scs) {
    const P = sc.path;
    for (const s of [1, -1]) addTrackCurb(B, world, RAPIER, { track: P, i0: 0, i1: P.N - 2, side: s, ...look, ok: (x, z) => {
      const q = P.nearest(x, z).index;
      return P.isOpen[q] && dist(track, x, z) > track.roadHalf + 0.25 && !onSc(x, z, sc);
    } });
  }
}
