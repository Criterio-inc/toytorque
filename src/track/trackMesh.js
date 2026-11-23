import * as THREE from 'three';
import { bumpFrom } from '../level/bump.js';
import { roadGeometry, sideGeometry, barrierSegments, edge3, flareAt, pillars, segmentQuat } from './trackPhysics.js';

// Banans grafik: väg, sidor, vallar, pelare, mållinje och svängpilar.
// --- Grafik --------------------------------------------------------------------
export function buildTrackMesh(scene, data, theme = {}) {
  const group = new THREE.Group();
  const roadMap = makeRoadTexture(theme.road ?? '#3a3d45');
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadMap, normalMap: bumpFrom(roadMap, theme.roadBump ?? 1.6), roughness: theme.roadRough ?? 0.75,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  // Våt väg (kvällsvarianten): mörkare, blankare och med utjämnade korn
  if (theme.wet) { roadMat.color.multiplyScalar(0.6); roadMat.envMapIntensity = 1.6; roadMat.normalScale.set(0.22, 0.22); }
  meshFor(data, theme, group, roadMat);
  for (const sc of data.shortcuts || []) meshFor(sc.path, theme, group, roadMat);

  // Rutig mållinje vid index 0
  const p0 = data.pts[0], t0 = data.tangents[0];
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(data.roadHalf * 2, 0.35),
    new THREE.MeshStandardMaterial({ map: makeChecker(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 })
  );
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.atan2(t0.x, t0.z);
  line.position.set(p0.x, p0.y + 0.006, p0.z);
  line.receiveShadow = true;
  group.add(line);

  // Svängpilar som svävar på ytterkanten
  const signs = buildSigns(data);
  group.add(signs);
  group.userData.animate = signs.userData.animate;

  scene.add(group);
  return group;
}

// Väg, sidor, vallar och pelare för en vägsträcka (huvudbanan eller en genväg)
function meshFor(data, theme, group, roadMat) {
  const road = roadGeometry(data, true);
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(road.pos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(road.uv, 2));
  roadGeo.setIndex(Array.from(road.idx));
  roadGeo.computeVertexNormals();
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  roadMesh.castShadow = true;
  group.add(roadMesh);

  // Sidor och undersida på upphöjda delar
  const sides = sideGeometry(data);
  if (sides.idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(sides.pos, 3));
    g.setIndex(Array.from(sides.idx));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: theme.side ?? 0x8a6a48, roughness: 0.8, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  if (sides.eIdx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(sides.ePos, 3));
    g.setIndex(Array.from(sides.eIdx));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: theme.embank ?? theme.side ?? 0x8a6a48, roughness: 0.95, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    group.add(m);
  }

  // Kantvallar: en sammanslagen geometri med röd/vita fält
  const { height, thick } = data.barrier;
  const bPos = [], bCol = [], bIdx = [];
  const red = new THREE.Color(theme.barrierA ?? 0xd23b3b);
  const white = new THREE.Color(theme.barrierB ?? 0xf0f0f0);
  let stripe = 0;
  for (const seg of barrierSegments(data)) {
    const col = stripe++ % 2 === 0 ? red : white;
    for (const side of [1, -1]) {
      const fi = side * flareAt(data, seg.i), fj = side * flareAt(data, seg.j);
      const inner = side * data.roadHalf, outer = side * (data.roadHalf + thick);
      const q = [edge3(data, seg.i, inner + fi), edge3(data, seg.j, inner + fj), edge3(data, seg.j, outer + fj), edge3(data, seg.i, outer + fi)];
      const base = bPos.length / 3;
      for (const top of [0, height]) for (const v of q) { bPos.push(v.x, v.y + top, v.z); bCol.push(col.r, col.g, col.b); }
      const f = (a, b, c, d) => bIdx.push(base + a, base + b, base + c, base + a, base + c, base + d);
      f(4, 5, 6, 7); f(0, 1, 5, 4); f(1, 2, 6, 5); f(2, 3, 7, 6); f(3, 0, 4, 7);
    }
  }
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
  bGeo.setAttribute('color', new THREE.Float32BufferAttribute(bCol, 3));
  bGeo.setIndex(bIdx);
  bGeo.computeVertexNormals();
  const barriers = new THREE.Mesh(bGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }));
  barriers.castShadow = barriers.receiveShadow = true;
  group.add(barriers);

  // Pelare under upphöjda delar
  const pl = pillars(data);
  if (pl.length) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1, 0.12), new THREE.MeshStandardMaterial({ color: theme.pillar ?? 0x9b9b9b, roughness: 0.6 }), pl.length);
    const m4 = new THREE.Matrix4();
    pl.forEach((p, i) => inst.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, p.y0 + p.h / 2, p.z), new THREE.Quaternion(), new THREE.Vector3(1, p.h, 1))));
    inst.castShadow = inst.receiveShadow = true;
    group.add(inst);
  }
}

function buildSigns(data) {
  const g = new THREE.Group();
  const tex = { left: makeArrowTexture(false), right: makeArrowTexture(true) };
  const mats = {
    left: new THREE.MeshBasicMaterial({ map: tex.left, transparent: true, side: THREE.DoubleSide, fog: true }),
    right: new THREE.MeshBasicMaterial({ map: tex.right, transparent: true, side: THREE.DoubleSide, fog: true }),
  };
  const geo = new THREE.PlaneGeometry(0.7, 0.7);
  for (const s of data.signs) {
    const lateral = (s.dir === 'right' ? 1 : -1) * (data.roadHalf * 0.55); // på ytterkanten av svängen
    const p = data.poseAt(s.index, lateral);
    const m = new THREE.Mesh(geo, mats[s.dir]);
    m.position.set(p.x, p.y + 0.95, p.z);
    m.rotation.y = p.heading + Math.PI; // vänd mot inkommande bilar
    m.userData.bob = Math.random() * 6;
    m.userData.y = m.position.y;
    g.add(m);
  }
  g.userData.animate = (t) => g.children.forEach((m) => { m.position.y = m.userData.y + Math.sin(t * 2 + m.userData.bob) * 0.04; });
  return g;
}


function makeRoadTexture(base) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  // Fint brus som asfalt, plus några ljusare stenar
  const img = ctx.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16 + (Math.random() < 0.02 ? 26 : 0);
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeChecker() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 16;
  const ctx = c.getContext('2d');
  for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) {
    ctx.fillStyle = (x + y) % 2 === 0 ? '#111' : '#eee';
    ctx.fillRect(x * 8, y * 8, 8, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

// Röd böjd pil med vit kant (riktning i bild: höger eller vänster)
function makeArrowTexture(right) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (!right) { ctx.translate(128, 0); ctx.scale(-1, 1); }
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(40, 116);
    ctx.lineTo(40, 64);
    ctx.quadraticCurveTo(40, 34, 70, 34);
    ctx.lineTo(78, 34);
    ctx.lineTo(78, 14);
    ctx.lineTo(118, 48);
    ctx.lineTo(78, 82);
    ctx.lineTo(78, 62);
    ctx.lineTo(72, 62);
    ctx.quadraticCurveTo(66, 62, 66, 70);
    ctx.lineTo(66, 116);
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  path(); ctx.lineWidth = 10; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  path(); ctx.fillStyle = '#e1251b'; ctx.fill();
  path(); ctx.lineWidth = 2; ctx.strokeStyle = '#7a0d08'; ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
