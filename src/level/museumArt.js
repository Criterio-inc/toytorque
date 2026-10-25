import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G, groups } from '../core/physics.js';
import { rng } from './warehouseArt.js';
import { bankY, addUnderlay } from '../track/track.js';

// ---------------------------------------------------------------------------
// Procedurell grafik för museet en natt: polerad marmor, lila-svart
// schackgolv i rymdsalen, sandsten i Egyptensalen, dinosaurieskelett,
// sarkofag, obelisk, planet och raket, montrar, bänkar, statyer, tavlor,
// sammetsrep på mässingsstolpar och gröna utgångsskyltar.
//
// Utan scene byggs bara fysiken, utan world bara grafiken. Texturer och
// material cachas på modulnivå. All statisk grafik slås ihop per material
// (Batch), så hela museet blir ett trettiotal ritanrop.
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

const yQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

// --- fysik ------------------------------------------------------------------

function fixed(world, RAPIER) {
  return world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
}
function boxCol(world, RAPIER, body, hx, hy, hz, x, y, z, rotY = 0, friction = 0.6) {
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(yQuat(rotY))
      .setFriction(friction).setRestitution(0.15).setCollisionGroups(groups(G.WORLD)),
    body
  );
}
function cylCol(world, RAPIER, body, r, h, x, z, y0 = 0) {
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(x, y0 + h / 2, z)
      .setFriction(0.5).setRestitution(0.15).setCollisionGroups(groups(G.WORLD)),
    body
  );
}

// --- canvas ------------------------------------------------------------------

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
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
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}
function paintNoise(ctx, w, h, [R, G_, B], { cells = 4, oct = 5, amt = 0.2, grain = 6, seed = 1 } = {}) {
  const r = rng(seed);
  const n = valueNoise(w, h, cells, oct, r);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const k = 1 - amt / 2 + amt * n[i], g = (r() - 0.5) * grain;
    img.data[i * 4] = R * k + g; img.data[i * 4 + 1] = G_ * k + g; img.data[i * 4 + 2] = B * k + g; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
// Marmorådror: slumpvandringar med omlindning så att texturen blir sömlös
function veins(ctx, S, r, { n = 14, col = '80,78,74', alpha = 0.35, width = 2.2, steps = 90 } = {}) {
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let x = r() * S, y = r() * S, a = r() * Math.PI * 2;
    const pts = [[x, y]];
    for (let k = 0; k < steps; k++) {
      a += (r() - 0.5) * 0.7;
      x += Math.cos(a) * 6; y += Math.sin(a) * 6;
      pts.push([x, y]);
    }
    const w = width * (0.4 + r());
    for (const [lw, al] of [[w * 3, alpha * 0.18], [w, alpha], [w * 0.4, alpha * 0.8]]) {
      ctx.strokeStyle = `rgba(${col},${al})`;
      ctx.lineWidth = lw;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(px + ox, py + oy) : ctx.moveTo(px + ox, py + oy)));
        ctx.stroke();
      }
    }
    // Förgreningar
    if (r() < 0.6) {
      const [bx, by] = pts[Math.floor(r() * pts.length)];
      let x2 = bx, y2 = by, a2 = r() * Math.PI * 2;
      ctx.strokeStyle = `rgba(${col},${alpha * 0.6})`;
      ctx.lineWidth = w * 0.4;
      ctx.beginPath(); ctx.moveTo(x2, y2);
      for (let k = 0; k < 25; k++) { a2 += (r() - 0.5) * 0.9; x2 += Math.cos(a2) * 5; y2 += Math.sin(a2) * 5; ctx.lineTo(x2, y2); }
      ctx.stroke();
    }
  }
}

// ===========================================================================
// Texturer
// ===========================================================================

// Stora salen: polerade krämvita marmorplattor (2 m) med mörkgröna
// rutor i korsningarna och mässingslister (texturen täcker 4 m).
const HALL_TILE = 4;
function hallFloorTex() {
  return cached('hallFloor', () => {
    const S = 1024, h = S / 2;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [196, 186, 168], { cells: 3, oct: 6, amt: 0.16, grain: 5, seed: 3 });
    const r = rng(4);
    veins(ctx, S, r, { n: 16, col: '120,112,100', alpha: 0.3 });
    veins(ctx, S, r, { n: 10, col: '170,150,120', alpha: 0.22, width: 1.2 });
    // Plattorna får lite olika ton
    for (const [x, y, k] of [[0, 0, 0.04], [h, 0, -0.03], [0, h, -0.05], [h, h, 0.02]]) {
      ctx.fillStyle = k > 0 ? `rgba(255,250,240,${k})` : `rgba(90,80,60,${-k})`;
      ctx.fillRect(x, y, h, h);
    }
    // Mörkgröna kvadrater (Verde antico) i varje korsning, vridna 45°
    const [d, dctx] = canvas(256);
    paintNoise(dctx, 256, 256, [40, 70, 56], { cells: 2, oct: 5, amt: 0.4, grain: 6, seed: 5 });
    veins(dctx, 256, rng(6), { n: 6, col: '190,200,190', alpha: 0.3, width: 1, steps: 40 });
    const pat = ctx.createPattern(d, 'repeat');
    const q = 64;
    for (const [cx, cy] of [[0, 0], [h, 0], [S, 0], [0, h], [h, h], [S, h], [0, S], [h, S], [S, S]]) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = pat; ctx.fillRect(-q / 2, -q / 2, q, q);
      ctx.strokeStyle = 'rgba(205,170,90,0.8)'; ctx.lineWidth = 3; ctx.strokeRect(-q / 2, -q / 2, q, q);
      ctx.restore();
    }
    // Fogar
    for (const p of [0, h]) {
      ctx.fillStyle = 'rgba(60,50,38,0.55)'; ctx.fillRect(p - 1.5, 0, 3, S); ctx.fillRect(0, p - 1.5, S, 3);
    }
    return toTex(c);
  });
}

// Rymdsalen: lila och svart schackrutigt golv, 1 m rutor (texturen 2 m)
const SPACE_TILE = 2;
function checkerTex() {
  return cached('checker', () => {
    const S = 512, h = S / 2;
    const [c, ctx] = canvas(S);
    const [a, actx] = canvas(h);
    paintNoise(actx, h, h, [74, 40, 112], { cells: 2, oct: 5, amt: 0.3, grain: 5, seed: 7 });
    veins(actx, h, rng(8), { n: 5, col: '150,110,200', alpha: 0.18, width: 1, steps: 40 });
    const [b, bctx] = canvas(h);
    paintNoise(bctx, h, h, [14, 11, 20], { cells: 2, oct: 5, amt: 0.5, grain: 4, seed: 9 });
    veins(bctx, h, rng(10), { n: 4, col: '80,60,110', alpha: 0.2, width: 1, steps: 40 });
    ctx.drawImage(a, 0, 0); ctx.drawImage(a, h, h);
    ctx.drawImage(b, h, 0); ctx.drawImage(b, 0, h);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    for (const p of [0, h]) { ctx.fillRect(p - 1, 0, 2, S); ctx.fillRect(0, p - 1, S, 2); }
    return toTex(c);
  });
}

// Egyptensalen: stora sandstensplattor i förband (texturen 6 m)
const SAND_TILE = 6;
function sandFloorTex() {
  return cached('sandFloor', () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [196, 168, 122], { cells: 4, oct: 6, amt: 0.22, grain: 12, seed: 11 });
    const r = rng(12);
    const rows = 6, rh = S / rows;
    for (let row = 0; row < rows; row++) {
      let x = row % 2 ? -rh * 0.7 : 0;
      while (x < S) {
        const w = rh * (1.2 + r() * 1.3);
        const k = 0.88 + r() * 0.2;
        ctx.fillStyle = `rgba(${k > 1 ? '255,240,210' : '90,64,36'},${Math.abs(k - 1) * 0.9})`;
        ctx.fillRect(x, row * rh, w, rh);
        ctx.fillStyle = 'rgba(70,52,32,0.75)';
        ctx.fillRect(x - 1.5, row * rh, 3, rh);
        x += w;
      }
      ctx.fillRect(0, row * rh - 1.5, S, 3);
    }
    // Porer och nötning
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = `rgba(80,60,35,${0.1 + r() * 0.25})`;
      ctx.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
    }
    return toTex(c);
  });
}

// Rulltrappans steg: räfflat stål med gula kanter (u tvärs, v längs)
function escalatorTex() {
  return cached('escTex', () => {
    const W = 256, H = 256;
    const [c, ctx] = canvas(W, H);
    paintNoise(ctx, W, H, [150, 154, 160], { cells: 2, oct: 3, amt: 0.1, grain: 10, seed: 13 });
    for (let x = 6; x < W; x += 6) { ctx.fillStyle = 'rgba(30,32,36,0.75)'; ctx.fillRect(x, 0, 2, H); ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(x + 2, 0, 1, H); }
    ctx.fillStyle = 'rgba(15,15,18,0.9)'; ctx.fillRect(0, 0, W, 6);
    ctx.fillStyle = '#e8b81c'; ctx.fillRect(0, 0, 14, H); ctx.fillRect(W - 14, 0, 14, H); ctx.fillRect(0, 6, W, 8);
    return toTex(c);
  });
}

// Väggar i stora salen: oxblodsröd sidentapet med diskret mönster
function hallWallTex() {
  return cached('hallWall', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [118, 34, 38], { cells: 4, oct: 5, amt: 0.12, grain: 8, seed: 15 });
    ctx.strokeStyle = 'rgba(160,70,60,0.22)';
    ctx.lineWidth = 3;
    for (let y = 0; y < S; y += 128) for (let x = 0; x < S; x += 128) {
      const ox = (y / 128) % 2 ? 64 : 0;
      ctx.beginPath();
      ctx.ellipse(x + ox, y + 64, 22, 42, 0, 0, Math.PI * 2);
      ctx.moveTo(x + ox, y + 18); ctx.lineTo(x + ox, y + 110);
      ctx.stroke();
    }
    return toTex(c);
  });
}

// Egyptensalens väggar: sandstensblock i skift
function sandWallTex() {
  return cached('sandWall', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [190, 158, 112], { cells: 4, oct: 5, amt: 0.25, grain: 14, seed: 17 });
    const r = rng(18);
    const rows = 4, rh = S / rows;
    for (let row = 0; row < rows; row++) {
      let x = row % 2 ? -rh * 0.8 : 0;
      while (x < S) {
        const w = rh * (1.4 + r() * 1.2);
        const k = r();
        ctx.fillStyle = `rgba(${k > 0.5 ? '240,215,170' : '100,72,40'},${0.06 + r() * 0.12})`;
        ctx.fillRect(x, row * rh, w, rh);
        ctx.fillStyle = 'rgba(80,58,34,0.8)'; ctx.fillRect(x - 1, row * rh, 3, rh);
        x += w;
      }
      ctx.fillStyle = 'rgba(80,58,34,0.8)'; ctx.fillRect(0, row * rh - 1, S, 3);
    }
    return toTex(c);
  });
}

// Rymdsalens väggar: mörka stenpaneler
function spaceWallTex() {
  return cached('spaceWall', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [50, 48, 58], { cells: 4, oct: 6, amt: 0.35, grain: 10, seed: 19 });
    ctx.fillStyle = 'rgba(10,10,14,0.85)';
    for (const p of [0, S / 2]) { ctx.fillRect(p - 2, 0, 4, S); ctx.fillRect(0, p - 2, S, 4); }
    return toTex(c);
  });
}

// Tak: kassettak (stora salen), blått med guldstjärnor (Egypten), stjärnhimmel (rymden)
function ceilTex(kind) {
  return cached('ceil' + kind, () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    const r = rng(kind.length * 7);
    if (kind === 'hall') {
      paintNoise(ctx, S, S, [70, 58, 50], { cells: 2, oct: 3, amt: 0.15, grain: 5, seed: 21 });
      for (const [x, y] of [[0, 0], [256, 0], [0, 256], [256, 256]]) {
        ctx.fillStyle = 'rgba(25,18,14,0.8)'; ctx.fillRect(x + 28, y + 28, 200, 200);
        ctx.fillStyle = 'rgba(160,130,80,0.45)'; ctx.fillRect(x + 118, y + 118, 20, 20);
        ctx.strokeStyle = 'rgba(190,150,80,0.35)'; ctx.lineWidth = 4; ctx.strokeRect(x + 40, y + 40, 176, 176);
      }
    } else if (kind === 'egypt') {
      ctx.fillStyle = '#132650'; ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = '#d9b14a';
      for (let i = 0; i < 60; i++) {
        const x = r() * S, y = r() * S, s = 6 + r() * 5;
        ctx.beginPath();
        for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, rr = k % 2 ? s * 0.4 : s; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#05040a'; ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 700; i++) {
        const b = r();
        ctx.fillStyle = `rgba(${200 + b * 55},${200 + b * 55},255,${0.3 + b * 0.7})`;
        const s = b > 0.95 ? 2.5 : 1.2;
        ctx.fillRect(r() * S, r() * S, s, s);
      }
      // Nebulosa
      for (let i = 0; i < 6; i++) {
        const x = r() * S, y = r() * S, rad = 60 + r() * 120;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, i % 2 ? 'rgba(120,50,170,0.25)' : 'rgba(40,70,170,0.2)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
    return toTex(c);
  });
}

// Marmor till pelare, statyer, balustrad och sockel
function marbleTex() {
  return cached('marble', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    paintNoise(ctx, S, S, [236, 232, 224], { cells: 3, oct: 5, amt: 0.1, grain: 4, seed: 23 });
    veins(ctx, S, rng(24), { n: 10, col: '130,126,120', alpha: 0.3, width: 1.4, steps: 60 });
    return toTex(c);
  });
}

// Abstrakta tavlor, 4 × 2 i en atlas
function paintingTex() {
  return cached('paintings', () => {
    const W = 1024, H = 512, C = 256;
    const [c, ctx] = canvas(W, H);
    const r = rng(31);
    const cell = (i, fn) => { ctx.save(); ctx.translate((i % 4) * C, Math.floor(i / 4) * C); ctx.beginPath(); ctx.rect(0, 0, C, C); ctx.clip(); fn(); ctx.restore(); };
    // 0: färgfält
    cell(0, () => {
      ctx.fillStyle = '#5b1d1a'; ctx.fillRect(0, 0, C, C);
      ctx.filter = 'blur(4px)';
      ctx.fillStyle = '#d0682a'; ctx.fillRect(20, 24, 216, 110);
      ctx.fillStyle = '#2a1416'; ctx.fillRect(20, 150, 216, 84);
      ctx.filter = 'none';
    });
    // 1: cirklar och linjer
    cell(1, () => {
      ctx.fillStyle = '#e9e0c8'; ctx.fillRect(0, 0, C, C);
      for (const [x, y, rr, col] of [[90, 100, 60, '#1d3f8a'], [170, 150, 40, '#d8a321'], [120, 190, 26, '#b8261e'], [60, 60, 18, '#111']]) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fill();
      }
      ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(r() * C, r() * C); ctx.lineTo(r() * C, r() * C); ctx.stroke(); }
    });
    // 2: rutnät med primärfärger
    cell(2, () => {
      ctx.fillStyle = '#f2efe6'; ctx.fillRect(0, 0, C, C);
      for (const [x, y, w, h, col] of [[0, 0, 150, 140, '#c8201e'], [190, 170, 66, 86, '#1e3e9c'], [0, 200, 70, 56, '#f2c418']]) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
      ctx.fillStyle = '#111';
      for (const x of [150, 190]) ctx.fillRect(x, 0, 8, C);
      for (const y of [140, 200]) ctx.fillRect(0, y, C, 8);
      ctx.fillRect(70, 200, 8, 56);
    });
    // 3: landskap i skymning
    cell(3, () => {
      const g = ctx.createLinearGradient(0, 0, 0, C);
      g.addColorStop(0, '#1b2a4a'); g.addColorStop(0.55, '#c9784a'); g.addColorStop(0.56, '#2d3a2a'); g.addColorStop(1, '#141c12');
      ctx.fillStyle = g; ctx.fillRect(0, 0, C, C);
      ctx.fillStyle = '#f4d68a'; ctx.beginPath(); ctx.arc(180, 130, 18, 0, 7); ctx.fill();
      ctx.fillStyle = '#1c2618';
      ctx.beginPath(); ctx.moveTo(0, 150); for (let x = 0; x <= C; x += 16) ctx.lineTo(x, 140 - Math.sin(x * 0.03) * 22 - r() * 6); ctx.lineTo(C, C); ctx.lineTo(0, C); ctx.fill();
    });
    // 4: virvlar
    cell(4, () => {
      ctx.fillStyle = '#16233f'; ctx.fillRect(0, 0, C, C);
      ctx.lineWidth = 5;
      for (let k = 0; k < 9; k++) {
        ctx.strokeStyle = ['#e8c45a', '#5b8fd8', '#f0e6c0'][k % 3];
        ctx.beginPath();
        for (let a = 0; a < 12; a += 0.2) ctx.lineTo(128 + Math.cos(a + k) * a * 9, 128 + Math.sin(a + k) * a * 9);
        ctx.stroke();
      }
    });
    // 5: porträttsilhuett
    cell(5, () => {
      const g = ctx.createRadialGradient(128, 110, 10, 128, 128, 180);
      g.addColorStop(0, '#6a5a3a'); g.addColorStop(1, '#1a140c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, C, C);
      ctx.fillStyle = '#2a1e14';
      ctx.beginPath(); ctx.ellipse(128, 100, 44, 56, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(128, 240, 100, 90, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#c9a77a'; ctx.beginPath(); ctx.ellipse(122, 104, 30, 40, 0, 0, 7); ctx.fill();
    });
    // 6: diagonala band
    cell(6, () => {
      for (let i = -8; i < 16; i++) {
        ctx.fillStyle = ['#2b7a78', '#def2f1', '#feffff', '#17252a', '#e07a5f'][(i + 8) % 5];
        ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32 + 32, 0); ctx.lineTo(i * 32 + 32 - C, C); ctx.lineTo(i * 32 - C, C); ctx.fill();
      }
    });
    // 7: stilleben med vas
    cell(7, () => {
      ctx.fillStyle = '#2c2418'; ctx.fillRect(0, 0, C, C);
      ctx.fillStyle = '#4a3a26'; ctx.fillRect(0, 180, C, 76);
      ctx.fillStyle = '#3a5a8a'; ctx.beginPath(); ctx.ellipse(128, 140, 40, 50, 0, 0, 7); ctx.fill(); ctx.fillRect(112, 70, 32, 40);
      for (const [x, y, col] of [[100, 60, '#c83a3a'], [140, 50, '#e8d050'], [125, 40, '#e8e8e0'], [160, 70, '#c83a3a']]) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.fill(); }
      ctx.fillStyle = '#c9a050'; ctx.beginPath(); ctx.arc(190, 185, 16, 0, 7); ctx.fill();
    });
    // Fernissa: lätt vinjett och craquelé
    for (let i = 0; i < 8; i++) {
      ctx.save(); ctx.translate((i % 4) * C, Math.floor(i / 4) * C);
      const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 190);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(20,10,0,0.45)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, C, C);
      ctx.restore();
    }
    const t = toTex(c, { repeat: false });
    return t;
  });
}

