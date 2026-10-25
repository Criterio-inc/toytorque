import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Sladdspår: en ringbuffert av fyrhörningar i en enda geometri. Hjul som
// glider lägger ett nytt segment när de rört sig en bit; de äldsta skrivs över.
// ---------------------------------------------------------------------------

const MAX = 3000;

export class Skidmarks {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 4 * 3);
    this.alpha = new Float32Array(MAX * 4);
    const idx = new Uint32Array(MAX * 6);
    for (let i = 0; i < MAX; i++) {
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { color: { value: new THREE.Color(0x141414) } }]),
      vertexShader: `
        attribute float alpha; varying float vA;
        #include <fog_pars_vertex>
        void main(){ vA = alpha; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform vec3 color; varying float vA;
        #include <fog_pars_fragment>
        void main(){ gl_FragColor = vec4(color, vA * 0.55);
        #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.head = 0;
    this.trails = new Map(); // nyckel per hjul → senaste punkt
  }

  // Anropas per renderad bild för varje bil.
  update(vehicle) {
    const w = vehicle.def.wheel.width * 0.5;
    vehicle.wheels.forEach((wh, i) => {
      const key = vehicle.uid * 8 + i;
      const last = this.trails.get(key);
      if (!wh.grounded || !wh.skid) { this.trails.delete(key); return; }
      const p = wh.contact;
      // Sidvektor = normal × färdriktning (ungefär)
      if (!last) { this.trails.set(key, { x: p.x, y: p.y, z: p.z, sx: 0, sz: 0, a: 0 }); return; }
      const dx = p.x - last.x, dz = p.z - last.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.06) return;
      const sx = (-dz / len) * w, sz = (dx / len) * w;
      const strength = Math.min(1, (wh.slide - 0.9) * 2);
      const o = this.head * 12;
      const y0 = last.y + 0.004, y1 = p.y + 0.004;
      const lsx = last.a ? last.sx : sx, lsz = last.a ? last.sz : sz;
      this.pos.set([last.x - lsx, y0, last.z - lsz, last.x + lsx, y0, last.z + lsz, p.x - sx, y1, p.z - sz, p.x + sx, y1, p.z + sz], o);
      this.alpha.set([last.a, last.a, strength, strength], this.head * 4);
      this.head = (this.head + 1) % MAX;
      this.trails.set(key, { x: p.x, y: p.y, z: p.z, sx, sz, a: strength });
      this.dirty = true;
    });
  }

  flush() {
    if (!this.dirty) return;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.dirty = false;
  }

  clear() {
    this.alpha.fill(0);
    this.trails.clear();
    this.dirty = true;
  }
}
