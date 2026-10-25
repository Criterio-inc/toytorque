import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Vapeneffekter: eld, rök, blixtar, ringar och märken på marken.
//
// Allt ritas med fem poolade instansmeshar (ett ritanrop var, oavsett hur
// många partiklar som lever):
//   glow    additiva billboards (eld, gnistor, energi, glöd). Färger över 1
//           är HDR, så efterbehandlingens glöd (tröskel 2.2) tar dem.
//   smoke   vanligt blandade billboards (rök, vattendroppar, olja)
//   streaks kamerariktade band mellan två punkter (blixtar, fartstreck,
//           avgaslågor, rörelsesläp)
//   decals  platta märken på marken (sot, vått, oljestänk) ur en texturatlas
//   rings   additiva ringar, platta på marken eller vända mot kameran
//
// Inga geometrier eller material skapas per skott. "now"-varianterna ritar
// något bara den här bildrutan (sådant som följer en bil eller en projektil).
// low = true (Grafik: Enkel) glesar ut partiklarna.
// ---------------------------------------------------------------------------

const QUAD_C = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
const QUAD_S = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0];

function instGeo(verts, attrs, max) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const out = {};
  for (const [k, n] of Object.entries(attrs)) {
    out[k] = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(k, out[k]);
  }
  g.instanceCount = 0;
  return { g, out };
}

function flush(mesh, out, n) {
  mesh.geometry.instanceCount = n;
  mesh.visible = n > 0;
  if (!n) return;
  for (const k in out) {
    const a = out[k];
    a.clearUpdateRanges();
    a.addUpdateRange(0, n * a.itemSize);
    a.needsUpdate = true;
  }
}

function makeMesh(group, g, mat, order) {
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.renderOrder = order;
  m.visible = false;
  group.add(m);
  return m;
}

const TAIL = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