// Hieroglyfpaneler, två i en atlas (vänster: glyfkolumner, höger: figurer)
function hieroTex() {
  return cached('hiero', () => {
    const W = 1024, H = 512, C = 512;
    const [c, ctx] = canvas(W, H);
    paintNoise(ctx, W, H, [206, 178, 128], { cells: 4, oct: 5, amt: 0.2, grain: 12, seed: 41 });
    const r = rng(42);
    const ink = '#3a2614', red = '#a2392a', blue = '#2c5a8a', green = '#3c7a5a';
    const glyph = (x, y, s) => {
      const k = Math.floor(r() * 9);
      ctx.fillStyle = [ink, red, blue, ink, green][Math.floor(r() * 5)];
      ctx.strokeStyle = ink; ctx.lineWidth = s * 0.08;
      ctx.beginPath();
      if (k === 0) { ctx.ellipse(x, y, s * 0.4, s * 0.22, 0, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, s * 0.12, 0, 7); ctx.fill(); } // öga
      else if (k === 1) { ctx.arc(x, y - s * 0.2, s * 0.17, 0, 7); ctx.stroke(); ctx.fillRect(x - s * 0.05, y - s * 0.05, s * 0.1, s * 0.45); ctx.fillRect(x - s * 0.25, y, s * 0.5, s * 0.08); } // ankh
      else if (k === 2) { ctx.moveTo(x - s * 0.4, y); for (let i = 0; i < 6; i++) ctx.lineTo(x - s * 0.4 + i * s * 0.16, y + (i % 2 ? -s * 0.12 : s * 0.12)); ctx.stroke(); } // vatten
      else if (k === 3) { ctx.ellipse(x, y, s * 0.3, s * 0.2, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(x + s * 0.28, y - s * 0.22, s * 0.1, 0, 7); ctx.fill(); ctx.fillRect(x - s * 0.1, y + s * 0.15, s * 0.05, s * 0.25); } // fågel
      else if (k === 4) { ctx.arc(x, y, s * 0.3, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, s * 0.06, 0, 7); ctx.fill(); } // sol
      else if (k === 5) { ctx.fillRect(x - s * 0.06, y - s * 0.4, s * 0.12, s * 0.8); ctx.beginPath(); ctx.ellipse(x, y - s * 0.38, s * 0.16, s * 0.08, 0, 0, 7); ctx.fill(); } // vass
      else if (k === 6) { ctx.moveTo(x - s * 0.4, y + s * 0.2); ctx.quadraticCurveTo(x - s * 0.1, y - s * 0.4, x + s * 0.1, y); ctx.quadraticCurveTo(x + s * 0.3, y + s * 0.3, x + s * 0.4, y - s * 0.2); ctx.stroke(); } // orm
      else if (k === 7) { ctx.fillRect(x - s * 0.3, y - s * 0.1, s * 0.6, s * 0.2); } // block
      else { ctx.moveTo(x - s * 0.3, y + s * 0.3); ctx.lineTo(x, y - s * 0.35); ctx.lineTo(x + s * 0.3, y + s * 0.3); ctx.fill(); } // pyramid
    };
    // Panel 0: kolumner med glyfer, kartusch i mitten
    for (let col = 0; col < 7; col++) {
      const x = 40 + col * 72;
      ctx.fillStyle = 'rgba(60,40,20,0.7)'; ctx.fillRect(x + 34, 20, 3, H - 40);
      for (let y = 50; y < H - 30; y += 52) glyph(x, y, 40);
    }
    ctx.strokeStyle = ink; ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, C - 20, H - 20);
    // Panel 1: tre stiliserade gestalter i profil och ett band glyfer
    ctx.save(); ctx.translate(C, 0);
    for (let k = 0; k < 3; k++) {
      const x = 90 + k * 160;
      ctx.fillStyle = '#a65a34'; // hud
      ctx.beginPath(); ctx.arc(x, 150, 26, 0, 7); ctx.fill();
      ctx.fillStyle = '#1a1a40'; ctx.fillRect(x - 30, 125, 40, 60); // peruk
      ctx.fillStyle = '#a65a34'; ctx.fillRect(x - 22, 180, 44, 90);
      ctx.fillStyle = '#f0ead8'; ctx.beginPath(); ctx.moveTo(x - 30, 260); ctx.lineTo(x + 30, 260); ctx.lineTo(x + 40, 400); ctx.lineTo(x - 36, 400); ctx.fill();
      ctx.fillStyle = '#a65a34'; ctx.fillRect(x - 24, 400, 14, 60); ctx.fillRect(x + 10, 400, 14, 60);
      ctx.fillStyle = '#d8a83a'; ctx.fillRect(x - 26, 190, 52, 14);
      ctx.strokeStyle = '#a65a34'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(x + 15, 200); ctx.lineTo(x + 60, 230); ctx.stroke();
    }
    for (let x = 40; x < C - 20; x += 50) glyph(x, 60, 36);
    ctx.strokeStyle = ink; ctx.lineWidth = 6; ctx.strokeRect(10, 10, C - 20, H - 20);
    ctx.restore();
    return toTex(c, { repeat: false });
  });
}

// Grön utgångsskylt: springande gubbe, dörr och pil
// Skylten på biljettkiosken
function ticketTex() {
  return cached('ticketTex', () => {
    const [c, ctx] = canvas(768, 128);
    ctx.fillStyle = '#4a0c14'; ctx.fillRect(0, 0, 768, 128);
    ctx.strokeStyle = '#d8b25a'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 752, 112);
    ctx.fillStyle = '#f2d58a'; ctx.font = 'bold 64px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('BILJETTER · ENTRÉ', 384, 68);
    return toTex(c, { repeat: false });
  });
}

function exitTex() {
  return cached('exit', () => {
    const W = 256, H = 128;
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = '#0c9a4a'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f4fff6';
    ctx.fillRect(20, 18, 50, 92); ctx.fillStyle = '#0c9a4a'; ctx.fillRect(28, 26, 34, 84);
    ctx.fillStyle = '#f4fff6';
    // Gubben
    ctx.beginPath(); ctx.arc(108, 30, 10, 0, 7); ctx.fill();
    ctx.lineCap = 'round'; ctx.strokeStyle = '#f4fff6'; ctx.lineWidth = 11;
    const ln = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
    ln([[102, 46], [92, 74]]);
    ln([[92, 74], [108, 88], [104, 108]]);
    ln([[92, 74], [80, 92], [62, 96]]);
    ln([[100, 50], [118, 62], [130, 54]]);
    ln([[100, 50], [84, 58], [76, 70]]);
    // Pil
    ctx.beginPath(); ctx.moveTo(150, 52); ctx.lineTo(196, 52); ctx.lineTo(196, 36); ctx.lineTo(234, 64); ctx.lineTo(196, 92); ctx.lineTo(196, 76); ctx.lineTo(150, 76); ctx.fill();
    ctx.font = 'bold 16px sans-serif'; ctx.fillText('UTGÅNG', 156, 116);
    return toTex(c, { repeat: false });
  });
}

// Mjuk rund ljusfläck (additiv)
function poolTex() {
  return cached('pool', () => {
    const S = 128;
    const [c, ctx] = canvas(S);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(160,160,160,1)'); g.addColorStop(0.7, 'rgba(50,50,50,1)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return toTex(c, { repeat: false });
  });
}
// Ljuskägla: ljus uppe, mörk nere
function beamTex() {
  return cached('beam', () => {
    const [c, ctx] = canvas(8, 128);
    const g = ctx.createLinearGradient(0, 128, 0, 0);
    g.addColorStop(0, '#000'); g.addColorStop(0.6, '#555'); g.addColorStop(1, '#fff');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 128);
    return toTex(c, { repeat: false });
  });
}
// Gasjätte med band
function planetTex() {
  return cached('planet', () => {
    const W = 512, H = 256;
    const [c, ctx] = canvas(W, H);
    const r = rng(51);
    const n = valueNoise(W, H, 4, 5, r);
    const img = ctx.createImageData(W, H);
    const bands = Array.from({ length: 14 }, () => [200 + r() * 50, 150 + r() * 60, 90 + r() * 60]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const f = (y / H) * bands.length + Math.sin(x * 0.05 + y * 0.02) * 0.4 + n[i] * 1.5;
      const b0 = bands[Math.floor(f) % bands.length], b1 = bands[(Math.floor(f) + 1) % bands.length], t = f - Math.floor(f);
      for (let k = 0; k < 3; k++) img.data[i * 4 + k] = b0[k] + (b1[k] - b0[k]) * t;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Stor storm
    ctx.fillStyle = 'rgba(190,90,60,0.6)'; ctx.beginPath(); ctx.ellipse(330, 160, 34, 16, 0, 0, 7); ctx.fill();
    return toTex(c);
  });
}
function ringTex() {
  return cached('ring', () => {
    const W = 256;
    const [c, ctx] = canvas(W, 4);
    const r = rng(52);
    for (let x = 0; x < W; x++) {
      const a = (0.3 + r() * 0.6) * (x < 8 || x > W - 6 ? 0.3 : 1) * (x > 150 && x < 162 ? 0.1 : 1);
      ctx.fillStyle = `rgba(${210 + r() * 30},${185 + r() * 30},${150 + r() * 30},${a})`;
      ctx.fillRect(x, 0, 1, 4);
    }
    return toTex(c, { repeat: false });
  });
}

// Egen nattmiljö att spegla i (mörk sal med varma lampor), så att de blanka
// golven speglar natten i stället för spelets ljusa standardrum.
function nightEnv() {
  return cached('nightEnv', () => {
    const r = rng(61);
    const face = (kind) => {
      const [c, ctx] = canvas(128);
      const g = ctx.createLinearGradient(0, 0, 0, 128);
      if (kind === 'up') { ctx.fillStyle = '#0d0a0c'; ctx.fillRect(0, 0, 128, 128); }
      else if (kind === 'down') { ctx.fillStyle = '#100c0a'; ctx.fillRect(0, 0, 128, 128); }
      else {
        g.addColorStop(0, '#0c0a10'); g.addColorStop(0.5, '#2a1012'); g.addColorStop(1, '#120c0a');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
        // Tavellampor och fönster
        for (let i = 0; i < 3; i++) {
          const x = 10 + r() * 108, y = 50 + r() * 20;
          const rg = ctx.createRadialGradient(x, y, 0, x, y, 14);
          rg.addColorStop(0, 'rgba(255,210,150,0.9)'); rg.addColorStop(1, 'rgba(255,210,150,0)');
          ctx.fillStyle = rg; ctx.fillRect(x - 14, y - 14, 28, 28);
        }
        ctx.fillStyle = 'rgba(70,90,160,0.5)'; ctx.fillRect(20 + r() * 80, 30, 8, 26);
      }
      if (kind === 'up' || kind !== 'down') {
        // Taklampor
        for (let i = 0; i < (kind === 'up' ? 9 : 3); i++) {
          const x = r() * 128, y = kind === 'up' ? r() * 128 : 4 + r() * 18, rad = kind === 'up' ? 7 : 4;
          const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
          rg.addColorStop(0, 'rgba(255,235,200,1)'); rg.addColorStop(1, 'rgba(255,200,140,0)');
          ctx.fillStyle = rg; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
      }
      return c;
    };
    const tex = new THREE.CubeTexture([face('side'), face('side'), face('up'), face('down'), face('side'), face('side')]);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
}

// ===========================================================================
// Material
// ===========================================================================

const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, envMap: nightEnv(), envMapIntensity: 1.2, ...o });
const MATS = {
  marble: () => std({ map: marbleTex(), roughness: 0.22, metalness: 0 }),
  dark: () => std({ color: 0x2a2624, roughness: 0.25, metalness: 0.1 }),
  stone: () => std({ map: sandWallTex(), roughness: 0.85 }),
  wood: () => std({ color: 0x5a3820, roughness: 0.45 }),
  brass: () => std({ color: 0xc9a050, roughness: 0.28, metalness: 1 }),
  gold: () => std({ color: 0xe0b040, roughness: 0.22, metalness: 1 }),
  enamel: () => std({ roughness: 0.3, metalness: 0.55 }),
  velvet: () => std({ color: 0x8a1020, roughness: 0.95 }),
  bone: () => std({ color: 0xd9ccb0, roughness: 0.6, emissive: 0x4a4030 }),
  steel: () => std({ color: 0x8a9098, roughness: 0.35, metalness: 0.8 }),
  paint: () => std({ roughness: 0.4 }),
  rubber: () => std({ color: 0x141416, roughness: 0.6 }),
  glass: () => new THREE.MeshStandardMaterial({ envMap: nightEnv(), envMapIntensity: 2, color: 0xbfd8e0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
  art: () => std({ map: paintingTex(), roughness: 0.5 }),
  hiero: () => std({ map: hieroTex(), roughness: 0.8 }),
  ticket: () => std({ map: ticketTex(), roughness: 0.5, emissive: 0xffffff, emissiveMap: ticketTex(), emissiveIntensity: 0.35 }),
  wallHall: () => std({ map: hallWallTex(), roughness: 0.85 }),
  wallSand: () => std({ map: sandWallTex(), roughness: 0.85 }),
  wallSpace: () => std({ map: spaceWallTex(), roughness: 0.5, metalness: 0.1 }),
  ceilHall: () => std({ map: ceilTex('hall'), roughness: 0.9 }),
  ceilEgypt: () => std({ map: ceilTex('egypt'), roughness: 0.9, emissive: 0xffffff, emissiveMap: ceilTex('egypt'), emissiveIntensity: 0.15 }),
  ceilSpace: () => new THREE.MeshBasicMaterial({ map: ceilTex('space'), vertexColors: true }),
  planet: () => std({ map: planetTex(), roughness: 0.7, emissive: 0xffffff, emissiveMap: planetTex(), emissiveIntensity: 0.18 }),
  ring: () => new THREE.MeshStandardMaterial({ envMap: nightEnv(), map: ringTex(), transparent: true, side: THREE.DoubleSide, roughness: 0.8, depthWrite: false, emissive: 0x302820 }),
  glow: () => new THREE.MeshBasicMaterial({ vertexColors: true }),
  exit: () => new THREE.MeshBasicMaterial({ map: exitTex() }),
  pool: () => new THREE.MeshBasicMaterial({ map: poolTex(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }),
  beam: () => new THREE.MeshBasicMaterial({ map: beamTex(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
};
const NO_SHADOW = new Set(['glass', 'glow', 'exit', 'pool', 'beam', 'ceilHall', 'ceilEgypt', 'ceilSpace', 'ring', 'wallHall', 'wallSand', 'wallSpace']);

// ===========================================================================
// Batch: samlar geometri per material och slår ihop vid flush
// ===========================================================================

export class Batch {
  constructor() { this.lists = new Map(); }

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
    g.morphAttributes = {};
    g.clearGroups();
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(g);
  }

  flush(scene) {
    for (const [key, list] of this.lists) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list), MATS[key]());
      mesh.castShadow = !NO_SHADOW.has(key);
      mesh.receiveShadow = !['glow', 'exit', 'pool', 'beam', 'ceilSpace'].includes(key);
      if (key === 'glass' || key === 'ring') mesh.renderOrder = 2;
      if (key === 'pool' || key === 'beam') mesh.renderOrder = 3;
      scene.add(mesh);
    }
    this.lists.clear();
  }
}

// --- geometrihjälp ---------------------------------------------------------------

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
function place(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1 } = {}) {
  if (s !== 1) geo.scale(s, s, s);
  if (rx || ry || rz) geo.applyQuaternion(_q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')));
  geo.translate(x, y, z);
  return geo;
}
// Låda med UV i meter (textur per `m` meter)
function box(w, h, d, x, y, z, ry = 0, m = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (m) {
    const uv = g.attributes.uv;
    const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * faces[f][0] / m, uv.getY(k) * faces[f][1] / m); }
  }
  return place(g, { x, y, z, ry });
}
function cyl(rt, rb, h, x, y, z, seg = 12, open = false) {
  return place(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), { x, y: y + h / 2, z });
}
// Cylinder mellan två punkter
function rod(a, b, r0, r1 = r0, seg = 7) {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.applyQuaternion(_q.setFromUnitVectors(_up, _d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}
function ball(r, x, y, z, sx = 1, sy = 1, sz = 1, seg = 10) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.7 | 0));
  g.scale(sx, sy, sz);
  return g.translate(x, y, z);
}
function tube(points, r, seg = 10, rad = 5) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, seg, r, rad, false);
}
// Platta normaler (kantiga former som pyramid och obelisk)
function flat(g) {
  const n = g.toNonIndexed();
  n.deleteAttribute('normal');
  n.computeVertexNormals();
  return n;
}
function lathe(profile, seg = 12) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}
// Plan vägg från (x0,z0) till (x1,z1), framsidan åt höger sett längs riktningen (sett ovanifrån)
function wallQuad(x0, z0, x1, z1, y0, y1, m) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const g = new THREE.PlaneGeometry(len, y1 - y0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / m, (y0 + uv.getY(i) * (y1 - y0)) / m);
  const ang = Math.atan2(z1 - z0, x1 - x0);
  g.rotateY(-ang);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}
