import * as THREE from 'three';
import { G, groups } from '../core/physics.js';

// ---------------------------------------------------------------------------
// Saker i terrängen på öppna banor: sådant som finns på platsen på riktigt och
// som en leksaksbil kan köra över eller igenom. Spelaren väljer själv om den
// tar dem. Datorförarna håller sin linje.
//   addMound       gräskulle: en mjuk kulle att lätta över
//   addKicker      skejtramp i plywood (hör hemma på en skejtyta, inte i gräset)
//   addSlab        betongplatta under skejtramper
//   addPlayTunnel  krypgång på en lekplats
//   addSewerPipe   avloppsrör som ligger på en byggplats
// Regeln: ställ aldrig ut något bara för att det är roligt att köra i. Det ska
// vara något som naturligt finns där banan utspelar sig.
// rot är färdriktningen genom föremålet (0 = mot +z, som bilarnas heading).
// Fungerar utan scen (bara fysik), så att testerna får samma hinder som spelet.
// ---------------------------------------------------------------------------

const cache = new Map();
const cached = (k, fn) => (cache.has(k) ? cache.get(k) : (cache.set(k, fn()), cache.get(k)));

function plankTexture() {
  return cached('plank', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#c79a5e'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `rgba(${90 + (i * 37) % 60},${60 + (i * 23) % 40},30,0.22)`;
      g.fillRect(i * 32, 0, 30, 256);
      g.fillStyle = 'rgba(60,35,15,0.55)'; g.fillRect(i * 32 + 30, 0, 2, 256);
    }
    for (let k = 0; k < 500; k++) { g.fillStyle = `rgba(70,45,20,${0.05 + (k % 7) * 0.012})`; g.fillRect((k * 53) % 256, (k * 97) % 256, 1, 6 + (k % 9)); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

const mats = {
  plank: () => cached('m.plank', () => new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.8 })),
  stripe: () => cached('m.stripe', () => new THREE.MeshStandardMaterial({ color: 0xe2792a, roughness: 0.6 })),
  concrete: () => cached('m.concrete', () => new THREE.MeshStandardMaterial({ color: 0x9c9d98, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
  grass: () => cached('m.grass', () => new THREE.MeshStandardMaterial({ color: 0x5f9a3c, roughness: 1 })),
  plastic: (c) => cached('m.plastic' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, side: THREE.DoubleSide })),
};

const fixed = (world, RAPIER) => world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
const quatY = (rot) => ({ x: 0, y: Math.sin(rot / 2), z: 0, w: Math.cos(rot / 2) });
const place = (mesh, x, y, z, rot) => { mesh.position.set(x, y, z); mesh.rotation.y = rot; mesh.castShadow = mesh.receiveShadow = true; return mesh; };

/** Plywoodramp: w bred, l lång, h hög i bakkanten. Bilen kör upp i riktningen rot. */
export function addKicker(scene, world, RAPIER, { x, z, y = 0, rot = 0, w = 1.8, l = 2.4, h = 0.5 }) {
  const a = w / 2, b = l / 2;
  // Kil: låg kant vid -b, hög kant vid +b
  const pts = [-a, 0, -b, a, 0, -b, -a, 0, b, a, 0, b, -a, h, b, a, h, b];
  if (world) {
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
    if (desc) world.createCollider(desc.setTranslation(x, y, z).setRotation(quatY(rot)).setFriction(0.9).setCollisionGroups(groups(G.WORLD)), fixed(world, RAPIER));
  }
  if (!scene) return;
  const g = new THREE.BufferGeometry();
  const P = (i) => pts.slice(i * 3, i * 3 + 3);
  const tri = [], uv = [];
  const face = (ids, uvs) => { for (const i of ids) tri.push(...P(i)); uv.push(...uvs); };
  const U = w / 1.2, V = Math.hypot(l, h) / 1.2;
  face([0, 4, 5, 0, 5, 1], [0, 0, 0, V, U, V, 0, 0, U, V, U, 0]);   // körytan: från låg kant upp till hög
  face([2, 3, 5, 2, 5, 4], [0, 0, U, 0, U, 0.4, 0, 0, U, 0.4, 0, 0.4]); // bakstycket
  face([0, 2, 4], [0, 0, V, 0, V, 0.4]);                             // vänster sida
  face([1, 5, 3], [0, 0, V, 0.4, V, 0]);                             // höger sida
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  scene.add(place(new THREE.Mesh(g, mats.plank()), x, y, z, rot));
  // Orange list längs toppkanten, så att rampen syns på håll
  const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.05, 0.08), mats.stripe());
  lip.position.set(0, h + 0.005, b - 0.02);
  const grp = new THREE.Group(); grp.add(lip);
  scene.add(place(grp, x, y, z, rot));
  lip.castShadow = true;
}

