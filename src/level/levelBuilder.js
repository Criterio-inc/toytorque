import * as THREE from 'three';
import { G, groups } from '../core/physics.js';
import { buildTrackData, buildTrackPhysics, buildTrackMesh } from '../track/track.js';

// ---------------------------------------------------------------------------
// Bygger en nivå ur dess data. Utan scene (t.ex. i testskriptet) skapas bara
// fysiken, så samma nivå går att köra helt utan grafik.
// ---------------------------------------------------------------------------

const PROP_KINDS = {
  cone: { shape: 'cone', r: 0.07, h: 0.24, mass: 0.06, friction: 0.5, restitution: 0.2 },
  can: { shape: 'cyl', r: 0.034, h: 0.12, mass: 0.08, friction: 0.4, restitution: 0.25 },
  block: { shape: 'box', s: 0.09, mass: 0.12, friction: 0.6, restitution: 0.15 },
  ball: { shape: 'ball', r: 0.16, mass: 0.12, friction: 0.6, restitution: 0.7 },
};

export function buildLevel({ scene = null, world, RAPIER, level }) {
  const props = [];

  // Golv och väggar (en nivå med egen miljö bygger dem själv)
  const half = level.floor.size / 2;
  if (!level.environment) buildRoom(world, RAPIER, level);

  // Banan
  const track = buildTrackData(level.track);
  buildTrackPhysics(world, RAPIER, track);

  // Nivåns egen miljö: golv, väggar, staplar och lösa saker
  if (level.environment) props.push(...level.environment({ scene, world, RAPIER, track }));

  // Lösa saker
  for (const p of level.props) {
    const k = PROP_KINDS[p.kind];
    const cp = track.checkpoints[p.cp];
    const pose = track.poseAt(cp.index, p.lateral);
    const y = pose.y + (k.h ?? k.s ?? k.r * 2) / 2 + 0.01;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pose.x, y, pose.z).setLinearDamping(0.1).setAngularDamping(0.3)
    );
    let col;
    if (k.shape === 'cone') col = RAPIER.ColliderDesc.cone(k.h / 2, k.r);
    else if (k.shape === 'cyl') col = RAPIER.ColliderDesc.cylinder(k.h / 2, k.r);
    else if (k.shape === 'box') col = RAPIER.ColliderDesc.cuboid(k.s / 2, k.s / 2, k.s / 2);
    else col = RAPIER.ColliderDesc.ball(k.r);
    world.createCollider(
      col.setDensity(0).setMass(k.mass).setFriction(k.friction).setRestitution(k.restitution).setCollisionGroups(groups(G.PROP)),
      body
    );
    props.push({ body, kind: p.kind, spec: k, color: p.color, mesh: null, spawn: { x: pose.x, y, z: pose.z } });
  }

  const result = { track, props, half, level };
  if (scene) buildLevelMeshes(scene, result);
  return result;
}

function buildRoom(world, RAPIER, level) {
  const half = level.floor.size / 2;
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0).setFriction(1).setCollisionGroups(groups(G.WORLD)),
    floorBody
  );
  const wallH = level.walls.height;
  for (const [w, d, x, z] of [
    [level.floor.size, 0.3, 0, -half], [level.floor.size, 0.3, 0, half],
    [0.3, level.floor.size, -half, 0], [0.3, level.floor.size, half, 0],
  ]) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, wallH / 2, d / 2).setTranslation(x, wallH / 2, z).setCollisionGroups(groups(G.WORLD)),
      floorBody
    );
  }
  for (const s of level.statics) {
    const [w, h, d] = s.size, [x, y, z] = s.at;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z).setFriction(0.8).setRestitution(0.1).setCollisionGroups(groups(G.WORLD)),
      floorBody
    );
  }

}

function buildLevelMeshes(scene, built) {
  const { level, track, props } = built;
  if (!level.environment) buildRoomMeshes(scene, level);
  for (const s of level.statics) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(...s.size),
      new THREE.MeshStandardMaterial({ color: s.color, roughness: s.rough ?? 0.8, metalness: s.metal ?? 0 })
    );
    m.position.set(...s.at);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  built.trackGroup = buildTrackMesh(scene, track, level.trackTheme);

  for (const p of props) {
    if (p.mesh) continue; // miljöns egna saker har redan grafik
    const k = p.spec;
    let geo;
    if (k.shape === 'cone') geo = new THREE.ConeGeometry(k.r, k.h, 16);
    else if (k.shape === 'cyl') geo = new THREE.CylinderGeometry(k.r, k.r, k.h, 16);
    else if (k.shape === 'box') geo = new THREE.BoxGeometry(k.s, k.s, k.s);
    else geo = new THREE.SphereGeometry(k.r, 20, 14);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.45, metalness: p.kind === 'can' ? 0.6 : 0 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    p.mesh = mesh;
  }
}

function buildRoomMeshes(scene, level) {
  // Golv: blankt kakel
  const f = level.floor;
  const tex = makeTileTexture(f);
  tex.repeat.set(f.size / (f.tile * 2), f.size / (f.tile * 2));
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(f.size, f.size),
    new THREE.MeshStandardMaterial({ map: tex, roughness: f.gloss, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Väggar med en mörkare sockel
  const wallMat = new THREE.MeshStandardMaterial({ color: level.walls.color, roughness: 0.9 });
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x8c7b63, roughness: 0.6 });
  const half = f.size / 2, wh = level.walls.height;
  for (const [w, d, x, z] of [[f.size, 0.3, 0, -half], [f.size, 0.3, 0, half], [0.3, f.size, -half, 0], [0.3, f.size, half, 0]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wh, d), wallMat);
    wall.position.set(x, wh / 2, z);
    wall.receiveShadow = true;
    scene.add(wall);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.25, d + 0.1), skirtMat);
    skirt.position.set(x, 0.125, z);
    scene.add(skirt);
  }

}

function makeTileTexture(f) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = f.grout;
  ctx.fillRect(0, 0, 256, 256);
  const g = 4;
  const cells = [[0, 0, f.colorA], [128, 0, f.colorB], [0, 128, f.colorB], [128, 128, f.colorA]];
  for (const [x, y, col] of cells) {
    ctx.fillStyle = col;
    ctx.fillRect(x + g, y + g, 128 - g * 2, 128 - g * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