// Liggande ljusfläck (UV 0..1 över fläcken)
function poolQuad(x, z, r, y) {
  const g = new THREE.PlaneGeometry(r * 2, r * 2);
  g.rotateX(-Math.PI / 2);
  return g.translate(x, y, z);
}
// Liggande plan med världs-UV
function floorQuad(x0, z0, x1, z1, y, m) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / m, -p.getZ(i) / m);
  return g;
}

// ===========================================================================
// Huset: golv, väggar, mellanväggar med valv, tak
// ===========================================================================

// Vilken sal ligger punkten i?
export function roomOf(M, x, z) {
  if (z > M.splitZ) return 'hall';
  return x > M.splitX ? 'egypt' : 'space';
}

const FLOOR_MAT = {
  hall: () => cached('fmHall', () => new THREE.MeshStandardMaterial({ map: hallFloorTex(), roughness: 0.1, metalness: 0.05, envMap: nightEnv(), envMapIntensity: 1.5 })),
  space: () => cached('fmSpace', () => new THREE.MeshStandardMaterial({ map: checkerTex(), roughness: 0.06, metalness: 0.1, envMap: nightEnv(), envMapIntensity: 1.0 })),
  egypt: () => cached('fmEgypt', () => new THREE.MeshStandardMaterial({ map: sandFloorTex(), roughness: 0.7, envMap: nightEnv(), envMapIntensity: 1 })),
};
const FLOOR_TILE = { hall: HALL_TILE, space: SPACE_TILE, egypt: SAND_TILE };

export function makeFloors(scene, world, RAPIER, M) {
  if (world) {
    const body = fixed(world, RAPIER);
    boxCol(world, RAPIER, body, M.size / 2 + 4, 0.5, M.size / 2 + 4, 0, -0.5, 0, 0, 1);
  }
  if (!scene) return;
  const h = M.half;
  for (const [room, x0, z0, x1, z1] of [
    ['hall', -h, M.splitZ, h, h], ['egypt', M.splitX, -h, h, M.splitZ], ['space', -h, -h, M.splitX, M.splitZ],
  ]) {
    const m = new THREE.Mesh(floorQuad(x0, z0, x1, z1, 0, FLOOR_TILE[room]), FLOOR_MAT[room]());
    m.receiveShadow = true;
    scene.add(m);
  }
}