/** Gräskulle: en mjuk rund kulle med radien r och höjden h. Bilen lättar över krönet. */
export function addMound(scene, world, RAPIER, { x, z, y = 0, r = 2.6, h = 0.5 }) {
  // Punkter på en kupa (paraboloid). Den är konvex, så fysiken kan använda dess hölje direkt.
  const RINGS = 5, SEG = 14, pts = [0, h, 0];
  for (let i = 1; i <= RINGS; i++) for (let k = 0; k < SEG; k++) {
    const q = i / RINGS, a = (k / SEG) * Math.PI * 2;
    pts.push(Math.cos(a) * r * q, h * (1 - q * q), Math.sin(a) * r * q);
  }
  if (world) {
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
    if (desc) world.createCollider(desc.setTranslation(x, y, z).setFriction(0.9).setCollisionGroups(groups(G.WORLD)), fixed(world, RAPIER));
  }
  if (!scene) return;
  const idx = [];
  for (let k = 0; k < SEG; k++) idx.push(0, 1 + ((k + 1) % SEG), 1 + k);
  for (let i = 1; i < RINGS; i++) for (let k = 0; k < SEG; k++) {
    const a = 1 + (i - 1) * SEG + k, b = 1 + (i - 1) * SEG + ((k + 1) % SEG), c = a + SEG, d = b + SEG;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mats.grass());
  m.position.set(x, y, z);
  m.receiveShadow = true; m.castShadow = true;
  scene.add(m);
}

/** Betongplatta i marknivå (bara grafik): underlaget på en skejtyta. w tvärs, l längs rot. */
export function addSlab(scene, { x, z, rot = 0, w = 4, l = 12 }) {
  if (!scene) return;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), mats.concrete());
  m.position.set(x, 0.012, z);
  m.rotation.y = rot;
  m.receiveShadow = true;
  scene.add(m);
}

// Ett rör som ligger på marken och går att köra igenom. Fysiken är ett valv av väggbitar
// över marken (bilen kör på marken inuti). full ritar röret som en hel cylinder, lite
// nedsjunken, i stället för ett halvt valv.
function tube(scene, world, RAPIER, { x, z, y = 0, rot = 0, len, r, t, color, ends, full = false }) {
  const N = 9; // väggbitar runt valvet
  if (world) {
    const body = fixed(world, RAPIER);
    const sx = Math.cos(rot), sz = -Math.sin(rot); // tvärs färdriktningen
    for (let k = 0; k < N; k++) {
      const a = (k + 0.5) / N * Math.PI;            // 0 = höger sida vid marken, π = vänster
      const cx = Math.cos(a) * (r + t / 2), cy = Math.sin(a) * (r + t / 2);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, a - Math.PI / 2, 'YXZ'));
      world.createCollider(
        RAPIER.ColliderDesc.cuboid((Math.PI * (r + t)) / N / 2 + 0.01, t / 2, len / 2)
          .setTranslation(x + sx * cx, y + cy, z + sz * cx).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setFriction(0.5).setCollisionGroups(groups(G.WORLD)), body);
    }
  }
  if (!scene) return;
  const grp = new THREE.Group();
  const arc = full ? [0, Math.PI * 2] : [Math.PI / 2, Math.PI];
  const shell = (rad) => new THREE.CylinderGeometry(rad, rad, len, 24, 1, true, ...arc).rotateX(Math.PI / 2);
  grp.add(new THREE.Mesh(shell(r), mats.plastic(color)), new THREE.Mesh(shell(r + t), mats.plastic(color)));
  for (const s of [1, -1]) { // röda kanter i ändarna
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.01, r + t + 0.04, 24, 1, 0, full ? Math.PI * 2 : Math.PI), mats.plastic(ends));
    ring.position.z = s * len / 2;
    grp.add(ring);
  }
  grp.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  scene.add(place(grp, x, y, z, rot));
}


/** Krypgång på en lekplats: ett kort plaströr i glad färg. */
export function addPlayTunnel(scene, world, RAPIER, { len = 3, r = 0.6, t = 0.05, color = 0xf2c230, ends = 0xe03a2a, ...o }) {
  tube(scene, world, RAPIER, { ...o, len, r, t, color, ends });
}

/** Betongrör som ligger på en byggplats i väntan på att grävas ner: ett avloppsrör att köra igenom. */
export function addSewerPipe(scene, world, RAPIER, { len = 6, r = 0.85, t = 0.1, ...o }) {
  tube(scene, world, RAPIER, { ...o, len, r, t, color: 0xa9a8a2, ends: 0x8f8e88, full: true });
}
