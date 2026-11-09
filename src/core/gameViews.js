import * as THREE from 'three';
import { ordinal } from '../ui/hud.js';

// ---------------------------------------------------------------------------
// Vyer som Game använder men som inte är spelregler: delad skärm med
// spelare 2:s lilla HUD, och filmkameran bakom menyn. Utbrutna ur game.js
// för att hålla den filen hanterbar.
// ---------------------------------------------------------------------------

// Delad skärm: spelare 1 överst, spelare 2 nederst (utan efterbehandling)
export function renderSplit(g, dt) {
  const r = g.renderer;
  const w = window.innerWidth, h = window.innerHeight, hh = Math.floor(h / 2);
  const car = g.p2, root = car.model.root, rs = g.race.state;
  g.chase2.update(dt, root.position, root.quaternion, car.vehicle.body.linvel(), car.vehicle.speed, car.vehicle.def.topSpeed, {
    phase: rs === 'intro' ? 'intro' : car.racer.finished ? 'finish' : 'race',
    introLeft: g.race.intro, introLen: g.race.introLen, gridCenter: g.gridCenter,
  });
  g.camera.aspect = g.camera2.aspect = w / hh;
  g.camera.updateProjectionMatrix();
  g.camera2.updateProjectionMatrix();
  hud2Update(g);
  r.setScissorTest(true);
  r.setViewport(0, hh, w, h - hh); r.setScissor(0, hh, w, h - hh);
  r.render(g.scene, g.camera);
  r.setViewport(0, 0, w, hh); r.setScissor(0, 0, w, hh);
  r.render(g.scene, g.camera2);
  r.setScissorTest(false);
  r.setViewport(0, 0, w, h);
}

// Liten HUD för spelare 2 i nedre halvan
function hud2Update(g) {
  let el = document.getElementById('hud2');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hud2';
    document.body.appendChild(el);
  }
  const r = g.p2.racer, v = g.p2.vehicle;
  const w = r.weapon ? `⚡ ${r.weapon.id}${r.weapon.shots > 1 ? ' ×' + r.weapon.shots : ''}` : r.roulette > 0 ? '⚡ …' : '';
  const m = g.p2.stunt?.meter ?? 0;
  const turbo = g.bonus ? `<div class="p2turbo">TURBO ${'▮'.repeat(Math.floor(m))}${'▯'.repeat(3 - Math.floor(m))}</div>` : '';
  const txt = `<div class="p2pos">${r.position}<sup>${ordinal(r.position)}</sup></div><div class="p2lap">Lap ${Math.min(r.lap, g.race.laps)}/${g.race.laps}</div><div class="p2w">${w}</div>${turbo}<div class="p2spd">${Math.round(Math.abs(v.speed) * 3.6)} km/h</div><div class="p2name">Spelare 2</div>`;
  if (el._t !== txt) { el.innerHTML = txt; el._t = txt; }
}

// Filmkamera bakom menyn: följer en bil i taget, ibland från en fast
// punkt vid banan som bilen susar förbi.
export function direct(g, dt) {
  const D = g.director;
  D.t -= dt;
  if (D.t <= 0 || !D.car) {
    D.car = g.cars[Math.floor(Math.random() * g.cars.length)];
    D.kind = Math.random() < 0.45 ? 'trackside' : 'chase';
    D.t = D.kind === 'trackside' ? 4.5 : 6;
    g.chase.snap = true;
    if (D.kind === 'trackside') {
      // Ställ kameran en bit fram längs banan, vid sidan av vägen
      const T = g.track, i = D.car.racer.trackIndex >= 0 ? D.car.racer.trackIndex : 0;
      const side = Math.random() < 0.5 ? 1 : -1;
      const p = T.poseAt(i + Math.round(9 / T.spacing), side * (T.roadHalf + 0.6));
      D.spot = new THREE.Vector3(p.x, p.y + 0.35 + Math.random() * 0.5, p.z);
    }
  }
  if (D.kind === 'trackside') {
    const target = D.car.model.root.position;
    g.camera.position.copy(D.spot);
    g.camera.lookAt(target.x, target.y + 0.05, target.z);
    const d = D.spot.distanceTo(target);
    g.camera.fov = Math.max(18, Math.min(55, 50 - d * 2.5)); // zoomar in när bilen är långt bort
    g.camera.updateProjectionMatrix();
  }
  return D.car;
}
