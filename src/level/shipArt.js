import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G, groups } from '../core/physics.js';
import { rng } from './warehouseArt.js';
import { bankY } from '../track/track.js';

// ---------------------------------------------------------------------------
// Procedurell grafik för kryssningsfartyget: lackat plankdäck, skrov,
// vit överbyggnad med ventiler, skorstenar, livbåtar i dävertar, reling,
// solstolar, livbojar, pollare och ett animerat hav runt omkring.
//
// Fartyget ligger längs x (fören mot +x), huvuddäcket på y = 0, havet långt
// under. Som i warehouseArt: utan scene byggs bara fysiken, utan world bara
// grafiken. Texturer och material cachas på modulnivå.
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

// Skrovets mått i meter
export const SHIP = {
  W: 17,          // halva bredden midskepps
  bow0: 28,       // här börjar fören smalna
  tip: 76,        // förstäven
  stern0: -50,    // här börjar den rundade aktern
  sternLen: 10,   // aktern når x = -60
  sunX: -44,      // akterdäckets framkant
  sunY: 1.0,      // akterdäckets höjd
  seaY: -8,       // havsytan
  keelY: -9.6,    // skrovet går ner under ytan
};

// Halva bredden på däcket vid x
export function halfWidth(x) {
  const { W, bow0, tip, stern0, sternLen } = SHIP;
  if (x >= tip || x <= stern0 - sternLen) return 0;
  if (x >= bow0) return W * (1 - ((x - bow0) / (tip - bow0)) ** 2);
  if (x >= stern0) return W;
  return W * Math.sqrt(Math.max(0, 1 - ((x - stern0) / sternLen) ** 2));
}

// x-värden från a till b, tätare där konturen kröker
function xSamples(a, b) {
  const xs = [];
  const n = Math.max(2, Math.ceil(Math.abs(b - a) / 2));
  for (let i = 0; i <= n; i++) xs.push(a + (b - a) * (i / n));
  return xs;
}

// Kontur (öppen) längs skrovkanten: styrbord från x0 till x1 (en stäv),
// babord tillbaka. Tätare punkter nära ändarna där konturen kröker.
export function hullEdge(x0, x1) {
  const d = x1 - x0;
  const xs = xSamples(x0, x1);
  for (const f of [0.004, 0.015, 0.04, 0.96, 0.985, 0.996]) xs.push(x0 + d * f);
  xs.sort((a, b) => (a - b) * Math.sign(d));
  const u = xs.filter((x, i) => i === 0 || Math.abs(x - xs[i - 1]) > 0.02);
  const pts = u.map((x) => [x, -halfWidth(x)]);
  for (let i = u.length - 2; i >= 0; i--) pts.push([u[i], halfWidth(u[i])]);
  return pts;
}

// Förskjuter en polylinje längs sin normal (+ = utåt från fartygets mitt)
export function offsetPolyline(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b[1] - a[1]), nz = b[0] - a[0];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    if (nx * (p[0] - 8) + nz * p[1] < 0) { nx = -nx; nz = -nz; }
    return [p[0] + nx * d, p[1] + nz * d, nx, nz];
  });
}

const yQuat = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

function fixedBody(world, RAPIER) {
  return world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
}

function box(world, body, RAPIER, hx, hy, hz, x, y, z, rotY = 0, friction = 0.6) {
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(yQuat(rotY))
      .setFriction(friction).setRestitution(0.15).setCollisionGroups(groups(G.WORLD)),
    body
  );
}

// Konvext prisma: kontur [[x,z]] mellan y0 och y1
function prism(world, body, RAPIER, outline, y0, y1, friction = 1) {
  const p = new Float32Array(outline.length * 6);
  outline.forEach(([x, z], i) => { p.set([x, y0, z, x, y1, z], i * 6); });
  const desc = RAPIER.ColliderDesc.convexHull(p);
  if (desc) world.createCollider(desc.setFriction(friction).setCollisionGroups(groups(G.WORLD)), body);
}

// --- canvas- och geometrihjälp ---------------------------------------------

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

const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const _c = new THREE.Color();

// Färgar en geometri och gör den sammanslagningsbar (bara position, normal, färg).
// Utan färg behålls geometrins egna vertexfärger.
function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(k === 'color' && color == null)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (color == null) return g;
  _c.set(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Samlar färgade delar till en mesh (ett ritanrop)
function batch() {
  const geos = [];
  return {
    add(geo, color) { geos.push(paint(geo, color)); return geo; },
    box(w, h, d, x, y, z, color, rotY = 0) {
      const g = new THREE.BoxGeometry(w, h, d);
      if (rotY) g.rotateY(rotY);
      g.translate(x, y, z);
      return this.add(g, color);
    },
    // Låda mellan två punkter (räcken, linor, balkar)
    beam(a, b, w, h, color) {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      const g = new THREE.BoxGeometry(w, h, len);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx / len, dy / len, dz / len));
      g.applyQuaternion(q);
      g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      return this.add(g, color);
    },
    mesh(scene, material, { cast = true } = {}) {
      if (!geos.length) return null;
      const m = new THREE.Mesh(mergeGeometries(geos), material);
      m.castShadow = cast;
      m.receiveShadow = true;
      scene.add(m);
      return m;
    },
  };
}

function paintMat(rough = 0.5, metal = 0) {
  return cached(`paint_${rough}_${metal}`, () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, side: THREE.DoubleSide }));
}

// Vertikal vägg längs en kontur med uv i meter (u längs väggen, v uppåt)
function wallGeometry(outline, y0, h, tileW, closed = true) {
  const pos = [], uv = [];
  let u = 0;
  const n = closed ? outline.length : outline.length - 1;
  for (let i = 0; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u0 = u / tileW, u1 = (u + len) / tileW;
    pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y0 + h, b[1], a[0], y0, a[1], b[0], y0 + h, b[1], a[0], y0 + h, a[1]);
    uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
    u += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Plan yta (kontur [[x,z]] med ev. hål) på höjden y, uv i världsmeter / tile
function flatGeometry(outline, y, tile, holes = []) {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
  return g;
}

const centroid = (pts) => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);

// ===========================================================================
// Havet: stort plan som följer kameran, vågor i vertexshadern, fresnel och
// solglitter i fragmentshadern. Tonar mot horisontens färg på avstånd.
// ===========================================================================