// --- Billboards (glöd och rök) ------------------------------------------------
class Billboards {
  constructor(group, max, { additive, map = null, order, fadeIn = 0, immMax = 384, colorPow = 1 }) {
    this.max = max;
    this.head = 0;
    this.fadeIn = fadeIn;
    this.colorPow = colorPow; // >1: startfärgen släpper snabbare (rök som slutar lysa)
    this.additive = additive;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.floor = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.rv = new Float32Array(max);
    this.immMax = immMax;
    this.imm = new Float32Array(immMax * 9);
    this.nImm = 0;
    const { g, out } = instGeo(QUAD_C, { iPos: 3, iCol: 4, iSR: 2 }, max + immMax);
    this.out = out;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: !additive,
      uniforms: additive ? {} : THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: map } }]),
      vertexShader: `
        attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSR;
        varying vec4 vC; varying vec2 vUv;
        #include <fog_pars_vertex>
        void main(){
          vC = iCol; vUv = position.xy + 0.5;
          vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
          float c = cos(iSR.y), s = sin(iSR.y);
          mvPosition.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSR.x;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: additive ? `
        varying vec4 vC; varying vec2 vUv;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float a = max(0.0, 1.0 - d);
          a = a * a * (0.35 + 0.65 * a) + 0.6 * pow(max(0.0, 1.0 - d * 2.2), 2.0);
          gl_FragColor = vec4(vC.rgb, vC.a * a);
          ${TAIL}
        }` : `
        uniform sampler2D map; varying vec4 vC; varying vec2 vUv;
        #include <fog_pars_fragment>
        void main(){
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(vC.rgb * (0.7 + 0.45 * t.r), vC.a * t.a);
          ${TAIL}
          #include <fog_fragment>
        }`,
    });
    this.mesh = makeMesh(group, g, mat, order);
  }

  // Position, fart, livstid, storlek start→slut, färg start→slut, alfa,
  // luftmotstånd, tyngd (negativ = stiger), golvhöjd att studsa mot
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r0, g0, b0, r1, g1, b1, a, drag = 0, grav = 0, floor = -1e9) {
    const i = this.head;
    this.head = (i + 1) % this.max;
    const k = i * 3;
    this.p[k] = x; this.p[k + 1] = y; this.p[k + 2] = z;
    this.v[k] = vx; this.v[k + 1] = vy; this.v[k + 2] = vz;
    this.c0[k] = r0; this.c0[k + 1] = g0; this.c0[k + 2] = b0;
    this.c1[k] = r1; this.c1[k + 1] = g1; this.c1[k + 2] = b1;
    this.a[i] = a;
    this.life[i] = this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    this.drag[i] = drag; this.grav[i] = grav; this.floor[i] = floor;
    this.rot[i] = Math.random() * 6.283;
    this.rv[i] = (Math.random() - 0.5) * 2.4;
  }

  // Bara den här bildrutan
  now(x, y, z, size, r, g, b, a, rot = 0) {
    if (this.nImm >= this.immMax) return;
    const o = this.nImm++ * 9;
    const m = this.imm;
    m[o] = x; m[o + 1] = y; m[o + 2] = z; m[o + 3] = r; m[o + 4] = g; m[o + 5] = b; m[o + 6] = a; m[o + 7] = size; m[o + 8] = rot;
  }

  clear() { this.life.fill(0); this.nImm = 0; }

  update(dt) {
    const P = this.out.iPos.array, C = this.out.iCol.array, S = this.out.iSR.array;
    const fadeIn = this.fadeIn, add = this.additive, cp = this.colorPow;
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const L = (this.life[i] -= dt);
      if (L <= 0) continue;
      const k = i * 3;
      const dr = this.drag[i] > 0 ? Math.exp(-this.drag[i] * dt) : 1;
      this.v[k] *= dr; this.v[k + 2] *= dr;
      this.v[k + 1] = this.v[k + 1] * dr - this.grav[i] * dt;
      this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
      if (this.p[k + 1] < this.floor[i]) {
        this.p[k + 1] = this.floor[i];
        this.v[k + 1] *= -0.35; this.v[k] *= 0.6; this.v[k + 2] *= 0.6;
      }
      this.rot[i] += this.rv[i] * dt;
      const f = L / this.maxLife[i], u = 1 - f;
      const e = 1 - f * f; // storleken växer snabbt först
      let al = this.a[i] * (add ? Math.min(1, f * 1.6) : f);
      if (fadeIn > 0 && u < fadeIn) al *= u / fadeIn;
      const o3 = n * 3, o4 = n * 4;
      P[o3] = this.p[k]; P[o3 + 1] = this.p[k + 1]; P[o3 + 2] = this.p[k + 2];
      const fc = cp === 1 ? f : Math.pow(f, cp);
      C[o4] = this.c1[k] + (this.c0[k] - this.c1[k]) * fc;
      C[o4 + 1] = this.c1[k + 1] + (this.c0[k + 1] - this.c1[k + 1]) * fc;
      C[o4 + 2] = this.c1[k + 2] + (this.c0[k + 2] - this.c1[k + 2]) * fc;
      C[o4 + 3] = al;
      S[n * 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      S[n * 2 + 1] = this.rot[i];
      n++;
    }
    const m = this.imm;
    for (let j = 0; j < this.nImm; j++) {
      const o = j * 9, o3 = n * 3, o4 = n * 4;
      P[o3] = m[o]; P[o3 + 1] = m[o + 1]; P[o3 + 2] = m[o + 2];
      C[o4] = m[o + 3]; C[o4 + 1] = m[o + 4]; C[o4 + 2] = m[o + 5]; C[o4 + 3] = m[o + 6];
      S[n * 2] = m[o + 7]; S[n * 2 + 1] = m[o + 8];
      n++;
    }
    this.nImm = 0;
    flush(this.mesh, this.out, n);
  }
}

// --- Band mellan två punkter (blixtar, streck) --------------------------------
// Bredd i A och B, alfa i B (1 = som A). Tidsatta band kan röra sig (vel).
class Streaks {
  constructor(group, max, immMax = 700) {
    this.max = max;
    this.head = 0;
    this.d = new Float32Array(max * 16); // A3 B3 vel3 col4 w3
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.immMax = immMax;
    this.imm = new Float32Array(immMax * 13);
    this.nImm = 0;
    const { g, out } = instGeo(QUAD_S, { iA: 3, iB: 3, iCol: 4, iW: 3 }, max + immMax);
    this.out = out;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, // bandets vridning beror på riktningen
      vertexShader: `
        attribute vec3 iA; attribute vec3 iB; attribute vec4 iCol; attribute vec3 iW;
        varying vec4 vC; varying float vX;
        void main(){
          vec4 a = modelViewMatrix * vec4(iA, 1.0);
          vec4 b = modelViewMatrix * vec4(iB, 1.0);
          vec3 m = mix(a.xyz, b.xyz, position.y);
          vec3 side = cross(b.xyz - a.xyz, m);
          float l = length(side);
          side = l > 1e-9 ? side / l : vec3(1.0, 0.0, 0.0);
          m += side * position.x * mix(iW.x, iW.y, position.y);
          gl_Position = projectionMatrix * vec4(m, 1.0);
          vC = vec4(iCol.rgb, iCol.a * mix(1.0, iW.z, position.y));
          vX = position.x * 2.0;
        }`,
      fragmentShader: `
        varying vec4 vC; varying float vX;
        void main(){
          float e = 1.0 - vX * vX;
          gl_FragColor = vec4(vC.rgb, vC.a * e * e);
          ${TAIL}
        }`,
    });
    this.mesh = makeMesh(group, g, mat, 6);
  }

  // Tidsatt band (rör sig med vel och bleknar)
  spawn(ax, ay, az, bx, by, bz, vx, vy, vz, life, wA, wB, r, g, b, a, aB = 1) {
    const i = this.head;
    this.head = (i + 1) % this.max;
    const d = this.d, o = i * 16;
    d[o] = ax; d[o + 1] = ay; d[o + 2] = az; d[o + 3] = bx; d[o + 4] = by; d[o + 5] = bz;
    d[o + 6] = vx; d[o + 7] = vy; d[o + 8] = vz;
    d[o + 9] = r; d[o + 10] = g; d[o + 11] = b; d[o + 12] = a;
    d[o + 13] = wA; d[o + 14] = wB; d[o + 15] = aB;
    this.life[i] = this.maxLife[i] = life;
  }

  now(ax, ay, az, bx, by, bz, wA, wB, r, g, b, a, aB = 1) {
    if (this.nImm >= this.immMax) return;
    const m = this.imm, o = this.nImm++ * 13;
    m[o] = ax; m[o + 1] = ay; m[o + 2] = az; m[o + 3] = bx; m[o + 4] = by; m[o + 5] = bz;
    m[o + 6] = r; m[o + 7] = g; m[o + 8] = b; m[o + 9] = a; m[o + 10] = wA; m[o + 11] = wB; m[o + 12] = aB;
  }

  clear() { this.life.fill(0); this.nImm = 0; }

  update(dt) {
    const A = this.out.iA.array, B = this.out.iB.array, C = this.out.iCol.array, W = this.out.iW.array;
    const d = this.d;
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const L = (this.life[i] -= dt);
      if (L <= 0) continue;
      const o = i * 16;
      for (let j = 0; j < 3; j++) { d[o + j] += d[o + 6 + j] * dt; d[o + 3 + j] += d[o + 6 + j] * dt; }
      const f = L / this.maxLife[i];
      const o3 = n * 3, o4 = n * 4;
      A[o3] = d[o]; A[o3 + 1] = d[o + 1]; A[o3 + 2] = d[o + 2];
      B[o3] = d[o + 3]; B[o3 + 1] = d[o + 4]; B[o3 + 2] = d[o + 5];
      C[o4] = d[o + 9]; C[o4 + 1] = d[o + 10]; C[o4 + 2] = d[o + 11]; C[o4 + 3] = d[o + 12] * Math.min(1, f * 1.5);
      W[o3] = d[o + 13]; W[o3 + 1] = d[o + 14]; W[o3 + 2] = d[o + 15];
      n++;
    }
    const m = this.imm;
    for (let j = 0; j < this.nImm; j++) {
      const o = j * 13, o3 = n * 3, o4 = n * 4;
      A[o3] = m[o]; A[o3 + 1] = m[o + 1]; A[o3 + 2] = m[o + 2];
      B[o3] = m[o + 3]; B[o3 + 1] = m[o + 4]; B[o3 + 2] = m[o + 5];
      C[o4] = m[o + 6]; C[o4 + 1] = m[o + 7]; C[o4 + 2] = m[o + 8]; C[o4 + 3] = m[o + 9];
      W[o3] = m[o + 10]; W[o3 + 1] = m[o + 11]; W[o3 + 2] = m[o + 12];
      n++;
    }
    this.nImm = 0;
    flush(this.mesh, this.out, n);
  }
}

// --- Platta kvadrater: märken på marken och ringar ----------------------------
// p: storlek, vridning, ruta i atlasen eller ringens tjocklek, läge (0 platt, 1 mot kameran)
class Flats {
  constructor(group, max, { additive, map = null, order }) {
    this.max = max;
    this.head = 0;
    this.additive = additive;
    this.p = new Float32Array(max * 3);
    this.c = new Float32Array(max * 4);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.prm = new Float32Array(max * 3); // vridning, ruta/tjocklek, läge
    const { g, out } = instGeo(QUAD_C, { iPos: 3, iCol: 4, iP: 4 }, max);
    this.out = out;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      uniforms: { map: { value: map } },
      vertexShader: `
        attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iP;
        varying vec4 vC; varying vec2 vUv; varying float vT;
        void main(){
          vC = iCol; vUv = position.xy + 0.5; vT = iP.z;
          float c = cos(iP.y), s = sin(iP.y);
          vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iP.x;
          vec4 mv;
          if (iP.w > 0.5) { mv = modelViewMatrix * vec4(iPos, 1.0); mv.xy += q; }
          else mv = modelViewMatrix * vec4(iPos + vec3(q.x, 0.0, -q.y), 1.0); // speglad: framsidan uppåt
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: additive ? `
        varying vec4 vC; varying vec2 vUv; varying float vT;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0 - vT, 0.93, d) * (1.0 - smoothstep(0.93, 1.0, d));
          a += 0.12 * (1.0 - smoothstep(0.0, 0.95, d));
          gl_FragColor = vec4(vC.rgb, vC.a * a);
          ${TAIL}
        }` : `
        uniform sampler2D map; varying vec4 vC; varying vec2 vUv; varying float vT;
        void main(){
          vec2 uv = (vUv + vec2(mod(vT, 2.0), floor(vT / 2.0 + 0.01))) * 0.5;
          vec4 t = texture2D(map, uv);
          gl_FragColor = vec4(vC.rgb * t.rgb, vC.a * t.a);
          ${TAIL}
        }`,
    });
    this.mesh = makeMesh(group, g, mat, additive ? 6 : 1);
  }

  spawn(x, y, z, s0, s1, life, r, g, b, a, rot = 0, t = 0, mode = 0, grow = life) {
    const i = this.head;
    this.head = (i + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.c[i * 4] = r; this.c[i * 4 + 1] = g; this.c[i * 4 + 2] = b; this.c[i * 4 + 3] = a;
    this.s0[i] = s0; this.s1[i] = s1; this.grow[i] = grow;
    this.life[i] = this.maxLife[i] = life;
    this.prm[i * 3] = rot; this.prm[i * 3 + 1] = t; this.prm[i * 3 + 2] = mode;
  }

  clear() { this.life.fill(0); }

  update(dt) {
    const P = this.out.iPos.array, C = this.out.iCol.array, Q = this.out.iP.array;
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const L = (this.life[i] -= dt);
      if (L <= 0) continue;
      const age = this.maxLife[i] - L, f = L / this.maxLife[i];
      const g = Math.min(1, age / this.grow[i]);
      const e = 1 - (1 - g) * (1 - g) * (1 - g);
      const o3 = n * 3, o4 = n * 4;
      P[o3] = this.p[i * 3]; P[o3 + 1] = this.p[i * 3 + 1]; P[o3 + 2] = this.p[i * 3 + 2];
      C[o4] = this.c[i * 4]; C[o4 + 1] = this.c[i * 4 + 1]; C[o4 + 2] = this.c[i * 4 + 2];
      C[o4 + 3] = this.c[i * 4 + 3] * (this.additive ? f * f : Math.min(1, f / 0.35));
      Q[o4] = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      Q[o4 + 1] = this.prm[i * 3]; Q[o4 + 2] = this.prm[i * 3 + 1]; Q[o4 + 3] = this.prm[i * 3 + 2];
      n++;
    }
    flush(this.mesh, this.out, n);
  }
}