// Vägens yta i salens eget golv (vägen syns bara som repen och kanten),
// rulltrappsstål i ramperna.
export function addRoadSkin(scene, track, M, isEscalator) {
  const { pts, normals, N, roadHalf, isGap } = track;
  const buckets = { hall: [], space: [], egypt: [], esc: [] };
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    if (isGap[i] || isGap[j]) continue;
    const a = pts[i], b = pts[j];
    // Rulltrappor och rymdsalens hoppramper (Egyptensalens doserade kurva får sand)
    const esc = (isEscalator(i) && isEscalator(j)) || (a.y > 0.01 && b.y > 0.01 && a.z < M.splitZ && a.x < M.splitX);
    const key = esc ? 'esc' : a.y > M.deckY - 0.05 ? 'hall' : roomOf(M, (a.x + b.x) / 2, (a.z + b.z) / 2);
    buckets[key].push(i);
  }
  for (const [key, list] of Object.entries(buckets)) {
    if (!list.length) continue;
    const pos = [], uv = [];
    const m = FLOOR_TILE[key];
    for (const i of list) {
      const j = (i + 1) % N;
      const q = [];
      for (const [k, s] of [[i, 1], [i, -1], [j, -1], [j, 1]]) {
        const p = pts[k], n = normals[k];
        const x = p.x + n.x * roadHalf * s, z = p.z + n.z * roadHalf * s;
        q.push([x, p.y + 0.007 + bankY(track, k, roadHalf * s), z, key === 'esc' ? (s > 0 ? 0 : 1) : x / m, key === 'esc' ? track.dist[k] / 0.42 : -z / m]);
      }
      if (key === 'esc' && j === 0) q[2][4] = q[3][4] = track.length / 0.42;
      for (const t of [0, 1, 2, 0, 2, 3]) { pos.push(q[t][0], q[t][1], q[t][2]); uv.push(q[t][3], q[t][4]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const base = key === 'esc'
      ? cached('fmEsc', () => new THREE.MeshStandardMaterial({ map: escalatorTex(), roughness: 0.35, metalness: 0.7, envMap: nightEnv(), envMapIntensity: 1.5 }))
      : FLOOR_MAT[key]();
    const mat = cached('skin' + key, () => {
      const mm = base.clone();
      mm.polygonOffset = true; mm.polygonOffsetFactor = -4; mm.polygonOffsetUnits = -4;
      mm.side = THREE.DoubleSide;
      return mm;
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// Ytter- och mellanväggar. doors: [{axis:'x'|'z', at, from, to}] öppningar.
export function addShell(B, world, RAPIER, M, doors) {
  const h = M.half, H = M.H, T = 0.5, DH = 5.2;
  // Väggsegment: [x0,z0,x1,z1, rumsmaterial för vardera sida]
  const segs = [];
  const split = (x0, z0, x1, z1, opens) => {
    // dela upp en rak vägg kring dörröppningar längs dess axel
    const alongX = z0 === z1;
    let a = alongX ? x0 : z0;
    const b = alongX ? x1 : z1;
    const list = opens.slice().sort((p, q) => p[0] - q[0]);
    for (const [o0, o1] of list) {
      segs.push(alongX ? [a, z0, o0, z1, 0, H] : [x0, a, x1, o0, 0, H]);
      segs.push(alongX ? [o0, z0, o1, z1, DH, H, true] : [x0, o0, x1, o1, DH, H, true]);
      a = o1;
    }
    segs.push(alongX ? [a, z0, b, z1, 0, H] : [x0, a, x1, b, 0, H]);
  };
  const doorsZ = doors.filter((d) => d.axis === 'z').map((d) => [d.from, d.to]);
  const doorsX = doors.filter((d) => d.axis === 'x').map((d) => [d.from, d.to]);
  split(-h, M.splitZ, h, M.splitZ, doorsZ);
  split(M.splitX, -h, M.splitX, M.splitZ, doorsX);

  if (world) {
    const body = fixed(world, RAPIER);
    for (const [x, z, hx, hz] of [[0, -h - T / 2, h + T, T / 2], [0, h + T / 2, h + T, T / 2], [-h - T / 2, 0, T / 2, h + T], [h + T / 2, 0, T / 2, h + T]]) {
      boxCol(world, RAPIER, body, hx, H / 2, hz, x, H / 2, z);
    }
    for (const [x0, z0, x1, z1, y0, y1] of segs) {
      const hx = Math.abs(x1 - x0) / 2 + (x0 === x1 ? T / 2 : 0), hz = Math.abs(z1 - z0) / 2 + (z0 === z1 ? T / 2 : 0);
      boxCol(world, RAPIER, body, hx, (y1 - y0) / 2, hz, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    }
  }
  if (!B) return;

  const wallKey = { hall: 'wallHall', egypt: 'wallSand', space: 'wallSpace' };
  const face = (room, x0, z0, x1, z1, y0, y1) => B.add(wallKey[room], wallQuad(x0, z0, x1, z1, y0, y1, room === 'hall' ? 2.4 : 3));
  // Ytterväggar: varje bit i rätt sal
  const outer = [
    ['space', -h, -h, 0, -h], ['egypt', 0, -h, h, -h],
    ['egypt', h, -h, h, M.splitZ], ['hall', h, M.splitZ, h, h],
    ['hall', h, h, -h, h],
    ['hall', -h, h, -h, M.splitZ], ['space', -h, M.splitZ, -h, -h],
  ];
  for (const [room, x0, z0, x1, z1] of outer) face(room, x0, z0, x1, z1, 0, H);
  // Mellanväggarnas två sidor, valvets insida och överstycke
  for (const [x0, z0, x1, z1, y0, y1, lintel] of segs) {
    const alongX = z0 === z1;
    if (alongX) {
      const zS = z0 + T / 2, zN = z0 - T / 2;
      // Plan framsida åt höger längs riktningen
      face('hall', x0, zS, x1, zS, y0, y1);
      const mid = (x0 + x1) / 2;
      face(roomOf(M, mid, z0 - 1), x1, zN, x0, zN, y0, y1);
      if (lintel) B.add('marble', box(x1 - x0, 0.3, T + 0.1, mid, y0 + 0.15, z0, 0, 1));
      else for (const x of [x0, x1]) if (Math.abs(x) < h - 0.1) B.add('marble', box(0.4, DH + 0.3, T + 0.3, x + (x === x0 ? 0.2 : -0.2), (DH + 0.3) / 2, z0, 0, 1));
    } else {
      const xE = x0 + T / 2, xW = x0 - T / 2;
      face('egypt', xE, z1, xE, z0, y0, y1);
      face('space', xW, z0, xW, z1, y0, y1);
      const mid = (z0 + z1) / 2;
      if (lintel) B.add('marble', box(T + 0.1, 0.3, z1 - z0, x0, y0 + 0.15, mid, 0, 1));
    }
  }
  // Tak per sal
  for (const [key, x0, z0, x1, z1] of [
    ['ceilHall', -h, M.splitZ, h, h], ['ceilEgypt', M.splitX, -h, h, M.splitZ], ['ceilSpace', -h, -h, M.splitX, M.splitZ],
  ]) {
    // Spegelvänd i z före vändningen så att taket hamnar över rätt sal
    const g = floorQuad(x0, -z1, x1, -z0, 0, key === 'ceilHall' ? 4 : key === 'ceilEgypt' ? 6 : 10);
    g.rotateX(Math.PI); g.translate(0, H, 0);
    B.add(key, g);
  }
  // Takbalkar i stora salen (kassetternas ramar) och taklist längs väggarna
  for (let x = -h + 6; x < h; x += 8) B.add('marble', box(0.5, 0.5, h - M.splitZ, x, H - 0.25, (h + M.splitZ) / 2, 0, 1), [0.62, 0.56, 0.5]);
  const cornice = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    B.add('marble', place(new THREE.BoxGeometry(len, 0.35, 0.5), { x: mx, y: H - 0.5, z: mz, ry: -ang }), [0.85, 0.82, 0.76]);
    B.add('wood', place(new THREE.BoxGeometry(len, 0.3, 0.12), { x: mx, y: 0.15, z: mz, ry: -ang }), [0.5, 0.4, 0.34]);
  };
  for (const [, x0, z0, x1, z1] of outer) cornice(x0, z0, x1, z1);
}

// ===========================================================================
// Pelare (korintisk stil, förenklad) och egyptiska lotuspelare
// ===========================================================================

export function addColumn(B, world, RAPIER, body, { x, z, h = 9, r = 0.42, kind = 'classic' }) {
  if (world) cylCol(world, RAPIER, body, r + 0.05, h, x, z);
  if (!B) return;
  if (kind === 'classic') {
    B.add('marble', box(r * 2.9, 0.35, r * 2.9, x, 0.175, z, 0, 1));
    B.add('marble', place(lathe([[0, 0], [r * 1.35, 0], [r * 1.35, 0.12], [r * 1.15, 0.2], [r * 1.2, 0.3], [r, 0.42], [0, 0.42]], 20), { x, y: 0.35, z }));
    const shaft = new THREE.CylinderGeometry(r * 0.88, r, h - 1.6, 20, 1, true);
    B.add('marble', place(shaft, { x, y: 0.77 + (h - 1.6) / 2, z }));
    // Kannelyrer antyds med smala mörka lister
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      B.add('marble', place(new THREE.BoxGeometry(0.03, h - 1.8, 0.03), { x: x + Math.cos(a) * r * 0.95, y: 0.8 + (h - 1.8) / 2, z: z + Math.sin(a) * r * 0.95 }), [0.72, 0.7, 0.66]);
    }
    B.add('marble', place(lathe([[0, 0], [r * 0.9, 0], [r * 1.05, 0.12], [r * 1.4, 0.45], [r * 1.5, 0.6], [0, 0.6]], 20), { x, y: h - 0.85, z }));
    B.add('marble', box(r * 3.4, 0.25, r * 3.4, x, h - 0.125, z, 0, 1));
    B.add('brass', place(new THREE.TorusGeometry(r * 0.95, 0.025, 6, 20), { x, y: h - 0.9, z, rx: Math.PI / 2 }));
  } else {
    // Lotuspelare: målade band och utsvängt kapitäl
    B.add('stone', box(r * 2.8, 0.4, r * 2.8, x, 0.2, z, 0, 1));
    B.add('stone', cyl(r * 0.92, r, h - 2, x, 0.4, z, 16));
    for (const [y, col] of [[1.2, [0.25, 0.45, 0.75]], [1.5, [0.75, 0.3, 0.2]], [h - 2.2, [0.25, 0.45, 0.75]], [h - 1.95, [0.85, 0.65, 0.25]]]) {
      B.add('enamel', cyl(r * 0.95, r * 0.97, 0.18, x, y, z, 16), col);
    }
    B.add('stone', place(lathe([[r * 0.9, 0], [r * 1.1, 0.3], [r * 1.6, 1.2], [r * 1.7, 1.4], [0, 1.4]], 16), { x, y: h - 1.6, z }), [1, 0.92, 0.8]);
    B.add('stone', box(r * 3.2, 0.2, r * 3.2, x, h - 0.1, z, 0, 1));
  }
}

// ===========================================================================
// Galleriet: upphöjt däck med balustrad, rulltrappor
// ===========================================================================

export function addDeck(B, world, RAPIER, body, { rects, y, balustrades }) {
  if (world) for (const [x0, z0, x1, z1] of rects) boxCol(world, RAPIER, body, (x1 - x0) / 2, (y - 0.02) / 2, (z1 - z0) / 2, (x0 + x1) / 2, (y - 0.02) / 2, (z0 + z1) / 2, 0, 0.8);
  if (!B) return;
  for (const [x0, z0, x1, z1] of rects) {
    const top = y - 0.02;
    // Sidor i marmor med mörk sockel och mässingslist
    const g = box(x1 - x0, top, z1 - z0, (x0 + x1) / 2, top / 2, (z0 + z1) / 2, 0, 1.5);
    B.add('marble', g, [0.9, 0.87, 0.8]);
    B.add('dark', box(x1 - x0 + 0.04, 0.25, z1 - z0 + 0.04, (x0 + x1) / 2, 0.125, (z0 + z1) / 2));
    B.add('brass', box(x1 - x0 + 0.06, 0.05, z1 - z0 + 0.06, (x0 + x1) / 2, top - 0.08, (z0 + z1) / 2));
    // Däckets ovansida i samma marmor som golvet: läggs som golvbit
    B.floorTiles = B.floorTiles || [];
    B.floorTiles.push(floorQuad(x0, z0, x1, z1, top + 0.002, HALL_TILE));
  }
  // Balustrad: dockor (svarvade) med ledstång
  for (const [x0, z0, x1, z1] of balustrades) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(len / 0.32));
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      B.add('marble', place(lathe([[0.07, 0], [0.07, 0.08], [0.05, 0.12], [0.09, 0.32], [0.05, 0.55], [0.07, 0.62], [0.07, 0.68], [0, 0.68]], 8), { x, y: y + 0.1, z }));
    }
    const ang = Math.atan2(z1 - z0, x1 - x0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    B.add('marble', place(new THREE.BoxGeometry(len + 0.2, 0.1, 0.3), { x: mx, y: y + 0.05, z: mz, ry: -ang }));
    B.add('marble', place(new THREE.BoxGeometry(len + 0.2, 0.1, 0.28), { x: mx, y: y + 0.83, z: mz, ry: -ang }));
    // Pelarstolpar vid ändarna
    for (const [x, z] of [[x0, z0], [x1, z1]]) B.add('marble', box(0.34, 1.0, 0.34, x, y + 0.5, z, 0, 1));
  }
  if (world) {
    for (const [x0, z0, x1, z1] of balustrades) {
      const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
      boxCol(world, RAPIER, body, len / 2, 0.45, 0.15, (x0 + x1) / 2, y + 0.45, (z0 + z1) / 2, -ang);
    }
  }
}

// Rulltrappa längs banan mellan index i0 och i1: stålsidor, glasskivor, ledstång
export function addEscalator(B, track, i0, i1) {
  if (!B) return;
  const { pts, normals, N, roadHalf } = track;
  const off = roadHalf + track.barrier.thick + 0.08;
  for (const s of [1, -1]) {
    const pos = [], gpos = [];
    const rail = [];
    for (let k = i0; k !== i1; k = (k + 1) % N) {
      const j = (k + 1) % N;
      const P = (i, o, dy) => { const p = pts[i], n = normals[i]; return [p.x + n.x * o * s, p.y + dy, p.z + n.z * o * s]; };
      // Stålsida (yttre kjol) från golvet till strax över vägen
      const a = P(k, off, 0.12), b = P(j, off, 0.12);
      const quad = (arr, A, Bq, C, D) => arr.push(...A, ...Bq, ...C, ...A, ...C, ...D);
      quad(pos, [a[0], 0, a[2]], [b[0], 0, b[2]], b, a);
      const ia = P(k, off - 0.06, 0.12), ib = P(j, off - 0.06, 0.12);
      quad(pos, a, b, ib, ia);
      // Glas
      const ga = P(k, off - 0.03, 0.12), gb = P(j, off - 0.03, 0.12), gc = P(j, off - 0.03, 0.95), gd = P(k, off - 0.03, 0.95);
      quad(gpos, ga, gb, gc, gd);
      rail.push(P(k, off - 0.03, 1.0));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    B.add('steel', g, [0.75, 0.78, 0.82]);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
    gg.computeVertexNormals();
    B.add('glass', gg);
    if (rail.length > 3) B.add('rubber', tube(rail, 0.045, rail.length, 6));
    // Ändstolpar
    for (const k of [i0, i1]) {
      const p = pts[k], n = normals[k];
      B.add('steel', box(0.14, 1.1, 0.5, p.x + n.x * off * s, p.y + 0.55, p.z + n.z * off * s, Math.atan2(track.tangents[k].x, track.tangents[k].z)));
    }
  }
}

// ===========================================================================
// Entréhallens stora trappa: marmorsteg från galleriets kant (x0, höjd y) ner
// till golvet vid x1, mellan z0 och z1, med svarvade balustrader på sidorna.
// Stegnosarna ligger på linjen mellan kanten och foten; banan lägger en slät
// osynlig yta där (addUnderlay) som bär bilar som landar på stegen.
// ===========================================================================

export function addGrandStairs(B, world, RAPIER, body, { x0, x1, z0, z1, y, steps = 9 }) {
  const L = x1 - x0, ang = Math.atan2(y, L), w = z1 - z0, zc = (z0 + z1) / 2;
  if (world) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ang);
    // Trappans sidor (vangstycken) som låga murar
    for (const z of [z0 - 0.15, z1 + 0.15]) {
      const g = new THREE.Vector3(x0 + L / 2, y / 2 + 0.3, z);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(Math.hypot(L, y) / 2, 0.36, 0.14).setTranslation(g.x, g.y, g.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setCollisionGroups(groups(G.WORLD)),
        body
      );
    }
  }
  if (!B) return;
  const rise = y / steps, tread = L / steps;
  for (let k = 0; k < steps - 1; k++) {
    const top = y - (k + 1) * rise;
    const xa = x0 + k * tread;
    B.add('marble', box(tread + 0.02, top, w, xa + tread / 2, top / 2, zc, 0, 1), [0.93, 0.9, 0.84]);
    // Mässingsnos på varje steg
    B.add('brass', box(0.05, 0.03, w, xa + tread - 0.02, top - 0.01, zc));
  }
  // Vangstycken med balustrad längs trappans sidor
  for (const z of [z0 - 0.15, z1 + 0.15]) {
    const len = Math.hypot(L, y);
    B.add('marble', place(new THREE.BoxGeometry(len + 0.2, 0.72, 0.3), { x: x0 + L / 2, y: y / 2 + 0.3, z, rz: -ang }), [0.9, 0.87, 0.8]);
    B.add('marble', place(new THREE.BoxGeometry(len + 0.2, 0.1, 0.28), { x: x0 + L / 2, y: y / 2 + 1.5, z, rz: -ang }));
    const n = Math.round(len / 0.36);
    for (let k = 1; k < n; k++) {
      const t = k / n, x = x0 + L * t, yy = y * (1 - t) + 0.66;
      B.add('marble', place(lathe([[0.06, 0], [0.06, 0.07], [0.045, 0.1], [0.08, 0.28], [0.045, 0.48], [0.06, 0.54], [0.06, 0.8], [0, 0.8]], 8), { x, y: yy, z }));
    }
    // Pelarstolpar med lyktor vid trappans fot
    B.add('marble', box(0.42, 1.3, 0.42, x1 + 0.1, 0.65, z, 0, 1));
    B.add('brass', ball(0.16, x1 + 0.1, 1.45, z, 1, 1.3, 1, 10));
  }
}

// ===========================================================================
// Sammetsrep på mässingsstolpar längs vallarna
// ===========================================================================

export function addRopes(B, track, skip) {
  if (!B) return;
  const { pts, normals, N, roadHalf } = track;
  const off = roadHalf + track.barrier.thick / 2;
  const every = 6, postH = 0.78;
  for (const s of [1, -1]) {
    let prev = null;
    for (let i = 0; i < N; i += every) {
      if (skip(i)) { prev = null; continue; }
      const p = pts[i], n = normals[i];
      const x = p.x + n.x * off * s, z = p.z + n.z * off * s, y = p.y + track.barrier.height + bankY(track, i, off * s);
      B.add('brass', cyl(0.085, 0.1, 0.03, x, y - 0.005, z, 10));
      B.add('brass', cyl(0.022, 0.026, postH, x, y, z, 6));
      B.add('brass', ball(0.045, x, y + postH + 0.03, z, 1, 1, 1, 8));
      const top = [x, y + postH - 0.06, z];
      if (prev && i - prev.i <= every) {
        const mid = [(top[0] + prev.top[0]) / 2, (top[1] + prev.top[1]) / 2 - 0.16, (top[2] + prev.top[2]) / 2];
        B.add('velvet', tube([prev.top, mid, top], 0.025, 6, 5));
      }
      prev = { i, top };
    }
  }
}

// ===========================================================================
// Dinosaurieskelett (T. rex) på sockel
// ===========================================================================

export function addDinosaur(B, world, RAPIER, body, { x, z, rot = 0, s = 1 }) {
  const PW = 14 * s, PD = 5.4 * s, PH = 0.55;
  if (world) boxCol(world, RAPIER, body, PW / 2, PH / 2, PD / 2, x, PH / 2, z, rot);
  if (!B) return;
  const c = Math.cos(rot), sn = Math.sin(rot);
  // Lokala koordinater: u framåt (huvudet), v uppåt, w åt sidan
  const P = (u, v, w = 0) => [x + (u * c + w * sn) * s, PH + v * s, z + (-u * sn + w * c) * s];
  B.add('dark', box(PW, PH, PD, x, PH / 2, z, rot));
  B.add('brass', box(PW + 0.06, 0.05, PD + 0.06, x, PH - 0.1, z, rot));
  B.add('brass', place(new THREE.BoxGeometry(1.2, 0.35, 0.04), { x: x + (sn * (PD / 2 + 0.03)), y: 0.3, z: z + c * (PD / 2 + 0.03), ry: rot }));

  // Ryggraden som kurva
  const spine = new THREE.CatmullRomCurve3([
    [-6.6, 1.9], [-5.2, 2.4], [-3.6, 3.0], [-1.8, 3.55], [0, 3.85], [1.4, 3.75], [2.7, 3.45], [3.4, 3.7], [4.0, 4.25], [4.5, 4.55],
  ].map(([u, v]) => new THREE.Vector3(u, v, 0)));
  const nV = 46;
  for (let k = 0; k <= nV; k++) {
    const t = k / nV, p = spine.getPoint(t), tan = spine.getTangent(t);
    const rr = 0.04 + 0.14 * Math.sin(Math.min(1, t * 1.35) * Math.PI * 0.85);
    const a = P(p.x - tan.x * 0.09, p.y - tan.y * 0.09), b = P(p.x + tan.x * 0.09, p.y + tan.y * 0.09);
    B.add('bone', rod(a, b, rr, rr * 0.9, 7));
    // Taggutskott uppåt och chevronben under svansen
    const up = 0.12 + 0.45 * Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.8);
    B.add('bone', rod(P(p.x, p.y), P(p.x - 0.08, p.y + up), 0.035, 0.015, 4));
    if (p.x < -0.5) B.add('bone', rod(P(p.x, p.y), P(p.x - 0.1, p.y - up * 0.7), 0.025, 0.01, 4));
    if (p.x > -0.3 && p.x < 3) for (const w of [1, -1]) B.add('bone', rod(P(p.x, p.y), P(p.x, p.y + 0.05, w * rr * 1.8), 0.03, 0.02, 4));
  }
  // Revben
  for (let u = 0.2; u < 2.9; u += 0.27) {
    const p = spine.getPoint(0.6 + (u / 2.9) * 0.18);
    const len = 1 - Math.abs(u - 1.3) / 2.2;
    for (const w of [1, -1]) {
      B.add('bone', tube([P(u, p.y - 0.05, w * 0.12), P(u + 0.08, p.y - 0.35, w * 0.62), P(u + 0.18, p.y - 1.1 * len, w * 0.72), P(u + 0.28, p.y - 1.75 * len, w * 0.38)], 0.032, 8, 4));
    }
  }
  // Bukrevben (gastralier)
  for (let u = 0.3; u < 2.6; u += 0.28) B.add('bone', tube([P(u + 0.2, 2.0, 0.4), P(u + 0.3, 1.88, 0), P(u + 0.2, 2.0, -0.4)], 0.018, 5, 3));
  // Kraniet med käkar och tänder
  const hu = 4.6, hv = 4.55;
  const skull = new THREE.BoxGeometry(1.45, 0.62, 0.5, 4, 2, 2);
  const sp = skull.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const t = (sp.getX(i) + 0.725) / 1.45; // 0 bak, 1 nos
    sp.setY(i, sp.getY(i) * (1 - t * 0.45) + (sp.getY(i) > 0 ? -t * 0.06 : t * 0.05));
    sp.setZ(i, sp.getZ(i) * (1 - t * 0.35));
  }
  skull.computeVertexNormals();
  const skullAng = -0.12;
  const toWorld = (g, u, v, w = 0, ang = 0) => {
    g.rotateZ(ang); g.scale(s, s, s); g.rotateY(rot);
    const [px, py, pz] = P(u, v, w);
    return g.translate(px, py, pz);
  };
  B.add('bone', toWorld(skull, hu + 0.55, hv + 0.05, 0, skullAng));
  const jaw = new THREE.BoxGeometry(1.35, 0.2, 0.42, 3, 1, 1);
  const jp = jaw.attributes.position;
  for (let i = 0; i < jp.count; i++) { const t = (jp.getX(i) + 0.675) / 1.35; jp.setZ(i, jp.getZ(i) * (1 - t * 0.35)); }
  jaw.translate(0.675, 0, 0);
  B.add('bone', toWorld(jaw, hu + 0.0, hv - 0.32, 0, -0.42));
  // Ögonhålor och näsborrar (mörka)
  for (const w of [1, -1]) B.add('dark', ball(0.1, ...P(hu + 0.42, hv + 0.14, w * 0.23), 1, 1.3, 0.5, 8));
  for (let k = 0; k < 9; k++) {
    for (const w of [1, -1]) {
      const u = hu + 0.4 + k * 0.11, v = hv - 0.22 - k * 0.012;
      B.add('bone', place(new THREE.ConeGeometry(0.025, 0.11, 4), { x: P(u, v, w * 0.17)[0], y: P(u, v, w * 0.17)[1] - 0.05, z: P(u, v, w * 0.17)[2], rx: Math.PI }), [1, 0.97, 0.88]);
      const lu = hu + 0.15 + k * 0.1, lv = hv - 0.42 - k * 0.04;
      B.add('bone', place(new THREE.ConeGeometry(0.022, 0.09, 4), { x: P(lu, lv, w * 0.15)[0], y: P(lu, lv, w * 0.15)[1] + 0.05, z: P(lu, lv, w * 0.15)[2] }), [1, 0.97, 0.88]);
    }
  }
  // Bäcken
  for (const w of [1, -1]) {
    B.add('bone', toWorld(new THREE.BoxGeometry(1.1, 0.32, 0.06, 4, 1, 1), 0.1, 3.5, w * 0.3));
    B.add('bone', rod(P(0.2, 3.2, w * 0.25), P(0.75, 2.05, w * 0.12), 0.07, 0.06));
    B.add('bone', rod(P(-0.2, 3.2, w * 0.25), P(-0.8, 2.3, w * 0.12), 0.06, 0.04));
  }
  B.add('bone', ball(0.2, ...P(0.78, 1.98, 0), 1.6, 0.6, 1, 8));
  // Bakben (ett steg framåt med vänster)
  for (const [w, du] of [[1, 0.45], [-1, -0.35]]) {
    const hip = P(0.05, 3.2, w * 0.45), knee = P(0.6 + du, 2.0, w * 0.55), ankle = P(0.05 + du, 0.85, w * 0.48), foot = P(0.5 + du, 0.12, w * 0.46);
    B.add('bone', rod(hip, knee, 0.15, 0.11, 8));
    B.add('bone', rod(knee, ankle, 0.11, 0.08, 8));
    B.add('bone', rod(ankle, foot, 0.07, 0.06, 7));
    for (const j of [hip, knee, ankle, foot]) B.add('bone', ball(0.13, ...j, 1, 1, 1, 8));
    for (const dw of [-0.14, 0, 0.14]) {
      const toe = P(1.05 + du + (dw === 0 ? 0.08 : 0), 0.04, w * 0.46 + dw);
      B.add('bone', rod(foot, toe, 0.05, 0.03, 5));
      B.add('bone', place(new THREE.ConeGeometry(0.03, 0.14, 5), { x: toe[0], y: toe[1], z: toe[2], rz: rot === 0 ? -Math.PI / 2 : Math.PI / 2 }));
    }
  }
  // Små armar
  for (const w of [1, -1]) {
    const sh = P(2.75, 2.75, w * 0.38), el = P(3.0, 2.35, w * 0.42), ha = P(3.25, 2.42, w * 0.4);
    B.add('bone', rod(sh, el, 0.05, 0.04, 6));
    B.add('bone', rod(el, ha, 0.04, 0.03, 6));
    B.add('bone', rod(ha, P(3.38, 2.32, w * 0.37), 0.02, 0.01, 4));
    B.add('bone', rod(ha, P(3.36, 2.3, w * 0.45), 0.02, 0.01, 4));
    B.add('bone', rod(P(2.3, 3.35, w * 0.3), P(2.75, 2.8, w * 0.4), 0.06, 0.03, 5));
  }
  // Stödstänger i stål
  for (const u of [-4.2, -1.5, 1.6, 3.6]) {
    const p = spine.getPoint(Math.max(0, Math.min(1, (u + 6.6) / 11.1)));
    B.add('steel', rod(P(u, 0, 0), P(u, p.y - 0.12, 0), 0.03, 0.03, 6), [0.3, 0.3, 0.32]);
  }
}

