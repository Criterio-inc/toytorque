import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G, groups } from '../core/physics.js';
import { rng } from './warehouseArt.js';

export { rng };

// ---------------------------------------------------------------------------
// Procedurell grafik för supermarketen: blankt vinylgolv, gondolhyllor fulla
// med påhittade varor, hängande gångskyltar, lysrör, frysdiskar med glas,
// frukt- och grönsaksdiskar, kassor med band, kundvagnar, korgar och en
// lastkaj med rulldörrar och pallar. Allt ritas i canvas, inga externa filer.
//
// Allt går genom en kontext (marketCtx). Utan scene byggs bara fysiken,
// utan world bara grafiken. Statisk grafik samlas per material och slås
// ihop vid flush; varor och frukt ritas som InstancedMesh (en per form).
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

const yQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

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

// Text som krymps på bredden om den inte får plats
function fitText(ctx, text, x, y, maxW, size, color, weight = '900', family = '"Arial Black", Arial, sans-serif') {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  if (w > maxW) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(maxW / w, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  } else ctx.fillText(text, x, y);
}

// ===========================================================================
// Kontext, batch och kolliderare
// ===========================================================================

export function marketCtx(scene, world, RAPIER) {
  return {
    scene, world, RAPIER,
    B: scene ? new Batch() : null,
    body: world ? world.createRigidBody(RAPIER.RigidBodyDesc.fixed()) : null,
    products: new Map(), // form -> [{ m: Matrix4, cell }]
    fruit: [], // { m: Matrix4, color }
    mounds: [], // fruktlådornas högar på avstånd { m, color }
  };
}

// Statisk låda i fysiken (alla på samma fasta kropp)
export function solid(C, hx, hy, hz, x, y, z, rotY = 0, friction = 0.7) {
  if (!C.world) return null;
  return C.world.createCollider(
    C.RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(yQuat(rotY))
      .setFriction(friction).setRestitution(0.1).setCollisionGroups(groups(G.WORLD)),
    C.body
  );
}

// Lokal punkt (lx, lz) i en ram (x, z, rotY) -> världen
function local(x, z, rotY, lx, lz) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

class Batch {
  constructor() { this.lists = new Map(); }

  // col: [r, g, b] (vertexfärg) – materialen använder vertexfärger
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
      mesh.receiveShadow = !['light', 'glass'].includes(key);
      if (key === 'glass' || key === 'frost') mesh.renderOrder = 2;
      scene.add(mesh);
    }
    this.lists.clear();
  }
}
const NO_SHADOW = new Set(['light', 'glass', 'signs', 'frost', 'ceiling', 'wall', 'tags', 'lit']);

// Hex -> [r, g, b] i linjärt rum (vertexfärger)
const _c = new THREE.Color();
export const rgb = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };

// ===========================================================================
// Geometrihjälp
// ===========================================================================

// Låda med UV i meter
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

// Flyttar och vrider en geometri från lokal ram till världen
function place(geo, x, y, z, rotY = 0) {
  geo.applyMatrix4(_m4.makeRotationY(rotY).setPosition(x, y, z));
  return geo;
}

// Rund stång mellan två punkter
function rod(ax, ay, az, bx, by, bz, r = 0.006, seg = 5) {
  _va.set(ax, ay, az); _vb.set(bx, by, bz);
  const len = _va.distanceTo(_vb);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  _vb.sub(_va).normalize();
  _q.setFromUnitVectors(_up, _vb);
  _va.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  g.applyMatrix4(_m4.compose(_va, _q, _vs));
  return g;
}

function atlasPlane(w, h, cell) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const [u0, v0, u1, v1] = cell;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

// ===========================================================================
// Texturer och material
// ===========================================================================

function noiseFill(ctx, w, h, base, amt, seed) {
  const r = rng(seed);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (r() - 0.5) * amt;
    img.data[i * 4] = base[0] + n; img.data[i * 4 + 1] = base[1] + n; img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// Vinylplattor 30 cm, åtta i varje led (2,4 m per upprepning)
export const FLOOR_REPEAT = 2.4;
function floorTexture() {
  return cached('floorTex', () => {
    const S = 1024, T = S / 8;
    const [c, ctx] = canvas(S);
    const r = rng(5);
    ctx.fillStyle = '#b9bdc0';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const light = (i + j) % 2 === 0;
      const b = light ? 236 + r() * 6 : 214 + r() * 6;
      ctx.fillStyle = `rgb(${b},${b + 1},${b + 3})`;
      ctx.fillRect(i * T + 1.5, j * T + 1.5, T - 3, T - 3);
      // Flingor i plattan (vinylchips)
      for (let k = 0; k < 70; k++) {
        const g = r() < 0.5 ? 150 + r() * 40 : 250;
        ctx.fillStyle = `rgba(${g},${g},${g + 4},${0.25 + r() * 0.35})`;
        ctx.fillRect(i * T + 3 + r() * (T - 8), j * T + 3 + r() * (T - 8), 1 + r() * 3, 1 + r() * 2);
      }
      // Svag skuggning mot kanterna
      const gr = ctx.createLinearGradient(i * T, j * T, i * T + T, j * T + T);
      gr.addColorStop(0, 'rgba(255,255,255,0.05)');
      gr.addColorStop(1, 'rgba(0,0,0,0.04)');
      ctx.fillStyle = gr;
      ctx.fillRect(i * T + 1.5, j * T + 1.5, T - 3, T - 3);
    }
    // Slitspår och skrapmärken av kundvagnar
    ctx.lineCap = 'round';
    for (let k = 0; k < 14; k++) {
      ctx.strokeStyle = `rgba(90,90,95,${0.04 + r() * 0.05})`;
      ctx.lineWidth = 1 + r() * 2;
      const x = r() * S, y = r() * S, a = r() * 6.28, l = 40 + r() * 160;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    return toTex(c);
  });
}

function wallTexture() {
  return cached('wallTex', () => {
    const [c, ctx] = canvas(256);
    noiseFill(ctx, 256, 256, [238, 238, 234], 8, 61);
    return toTex(c);
  });
}

// Undertak: 60 cm plattor i ett T-profilnät (1,2 m per upprepning)
function ceilingTexture() {
  return cached('ceilTex', () => {
    const [c, ctx] = canvas(256);
    noiseFill(ctx, 256, 256, [232, 233, 230], 14, 62);
    ctx.fillStyle = '#a9adb0';
    for (const p of [0, 128]) { ctx.fillRect(p, 0, 4, 256); ctx.fillRect(0, p, 256, 4); }
    const r = rng(63);
    ctx.fillStyle = 'rgba(120,120,115,0.25)';
    for (let i = 0; i < 400; i++) ctx.fillRect(r() * 256, r() * 256, 1.5, 1.5);
    return toTex(c);
  });
}

// Hålpanel på gondolens rygg (0,5 m per upprepning)
function pegTexture() {
  return cached('pegTex', () => {
    const [c, ctx] = canvas(128);
    noiseFill(ctx, 128, 128, [200, 203, 206], 6, 64);
    ctx.fillStyle = 'rgba(60,62,66,0.75)';
    for (let x = 8; x < 128; x += 16) for (let y = 8; y < 128; y += 16) { ctx.beginPath(); ctx.arc(x, y, 2.3, 0, 7); ctx.fill(); }
    return toTex(c);
  });
}

// Hyllkantslist med prisetiketter (1,25 m x 4 cm)
function tagTexture() {
  return cached('tagTex', () => {
    const [c, ctx] = canvas(512, 32);
    ctx.fillStyle = '#e9ecef'; ctx.fillRect(0, 0, 512, 32);
    ctx.fillStyle = '#9aa1a8'; ctx.fillRect(0, 0, 512, 2); ctx.fillRect(0, 30, 512, 2);
    const r = rng(65);
    for (let i = 0; i < 4; i++) {
      const x = 14 + i * 128 + r() * 30, sale = r() < 0.3;
      ctx.fillStyle = sale ? '#ffd400' : '#ffffff';
      ctx.fillRect(x, 4, 70, 24);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.strokeRect(x, 4, 70, 24);
      ctx.fillStyle = sale ? '#c62828' : '#222';
      ctx.font = 'bold 15px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.floor(9 + r() * 60)}:${['90', '50', '95', '00'][Math.floor(r() * 4)]}`, x + 66, 17);
      ctx.fillStyle = '#555'; ctx.fillRect(x + 4, 9, 18, 2); ctx.fillRect(x + 4, 14, 14, 2); ctx.fillRect(x + 4, 19, 16, 2);
    }
    return toTex(c);
  });
}

function woodTexture() {
  return cached('woodTex', () => {
    const [c, ctx] = canvas(256);
    noiseFill(ctx, 256, 256, [196, 160, 112], 18, 66);
    const r = rng(67);
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = `rgba(120,85,45,${0.1 + r() * 0.2})`;
      ctx.lineWidth = 1 + r() * 2;
      const y = r() * 256;
      ctx.beginPath(); ctx.moveTo(0, y);
      ctx.bezierCurveTo(80, y + (r() - 0.5) * 10, 170, y + (r() - 0.5) * 10, 256, y);
      ctx.stroke();
    }
    return toTex(c);
  });
}

function kraftTexture() {
  return cached('kraftTex', () => {
    const [c, ctx] = canvas(256);
    noiseFill(ctx, 256, 256, [190, 150, 104], 14, 68);
    ctx.fillStyle = 'rgba(214,190,150,0.8)'; ctx.fillRect(0, 118, 256, 20); // tejp
    ctx.strokeStyle = 'rgba(70,45,20,0.75)'; ctx.lineWidth = 3;
    ctx.strokeRect(160, 170, 70, 50);
    ctx.beginPath(); ctx.moveTo(172, 205); ctx.lineTo(182, 182); ctx.lineTo(192, 205); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(200, 205); ctx.lineTo(210, 182); ctx.lineTo(220, 205); ctx.stroke();
    fitText(ctx, 'DENNA SIDA UPP', 90, 40, 150, 18, 'rgba(70,45,20,0.7)', 'bold', 'Arial');
    return toTex(c);
  });
}

// Korrugerad rulldörr (en lamell = 10 cm)
function doorTexture() {
  return cached('doorTex', () => {
    const [c, ctx] = canvas(64, 64);
    for (let y = 0; y < 64; y++) {
      const k = 0.78 + 0.22 * Math.sin((y / 64) * Math.PI * 2);
      ctx.fillStyle = `rgb(${Math.round(190 * k)},${Math.round(196 * k)},${Math.round(202 * k)})`;
      ctx.fillRect(0, y, 64, 1);
    }
    return toTex(c);
  });
}

function hazardTexture() {
  return cached('hazTex', () => {
    const [c, ctx] = canvas(128, 32);
    ctx.fillStyle = '#f2c200'; ctx.fillRect(0, 0, 128, 32);
    ctx.fillStyle = '#1d1d1d';
    for (let x = -32; x < 160; x += 32) { ctx.beginPath(); ctx.moveTo(x, 32); ctx.lineTo(x + 16, 32); ctx.lineTo(x + 48, 0); ctx.lineTo(x + 32, 0); ctx.fill(); }
    return toTex(c);
  });
}

function concreteTexture() {
  return cached('concTex', () => {
    const [c, ctx] = canvas(256);
    noiseFill(ctx, 256, 256, [168, 168, 164], 22, 69);
    return toTex(c);
  });
}

// Frost: vitblå kristaller med alfa
function frostTexture() {
  return cached('frostTex', () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    const r = rng(70);
    const img = ctx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const a = 60 + r() * 50;
      img.data[i * 4] = 225; img.data[i * 4 + 1] = 240; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 260; i++) {
      const x = r() * S, y = r() * S, l = 4 + r() * 14;
      ctx.lineWidth = 0.6 + r();
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI + r() * 0.2;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
      }
    }
    for (let i = 0; i < 30; i++) {
      const x = r() * S, y = r() * S, rad = 20 + r() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    return toTex(c);
  });
}