const SEA_VERT = /* glsl */ `
uniform float uTime;
varying vec3 vW;
varying vec3 vN;
varying float vH;
// Riktad sinusvåg (djupvatten: vinkelfart ur våglängden)
void wave(vec2 p, vec2 dir, float len, float amp, inout float h, inout vec2 d) {
  float k = 6.2832 / len;
  float w = sqrt(9.8 * k);
  float ph = k * dot(normalize(dir), p) - w * uTime;
  h += amp * sin(ph);
  d += amp * k * normalize(dir) * cos(ph);
}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec2 p = w.xz + vec2(uTime * 2.4, 0.0); // fartyget går framåt: havet glider akterut
  float h = 0.0; vec2 d = vec2(0.0);
  wave(p, vec2(0.9, 0.45), 31.0, 0.42, h, d);
  wave(p, vec2(0.3, 1.0), 19.0, 0.24, h, d);
  wave(p, vec2(-0.7, 0.6), 13.0, 0.14, h, d);
  wave(p, vec2(1.0, -0.35), 9.0, 0.08, h, d);
  wave(p, vec2(-0.2, -1.0), 6.5, 0.05, h, d);
  w.y += h;
  vH = h;
  vN = normalize(vec3(-d.x, 1.0, -d.y));
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SEA_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep, uMid, uSky, uHorizon, uSunDir, uSunCol;
uniform float uFadeNear, uFadeFar;
varying vec3 vW;
varying vec3 vN;
varying float vH;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  // Småkrusningar ovanpå de stora vågorna
  vec2 q = vW.xz + vec2(uTime * 2.4, 0.0);
  vec3 N = normalize(vN + vec3(
    0.06 * sin(q.x * 1.9 + q.y * 0.7 - uTime * 2.1) + 0.04 * sin(q.x * 4.1 - q.y * 2.3 + uTime * 3.0),
    0.0,
    0.06 * sin(q.y * 1.7 - q.x * 0.9 + uTime * 1.7) + 0.04 * sin(q.y * 3.7 + q.x * 2.9 - uTime * 2.6)));
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uSky, clamp(R.y * 1.8, 0.0, 1.0));
  vec3 water = mix(uDeep, uMid, clamp(vH * 0.8 + 0.45, 0.0, 1.0));
  vec3 col = mix(water, sky, clamp(fres, 0.0, 0.9));
  float sun = pow(max(dot(R, uSunDir), 0.0), 220.0);
  col += uSunCol * (sun * 1.6 + pow(max(dot(R, uSunDir), 0.0), 18.0) * 0.12);
  // Skumtoppar
  float br = sin(q.x * 0.37 + q.y * 0.21) * sin(q.y * 0.29 - q.x * 0.13 + uTime * 0.4);
  float foam = smoothstep(0.62, 0.85, vH + 0.18 * br + 0.05 * sin(q.x * 3.1 + q.y * 2.2));
  col = mix(col, vec3(0.9, 0.95, 0.98), foam * 0.3);
  float dist = length(vW.xz - cameraPosition.xz);
  col = mix(col, uHorizon, smoothstep(uFadeNear, uFadeFar, dist));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeSea(scene, { sunDir = [0.5, 0.75, 0.35], horizon = '#cfe5f2', sky = '#7fb6e3' } = {}) {
  if (!scene) return null;
  const SIZE = 420, SEG = 150, cell = SIZE / SEG;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color('#0a3550') },
    uMid: { value: new THREE.Color('#1f6f8c') },
    uSky: { value: new THREE.Color(sky) },
    uHorizon: { value: new THREE.Color(horizon) },
    uSunDir: { value: new THREE.Vector3(...sunDir).normalize() },
    uSunCol: { value: new THREE.Color('#fff4dc') },
    uFadeNear: { value: 110 },
    uFadeFar: { value: 192 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: SEA_VERT, fragmentShader: SEA_FRAG });
  const sea = new THREE.Mesh(geo, mat);
  sea.frustumCulled = false;
  sea.position.y = SHIP.seaY;
  const t0 = performance.now();
  // Planet följer kameran i hela rutor så vågorna inte glider
  sea.onBeforeRender = (r, s, cam) => {
    uniforms.uTime.value = (performance.now() - t0) / 1000;
    sea.position.x = Math.round(cam.position.x / cell) * cell;
    sea.position.z = Math.round(cam.position.z / cell) * cell;
    sea.updateMatrixWorld();
  };
  scene.add(sea);

  // Skumrand där skrovet möter vattnet
  const ring = [];
  const edge = offsetPolyline(hullEdge(SHIP.stern0 - SHIP.sternLen + 0.01, SHIP.tip - 0.01), 0);
  const pos = [], uv = [];
  let u = 0;
  for (let i = 0; i < edge.length; i++) {
    const [x, z, nx, nz] = edge[i];
    const inset = 0.85; // skrovet är smalare nere vid vattnet
    const ax = x - nx * inset, az = z - nz * inset;
    if (i) u += Math.hypot(x - edge[i - 1][0], z - edge[i - 1][1]);
    ring.push([ax, az, ax + nx * 1.3, az + nz * 1.3, u]);
  }
  ring.push(ring[0].slice(0, 4).concat(u + 3));
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    const y = SHIP.seaY + 0.12;
    pos.push(a[0], y, a[1], a[2], y, a[3], b[2], y, b[3], a[0], y, a[1], b[2], y, b[3], b[0], y, b[1]);
    uv.push(a[4] / 6, 0, a[4] / 6, 1, b[4] / 6, 1, a[4] / 6, 0, b[4] / 6, 1, b[4] / 6, 0);
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fg.computeVertexNormals();
  const foamTex = cached('foamTex', () => {
    const [c, ctx] = canvas(256, 64);
    const r = rng(77);
    for (let i = 0; i < 900; i++) {
      const x = r() * 256, y = Math.pow(r(), 1.6) * 64;
      ctx.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.5 * (1 - y / 64)})`;
      ctx.beginPath(); ctx.ellipse(x, y, 2 + r() * 7, 1 + r() * 2.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    return toTex(c);
  });
  const foam = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  scene.add(foam);
  return sea;
}

// ===========================================================================
// Däck och skrov
// ===========================================================================

const DECK_TILE = 4; // meter per texturupprepning
const PLANK_ROWS = 32; // 12,5 cm breda plankor