// ===========================================================================
// Egypten: sarkofag, obelisk, pyramid, sandstensblock, sittande statyer
// ===========================================================================

export function addSarcophagus(B, world, RAPIER, body, { x, z, rot = 0 }) {
  if (world) boxCol(world, RAPIER, body, 2.0, 0.6, 1.2, x, 0.6, z, rot);
  if (!B) return;
  B.add('dark', box(4.0, 0.8, 2.4, x, 0.4, z, rot));
  B.add('gold', box(4.06, 0.05, 2.46, x, 0.72, z, rot));
  const c = Math.cos(rot), sn = Math.sin(rot);
  const L = (u, w) => [x + u * c + w * sn, z - u * sn + w * c];
  // Kistan: människoformad kontur, utdragen
  const sh = new THREE.Shape();
  sh.moveTo(-1.15, 0);
  sh.bezierCurveTo(-1.15, 0.3, -0.9, 0.36, -0.4, 0.4);
  sh.bezierCurveTo(0.2, 0.44, 0.55, 0.42, 0.75, 0.3);
  sh.bezierCurveTo(0.95, 0.36, 1.2, 0.25, 1.2, 0);
  sh.bezierCurveTo(1.2, -0.25, 0.95, -0.36, 0.75, -0.3);
  sh.bezierCurveTo(0.55, -0.42, 0.2, -0.44, -0.4, -0.4);
  sh.bezierCurveTo(-0.9, -0.36, -1.15, -0.3, -1.15, 0);
  const body0 = new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.08, bevelSegments: 2, curveSegments: 10 });
  body0.rotateX(-Math.PI / 2);
  // Färga: guld med blå band
  const pos = body0.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i), y = pos.getY(i);
    const band = (Math.floor((u + 2) * 4) % 3 === 0 && u < 0.6) || y > 0.5;
    const [r, g, b] = band ? [0.18, 0.32, 0.7] : [0.95, 0.72, 0.28];
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
  }
  body0.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body0.rotateY(rot);
  body0.translate(x, 0.82, z);
  B.add('enamel', body0, null);
  // Ansiktsmask och huvudduk
  const [hx, hz] = L(0.95, 0);
  B.add('gold', ball(0.26, hx, 1.48, hz, 1, 0.75, 1, 12));
  for (const [w, cc] of [[0.3, [0.18, 0.32, 0.7]], [-0.3, [0.18, 0.32, 0.7]]]) {
    const [px, pz] = L(0.85, w);
    B.add('enamel', place(new THREE.BoxGeometry(0.35, 0.12, 0.16), { x: px, y: 1.38, z: pz, ry: rot }), cc);
  }
  // Korslagda armar med spira
  for (const w of [1, -1]) {
    const [ax, az] = L(0.15, w * 0.3), [bx, bz] = L(0.45, -w * 0.12);
    B.add('enamel', rod([ax, 1.45, az], [bx, 1.5, bz], 0.06, 0.06, 8), [0.95, 0.72, 0.28]);
  }
  // Glasmonter över
  B.add('glass', box(3.7, 1.4, 2.1, x, 0.8 + 0.7, z, rot));
  B.add('brass', box(3.74, 0.04, 2.14, x, 2.2, z, rot));
}

export function addObelisk(B, world, RAPIER, body, { x, z, h = 7.5 }) {
  if (world) boxCol(world, RAPIER, body, 0.9, h / 2, 0.9, x, h / 2, z);
  if (!B) return;
  B.add('stone', box(1.9, 0.5, 1.9, x, 0.25, z, 0, 1), [0.9, 0.82, 0.72]);
  const shaft = flat(new THREE.CylinderGeometry(0.42, 0.68, h - 1.2, 4, 1).rotateY(Math.PI / 4));
  B.add('hiero', place(shaft, { x, y: 0.5 + (h - 1.2) / 2, z }));
  const top = flat(new THREE.ConeGeometry(0.42, 0.6, 4).rotateY(Math.PI / 4));
  B.add('gold', place(top, { x, y: h - 0.4, z }));
}

export function addPyramid(B, world, RAPIER, body, { x, z, size = 4.5 }) {
  if (world) boxCol(world, RAPIER, body, size / 2 + 0.3, 0.6, size / 2 + 0.3, x, 0.6, z);
  if (!B) return;
  B.add('dark', box(size + 0.8, 0.6, size + 0.8, x, 0.3, z));
  const p = flat(new THREE.ConeGeometry(size * 0.707, size * 0.65, 4, 1).rotateY(Math.PI / 4));
  B.add('stone', place(p, { x, y: 0.6 + size * 0.325, z }), [1, 0.93, 0.82]);
  const cap = flat(new THREE.ConeGeometry(0.3, 0.3, 4).rotateY(Math.PI / 4));
  B.add('gold', place(cap, { x, y: 0.6 + size * 0.65 - 0.1, z }));
}

export function addBlocks(B, world, RAPIER, body, list) {
  for (const b of list) {
    const { x, z, w, h, d, y = 0, ry = 0, drum } = b;
    if (world) {
      if (drum) cylCol(world, RAPIER, body, w / 2, h, x, z, y);
      else boxCol(world, RAPIER, body, w / 2, h / 2, d / 2, x, y + h / 2, z, ry);
    }
    if (!B) continue;
    if (drum) B.add('stone', cyl(w / 2, w / 2, h, x, y, z, 14), [0.95, 0.88, 0.78]);
    else B.add('stone', box(w, h, d, x, y + h / 2, z, ry, 1.6), [0.96 - (x * 7 % 3) * 0.04, 0.88, 0.76]);
  }
}

export function addPharaoh(B, world, RAPIER, body, { x, z, ry = 0, s = 1 }) {
  if (world) boxCol(world, RAPIER, body, 0.8 * s, 1.8 * s, 1.1 * s, x, 1.8 * s, z, ry);
  if (!B) return;
  const c = Math.cos(ry), sn = Math.sin(ry);
  const P = (u, w) => [x + (u * c + w * sn) * s, z + (-u * sn + w * c) * s]; // u framåt
  const add = (key, g, u, y, w, col) => { g.scale(s, s, s); g.rotateY(ry); const [px, pz] = P(u, w); B.add(key, g.translate(px, y * s, pz), col); };
  const tone = [0.92, 0.84, 0.72];
  add('stone', new THREE.BoxGeometry(1.6, 0.5, 2.2), 0, 0.25, 0, tone);
  add('stone', new THREE.BoxGeometry(1.3, 1.2, 1.3), -0.2, 1.1, 0, tone); // tronen
  add('stone', new THREE.BoxGeometry(0.3, 2.6, 1.3), -0.85, 1.8, 0, tone); // ryggstöd
  for (const w of [0.25, -0.25]) {
    add('stone', new THREE.BoxGeometry(0.9, 0.36, 0.34), 0.35, 1.85, w, tone); // lår
    add('stone', new THREE.BoxGeometry(0.34, 1.2, 0.34), 0.72, 1.1, w, tone); // smalben
    add('stone', new THREE.BoxGeometry(0.5, 0.14, 0.3), 0.85, 0.57, w, tone); // fot
    add('stone', new THREE.BoxGeometry(0.7, 0.18, 0.2), 0.3, 2.1, w * 1.7, tone); // underarm på låret
  }
  add('stone', new THREE.BoxGeometry(0.6, 1.2, 0.85), -0.25, 2.65, 0, tone); // bål
  add('stone', new THREE.SphereGeometry(0.3, 12, 8), -0.18, 3.5, 0, tone); // huvud
  add('enamel', new THREE.BoxGeometry(0.5, 0.55, 0.9), -0.3, 3.45, 0, [0.2, 0.35, 0.7]); // huvudduk
  add('gold', new THREE.CylinderGeometry(0.17, 0.12, 0.45, 10), -0.25, 3.9, 0); // krona
  add('enamel', new THREE.BoxGeometry(0.1, 0.35, 0.12), 0.08, 3.18, 0, [0.2, 0.35, 0.7]); // skägg
}

export function addHieroPanel(B, { x, z, ry, w = 3, h = 3, y = 1.4, panel = 0 }) {
  if (!B) return;
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, panel * 0.5 + uv.getX(i) * 0.5);
  B.add('hiero', place(g, { x, y: y + h / 2, z, ry }));
  const c = Math.cos(ry), sn = Math.sin(ry);
  B.add('wood', place(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.06), { x: x - sn * 0.035, y: y + h / 2, z: z - c * 0.035, ry }), [0.45, 0.32, 0.2]);
}

// ===========================================================================
// Rymden: planet med ring, raket, månlandare, svart hål
// ===========================================================================

export function addPlanet(B, { x, y, z, r = 3, tilt = 0.4, H = 9 }) {
  if (!B) return;
  B.add('planet', ball(r, x, y, z, 1, 1, 1, 40));
  const ring = new THREE.RingGeometry(r * 1.3, r * 2.1, 72, 1);
  const p = ring.attributes.position, uv = ring.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (Math.hypot(p.getX(i), p.getY(i)) - r * 1.3) / (r * 0.8), 0.5);
  ring.rotateX(-Math.PI / 2 + tilt);
  ring.rotateY(0.5);
  B.add('ring', ring.translate(x, y, z));
  for (const [dx, dz] of [[0.4, 0.3], [-0.3, -0.4]]) B.add('steel', rod([x + dx, y + r * 0.9, z + dz], [x + dx * 2, H, z + dz * 2], 0.012, 0.012, 4));
}

export function addMoon(B, { x, y, z, r, col, H = 9 }) {
  if (!B) return;
  B.add('enamel', ball(r, x, y, z, 1, 1, 1, 18), col);
  B.add('steel', rod([x, y + r, z], [x, H, z], 0.01, 0.01, 4));
}

export function addRocket(B, world, RAPIER, body, { x, z, h = 8.2 }) {
  if (world) cylCol(world, RAPIER, body, 1.6, h, x, z);
  if (!B) return;
  B.add('dark', cyl(1.9, 2.1, 0.5, x, 0, z, 8));
  B.add('steel', cyl(0.25, 0.42, 0.55, x - 0.32, 0.5, z, 10));
  B.add('steel', cyl(0.25, 0.42, 0.55, x + 0.32, 0.5, z, 10));
  B.add('steel', cyl(0.25, 0.42, 0.55, x, 0.5, z - 0.32, 10));
  B.add('steel', cyl(0.25, 0.42, 0.55, x, 0.5, z + 0.32, 10));
  const stages = [[0.7, 3.0], [0.62, 2.0], [0.5, 1.3]];
  let y = 1.0;
  for (const [r, sh] of stages) {
    B.add('paint', cyl(r, r, sh, x, y, z, 20), [0.92, 0.92, 0.9]);
    B.add('paint', cyl(r + 0.01, r + 0.01, 0.35, x, y + 0.3, z, 20), [0.08, 0.08, 0.09]);
    B.add('paint', cyl(r * 0.88, r, 0.2, x, y + sh, z, 20), [0.25, 0.25, 0.27]);
    y += sh + 0.2;
  }
  B.add('paint', cyl(0.05, 0.42, 1.0, x, y, z, 20), [0.92, 0.92, 0.9]);
  B.add('steel', cyl(0.02, 0.05, 0.6, x, y + 1.0, z, 6));
  // Fenor och flagga (målade)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    B.add('paint', place(new THREE.BoxGeometry(0.06, 1.3, 0.7), { x: x + Math.cos(a) * 0.95, y: 1.65, z: z + Math.sin(a) * 0.95, ry: Math.PI / 2 - a }), [0.75, 0.12, 0.1]);
  }
  B.add('paint', place(new THREE.BoxGeometry(0.03, 0.6, 0.9), { x: x + 0.71, y: 3.5, z, ry: 0 }), [0.12, 0.25, 0.65]);
}

export function addLander(B, world, RAPIER, body, { x, z }) {
  if (world) boxCol(world, RAPIER, body, 1.6, 0.6, 1.6, x, 0.6, z);
  if (!B) return;
  B.add('dark', box(3.4, 0.4, 3.4, x, 0.2, z));
  B.add('gold', place(new THREE.CylinderGeometry(0.8, 0.8, 0.7, 8), { x, y: 1.2, z }));
  B.add('paint', place(new THREE.CylinderGeometry(0.55, 0.7, 0.7, 6), { x, y: 1.9, z }), [0.75, 0.75, 0.72]);
  B.add('rubber', ball(0.14, x + 0.5, 2.0, z, 1, 1, 0.4, 8));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4, fx = x + Math.cos(a) * 1.4, fz = z + Math.sin(a) * 1.4;
    B.add('steel', rod([x + Math.cos(a) * 0.6, 1.1, z + Math.sin(a) * 0.6], [fx, 0.45, fz], 0.04, 0.04, 5));
    B.add('steel', cyl(0.2, 0.22, 0.05, fx, 0.4, fz, 10));
  }
  B.add('steel', rod([x, 2.25, z], [x, 2.9, z], 0.02, 0.02, 4));
  B.add('steel', cyl(0.25, 0.08, 0.15, x, 2.9, z, 10));
}

// Svart hål under hoppet: mörk skiva, glödande ring och stjärnor
export function addBlackHole(B, { x, z, r = 2.6 }) {
  if (!B) return;
  B.add('pool', poolQuad(x, z, r * 1.7, 0.02), [0.7, 0.25, 0.9]);
  B.add('glow', place(new THREE.CircleGeometry(r * 0.56, 40), { x, y: 0.05, z, rx: -Math.PI / 2 }), [0, 0, 0]);
  const ring = new THREE.TorusGeometry(r * 0.62, 0.05, 6, 48);
  ring.rotateX(Math.PI / 2);
  B.add('glow', ring.translate(x, 0.04, z), [0.9, 0.35, 1.4]);
  const ring2 = new THREE.TorusGeometry(r * 0.85, 0.025, 5, 48);
  ring2.rotateX(Math.PI / 2);
  B.add('glow', ring2.translate(x, 0.03, z), [0.5, 0.15, 0.9]);
}

// Röda laserlinjer längs väggarna
export function addLasers(B, segs, H = 9) {
  if (!B) return;
  for (const [x0, z0, x1, z1] of segs) {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
    for (const y of [0.45, 1.35, 3.2, 5.8]) {
      B.add('glow', place(new THREE.BoxGeometry(len, 0.035, 0.04), { x: (x0 + x1) / 2, y, z: (z0 + z1) / 2, ry: -ang }), [1.5, 0.03, 0.04]);
    }
    for (let t = 2; t < len - 1; t += 4) {
      const u = t / len;
      B.add('glow', place(new THREE.BoxGeometry(0.035, H - 1, 0.04), { x: x0 + (x1 - x0) * u, y: H / 2, z: z0 + (z1 - z0) * u, ry: -ang }), [1.1, 0.02, 0.03]);
    }
  }
}

// ===========================================================================
// Möbler och utställning: bänkar, montrar, socklar, statyer, tavlor
// ===========================================================================

export function addBench(B, world, RAPIER, body, { x, z, ry = 0, y = 0 }) {
  if (world) boxCol(world, RAPIER, body, 1.0, 0.25, 0.3, x, y + 0.25, z, ry);
  if (!B) return;
  const c = Math.cos(ry), sn = Math.sin(ry);
  B.add('velvet', place(new THREE.BoxGeometry(2.0, 0.12, 0.55), { x, y: y + 0.46, z, ry }), [0.75, 0.12, 0.15]);
  B.add('wood', place(new THREE.BoxGeometry(2.06, 0.08, 0.6), { x, y: y + 0.37, z, ry }));
  for (const u of [-0.9, 0.9]) for (const w of [-0.22, 0.22]) {
    B.add('brass', cyl(0.03, 0.025, 0.34, x + u * c + w * sn, y, z - u * sn + w * c, 6));
  }
}