const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
const MATERIALS = {
  metal: () => cached('m_metal', () => std({ roughness: 0.4, metalness: 0.35 })),
  paint: () => cached('m_paint', () => std({ roughness: 0.6 })),
  gloss: () => cached('m_gloss', () => std({ roughness: 0.25 })),
  chrome: () => cached('m_chrome', () => std({ roughness: 0.2, metalness: 0.9 })),
  rubber: () => cached('m_rubber', () => std({ roughness: 0.85 })),
  peg: () => cached('m_peg', () => std({ map: pegTexture(), roughness: 0.55, metalness: 0.2 })),
  tags: () => cached('m_tags', () => std({ map: tagTexture(), roughness: 0.4 })),
  wood: () => cached('m_wood', () => std({ map: woodTexture(), roughness: 0.8 })),
  kraft: () => cached('m_kraft', () => std({ map: kraftTexture(), roughness: 0.9 })),
  door: () => cached('m_door', () => std({ map: doorTexture(), roughness: 0.45, metalness: 0.5 })),
  hazard: () => cached('m_haz', () => std({ map: hazardTexture(), roughness: 0.6 })),
  concrete: () => cached('m_conc', () => std({ map: concreteTexture(), roughness: 0.85 })),
  wall: () => cached('m_wall', () => std({ map: wallTexture(), roughness: 0.75 })),
  ceiling: () => cached('m_ceil', () => std({ map: ceilingTexture(), roughness: 0.9, side: THREE.DoubleSide })),
  signs: () => cached('m_signs', () => std({ map: signAtlas().tex, emissiveMap: signAtlas().tex, emissive: 0xffffff, emissiveIntensity: 0.28, roughness: 0.5 })),
  light: () => cached('m_light', () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
  lit: () => cached('m_lit', () => std({ roughness: 0.5, emissive: 0xdff3ff, emissiveIntensity: 0.35 })),
  glass: () => cached('m_glass', () => std({ roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.6 })),
  frost: () => cached('m_frost', () => std({ map: frostTexture(), transparent: true, depthWrite: false, roughness: 0.15, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 })),
};

// ===========================================================================
// Skyltatlas (gångskyltar, avdelningar, kampanjer, kassanummer m.m.)
// ===========================================================================

export const AISLES = [
  [1, 'FRUKOST', 'FLINGOR · MÜSLI'], [2, 'KONSERVER', 'SOPPOR · BÖNOR'], [3, 'PASTA · RIS', 'OLJA · SÅSER'],
  [4, 'DRYCK', 'LÄSK · SAFT'], [5, 'TVÄTT · DISK', 'HUSHÅLL'], [6, 'KAFFE · TE', 'KEX · KNÄCKE'],
  [7, 'SYLT · HONUNG', 'INLAGT'], [8, 'DRYCK', 'VATTEN · JUICE'],
];
const DEPTS = [['FRYST', '#1e63b5'], ['FRUKT & GRÖNT', '#2e8b3e'], ['MEJERI', '#2a7fc0'], ['LAGER · ENDAST PERSONAL', '#4a4f55'], ['KASSOR', '#c62828'], ['BRÖD', '#a0642a'], ['SUPERMARKETEN', '#c62828']];
const PROMOS = ['KAMPANJ', '-25%', '2 FÖR 30:-', 'NYHET!', 'SUPERPRIS', 'FYND!'];
export const FRUIT_CARDS = [['ÄPPLEN', '24:90/kg'], ['APELSINER', '19:90/kg'], ['CITRONER', '4:50/st'], ['TOMATER', '34:90/kg'], ['MELON', '25:-/st'], ['VITKÅL', '12:90/kg'], ['POTATIS', '9:90/kg'], ['LIME', '3:-/st'], ['BRÖD', '29:-/st']];

function signItems() {
  const items = [];
  for (const [n, a, b] of AISLES) items.push({ key: 'g' + n, w: 512, h: 192, draw: (ctx, w, h) => drawAisle(ctx, w, h, n, a, b) });
  items.push({ key: 'gF', w: 512, h: 192, draw: (ctx, w, h) => drawAisle(ctx, w, h, '❄', 'FRYST', 'GLASS · PIZZA · FISK') });
  for (const [t, col] of DEPTS) items.push({ key: 'd_' + t, w: 1016, h: 160, draw: (ctx, w, h) => drawBoard(ctx, w, h, t, col) });
  for (const t of PROMOS) items.push({ key: 'p_' + t, w: 256, h: 256, draw: (ctx, w, h) => drawPromo(ctx, w, h, t) });
  for (let i = 1; i <= 8; i++) items.push({ key: 'k' + i, w: 128, h: 128, draw: (ctx, w, h) => drawKassa(ctx, w, h, i) });
  for (const [a, b] of FRUIT_CARDS) items.push({ key: 'f_' + a, w: 256, h: 128, draw: (ctx, w, h) => drawChalk(ctx, w, h, a, b) });
  items.push({ key: 'wet', w: 256, h: 320, draw: drawWetFloor });
  items.push({ key: 'banner', w: 1016, h: 128, draw: drawBanner });
  items.push({ key: 'opening', w: 1016, h: 160, draw: drawOpening });
  items.push({ key: 'exit', w: 256, h: 96, draw: drawExit });
  items.push({ key: 'dock1', w: 256, h: 96, draw: (ctx, w, h) => drawDock(ctx, w, h, 'LASTKAJ 1') });
  items.push({ key: 'dock2', w: 256, h: 96, draw: (ctx, w, h) => drawDock(ctx, w, h, 'PORT 2') });
  items.push({ key: 'frysrum', w: 512, h: 96, draw: drawFreezeLintel });
  items.push({ key: 'open', w: 256, h: 96, draw: (ctx, w, h) => { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h); fitText(ctx, 'STÄNGT', w / 2, h / 2, w - 30, 58, '#ff3b2f'); } });
  return items;
}

function signAtlas() {
  return cached('signAtlas', () => {
    const S = 2048, SH = 2560;
    const [c, ctx] = canvas(S, SH);
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, S, SH);
    const cells = new Map();
    let x = 0, y = 0, rowH = 0;
    for (const it of signItems()) {
      if (x + it.w > S) { x = 0; y += rowH + 4; rowH = 0; }
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath(); ctx.rect(0, 0, it.w, it.h); ctx.clip();
      it.draw(ctx, it.w, it.h);
      ctx.restore();
      const e = 1.5;
      if (y + it.h > SH) throw new Error('skyltatlasen är full');
      cells.set(it.key, [(x + e) / S, 1 - (y + it.h - e) / SH, (x + it.w - e) / S, 1 - (y + e) / SH]);
      x += it.w + 4;
      rowH = Math.max(rowH, it.h);
    }
    const tex = toTex(c, { repeat: false });
    return { tex, cells };
  });
}
const signCell = (key) => signAtlas().cells.get(key);

function drawAisle(ctx, w, h, n, a, b) {
  ctx.fillStyle = '#1f4e8c'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#8fb4e6'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(96, h / 2, 66, 0, 7); ctx.fill();
  fitText(ctx, String(n), 96, h / 2 + 4, 100, 96, '#1a1a1a');
  fitText(ctx, a, 330, h * 0.36, 320, 50, '#ffffff');
  fitText(ctx, b, 330, h * 0.7, 320, 32, '#cfe0ff', 'bold', 'Arial');
}
function drawBoard(ctx, w, h, t, col) {
  ctx.fillStyle = col; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 10);
  fitText(ctx, t, w / 2, h / 2 + 4, w - 80, 100, '#ffffff');
}
function drawPromo(ctx, w, h, t) {
  ctx.fillStyle = '#d7262e'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffdd00'; ctx.beginPath();
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2, r = i % 2 ? 92 : 124;
    ctx.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
  }
  ctx.fill();
  fitText(ctx, t, w / 2, h / 2 + 3, 170, 62, '#c4121b');
}
function drawKassa(ctx, w, h, n) {
  ctx.fillStyle = '#1b6e33'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#d9ffe4'; ctx.lineWidth = 5; ctx.strokeRect(5, 5, w - 10, h - 10);
  fitText(ctx, String(n), w / 2, h / 2 + 4, 90, 92, '#ffffff');
}
function drawChalk(ctx, w, h, a, b) {
  ctx.fillStyle = '#c49a62'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#262a27'; ctx.fillRect(10, 10, w - 20, h - 20);
  fitText(ctx, a, w / 2, 44, w - 40, 34, '#f4f4ee', 'bold', '"Comic Sans MS", "Chalkboard", Arial');
  fitText(ctx, b, w / 2, 90, w - 40, 38, '#ffd84a', 'bold', '"Comic Sans MS", "Chalkboard", Arial');
}
function drawWetFloor(ctx, w, h) {
  ctx.fillStyle = '#ffd000'; ctx.fillRect(0, 0, w, h);
  fitText(ctx, 'OBS!', w / 2, 40, w - 40, 46, '#111');
  ctx.strokeStyle = '#111'; ctx.lineWidth = 10; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(w / 2, 80); ctx.lineTo(w / 2 + 80, 220); ctx.lineTo(w / 2 - 80, 220); ctx.closePath(); ctx.stroke();
  // Figur som halkar
  ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(w / 2 + 14, 132, 11, 0, 7); ctx.fillStyle = '#111'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(w / 2 + 6, 146); ctx.lineTo(w / 2 - 12, 182); ctx.lineTo(w / 2 + 22, 204);
  ctx.moveTo(w / 2 - 12, 182); ctx.lineTo(w / 2 - 40, 196);
  ctx.moveTo(w / 2 + 2, 156); ctx.lineTo(w / 2 + 34, 150); ctx.moveTo(w / 2 + 2, 156); ctx.lineTo(w / 2 - 26, 146);
  ctx.stroke();
  ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(w / 2 - 60, 212); ctx.lineTo(w / 2 + 60, 212); ctx.stroke();
  fitText(ctx, 'VÅTT GOLV', w / 2, 270, w - 30, 44, '#111');
}
function drawBanner(ctx, w, h) {
  ctx.fillStyle = '#d7262e'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 8, w, 6); ctx.fillRect(0, h - 14, w, 6);
  fitText(ctx, 'SUPERHOPP!  HALVA PRISET', w / 2, h / 2 + 3, w - 80, 76, '#ffdd00');
}
function drawOpening(ctx, w, h) {
  ctx.fillStyle = '#ffd23f'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d7262e'; ctx.fillRect(8, 8, w - 16, h - 16);
  for (let x = 20; x < w; x += 46) { ctx.fillStyle = x % 92 < 46 ? '#ffffff' : '#ffd23f'; ctx.beginPath(); ctx.arc(x, 20, 7, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(x + 23, h - 20, 7, 0, 7); ctx.fill(); }
  fitText(ctx, 'STORT ÖPPNANDE!', w / 2, h / 2 + 4, w - 90, 92, '#ffffff');
}
function drawExit(ctx, w, h) {
  ctx.fillStyle = '#0a8f3c'; ctx.fillRect(0, 0, w, h);
  fitText(ctx, 'NÖDUTGÅNG', w / 2 + 20, h / 2 + 2, w - 80, 40, '#ffffff');
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(14, h / 2); ctx.lineTo(40, h / 2 - 22); ctx.lineTo(40, h / 2 + 22); ctx.fill();
}
function drawDock(ctx, w, h, t) {
  ctx.drawImage(hazardTexture().image, 0, 0, w, h);
  ctx.fillStyle = '#f2c200'; ctx.fillRect(14, 14, w - 28, h - 28);
  fitText(ctx, t, w / 2, h / 2 + 2, w - 50, 46, '#111');
}
function drawFreezeLintel(ctx, w, h) {
  ctx.fillStyle = '#eaf5fc'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1e63b5'; ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 10);
  fitText(ctx, 'FRYSRUMMET', w / 2 + 30, h / 2 + 3, w - 140, 56, '#1e63b5');
  ctx.strokeStyle = '#1e63b5'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    ctx.beginPath(); ctx.moveTo(52 - Math.cos(a) * 28, h / 2 - Math.sin(a) * 28); ctx.lineTo(52 + Math.cos(a) * 28, h / 2 + Math.sin(a) * 28); ctx.stroke();
  }
}

// Skylt som plan (framsidan mot +z i lokal ram)
export function addSign(C, key, w, h, x, y, z, rotY = 0, twoSided = false) {
  if (!C.B) return;
  C.B.add('signs', place(atlasPlane(w, h, signCell(key)), x, y, z, rotY));
  if (twoSided) C.B.add('signs', place(atlasPlane(w, h, signCell(key)).rotateY(Math.PI), x, y, z, rotY));
}

// ===========================================================================
// Varor: atlas med påhittade förpackningar, en InstancedMesh per form
// ===========================================================================

const PA = 8; // 8 x 8 rutor
const CS = 1 / PA;
export const SHAPES = {
  cereal: { kind: 'box', w: 0.19, h: 0.28, d: 0.07 },
  smallbox: { kind: 'box', w: 0.13, h: 0.21, d: 0.055 },
  can: { kind: 'cyl', r: 0.033, h: 0.122 },
  bigcan: { kind: 'cyl', r: 0.042, h: 0.11 },
  bottle: { kind: 'bottle', r: 0.042, h: 0.3 },
  jar: { kind: 'jar', r: 0.042, h: 0.125 },
  jug: { kind: 'jug', w: 0.17, h: 0.27, d: 0.1 },
  carton: { kind: 'box', w: 0.075, h: 0.2, d: 0.075 },
  pizza: { kind: 'flat', w: 0.28, h: 0.04, d: 0.28 },
  tub: { kind: 'cyl', r: 0.068, h: 0.095 },
};
for (const s of Object.values(SHAPES)) { s.fw = s.w ?? s.r * 2; s.fd = s.d ?? s.r * 2; }

