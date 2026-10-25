import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Stuntläget: fri körning i Stuntarenan och jakt på 20 guldstjärnor.
//
// En stjärna tas när bilens mitt passerar inom `collectRadius` (0,5 m) från
// stjärnans mitt. Då gnistrar det, händelsen 'star' skickas och framstegen
// sparas i localStorage under 'revolt.stunt':
//   { stars: [index, ...], allStars: bool }
// Tagna stjärnor ligger kvar som tagna mellan körningarna.
// När alla 20 är tagna sätts allStars: true (en upplåst bonus).
//
// Klassen fungerar utan scen (testskriptet): då byggs ingen grafik och inget
// sparas om persist = false.
// ---------------------------------------------------------------------------

export const STUNT_KEY = 'revolt.stunt';

export function loadStuntProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(STUNT_KEY)) || {};
    return { stars: Array.isArray(p.stars) ? p.stars.filter((i) => Number.isInteger(i)) : [], allStars: !!p.allStars };
  } catch {
    return { stars: [], allStars: false };
  }
}

function saveStuntProgress(p) {
  try { localStorage.setItem(STUNT_KEY, JSON.stringify(p)); } catch { /* inget sparande */ }
}

export class StuntSession {
  constructor({ level, scene = null, events = null, persist = true }) {
    this.def = level.stunt;
    this.events = events || { emit() {} };
    this.persist = persist;
    this.radius = this.def.collectRadius ?? 0.5;
    this.progress = persist ? loadStuntProgress() : { stars: [], allStars: false };
    this.stars = this.def.stars.map((s, i) => ({ ...s, index: i, got: this.progress.stars.includes(i) }));
    this.time = 0;
    this.scene = scene;
    this.sparks = [];
    if (scene) this._build(scene);
  }

  get count() { return this.stars.filter((s) => s.got).length; }
  get total() { return this.stars.length; }

  // Efter world.step(): loopstyrning och stjärnor
  step(dt, vehicle) {
    this.time += dt;
    for (const g of this.def.guides || []) g.apply(vehicle);
    const p = vehicle.body.translation();
    if (!Number.isFinite(p.x + p.y + p.z)) return;
    const r2 = this.radius * this.radius;
    for (const s of this.stars) {
      if (s.got) continue;
      if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 + (p.z - s.z) ** 2 < r2) this.collect(s);
    }
  }

  collect(s) {
    s.got = true;
    if (!this.progress.stars.includes(s.index)) this.progress.stars.push(s.index);
    const all = this.count === this.total;
    const first = all && !this.progress.allStars;
    if (all) this.progress.allStars = true;
    if (this.persist) saveStuntProgress(this.progress);
    this._burst(s);
    this.events.emit('star', { index: s.index, count: this.count, total: this.total, pos: { x: s.x, y: s.y, z: s.z }, all: first });
  }

  // Börja om: alla stjärnor tillbaka (bonusen ligger kvar)
  resetStars() {
    for (const s of this.stars) s.got = false;
    this.progress.stars = [];
    if (this.persist) saveStuntProgress(this.progress);
  }

  // Närmaste startpunkt (för R och för bilar som ramlat ut)
  respawnPose(p) {
    let best = this.def.spawns[0], bd = Infinity;
    for (const s of this.def.spawns) {
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return { x: best.x, y: 0, z: best.z, heading: best.heading };
  }

  // --- Grafik ------------------------------------------------------------------

  _build(scene) {
    const n = this.stars.length;
    this.group = new THREE.Group();
    scene.add(this.group);
    // Stjärnorna: en instansierad, lysande guldstjärna
    const mat = new THREE.MeshStandardMaterial({ color: 0xffc928, emissive: 0xffa000, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.25 });
    this.mesh = new THREE.InstancedMesh(starGeometry(), mat, n);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    // Glorior: punkter med mjuk radiell textur, additivt
    const gp = new Float32Array(n * 3);
    this.stars.forEach((s, i) => gp.set([s.x, s.y, s.z], i * 3));
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    this.glow = new THREE.Points(gg, new THREE.PointsMaterial({
      size: 1.5, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffc240, sizeAttenuation: true,
    }));
    this.glow.frustumCulled = false;
    this.group.add(this.glow);
    // Gnistor: en pool av punkter
    const SP = 160;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SP * 3), 3));
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SP * 3), 3));
    this.sparkPts = new THREE.Points(sg, new THREE.PointsMaterial({
      size: 0.32, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.sparkPts.frustumCulled = false;
    this.group.add(this.sparkPts);
    this.sparkPool = Array.from({ length: SP }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), c: new THREE.Color() }));
    this.render(0, 0);
  }

  _burst(s) {
    if (!this.sparkPool) return;
    let k = 0;
    for (const sp of this.sparkPool) {
      if (sp.life > 0) continue;
      sp.life = 0.6 + Math.random() * 0.6;
      sp.p.set(s.x, s.y, s.z);
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, sp0 = 2 + Math.random() * 3;
      const r = Math.sqrt(1 - u * u);
      sp.v.set(Math.cos(a) * r * sp0, u * sp0 + 2, Math.sin(a) * r * sp0);
      sp.c.setHSL(0.11 + Math.random() * 0.05, 1, 0.55 + Math.random() * 0.35);
      if (++k >= 50) break;
    }
  }

  render(dt, t) {
    if (!this.mesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const gpos = this.glow.geometry.attributes.position;
    this.stars.forEach((s, i) => {
      const bob = Math.sin(t * 2.2 + i * 1.7) * 0.05;
      e.set(0, t * 2.4 + i, 0);
      q.setFromEuler(e);
      pos.set(s.x, s.y + bob, s.z);
      sc.setScalar(s.got ? 0 : 1);
      this.mesh.setMatrixAt(i, m.compose(pos, q, sc));
      gpos.setXYZ(i, s.x, s.got ? -100 : s.y + bob, s.z);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    gpos.needsUpdate = true;
    this.glow.material.size = 1.3 + Math.sin(t * 4) * 0.15;

    // Gnistor
    const sp = this.sparkPts.geometry.attributes.position, sc2 = this.sparkPts.geometry.attributes.color;
    this.sparkPool.forEach((p, i) => {
      if (p.life > 0) {
        p.life -= dt;
        p.v.y -= 6 * dt;
        p.v.multiplyScalar(Math.exp(-dt * 1.5));
        p.p.addScaledVector(p.v, dt);
        const k = Math.min(1, p.life * 2);
        sp.setXYZ(i, p.p.x, p.p.y, p.p.z);
        sc2.setXYZ(i, p.c.r * k, p.c.g * k, p.c.b * k);
      } else {
        sp.setXYZ(i, 0, -100, 0);
      }
    });
    sp.needsUpdate = true;
    sc2.needsUpdate = true;
  }

  dispose() {
    if (!this.group) return;
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
  }
}

// Femuddig stjärna, extruderad med fasning (ca 0,44 m bred)
function starGeometry() {
  const shape = new THREE.Shape();
  const R = 0.22, r = 0.095;
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? R : r;
    if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 2 });
  g.translate(0, 0, -0.025);
  g.computeVertexNormals();
  return g;
}

let _glow = null;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,235,160,0.7)');
  g.addColorStop(1, 'rgba(255,200,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}