// --- Texturer (ritas en gång) --------------------------------------------------
let _smokeTex = null;
function smokeTexture() {
  if (_smokeTex) return _smokeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  // Några mjuka klickar ihop ger en tuss; ljusare uppe till vänster
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2, r = k === 0 ? 0 : 9 + Math.random() * 5;
    const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r, R = k === 0 ? 22 : 11 + Math.random() * 6;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    const lum = Math.round(170 + 85 * Math.max(0, (32 - y) / 22 * 0.6 + (32 - x) / 22 * 0.4));
    g.addColorStop(0, `rgba(${lum},${lum},${lum},0.55)`);
    g.addColorStop(1, `rgba(${lum},${lum},${lum},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  _smokeTex = new THREE.CanvasTexture(c);
  return _smokeTex;
}

// Atlas 2×2: 0 sot, 1 vattenplask, 2 oljestänk
let _decalTex = null;
function decalAtlas() {
  if (_decalTex) return _decalTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const ctx = c.getContext('2d');
  const blob = (x, y, r, a, l = 255) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${l},${l},${l},${a})`);
    g.addColorStop(0.7, `rgba(${l},${l},${l},${a * 0.8})`);
    g.addColorStop(1, `rgba(${l},${l},${l},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  const tile = (i, fn) => { ctx.save(); ctx.translate((i % 2) * S, Math.floor(i / 2) * S); ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip(); fn(); ctx.restore(); };
  // Sot: mörk kärna, ojämn kant och strålar
  tile(0, () => {
    blob(64, 64, 40, 0.9, 200);
    for (let k = 0; k < 26; k++) { const a = Math.random() * 6.283, r = 18 + Math.random() * 22; blob(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 8 + Math.random() * 12, 0.45, 160 + Math.random() * 90); }
    ctx.strokeStyle = 'rgba(200,200,200,0.35)';
    for (let k = 0; k < 22; k++) {
      const a = Math.random() * 6.283, r0 = 20 + Math.random() * 10, r1 = 46 + Math.random() * 16;
      ctx.lineWidth = 1.5 + Math.random() * 3;
      ctx.beginPath(); ctx.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0); ctx.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1); ctx.stroke();
    }
  });
  // Vått: plask med droppar runtom
  tile(1, () => {
    blob(64, 64, 34, 0.85);
    for (let k = 0; k < 10; k++) { const a = Math.random() * 6.283, r = 16 + Math.random() * 16; blob(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 10 + Math.random() * 10, 0.7); }
    for (let k = 0; k < 22; k++) { const a = Math.random() * 6.283, r = 38 + Math.random() * 22; blob(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + Math.random() * 4, 0.8); }
  });
  // Oljestänk: liten klick med stänk åt ett håll
  tile(2, () => {
    blob(64, 64, 20, 0.95);
    for (let k = 0; k < 12; k++) { const r = 10 + Math.random() * 40, a = (Math.random() - 0.5) * 1.4; blob(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + Math.random() * 6 * (1 - r / 60), 0.9); }
  });
  _decalTex = new THREE.CanvasTexture(c);
  return _decalTex;
}

// --- Oljefläckens utseende (delas av alla fläckar) -----------------------------
const OIL_GEOS = [];
export function oilGeometry(i) {
  if (OIL_GEOS[i]) return OIL_GEOS[i];
  const s = new THREE.Shape();
  const N = 40, ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6, Math.random() * 6];
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI * 2;
    const r = 0.92 + 0.12 * Math.sin(3 * a + ph[0]) + 0.07 * Math.sin(5 * a + ph[1]) + 0.04 * Math.sin(9 * a + ph[2]) + 0.025 * Math.sin(14 * a + ph[3]);
    k ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ShapeGeometry(s, 2);
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 2.4 + 0.5, uv.getY(k) / 2.4 + 0.5);
  g.rotateX(-Math.PI / 2);
  OIL_GEOS[i] = g;
  return g;
}

let _oilMat = null;
export function oilMaterial() {
  if (_oilMat) return _oilMat;
  // Tjockleksvariation för regnbågsskimret: mjuka virvlar
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 40; k++) {
    const x = Math.random() * 128, y = Math.random() * 128, r = 10 + Math.random() * 34, l = Math.round(Math.random() * 255);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${l},${l},${l},0.5)`);
    g.addColorStop(1, `rgba(${l},${l},${l},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  _oilMat = new THREE.MeshPhysicalMaterial({
    color: 0x030304, roughness: 0.06, metalness: 0.1,
    clearcoat: 1, clearcoatRoughness: 0.04,
    iridescence: 0.85, iridescenceIOR: 1.8, iridescenceThicknessRange: [150, 750], iridescenceThicknessMap: tex,
    envMapIntensity: 1.1,
    transparent: true, opacity: 0.95,
    polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
  });
  return _oilMat;
}

// --- Slump -------------------------------------------------------------------------
// Seedad slump så blixtar behåller formen en stund och sedan hoppar
function seeded(s) {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R3 = { x: 0, y: 0, z: 0 };
function rnd3(rand = Math.random) {
  const a = rand() * Math.PI * 2, u = rand() * 2 - 1, h = Math.sqrt(1 - u * u);
  R3.x = Math.cos(a) * h; R3.y = u; R3.z = Math.sin(a) * h;
  return R3;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _arcPts = new Float32Array(3 * 24);

// Färger (HDR: över 2.2 glöder)
const FIRE_HOT = [6, 2.6, 0.6], FIRE_END = [0.9, 0.12, 0.02];
const BLUE_HOT = [1.3, 3.2, 10], BLUE_END = [0.1, 0.3, 1.6];
const GOLD = [5, 3.4, 0.7];

// --- Fasaden som vapensystemet pratar med ---------------------------------------
export class WeaponFx {
  constructor(group) {
    this.glow = new Billboards(group, 2600, { additive: true, order: 5 });
    this.smoke = new Billboards(group, 1500, { additive: false, map: smokeTexture(), order: 4, fadeIn: 0.06, immMax: 16, colorPow: 4 });
    this.streaks = new Streaks(group, 600);
    this.decals = new Flats(group, 64, { additive: false, map: decalAtlas(), order: 1 });
    this.rings = new Flats(group, 64, { additive: true, order: 6 });
    this.low = false;
  }

  get drawCalls() { return [this.glow, this.smoke, this.streaks, this.decals, this.rings].filter((p) => p.mesh.visible).length; }

  // Antal partiklar, glesare i enkel grafik (slumpavrundat)
  q(n) {
    const x = n * (this.low ? 0.35 : 1), i = Math.floor(x);
    return i + (Math.random() < x - i ? 1 : 0);
  }

  clear() { for (const p of [this.glow, this.smoke, this.streaks, this.decals, this.rings]) p.clear(); }

  update(dt) {
    this.glow.update(dt);
    this.smoke.update(dt);
    this.streaks.update(dt);
    this.decals.update(dt);
    this.rings.update(dt);
  }

  // --- Byggstenar ------------------------------------------------------------------
  // Gnistor som faller och studsar (färg som [r,g,b], HDR går bra)
  sparks(p, col, n, speed, life, { size = 0.03, grav = 7, floor = -1e9, up = 0.5, end = null } = {}) {
    const N = this.q(n), e = end || [col[0] * 0.25, col[1] * 0.12, col[2] * 0.1];
    for (let k = 0; k < N; k++) {
      const d = rnd3(), s = speed * (0.35 + Math.random() * 0.65);
      this.glow.spawn(p.x, p.y, p.z, d.x * s, Math.abs(d.y) * s * 0.9 + up, d.z * s, life * (0.5 + Math.random() * 0.5), size, size * 0.3, col[0], col[1], col[2], e[0], e[1], e[2], 1, 1.2, grav, floor);
    }
  }

  // Taggig blixt från a till b. life < 0: bara den här bildrutan
  arc(ax, ay, az, bx, by, bz, segs, jitter, w, col, alpha, rand = Math.random, life = -1) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1e-4;
    // Två vinkelräta riktningar
    _f.set(dx / len, dy / len, dz / len);
    _v.set(0, 1, 0);
    if (Math.abs(_f.y) > 0.9) _v.set(1, 0, 0);
    _w.crossVectors(_f, _v).normalize();
    _v.crossVectors(_w, _f);
    const P = _arcPts, n = Math.min(segs, 23);
    for (let i = 0; i <= n; i++) {
      const t = i / n, env = Math.sin(Math.PI * t) * jitter;
      const j1 = (rand() - 0.5) * 2 * env, j2 = (rand() - 0.5) * 2 * env;
      P[i * 3] = ax + dx * t + _w.x * j1 + _v.x * j2;
      P[i * 3 + 1] = ay + dy * t + _w.y * j1 + _v.y * j2;
      P[i * 3 + 2] = az + dz * t + _w.z * j1 + _v.z * j2;
    }
    const S = this.streaks;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      if (life < 0) {
        S.now(P[o], P[o + 1], P[o + 2], P[o + 3], P[o + 4], P[o + 5], w, w, col[0], col[1], col[2], alpha);
        S.now(P[o], P[o + 1], P[o + 2], P[o + 3], P[o + 4], P[o + 5], w * 0.3, w * 0.3, col[0] * 0.5 + 1.5, col[1] * 0.5 + 1.5, col[2] * 0.5 + 1.5, alpha);
      } else {
        S.spawn(P[o], P[o + 1], P[o + 2], P[o + 3], P[o + 4], P[o + 5], 0, 0, 0, life, w, w, col[0], col[1], col[2], alpha);
        S.spawn(P[o], P[o + 1], P[o + 2], P[o + 3], P[o + 4], P[o + 5], 0, 0, 0, life, w * 0.3, w * 0.3, col[0] * 0.5 + 1.5, col[1] * 0.5 + 1.5, col[2] * 0.5 + 1.5, alpha);
      }
    }
  }

  // --- Explosioner -------------------------------------------------------------------
  // p: centrum, gy: markhöjd, S: storlek (1 = fyrverkeri, 1.7 = bomb)
  explosion(p, gy, S = 1) {
    const G = this.glow;
    const low = p.y - gy < 0.6;
    // Blixt och eldklot
    const R = Math.sqrt(S); // blixten växer inte lika mycket som resten
    G.spawn(p.x, p.y + 0.05, p.z, 0, 0, 0, 0.17, 0.3 * R, 1.3 * R, 7, 4.5, 2, 2.5, 0.7, 0.1, 1);
    G.spawn(p.x, p.y + 0.05, p.z, 0, 0.3, 0, 0.5, 0.5 * R, 1.1 * R, 3, 1.2, 0.3, 0.6, 0.1, 0.02, 0.5, 2);
    for (let k = 0, N = this.q(14 * S); k < N; k++) {
      const d = rnd3(), sp = (0.5 + Math.random() * 1.4) * S;
      G.spawn(p.x + d.x * 0.05, p.y + d.y * 0.05, p.z + d.z * 0.05, d.x * sp, d.y * sp * 0.7 + 0.5, d.z * sp,
        0.35 + Math.random() * 0.4, 0.16 * S, 0.42 * S, FIRE_HOT[0], FIRE_HOT[1], FIRE_HOT[2], FIRE_END[0], FIRE_END[1], FIRE_END[2], 0.6, 4.5, -0.8);
    }
    // Gnistor och skräp som studsar på marken
    this.sparks(p, [6, 3.6, 1.1], 48 * S, 5.5 * S, 1.1, { size: 0.035, grav: 7, floor: gy + 0.01, up: 1, end: [1.6, 0.25, 0] });
    for (let k = 0, N = this.q(10 * S); k < N; k++) {
      const d = rnd3(), sp = 3 + Math.random() * 3;
      const vx = d.x * sp, vy = Math.abs(d.y) * sp, vz = d.z * sp;
      this.streaks.spawn(p.x, p.y, p.z, p.x - vx * 0.03, p.y - vy * 0.03, p.z - vz * 0.03, vx, vy, vz, 0.18 + Math.random() * 0.1, 0.03, 0, 6, 3.5, 1.2, 1, 0);
    }
    // Chockringar
    if (low) this.rings.spawn(p.x, gy + 0.03, p.z, 0.1, 2.1 * S, 0.5, 4, 2.4, 1.1, 0.9, 0, 0.22, 0, 0.5);
    this.rings.spawn(p.x, p.y + 0.05, p.z, 0.1, 1.3 * S, 0.24, 4, 3.2, 2.2, 0.7, 0, 0.14, 1, 0.24);
    // Rökmoln, upplyst av elden i början
    for (let k = 0, N = this.q(14 * S); k < N; k++) {
      const d = rnd3(), sp = (0.25 + Math.random() * 0.7) * S;
      this.smoke.spawn(p.x + d.x * 0.12 * S, p.y + Math.abs(d.y) * 0.08, p.z + d.z * 0.12 * S, d.x * sp, 0.35 + Math.random() * 0.5, d.z * sp,
        1.8 + Math.random() * 1.6, 0.22 * S, (0.55 + Math.random() * 0.35) * S, 1.3, 0.55, 0.2, 0.13, 0.125, 0.12, 0.85, 2.2, -0.22);
    }
    // Sotfläck
    if (low) this.decals.spawn(p.x, gy + 0.012, p.z, 0.45 * S, 0.9 * S, 11, 0.05, 0.04, 0.035, 0.92, Math.random() * 6.283, 0, 0, 0.12);
  }

  // Kompatibelt med de gamla gnistorna (används av repriserna)
  emit(p, color, n, speed, life) {
    const c = _cc.set(color);
    this.sparks(p, [c.r * 2.5, c.g * 2.5, c.b * 2.5], n, speed, life);
  }

  flash(p) { this.glow.spawn(p.x, p.y, p.z, 0, 0, 0, 0.25, 0.1, 1.2, 8, 6, 3, 3, 1, 0.2, 1); }

  // --- Fyrverkeriraket i luften -----------------------------------------------------------
  // e: entiteten (pos, vel, fxPrev* sätts här)
  rocket(e, dt) {
    const p = e.pos, vl = e.vel.length() || 1;
    const dx = e.vel.x / vl, dy = e.vel.y / vl, dz = e.vel.z / vl;
    const tx = p.x - dx * 0.07, ty = p.y - dy * 0.07, tz = p.z - dz * 0.07;
    const fl = 0.8 + Math.random() * 0.4;
    this.glow.now(tx, ty, tz, 0.16 * fl, 6, 4, 1.6, 1);
    this.glow.now(p.x, p.y, p.z, 0.3, 1.6, 0.6, 0.15, 0.5);
    this.streaks.now(tx, ty, tz, tx - dx * 0.16 * fl, ty - dy * 0.16 * fl, tz - dz * 0.16 * fl, 0.045, 0.0, 7, 4, 1.2, 1, 0.2);
    for (let k = 0, N = this.q(140 * dt); k < N; k++) {
      const d = rnd3(), s = 1 + Math.random() * 0.8;
      this.glow.spawn(tx, ty, tz, -dx * s + d.x * 0.4, -dy * s + d.y * 0.4, -dz * s + d.z * 0.4, 0.1 + Math.random() * 0.12, 0.07, 0.025,
        FIRE_HOT[0], FIRE_HOT[1], FIRE_HOT[2], FIRE_END[0], FIRE_END[1], FIRE_END[2], 1, 2);
    }
    // Tät rökslinga utlagd längs vägen sedan förra bildrutan
    if (e.fxPx === undefined) { e.fxPx = tx; e.fxPy = ty; e.fxPz = tz; }
    const sx = tx - e.fxPx, sy = ty - e.fxPy, sz = tz - e.fxPz;
    const N = this.q(Math.min(14, Math.hypot(sx, sy, sz) / 0.07));
    for (let k = 0; k < N; k++) {
      const t = (k + Math.random()) / N, d = rnd3();
      this.smoke.spawn(e.fxPx + sx * t + d.x * 0.015, e.fxPy + sy * t + d.y * 0.015, e.fxPz + sz * t + d.z * 0.015, d.x * 0.08, 0.06 + d.y * 0.04, d.z * 0.08,
        1.3 + Math.random() * 0.9, 0.05, 0.26 + Math.random() * 0.1, 1.0, 0.85, 0.7, 0.62, 0.62, 0.64, 0.6, 1.4, -0.05);
    }
    e.fxPx = tx; e.fxPy = ty; e.fxPz = tz;
  }

  // --- Chockvåg ---------------------------------------------------------------------------
  shockBall(e, dt, t) {
    const p = e.pos;
    const pulse = 1 + Math.sin(t * 38) * 0.15;
    this.glow.now(p.x, p.y, p.z, 0.5 * pulse, 0.25, 0.8, 3.6, 0.6);
    this.glow.now(p.x, p.y, p.z, 0.2 * pulse, 2, 4, 10, 1);
    for (let k = 0, N = this.q(80 * dt); k < N; k++) {
      const d = rnd3();
      this.glow.spawn(p.x + d.x * 0.06, p.y + d.y * 0.06, p.z + d.z * 0.06, d.x * 0.3, d.y * 0.3 + 0.2, d.z * 0.3, 0.25 + Math.random() * 0.25, 0.1, 0.015,
        BLUE_HOT[0], BLUE_HOT[1], BLUE_HOT[2], BLUE_END[0], BLUE_END[1], BLUE_END[2], 0.9, 1);
    }
    // Sprakande små blixtar runt klotet
    for (let k = 0; k < (this.low ? 1 : 3); k++) {
      const d = rnd3(), r = 0.14 + Math.random() * 0.14;
      this.arc(p.x, p.y, p.z, p.x + d.x * r, p.y + Math.abs(d.y) * r, p.z + d.z * r, 4, 0.05, 0.012, BLUE_HOT, 0.9);
    }
    // Ringar som pulserar ut från klotet
    e.fxRing = (e.fxRing || 0) - dt;
    if (e.fxRing <= 0) {
      e.fxRing = 0.07;
      this.rings.spawn(p.x, p.y, p.z, 0.15, 0.6, 0.26, 0.4, 1.3, 5, 0.5, 0, 0.18, 1, 0.26);
      this.rings.spawn(p.x, p.y - 0.09, p.z, 0.1, 0.55, 0.35, 0.3, 1, 3.5, 0.5, 0, 0.25, 0, 0.35);
    }
  }

  shockBurst(p, gy, S = 1) {
    this.glow.spawn(p.x, p.y + 0.05, p.z, 0, 0, 0, 0.28, 0.25 * S, 1.3 * S, 2.5, 5, 12, 0.2, 0.6, 3, 1);
    this.rings.spawn(p.x, gy + 0.03, p.z, 0.1, 1.7 * S, 0.5, 0.6, 1.8, 7, 0.9, 0, 0.2, 0, 0.5);
    this.rings.spawn(p.x, p.y + 0.05, p.z, 0.1, 1.1 * S, 0.3, 1, 2.5, 8, 0.7, 0, 0.12, 1, 0.3);
    this.sparks(p, BLUE_HOT, 34 * S, 3.5 * S, 0.8, { size: 0.035, floor: gy + 0.01, end: BLUE_END });
    for (let k = 0, N = this.q(12 * S); k < N; k++) {
      const a = (k / N) * Math.PI * 2 + Math.random() * 0.4, sp = 3 + Math.random() * 2;
      const vx = Math.cos(a) * sp, vz = Math.sin(a) * sp, vy = Math.random() * 1.5;
      this.streaks.spawn(p.x, p.y + 0.05, p.z, p.x - vx * 0.05, p.y + 0.05 - vy * 0.05, p.z - vz * 0.05, vx, vy, vz, 0.22, 0.04, 0, 1.6, 4, 11, 1, 0);
    }
  }

  // --- Elchock ------------------------------------------------------------------------------
  // Blixtar runt bilen. key ger nya former några gånger i sekunden.
  electroAura(pos, quat, t, dt, key) {
    const rand = seeded(key * 7919 + Math.floor(t * 14));
    const flick = 0.7 + 0.3 * rand();
    this.glow.now(pos.x, pos.y + 0.08, pos.z, 0.8 * flick, 0.25, 0.6, 1.8, 0.55);
    const nArcs = this.low ? 2 : 4;
    for (let k = 0; k < nArcs; k++) {
      _v.set((rand() - 0.5) * 0.36, 0.02 + rand() * 0.16, (rand() - 0.5) * 0.5).applyQuaternion(quat).add(pos);
      const ax = _v.x, ay = _v.y, az = _v.z;
      _v.set((rand() - 0.5) * 0.36, 0.02 + rand() * 0.16, (rand() - 0.5) * 0.5).applyQuaternion(quat).add(pos);
      this.arc(ax, ay, az, _v.x, _v.y, _v.z, 6, 0.06, 0.014, BLUE_HOT, 0.95, rand);
    }
    for (let k = 0, N = this.q(30 * dt); k < N; k++) {
      const d = rnd3();
      this.glow.spawn(pos.x + d.x * 0.2, pos.y + 0.1 + d.y * 0.08, pos.z + d.z * 0.2, d.x * 0.6, 0.5 + d.y * 0.5, d.z * 0.6, 0.25, 0.03, 0.01, 4, 6, 10, 0.3, 0.6, 2, 1, 1, 5);
    }
  }

  // Båge från den laddade bilen till ett offer
  electroBolt(a, b, t, key) {
    const rand = seeded(key * 104729 + Math.floor(t * 24));
    this.arc(a.x, a.y + 0.1, a.z, b.x, b.y + 0.08, b.z, 9, 0.12, 0.02, BLUE_HOT, 1, rand);
    this.glow.now(b.x, b.y + 0.08, b.z, 0.35, 2, 4, 9, 0.7);
  }

  // Bil som är utslagen av ström: korta gnistrande bågar
  zapped(pos, t, key) {
    const rand = seeded(key * 31337 + Math.floor(t * 18));
    if (rand() < 0.35) return;
    this.glow.now(pos.x, pos.y + 0.08, pos.z, 0.45, 0.35, 0.7, 2, 0.45);
    for (let k = 0; k < 2; k++) {
      const ax = pos.x + (rand() - 0.5) * 0.3, az = pos.z + (rand() - 0.5) * 0.3;
      this.arc(ax, pos.y + 0.04 + rand() * 0.12, az, ax + (rand() - 0.5) * 0.2, pos.y + 0.1 + rand() * 0.1, az + (rand() - 0.5) * 0.2, 4, 0.04, 0.01, BLUE_HOT, 0.8, rand);
    }
  }

  // --- Turbo ---------------------------------------------------------------------------------
  turbo(pos, quat, vel, dt) {
    _f.set(0, 0, 1).applyQuaternion(quat);
    const ex = _v.set(0, 0.05, -0.24).applyQuaternion(quat).add(pos);
    const fl = 0.75 + Math.random() * 0.5;
    this.glow.now(ex.x, ex.y, ex.z, 0.17 * fl, 0.5, 1.4, 6, 0.8);
    this.streaks.now(ex.x, ex.y, ex.z, ex.x - _f.x * 0.2 * fl, ex.y - _f.y * 0.2 * fl, ex.z - _f.z * 0.2 * fl, 0.06, 0, 1, 2.6, 10, 1, 0.1);
    for (let k = 0, N = this.q(90 * dt); k < N; k++) {
      const d = rnd3(), s = 1.5 + Math.random();
      this.glow.spawn(ex.x, ex.y, ex.z, vel.x * 0.8 - _f.x * s + d.x * 0.3, vel.y * 0.8 - _f.y * s + d.y * 0.3, vel.z * 0.8 - _f.z * s + d.z * 0.3,
        0.1 + Math.random() * 0.08, 0.07, 0.02, 0.8, 2, 9, 0.1, 0.3, 2.5, 0.9, 3);
    }
    // Fartstreck som bilen lämnar efter sig
    const sp = Math.hypot(vel.x, vel.y, vel.z);
    if (sp > 2) {
      const ux = vel.x / sp, uy = vel.y / sp, uz = vel.z / sp, len = 0.25 + sp * 0.025;
      for (let k = 0, N = this.q(36 * dt); k < N; k++) {
        const o = _w.set((Math.random() - 0.5) * 0.5, 0.03 + Math.random() * 0.22, (Math.random() - 0.5) * 0.5).applyQuaternion(quat).add(pos);
        this.streaks.spawn(o.x, o.y, o.z, o.x - ux * len, o.y - uy * len, o.z - uz * len, 0, 0, 0, 0.2, 0.008, 0.008, 1.4, 2, 3.2, 0.5, 0);
      }
    }
  }

  // --- Bomb ----------------------------------------------------------------------------------
  // Stubintråden sprakar; on = röda lampan lyser
  bombFuse(tip, light, on, dt) {
    for (let k = 0, N = this.q(50 * dt); k < N; k++) {
      const d = rnd3(), s = 0.4 + Math.random() * 0.8;
      this.glow.spawn(tip.x, tip.y, tip.z, d.x * s, Math.abs(d.y) * s + 0.4, d.z * s, 0.2 + Math.random() * 0.2, 0.03, 0.006, 7, 5, 1.8, 2, 0.4, 0, 1, 0.5, 4);
    }
    this.glow.now(tip.x, tip.y, tip.z, 0.09, 6, 4, 1.4, 1);
    if (Math.random() < 10 * dt) this.smoke.spawn(tip.x, tip.y, tip.z, 0, 0.2, 0, 0.8, 0.03, 0.12, 0.7, 0.7, 0.7, 0.5, 0.5, 0.5, 0.4, 1, -0.1);
    if (on) this.glow.now(light.x, light.y, light.z, 0.55, 7, 0.3, 0.12, 0.85);
  }

  // --- Vattenballong ---------------------------------------------------------------------------
  splash(p, gy) {
    for (let k = 0, N = this.q(34); k < N; k++) {
      const d = rnd3(), s = 1 + Math.random() * 2;
      this.smoke.spawn(p.x, p.y, p.z, d.x * s, Math.abs(d.y) * s + 1, d.z * s, 0.5 + Math.random() * 0.4, 0.035, 0.025, 0.65, 0.85, 1.1, 0.55, 0.75, 1, 0.85, 0.4, 9, gy + 0.01);
    }
    this.sparks(p, [0.9, 1.4, 2.4], 16, 2.4, 0.6, { size: 0.03, grav: 9, floor: gy + 0.01, up: 0.9, end: [0.2, 0.4, 0.8] });
    for (let k = 0, N = this.q(7); k < N; k++) {
      const d = rnd3();
      this.smoke.spawn(p.x + d.x * 0.05, p.y, p.z + d.z * 0.05, d.x * 0.6, 0.3, d.z * 0.6, 0.6 + Math.random() * 0.3, 0.12, 0.45, 0.9, 0.95, 1, 0.85, 0.9, 0.95, 0.45, 3);
    }
    this.rings.spawn(p.x, gy + 0.03, p.z, 0.1, 0.95, 0.4, 0.7, 1.1, 1.6, 0.8, 0, 0.18, 0, 0.4);
    this.decals.spawn(p.x, gy + 0.011, p.z, 0.45, 0.8, 7, 0.14, 0.2, 0.28, 0.6, Math.random() * 6.283, 1, 0, 0.15);
  }

  // --- Olja ------------------------------------------------------------------------------------
  oilSplat(c, vx, vz, gy, mark) {
    for (let k = 0, N = this.q(3); k < N; k++) {
      this.smoke.spawn(c.x, c.y + 0.02, c.z, -vx * 0.15 + (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.8, -vz * 0.15 + (Math.random() - 0.5) * 0.6,
        0.45, 0.028, 0.02, 0.03, 0.03, 0.035, 0.02, 0.02, 0.02, 0.95, 0.5, 9, gy + 0.005);
    }
    if (mark) this.decals.spawn(c.x - vx * 0.03, gy + 0.011, c.z - vz * 0.03, 0.12, 0.2, 4, 0.03, 0.03, 0.035, 0.9, Math.atan2(-vz, -vx), 2, 0, 0.1);
  }

  // --- Kullager --------------------------------------------------------------------------------
  bearing(p, vel) {
    const sp = Math.hypot(vel.x, vel.y, vel.z);
    this.glow.now(p.x - 0.03, p.y + 0.05, p.z - 0.02, 0.07, 2.4, 2.4, 2.6, 0.9);
    if (sp > 1) {
      const k = Math.min(0.06, 0.4 / sp);
      this.streaks.now(p.x, p.y, p.z, p.x - vel.x * k, p.y - vel.y * k, p.z - vel.z * k, 0.18, 0.04, 0.8, 0.85, 0.95, 0.28, 0);
    }
  }

  metalHit(p, strength, gy) {
    this.sparks(p, [7, 5.5, 2.5], 6 + strength * 4, 1.5 + strength * 0.5, 0.45, { size: 0.025, grav: 8, floor: gy + 0.005, up: 0.6 });
    this.glow.spawn(p.x, p.y, p.z, 0, 0, 0, 0.1, 0.1, 0.3, 6, 5, 3, 2, 1, 0.5, 0.8);
  }

  // --- Stjärna ---------------------------------------------------------------------------------
  starBurst(p) {
    this.glow.spawn(p.x, p.y + 0.1, p.z, 0, 0, 0, 0.35, 0.3, 1.3, GOLD[0], GOLD[1], GOLD[2], 2, 1, 0.2, 0.9);
    this.rings.spawn(p.x, p.y + 0.1, p.z, 0.1, 1.8, 0.45, GOLD[0] * 0.6, GOLD[1] * 0.6, GOLD[2] * 0.6, 0.8, 0, 0.1, 1, 0.45);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2, sp = 3.5;
      const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp * 0.6 + 0.6, vz = Math.sin(a) * sp;
      const len = k % 2 ? 0.25 : 0.45;
      this.streaks.spawn(p.x, p.y + 0.1, p.z, p.x - vx * len * 0.3, p.y + 0.1 - vy * len * 0.3, p.z - vz * len * 0.3, vx, vy, vz, 0.4, 0.07, 0, GOLD[0], GOLD[1], GOLD[2], 1, 0);
    }
    this.sparks(p, GOLD, 40, 3, 0.9, { size: 0.035, grav: 3 });
  }

  starHit(from, to) {
    this.arc(from.x, from.y + 0.15, from.z, to.x, to.y + 0.1, to.z, 12, 0.25, 0.018, GOLD, 1, Math.random, 0.35);
    this.glow.spawn(to.x, to.y + 0.1, to.z, 0, 0, 0, 0.3, 0.2, 0.7, 6, 5, 3, 2, 1.4, 0.3, 0.9);
    this.sparks(to, GOLD, 20, 2, 0.7, { size: 0.03, grav: 4 });
  }

  // --- Pickuper --------------------------------------------------------------------------------
  pickupHalo(p, t) {
    const s = 0.36 + 0.05 * Math.sin(t * 5 + p.x * 3);
    this.glow.now(p.x, p.y, p.z, s, 1.5, 0.7, 0.15, 0.5);
  }

  pickupBurst(p) {
    this.glow.spawn(p.x, p.y, p.z, 0, 0, 0, 0.22, 0.15, 0.6, 5, 3.4, 1, 2, 0.5, 0.1, 1);
    this.rings.spawn(p.x, p.y - 0.2, p.z, 0.1, 0.75, 0.35, 3, 1.7, 0.4, 0.9, 0, 0.25, 0, 0.35);
    this.sparks(p, [5, 3.2, 0.8], 22, 1.8, 0.6, { size: 0.03, grav: 4, up: 0.8 });
  }

  // --- Träff på en bil: kort vit blixt och rökpuff ----------------------------------------------
  hitFlash(p) {
    this.glow.spawn(p.x, p.y + 0.08, p.z, 0, 0, 0, 0.16, 0.35, 0.6, 5, 5, 5.5, 1.5, 1.2, 1, 0.9);
    for (let k = 0, N = this.q(5); k < N; k++) {
      const d = rnd3();
      this.smoke.spawn(p.x + d.x * 0.08, p.y + 0.1, p.z + d.z * 0.08, d.x * 0.4, 0.4 + Math.random() * 0.3, d.z * 0.4, 0.8 + Math.random() * 0.5, 0.1, 0.32, 0.4, 0.38, 0.36, 0.3, 0.29, 0.28, 0.6, 2.5, -0.2);
    }
  }
}

const _cc = new THREE.Color();