// [namn, form, bakgrund, text, accent, motiv]
const LABELS = [
  ['FRUKOSTRINGAR', 'cereal', '#ffcc1f', '#d6261d', '#d6261d', 'rings'],
  ['HAVREKUDDAR', 'cereal', '#7a4a24', '#ffe9b0', '#e8b04a', 'pillows'],
  ['CHOKOFLINGOR', 'cereal', '#4a2614', '#ff9a1f', '#8a4a20', 'flakes'],
  ['MÜSLI KNAPER', 'cereal', '#2e7d32', '#ffffff', '#c5e1a5', 'flakes'],
  ['MAJSFLINGOR', 'cereal', '#f5d000', '#1d4fa0', '#ff8f00', 'flakes'],
  ['HONUNGSPUFFAR', 'cereal', '#f39c12', '#4a2614', '#ffe08a', 'rings'],
  ['SPAGETTI', 'smallbox', '#1e5aa8', '#ffffff', '#ffd23f', 'window'],
  ['RIS', 'smallbox', '#efe9d6', '#b8322a', '#b8322a', 'grain'],
  ['KNÄCKE', 'smallbox', '#c8a064', '#3b2a1a', '#8a5a2a', 'grain'],
  ['KEX', 'smallbox', '#d32f2f', '#fff3c4', '#ffe08a', 'dots'],
  ['TE', 'smallbox', '#2e6b4f', '#f5e6b8', '#f5e6b8', 'leaf'],
  ['KAFFE', 'smallbox', '#3b2416', '#e9c46a', '#e9c46a', 'bean'],
  ['SKUMMIS', 'can', '#d81b60', '#ffffff', '#ffd1e3', 'bubbles'],
  ['BUBBEL', 'can', '#00897b', '#ffffff', '#b2dfdb', 'bubbles'],
  ['CITRUSKICK', 'can', '#c0ca33', '#1b5e20', '#ffffff', 'wave'],
  ['PÄRONSODA', 'can', '#7b1fa2', '#ffffff', '#e1bee7', 'wave'],
  ['TOMATSOPPA', 'bigcan', '#c62828', '#ffffff', '#ffffff', 'soup'],
  ['BÖNOR', 'bigcan', '#ef6c00', '#ffffff', '#ffe0b2', 'soup'],
  ['MAJS', 'bigcan', '#fbc02d', '#1b5e20', '#2e7d32', 'soup'],
  ['ÄRTSOPPA', 'bigcan', '#689f38', '#ffffff', '#f1f8e9', 'soup'],
  ['TONFISK', 'bigcan', '#0277bd', '#ffffff', '#b3e5fc', 'soup'],
  ['LÄSK', 'bottle', '#3e2318', '#ffffff', '#e53935', 'label'],
  ['APELSIN', 'bottle', '#ff8f00', '#ffffff', '#1b5e20', 'label'],
  ['SAFT', 'bottle', '#a3122a', '#ffffff', '#f8bbd0', 'label'],
  ['OLJA', 'bottle', '#c8b400', '#2e3a10', '#f1f8d0', 'label'],
  ['VATTEN', 'bottle', '#9fd8f4', '#0d47a1', '#e3f2fd', 'label'],
  ['SYLT', 'jar', '#7a1020', '#7a1020', '#e53935', 'gingham'],
  ['GURKA', 'jar', '#6f9a2c', '#2e5d10', '#fdd835', 'gingham'],
  ['HONUNG', 'jar', '#e8a010', '#6b3c06', '#4e342e', 'gingham'],
  ['TVÄTT+', 'jug', '#1565c0', '#ffffff', '#ffeb3b', 'swoosh'],
  ['SKÖLJ', 'jug', '#ec407a', '#ffffff', '#f8bbd0', 'swoosh'],
  ['DISK', 'jug', '#43a047', '#ffffff', '#c8e6c9', 'swoosh'],
  ['MJÖLK', 'carton', '#f2f7fb', '#1e63b5', '#1e63b5', 'carton'],
  ['FIL', 'carton', '#f2f7f0', '#2e7d32', '#2e7d32', 'carton'],
  ['JUICE', 'carton', '#ffb300', '#ffffff', '#2e7d32', 'carton'],
  ['PIZZA', 'pizza', '#c62828', '#ffffff', '#ffd23f', 'pizza'],
  ['FISKPINNAR', 'pizza', '#0d47a1', '#ffffff', '#ffb300', 'fish'],
  ['GLASS', 'tub', '#f8bbd0', '#ad1457', '#ffffff', 'scoop'],
  ['VANILJ', 'tub', '#fff3c4', '#8d6e63', '#ffffff', 'scoop'],
];
export const LABEL = Object.fromEntries(LABELS.map((L, i) => [L[0], i]));
const labelShape = (i) => LABELS[i][1];

// Kategorier för hyllorna: listor med etikettnamn
export const CATS = {
  frukost: ['FRUKOSTRINGAR', 'HAVREKUDDAR', 'CHOKOFLINGOR', 'MÜSLI KNAPER', 'MAJSFLINGOR', 'HONUNGSPUFFAR', 'KNÄCKE', 'SYLT', 'HONUNG'],
  konserver: ['TOMATSOPPA', 'BÖNOR', 'MAJS', 'ÄRTSOPPA', 'TONFISK', 'GURKA'],
  pasta: ['SPAGETTI', 'RIS', 'OLJA', 'GURKA', 'TOMATSOPPA'],
  dryck: ['SKUMMIS', 'BUBBEL', 'CITRUSKICK', 'PÄRONSODA', 'LÄSK', 'APELSIN', 'SAFT', 'VATTEN'],
  tvatt: ['TVÄTT+', 'SKÖLJ', 'DISK', 'KEX'],
  kaffe: ['KAFFE', 'TE', 'KEX', 'KNÄCKE', 'HONUNG'],
  sylt: ['SYLT', 'GURKA', 'HONUNG', 'SAFT', 'OLJA'],
  vatten: ['VATTEN', 'APELSIN', 'LÄSK', 'SKUMMIS', 'CITRUSKICK', 'JUICE'],
};

function drawPack(ctx, W, H, L) {
  const [name, shape, bg, fg, ac, motif] = L;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const cx = W / 2;
  if (shape === 'cereal') {
    ctx.fillStyle = ac;
    ctx.beginPath(); ctx.moveTo(0, H * 0.06); ctx.lineTo(W, 0); ctx.lineTo(W, H * 0.3); ctx.lineTo(0, H * 0.36); ctx.fill();
    fitText(ctx, name, cx, H * 0.19, W * 0.9, 36, motif === 'rings' ? '#ffffff' : fg);
    // Skål med frukostflingor
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(cx, H * 0.68, W * 0.36, H * 0.05, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - W * 0.36, H * 0.68); ctx.quadraticCurveTo(cx, H * 0.92, cx + W * 0.36, H * 0.68); ctx.fill();
    const r = rng(name.length * 13);
    for (let i = 0; i < 16; i++) {
      const x = cx + (r() - 0.5) * W * 0.6, y = H * 0.64 + (r() - 0.5) * H * 0.06;
      ctx.fillStyle = motif === 'rings' ? ['#e53935', '#43a047', '#fdd835', '#8e24aa'][i % 4] : motif === 'pillows' ? '#c98a3c' : ac;
      if (motif === 'rings') { ctx.lineWidth = 4; ctx.strokeStyle = ctx.fillStyle; ctx.beginPath(); ctx.ellipse(x, y, 8, 6, 0, 0, 7); ctx.stroke(); }
      else { ctx.beginPath(); ctx.ellipse(x, y, 10, 6, r() * 3, 0, 7); ctx.fill(); }
    }
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(W * 0.8, H * 0.46, 18, 0, 7); ctx.fill();
    fitText(ctx, 'NY!', W * 0.8, H * 0.46, 30, 14, '#d6261d');
  } else if (shape === 'smallbox') {
    ctx.fillStyle = ac; ctx.fillRect(0, H * 0.62, W, H * 0.06);
    fitText(ctx, name, cx, H * 0.3, W * 0.88, 34, fg);
    if (motif === 'window') {
      ctx.fillStyle = '#f1d68a'; ctx.fillRect(W * 0.2, H * 0.72, W * 0.6, H * 0.18);
      ctx.strokeStyle = '#c9a24a'; for (let x = W * 0.22; x < W * 0.8; x += 6) { ctx.beginPath(); ctx.moveTo(x, H * 0.72); ctx.lineTo(x, H * 0.9); ctx.stroke(); }
    } else if (motif === 'leaf' || motif === 'bean') {
      ctx.fillStyle = ac; ctx.beginPath(); ctx.ellipse(cx, H * 0.8, 20, 12, 0.5, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = ac; for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(W * 0.18 + (i % 3) * W * 0.32, H * 0.74 + Math.floor(i / 3) * 14, 4, 0, 7); ctx.fill(); }
    }
  } else if (shape === 'can' || shape === 'bigcan' || shape === 'tub') {
    // Fronten ligger mitt i rutan (u = 0,5); silverkant upptill för locket
    ctx.fillStyle = shape === 'tub' ? '#ffffff' : '#c9ced3'; ctx.fillRect(0, 0, W, H * 0.06); ctx.fillRect(0, H * 0.95, W, H * 0.05);
    if (motif === 'soup') {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, H * 0.52, W, H * 0.43);
      fitText(ctx, name, cx, H * 0.32, W * 0.42, 30, fg);
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cx, H * 0.74, 16, 0, 7); ctx.fill();
      ctx.fillStyle = ac === '#ffffff' ? '#ffd23f' : ac; ctx.beginPath(); ctx.arc(cx - 5, H * 0.72, 5, 0, 7); ctx.fill();
    } else if (motif === 'scoop') {
      fitText(ctx, name, cx, H * 0.36, W * 0.36, 28, fg);
      ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(cx, H * 0.7, 18, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#d4a056'; ctx.beginPath(); ctx.moveTo(cx - 14, H * 0.7); ctx.lineTo(cx, H * 0.92); ctx.lineTo(cx + 14, H * 0.7); ctx.fill();
    } else {
      ctx.fillStyle = ac;
      ctx.beginPath(); ctx.moveTo(0, H * 0.7);
      for (let x = 0; x <= W; x += 8) ctx.lineTo(x, H * 0.68 + Math.sin(x / 18) * 6);
      ctx.lineTo(W, H * 0.95); ctx.lineTo(0, H * 0.95); ctx.fill();
      ctx.save(); ctx.translate(cx, H * 0.4); ctx.rotate(-Math.PI / 2);
      fitText(ctx, name, 0, 0, H * 0.6, 26, fg);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      const r = rng(name.length);
      for (let i = 0; i < 18; i++) { ctx.beginPath(); ctx.arc(r() * W, H * 0.1 + r() * H * 0.55, 2 + r() * 3, 0, 7); ctx.fill(); }
    }
  } else if (shape === 'bottle') {
    ctx.fillStyle = '#d8dde2'; ctx.fillRect(0, 0, W, H * 0.07); // kork
    ctx.fillStyle = ac; ctx.fillRect(0, 0, W, H * 0.05);
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(W * 0.38, H * 0.1, W * 0.05, H * 0.85); // glans
    ctx.fillStyle = name === 'VATTEN' ? '#ffffff' : ac; ctx.fillRect(0, H * 0.4, W, H * 0.26);
    ctx.fillStyle = name === 'VATTEN' ? '#1e88e5' : '#ffffff'; ctx.fillRect(0, H * 0.42, W, H * 0.02);
    fitText(ctx, name, cx, H * 0.54, W * 0.36, 30, name === 'VATTEN' ? '#0d47a1' : fg);
  } else if (shape === 'jar') {
    // Lock med rutigt tyg, glasburk med innehåll, etikett
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H * 0.16);
    ctx.fillStyle = ac;
    for (let x = 0; x < W; x += 12) for (let y = 0; y < H * 0.16; y += 12) if (((x + y) / 12) % 2 === 0) ctx.fillRect(x, y, 12, 12);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(cx, H * 0.58, W * 0.16, H * 0.2, 0, 0, 7); ctx.fill();
    fitText(ctx, name, cx, H * 0.58, W * 0.28, 22, fg);
  } else if (shape === 'jug') {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(0, H * 0.55); ctx.quadraticCurveTo(W * 0.5, H * 0.3, W, H * 0.5); ctx.lineTo(W, H * 0.62); ctx.quadraticCurveTo(W * 0.5, H * 0.45, 0, H * 0.68); ctx.fill();
    ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(cx, H * 0.78, 20, 0, 7); ctx.fill();
    fitText(ctx, name, cx, H * 0.24, W * 0.88, 40, fg);
  } else if (shape === 'carton') {
    ctx.fillStyle = ac; ctx.fillRect(0, 0, W, H * 0.14);
    ctx.fillStyle = ac; ctx.beginPath(); ctx.moveTo(0, H); ctx.quadraticCurveTo(W * 0.5, H * 0.66, W, H); ctx.fill();
    fitText(ctx, name, cx, H * 0.42, W * 0.9, 24, fg);
    if (name === 'JUICE') { ctx.fillStyle = '#ff6f00'; ctx.beginPath(); ctx.arc(cx, H * 0.66, 12, 0, 7); ctx.fill(); }
  } else if (shape === 'pizza') {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H * 0.04);
    if (motif === 'pizza') {
      ctx.fillStyle = '#e8b04a'; ctx.beginPath(); ctx.arc(cx, H * 0.55, W * 0.32, 0, 7); ctx.fill();
      ctx.fillStyle = '#d84315'; ctx.beginPath(); ctx.arc(cx, H * 0.55, W * 0.27, 0, 7); ctx.fill();
      const r = rng(3);
      for (let i = 0; i < 12; i++) { ctx.fillStyle = i % 2 ? '#fff3c4' : '#7b1f1f'; ctx.beginPath(); ctx.arc(cx + (r() - 0.5) * W * 0.4, H * 0.55 + (r() - 0.5) * W * 0.4, 9, 0, 7); ctx.fill(); }
    } else {
      ctx.fillStyle = ac;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.roundRect?.(W * 0.18, H * 0.38 + i * 22, W * 0.64, 14, 6); ctx.fill(); }
    }
    fitText(ctx, name, cx, H * 0.16, W * 0.85, 34, fg);
  }
}