// Ritar en planka med omlindning i x
function plank(ctx, S, x0, y, w, h, base, r) {
  for (const ox of [-S, 0, S]) {
    const x = x0 + ox;
    if (x > S || x + w < 0) continue;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = rgb(...base);
    ctx.fillRect(x, y, w, h);
    // Ljusare mitt, mörkare kanter (rundad lack)
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(60,30,10,0.18)'); g.addColorStop(0.35, 'rgba(255,220,160,0.06)');
    g.addColorStop(0.7, 'rgba(255,220,160,0.03)'); g.addColorStop(1, 'rgba(60,30,10,0.22)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  // Ådring (ritas efter klippning med samma omlindning)
  const lines = 7 + Math.floor(r() * 5);
  for (let k = 0; k < lines; k++) {
    const gy = y + 2 + r() * (h - 4), amp = 0.6 + r() * 1.6, fr = 0.005 + r() * 0.02, ph = r() * 6;
    const dark = r() < 0.65;
    ctx.strokeStyle = dark ? `rgba(90,48,18,${0.1 + r() * 0.16})` : `rgba(250,205,140,${0.06 + r() * 0.1})`;
    ctx.lineWidth = 0.5 + r() * 1.1;
    for (const ox of [-S, 0, S]) {
      const x = x0 + ox;
      if (x > S || x + w < 0) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y + 1, w, h - 2); ctx.clip();
      ctx.beginPath();
      for (let s = 0; s <= w; s += 8) ctx.lineTo(x + s, gy + Math.sin(s * fr + ph) * amp);
      ctx.stroke(); ctx.restore();
    }
  }
  // Någon kvist ibland
  if (r() < 0.25) {
    const kx = x0 + r() * w, ky = y + h * (0.3 + r() * 0.4);
    for (const ox of [-S, 0, S]) {
      const g = ctx.createRadialGradient(kx + ox, ky, 0, kx + ox, ky, 5);
      g.addColorStop(0, 'rgba(70,35,12,0.55)'); g.addColorStop(1, 'rgba(70,35,12,0)');
      ctx.fillStyle = g; ctx.fillRect(kx + ox - 7, ky - 5, 14, 10);
    }
  }
}

function deckTexture() {
  return cached('deckTex', () => {
    const S = 1024, ph = S / PLANK_ROWS;
    const [c, ctx] = canvas(S);
    const r = rng(5);
    for (let k = 0; k < PLANK_ROWS; k++) {
      const off = ((k * 5) % 8) * (S / 8);
      for (let s = 0; s < 2; s++) {
        const tone = 0.84 + r() * 0.26;
        const base = [188 * tone, 126 * tone * (0.95 + r() * 0.08), 66 * tone * (0.85 + r() * 0.25)];
        plank(ctx, S, off + s * (S / 2), k * ph, S / 2, ph, base, r);
      }
    }
    // Drevning (mörka fogar) och stötar
    ctx.fillStyle = '#21160e';
    for (let k = 0; k < PLANK_ROWS; k++) {
      ctx.fillRect(0, k * ph - 1, S, 3);
      const off = ((k * 5) % 8) * (S / 8);
      for (let s = 0; s < 2; s++) ctx.fillRect(((off + s * S / 2) % S) - 1, k * ph, 3, ph);
    }
    // Pluggar vid stötarna
    ctx.fillStyle = 'rgba(120,70,30,0.6)';
    for (let k = 0; k < PLANK_ROWS; k++) {
      const off = ((k * 5) % 8) * (S / 8);
      for (let s = 0; s < 2; s++) {
        const x = (off + s * S / 2) % S;
        for (const dx of [6, -6]) { ctx.beginPath(); ctx.arc((x + dx + S) % S, k * ph + ph / 2, 2.2, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    return toTex(c);
  });
}

function deckMaterial() {
  return cached('deckMat', () => new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.36, metalness: 0, envMapIntensity: 0.75 }));
}

// Huvuddäck, akterdäck med pool, skrovsidor och kolliders
export function makeHull(scene, world, RAPIER, { pool = null } = {}) {
  const { sunX, sunY, keelY } = SHIP;
  const xMin = SHIP.stern0 - SHIP.sternLen, xMax = SHIP.tip;
  // Konturer: huvuddäcket (fören till akterdäcket) och akterdäcket
  const main = hullEdge(sunX, xMax), stern = hullEdge(sunX, xMin);

  if (world) {
    const body = fixedBody(world, RAPIER);
    prism(world, body, RAPIER, main, -1, 0);
    prism(world, body, RAPIER, stern, -1, sunY);
  }
  if (!scene) return;

  // Däcksplankor (en mesh för alla plankytor)
  const holes = pool ? [[[pool.x0, pool.z0], [pool.x1, pool.z0], [pool.x1, pool.z1], [pool.x0, pool.z1]]] : [];
  const deckGeos = [flatGeometry(main, 0, DECK_TILE), flatGeometry(stern, sunY, DECK_TILE, holes)];
  const deck = new THREE.Mesh(mergeGeometries(deckGeos), deckMaterial());
  deck.receiveShadow = true;
  scene.add(deck);

  // Skrovsidor: vitt band överst, mörkblått, rött under vattenlinjen.
  // Skrovet smalnar lite nedåt.
  const hull = batch();
  const side = (line, top) => {
    const e = offsetPolyline(line, 0);
    const rows = [[top, '#f2f0ea'], [top - 0.5, '#f2f0ea'], [top - 0.5, '#c9a23a'], [top - 0.62, '#c9a23a'], [top - 0.62, '#1b2c4a'], [SHIP.seaY + 0.4, '#1b2c4a'], [SHIP.seaY + 0.4, '#a3302a'], [keelY, '#a3302a']];
    const inset = (y) => 1.1 * Math.pow((top - y) / (top - keelY), 1.6);
    const pos = [], col = [];
    for (let i = 0; i < e.length - 1; i++) {
      const a = e[i], b = e[i + 1];
      for (let k = 0; k < rows.length; k += 2) {
        const [y0, c0] = rows[k], [y1] = rows[k + 1];
        const P = (p, y) => [p[0] - p[2] * inset(y), y, p[1] - p[3] * inset(y)];
        const q = [P(a, y0), P(b, y0), P(b, y1), P(a, y1)];
        for (const j of [0, 1, 2, 0, 2, 3]) pos.push(...q[j]);
        _c.set(c0);
        for (let j = 0; j < 6; j++) col.push(_c.r, _c.g, _c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    hull.add(g, null);
    // Vattenväg: ljus stålkant innanför relingen
    const ww = [];
    for (let i = 0; i < e.length - 1; i++) {
      const a = e[i], b = e[i + 1], d = 0.32, y = top + 0.008;
      const q = [[a[0], y, a[1]], [b[0], y, b[1]], [b[0] - b[2] * d, y, b[1] - b[3] * d], [a[0] - a[2] * d, y, a[1] - a[3] * d]];
      for (const j of [0, 1, 2, 0, 2, 3]) ww.push(...q[j]);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(ww, 3));
    wg.computeVertexNormals();
    hull.add(wg, '#cfccc4');
  };
  side(main, 0);
  side(stern, sunY);
  // Akterdäckets framkant (vit skott) med teakkant
  const w0 = halfWidth(sunX);
  hull.box(0.12, sunY, w0 * 2, sunX + 0.06, sunY / 2, 0, '#eeebe3');
  hull.box(0.2, 0.05, w0 * 2, sunX + 0.1, sunY + 0.025, 0, '#7a4b25');

  // Poolen: kakelväggar, kant och vatten
  if (pool) {
    const { x0, x1, z0, z1 } = pool, d = 0.75, yb = sunY - d;
    for (const [w, dd, x, z] of [[x1 - x0, 0.02, (x0 + x1) / 2, z0 + 0.01], [x1 - x0, 0.02, (x0 + x1) / 2, z1 - 0.01], [0.02, z1 - z0, x0 + 0.01, (z0 + z1) / 2], [0.02, z1 - z0, x1 - 0.01, (z0 + z1) / 2]]) {
      hull.box(w, d, dd, x, yb + d / 2, z, '#8fd0dc');
    }
    hull.box(x1 - x0, 0.02, z1 - z0, (x0 + x1) / 2, yb, (z0 + z1) / 2, '#6cc0d2');
    const c = 0.28;
    for (const [w, dd, x, z] of [[x1 - x0 + c * 2, c, (x0 + x1) / 2, z0 - c / 2], [x1 - x0 + c * 2, c, (x0 + x1) / 2, z1 + c / 2], [c, z1 - z0, x0 - c / 2, (z0 + z1) / 2], [c, z1 - z0, x1 + c / 2, (z0 + z1) / 2]]) {
      hull.box(w, 0.05, dd, x, sunY + 0.025, z, '#f4f2ec');
    }
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0, z1 - z0),
      new THREE.MeshStandardMaterial({ color: 0x2fb8d0, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.82, envMapIntensity: 1.2 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set((x0 + x1) / 2, sunY - 0.12, (z0 + z1) / 2);
    scene.add(water);
  }
  hull.mesh(scene, paintMat(0.45), { cast: false });
}

// ===========================================================================
// Reling: stolpar (instansierade), två rör och en handledare i teak
// lines: [{ pts: [[x,z],...], y, h, collider, closed }]
// ===========================================================================

export function makeRailings(scene, world, RAPIER, lines) {
  const body = world ? fixedBody(world, RAPIER) : null;
  const posts = [];
  const rails = scene ? batch() : null;
  for (const L of lines) {
    const { pts, y = 0, h = 1.05, collider = false, closed = false } = L;
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-3) continue;
      if (body && collider) {
        box(world, body, RAPIER, 0.06, 0.6, len / 2 + 0.05, (a[0] + b[0]) / 2, y + 0.6, (a[1] + b[1]) / 2, Math.atan2(b[0] - a[0], b[1] - a[1]), 0.3);
      }
      if (!scene) continue;
      const k = Math.max(1, Math.ceil(len / 1.5));
      for (let j = (i === 0 && !closed) ? 0 : 1; j <= k; j++) {
        const u = j / k;
        posts.push([a[0] + (b[0] - a[0]) * u, y, a[1] + (b[1] - a[1]) * u, h]);
      }
      for (const [ry, w, hh, col] of [[0.32, 0.035, 0.035, '#e9e7e1'], [0.66, 0.035, 0.035, '#e9e7e1'], [h, 0.11, 0.06, '#8a5226']]) {
        rails.beam([a[0], y + ry, a[1]], [b[0], y + ry, b[1]], w, hh, col);
      }
    }
  }
  if (!scene) return;
  rails.mesh(scene, paintMat(0.4));
  const geo = new THREE.CylinderGeometry(0.024, 0.028, 1, 6);
  geo.translate(0, 0.5, 0);
  const inst = new THREE.InstancedMesh(geo, cached('postMat', () => new THREE.MeshStandardMaterial({ color: 0xeceae4, roughness: 0.4, metalness: 0.2 })), posts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  posts.forEach(([x, y, z, h], i) => inst.setMatrixAt(i, m4.compose(v.set(x, y, z), q, s.set(1, h, 1))));
  inst.castShadow = true;
  inst.receiveShadow = true;
  scene.add(inst);
}

// ===========================================================================
// Överbyggnaden: däckshus med ventiler, promenaddäck med tak, brygga,
// skorstenar. Väggarnas texturer: vit plåt med nitar, fönsterrad.
// ===========================================================================

function wallTexture() {
  return cached('wallTex', () => {
    const W = 512, H = 360; // 4 m × 2,8 m
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = '#f1eee7'; ctx.fillRect(0, 0, W, H);
    const r = rng(41);
    // Svag smuts och målarstruktur
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '120,115,105'},${0.03 + r() * 0.04})`;
      ctx.fillRect(r() * W, r() * H, 1 + r() * 6, 1 + r() * 3);
    }
    // Plåtskarvar med nitrader
    const seam = (x0, y0, x1, y1) => {
      ctx.strokeStyle = 'rgba(110,105,95,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const n = Math.hypot(x1 - x0, y1 - y0) / 11;
      for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * (i / n), y = y0 + (y1 - y0) * (i / n);
        for (const s of [-5, 5]) {
          const px = x0 === x1 ? x + s : x, py = x0 === x1 ? y : y + s;
          ctx.fillStyle = 'rgba(90,85,75,0.45)'; ctx.beginPath(); ctx.arc(px + 0.6, py + 0.6, 1.8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(px - 0.3, py - 0.3, 1.1, 0, Math.PI * 2); ctx.fill();
        }
      }
    };
    for (let x = 0; x <= W; x += 128) seam(x === W ? W - 1 : x + (x === 0 ? 1 : 0), 0, x === W ? W - 1 : x + (x === 0 ? 1 : 0), H - 20);
    seam(0, H * 0.42, W, H * 0.42);
    // Rostränder under nitarna här och där
    for (let i = 0; i < 6; i++) {
      const x = r() * W, y = H * 0.42 + 4, l = 20 + r() * 50;
      const g = ctx.createLinearGradient(0, y, 0, y + l);
      g.addColorStop(0, 'rgba(150,90,40,0.18)'); g.addColorStop(1, 'rgba(150,90,40,0)');
      ctx.fillStyle = g; ctx.fillRect(x, y, 2 + r() * 2, l);
    }
    // Sockel mot däcket
    ctx.fillStyle = '#7f8a8c'; ctx.fillRect(0, H - 16, W, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, H - 17, W, 2);
    return toTex(c);
  });
}

function windowTexture() {
  return cached('winTex', () => {
    const W = 512, H = 336; // 4 m × 2,6 m
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = '#f3f1ea'; ctx.fillRect(0, 0, W, H);
    const my = (m) => H - (m / 2.6) * H;
    for (const x0 of [24, 280]) {
      const x = x0, y = my(2.05), w = 208, h = my(0.85) - my(2.05);
      ctx.fillStyle = '#c9c6bd';
      ctx.beginPath(); ctx.roundRect(x - 6, y - 6, w + 12, h + 12, 16); ctx.fill();
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#9cc7e6'); g.addColorStop(0.45, '#3f6f93'); g.addColorStop(0.5, '#23405a'); g.addColorStop(1, '#16283a');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
      // Spröjs och reflex
      ctx.fillStyle = '#e8e5dd'; ctx.fillRect(x + w / 2 - 3, y, 6, h);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.moveTo(x + 20, y + h); ctx.lineTo(x + 70, y); ctx.lineTo(x + 100, y); ctx.lineTo(x + 50, y + h); ctx.fill();
    }
    // Ränna och nitrad
    ctx.fillStyle = 'rgba(110,105,95,0.35)'; ctx.fillRect(0, my(0.55), W, 2);
    ctx.fillStyle = '#7f8a8c'; ctx.fillRect(0, H - 14, W, 14);
    return toTex(c);
  });
}

function nameTexture(text) {
  return cached('name_' + text, () => {
    const [c, ctx] = canvas(1024, 128);
    ctx.fillStyle = '#f6f3ec'; ctx.fillRect(0, 0, 1024, 128);
    ctx.strokeStyle = '#1b2c4a'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, 1012, 116);
    ctx.fillStyle = '#1b2c4a';
    ctx.font = 'bold 92px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text.split('').join(String.fromCharCode(8202)), 512, 68);
    return toTex(c, { repeat: false });
  });
}

// Däckshusens konturer (x, z)
export const HOUSE = {
  deck1: { pts: [[-34, -7.5], [20, -7.5], [24, -4.5], [24, 4.5], [20, 7.5], [-34, 7.5]], y0: 0, h: 2.8 },
  deck2: { pts: [[-30, -6.5], [15.5, -6.5], [18.5, -4], [18.5, 4], [15.5, 6.5], [-30, 6.5]], y0: 2.8, h: 2.6 },
  bridge: { pts: [[10, -8.6], [18, -8.6], [19.2, -6], [19.2, 6], [18, 8.6], [10, 8.6]], y0: 5.4, h: 2.3 },
  // Promenaddäckets tak på babordssidan (x0..x1, z0..z1)
  promenade: { x0: -28, x1: 16, z0: 7.5, z1: 14.4, y: 2.62, posts: 14.0 },
  funnels: [[-17, 0], [-3.5, 0]],
};

export function makeSuperstructure(scene, world, RAPIER) {
  const { deck1, deck2, bridge, promenade: P } = HOUSE;
  if (world) {
    const body = fixedBody(world, RAPIER);
    prism(world, body, RAPIER, deck1.pts, 0, deck1.h + deck2.h, 0.5);
    // Promenaddäckets stolpar
    for (let x = P.x0 + 0.5; x <= P.x1; x += 4) box(world, body, RAPIER, 0.09, 1.3, 0.09, x, 1.3, P.posts, 0, 0.3);
  }
  if (!scene) return;

  // Väggar
  const plate = new THREE.Mesh(wallGeometry(deck1.pts, deck1.y0, deck1.h, 4), cached('wallMat', () => new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.5, side: THREE.DoubleSide })));
  plate.receiveShadow = plate.castShadow = true;
  scene.add(plate);
  const win = new THREE.Mesh(
    mergeGeometries([wallGeometry(deck2.pts, deck2.y0, deck2.h, 4), wallGeometry(bridge.pts, bridge.y0, bridge.h, 4)]),
    cached('winMat', () => new THREE.MeshStandardMaterial({ map: windowTexture(), roughness: 0.35, side: THREE.DoubleSide }))
  );
  win.receiveShadow = win.castShadow = true;
  scene.add(win);

  // Plankade tak (båtdäck, soldäck, promenadtaket) i däckets material
  const roofs = [
    flatGeometry(deck1.pts, deck1.h + 0.004, DECK_TILE),
    flatGeometry(deck2.pts, deck2.y0 + deck2.h + 0.004, DECK_TILE),
    flatGeometry([[P.x0, P.z0], [P.x1, P.z0], [P.x1, P.z1], [P.x0, P.z1]], P.y + 0.18, DECK_TILE),
  ];
  const roofMesh = new THREE.Mesh(mergeGeometries(roofs), deckMaterial());
  roofMesh.receiveShadow = true;
  scene.add(roofMesh);

  const b = batch();
  // Takkanter (vita lister) runt däckshusen
  const rim = (pts, y) => {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      b.beam([a[0], y, a[1]], [c[0], y, c[1]], 0.22, 0.16, '#f6f4ee');
    }
  };
  rim(deck1.pts, deck1.h - 0.06);
  rim(deck2.pts, deck2.y0 + deck2.h - 0.06);
  // Bryggans tak skjuter ut lite
  b.add(flatRoofSlab(bridge.pts, bridge.y0 + bridge.h, 0.18, 0.25), '#f6f4ee');
  // Promenaddäckets tak: vit platta, kant och stolpar
  b.box(P.x1 - P.x0, 0.18, P.z1 - P.z0, (P.x0 + P.x1) / 2, P.y + 0.09, (P.z0 + P.z1) / 2, '#f4f2ec');
  b.box(P.x1 - P.x0, 0.12, 0.1, (P.x0 + P.x1) / 2, P.y - 0.02, P.z1 - 0.05, '#e4e1d9');
  for (let x = P.x0 + 0.5; x <= P.x1; x += 4) {
    const g = new THREE.CylinderGeometry(0.075, 0.09, P.y, 10);
    g.translate(x, P.y / 2, P.posts);
    b.add(g, '#f2f0ea');
    // Konsoler under taket
    b.beam([x, P.y - 0.5, P.posts], [x, P.y - 0.02, P.posts - 0.9], 0.06, 0.1, '#f2f0ea');
    // Lampor under taket
    const lamp = new THREE.SphereGeometry(0.1, 10, 6);
    lamp.translate(x + 2, P.y - 0.12, (P.z0 + P.z1) / 2);
    b.add(lamp, '#fff6d8');
  }
  // Dörrar i teak längs nedre däckshuset
  for (const x of [-30, -18, -6, 6, 17]) for (const s of [-1, 1]) {
    b.box(0.9, 2.0, 0.06, x, 1.0, s * (7.5 + 0.03), '#7b4a24');
    b.box(1.05, 0.08, 0.08, x, 2.04, s * (7.5 + 0.04), '#d9d5cc');
  }
  // Fören på däckshuset: namnbräda
  const nm = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 0.9), new THREE.MeshStandardMaterial({ map: nameTexture('M/S KRYSSAREN'), roughness: 0.5 }));
  nm.rotation.y = Math.PI / 2;
  nm.position.set(24.03, 2.05, 0);
  scene.add(nm);

  // Skorstenar: ovala, bakåtlutade, röda med vitt band och svart topp
  for (const [fx, fz] of HOUSE.funnels) {
    const y0 = deck2.y0 + deck2.h, parts = [];
    for (const [ya, yb, col] of [[0, 4.6, '#c4302b'], [4.6, 5.2, '#f4f2ec'], [5.2, 5.9, '#c4302b'], [5.9, 7.0, '#1d1d1f']]) {
      const ra = 1.35 - ya * 0.025, rb = 1.35 - yb * 0.025;
      const g = new THREE.CylinderGeometry(rb, ra, yb - ya, 28, 1, true);
      g.translate(0, (ya + yb) / 2, 0);
      parts.push(paint(g, col));
    }
    const cap = new THREE.CircleGeometry(1.15, 28);
    cap.rotateX(-Math.PI / 2); cap.translate(0, 6.6, 0);
    parts.push(paint(cap, '#0c0c0c'));
    const base = new THREE.CylinderGeometry(1.5, 1.6, 0.3, 28);
    base.translate(0, 0.15, 0);
    parts.push(paint(base, '#e9e6de'));
    const g = mergeGeometries(parts);
    g.scale(1.45, 1, 1);
    // Lutning akterut (skjuvning så foten står kvar)
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) - p.getY(i) * 0.16);
    g.computeVertexNormals();
    g.translate(fx, y0, fz);
    b.add(g, null);
  }

  // Mast och strålkastare ovanpå bryggan
  b.box(0.5, 0.6, 0.5, 14, bridge.y0 + bridge.h + 0.3, 0, '#f2f0ea');
  const mast = new THREE.CylinderGeometry(0.08, 0.12, 4.5, 8);
  mast.translate(14, bridge.y0 + bridge.h + 2.6, 0);
  b.add(mast, '#f2f0ea');
  b.box(0.1, 0.1, 3.2, 14, bridge.y0 + bridge.h + 3.6, 0, '#f2f0ea');
  // Radar
  b.box(0.12, 0.12, 2.4, 13.4, bridge.y0 + bridge.h + 1.3, 0, '#2a2a2c');

  b.mesh(scene, paintMat(0.45));
}

// Takplatta med utskjutande kant
function flatRoofSlab(pts, y, t, over) {
  const c = centroid(pts);
  const grown = pts.map(([x, z]) => {
    const dx = x - c[0], dz = z - c[1], l = Math.hypot(dx, dz);
    return [x + (dx / l) * over, z + (dz / l) * over];
  });
  const shape = new THREE.Shape(grown.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

// ===========================================================================
// Ventiler (koppar-ringar med mörkt glas) längs nedre däckshuset
// ===========================================================================

export function addPortholes(scene, { pts, y = 1.55, spacing = 2.2, skip = [] } = HOUSE.deck1) {
  if (!scene) return;
  const list = [];
  const c = centroid(pts);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.floor((len - 1.2) / spacing);
    if (n < 1) continue;
    let nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (nx * (mx - c[0]) + nz * (mz - c[1]) < 0) { nx = -nx; nz = -nz; }
    for (let k = 0; k < n; k++) {
      const u = (len - (n - 1) * spacing) / 2 / len + (k * spacing) / len;
      const x = a[0] + (b[0] - a[0]) * u, z = a[1] + (b[1] - a[1]) * u;
      if (skip.some(([sx, sw]) => Math.abs(x - sx) < sw) && Math.abs(nz) > 0.9) continue;
      list.push([x + nx * 0.02, z + nz * 0.02, Math.atan2(nx, nz)]);
    }
  }
  const ringGeo = new THREE.TorusGeometry(0.22, 0.045, 8, 20);
  const glassGeo = new THREE.CircleGeometry(0.2, 20);
  const ring = new THREE.InstancedMesh(ringGeo, cached('brass', () => new THREE.MeshStandardMaterial({ color: 0xc89b45, roughness: 0.3, metalness: 0.85 })), list.length);
  const glass = new THREE.InstancedMesh(glassGeo, cached('glass', () => new THREE.MeshStandardMaterial({ color: 0x1d3446, roughness: 0.05, metalness: 0.6, envMapIntensity: 1.4 })), list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  list.forEach(([x, z, rot], i) => {
    q.setFromEuler(e.set(0, rot, 0));
    ring.setMatrixAt(i, m4.compose(v.set(x, y, z), q, s));
    glass.setMatrixAt(i, m4.compose(v.set(x, y, z), q, s));
  });
  scene.add(ring, glass);
}

// ===========================================================================
// Livbåtar i dävertar. boats: [{ x, z, y, side: ±1 (utåt i z) }]
// ===========================================================================

export function addLifeboats(scene, boats) {
  if (!scene) return;
  const b = batch();
  for (const { x, z, y, davitZ, deckY } of boats) {
    const out = Math.sign(z - davitZ);
    // Skrov (nedre halvsfär) och kapell (övre halvsfär)
    const hull = new THREE.SphereGeometry(1, 18, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    hull.scale(3.4, 0.85, 1.15); hull.translate(x, y, z);
    b.add(hull, '#f3f1ea');
    const rub = new THREE.CylinderGeometry(1, 1, 0.12, 24, 1, true);
    rub.scale(3.42, 1, 1.17); rub.translate(x, y + 0.02, z);
    b.add(rub, '#c9a23a');
    const cover = new THREE.SphereGeometry(1, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    cover.scale(3.2, 0.7, 1.08); cover.translate(x, y + 0.06, z);
    b.add(cover, '#e2601d');
    // Dävertar: stolpe på däcket och arm ut över båten, löpare ner till båten
    for (const dx of [-2.3, 2.3]) {
      const top = y + 1.6;
      b.beam([x + dx, deckY, davitZ], [x + dx, top, davitZ], 0.2, 0.2, '#e8e6df');
      b.beam([x + dx, top, davitZ], [x + dx, top + 0.25, z], 0.16, 0.16, '#e8e6df');
      b.beam([x + dx, top + 0.15, z], [x + dx, y + 0.7, z], 0.03, 0.03, '#3b3b3b');
    }
    void out;
  }
  b.mesh(scene, paintMat(0.45));
}

// ===========================================================================
// Solstolar (instansierade): ram i trä och randig väv.
// chairs: [{ x, z, y, rot }]. Lokalt: längs z, ryggstödet vid -z.
// ===========================================================================

function fabricTexture() {
  return cached('fabric', () => {
    const [c, ctx] = canvas(64);
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f4efe2' : '#1f5ea8'; ctx.fillRect(i * 8, 0, 8, 64); }
    return toTex(c);
  });
}

export function addDeckChairs(scene, world, RAPIER, chairs) {
  if (world) {
    const body = fixedBody(world, RAPIER);
    for (const { x, z, y = 0, rot = 0 } of chairs) box(world, body, RAPIER, 0.32, 0.25, 0.85, x, y + 0.25, z, rot, 0.4);
  }
  if (!scene || !chairs.length) return;
  const wood = '#8a5a32';
  const parts = [];
  const bx = (w, h, d, x, y, z, rx = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    parts.push(paint(g, wood));
  };
  // Ram: sidoreglar, ben, ryggstödets reglar
  for (const sx of [-0.29, 0.29]) {
    bx(0.04, 0.05, 1.2, sx, 0.33, 0.2);
    bx(0.04, 0.33, 0.04, sx, 0.165, 0.75);
    bx(0.04, 0.33, 0.04, sx, 0.165, -0.3);
    bx(0.04, 0.05, 0.75, sx, 0.62, -0.62, 0.85);
  }
  bx(0.6, 0.04, 0.04, 0, 0.33, 0.8);
  const frameGeo = mergeGeometries(parts);
  const seat = new THREE.BoxGeometry(0.54, 0.02, 1.1);
  seat.translate(0, 0.35, 0.18);
  const back = new THREE.BoxGeometry(0.54, 0.02, 0.72);
  back.rotateX(0.85);
  back.translate(0, 0.62, -0.6);
  const fabricGeo = mergeGeometries([seat, back]);
  const frame = new THREE.InstancedMesh(frameGeo, paintMat(0.55), chairs.length);
  const fabric = new THREE.InstancedMesh(fabricGeo, cached('fabricMat', () => new THREE.MeshStandardMaterial({ map: fabricTexture(), roughness: 0.85 })), chairs.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  chairs.forEach(({ x, z, y = 0, rot = 0 }, i) => {
    m4.compose(v.set(x, y, z), q.setFromEuler(e.set(0, rot, 0)), s);
    frame.setMatrixAt(i, m4);
    fabric.setMatrixAt(i, m4);
  });
  frame.castShadow = fabric.castShadow = true;
  frame.receiveShadow = fabric.receiveShadow = true;
  scene.add(frame, fabric);
}

// ===========================================================================
// Livbojar på relingen. rings: [{ x, y, z, rot }] (rot: vänd mot däcket)
// ===========================================================================

export function addLifeRings(scene, rings) {
  if (!scene || !rings.length) return;
  const tex = cached('ringTex', () => {
    const [c, ctx] = canvas(256, 32);
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f5f2ea' : '#d8392b'; ctx.fillRect(i * 32, 0, 32, 32); }
    // Lina runt bojen
    ctx.fillStyle = '#d9c9a0';
    for (let i = 0; i < 4; i++) ctx.fillRect(i * 64 + 30, 0, 4, 32);
    return toTex(c);
  });
  const inst = new THREE.InstancedMesh(new THREE.TorusGeometry(0.3, 0.075, 10, 28), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), rings.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  rings.forEach(({ x, y, z, rot }, i) => inst.setMatrixAt(i, m4.compose(v.set(x, y, z), q.setFromEuler(e.set(0, rot, 0.3)), s)));
  inst.castShadow = true;
  scene.add(inst);
}

// ===========================================================================
// Däcksutrustning: pollare, tågvirke, ventilatorer, lucka, mast, ankarspel,
// flaggstång och flaggspel. Allt i en sammanslagen mesh.
// ===========================================================================

export function addDeckGear(scene, world, RAPIER, { bollards = [], coils = [], vents = [], hatches = [], masts = [], windlass = null, flag = null, bunting = [] } = {}) {
  if (world) {
    const body = fixedBody(world, RAPIER);
    for (const { x, z, y = 0, rot = 0 } of bollards) box(world, body, RAPIER, 0.5, 0.22, 0.22, x, y + 0.22, z, rot);
    for (const { x, z, y = 0 } of vents) box(world, body, RAPIER, 0.3, 0.9, 0.3, x, y + 0.9, z);
    for (const { x, z, w, d, h = 0.6 } of hatches) box(world, body, RAPIER, w / 2, h / 2, d / 2, x, h / 2, z);
    for (const { x, z, y = 0, h } of masts) box(world, body, RAPIER, 0.2, h / 2, 0.2, x, y + h / 2, z);
    if (windlass) box(world, body, RAPIER, 1.3, 0.5, 0.8, windlass.x, 0.5, windlass.z);
  }
  if (!scene) return;
  const b = batch();
  const cyl = (rt, rb, h, x, y, z, col, seg = 14) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(x, y + h / 2, z);
    return b.add(g, col);
  };
  for (const { x, z, y = 0, rot = 0 } of bollards) {
    const parts = [];
    const add = (g, col) => parts.push(paint(g, col));
    const base = new THREE.BoxGeometry(1.0, 0.08, 0.42); base.translate(0, 0.04, 0); add(base, '#2a2b2e');
    for (const dx of [-0.28, 0.28]) {
      const p = new THREE.CylinderGeometry(0.12, 0.13, 0.4, 14); p.translate(dx, 0.28, 0); add(p, '#2a2b2e');
      const c = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 14); c.translate(dx, 0.5, 0); add(c, '#2a2b2e');
    }
    // Ett varv tross runt pollaren
    const t = new THREE.TorusGeometry(0.2, 0.03, 6, 16); t.scale(1.9, 1, 1); t.rotateX(Math.PI / 2); t.translate(0, 0.3, 0); add(t, '#cfb27a');
    const g = mergeGeometries(parts);
    g.rotateY(rot); g.translate(x, y, z);
    b.add(g, null);
  }
  for (const { x, z, y = 0, r = 0.32 } of coils) {
    for (let k = 0; k < 4; k++) {
      const t = new THREE.TorusGeometry(r - k * 0.035, 0.032, 6, 22);
      t.rotateX(Math.PI / 2); t.translate(x, y + 0.03 + k * 0.05, z);
      b.add(t, '#cdb07a');
    }
  }
  for (const { x, z, y = 0, rot = 0, h = 1.3 } of vents) {
    const parts = [];
    const add = (g, col) => parts.push(paint(g, col));
    const stem = new THREE.CylinderGeometry(0.22, 0.26, h, 14); stem.translate(0, h / 2, 0); add(stem, '#f2f0ea');
    const R = 0.34;
    const elbow = new THREE.TorusGeometry(R, 0.22, 10, 10, Math.PI / 2); elbow.translate(-R, h, 0); add(elbow, '#f2f0ea');
    const mouth = new THREE.CylinderGeometry(0.42, 0.24, 0.3, 16, 1, true); mouth.rotateZ(Math.PI / 2); mouth.translate(-R - 0.14, h + R, 0); add(mouth, '#c4302b');
    const g = mergeGeometries(parts);
    g.rotateY(rot); g.translate(x, y, z);
    b.add(g, null);
  }
  for (const { x, z, w, d, h = 0.6 } of hatches) {
    b.box(w, h, d, x, h / 2, z, '#4f6a63');
    b.box(w + 0.16, 0.08, d + 0.16, x, h - 0.04, z, '#3c524c');
    for (let k = 1; k < 4; k++) b.box(0.06, 0.04, d, x - w / 2 + (w / 4) * k, h + 0.02, z, '#3c524c');
  }
  for (const { x, z, y = 0, h, yard = 3 } of masts) {
    cyl(0.09, 0.17, h, x, y, z, '#f2f0ea');
    b.box(0.1, 0.1, yard, x, y + h * 0.78, z, '#f2f0ea');
    const lamp = new THREE.SphereGeometry(0.14, 10, 8); lamp.translate(x, y + h + 0.1, z); b.add(lamp, '#fff1c4');
    // Stag ner till däcket
    for (const s of [-1, 1]) b.beam([x, y + h * 0.78, z + (s * yard) / 2], [x - 3, 0.05, z + s * 4], 0.025, 0.025, '#4a4a4a');
  }
  if (windlass) {
    const { x, z } = windlass;
    b.box(2.4, 0.3, 1.4, x, 0.15, z, '#2f4a3f');
    for (const s of [-1, 1]) {
      const d = new THREE.CylinderGeometry(0.38, 0.38, 0.5, 16); d.rotateX(Math.PI / 2); d.translate(x, 0.65, z + s * 0.45);
      b.add(d, '#3d3f42');
    }
    const ax = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 10); ax.rotateX(Math.PI / 2); ax.translate(x, 0.65, z);
    b.add(ax, '#7a7c80');
  }
  if (flag) {
    const { x, z, y } = flag;
    b.beam([x, y, z], [x - 0.8, y + 4, z], 0.07, 0.07, '#f2f0ea');
    const quad = (pts, col) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      g.computeVertexNormals();
      b.add(g, col);
    };
    const fx = x - 0.75, fy = y + 3.8;
    const P = (u, v) => [fx - u * 1.4, fy - v * 0.9 + Math.sin(u * 4) * 0.05, z + Math.sin(u * 5) * 0.12];
    for (let k = 0; k < 4; k++) {
      const u0 = k / 4, u1 = (k + 1) / 4;
      quad([P(u0, 0), P(u1, 0), P(u1, 0.5), P(u0, 0), P(u1, 0.5), P(u0, 0.5)], '#1f4f9e');
      quad([P(u0, 0.5), P(u1, 0.5), P(u1, 1), P(u0, 0.5), P(u1, 1), P(u0, 1)], '#f2f0ea');
    }
  }
  // Flaggspel: linor med vimplar i hängande båge
  const colors = ['#d8392b', '#f2c12e', '#2f6fd6', '#2fa04a', '#f2f0ea'];
  for (const { from, to, sag = 1.2 } of bunting) {
    const n = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) / 0.8);
    const at = (u) => [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u - Math.sin(Math.PI * u) * sag, from[2] + (to[2] - from[2]) * u];
    for (let k = 0; k < n; k++) {
      const a = at(k / n), c = at((k + 1) / n);
      b.beam(a, c, 0.015, 0.015, '#555555');
      if (k % 1 === 0) {
        const m = at((k + 0.5) / n);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...c, m[0], m[1] - 0.45, m[2]], 3));
        g.computeVertexNormals();
        b.add(g, colors[k % colors.length]);
      }
    }
  }
  b.mesh(scene, paintMat(0.5));
}

// ===========================================================================
// Kappbanan: plankor längs körriktningen, vita kantlinjer. Läggs ovanpå
// banans väg (samma höjd, större polygonOffset).
// ===========================================================================

const LANE_TILE = 6.4;

function laneTexture() {
  return cached('laneTex', () => {
    const W = 512, H = 1024, cols = 24, pw = W / cols;
    const [c, ctx] = canvas(W, H);
    const r = rng(9);
    // Rita plankor liggande (som däcket) i en tillfällig canvas och vrid
    const [t, tx] = canvas(H, W);
    for (let k = 0; k < cols; k++) {
      const off = ((k * 3) % 5) * (H / 5);
      for (let s = 0; s < 2; s++) {
        const tone = 0.8 + r() * 0.22;
        plank(tx, H, off + s * (H / 2), k * pw, H / 2, pw, [168 * tone, 100 * tone, 52 * tone], r);
      }
    }
    tx.fillStyle = '#1e140c';
    for (let k = 0; k < cols; k++) {
      tx.fillRect(0, k * pw - 1, H, 3);
      const off = ((k * 3) % 5) * (H / 5);
      for (let s = 0; s < 2; s++) tx.fillRect(((off + s * H / 2) % H) - 1, k * pw, 3, pw);
    }
    ctx.save(); ctx.translate(W, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(t, 0, 0); ctx.restore();
    // Målade kantlinjer: vit med smal blå
    const line = (x, w, col) => { ctx.fillStyle = col; ctx.fillRect(x, 0, w, H); };
    for (const side of [0, 1]) {
      const at = (x, w) => (side ? W - x - w : x);
      line(at(10, 22), 22, '#f2efe6');
      line(at(36, 6), 6, '#2456a6');
    }
    // Slitage i färgen
    for (let i = 0; i < 500; i++) {
      const side = r() < 0.5;
      const x = side ? 8 + r() * 36 : W - 44 + r() * 36;
      ctx.fillStyle = `rgba(150,90,45,${0.3 + r() * 0.5})`;
      ctx.fillRect(x, r() * H, 1 + r() * 3, 1 + r() * 5);
    }
    return toTex(c);
  });
}

// Genvägar (open) läggs utan glapp (däcket bär dem) och något under
// huvudbanan där de möts, så att huvudbanans plankor syns överst.
export function addLane(scene, track) {
  if (!scene) return;
  const { pts, normals, roadHalf, dist, length } = track;
  const N = track.open ? track.N - 1 : track.N;
  const isGap = track.open ? pts.map(() => false) : track.isGap;
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
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    map: laneTexture(), roughness: 0.33, envMapIntensity: 0.8,
    polygonOffset: true, polygonOffsetFactor: track.open ? -2.5 : -3, polygonOffsetUnits: track.open ? -2.5 : -3,
  }));
  m.receiveShadow = true;
  scene.add(m);
}

// ===========================================================================
// Förpiken: en täckt passage (back) längs en genväg tvärs över fördäcket.
// Vita stålväggar med ventiler, plankat tak med reling, lampor inuti och
// varningsrandiga portaler. Väggarna följer vägen (index i0..i1).
// ===========================================================================

export function addForepeak(scene, world, RAPIER, path, { i0, i1, h = 2.2 }) {
  const { pts, normals, roadHalf } = path;
  const wallT = 0.3;
  const off = roadHalf + path.barrier.thick + 0.2 + wallT / 2;
  const P = (i, o, y = 0) => [pts[i].x + normals[i].x * o, pts[i].y + y, pts[i].z + normals[i].z * o];
  const step = 2;
  const segs = [];
  for (let i = i0; i < i1; i += step) segs.push([i, Math.min(i1, i + step)]);
  if (world) {
    const body = fixedBody(world, RAPIER);
    for (const [a, c] of segs) for (const s of [1, -1]) {
      const A = P(a, s * off), Cc = P(c, s * off);
      const len = Math.hypot(Cc[0] - A[0], Cc[2] - A[2]) + 0.12;
      box(world, body, RAPIER, wallT / 2, h / 2, len / 2, (A[0] + Cc[0]) / 2, h / 2, (A[2] + Cc[2]) / 2, Math.atan2(Cc[0] - A[0], Cc[2] - A[2]), 0.3);
    }
  }
  if (!scene) return;
  const b = batch(), glow = batch();
  for (const [a, c] of segs) {
    for (const s of [1, -1]) {
      const A = P(a, s * off), Cc = P(c, s * off);
      b.beam([A[0], h / 2, A[2]], [Cc[0], h / 2, Cc[2]], wallT, h, '#f3f1ea');
      // Mörkgrön sockel på utsidan
      const Ao = P(a, s * (off + wallT / 2 + 0.01)), Co = P(c, s * (off + wallT / 2 + 0.01));
      b.beam([Ao[0], 0.12, Ao[2]], [Co[0], 0.12, Co[2]], 0.03, 0.24, '#2f4a3f');
    }
    // Tak: teak med vit kant
    const w = 2 * (off + wallT / 2) + 0.2;
    const im = Math.round((a + c) / 2);
    const mid = P(im, 0);
    const t = path.tangents[im];
    const len = Math.hypot(pts[c].x - pts[a].x, pts[c].z - pts[a].z) + 0.14;
    const g = new THREE.BoxGeometry(w, 0.16, len);
    g.rotateY(Math.atan2(t.x, t.z));
    g.translate(mid[0], h + 0.08, mid[2]);
    b.add(g, '#9a6a3e');
    // Lampa i taket mitt över vägen
    if (((a - i0) / step) % 2 === 0) {
      const lamp = new THREE.BoxGeometry(0.5, 0.05, 0.18);
      lamp.rotateY(Math.atan2(t.x, t.z));
      lamp.translate(mid[0], h - 0.03, mid[2]);
      glow.add(lamp, '#ffe7a8');
    }
  }
  // Ventiler på utsidan
  for (let i = i0 + 2; i < i1 - 1; i += 4) for (const s of [1, -1]) {
    const p = P(i, s * (off + wallT / 2 + 0.02), 1.3);
    const n = normals[i];
    const ang = Math.atan2(n.x * s, n.z * s);
    const ring = new THREE.TorusGeometry(0.2, 0.045, 8, 18);
    ring.rotateY(ang); ring.translate(p[0], p[1], p[2]);
    b.add(ring, '#b07a3a');
    const glass = new THREE.CircleGeometry(0.19, 16);
    glass.rotateY(ang); glass.translate(p[0], p[1], p[2]);
    b.add(glass, '#1d2a33');
  }
  // Portaler: varningsrandade överstycken och vita stolpar
  for (const i of [i0, i1]) {
    const t = path.tangents[i];
    const ang = Math.atan2(t.x, t.z);
    const stripes = 9;
    for (let k = 0; k < stripes; k++) {
      const u = -off + ((k + 0.5) / stripes) * off * 2;
      const p = P(i, u, h - 0.12);
      const g = new THREE.BoxGeometry((off * 2) / stripes + 0.01, 0.24, 0.06);
      g.rotateY(ang); g.translate(p[0], p[1], p[2]);
      b.add(g, k % 2 ? '#1d1d1f' : '#f2c12e');
    }
    for (const s of [1, -1]) {
      const p = P(i, s * off, h / 2);
      const g = new THREE.BoxGeometry(wallT + 0.08, h, 0.12);
      g.rotateY(ang); g.translate(p[0], p[1], p[2]);
      b.add(g, '#e4e1d9');
    }
  }
  // Reling runt taket
  const railO = off + wallT / 2 + 0.05;
  for (const s of [1, -1]) {
    let prev = null;
    for (let i = i0; i <= i1 + 2; i += 3) {
      const p = P(Math.min(i, i1), s * railO, h + 0.16);
      b.beam(p, [p[0], p[1] + 0.8, p[2]], 0.05, 0.05, '#f2f0ea');
      if (prev) {
        b.beam([prev[0], prev[1] + 0.8, prev[2]], [p[0], p[1] + 0.8, p[2]], 0.06, 0.06, '#8a5a32');
        b.beam([prev[0], prev[1] + 0.4, prev[2]], [p[0], p[1] + 0.4, p[2]], 0.025, 0.025, '#d9d5cc');
      }
      prev = p;
      if (i >= i1) break;
    }
  }
  // Skeppsklocka på taket
  const m = P(Math.round((i0 + i1) / 2), 0, h + 0.16);
  b.beam(m, [m[0], m[1] + 1.1, m[2]], 0.08, 0.08, '#f2f0ea');
  b.beam([m[0], m[1] + 1.1, m[2] - 0.4], [m[0], m[1] + 1.1, m[2] + 0.4], 0.07, 0.07, '#f2f0ea');
  const bell = new THREE.CylinderGeometry(0.12, 0.24, 0.34, 18, 1, true);
  bell.translate(m[0], m[1] + 0.85, m[2]);
  b.add(bell, '#c9a23a');
  b.mesh(scene, paintMat(0.45));
  glow.mesh(scene, cached('lampGlow', () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })), { cast: false });
}

// ===========================================================================
// Kaptenens hörna vid starten: podium med ratt och kompasshus, jätteankare
// lutat mot relingen, tågvirkesrullar och en ankarkätting över däcket.
// ===========================================================================

export function addCaptainsCorner(scene, world, RAPIER, { x, z, anchor, coils = [] }) {
  if (world) {
    const body = fixedBody(world, RAPIER);
    box(world, body, RAPIER, 1.05, 0.2, 1.05, x, 0.2, z, Math.PI / 8, 0.5);
    box(world, body, RAPIER, 0.3, 0.7, 0.3, x, 1.0, z, 0, 0.5);
    if (anchor) {
      box(world, body, RAPIER, 0.3, 1.5, 0.4, anchor.x, 1.5, anchor.z, anchor.rot ?? 0, 0.4);
      box(world, body, RAPIER, 0.4, 0.4, 1.3, anchor.x, 0.4, anchor.z, anchor.rot ?? 0, 0.4);
    }
    for (const c of coils) box(world, body, RAPIER, c.r ?? 0.5, 0.2, c.r ?? 0.5, c.x, 0.2, c.z, 0, 0.5);
  }
  if (!scene) return;
  const b = batch(), brass = batch();
  const cyl = (B, rt, rb, hh, px, py, pz, col, seg = 20) => { const g = new THREE.CylinderGeometry(rt, rb, hh, seg); g.translate(px, py + hh / 2, pz); return B.add(g, col); };
  // Åttkantigt podium i teak med mässingslist och räcke
  cyl(b, 1.15, 1.2, 0.36, x, 0, z, '#7b4a24', 8);
  cyl(brass, 1.17, 1.17, 0.05, x, 0.3, z, '#c9a23a', 8);
  cyl(b, 1.0, 1.0, 0.03, x, 0.36, z, '#9a6a3e', 8);
  for (let k = 0; k < 8; k++) {
    if (k === 2) continue; // öppning mot däcket
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const px = x + Math.cos(a) * 0.95, pz = z + Math.sin(a) * 0.95;
    cyl(brass, 0.025, 0.025, 0.7, px, 0.36, pz, '#c9a23a', 8);
    const a2 = ((k + 1) / 8) * Math.PI * 2 + Math.PI / 8;
    if (k + 1 !== 2) brass.beam([px, 1.06, pz], [x + Math.cos(a2) * 0.95, 1.06, z + Math.sin(a2) * 0.95], 0.045, 0.045, '#c9a23a');
  }
  // Ratten på en pidestal
  cyl(b, 0.16, 0.22, 0.95, x, 0.36, z, '#5b3518', 12);
  const wy = 1.45;
  const rim = new THREE.TorusGeometry(0.42, 0.04, 8, 28); rim.translate(x, wy, z); b.add(rim, '#7b4a24');
  const hub = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12); hub.rotateX(Math.PI / 2); hub.translate(x, wy, z); brass.add(hub, '#c9a23a');
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.beam([x, wy, z], [x + Math.cos(a) * 0.6, wy + Math.sin(a) * 0.6, z], 0.035, 0.035, '#7b4a24');
    const knob = new THREE.SphereGeometry(0.045, 8, 6); knob.translate(x + Math.cos(a) * 0.62, wy + Math.sin(a) * 0.62, z); b.add(knob, '#5b3518');
  }
  // Kompasshus bredvid
  cyl(b, 0.18, 0.22, 0.85, x + 0.55, 0.36, z - 0.45, '#7b4a24', 14);
  const dome = new THREE.SphereGeometry(0.21, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2); dome.translate(x + 0.55, 1.21, z - 0.45); brass.add(dome, '#c9a23a');
  // Ankaret: lägg, ring, stock, kors med armar och flyn
  if (anchor) {
    const ax = anchor.x, az = anchor.z, lean = anchor.lean ?? 0.15, s = anchor.s ?? 1.3;
    const parts = [];
    const add = (g) => parts.push(paint(g, '#232427'));
    const shank = new THREE.CylinderGeometry(0.12, 0.15, 2.2, 12); shank.translate(0, 1.25, 0); add(shank);
    const ring = new THREE.TorusGeometry(0.28, 0.06, 8, 20); ring.translate(0, 2.6, 0); add(ring);
    const stock = new THREE.CylinderGeometry(0.07, 0.07, 1.6, 10); stock.rotateX(Math.PI / 2); stock.translate(0, 2.15, 0); add(stock);
    for (const sg of [1, -1]) { const ball = new THREE.SphereGeometry(0.11, 10, 8); ball.translate(0, 2.15, sg * 0.82); add(ball); }
    const crown = new THREE.TorusGeometry(0.8, 0.12, 8, 24, Math.PI); crown.rotateZ(Math.PI); crown.translate(0, 0.95, 0); add(crown);
    for (const sg of [1, -1]) {
      const fluke = new THREE.ConeGeometry(0.28, 0.6, 4); fluke.scale(1, 1, 0.35); fluke.rotateZ(sg * 0.5); fluke.translate(sg * 0.86, 1.1, 0); add(fluke);
    }
    const g = mergeGeometries(parts);
    g.scale(s, s, s);
    g.rotateX(-lean); // lutar mot relingen (utåt i −z)
    g.rotateY(anchor.rot ?? 0);
    g.translate(ax, 0, az);
    b.add(g, null);
    // Kätting från ankarets ring ut över däcket
    const top = [ax, Math.cos(lean) * 2.6 * s - 0.3, az - Math.sin(lean) * 2.6 * s];
    const end = anchor.chainTo ?? [ax - 3, 0.05, az + 0.8];
    const n = 30;
    const heading = Math.atan2(end[0] - top[0], end[2] - top[2]);
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const px = top[0] + (end[0] - top[0]) * u, pz = top[2] + (end[2] - top[2]) * u;
      const py = Math.max(0.05, top[1] * Math.max(0, 1 - u * 2.2) ** 1.5 + 0.05);
      const link = new THREE.TorusGeometry(0.08, 0.025, 6, 10);
      link.scale(1.4, 1, 1);
      if (k % 2) link.rotateX(Math.PI / 2);
      link.rotateY(heading + Math.PI / 2);
      link.translate(px, py, pz);
      b.add(link, '#3a3b3e');
    }
  }
  // Stora tågvirkesrullar
  for (const { x: cx, z: cz, r = 0.5, layers = 6 } of coils) {
    for (let k = 0; k < layers; k++) {
      const t = new THREE.TorusGeometry(r - (k % 3) * 0.06, 0.05, 6, 24);
      t.rotateX(Math.PI / 2); t.translate(cx, 0.05 + k * 0.07, cz);
      b.add(t, k % 2 ? '#c9a868' : '#d8bc82');
    }
  }
  b.mesh(scene, paintMat(0.55));
  brass.mesh(scene, paintMat(0.3, 0.8));
}

// ===========================================================================
// Bagage: staplar av koffertar och resväskor med remmar (en kollider per stapel)
// ===========================================================================

export function addLuggage(scene, world, RAPIER, piles) {
  if (world) {
    const body = fixedBody(world, RAPIER);
    for (const { x, z, rot = 0, w = 2.2, d = 1.0 } of piles) box(world, body, RAPIER, w / 2, 0.55, d / 2, x, 0.55, z, rot, 0.5);
  }
  if (!scene) return;
  const b = batch();
  const cols = ['#7b4a24', '#2f5a45', '#b23a2a', '#d8c7a0', '#3a4a6e', '#5b3518'];
  for (const { x, z, rot = 0, seed = 1, w = 2.2, d = 1.0 } of piles) {
    const r = rng(seed);
    const parts = [];
    const add = (g, col) => parts.push(paint(g, col));
    let y = 0;
    // Nederst en stor kista, sedan mindre väskor ovanpå
    const items = [[w * 0.95, 0.5, d * 0.9], [w * 0.55, 0.32, d * 0.75], [w * 0.38, 0.26, d * 0.6]];
    items.forEach(([iw, ih, id], k) => {
      const col = cols[Math.floor(r() * cols.length)];
      const dx = k ? (r() - 0.5) * (w - iw) * 0.8 : 0;
      const g = new THREE.BoxGeometry(iw, ih, id); g.translate(dx, y + ih / 2, 0); add(g, col);
      // Remmar och beslag
      for (const sx of [-0.3, 0.3]) { const st = new THREE.BoxGeometry(0.06, ih + 0.02, id + 0.02); st.translate(dx + sx * iw, y + ih / 2, 0); add(st, '#3a2412'); }
      const lock = new THREE.BoxGeometry(0.12, 0.08, 0.03); lock.translate(dx, y + ih - 0.08, id / 2 + 0.01); add(lock, '#c9a23a');
      // Resemärke
      const tag = new THREE.BoxGeometry(0.22, 0.14, 0.01); tag.translate(dx - iw * 0.15, y + ih * 0.5, id / 2 + 0.012); add(tag, ['#f2c12e', '#f4f1ea', '#2f6fd6'][k]);
      y += ih;
    });
    // Hattask överst
    const hat = new THREE.CylinderGeometry(0.2, 0.2, 0.22, 16); hat.translate((r() - 0.5) * 0.3, y + 0.11, 0); add(hat, '#e8b4b8');
    const g = mergeGeometries(parts);
    g.rotateY(rot); g.translate(x, 0, z);
    b.add(g, null);
  }
  b.mesh(scene, paintMat(0.6));
}

// ===========================================================================
// Blomlådor i teak och flytvästkistor: kanten där banan saknar vallar.
// planters: [{ x, z, len, rot }]  chests: [{ x, z, len, rot }]
// ===========================================================================

export function addDeckEdges(scene, world, RAPIER, { planters = [], chests = [] }) {
  const PH = 0.45, PD = 0.55, CH = 0.6, CD = 0.5;
  if (world) {
    const body = fixedBody(world, RAPIER);
    for (const { x, z, len, rot = 0 } of planters) box(world, body, RAPIER, len / 2, PH / 2, PD / 2, x, PH / 2, z, rot, 0.4);
    for (const { x, z, len, rot = 0 } of chests) box(world, body, RAPIER, len / 2, CH / 2, CD / 2, x, CH / 2, z, rot, 0.4);
  }
  if (!scene) return;
  const b = batch();
  const r = rng(23);
  const flowers = ['#e8403a', '#f2c12e', '#f4f1ea', '#e86aa8', '#9440c8'];
  for (const { x, z, len, rot = 0 } of planters) {
    const parts = [];
    const add = (g, col) => parts.push(paint(g, col));
    const g = new THREE.BoxGeometry(len, PH, PD); g.translate(0, PH / 2, 0); add(g, '#8a5a32');
    for (const yy of [0.12, 0.3]) { const s = new THREE.BoxGeometry(len + 0.02, 0.03, PD + 0.02); s.translate(0, yy, 0); add(s, '#5b3518'); }
    const soil = new THREE.BoxGeometry(len - 0.08, 0.02, PD - 0.08); soil.translate(0, PH - 0.02, 0); add(soil, '#3a2a1c');
    for (let u = -len / 2 + 0.25; u < len / 2 - 0.1; u += 0.32) {
      const bush = new THREE.IcosahedronGeometry(0.17 + r() * 0.06, 1);
      bush.scale(1, 0.8, 1); bush.translate(u + (r() - 0.5) * 0.08, PH + 0.1, (r() - 0.5) * 0.12);
      add(bush, r() < 0.5 ? '#3f7a3a' : '#4f8f43');
      if (r() < 0.7) { const f = new THREE.IcosahedronGeometry(0.05, 0); f.translate(u + (r() - 0.5) * 0.2, PH + 0.24, (r() - 0.5) * 0.2); add(f, flowers[Math.floor(r() * flowers.length)]); }
    }
    const m = mergeGeometries(parts);
    m.rotateY(rot); m.translate(x, 0, z);
    b.add(m, null);
  }
  for (const { x, z, len, rot = 0 } of chests) {
    const parts = [];
    const add = (g, col) => parts.push(paint(g, col));
    const g = new THREE.BoxGeometry(len, CH, CD); g.translate(0, CH / 2, 0); add(g, '#f3f1ea');
    const lid = new THREE.BoxGeometry(len + 0.06, 0.06, CD + 0.06); lid.translate(0, CH + 0.03, 0); add(lid, '#e4e1d9');
    // Orange flytvästband och mässingshandtag på framsidan
    const band = new THREE.BoxGeometry(len * 0.8, 0.14, 0.01); band.translate(0, CH * 0.55, CD / 2 + 0.005); add(band, '#e2601d');
    for (const sx of [-0.3, 0.3]) { const hd = new THREE.BoxGeometry(0.16, 0.04, 0.04); hd.translate(sx * len, CH * 0.8, CD / 2 + 0.02); add(hd, '#c9a23a'); }
    const m = mergeGeometries(parts);
    m.rotateY(rot); m.translate(x, 0, z);
    b.add(m, null);
  }
  b.mesh(scene, paintMat(0.55));
}
