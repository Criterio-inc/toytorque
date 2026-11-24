import { STEP } from '../core/physics.js';

// ---------------------------------------------------------------------------
// window.DBG: stega spelet manuellt och läs av tillstånd. Behövs när
// förhandsvisningen pausar requestAnimationFrame (dold flik).
// ---------------------------------------------------------------------------

export function attachDebug(game) {
  const car = () => game.player;
  // Kuperade banor: bilen ställs på vägen eller marken, inte på nollhöjd
  const surfaceY = (x, z) => {
    const T = game.track, n = T.nearest(x, z);
    const road = n.d2 < (T.roadHalf + 0.5) ** 2 ? T.pts[n.index].y : -Infinity;
    return Math.max(road, T.ground ? T.ground.heightAt(x, z) : 0);
  };
  window.DBG = {
    game,
    // Kör n fysiksteg med givna controls (eller tangentbordet) och rendera
    drive(n = 120, controls) {
      for (let i = 0; i < n; i++) game.step(controls);
      for (let i = 0; i < 20; i++) game.render(1 / 60, 1);
      return this.state();
    },
    tick(n = 120, controls) { for (let i = 0; i < n; i++) game.step(controls); return this.state(); },
    render(n = 1) { for (let i = 0; i < n; i++) game.render(1 / 60, 1); },
    startRace() { game.race.countdown = 0; game.race.update(0); game.race.update(STEP); },
    state() {
      const p = car().position;
      const r = game.racer;
      return {
        x: +p.x.toFixed(2), y: +p.y.toFixed(3), z: +p.z.toFixed(2),
        mph: +car().mph.toFixed(1), upY: +car().upY.toFixed(2), grounded: car().grounded,
        race: game.race.state, lap: r.lap, nextCp: r.nextCp, pos: r.position, frames: game.frames,
      };
    },
    place(x, z, heading = 0) { car().place({ x, y: surfaceY(x, z) + 0.2, z, heading }); game.chase.snap = true; },
    gridPose: () => game.track.gridSlot(0),
    // Vapen direkt i handen och avfyra (bomben tänds på bilen)
    fire(id, car = game.p1 || game.cars[game.cars.length - 1]) {
      const r = car.racer;
      if (id === 'bomb') { r.bomb = 10; return true; }
      r.weapon = { id, shots: 1 };
      r.weaponCooldown = 0;
      return game.weapons.fire(car);
    },
    // Stillbild för jämförelser: ställ spelarens bil pct procent in på varvet
    // och frys loppet. Samma tal ger samma bild. Även ?shot=pct i adressen,
    // med &vy=fram eller &vy=bak för en närbild på bilen.
    shot(pct = 25, view = null) {
      game.race.skipIntro();
      this.startRace();
      const T = game.track, i = Math.round((pct / 100) * T.N) % T.N;
      const p = T.poseAt(i, 0);
      car().place({ ...p, y: p.y + 0.15 });
      for (let k = 0; k < 90; k++) game.step({ throttle: 0, steer: 0 });
      game.chase.snap = true;
      game.paused = true;
      game.hud.helpTimer = 0;
      for (let k = 0; k < 40; k++) game.render(1 / 60, 1);
      if (view) {
        // Närbild på bilen: snett framifrån eller snett bakifrån, kameran låst
        const m = car().currQuat, c = car().currPos, cam = game.camera;
        const off = view === 'bak' ? [0.5, 0.26, -0.72] : [-0.52, 0.24, 0.7];
        cam.position.set(...off).applyQuaternion(m).add(c);
        cam.fov = 38; cam.updateProjectionMatrix();
        cam.lookAt(c.x, c.y + 0.03, c.z);
        game.chase.update = () => {};
        document.getElementById('hud').style.display = 'none';
        game.render(0, 1);
      }
      return this.state();
    },
    // Stillbild på en plats vid sidan av banan (altanen, ett rör). Även
    // ?plats=x,z,grader i adressen.
    shotAt(x, z, deg = 0) {
      game.race.skipIntro();
      this.startRace();
      car().place({ x, y: surfaceY(x, z) + 0.2, z, heading: (deg * Math.PI) / 180 });
      for (let k = 0; k < 90; k++) game.step({ throttle: 0, steer: 0 });
      game.chase.snap = true;
      game.paused = true;
      game.hud.helpTimer = 0;
      for (let k = 0; k < 40; k++) game.render(1 / 60, 1);
      return this.state();
    },
    // Ritanrop för en bildruta (inklusive skuggor och efterbehandling)
    calls() {
      const info = game.renderer.info;
      info.autoReset = false; info.reset();
      game.render(1 / 60, 1);
      const n = info.render.calls;
      info.autoReset = true;
      return n;
    },
    // Prestanda i riktig Chrome: mät sek sekunder av vanlig körning. Fysik och
    // spelkod mäts på processorn; resten av bildrutan är grafikkortet eller väntan.
    async bench(sek = 6) {
      const t = { step: 0, scene: 0, post: 0 };
      const wrap = (obj, key, slot) => {
        const f = obj[key];
        obj[key] = function (...a) { const s = performance.now(); const r = f.apply(this, a); t[slot] += performance.now() - s; return r; };
        return () => { obj[key] = f; };
      };
      const undo = [wrap(game, 'step', 'step'), wrap(game, 'render', 'scene'), wrap(game.post, 'render', 'post')];
      const info = game.renderer.info;
      const gaps = [];
      let last = performance.now();
      await new Promise((done) => {
        const end = last + sek * 1000;
        const tick = () => {
          const now = performance.now();
          gaps.push(now - last); last = now;
          if (now < end) requestAnimationFrame(tick); else done();
        };
        requestAnimationFrame(tick);
      });
      undo.forEach((u) => u());
      gaps.shift();
      const n = gaps.length, sum = gaps.reduce((a, b) => a + b, 0);
      gaps.sort((a, b) => a - b);
      const ms = (v) => +(v / n).toFixed(2);
      return {
        fps: +(1000 * n / sum).toFixed(1), p95: +gaps[Math.floor(n * 0.95)].toFixed(1), worst: +gaps[n - 1].toFixed(1),
        fysik: ms(t.step), spelkod: ms(t.scene - t.post - 0), ritning: ms(t.post),
        anrop: info.render.calls, trianglar: info.render.triangles,
        upplosning: `${game.renderer.domElement.width}x${game.renderer.domElement.height}`,
      };
    },
    // Samma mätning med en sak avstängd i taget, för att se vad som kostar
    async benchAll(sek = 4) {
      const r = game.renderer, P = game.post, sun = game.sun;
      const out = { allt: await this.bench(sek) };
      const prov = async (namn, på, av) => { på(); await new Promise((d) => setTimeout(d, 300)); out[namn] = await this.bench(sek); av(); };
      const ao = P.ao.enabled, pr = r.getPixelRatio();
      await prov('utanHornskugg', () => { P.ao.enabled = false; }, () => { P.ao.enabled = ao; });
      await prov('utanSkuggor', () => { sun.castShadow = false; }, () => { sun.castShadow = true; });
      await prov('utanEfterbeh', () => { P.enabled = false; }, () => { P.enabled = true; });
      await prov('pixel1', () => game.setGraphics(false) || (r.setPixelRatio(1), P.composer.setPixelRatio(1), game.resize()), () => { r.setPixelRatio(pr); P.composer.setPixelRatio(pr); game.resize(); });
      await prov('enkel', () => game.setGraphics(true), () => game.setGraphics(false));
      return out;
    },
  };
  const shot = new URLSearchParams(location.search).get('shot');
  const spot = new URLSearchParams(location.search).get('plats');
  if (spot) setTimeout(() => window.DBG.shotAt(...spot.split(',').map(Number)), 1200);
  else if (shot) setTimeout(() => window.DBG.shot(+shot, new URLSearchParams(location.search).get('vy')), 1200);
}