function productAtlas() {
  return cached('prodAtlas', () => {
    const S = 2048, P = S / PA;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#777'; ctx.fillRect(0, 0, S, S);
    LABELS.forEach((L, i) => {
      const s = SHAPES[L[1]];
      // Ritas i millimeter: hela rutan motsvarar etikettens fysiska mått
      const Wmm = s.kind === 'box' || s.kind === 'jug' ? s.w * 1000 : s.kind === 'flat' ? s.w * 1000 : 2 * Math.PI * s.r * 1000;
      const Hmm = s.kind === 'flat' ? s.d * 1000 : s.h * 1000;
      ctx.save();
      ctx.translate((i % PA) * P, Math.floor(i / PA) * P);
      ctx.beginPath(); ctx.rect(0, 0, P, P); ctx.clip();
      ctx.scale(P / Wmm, P / Hmm);
      drawPack(ctx, Wmm, Hmm, L);
      ctx.restore();
    });
    const tex = toTex(c, { repeat: false });
    tex.anisotropy = 4;
    return tex;
  });
}

function productMaterial() {
  return cached('m_prod', () => {
    const m = new THREE.MeshStandardMaterial({ map: productAtlas(), roughness: 0.45 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv += aCell;');
    };
    m.customProgramCacheKey = () => 'marketProducts';
    return m;
  });
}

const cellOffset = (i) => [(i % PA) / PA, 1 - (Math.floor(i / PA) + 1) / PA];

// Formens geometri med UV inom en ruta (förskjuts per instans med aCell)
const IN = 0.004; // marginal mot grannrutor
const mapUV = (u, v) => [IN + u * (CS - 2 * IN), IN + v * (CS - 2 * IN)];
function shapeGeometry(name) {
  return cached('geo_' + name, () => {
    const s = SHAPES[name];
    let g;
    if (s.kind === 'box' || s.kind === 'flat' || s.kind === 'jug') {
      g = new THREE.BoxGeometry(s.w, s.h, s.d);
      const uv = g.attributes.uv;
      const full = s.kind === 'flat' ? [2] : [4, 5]; // fram och bak (pizza: ovansidan)
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        const [u, v] = full.includes(f) ? mapUV(uv.getX(i), uv.getY(i)) : mapUV(0.03 + uv.getX(i) * 0.02, 0.5 + uv.getY(i) * 0.02);
        uv.setXY(i, u, v);
      }
      g.translate(0, s.h / 2, 0);
      if (s.kind === 'jug') {
        // Kork och handtag (sidofärg)
        const cap = new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8);
        cap.translate(-s.w * 0.25, s.h + 0.015, 0);
        const handle = new THREE.BoxGeometry(0.03, 0.09, 0.03);
        handle.translate(s.w * 0.28, s.h + 0.02, 0);
        for (const p of [cap, handle]) { const u = p.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, ...mapUV(0.04, 0.5)); }
        g = mergeGeometries([g, cap, handle].map((q) => q.toNonIndexed()));
      }
    } else if (s.kind === 'cyl') {
      g = new THREE.CylinderGeometry(s.r, s.r, s.h, 6, 1, false, -Math.PI);
      const uv = g.attributes.uv, torso = 7 * 2;
      for (let i = 0; i < uv.count; i++) {
        const [u, v] = i < torso ? mapUV(uv.getX(i), uv.getY(i)) : mapUV(0.5, 0.985);
        uv.setXY(i, u, v);
      }
      g.translate(0, s.h / 2, 0);
    } else {
      // Flaska och burk: svarv där v sätts till höjdandelen i efterhand
      const prof = s.kind === 'bottle'
        ? [[0.001, 0], [1, 0], [1, 0.62], [0.42, 0.85], [0.42, 1], [0.001, 1]]
        : [[0.001, 0], [1, 0], [1, 0.82], [0.95, 1], [0.001, 1]];
      g = new THREE.LatheGeometry(prof.map(([rr, t]) => new THREE.Vector2(Math.max(0.001, rr * s.r), t * s.h)), 6, -Math.PI);
      const uv = g.attributes.uv, pos = g.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, ...mapUV(uv.getX(i), Math.min(0.995, Math.max(0.005, pos.getY(i) / s.h))));
    }
    if (g.index) g = g.toNonIndexed();
    g.computeVertexNormals();
    return g;
  });
}

/** Lägger en vara (botten på y) vänd med framsidan mot rotY (0 = +z). */
export function addProduct(C, label, x, y, z, rotY = 0, scale = 1) {
  if (!C.B) return;
  const shape = labelShape(label);
  if (!C.products.has(shape)) C.products.set(shape, []);
  _q.setFromAxisAngle(_up, rotY);
  _va.set(x, y, z); _vb.set(scale, scale, scale);
  C.products.get(shape).push({ m: new THREE.Matrix4().compose(_va, _q, _vb), cell: label });
}

// --- varor och frukt i rutor med två detaljnivåer ---------------------------
// Varje ruta (LOD_CELL m) blir ett THREE.LOD: nära ritas riktiga former
// (en InstancedMesh per form), på avstånd bara framsidan som ett kort (två
// trianglar per vara, ett enda anrop per ruta) och frukten som högar.
const LOD_CELL = 12, LOD_NEAR = 11;
const CARD_SUB = { box: [0, 0, 1, 1], jug: [0, 0, 1, 1], cyl: [0.25, 0, 0.5, 1], bottle: [0.25, 0, 0.5, 1], jar: [0.25, 0, 0.5, 1], flat: [0.03, 0.5, 0.02, 0.02] };

