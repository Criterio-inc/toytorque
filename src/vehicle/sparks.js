import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Små partiklar som flyger och faller: gnistor (lysande, korta) och konfetti
// (färgglad, långsam). Samma poolade punktmoln som dammet i dust.js, men med
// tyngdkraft och egna färger per partikel.
// ---------------------------------------------------------------------------

export class Bits {
  // glow: lägger ljuset ovanpå bilden (gnistor). gravity i m/s², drag per sekund.
  constructor(group, { max = 600, glow = true, gravity = 9, drag = 0.6 } = {}) {
    this.max = max; this.gravity = gravity; this.drag = drag;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.full = new Float32Array(max);
    this.head = 0;
    this.alive = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      // Gnistor är runda och mjuka i kanten, konfetti är små fyrkanter
      fragmentShader: glow
        ? `varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vC.rgb, vC.a * smoothstep(1.0, 0.2, d)); }`
        : `varying vec4 vC; void main(){ gl_FragColor = vC; }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    group.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, size, life, r, g, b) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = 1;
    this.size[i] = size;
    this.life[i] = this.full[i] = life;
    this.alive = Math.max(this.alive, life);
  }

  // Gnistregn från en punkt. dir (valfri) är åt vilket håll de mest kastas.
  sparks(p, strength = 1, dir = null) {
    const n = Math.min(36, Math.round(6 + strength * 7));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = (1.2 + Math.random() * 3.2) * Math.min(1.6, 0.6 + strength * 0.3);
      const hot = Math.random();
      this.emit(p.x, p.y + 0.03, p.z,
        Math.cos(a) * s + (dir ? dir.x * 2 : 0), 0.8 + Math.random() * 2.6, Math.sin(a) * s + (dir ? dir.z * 2 : 0),
        0.012 + Math.random() * 0.014, 0.22 + Math.random() * 0.4,
        // Starkare än vitt: då glöder de i efterbehandlingen i stället för att se ut som damm
        3.2, 1.1 + hot * 1.2, 0.15 + hot * 0.5);
    }
  }

  // Konfetti som kastas upp runt en punkt och singlar ner
  confetti(p, n = 180) {
    const pal = [[1, 0.25, 0.3], [1, 0.82, 0.2], [0.3, 0.85, 0.4], [0.25, 0.6, 1], [1, 0.5, 0.9], [1, 1, 1]];
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 2.4, c = pal[k % pal.length];
      this.emit(p.x + Math.cos(a) * 0.3, p.y + 0.3 + Math.random() * 0.5, p.z + Math.sin(a) * 0.3,
        Math.cos(a) * s, 2.2 + Math.random() * 2.8, Math.sin(a) * s,
        0.035 + Math.random() * 0.025, 2 + Math.random() * 1.6, c[0], c[1], c[2]);
    }
  }

  update(dt) {
    if (this.alive <= 0) return; // inget i luften: hoppa över hela slingan
    this.alive -= dt;
    const drag = Math.exp(-dt * this.drag);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k] *= drag; this.vel[k + 2] *= drag;
      this.vel[k + 1] = this.vel[k + 1] * drag - this.gravity * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      // Studsa en gång mot marken så att gnistorna inte försvinner ner i vägen
      if (this.pos[k + 1] < 0.01 && this.vel[k + 1] < 0) { this.pos[k + 1] = 0.01; this.vel[k + 1] *= -0.35; }
      this.col[i * 4 + 3] = this.life[i] <= 0 ? 0 : Math.min(1, (this.life[i] / this.full[i]) * 2.5);
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = true; g.color.needsUpdate = true; g.size.needsUpdate = true;
  }
}
