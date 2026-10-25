import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Damm, grus och däckrök som sprutar från hjulen när bilarna sladdar, gasar
// hårt eller landar. Färgen följer banans underlag (level.dust).
// En poolad punktmoln med mjuka runda partiklar som växer och bleknar.
// ---------------------------------------------------------------------------

const MAX = 1400;
let _tex = null;
function puffTexture() {
  if (_tex) return _tex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _tex = new THREE.CanvasTexture(c);
  return _tex;
}

export class Dust {
  constructor(group, color = 0xb9a58a) {
    this.color = new THREE.Color(color);
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.max = new Float32Array(MAX);
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: puffTexture() }, scale: { value: 600 } }]),
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vC;
        uniform float scale;
        #include <fog_pars_vertex>
        void main(){ vC = color; vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / -mvPosition.z; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec4 vC;
        #include <fog_pars_fragment>
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a);
          #include <fog_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    group.add(this.points);
    this._c = new THREE.Color();
  }

  emit(p, vx, vy, vz, size, life, color = this.color, alpha = 0.55) {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = color.r; this.col[i * 4 + 1] = color.g; this.col[i * 4 + 2] = color.b; this.col[i * 4 + 3] = alpha;
    this.size[i] = size;
    this.life[i] = this.max[i] = life;
  }

  // Anropas per bild för varje bil
  fromCar(v, dt) {
    const speed = Math.abs(v.speed);
    for (const wh of v.wheels) {
      if (!wh.grounded) continue;
      const slide = wh.slide || 0;
      const spin = wh.driven && v.motor > 0.6 && speed < v.def.topSpeed * 0.35;
      const rate = (slide > 0.85 ? (slide - 0.75) * 50 : 0) + (spin ? 25 : 0) + speed * 0.25;
      let n = rate * dt;
      while (n > 0) {
        if (n < 1 && Math.random() > n) break;
        n -= 1;
        const c = wh.contact;
        const back = 0.6 + Math.random() * 0.8;
        // Sprutar bakåt och utåt från hjulet, lite uppåt
        const lv = v.body.linvel();
        this.emit(c,
          -lv.x * 0.12 * back + (Math.random() - 0.5) * 0.6,
          0.25 + Math.random() * 0.5,
          -lv.z * 0.12 * back + (Math.random() - 0.5) * 0.6,
          0.07 + Math.random() * 0.07, 0.6 + Math.random() * 0.7);
      }
    }
  }

  // Landning eller krock: ett moln
  burst(p, strength = 1) {
    const n = Math.min(40, 8 + strength * 6);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = 0.4 + Math.random() * 1.2 * strength;
      this.emit(p, Math.cos(a) * s, 0.2 + Math.random() * 0.6, Math.sin(a) * s, 0.08 + Math.random() * 0.08, 0.6 + Math.random() * 0.6);
    }
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      const drag = Math.exp(-dt * 2.5);
      this.vel[k] *= drag; this.vel[k + 2] *= drag;
      this.vel[k + 1] = this.vel[k + 1] * drag - 0.4 * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += dt * 0.18; // växer
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      const f = this.life[i] / this.max[i];
      this.col[i * 4 + 3] = Math.min(0.6, f * 0.85);
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = true; g.color.needsUpdate = true; g.size.needsUpdate = true;
  }
}