function cardMaterial() {
  return cached('m_card', () => {
    const m = new THREE.MeshStandardMaterial({ map: productAtlas(), roughness: 0.5 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;\nattribute vec4 aSub;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = aCell + vec2(${IN.toFixed(4)}) + (aSub.xy + vMapUv * aSub.zw) * ${(CS - 2 * IN).toFixed(5)};`);
    };
    m.customProgramCacheKey = () => 'marketCards';
    return m;
  });
}
const cardGeometry = () => cached('cardGeo', () => new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0));
const fruitGeometry = () => cached('fruitGeo', () => new THREE.SphereGeometry(1, 6, 4));
const moundGeometry = () => cached('moundGeo', () => new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2));
const fruitMaterial = () => cached('fruitMat', () => new THREE.MeshStandardMaterial({ roughness: 0.42 }));

function instanced(geo, mat, list, cx, cz, extra) {
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const T = new THREE.Matrix4().makeTranslation(-cx, 0, -cz), m = new THREE.Matrix4(), col = new THREE.Color();
  list.forEach((it, i) => {
    mesh.setMatrixAt(i, m.multiplyMatrices(T, it.m));
    if (it.color !== undefined) mesh.setColorAt(i, col.set(it.color));
  });
  if (extra) extra(mesh);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

function flushInstanced(C) {
  const cells = new Map();
  const cellOf = (m) => {
    _va.setFromMatrixPosition(m);
    const k = Math.floor(_va.x / LOD_CELL) + ',' + Math.floor(_va.z / LOD_CELL);
    if (!cells.has(k)) cells.set(k, { prod: new Map(), fruit: [], mounds: [], cards: [], sx: 0, sz: 0, n: 0 });
    const c = cells.get(k);
    c.sx += _va.x; c.sz += _va.z; c.n++;
    return c;
  };
  const S = new THREE.Matrix4(), Tz = new THREE.Matrix4();
  for (const [shape, list] of C.products) {
    const sh = SHAPES[shape];
    for (const p of list) {
      const c = cellOf(p.m);
      if (!c.prod.has(shape)) c.prod.set(shape, []);
      c.prod.get(shape).push(p);
      // Kort: framsidan i varans mått
      Tz.makeTranslation(0, 0, sh.fd / 2 + 0.002);
      S.makeScale(sh.fw, sh.h, 1);
      c.cards.push({ m: p.m.clone().multiply(Tz).multiply(S), cell: p.cell, sub: CARD_SUB[sh.kind] });
    }
  }
  for (const f of C.fruit) cellOf(f.m).fruit.push(f);
  for (const f of C.mounds) cellOf(f.m).mounds.push(f);
  const withCells = (list) => (mesh) => {
    const cells2 = new Float32Array(list.length * 2);
    list.forEach((p, i) => { const [u, v] = cellOffset(p.cell); cells2[i * 2] = u; cells2[i * 2 + 1] = v; });
    mesh.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells2, 2));
    if (list[0]?.sub) {
      const sub = new Float32Array(list.length * 4);
      list.forEach((p, i) => sub.set(p.sub, i * 4));
      mesh.geometry.setAttribute('aSub', new THREE.InstancedBufferAttribute(sub, 4));
    }
  };
  for (const c of cells.values()) {
    const cx = c.sx / c.n, cz = c.sz / c.n;
    const lod = new THREE.LOD();
    lod.position.set(cx, 0, cz);
    const near = new THREE.Group(), far = new THREE.Group();
    for (const [shape, list] of c.prod) near.add(instanced(shapeGeometry(shape).clone(), productMaterial(), list, cx, cz, withCells(list)));
    if (c.fruit.length) near.add(instanced(fruitGeometry(), fruitMaterial(), c.fruit, cx, cz));
    const fill = c.mounds.filter((f) => !f.loaf);
    if (fill.length) near.add(instanced(moundGeometry(), fruitMaterial(), fill, cx, cz));
    if (c.cards.length) far.add(instanced(cardGeometry().clone(), cardMaterial(), c.cards, cx, cz, withCells(c.cards)));
    if (c.mounds.length) far.add(instanced(moundGeometry(), fruitMaterial(), c.mounds, cx, cz));
    lod.addLevel(near, 0);
    lod.addLevel(far, LOD_NEAR);
    C.scene.add(lod);
  }
  C.products.clear();
  C.fruit = [];
  C.mounds = [];
}

// Fyller en hyllsträcka (lokal ram: hyllan längs z, varorna vända mot +x*side)
function fillRun(C, r, labels, { x, z, rotY }, { fx, z0, z1, y, side, maxH, depth = 1 }) {
  // Välj en form för sträckan, sedan block om 2–6 likadana fasader
  const shapes = [...new Set(labels.map((l) => labelShape(LABEL[l])))].filter((s) => SHAPES[s].h + (SHAPES[s].kind === 'jug' ? 0.05 : 0) < maxH);
  if (!shapes.length) return;
  const shape = shapes[Math.floor(r() * shapes.length)];
  const S = SHAPES[shape];
  const pool = labels.filter((l) => labelShape(LABEL[l]) === shape);
  const gap = 0.006;
  let zc = z0 + S.fw / 2 + 0.01, run = 0, label = pool[0];
  const rot = rotY + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
  while (zc + S.fw / 2 < z1 - 0.005) {
    if (run <= 0) { label = pool[Math.floor(r() * pool.length)]; run = 2 + Math.floor(r() * 5); }
    run--;
    if (r() > 0.03) {
      for (let k = 0; k < depth; k++) {
        const lx = side * (fx - S.fd / 2 - 0.004 - k * (S.fd + 0.01));
        const [wx, wz] = local(x, z, rotY, lx, zc);
        addProduct(C, LABEL[label], wx, y, wz, rot);
      }
    }
    zc += S.fw + gap;
  }
}

// ===========================================================================
// Butiksskalet: golv, väggar, undertak och lysrör
// ===========================================================================

export function makeStore(C, { x0, x1, z0, z1, height, ground = 84 }) {
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // Marken täcker hela nivån; väggarna stänger hallen
  solid(C, ground / 2, 0.5, ground / 2, 0, -0.5, 0, 0, 1);
  for (const [hx, hz, x, z] of [[W / 2 + 0.3, 0.15, cx, z0 - 0.15], [W / 2 + 0.3, 0.15, cx, z1 + 0.15], [0.15, D / 2 + 0.3, x0 - 0.15, cz], [0.15, D / 2 + 0.3, x1 + 0.15, cz]]) {
    solid(C, hx, height / 2, hz, x, height / 2, z, 0, 0.5);
  }
  if (!C.B) return;

  // Golvet: blanka vinylplattor
  const map = floorTexture().clone();
  map.repeat.set(W / FLOOR_REPEAT, D / FLOOR_REPEAT);
  map.needsUpdate = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map, roughness: 0.16, metalness: 0, envMapIntensity: 1.1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  C.scene.add(floor);

  // Väggar (plan inåt), sockel och en färgrand runt hela butiken
  const sides = [
    { x: cx, z: z0, rot: 0, len: W }, { x: cx, z: z1, rot: Math.PI, len: W },
    { x: x0, z: cz, rot: Math.PI / 2, len: D }, { x: x1, z: cz, rot: -Math.PI / 2, len: D },
  ];
  for (const s of sides) {
    const g = new THREE.PlaneGeometry(s.len, height);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s.len / 2, uv.getY(i) * height / 2);
    C.B.add('wall', place(g.translate(0, height / 2, 0), s.x, 0, s.z, s.rot), [1, 1, 1]);
    C.B.add('gloss', place(box(s.len, 0.12, 0.03, 0, 0.06, 0.015), s.x, 0, s.z, s.rot), rgb(0x4a4f55));
    C.B.add('paint', place(box(s.len, 0.32, 0.02, 0, 2.75, 0.01), s.x, 0, s.z, s.rot), rgb(0x2e8b3e));
    C.B.add('paint', place(box(s.len, 0.06, 0.025, 0, 2.55, 0.012), s.x, 0, s.z, s.rot), rgb(0xd7262e));
  }

  // Undertak
  const ceil = new THREE.PlaneGeometry(W, D);
  const cuv = ceil.attributes.uv;
  for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) * W / 1.2, cuv.getY(i) * D / 1.2);
  ceil.rotateX(Math.PI / 2);
  C.B.add('ceiling', ceil.translate(cx, height, cz), [1, 1, 1]);

  // Lysrörsarmaturer i långa rader (nord-syd)
  for (let x = x0 + 2.5; x < x1 - 1; x += 4) {
    for (let z = z0 + 1.5; z < z1 - 1.5; z += 2.1) {
      C.B.add('light', box(0.16, 0.04, 1.7, x, height - 0.1, z), [1.0, 1.0, 1.0]);
      C.B.add('metal', box(0.24, 0.07, 1.8, x, height - 0.055, z), rgb(0xdfe2e5));
    }
  }
}

// Ingångspartiet: mörka glasdörrar mot natten med karmar
export function addEntrance(C, { x, z, w = 7, h = 2.6, rotY = 0 }) {
  if (!C.B) return;
  const n = 4, pw = w / n;
  for (let i = 0; i < n; i++) {
    const lx = -w / 2 + pw * (i + 0.5);
    const [px, pz] = local(x, z, rotY, lx, 0.03);
    C.B.add('gloss', place(box(pw - 0.06, h - 0.1, 0.02, 0, h / 2, 0), px, 0, pz, rotY), rgb(0x0b1726));
  }
  for (let i = 0; i <= n; i++) {
    const [px, pz] = local(x, z, rotY, -w / 2 + pw * i, 0.05);
    C.B.add('chrome', place(box(0.07, h, 0.07, 0, h / 2, 0), px, 0, pz, rotY), rgb(0xb8bec4));
  }
  for (const yy of [0.04, h, 1.0]) C.B.add('chrome', place(box(w, 0.07, 0.06, 0, yy, 0.05), x, 0, z, rotY), rgb(0xb8bec4));
  const [sx, sz] = local(x, z, rotY, 0, 0.06);
  addSign(C, 'd_SUPERMARKETEN', 4.2, 0.66, sx, h + 0.55, sz, rotY);
  const [ox, oz] = local(x, z, rotY, -w / 2 + 0.7, 0.07);
  addSign(C, 'open', 0.7, 0.26, ox, 1.55, oz, rotY);
}

// ===========================================================================
// Gondoler: dubbelsidiga hyllor med varor, prislister och kampanjgavlar
// ===========================================================================

const LEVELS = [0.12, 0.51, 0.9, 1.29, 1.68];
const GH = 2.06; // gondolens höjd
const GW = 1.04; // bredd (båda sidor)

/**
 * Gondol längs lokal z (rotY vrider), sidorna mot ±x. cats: [kategori +x, kategori -x].
 * endcaps: kampanjgavlar i båda ändar (namn på kampanjskylt eller null).
 */
export function addGondola(C, { x, z, len, rotY = 0, cats, seed = 1, endcaps = ['KAMPANJ', '-25%'], promoLabels = null }) {
  const capD = endcaps ? 0.5 : 0;
  solid(C, GW / 2, GH / 2, len / 2 + capD, x, GH / 2, z, rotY);
  if (!C.B) return;
  const r = rng(seed * 97 + 3);
  const T = (g) => place(g, x, 0, z, rotY);
  const steel = rgb(0xd5d9dd), dark = rgb(0x3c4148), white = rgb(0xf2f3f4);

  C.B.add('rubber', T(box(GW, 0.1, len, 0, 0.05, 0)), dark); // sockel
  C.B.add('peg', T(box(0.05, GH - 0.1, len, 0, 0.1 + (GH - 0.1) / 2, 0, 0.5)), [1, 1, 1]); // ryggpanel
  C.B.add('metal', T(box(0.16, 0.05, len + 0.02, 0, GH, 0)), steel);
  for (const sz of [-1, 1]) C.B.add('metal', T(box(GW, GH, 0.03, 0, GH / 2, sz * (len / 2 + 0.015))), white); // gavlar
  const bays = Math.max(1, Math.round(len / 1.25));
  const bay = len / bays;
  for (let b = 0; b <= bays; b++) C.B.add('metal', T(box(0.09, GH - 0.1, 0.04, 0, 0.1 + (GH - 0.1) / 2, -len / 2 + b * bay)), steel);

  for (const side of [1, -1]) {
    const cat = CATS[side > 0 ? cats[0] : cats[1]];
    for (let k = 0; k < LEVELS.length; k++) {
      const y = LEVELS[k];
      if (k > 0) C.B.add('metal', T(box(0.47, 0.02, len - 0.01, side * 0.27, y - 0.01, 0)), steel);
      // Prislist på hyllkanten
      const strip = new THREE.PlaneGeometry(len, 0.04);
      const uv = strip.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 1.25);
      strip.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      strip.translate(side * 0.506, y - 0.025, 0);
      C.B.add('tags', T(strip), [1, 1, 1]);
      if (cat) {
        const maxH = k < LEVELS.length - 1 ? LEVELS[k + 1] - y - 0.03 : 0.36;
        for (let b = 0; b < bays; b++) {
          fillRun(C, r, cat, { x, z, rotY }, { fx: 0.5, z0: -len / 2 + b * bay + 0.03, z1: -len / 2 + (b + 1) * bay - 0.03, y, side, maxH });
        }
      }
    }
  }

  // Kampanjgavlar: tre trappsteg med en vara i bulk och en skylt
  if (!endcaps) return;
  for (const sz of [-1, 1]) {
    const promo = endcaps[sz > 0 ? 0 : 1];
    const zc = sz * (len / 2 + 0.03 + capD / 2);
    const plinth = rgb(0xd7262e);
    C.B.add('gloss', T(box(GW, 0.12, capD, 0, 0.06, zc)), plinth);
    const pool = promoLabels || [...CATS[cats[0]], ...CATS[cats[1] ?? cats[0]]];
    const label = pool[Math.floor(r() * pool.length)];
    const S = SHAPES[labelShape(LABEL[label])];
    const steps = [[0.12, 0.42], [0.55, 0.26], [0.98, 0.12]]; // [y, avstånd från gavelns front]
    for (let k = 0; k < steps.length; k++) {
      const [y, inset] = steps[k];
      if (k > 0) C.B.add('metal', T(box(GW - 0.04, 0.02, capD - inset + 0.04, 0, y - 0.01, sz * (len / 2 + 0.03 + (capD - inset) / 2 + 0.02))), steel);
      C.B.add('metal', T(box(GW - 0.04, Math.max(0.02, y - 0.12), 0.02, 0, 0.12 + (y - 0.12) / 2, sz * (len / 2 + 0.03 + capD - inset + 0.02))), white);
      const nx = Math.floor((GW - 0.06) / (S.fw + 0.006));
      const rows = Math.max(1, Math.floor((capD - inset) / (S.fd + 0.01)));
      for (let i = 0; i < nx; i++) for (let j = 0; j < Math.min(rows, 2); j++) {
        const lx = -((nx - 1) * (S.fw + 0.006)) / 2 + i * (S.fw + 0.006);
        const lz = sz * (len / 2 + 0.03 + capD - inset - S.fd / 2 - 0.005 - j * (S.fd + 0.01));
        const [wx, wz] = local(x, z, rotY, lx, lz);
        addProduct(C, LABEL[label], wx, y, wz, rotY + (sz > 0 ? 0 : Math.PI));
      }
    }
    if (promo) {
      const [px, pz] = local(x, z, rotY, 0, sz * (len / 2 + 0.12));
      C.B.add('chrome', rod(px, 1.25, pz, px, 1.9, pz, 0.012, 6), rgb(0xc0c4c8));
      const [sx2, sz2] = local(x, z, rotY, 0, sz * (len / 2 + 0.135));
      addSign(C, 'p_' + promo, 0.5, 0.5, sx2, 2.05, sz2, rotY + (sz > 0 ? 0 : Math.PI));
    }
  }
}

// Hängande gångskylt (dubbelsidig) med vajrar upp till taket
export function addAisleSign(C, { x, z, y = 3.4, key, rotY = 0, ceiling = 5.5 }) {
  if (!C.B) return;
  const w = 1.7, h = 0.64;
  C.B.add('paint', place(box(w + 0.06, h + 0.06, 0.03, 0, y, 0), x, 0, z, rotY), rgb(0x173b6a));
  const [fx, fz] = local(x, z, rotY, 0, 0.017);
  const [bx2, bz2] = local(x, z, rotY, 0, -0.017);
  C.B.add('signs', place(atlasPlane(w, h, signCell(key)), fx, y, fz, rotY));
  C.B.add('signs', place(atlasPlane(w, h, signCell(key)), bx2, y, bz2, rotY + Math.PI));
  for (const s of [-1, 1]) {
    const [wx, wz] = local(x, z, rotY, s * w * 0.4, 0);
    C.B.add('chrome', rod(wx, y + h / 2, wz, wx, ceiling, wz, 0.004, 4), rgb(0x9aa0a6));
  }
}

// Avdelningsskylt på vägg eller ovanför en disk
export function addDeptSign(C, { x, y, z, rotY = 0, text, w = 4.5 }) {
  if (!C.B) return;
  const h = w * 160 / 1024;
  C.B.add('paint', place(box(w + 0.1, h + 0.1, 0.05, 0, y, 0.025), x, 0, z, rotY), rgb(0xffffff));
  const [px, pz] = local(x, z, rotY, 0, 0.052);
  addSign(C, 'd_' + text, w, h, px, y, pz, rotY);
}

// ===========================================================================
// Frysdiskar och kyldiskar
// ===========================================================================

/** Rad med frysskåp längs lokal z, fronten mot +x. open: kyldisk utan dörrar. */
export function addFreezers(C, { x, z, len, rotY = 0, open = false, labels, seed = 1, sign = null }) {
  const D = open ? 0.85 : 0.95, H = open ? 2.0 : 2.15;
  solid(C, D / 2, H / 2, len / 2, x, H / 2, z, rotY);
  if (!C.B) return;
  const r = rng(seed * 31 + 7);
  const T = (g) => place(g, x, 0, z, rotY);
  const body = rgb(0xf4f6f8), inner = rgb(0xe2ecf4), steel = rgb(0xc7ccd1);
  C.B.add('gloss', T(box(D, 0.18, len, 0, 0.09, 0)), rgb(0x2d3238)); // sockel
  C.B.add('gloss', T(box(0.06, H, len, -D / 2 + 0.03, H / 2, 0)), body); // rygg
  C.B.add('lit', T(box(0.02, H - 0.45, len - 0.04, -D / 2 + 0.07, 0.18 + (H - 0.45) / 2, 0)), inner); // upplyst insida
  C.B.add('gloss', T(box(D, 0.3, len, 0, H - 0.15, 0)), body); // överdel
  C.B.add('paint', T(box(0.02, 0.18, len, D / 2 + 0.005, H - 0.15, 0)), rgb(open ? 0x2a7fc0 : 0x1e63b5)); // färgad list
  C.B.add('light', T(box(0.05, 0.02, len - 0.1, D / 2 - 0.12, H - 0.31, 0)), [0.95, 0.98, 1]);
  for (const s of [-1, 1]) C.B.add('gloss', T(box(D, H, 0.04, 0, H / 2, s * (len / 2 - 0.02))), body);
  const shelfY = open ? [0.2, 0.55, 0.9, 1.25] : [0.2, 0.58, 0.96, 1.34];
  for (const y of shelfY) {
    C.B.add('metal', T(box(D - 0.12, 0.015, len - 0.08, 0.0, y - 0.008, 0)), steel);
    let zc = -len / 2 + 0.08;
    while (zc < len / 2 - 0.25) {
      const label = labels[Math.floor(r() * labels.length)];
      const S = SHAPES[labelShape(LABEL[label])];
      const runLen = 0.4 + r() * 0.6;
      const stack = S.kind === 'flat' ? 3 + Math.floor(r() * 3) : 1;
      for (let zz = zc + S.fw / 2; zz < Math.min(zc + runLen, len / 2 - 0.08) - S.fw / 2; zz += S.fw + 0.006) {
        for (let k = 0; k < stack; k++) {
          const [wx, wz] = local(x, z, rotY, D / 2 - 0.1 - S.fd / 2, zz);
          addProduct(C, LABEL[label], wx, y + k * (S.h + 0.004), wz, rotY + Math.PI / 2);
        }
      }
      zc += runLen + 0.02;
    }
  }
  if (open) {
    // Kyldisk: luftridå-list nertill och prislister
    C.B.add('metal', T(box(0.12, 0.2, len, D / 2 - 0.06, 0.28, 0)), steel);
  } else {
    // Glasdörrar med karmar och handtag
    const n = Math.max(1, Math.round(len / 0.78)), dw = len / n;
    C.B.add('glass', T(box(0.01, H - 0.5, len - 0.08, D / 2 + 0.01, 0.2 + (H - 0.5) / 2, 0)), [0.85, 0.93, 1]);
    for (let i = 0; i <= n; i++) C.B.add('gloss', T(box(0.05, H - 0.48, 0.05, D / 2 + 0.02, 0.2 + (H - 0.5) / 2, -len / 2 + i * dw)), rgb(0x2d3238));
    for (const y of [0.2, H - 0.3]) C.B.add('gloss', T(box(0.05, 0.05, len, D / 2 + 0.02, y, 0)), rgb(0x2d3238));
    for (let i = 0; i < n; i++) {
      const lz = -len / 2 + i * dw + dw - 0.09;
      const [hx, hz] = local(x, z, rotY, D / 2 + 0.06, lz);
      C.B.add('chrome', rod(hx, 0.75, hz, hx, 1.45, hz, 0.012, 6), rgb(0xd6dadf));
    }
  }
  if (sign) {
    const [sx, sz] = local(x, z, rotY, D / 2 + 0.03, 0);
    addSign(C, 'd_' + sign, Math.min(3.2, len * 0.6), Math.min(3.2, len * 0.6) * 160 / 1024, sx, H + 0.35, sz, rotY + Math.PI / 2);
  }
}

// Frysbox (kista) med glaslock, varorna syns ovanifrån. Lokal z = längd.
export function addChestFreezer(C, { x, z, len = 4, rotY = 0, labels, seed = 1 }) {
  const W = 0.95, H = 0.86;
  solid(C, W / 2, H / 2, len / 2, x, H / 2, z, rotY);
  if (!C.B) return;
  const r = rng(seed * 41 + 9);
  const T = (g) => place(g, x, 0, z, rotY);
  const body = rgb(0xf4f6f8);
  C.B.add('gloss', T(box(W, 0.15, len, 0, 0.075, 0)), rgb(0x2d3238));
  for (const s of [-1, 1]) {
    C.B.add('gloss', T(box(0.06, H - 0.15, len, s * (W / 2 - 0.03), 0.15 + (H - 0.15) / 2, 0)), body);
    C.B.add('gloss', T(box(W, H - 0.15, 0.06, 0, 0.15 + (H - 0.15) / 2, s * (len / 2 - 0.03))), body);
    C.B.add('paint', T(box(0.01, 0.1, len, s * (W / 2 + 0.003), H - 0.12, 0)), rgb(0x1e63b5));
  }
  C.B.add('lit', T(box(W - 0.12, 0.02, len - 0.12, 0, 0.45, 0)), rgb(0xe2ecf4));
  C.B.add('glass', T(box(W - 0.1, 0.01, len - 0.1, 0, H - 0.01, 0)), [0.85, 0.93, 1]);
  C.B.add('chrome', T(box(0.03, 0.03, len - 0.06, 0, H, 0)), rgb(0xc7ccd1));
  for (let zz = -len / 2 + 0.25; zz < len / 2 - 0.2; zz += 0.32) {
    for (const xx of [-0.22, 0.22]) {
      const label = labels[Math.floor(r() * labels.length)];
      const S = SHAPES[labelShape(LABEL[label])];
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const [wx, wz] = local(x, z, rotY, xx + (r() - 0.5) * 0.05, zz + (r() - 0.5) * 0.05);
        addProduct(C, LABEL[label], wx, 0.46 + k * (S.h + 0.004), wz, rotY + (r() - 0.5) * 0.4);
      }
    }
  }
}

// Frostig yta (bara grafik); rektangel i världen
export function addFrostFloor(C, { x0, x1, z0, z1, y = 0.003 }) {
  if (!C.B) return;
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / 3, uv.getY(i) * (z1 - z0) / 3);
  g.rotateX(-Math.PI / 2);
  C.B.add('frost', g.translate((x0 + x1) / 2, y, (z0 + z1) / 2), [1, 1, 1]);
}

// Mellanvägg med dörröppning (lokal x längs väggen)
export function addPartition(C, { x0, x1, z, openA, openB, h = 3.2, lintel = 2.35 }) {
  const t = 0.12;
  for (const [a, b] of [[x0, openA], [openB, x1]]) {
    if (b - a < 0.05) continue;
    solid(C, (b - a) / 2, h / 2, t / 2, (a + b) / 2, h / 2, z);
    C.B?.add('gloss', box(b - a, h, t, (a + b) / 2, h / 2, z), rgb(0xeef3f7));
    C.B?.add('paint', box(b - a, 0.25, t + 0.02, (a + b) / 2, 0.125, z), rgb(0x8fa4b8));
  }
  if (!C.B) return;
  C.B.add('gloss', box(openB - openA, h - lintel, t, (openA + openB) / 2, (h + lintel) / 2, z), rgb(0xeef3f7));
  for (const s of [-1, 1]) addSign(C, 'frysrum', 2.2, 0.41, (openA + openB) / 2, lintel + 0.42, z + s * (t / 2 + 0.005), s > 0 ? 0 : Math.PI);
  // Plastridå av remsor ovanför öppningen (bara överkanten, bilarna kör under)
  const n = Math.round((openB - openA) / 0.22);
  for (let i = 0; i < n; i++) {
    const xx = openA + (i + 0.5) * (openB - openA) / n;
    C.B.add('glass', box(0.2, 0.55, 0.004, xx, lintel - 0.27, z), [0.8, 0.95, 1]);
  }
}

// ===========================================================================
// Frukt och grönt
// ===========================================================================

const FRUIT = {
  apple: { r: 0.038, s: [1, 0.92, 1], c: [0xb71c1c, 0xd32f2f, 0x8e1414] },
  green: { r: 0.037, s: [1, 0.92, 1], c: [0x8bc34a, 0x7cb342, 0x9ccc65] },
  orange: { r: 0.041, s: [1, 1, 1], c: [0xfb8c00, 0xf57c00, 0xffa000] },
  lemon: { r: 0.031, s: [1.3, 1, 1], c: [0xfdd835, 0xfbc02d, 0xffeb3b] },
  tomato: { r: 0.034, s: [1, 0.85, 1], c: [0xe53935, 0xd32f2f, 0xf44336] },
  lime: { r: 0.027, s: [1.1, 1, 1], c: [0x558b2f, 0x689f38, 0x4f7a28] },
  potato: { r: 0.036, s: [1.35, 0.8, 1], c: [0xb08b5a, 0xa1795a, 0xc29a6a] },
  melon: { r: 0.095, s: [1.15, 1, 1], c: [0x9ccc65, 0xc5e1a5, 0xaed581] },
  cabbage: { r: 0.08, s: [1, 0.92, 1], c: [0x8bc34a, 0xaed581, 0x9ccc65] },
  bread: { r: 0.06, s: [2.0, 0.85, 1.05], c: [0xc68642, 0xb5733a, 0xd39a55] },
};
export const FRUIT_KINDS = Object.keys(FRUIT);
const FRUIT_CARD = { apple: 'ÄPPLEN', green: 'ÄPPLEN', orange: 'APELSINER', lemon: 'CITRONER', tomato: 'TOMATER', lime: 'LIME', potato: 'POTATIS', melon: 'MELON', cabbage: 'VITKÅL', bread: 'BRÖD' };

function addFruit(C, kind, x, y, z, r) {
  const F = FRUIT[kind];
  const col = F.c[Math.floor(r() * F.c.length)];
  _q.setFromAxisAngle(_up, r() * Math.PI * 2);
  _va.set(x, y, z);
  _vb.set(F.r * F.s[0], F.r * F.s[1], F.r * F.s[2]);
  C.fruit.push({ m: new THREE.Matrix4().compose(_va, _q, _vb), color: col });
}

// Hög med frukt i en låda (lokala mått w x d, botten på y)
function fruitPile(C, r, kind, x, z, rotY, y, w, d) {
  const F = FRUIT[kind];
  const R = F.r * Math.max(...F.s);
  _q.setFromAxisAngle(_up, rotY);
  _va.set(x, y, z); _vb.set(w / 2, F.r * F.s[1] * 3.2, d / 2);
  C.mounds.push({ m: new THREE.Matrix4().compose(_va, _q, _vb), color: F.c[0] });
  const step = R * 1.9;
  // Undre lagret ersätts av högen (som också syns nära), bara översta lagret är frukter
  for (let layer = 1; layer < 2; layer++) {
    const inset = R + layer * step * 0.8;
    for (let u = -w / 2 + inset; u <= w / 2 - inset + 1e-3; u += step) {
      for (let v = -d / 2 + inset; v <= d / 2 - inset + 1e-3; v += step) {
        const [wx, wz] = local(x, z, rotY, u + (r() - 0.5) * R * 0.3 + layer * R * 0.4, v + (r() - 0.5) * R * 0.3);
        addFruit(C, kind, wx, y + F.r * F.s[1] * (1 + layer * 1.55), wz, r);
      }
    }
  }
}

// Trappstegsdisk i trä med lådor av frukt (lokal z = längd, fronten mot +x)
export function addProduceStand(C, { x, z, len = 4.8, rotY = 0, kinds, seed = 1 }) {
  const W = 1.5;
  solid(C, W / 2, 0.45, len / 2, x, 0.45, z, rotY);
  if (!C.B) return;
  const r = rng(seed * 17 + 1);
  const T = (g) => place(g, x, 0, z, rotY);
  const woodC = [1, 1, 1], dark = rgb(0x5d4030);
  // Stomme: front, sidor och två steg
  C.B.add('wood', T(box(0.04, 0.42, len, W / 2 - 0.02, 0.21, 0, 0.6)), woodC);
  for (const s of [-1, 1]) C.B.add('wood', T(box(W, 0.68, 0.04, 0, 0.34, s * (len / 2 - 0.02), 0.6)), woodC);
  C.B.add('wood', T(box(W / 2, 0.04, len, W / 4, 0.42, 0, 0.6)), woodC);
  C.B.add('wood', T(box(0.04, 0.68, len, 0, 0.34, 0, 0.6)), woodC);
  C.B.add('wood', T(box(W / 2, 0.04, len, -W / 4, 0.66, 0, 0.6)), woodC);
  C.B.add('wood', T(box(0.04, 0.9, len, -W / 2 + 0.02, 0.45, 0, 0.6)), woodC);
  C.B.add('paint', T(box(0.02, 0.1, len, W / 2 + 0.002, 0.06, 0)), dark);
  // Lådor på båda stegen
  const crates = Math.max(1, Math.floor(len / 0.6));
  const cl = len / crates;
  let ki = 0;
  for (const [cx, cy] of [[W / 4, 0.44], [-W / 4, 0.68]]) {
    for (let i = 0; i < crates; i++) {
      const cz = -len / 2 + (i + 0.5) * cl;
      const cw = W / 2 - 0.08, cd = cl - 0.06, ch = 0.14;
      // Låda av spjälor
      for (const s of [-1, 1]) {
        C.B.add('wood', T(box(cw, ch, 0.015, cx, cy + ch / 2, cz + s * (cd / 2 - 0.008), 0.5)), [0.9, 0.85, 0.8]);
        C.B.add('wood', T(box(0.015, ch, cd, cx + s * (cw / 2 - 0.008), cy + ch / 2, cz, 0.5)), [0.9, 0.85, 0.8]);
      }
      const kind = kinds[ki++ % kinds.length];
      const [wx, wz] = local(x, z, rotY, cx, cz);
      fruitPile(C, r, kind, wx, wz, rotY, cy + 0.01, cw - 0.04, cd - 0.04);
      if (cx > 0 && i % 2 === 0) {
        const [px, pz] = local(x, z, rotY, W / 2 + 0.02, cz);
        addSign(C, 'f_' + FRUIT_CARD[kind], 0.3, 0.15, px, 0.3, pz, rotY + Math.PI / 2);
      }
    }
  }
}

// Brödhylla (trä) med limpor
export function addBreadRack(C, { x, z, len = 3.6, rotY = 0, seed = 1 }) {
  const D = 0.6, H = 1.8;
  solid(C, D / 2, H / 2, len / 2, x, H / 2, z, rotY);
  if (!C.B) return;
  const r = rng(seed * 5 + 11);
  const T = (g) => place(g, x, 0, z, rotY);
  C.B.add('wood', T(box(0.04, H, len, -D / 2 + 0.02, H / 2, 0, 0.6)), [1, 1, 1]);
  for (const s of [-1, 1]) C.B.add('wood', T(box(D, H, 0.04, 0, H / 2, s * (len / 2 - 0.02), 0.6)), [1, 1, 1]);
  for (const y of [0.15, 0.55, 0.95, 1.35]) {
    C.B.add('wood', T(box(D, 0.03, len, 0, y, 0, 0.6)), [0.92, 0.88, 0.84]);
    for (let zz = -len / 2 + 0.16; zz < len / 2 - 0.12; zz += 0.24) {
      const [wx, wz] = local(x, z, rotY, 0.05 + (r() - 0.5) * 0.06, zz);
      _q.setFromAxisAngle(_up, rotY + Math.PI / 2 + (r() - 0.5) * 0.3);
      _va.set(wx, y + 0.065, wz);
      const F = FRUIT.bread;
      _vb.set(F.r * F.s[0], F.r * F.s[1], F.r * F.s[2]);
      const loaf = { m: new THREE.Matrix4().compose(_va, _q, _vb), color: F.c[Math.floor(r() * 3)], loaf: true };
      C.fruit.push(loaf);
      C.mounds.push(loaf);
    }
  }
}

// ===========================================================================
// Kassor, kundvagnar och korgar
// ===========================================================================

/** Kassadisk längs lokal z (kunden kommer från -z). */
export function addCheckout(C, { x, z, rotY = 0, num = 1, seed = 1 }) {
  const L = 3.6, W = 0.72, H = 0.86;
  solid(C, W / 2, H / 2, L / 2, x, H / 2, z, rotY);
  solid(C, 0.35, 0.6, 0.3, ...(() => { const [a, b] = local(x, z, rotY, 0.75, 0.55); return [a, 0.6, b]; })(), rotY);
  if (!C.B) return;
  const r = rng(seed * 7 + 2);
  const T = (g) => place(g, x, 0, z, rotY);
  const body = rgb(0xe9ecef), accent = rgb(0xc62828), steel = rgb(0xc4c9ce);
  C.B.add('gloss', T(box(W, H - 0.06, L, 0, (H - 0.06) / 2, 0)), body);
  C.B.add('gloss', T(box(W + 0.01, 0.1, L + 0.01, 0, 0.55, 0)), accent);
  C.B.add('rubber', T(box(W - 0.16, 0.02, 1.9, 0, H - 0.05, -0.75)), rgb(0x1c1d1f)); // band
  for (const s of [-1, 1]) C.B.add('chrome', T(box(0.05, 0.05, 1.95, s * (W / 2 - 0.04), H - 0.035, -0.75)), steel);
  C.B.add('metal', T(box(W, 0.04, 1.2, 0, H - 0.04, 1.15)), steel); // packbord
  C.B.add('chrome', T(box(0.02, 0.12, 1.1, 0, H + 0.02, 1.15)), steel); // delare
  // Kassaapparat, skärm och kortterminal
  C.B.add('gloss', T(box(0.36, 0.14, 0.32, 0.15, H + 0.07, 0.42)), rgb(0x2b2e33));
  C.B.add('gloss', T(box(0.04, 0.28, 0.04, 0.15, H + 0.28, 0.3)), rgb(0x2b2e33));
  const scr = box(0.26, 0.2, 0.025, 0, 0, 0); scr.rotateX(-0.25); scr.rotateY(-Math.PI / 2 + 0.4);
  C.B.add('lit', T(scr.translate(0.15, H + 0.45, 0.3)), rgb(0x203a5a));
  C.B.add('gloss', T(box(0.09, 0.03, 0.16, -0.22, H + 0.02, 0.2)), rgb(0x333333));
  // Kassörskans stol och ryggskydd
  C.B.add('gloss', T(box(0.55, 1.1, 0.04, 0.75, 0.55, 0.85)), rgb(0xd6dadf));
  C.B.add('gloss', T(box(0.36, 0.06, 0.36, 0.72, 0.6, 0.45)), rgb(0x2b2e33));
  C.B.add('chrome', T(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8).translate(0.72, 0.3, 0.45)), steel);
  // Godishylla vid bandets början
  C.B.add('metal', T(box(0.4, 1.3, 0.5, -0.6, 0.65, -1.4)), rgb(0xd7262e));
  for (const y of [0.35, 0.7, 1.05]) {
    for (let k = 0; k < 3; k++) {
      const lab = ['KEX', 'TE', 'SKUMMIS'][Math.floor(r() * 3)];
      const [wx, wz] = local(x, z, rotY, -0.42, -1.55 + k * 0.15);
      addProduct(C, LABEL[lab], wx, y, wz, rotY + Math.PI / 2);
    }
  }
  // Kassaskylt på stolpe
  const [px, pz] = local(x, z, rotY, -W / 2 + 0.06, -L / 2 + 0.1);
  C.B.add('chrome', rod(px, H, pz, px, 2.2, pz, 0.018, 8), steel);
  C.B.add('paint', place(box(0.34, 0.34, 0.06, 0, 2.35, 0), px, 0, pz, rotY), rgb(0x1b6e33));
  for (const s of [1, -1]) {
    const [qx, qz] = local(px, pz, rotY, 0, s * 0.032);
    addSign(C, 'k' + num, 0.3, 0.3, qx, 2.35, qz, rotY + (s > 0 ? 0 : Math.PI));
  }
}

// Kundvagn av tunna stänger (lokal z framåt)
export function addTrolley(C, { x, z, rotY = 0, collide = true }) {
  if (collide) solid(C, 0.3, 0.5, 0.48, x, 0.5, z, rotY);
  if (!C.B) return;
  const g = [];
  const R = 0.0045;
  const bot = { y: 0.48, x: 0.2, z0: -0.38, z1: 0.42 }, top = { y: 0.95, x: 0.27, z0: -0.46, z1: 0.48 };
  const lerp = (a, b, t) => a + (b - a) * t;
  // Stående trådar runt om
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    for (const s of [-1, 1]) g.push(rod(s * bot.x, bot.y, lerp(bot.z0, bot.z1, t), s * top.x, top.y, lerp(top.z0, top.z1, t), R, 4));
  }
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    g.push(rod(lerp(-bot.x, bot.x, t), bot.y, bot.z1, lerp(-top.x, top.x, t), top.y, top.z1, R, 4));
    g.push(rod(lerp(-bot.x, bot.x, t), bot.y, bot.z0, lerp(-top.x, top.x, t), top.y, top.z0, R, 4));
  }
  // Ringar
  for (const t of [0, 0.35, 0.7, 1]) {
    const y = lerp(bot.y, top.y, t), xx = lerp(bot.x, top.x, t), z0 = lerp(bot.z0, top.z0, t), z1 = lerp(bot.z1, top.z1, t);
    const Rr = t === 1 ? R * 2 : R;
    g.push(rod(-xx, y, z0, xx, y, z0, Rr, 4), rod(-xx, y, z1, xx, y, z1, Rr, 4), rod(-xx, y, z0, -xx, y, z1, Rr, 4), rod(xx, y, z0, xx, y, z1, Rr, 4));
  }
  for (let i = 0; i <= 6; i++) g.push(rod(lerp(-bot.x, bot.x, i / 6), bot.y, bot.z0, lerp(-bot.x, bot.x, i / 6), bot.y, bot.z1, R, 4));
  // Chassi: bakre stolpar, underrede och nedre hylla
  for (const s of [-1, 1]) {
    g.push(rod(s * 0.24, 0.1, -0.42, s * top.x, 1.02, top.z0 - 0.06, R * 2.6, 6));
    g.push(rod(s * 0.24, 0.1, -0.42, s * 0.18, 0.1, 0.4, R * 2.6, 6));
    g.push(rod(s * 0.18, 0.1, 0.4, s * 0.19, bot.y, 0.38, R * 2, 5));
  }
  for (let i = 0; i <= 5; i++) g.push(rod(lerp(-0.2, 0.2, i / 5), 0.16, -0.36, lerp(-0.16, 0.16, i / 5), 0.16, 0.36, R, 4));
  const wire = mergeGeometries(g.map((q) => q.index ? q.toNonIndexed() : q));
  C.B.add('chrome', place(wire, x, 0, z, rotY), rgb(0xd2d6da));
  // Handtag och hjul
  C.B.add('gloss', place(new THREE.CylinderGeometry(0.017, 0.017, 0.58, 8).rotateZ(Math.PI / 2).translate(0, 1.02, top.z0 - 0.06), x, 0, z, rotY), rgb(0xd7262e));
  C.B.add('gloss', place(box(0.5, 0.12, 0.012, 0, 0.88, top.z0 - 0.005), x, 0, z, rotY), rgb(0xd7262e));
  for (const [wx, wz] of [[-0.22, -0.4], [0.22, -0.4], [-0.17, 0.38], [0.17, 0.38]]) {
    C.B.add('rubber', place(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10).rotateZ(Math.PI / 2).translate(wx, 0.05, wz), x, 0, z, rotY), rgb(0x222222));
  }
}

// Trave med plastkorgar
export function addBasketStack(C, { x, z, rotY = 0, n = 6, color = 0xd7262e }) {
  const w = 0.44, d = 0.32, h = 0.22;
  solid(C, w / 2, (h + n * 0.06) / 2, d / 2, x, (h + n * 0.06) / 2, z, rotY);
  if (!C.B) return;
  const col = rgb(color);
  for (let i = 0; i < n; i++) {
    const y = i * 0.06;
    const k = 1 - i * 0.004;
    C.B.add('gloss', place(box(w * k, 0.012, d * k, 0, y + 0.006, 0), x, 0, z, rotY), col);
    for (const s of [-1, 1]) {
      C.B.add('gloss', place(box(w * k, h, 0.012, 0, y + h / 2, s * d * k / 2), x, 0, z, rotY), col);
      C.B.add('gloss', place(box(0.012, h, d * k, s * w * k / 2, y + h / 2, 0), x, 0, z, rotY), col);
    }
  }
  const yt = (n - 1) * 0.06 + h;
  for (const s of [-1, 1]) C.B.add('gloss', place(new THREE.TorusGeometry(0.14, 0.008, 5, 12, Math.PI).translate(0, yt, s * 0.04), x, 0, z, rotY), rgb(0x2b2e33));
}

// Varningsskylt för vått golv (A-ram)
export function addWetFloorSign(C, { x, z, rotY = 0 }) {
  solid(C, 0.17, 0.32, 0.17, x, 0.32, z, rotY);
  if (!C.B) return;
  const H = 0.64, a = 0.2;
  for (const s of [-1, 1]) {
    const panel = box(0.3, H, 0.012, 0, H / 2, 0);
    panel.rotateX(s * a); panel.translate(0, 0, s * 0.065);
    C.B.add('gloss', place(panel, x, 0, z, rotY), rgb(0xffd000));
    const face = atlasPlane(0.26, 0.4, signCell('wet'));
    if (s < 0) face.rotateY(Math.PI);
    face.translate(0, 0.36, s * 0.007);
    face.rotateX(s * a); face.translate(0, 0, s * 0.065);
    C.B.add('signs', place(face, x, 0, z, rotY));
  }
}

// ===========================================================================
// Lastkajen: kaj, rulldörrar, pallar och kartonger
// ===========================================================================

export function addDock(C, { x0, x1, z0, z1, h }) {
  solid(C, (x1 - x0) / 2, h / 2, (z1 - z0) / 2, (x0 + x1) / 2, h / 2, (z0 + z1) / 2);
  if (!C.B) return;
  C.B.add('concrete', box(x1 - x0, h, z1 - z0, (x0 + x1) / 2, h / 2, (z0 + z1) / 2, 2), [1, 1, 1]);
  // Varningsrand längs kanterna och gummibuffertar
  C.B.add('hazard', box(x1 - x0, 0.12, 0.01, (x0 + x1) / 2, h - 0.06, z0 - 0.005, 0.4), [1, 1, 1]);
  for (const s of [-1, 1]) {
    const xe = s < 0 ? x0 : x1;
    C.B.add('hazard', box(0.01, 0.12, z1 - z0, xe + s * 0.005, h - 0.06, (z0 + z1) / 2, 0.4), [1, 1, 1]);
  }
  for (let x = x0 + 0.8; x < x1 - 0.5; x += 1.6) C.B.add('rubber', box(0.25, 0.3, 0.1, x, h * 0.5, z0 - 0.05), rgb(0x1c1c1c));
}

// Betonggolv (bara grafik), t.ex. i lastkajens zon
export function addConcreteFloor(C, { x0, x1, z0, z1, y = 0.002 }) {
  if (!C.B) return;
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / 2, uv.getY(i) * (z1 - z0) / 2);
  g.rotateX(-Math.PI / 2);
  C.B.add('concrete', g.translate((x0 + x1) / 2, y, (z0 + z1) / 2), [0.92, 0.92, 0.9]);
}

// Kampanjaffisch på vägg (lokal +z ut från väggen)
export function addPoster(C, { x, y = 3.6, z, rotY = 0, promo, size = 1.6 }) {
  if (!C.B) return;
  C.B.add('paint', place(box(size + 0.12, size + 0.12, 0.03, 0, y, 0.015), x, 0, z, rotY), rgb(0xffffff));
  const [px, pz] = local(x, z, rotY, 0, 0.032);
  addSign(C, 'p_' + promo, size, size, px, y, pz, rotY);
}

export function addRollerDoor(C, { x, z, w = 3.6, h = 3.4, rotY = 0, label = 'dock1' }) {
  if (!C.B) return;
  const T = (g) => place(g, x, 0, z, rotY);
  const g = box(w, h, 0.04, 0, h / 2, 0.02, 1);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * 10);
  C.B.add('door', T(g), [1, 1, 1]);
  C.B.add('paint', T(box(w + 0.3, 0.45, 0.4, 0, h + 0.22, 0.2)), rgb(0x8a9097)); // rullkåpa
  for (const s of [-1, 1]) C.B.add('hazard', T(box(0.15, h, 0.15, s * (w / 2 + 0.08), h / 2, 0.08, 0.4)), [1, 1, 1]);
  C.B.add('rubber', T(box(w, 0.06, 0.06, 0, 0.03, 0.05)), rgb(0x1c1c1c));
  addSign(C, label, 0.9, 0.34, ...(() => { const [a, b] = local(x, z, rotY, 0, 0.42); return [a, h + 0.22, b]; })(), rotY);
}

const PAL = { w: 1.2, h: 0.144, d: 0.8 };
/** Pall med last: 'boxes', 'water' eller 'cans'. */
export function addPallet(C, { x, z, y = 0, rotY = 0, load = null, layers = 3, seed = 1 }) {
  const loadH = load === 'boxes' ? layers * 0.3 : load === 'water' ? layers * 0.31 : load === 'cans' ? layers * 0.13 : 0;
  solid(C, PAL.w / 2, (PAL.h + loadH) / 2, PAL.d / 2, x, y + (PAL.h + loadH) / 2, z, rotY, 0.9);
  if (!C.B) return;
  const r = rng(seed * 13 + 5);
  const T = (g) => place(g, x, y, z, rotY);
  const tb = 0.022, blk = 0.078;
  for (const sz of [-1, 0, 1]) C.B.add('wood', T(box(PAL.w, tb, 0.1, 0, tb / 2, sz * (PAL.d / 2 - 0.05), 0.5)), [0.95, 0.9, 0.85]);
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) C.B.add('wood', T(box(0.14, blk, 0.1, sx * (PAL.w / 2 - 0.07), tb + blk / 2, sz * (PAL.d / 2 - 0.05), 0.5)), [0.8, 0.72, 0.62]);
  for (const pz of [-0.35, -0.18, 0, 0.18, 0.35]) C.B.add('wood', T(box(PAL.w, tb, 0.1, 0, PAL.h - tb / 2, pz, 0.5)), [0.95, 0.9, 0.85]);
  if (load === 'boxes') {
    for (let l = 0; l < layers; l++) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      if (l === layers - 1 && r() < 0.25) continue;
      const k = 0.9 + r() * 0.15;
      C.B.add('kraft', T(box(0.38, 0.29, 0.38, -0.4 + i * 0.4, PAL.h + l * 0.3 + 0.145, -0.2 + j * 0.4, 0.4)), [k, k * 0.98, k * 0.95]);
    }
  } else if (load === 'water' || load === 'cans') {
    const lab = load === 'water' ? LABEL.VATTEN : LABEL.SKUMMIS;
    const S = SHAPES[labelShape(lab)];
    const sp = S.fw + 0.004, nx = Math.floor(PAL.w / sp), nz = Math.floor(PAL.d / sp);
    for (let l = 0; l < layers; l++) {
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const [wx, wz] = local(x, z, rotY, -((nx - 1) * sp) / 2 + i * sp, -((nz - 1) * sp) / 2 + j * sp);
        addProduct(C, lab, wx, y + PAL.h + l * (S.h + 0.008), wz, rotY + (j === 0 ? Math.PI : 0));
      }
      C.B.add('glass', T(box(nx * sp, 0.006, nz * sp, 0, PAL.h + (l + 1) * (S.h + 0.008) - 0.004, 0)), [0.9, 0.95, 1]); // mellanark
    }
  }
}

// Pallyftare (handtruck)
export function addPalletJack(C, { x, z, rotY = 0 }) {
  solid(C, 0.3, 0.12, 0.7, x, 0.12, z, rotY);
  if (!C.B) return;
  const T = (g) => place(g, x, 0, z, rotY);
  const red = rgb(0xd84315);
  for (const s of [-1, 1]) C.B.add('gloss', T(box(0.16, 0.07, 1.15, s * 0.19, 0.06, 0.2)), red);
  C.B.add('gloss', T(box(0.55, 0.3, 0.2, 0, 0.18, -0.45)), red);
  C.B.add('chrome', T(rod(0, 0.3, -0.5, 0, 1.15, -0.75, 0.018, 6)), rgb(0x3a3d42));
  C.B.add('gloss', T(new THREE.TorusGeometry(0.1, 0.018, 6, 12).translate(0, 1.2, -0.78)), rgb(0x1c1c1c));
}

// Statisk pyramid av läskburkar (instansierad) – kampanjdisplay
export function addCanPyramid(C, { x, z, levels = 9, label = 'SKUMMIS', rotY = 0 }) {
  const S = SHAPES[labelShape(LABEL[label])];
  const sp = S.fw + 0.003;
  const half = (levels * sp) / 2;
  solid(C, half, (levels * S.h) / 4, half, x, (levels * S.h) / 4, z, rotY);
  solid(C, half / 2, (levels * S.h) / 4, half / 2, x, (levels * S.h) * 0.75, z, rotY);
  if (!C.B) return;
  for (let l = 0; l < levels; l++) {
    const n = levels - l;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const [wx, wz] = local(x, z, rotY, -((n - 1) * sp) / 2 + i * sp, -((n - 1) * sp) / 2 + j * sp);
      addProduct(C, LABEL[label], wx, l * (S.h + 0.002), wz, rotY);
    }
  }
}

// Banderoll över banan mellan två stolpar (lokal x tvärs banan)
export function addBanner(C, { x, z, rotY = 0, span = 4.4, y = 1.9 }) {
  for (const s of [-1, 1]) {
    const [px, pz] = local(x, z, rotY, s * span / 2, 0);
    solid(C, 0.03, (y + 0.3) / 2, 0.03, px, (y + 0.3) / 2, pz);
  }
  if (!C.B) return;
  for (const s of [-1, 1]) {
    const [px, pz] = local(x, z, rotY, s * span / 2, 0);
    C.B.add('chrome', rod(px, 0, pz, px, y + 0.3, pz, 0.03, 8), rgb(0xc4c9ce));
    C.B.add('rubber', new THREE.CylinderGeometry(0.15, 0.17, 0.04, 12).translate(px, 0.02, pz), rgb(0x2b2e33));
  }
  addSign(C, 'banner', span - 0.1, (span - 0.1) * 128 / 1024, x, y, z, rotY, true);
}

// ===========================================================================
// Lösa läskburkar: dynamiska kroppar som bilarna kan välta
// ===========================================================================

export function addLooseCan(C, { x, y, z, label = 'SKUMMIS', mass = 0.05 }) {
  const S = SHAPES.can;
  const spawn = { x, y: y + S.h / 2, z };
  let body = null, mesh = null;
  if (C.world) {
    body = C.world.createRigidBody(C.RAPIER.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y, spawn.z).setLinearDamping(0.2).setAngularDamping(0.4).setCanSleep(true));
    C.world.createCollider(
      C.RAPIER.ColliderDesc.cylinder(S.h / 2, S.r).setDensity(0).setMass(mass).setFriction(0.5).setRestitution(0.25).setCollisionGroups(groups(G.PROP)),
      body
    );
  }
  if (C.scene) {
    const geo = shapeGeometry('can').clone();
    geo.translate(0, -S.h / 2, 0); // kroppens mitt
    const n = geo.attributes.position.count, [u, v] = cellOffset(LABEL[label]);
    const cells = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { cells[i * 2] = u; cells[i * 2 + 1] = v; }
    geo.setAttribute('aCell', new THREE.BufferAttribute(cells, 2));
    mesh = new THREE.Mesh(geo, productMaterial());
    mesh.position.set(spawn.x, spawn.y, spawn.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    C.scene.add(mesh);
  }
  return { body, mesh, kind: 'can', spawn };
}

// ===========================================================================

export function flushMarket(C) {
  if (!C.B) return;
  C.B.flush(C.scene);
  flushInstanced(C);
}

// ===========================================================================
// Startportalen, backstaplar och frysrummets tak
// ===========================================================================

/**
 * "STORT ÖPPNANDE": ballongvalv över banan med banderoll. Lokal x tvärs
 * banan (span), rotY vrider. Pelarna står utanför vallarna.
 */
export function addOpeningArch(C, { x, z, rotY = 0, span = 4.4, h = 2.5 }) {
  for (const s of [-1, 1]) {
    const [px, pz] = local(x, z, rotY, s * span / 2, 0);
    solid(C, 0.24, h / 2, 0.24, px, h / 2, pz);
  }
  if (!C.B) return;
  const cols = [0xd7262e, 0xffd23f, 0xf4f4f4, 0x1e63b5];
  const ball = cached('balloonGeo', () => new THREE.SphereGeometry(0.17, 8, 6).scale(1, 1.15, 1));
  const balloon = (lx, y, lz, k) => {
    const [bx, bz] = local(x, z, rotY, lx, lz);
    C.B.add('gloss', place(ball.clone(), bx, y, bz), rgb(cols[k % cols.length]));
  };
  // Pelare: fyra ballonger per varv runt en stång, varven vridna
  for (const s of [-1, 1]) {
    const [px, pz] = local(x, z, rotY, s * span / 2, 0);
    C.B.add('rubber', new THREE.CylinderGeometry(0.28, 0.32, 0.12, 12).translate(px, 0.06, pz), rgb(0x2b2e33));
    C.B.add('chrome', rod(px, 0, pz, px, h, pz, 0.025, 6), rgb(0xc4c9ce));
    let k = s > 0 ? 1 : 0;
    for (let y = 0.3; y < h - 0.05; y += 0.3) {
      const a0 = y * 2.2;
      for (let i = 0; i < 4; i++) {
        const a = a0 + (i / 4) * Math.PI * 2;
        balloon(s * span / 2 + Math.cos(a) * 0.17, y, Math.sin(a) * 0.17, k++);
      }
    }
  }
  // Valvet: ballonger i en båge över banan
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = Math.PI * t;
    const lx = -Math.cos(a) * span / 2, y = h + Math.sin(a) * 0.9;
    balloon(lx, y, 0.12, i);
    balloon(lx, y + 0.05, -0.12, i + 2);
  }
  // Banderoll mellan pelarna
  const bw = span - 0.6;
  addSign(C, 'opening', bw, bw * 160 / 1016, x, h - 0.15, z, rotY, true);
  // Ballongknippen på snören ovanför pelarna
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    balloon(s * span / 2 + Math.cos(a) * 0.25, h + 0.45 + i * 0.12, Math.sin(a) * 0.25, i + (s > 0 ? 2 : 0));
  }
}

/** Stapel av plastbackar (bröd- och fruktbackar) med kollision. */
export function addCrateStack(C, { x, z, rotY = 0, layers = 3, color = 0x1e63b5, seed = 1 }) {
  const W = 0.6, D = 0.4, H = 0.26;
  solid(C, W / 2, (layers * H) / 2, D / 2, x, (layers * H) / 2, z, rotY, 0.6);
  if (!C.B) return;
  const r = rng(seed);
  const col = rgb(color), dark = rgb(new THREE.Color(color).multiplyScalar(0.7).getHex());
  for (let l = 0; l < layers; l++) {
    const off = (r() - 0.5) * 0.04, rot = rotY + (r() - 0.5) * 0.08;
    const y = l * H;
    const T = (g) => place(g, x + off, y, z - off, rot);
    for (const s of [-1, 1]) {
      C.B.add('gloss', T(box(W, H - 0.02, 0.025, 0, H / 2, s * (D / 2 - 0.0125))), col);
      C.B.add('gloss', T(box(0.025, H - 0.02, D, s * (W / 2 - 0.0125), H / 2, 0)), col);
    }
    C.B.add('gloss', T(box(W - 0.04, 0.02, D - 0.04, 0, 0.02, 0)), dark);
    // Handtagshål
    for (const s of [-1, 1]) C.B.add('rubber', T(box(0.03, 0.05, 0.16, s * (W / 2 + 0.001), H - 0.07, 0)), rgb(0x1a1a1a));
  }
}

/** Lågt undertak (frysrummet): plattor, lysrör och ett kallt sken. */
export function addLowCeiling(C, { x0, x1, z0, z1, y = 2.6 }) {
  if (!C.B) return;
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const g = new THREE.PlaneGeometry(W, D);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 1.2, uv.getY(i) * D / 1.2);
  g.rotateX(Math.PI / 2);
  C.B.add('ceiling', g.translate(cx, y, cz), [0.82, 0.9, 1]);
  C.B.add('gloss', box(W, 0.12, D, cx, y + 0.06, cz), rgb(0xdfe6ec));
  for (let z = z0 + 1.6; z < z1 - 1; z += 2.4) {
    for (const x of [x0 + W * 0.3, x0 + W * 0.72]) {
      C.B.add('light', box(0.14, 0.03, 1.5, x, y - 0.02, z), [0.85, 0.95, 1.0]);
      C.B.add('metal', box(0.22, 0.05, 1.6, x, y - 0.005, z), rgb(0xdfe2e5));
    }
  }
}
