import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Strålkastare och bakljus på kvällen. Alla bilar får lysande lampor och ett
// ljussken på vägen framför sig (en plan yta som läggs ovanpå med additiv
// blandning: billigt, och det räcker för att se var de andra bilarna är).
// Spelarens bil får dessutom en riktig strålkastare som lyser upp det den
// pekar på. En riktig lampa per bil hade kostat för mycket.
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (k, fn) => (cache.has(k) ? cache.get(k) : (cache.set(k, fn()), cache.get(k)));

// Ljuskägla sedd uppifrån: smal vid bilen (nederkanten), bred och svag längre fram
function beamTexture() {
  return cached('beam', () => {
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = 1 - y / S;                         // 0 vid bilen, 1 längst fram
      const half = 0.16 + 0.34 * d;                // käglans halva bredd här
      const side = Math.abs(x / S - 0.5) / half;
      const v = Math.max(0, 1 - side * side) * Math.pow(1 - d, 1.3) * Math.min(1, d * 9);
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(255 * v);
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

function glowTexture() {
  return cached('glow', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d'), g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, '#9a9a9a'); g.addColorStop(1, '#000000');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

const beamMat = () => cached('beamMat', () => new THREE.MeshBasicMaterial({
  map: beamTexture(), color: 0xffe9c0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
  depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
}));
const lampMat = (color) => cached('lamp' + color, () => new THREE.SpriteMaterial({
  map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
}));

export class Headlights {
  constructor(cars, player) {
    this.items = [];
    for (const car of cars) {
      const root = car.model.root, w = car.vehicle.def.wheel;
      // Karossens mått i bilens egna axlar: lamporna ska sitta på nos och akter, inte inne i
      // karossen. Mäts med bilen nollställd; nästa bild sätter tillbaka läget.
      root.position.set(0, 0, 0); root.quaternion.identity(); root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(car.model.chassis);
      const zF = box.max.z + 0.004, zR = box.min.z - 0.004, x = Math.min(w.x, box.max.x) * 0.62;
      const yL = box.min.y + 0.05; // strax över stötfångaren (lådans höjd går inte att använda: antennen räknas in)
      // Skenet på vägen: ligger i bilens eget plan, så det följer backar och doseringar
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.4).rotateX(-Math.PI / 2).rotateY(Math.PI), beamMat());
      beam.position.set(0, -(w.radius - (w.attachY ?? 0)) + 0.012, zF + 1.72);
      beam.renderOrder = 1;
      root.add(beam);
      for (const [sx, z, color, size] of [[-1, zF, 0xfff2cf, 0.075], [1, zF, 0xfff2cf, 0.075], [-1, zR, 0xff2a1a, 0.06], [1, zR, 0xff2a1a, 0.06]]) {
        const s = new THREE.Sprite(lampMat(color));
        s.scale.setScalar(size);
        s.position.set(sx * x, z < 0 ? yL + 0.035 : yL, z); // bakljusen sitter lite högre än strålkastarna
        root.add(s);
      }
      this.items.push({ car, beam });
    }
    // Spelarens bil lyser upp omgivningen på riktigt (ingen skugga: en lampa till skuggkartan kostar för mycket)
    if (player) {
      const root = player.model.root;
      const spot = new THREE.SpotLight(0xffe6b8, 5, 11, 0.5, 0.75, 1.3);
      spot.position.set(0, 0.07, 0.2);
      spot.target.position.set(0, -0.25, 4);
      root.add(spot, spot.target);
    }
  }

  // Skenet på vägen syns bara när bilen står på hjulen
  update() {
    for (const { car, beam } of this.items) beam.visible = car.vehicle.grounded >= 2;
  }
}