export function addCase(B, world, RAPIER, body, { x, z, ry = 0, w = 1.6, d = 0.8, item = 'gem', seed = 1 }) {
  if (world) boxCol(world, RAPIER, body, w / 2, 0.75, d / 2, x, 0.75, z, ry);
  if (!B) return;
  const r = rng(seed);
  B.add('wood', box(w, 0.9, d, x, 0.45, z, ry), [0.55, 0.4, 0.3]);
  B.add('brass', box(w + 0.02, 0.04, d + 0.02, x, 0.92, z, ry));
  B.add('glass', box(w - 0.04, 0.7, d - 0.04, x, 1.29, z, ry));
  B.add('brass', box(w + 0.02, 0.03, d + 0.02, x, 1.65, z, ry));
  B.add('velvet', box(w - 0.1, 0.03, d - 0.1, x, 0.95, z, ry), [0.25, 0.08, 0.3]);
  const c = Math.cos(ry), sn = Math.sin(ry);
  const n = item === 'skull' ? 1 : 3;
  for (let k = 0; k < n; k++) {
    const u = n === 1 ? 0 : (k - 1) * w * 0.3, px = x + u * c, pz = z - u * sn;
    if (item === 'gem') {
      const hue = [[0.3, 0.9, 1.6], [1.6, 0.25, 0.5], [0.4, 1.4, 0.5]][k];
      B.add('glow', place(new THREE.OctahedronGeometry(0.1 + r() * 0.05), { x: px, y: 1.12, z: pz, ry: r() * 3 }), hue);
      B.add('dark', cyl(0.08, 0.1, 0.06, px, 0.96, pz, 8));
    } else if (item === 'vase') {
      B.add('enamel', place(lathe([[0, 0], [0.1, 0], [0.16, 0.12], [0.14, 0.25], [0.07, 0.32], [0.09, 0.38], [0, 0.38]], 12), { x: px, y: 0.96, z: pz }), [[0.85, 0.6, 0.3], [0.2, 0.5, 0.6], [0.7, 0.3, 0.2]][k]);
    } else if (item === 'jar') {
      B.add('stone', place(lathe([[0, 0], [0.09, 0], [0.13, 0.15], [0.1, 0.3], [0, 0.3]], 10), { x: px, y: 0.96, z: pz }), [1, 0.92, 0.8]);
      B.add('gold', ball(0.07, px, 1.32, pz, 1, 0.8, 1, 8));
    } else if (item === 'rock') {
      B.add('dark', place(new THREE.DodecahedronGeometry(0.14 + r() * 0.06, 0), { x: px, y: 1.08, z: pz, ry: r() * 3, rx: r() }), [0.6, 0.5, 0.45]);
    } else {
      B.add('bone', ball(0.16, px, 1.12, pz, 1.2, 0.9, 0.9, 10));
      B.add('bone', place(new THREE.BoxGeometry(0.28, 0.06, 0.18), { x: px + c * 0.1, y: 0.99, z: pz - sn * 0.1, ry }));
      for (const w2 of [0.07, -0.07]) B.add('dark', ball(0.04, px + c * 0.16 + sn * w2, 1.15, pz - sn * 0.16 + c * w2, 1, 1, 1, 6));
    }
  }
}

// Sockel med staty: 'figure' (stående gestalt), 'bust' (byst), 'urn'
export function addStatue(B, world, RAPIER, body, { x, z, y = 0, ry = 0, kind = 'figure' }) {
  const ph = kind === 'figure' ? 0.9 : 1.15;
  if (world) boxCol(world, RAPIER, body, 0.45, (ph + (kind === 'figure' ? 1.8 : 0.6)) / 2, 0.45, x, y + (ph + (kind === 'figure' ? 1.8 : 0.6)) / 2, z, ry);
  if (!B) return;
  B.add('dark', box(0.85, ph, 0.85, x, y + ph / 2, z, ry));
  B.add('marble', box(0.95, 0.08, 0.95, x, y + ph + 0.04, z, ry), [0.9, 0.88, 0.85]);
  B.add('brass', place(new THREE.BoxGeometry(0.35, 0.12, 0.02), { x: x + Math.sin(ry) * 0.43, y: y + ph * 0.7, z: z + Math.cos(ry) * 0.43, ry }));
  const b = y + ph + 0.08;
  if (kind === 'figure') {
    const c = Math.cos(ry), sn = Math.sin(ry);
    const P = (u, w) => [x + u * sn + w * c, z + u * c - w * sn];
    for (const [w, du] of [[0.1, 0.06], [-0.1, -0.05]]) {
      const [lx, lz] = P(du, w);
      B.add('marble', rod([lx, b, lz], [P(0, w * 0.8)[0], b + 0.85, P(0, w * 0.8)[1]], 0.07, 0.09, 8));
    }
    B.add('marble', place(lathe([[0.15, 0], [0.19, 0.15], [0.17, 0.45], [0.22, 0.65], [0.08, 0.75], [0, 0.75]], 12), { x, y: b + 0.82, z }));
    B.add('marble', ball(0.11, x, b + 1.7, z, 1, 1.15, 1, 12));
    const [ax, az] = P(0.05, 0.22), [hx, hz] = P(0.25, 0.3);
    B.add('marble', rod([ax, b + 1.45, az], [hx, b + 1.75, hz], 0.05, 0.04, 6));
    const [bx2, bz2] = P(0, -0.22), [cx, cz] = P(0.05, -0.27);
    B.add('marble', rod([bx2, b + 1.45, bz2], [cx, b + 1.0, cz], 0.05, 0.04, 6));
    B.add('marble', place(lathe([[0.2, 0], [0.24, 0.3], [0.2, 0.5], [0, 0.55]], 12), { x, y: b, z }), [0.95, 0.94, 0.9]);
  } else if (kind === 'bust') {
    B.add('marble', place(lathe([[0.12, 0], [0.12, 0.08], [0.06, 0.12], [0.25, 0.25], [0.24, 0.38], [0.08, 0.42], [0, 0.42]], 14), { x, y: b, z }));
    B.add('marble', ball(0.13, x, b + 0.56, z, 0.9, 1.15, 1, 14));
  } else {
    B.add('enamel', place(lathe([[0, 0], [0.15, 0], [0.12, 0.08], [0.25, 0.3], [0.2, 0.5], [0.12, 0.56], [0.15, 0.62], [0, 0.62]], 16), { x, y: b, z }), [0.15, 0.12, 0.1]);
  }
}

// Tavla i guldram med tavelbelysning. Väggens normal: (sin ry, cos ry)
export function addPainting(B, { x, z, ry, w = 2, h = 1.5, y = 2.2, art = 0 }) {
  if (!B) return;
  const nx = Math.sin(ry), nz = Math.cos(ry);
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv, u0 = (art % 4) / 4, v0 = art < 4 ? 0.5 : 0;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.25, v0 + uv.getY(i) * 0.5);
  B.add('art', place(g, { x: x + nx * 0.06, y: y + h / 2, z: z + nz * 0.06, ry }));
  const f = 0.12;
  for (const [bw, bh, ox, oy] of [[w + 2 * f, f, 0, (h + f) / 2], [w + 2 * f, f, 0, -(h + f) / 2], [f, h, (w + f) / 2, 0], [f, h, -(w + f) / 2, 0]]) {
    const c = Math.cos(ry), sn = Math.sin(ry);
    B.add('gold', place(new THREE.BoxGeometry(bw, bh, 0.1), { x: x + c * ox + nx * 0.06, y: y + h / 2 + oy, z: z - sn * ox + nz * 0.06, ry }));
  }
  // Tavellampa och ljuskägla på väggen
  B.add('brass', place(new THREE.BoxGeometry(w * 0.5, 0.06, 0.12), { x: x + nx * 0.28, y: y + h + 0.3, z: z + nz * 0.28, ry }));
  B.add('brass', rod([x + nx * 0.02, y + h + 0.36, z + nz * 0.02], [x + nx * 0.28, y + h + 0.32, z + nz * 0.28], 0.015, 0.015, 4));
  B.add('glow', place(new THREE.BoxGeometry(w * 0.48, 0.015, 0.06), { x: x + nx * 0.28, y: y + h + 0.265, z: z + nz * 0.28, ry }), [2.2, 1.9, 1.4]);
  const wash = new THREE.PlaneGeometry(w * 1.5, h * 1.6);
  B.add('pool', place(wash, { x: x + nx * 0.075, y: y + h * 0.65, z: z + nz * 0.075, ry }), [0.55, 0.45, 0.32]);
}

export function addExitSign(B, { x, y = 5.7, z, ry }) {
  if (!B) return;
  const nx = Math.sin(ry), nz = Math.cos(ry);
  B.add('exit', place(new THREE.PlaneGeometry(0.9, 0.45), { x: x + nx * 0.06, y, z: z + nz * 0.06, ry }));
  B.add('paint', place(new THREE.BoxGeometry(0.96, 0.5, 0.1), { x, y, z, ry }), [0.85, 0.87, 0.85]);
  B.add('pool', place(new THREE.PlaneGeometry(2.6, 1.6), { x: x + nx * 0.02, y: y - 0.1, z: z + nz * 0.02, ry }), [0.05, 0.35, 0.12]);
}

// Hänglampa med ljuskägla och ljusfläck på golvet
export function addLamp(B, { x, z, y = 6, H = 9, col = [1, 0.85, 0.6], r = 2.6, floor = 0, cone = true, shade = 'brass' }) {
  if (!B) return;
  B.add('steel', rod([x, y + 0.45, z], [x, H, z], 0.012, 0.012, 4), [0.3, 0.3, 0.3]);
  B.add(shade, place(lathe([[0.05, 0.45], [0.12, 0.42], [0.35, 0.08], [0.38, 0]], 14), { x, y, z }));
  B.add('glow', place(new THREE.CircleGeometry(0.34, 14), { x, y: y + 0.01, z, rx: Math.PI / 2 }), [col[0] * 2.2, col[1] * 2.2, col[2] * 2.2]);
  if (cone) {
    const c = new THREE.CylinderGeometry(0.34, r * 0.8, y - floor, 18, 1, true);
    B.add('beam', place(c, { x, y: floor + (y - floor) / 2, z }), [col[0] * 0.07, col[1] * 0.07, col[2] * 0.07]);
  }
  B.add('pool', poolQuad(x, z, r, floor + 0.015), [col[0] * 0.38, col[1] * 0.38, col[2] * 0.38]);
}

// Spotljus mot ett föremål (bara kägla och fläck, ingen synlig armatur)
export function addSpot(B, { x, z, y = 8.8, r = 3, col = [1, 0.9, 0.7], k = 0.5, floor = 0 }) {
  if (!B) return;
  const c = new THREE.CylinderGeometry(0.2, r * 0.9, y - floor, 18, 1, true);
  B.add('beam', place(c, { x, y: floor + (y - floor) / 2, z }), [col[0] * 0.05, col[1] * 0.05, col[2] * 0.05]);
  B.add('pool', poolQuad(x, z, r, floor + 0.018), [col[0] * k, col[1] * k, col[2] * k]);
  B.add('steel', cyl(0.12, 0.16, 0.3, x, y - 0.3, z, 8), [0.2, 0.2, 0.22]);
}

// Höga fönster med månljus
export function addWindow(B, { x, z, ry, w = 2.4, h = 4.6, y = 2.6 }) {
  if (!B) return;
  const nx = Math.sin(ry), nz = Math.cos(ry);
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, h - w / 2); sh.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); sh.lineTo(-w / 2, 0);
  B.add('glow', place(new THREE.ShapeGeometry(sh, 12), { x: x + nx * 0.03, y, z: z + nz * 0.03, ry }), [0.14, 0.2, 0.42]);
  const c = Math.cos(ry), sn = Math.sin(ry);
  for (const u of [-w / 6, w / 6]) B.add('rubber', place(new THREE.BoxGeometry(0.05, h - 0.2, 0.05), { x: x + c * u + nx * 0.05, y: y + (h - 0.2) / 2, z: z - sn * u + nz * 0.05, ry }));
  for (let v = 0.9; v < h - 0.5; v += 0.9) B.add('rubber', place(new THREE.BoxGeometry(w, 0.05, 0.05), { x: x + nx * 0.05, y: y + v, z: z + nz * 0.05, ry }));
  B.add('marble', place(new THREE.BoxGeometry(w + 0.4, 0.15, 0.3), { x: x + nx * 0.1, y: y - 0.07, z: z + nz * 0.1, ry }));
  // Månljus på golvet framför
  B.add('pool', poolQuad(x + nx * 3, z + nz * 3, 1.8, 0.012), [0.07, 0.1, 0.2]);
}

// Lös skylt "Akta, vått golv" att putta omkull
export function addWetSign(scene, world, RAPIER, { x, z, ry = 0 }) {
  const h = 0.62, spawn = { x, y: h / 2 + 0.01, z };
  let body = null, mesh = null;
  if (world) {
    body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y, spawn.z).setRotation(yQuat(ry)).setLinearDamping(0.2).setAngularDamping(0.5));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.15, h / 2, 0.2).setDensity(0).setMass(0.12).setFriction(0.5).setRestitution(0.2).setCollisionGroups(groups(G.PROP)), body);
  }
  if (scene) {
    const tex = cached('wetTex', () => {
      const [c, ctx] = canvas(64, 128);
      ctx.fillStyle = '#f2c814'; ctx.fillRect(0, 0, 64, 128);
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(32, 16); ctx.lineTo(56, 58); ctx.lineTo(8, 58); ctx.fill();
      ctx.fillStyle = '#f2c814'; ctx.beginPath(); ctx.moveTo(32, 26); ctx.lineTo(48, 53); ctx.lineTo(16, 53); ctx.fill();
      ctx.fillStyle = '#111'; ctx.fillRect(30, 33, 4, 12); ctx.fillRect(30, 47, 4, 4);
      ctx.font = 'bold 11px sans-serif'; ctx.fillText('VÅTT', 18, 82); ctx.fillText('GOLV', 17, 96);
      return toTex(c, { repeat: false });
    });
    const mat = cached('wetMat', () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, envMap: nightEnv() }));
    const geos = [];
    for (const s of [1, -1]) {
      const g = new THREE.BoxGeometry(0.28, h, 0.015);
      g.rotateX(s * 0.28);
      g.translate(0, 0, s * 0.085);
      geos.push(g);
    }
    mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.position.set(spawn.x, spawn.y, spawn.z);
    mesh.rotation.y = ry;
    mesh.castShadow = true;
    scene.add(mesh);
  }
  return { body, mesh, kind: 'sign', spawn };
}

// Golvbitar som samlats (galleriets ovansida) läggs i stora salens marmor
export function flushFloorTiles(scene, B) {
  if (!B || !B.floorTiles?.length) return;
  const m = new THREE.Mesh(mergeGeometries(B.floorTiles), FLOOR_MAT.hall());
  m.receiveShadow = true;
  scene.add(m);
  B.floorTiles = [];
}

// ===========================================================================
// Hela museet
// ===========================================================================

