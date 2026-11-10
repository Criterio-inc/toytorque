import { STEP } from '../core/physics.js';

// ---------------------------------------------------------------------------
// window.DBG: stega spelet manuellt och läs av tillstånd. Behövs när
// förhandsvisningen pausar requestAnimationFrame (dold flik).
// ---------------------------------------------------------------------------

export function attachDebug(game) {
  const car = () => game.player;
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
    place(x, z, heading = 0) { car().place({ x, y: 0.2, z, heading }); game.chase.snap = true; },
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
    // och frys loppet. Samma tal ger samma bild. Även ?shot=pct i adressen.
    shot(pct = 25) {
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
  };
  const shot = new URLSearchParams(location.search).get('shot');
  if (shot) setTimeout(() => window.DBG.shot(+shot), 1200);
}