export function buildMuseum({ scene, world, RAPIER, track, M, jumpX, jumpZ, crater = null, stairs = null }) {
  const B = scene ? new Batch() : null;
  const body = world ? fixed(world, RAPIER) : null;
  const h = M.half, H = M.H, Y = M.deckY;
  const { pts, N } = track;
  const clearance = track.roadHalf + track.barrier.thick;
  const roadDist = (x, z) => Math.sqrt(track.nearest(x, z).d2);
  const offRoad = (x, z, rad = 0.5) => roadDist(x, z) > clearance + rad + 0.3;

  makeFloors(scene, world, RAPIER, M);

  // Dörröppningar där banan går genom mellanväggarna
  const doors = [];
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    if ((a.z - M.splitZ) * (b.z - M.splitZ) <= 0 && a.z !== b.z) doors.push({ axis: 'z', from: a.x - 4.5, to: a.x + 4.5 });
    if ((a.x - M.splitX) * (b.x - M.splitX) <= 0 && a.x !== b.x && a.z < M.splitZ) doors.push({ axis: 'x', from: a.z - 4.5, to: a.z + 4.5 });
  }
  addShell(B, world, RAPIER, M, doors);
  for (const d of doors) {
    const mid = (d.from + d.to) / 2;
    if (d.axis === 'z') { addExitSign(B, { x: mid, y: 5.95, z: M.splitZ + 0.3, ry: 0 }); addExitSign(B, { x: mid, y: 5.95, z: M.splitZ - 0.3, ry: Math.PI }); }
    else { addExitSign(B, { x: M.splitX + 0.3, y: 5.95, z: mid, ry: Math.PI / 2 }); addExitSign(B, { x: M.splitX - 0.3, y: 5.95, z: mid, ry: -Math.PI / 2 }); }
  }

  // --- banan: rulltrappor, rep och golvskinn -----------------------------
  const escRanges = [];
  {
    // Ramper upp/ner till galleriet: där höjden ändras utanför hoppet
    let start = -1;
    const onStairs = (i) => stairs && pts[i].x > stairs.x0 - 2 && pts[i].x < stairs.x1 + 2 && Math.abs(pts[i].z - stairs.z) < 3;
    const isRamp = (i) => pts[i].y > 0.01 && pts[i].y < Y - 0.01 && pts[i].z > M.splitZ && !onStairs(i);
    for (let i = 0; i <= N; i++) {
      const r = i < N && isRamp(i);
      if (r && start < 0) start = i;
      if (!r && start >= 0) { escRanges.push([Math.max(0, start - 2), Math.min(N - 1, i + 1)]); start = -1; }
    }
  }
  const inEsc = (i) => escRanges.some(([a, b]) => i >= a && i <= b);
  const nearGap = (i) => { for (let k = -14; k <= 14; k++) if (track.isGap[(i + k + N) % N]) return true; return false; };
  if (scene) {
    addRoadSkin(scene, track, M, inEsc);
    for (const [a, b] of escRanges) addEscalator(B, track, a, b);
    addRopes(B, track, (i) => inEsc(i) || nearGap(i) || (i > 0 && i < 4));
  }

  // --- genvägen genom gravkammaren ------------------------------------------
  for (const sc of track.shortcuts || []) {
    const path = sc.path;
    if (scene) {
      addRoadSkin(scene, path, M, () => false);
      addRopes(B, path, (i) => i >= path.N - 3 || path.isGap[i] || path.isGap[Math.min(path.N - 1, i + 6)]);
    }
    // Tunneln där genvägen ligger långt från huvudbanan (pylonerna får inte
    // nå ut på den) och före svängen mot påfarten
    const L = path.length;
    const mainDist = (i) => Math.sqrt(track.nearest(path.pts[i].x, path.pts[i].z).d2);
    let i0 = -1, i1 = -1;
    for (let i = 0; i < path.N - 1 && path.dist[i] < L * 0.7; i++) {
      if (i0 < 0 && mainDist(i) > 5.6) i0 = i;
      if (i0 >= 0 && mainDist(i) > 7.2) i1 = i;
    }
    if (i0 >= 0 && i1 > i0) addTomb(B, world, RAPIER, body, path, { i0, i1, pylonsAt: [mainDist(i0) > 7.2, true] });
  }
  if (crater) addCrater(B, crater);

  // --- galleriet (upphöjt däck i sydvästra hörnet) ---------------------------
  // Östra armen går söderut längs banan till trappavsatsen över stora trappan
  const deckN = 14.5, deckE = -14.15;
  if (stairs) {
    // Trappans linje tas ur banan: från glappets början (kanten) till där
    // landningsrampen når golvet, så att stegnosarna ligger exakt under vägen
    let g = -1;
    for (let i = 0; i < N && g < 0; i++) if (track.isGap[i] && !track.isGap[(i - 1 + N) % N] && Math.abs(pts[i].z - stairs.z) < 1 && pts[i].y > Y - 0.05) g = i;
    let e = g;
    while (pts[e % N].y > 0.002) e++;
    stairs = { ...stairs, x0: pts[g].x, x1: pts[e % N].x };
    if (world) addUnderlay(world, RAPIER, track, g - 1, e % N, (stairs.z1 - stairs.z0) / 2);
  }
  const sx0 = stairs ? stairs.x0 : -8, sz0 = stairs ? stairs.z0 : 5, sz1 = stairs ? stairs.z1 : 15;
  addDeck(B, world, RAPIER, body, {
    y: Y,
    rects: [[-h, deckN, deckE, h], [deckE, 28.6, -8, h], [deckE, sz0, -8, 28.6], [-8, sz0, sx0, sz1]],
    balustrades: [
      [-h + 0.3, deckN + 0.15, -34.15, deckN + 0.15], [-29.85, deckN + 0.15, deckE - 0.15, deckN + 0.15],
      [deckE - 0.15, sz0 - 0.15, deckE - 0.15, deckN], [deckE, sz0 - 0.15, sx0 - 0.2, sz0 - 0.15],
      [-8 + 0.15, sz1 + 0.15, sx0 - 0.2, sz1 + 0.15], [-8 + 0.15, sz1 + 0.15, -8 + 0.15, h - 0.3],
    ],
  });
  if (stairs) addGrandStairs(B, world, RAPIER, body, { ...stairs, y: Y });
  if (B) {
    // Galleriets innanmäte: statyer, montrar och bänkar
    for (const [x, z, kind, ry] of [[-26, 18.5, 'figure', 0], [-18, 18.5, 'figure', 0], [-22, 27, 'urn', Math.PI], [-26, 23, 'bust', Math.PI / 2], [-18, 23, 'bust', -Math.PI / 2]]) addStatue(B, world, RAPIER, body, { x, z, y: Y, ry, kind });
    addBench(B, world, RAPIER, body, { x: -22, z: 22.5, y: Y, ry: 0 });
    for (const [x, z] of [[-39.5, 22], [-39.5, 30], [-36, 39.5]]) addStatue(B, world, RAPIER, body, { x, z, y: Y, ry: x < -39 ? Math.PI / 2 : Math.PI, kind: 'bust' });
    for (const [z, art] of [[18, 4], [26, 6], [34, 1]]) addPainting(B, { x: -h + 0.05, z, ry: Math.PI / 2, w: 2.6, h: 2.0, y: Y + 1.6, art });
    for (const [x, art] of [[-26, 3], [-18, 5]]) addPainting(B, { x, z: h - 0.05, ry: Math.PI, w: 2.6, h: 2.0, y: Y + 1.6, art });
    addLamp(B, { x: -22, z: 22.5, y: 6.5, floor: Y, r: 3.2 });
    for (const [x, z] of [[-32, 24], [-24, 33], [-12, 34], [-32, 8]]) addLamp(B, { x, z, y: 6.6, floor: x === -32 && z === 8 ? 0.6 : Y, r: 2.4, cone: false });
    // Skylt på galleriets front
    addPainting(B, { x: -22, z: deckN - 0.02, ry: Math.PI, w: 3.4, h: 0.45, y: 0.35, art: 0 });
  } else {
    for (const [x, z, kind] of [[-26, 18.5, 'figure'], [-18, 18.5, 'figure'], [-22, 27, 'urn'], [-26, 23, 'bust'], [-18, 23, 'bust']]) addStatue(null, world, RAPIER, body, { x, z, y: Y, kind });
    addBench(null, world, RAPIER, body, { x: -22, z: 22.5, y: Y });
  }

  // --- stora salen ----------------------------------------------------------
  // Pelarrader längs startrakan och vid valven
  for (const x of [-2, 6, 14, 22]) for (const z of [4.3, 15.7]) addColumn(B, world, RAPIER, body, { x, z, h: H });
  for (const z of [16, 24, 32]) addColumn(B, world, RAPIER, body, { x: 36.5, z, h: H });
  addDinosaur(B, world, RAPIER, body, { x: 11.5, z: 27.5, rot: Math.PI, s: 1 });
  for (const [x, z, ry] of [[1, 31.5, Math.PI / 2], [22, 31.5, -Math.PI / 2]]) addBench(B, world, RAPIER, body, { x, z, ry });
  for (const x of [10, 18]) addBench(B, world, RAPIER, body, { x, z: 1.2, ry: Math.PI });
  // Biljettkiosken med sammetsrepskö vid starten
  addTicketBooth(B, world, RAPIER, body, {
    x: -5.2, z: 1.3, ry: 0,
    queue: [[[-3.3, 2.2], [-0.9, 2.2], [1.5, 2.2], [3.9, 2.2]], [[-1.1, 3.25], [1.3, 3.25], [3.9, 3.25]], [[3.9, 2.2], [3.9, 3.25]]],
  });
  // Tavlor på mellanväggens södra sida och längs östra/södra väggen
  let art = 0;
  for (const x of [-21, -14, -8, 0, 8, 16]) addPainting(B, { x, z: M.splitZ + 0.26, ry: 0, w: 2.4, h: 1.8, y: 2.0, art: art++ % 8 });
  for (const z of [5, 12, 20, 28, 36]) addPainting(B, { x: h - 0.02, z, ry: -Math.PI / 2, w: 2.2, h: 1.7, y: 2.1, art: art++ % 8 });
  for (const x of [-2, 26, 34]) addPainting(B, { x, z: h - 0.02, ry: Math.PI, w: 2.6, h: 2.0, y: 2.0, art: art++ % 8 });
  for (const [x, z] of [[5, 40.5], [17, 40.5]]) addWindow(B, { x, z: h - 0.02, ry: Math.PI });
  addWindow(B, { x: h - 0.02, z: 40, ry: -Math.PI / 2 });
  // Montrar
  let seed = 1;
  for (const [x, z, ry, item] of [[39.8, 9, Math.PI / 2, 'gem'], [39.8, 20, Math.PI / 2, 'skull'], [39.8, 28, Math.PI / 2, 'gem'], [-3, 38.5, 0, 'skull'], [26, 39.5, 0, 'vase'], [-12, 0.5, 0, 'vase'], [26, 1, 0, 'gem'], [-20, 0.8, 0, 'rock']]) {
    if (offRoad(x, z, 1)) addCase(B, world, RAPIER, body, { x, z, ry, item, seed: seed++ });
  }
  for (const [x, z, kind] of [[2, 37.5, 'figure'], [21, 37.5, 'figure'], [30, 37, 'bust'], [-6, 8.4, 'urn'], [26, -0.5, 'bust']]) {
    if (offRoad(x, z, 0.8)) addStatue(B, world, RAPIER, body, { x, z, kind, ry: Math.PI });
  }
  // Rep runt dinosaurien
  if (B) {
    const rp = [];
    const PW = 8.2, PD = 3.4;
    for (const [u, w] of [[-PW, -PD], [PW, -PD], [PW, PD], [-PW, PD], [-PW, -PD]]) rp.push([11.5 + u, 27.5 + w]);
    for (let k = 0; k < 4; k++) {
      const [ax, az] = rp[k], [bx, bz] = rp[k + 1];
      const n = Math.round(Math.hypot(bx - ax, bz - az) / 2.2);
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const x = ax + (bx - ax) * (i / n), z = az + (bz - az) * (i / n);
        B.add('brass', cyl(0.12, 0.14, 0.04, x, 0, z, 10));
        B.add('brass', cyl(0.03, 0.035, 0.95, x, 0, z, 6));
        B.add('brass', ball(0.06, x, 0.99, z, 1, 1, 1, 8));
        if (prev) B.add('velvet', tube([prev, [(prev[0] + x) / 2, 0.68, (prev[2] + z) / 2], [x, 0.88, z]], 0.03, 6, 5));
        prev = [x, 0.88, z];
      }
    }
  }
  // Lampor: längs banan i stora salen och spotljus på dinosaurien
  if (B) {
    for (const x of [-6, 2, 10, 18, 26]) addLamp(B, { x, z: 10, y: 6.2 });
    for (const z of [3, 22, 30]) addLamp(B, { x: 30, z, y: 6.2, cone: z !== 3 });
    addLamp(B, { x: -12, z: 12, y: 6.4, floor: Y });
    for (const [x, z] of [[7, 27.5], [16, 27.5]]) addSpot(B, { x, z, r: 4.4, col: [1, 0.9, 0.75], k: 0.6, floor: 0.56 });
    for (const [x, z] of [[-14, 3], [8, 3], [36, 36], [36, 14], [0, 38], [24, 38]]) addLamp(B, { x, z, y: 6.6, cone: false, r: 2.2, col: [1, 0.8, 0.55] });
  }

  // --- Egyptensalen -----------------------------------------------------------
  // Två pelare har rasat (genvägen och gravkammaren står där de stod)
  for (let z = -6; z > -28; z -= 7) for (const x of [25.6, 34.4]) if (!(x < 30 && (z === -13 || z === -20))) addColumn(B, world, RAPIER, body, { x, z, h: H, r: 0.5, kind: 'lotus' });
  addFallenColumn(B, world, RAPIER, body, { x: 27.2, z: -21, ry: -1.35 });
  // Sandstensblock där banan saknar vallar (genvägens av- och påfart)
  addBlocks(B, world, RAPIER, body, [
    { x: 32.6, z: 3.2, w: 0.9, h: 0.55, d: 2.6 }, { x: 32.7, z: 0.0, w: 1.0, h: 0.7, d: 2.4, ry: 0.04 },
    { x: 32.6, z: -3.2, w: 0.9, h: 0.5, d: 2.6 }, { x: 32.7, z: -8.0, w: 1.0, h: 0.65, d: 2.8, ry: -0.03 },
    { x: 32.6, z: -11.2, w: 0.9, h: 0.55, d: 2.4 }, { x: 32.7, z: -15.0, w: 1.0, h: 0.6, d: 2.2 },
    { x: 14.4, z: -34.4, w: 2.4, h: 0.6, d: 0.9 }, { x: 11.4, z: -34.5, w: 2.6, h: 0.75, d: 1.0, ry: 0.03 },
    { x: 8.4, z: -34.4, w: 2.4, h: 0.55, d: 0.9 }, { x: 5.4, z: -34.5, w: 2.6, h: 0.7, d: 1.0, ry: -0.04 },
    { x: 2.8, z: -34.4, w: 1.8, h: 0.5, d: 0.9 },
  ]);
  addSarcophagus(B, world, RAPIER, body, { x: 14, z: -16, rot: 0.15 });
  addObelisk(B, world, RAPIER, body, { x: 25.6, z: -27.6, h: 7.6 });
  addObelisk(B, world, RAPIER, body, { x: 21, z: -8.5, h: 7.6 });
  addPyramid(B, world, RAPIER, body, { x: 6, z: -9, size: 4.4 });
  addBlocks(B, world, RAPIER, body, [
    { x: 5, z: -21, w: 1.8, h: 0.9, d: 1.2, ry: 0.3 }, { x: 5.4, z: -21.2, y: 0.9, w: 1.2, h: 0.7, d: 1.0, ry: 0.5 },
    { x: 7.5, z: -24, w: 1.4, h: 1.0, d: 1.4, ry: -0.2 }, { x: 3, z: -24.5, w: 1.0, h: 0.8, d: 2.0, ry: 0.1 },
    { x: 9.5, z: -25.6, w: 1.1, h: 0.55, drum: true }, { x: 38.6, z: -12, w: 1.6, h: 1.0, d: 1.2 }, { x: 38.8, z: -20, w: 1.2, h: 0.7, d: 1.6, ry: 0.4 },
    { x: 11, z: -5, w: 1.1, h: 0.5, drum: true },
  ].filter((b) => offRoad(b.x, b.z, 1)));
  addPharaoh(B, world, RAPIER, body, { x: 3.2, z: -38.6, ry: Math.PI / 2, s: 1 });
  addPharaoh(B, world, RAPIER, body, { x: 3.2, z: -25.4, ry: Math.PI / 2, s: 1 });
  if (B) {
    for (const [x, panel] of [[10, 0], [16, 1], [22, 0], [28, 1], [36, 0]]) addHieroPanel(B, { x, z: -h + 0.05, ry: 0, panel, w: 3.2, h: 3.2, y: 1.6 });
    for (const [z, panel] of [[-8, 1], [-16, 0], [-24, 1], [-32, 0]]) addHieroPanel(B, { x: h - 0.05, z, ry: -Math.PI / 2, panel, w: 3.2, h: 3.2, y: 1.6 });
    for (const [z, panel] of [[-10, 0], [-18, 1]]) addHieroPanel(B, { x: M.splitX + 0.3, z, ry: Math.PI / 2, panel, w: 3.6, h: 3.6, y: 1.4 });
    for (const x of [8, 16]) addHieroPanel(B, { x, z: M.splitZ - 0.3, ry: Math.PI, panel: x === 8 ? 1 : 0, w: 3.6, h: 3.4, y: 1.4 });
  }
  for (const [x, z, ry, item] of [[39.8, -26, Math.PI / 2, 'jar'], [39.8, -5, Math.PI / 2, 'jar'], [14, -38.5, 0, 'vase'], [26, -39, 0, 'jar']]) {
    if (offRoad(x, z, 1)) addCase(B, world, RAPIER, body, { x, z, ry, item, seed: seed++ });
  }
  if (B) {
    for (const z of [-4, -12, -20, -28]) addLamp(B, { x: 30, z, y: 6.0, col: [1, 0.72, 0.4] });
    for (const x of [22, 14, 6]) addLamp(B, { x, z: -32, y: 6.0, col: [1, 0.72, 0.4] });
    addSpot(B, { x: 14, z: -16, r: 3.4, col: [1, 0.8, 0.5], k: 0.55, floor: 0.8 });
    addSpot(B, { x: 6, z: -9, r: 3.6, col: [1, 0.8, 0.5], k: 0.4, floor: 0.6 });
    for (const [x, z] of [[25.6, -27.6], [21, -8.5]]) addSpot(B, { x, z, r: 1.6, col: [1, 0.75, 0.45], k: 0.6, floor: 0.5 });
  }

  // --- rymdsalen --------------------------------------------------------------
  addRocket(B, world, RAPIER, body, { x: -7, z: -11, h: 8.4 });
  addLander(B, world, RAPIER, body, { x: -24, z: -9 });
  if (B) {
    addPlanet(B, { x: -18, y: 5.2, z: -19, r: 2.6, H });
    addMoon(B, { x: -10, y: 6.4, z: -22, r: 0.6, col: [0.7, 0.68, 0.66], H });
    addMoon(B, { x: -25, y: 6.8, z: -15, r: 0.9, col: [0.75, 0.35, 0.22], H });
    addMoon(B, { x: -14, y: 7.2, z: -6, r: 0.45, col: [0.35, 0.55, 0.95], H });
    addMoon(B, { x: -20, y: 6.0, z: -37, r: 0.7, col: [0.85, 0.75, 0.55], H });
    addMoon(B, { x: -38, y: 6.2, z: -20, r: 0.55, col: [0.5, 0.75, 0.8], H });
    addBlackHole(B, { x: jumpX, z: jumpZ });
    addLasers(B, [[-h + 0.05, -h + 0.05, M.splitX - 0.3, -h + 0.05], [-h + 0.05, M.splitZ - 0.3, -h + 0.05, -h + 0.05], [M.splitX - 0.3, -h + 0.05, M.splitX - 0.3, -36.6], [M.splitX - 0.3, -27.4, M.splitX - 0.3, M.splitZ - 0.3], [-36.6, M.splitZ - 0.3, -h + 0.05, M.splitZ - 0.3], [M.splitX - 0.3, M.splitZ - 0.3, -27.4, M.splitZ - 0.3]].map(([x0, z0, x1, z1]) => [x0, z0, x1, z1]), H);
    for (const x of [-4, -16, -24]) addLamp(B, { x, z: -32, y: 6.2, col: [0.65, 0.45, 1.0], shade: 'steel' });
    for (const z of [-24, -14, -6]) addLamp(B, { x: -32, z, y: 6.2, col: [0.65, 0.45, 1.0], shade: 'steel' });
    addSpot(B, { x: -7, z: -11, r: 2.8, col: [0.75, 0.8, 1.0], k: 0.5, floor: 0.5 });
    addSpot(B, { x: -18, z: -19, r: 3.5, col: [0.9, 0.7, 1.0], k: 0.35 });
    addSpot(B, { x: -24, z: -9, r: 2.6, col: [1, 0.85, 0.6], k: 0.45, floor: 0.4 });
  }
  for (const [x, z, ry, item] of [[-12, -39.6, 0, 'rock'], [-26, -39.6, 0, 'gem'], [-39.6, -26, Math.PI / 2, 'rock'], [-39.6, -12, Math.PI / 2, 'gem'], [-14, -4, Math.PI, 'rock']]) {
    if (offRoad(x, z, 1)) addCase(B, world, RAPIER, body, { x, z, ry, item, seed: seed++ });
  }

  if (scene) {
    B.flush(scene);
    flushFloorTiles(scene, B);
  }

  // Lösa skyltar "vått golv" i kurvornas ytterkant
  const loose = [];
  for (const [cp, s] of [[2, 1], [6, 1], [10, -1], [15, -1]]) {
    const c = track.checkpoints[cp];
    if (!c || pts[c.index].y > 0.02 || nearGap(c.index) || nearGap((c.index + 14) % N)) continue;
    const pose = track.poseAt(c.index, s * (track.roadHalf + 0.6));
    loose.push(addWetSign(scene, world, RAPIER, { x: pose.x, z: pose.z, ry: pose.heading }));
  }
  return loose.filter((p) => p && p.body);
}

// ===========================================================================
// Gravkammaren: en lång tunnel av sandsten längs genvägen (index i0..i1) med
// hieroglyfer och facklor inuti och pyloner med bevingad soldisk vid gavlarna.
// ===========================================================================

export function addTomb(B, world, RAPIER, body, path, { i0, i1, h = 2.7, pylonsAt = [true, true] }) {
  const { pts, normals, tangents, roadHalf } = path;
  const wallT = 0.5;
  const off = roadHalf + path.barrier.thick + 0.25 + wallT / 2;
  const P = (i, o, y = 0) => [pts[i].x + normals[i].x * o, y, pts[i].z + normals[i].z * o];
  const ang = (i) => Math.atan2(tangents[i].x, tangents[i].z);
  const step = 2;
  const segs = [];
  for (let i = i0; i < i1; i += step) segs.push([i, Math.min(i1, i + step)]);
  const seg = (a, c, o) => {
    const A = P(a, o), Cc = P(c, o);
    return { x: (A[0] + Cc[0]) / 2, z: (A[2] + Cc[2]) / 2, len: Math.hypot(Cc[0] - A[0], Cc[2] - A[2]) + 0.06, ry: Math.atan2(Cc[0] - A[0], Cc[2] - A[2]) };
  };
  // Pylonerna vid gavlarna: utanför väggarna, en på varje sida
  const pyl = [];
  for (const i of [i0, i1].filter((_, k) => pylonsAt[k])) for (const sd of [1, -1]) {
    const p = P(i, sd * (off + 1.0));
    pyl.push({ x: p[0], z: p[2], ry: ang(i), i });
  }
  if (world) {
    for (const [a, c] of segs) for (const sd of [1, -1]) {
      const s = seg(a, c, sd * off);
      boxCol(world, RAPIER, body, wallT / 2, h / 2, s.len / 2, s.x, h / 2, s.z, s.ry);
    }
    for (const q of pyl) boxCol(world, RAPIER, body, 1.1, 2.2, 0.9, q.x, 2.2, q.z, q.ry);
  }
  if (!B) return;
  const sand = [0.96, 0.86, 0.7], sandDark = [0.8, 0.68, 0.52];
  for (const [a, c] of segs) {
    for (const sd of [1, -1]) {
      const s = seg(a, c, sd * off);
      B.add('stone', box(wallT, h, s.len, s.x, h / 2, s.z, s.ry, 1.6), sand);
      // Sockel och blå-guld bård upptill på insidan
      const si = seg(a, c, sd * (off - wallT / 2 - 0.02));
      B.add('enamel', box(0.03, 0.14, s.len, si.x, h - 0.35, si.z, si.ry), [0.18, 0.34, 0.7]);
      B.add('gold', box(0.035, 0.05, s.len, si.x, h - 0.25, si.z, si.ry));
      B.add('dark', box(0.04, 0.22, s.len, si.x, 0.11, si.z, si.ry), [0.5, 0.36, 0.24]);
    }
    // Takplatta
    const m = Math.round((a + c) / 2);
    const len = Math.hypot(pts[c].x - pts[a].x, pts[c].z - pts[a].z) + 0.08;
    B.add('stone', box(2 * off + wallT + 0.3, 0.42, len, pts[m].x, h + 0.21, pts[m].z, ang(m), 1.6), sandDark);
  }
  // Hieroglyftavlor på insidan, facklor emellan med varma ljusfläckar
  for (let i = i0 + 3, k = 0; i < i1 - 2; i += 5, k++) {
    for (const sd of [1, -1]) {
      const p = P(i, sd * (off - wallT / 2 - 0.03));
      const g = new THREE.PlaneGeometry(1.7, 1.5);
      const uv = g.attributes.uv;
      for (let q = 0; q < uv.count; q++) uv.setX(q, ((k + (sd > 0 ? 0 : 1)) % 2) * 0.5 + uv.getX(q) * 0.5);
      B.add('hiero', place(g, { x: p[0], y: 1.25, z: p[2], ry: ang(i) + (sd > 0 ? -Math.PI / 2 : Math.PI / 2) }));
    }
  }
  for (let i = i0 + 1; i < i1; i += 5) {
    for (const sd of [1, -1]) {
      const p = P(i, sd * (off - wallT / 2 - 0.12));
      B.add('dark', cyl(0.05, 0.035, 0.32, p[0], 1.55, p[2], 6), [0.35, 0.25, 0.15]);
      B.add('glow', place(new THREE.ConeGeometry(0.08, 0.22, 8), { x: p[0], y: 1.98, z: p[2] }), [2.2, 1.0, 0.3]);
      const f = P(i, sd * (off - 1.0));
      B.add('pool', poolQuad(f[0], f[2], 1.3, 0.03), [0.9, 0.5, 0.18]);
    }
  }
  // Pyloner: avsmalnande torn i sandsten med bård
  for (const q of pyl) {
    const g = flat(new THREE.CylinderGeometry(0.71, 1, 4.4, 4, 1).rotateY(Math.PI / 4));
    g.scale(1.55, 1, 1.25);
    B.add('stone', place(g, { x: q.x, y: 2.2, z: q.z, ry: q.ry + Math.PI / 2 }), sand);
    B.add('enamel', place(new THREE.BoxGeometry(1.75, 0.16, 1.45), { x: q.x, y: 4.2, z: q.z, ry: q.ry + Math.PI / 2 }), [0.18, 0.34, 0.7]);
  }
  // Överstycke med bevingad soldisk över ingångarna
  for (const i of [i0, i1]) {
    const p = P(i, 0), ry = ang(i);
    const w = 2 * (off + (pylonsAt[i === i0 ? 0 : 1] ? 0.9 : 0.25));
    B.add('stone', place(new THREE.BoxGeometry(w, 0.7, 0.9), { x: p[0], y: h + 0.6, z: p[2], ry }), sand);
    const sd = i === i0 ? -1 : 1;
    const fx = p[0] + tangents[i].x * 0.47 * sd, fz = p[2] + tangents[i].z * 0.47 * sd;
    B.add('gold', place(new THREE.CircleGeometry(0.26, 20), { x: fx, y: h + 0.6, z: fz, ry: ry + (sd > 0 ? 0 : Math.PI) }));
    for (const wsd of [1, -1]) {
      const wing = new THREE.PlaneGeometry(1.1, 0.22);
      B.add('enamel', place(wing, { x: fx + Math.cos(ry) * wsd * 0.85, y: h + 0.62, z: fz - Math.sin(ry) * wsd * 0.85, ry: ry + (sd > 0 ? 0 : Math.PI) }), [0.18, 0.34, 0.7]);
    }
  }
}

// ===========================================================================
// Biljettkiosken vid starten med sammetsrepskö
// ===========================================================================

export function addTicketBooth(B, world, RAPIER, body, { x, z, ry = 0, queue = [] }) {
  if (world) boxCol(world, RAPIER, body, 1.7, 1.4, 0.95, x, 1.4, z, ry);
  if (!B) return;
  const c = Math.cos(ry), sn = Math.sin(ry);
  const L = (u, w) => [x + u * c + w * sn, z - u * sn + w * c]; // u åt sidan, w framåt
  B.add('wood', box(3.2, 1.1, 1.7, x, 0.55, z, ry), [0.55, 0.32, 0.2]);
  B.add('brass', box(3.26, 0.06, 1.76, x, 1.12, z, ry));
  // Disk framtill och glasruta med mässingsram
  const [dx, dz] = L(0, 0.95);
  B.add('marble', box(3.0, 0.08, 0.35, dx, 1.16, dz, ry));
  const [gx, gz] = L(0, 0.8);
  B.add('glass', box(2.9, 1.1, 0.04, gx, 1.75, gz, ry));
  for (const u of [-1.5, -0.5, 0.5, 1.5]) { const [px, pz] = L(u, 0.8); B.add('brass', box(0.06, 1.15, 0.06, px, 1.75, pz, ry)); }
  // Bakvägg och sidor upp till taket
  const [bx, bz] = L(0, -0.75);
  B.add('wood', box(3.2, 1.2, 0.12, bx, 1.75, bz, ry), [0.5, 0.3, 0.18]);
  for (const u of [-1.55, 1.55]) { const [px, pz] = L(u, 0); B.add('wood', box(0.1, 1.2, 1.6, px, 1.75, pz, ry), [0.5, 0.3, 0.18]); }
  // Tak med utsprång och skylt
  B.add('marble', box(3.6, 0.18, 2.1, x, 2.42, z, ry));
  B.add('wood', box(3.4, 0.1, 1.9, x, 2.56, z, ry), [0.45, 0.26, 0.16]);
  const [sx, sz] = L(0, 0.86);
  const sign = new THREE.PlaneGeometry(3.0, 0.5);
  B.add('ticket', place(sign, { x: sx, y: 2.86, z: sz, ry }));
  const [kx, kz] = L(0, 0.81);
  B.add('wood', box(3.1, 0.6, 0.06, kx, 2.86, kz, ry), [0.3, 0.16, 0.1]);
  // Lampa i kiosken
  B.add('glow', ball(0.12, x, 2.25, z, 1, 1, 1, 10), [1.8, 1.4, 0.8]);
  B.add('pool', poolQuad(gx + sn * 1.2, gz + c * 1.2, 1.8, 0.02), [0.8, 0.55, 0.3]);
  // Kön: mässingsstolpar med sammetsrep i sicksack
  for (const line of queue) {
    let prev = null;
    for (const [px, pz] of line) {
      B.add('brass', cyl(0.12, 0.14, 0.04, px, 0, pz, 10));
      B.add('brass', cyl(0.03, 0.035, 0.95, px, 0, pz, 6));
      B.add('brass', ball(0.06, px, 0.99, pz, 1, 1, 1, 8));
      if (prev) B.add('velvet', tube([prev, [(prev[0] + px) / 2, 0.68, (prev[2] + pz) / 2], [px, 0.88, pz]], 0.03, 6, 5));
      prev = [px, 0.88, pz];
    }
  }
}

// Månkrater under hoppets glapp: mörk skål med kantvall och blått sken
export function addCrater(B, { x, z, r = 2.4 }) {
  if (!B) return;
  B.add('pool', poolQuad(x, z, r * 1.6, 0.02), [0.35, 0.45, 0.95]);
  B.add('glow', place(new THREE.CircleGeometry(r * 0.8, 36), { x, y: 0.012, z, rx: -Math.PI / 2 }), [0.02, 0.02, 0.05]);
  const rim = new THREE.TorusGeometry(r, 0.12, 6, 40);
  rim.rotateX(Math.PI / 2); rim.scale(1, 0.6, 1);
  B.add('dark', rim.translate(x, 0.03, z), [0.55, 0.55, 0.6]);
  const ring = new THREE.TorusGeometry(r * 0.82, 0.03, 5, 40);
  ring.rotateX(Math.PI / 2);
  B.add('glow', ring.translate(x, 0.03, z), [0.5, 0.8, 1.6]);
}

// Omkullfallen lotuspelare: liggande trummor och kapitäl (kolliderar)
export function addFallenColumn(B, world, RAPIER, body, { x, z, ry = 0, r = 0.5 }) {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const parts = [[-1.6, 1.0], [-0.4, 1.0], [0.85, 1.1]];
  if (world) boxCol(world, RAPIER, body, 2.6, r, r + 0.05, x, r, z, ry);
  if (!B) return;
  parts.forEach(([u, len], k) => {
    const g = new THREE.CylinderGeometry(r * 0.95, r, len, 16);
    g.rotateZ(Math.PI / 2);
    B.add('stone', place(g, { x: x + u * c, y: r, z: z - u * sn, ry: ry + k * 0.05 }), [0.95, 0.86, 0.72]);
    B.add('enamel', place(new THREE.TorusGeometry(r * 0.97, 0.04, 6, 18).rotateY(Math.PI / 2), { x: x + (u - len / 2 + 0.15) * c, y: r, z: z - (u - len / 2 + 0.15) * sn, ry }), k % 2 ? [0.75, 0.3, 0.2] : [0.25, 0.45, 0.75]);
  });
  const cap = lathe([[r * 0.9, 0], [r * 1.1, 0.3], [r * 1.6, 1.0], [0, 1.0]], 16);
  cap.rotateZ(-Math.PI / 2);
  B.add('stone', place(cap, { x: x + 1.45 * c, y: r * 1.1, z: z - 1.45 * sn, ry }), [1, 0.92, 0.8]);
}
