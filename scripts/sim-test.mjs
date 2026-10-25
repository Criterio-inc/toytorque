// ---------------------------------------------------------------------------
// Körtest utan grafik: kör fysiken i Node och kontrollerar att bilarna beter
// sig rimligt. Kör med: npm test
// ---------------------------------------------------------------------------
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld, STEP, G, groups } from '../src/core/physics.js';
import { Vehicle } from '../src/vehicle/vehicle.js';
import { CARS, CAR_ORDER, CLASSES, toMph, carStats, carsInClass } from '../src/vehicle/carDefs.js';
import { buildLevel } from '../src/level/levelBuilder.js';
import { buildTrackData } from '../src/track/track.js';
import { kitchen } from '../src/level/kitchen.js';
import { lagret } from '../src/level/lagret.js';
import { spokstaden } from '../src/level/spokstaden.js';
import { kryssaren } from '../src/level/kryssaren.js';
import { tradgarden } from '../src/level/tradgarden.js';
import { leksaksaffaren } from '../src/level/leksaksaffaren.js';
import { museet } from '../src/level/museet.js';
import { kvarteret } from '../src/level/kvarteret.js';
import { supermarket } from '../src/level/supermarket.js';
import { Race } from '../src/race/race.js';
import { PathFollower, AiDriver } from '../src/ai/pathFollower.js';
import { buildField } from '../src/race/field.js';
import { WeaponSystem } from '../src/weapons/weaponSystem.js';
import { stuntarena, BUILD_STATS } from '../src/level/stuntarena.js';
import { StuntSession } from '../src/stunt/stunt.js';
import { EXAMPLES, fromPath } from '../src/editor/storage.js';
import { toLevel, validate } from '../src/editor/convert.js';

await RAPIER.init();

// Fast slump (datorförarnas genvägsval, vapen) så att en körning går att
// upprepa. reseed() före varje varvtest gör att `npm test <bil>` ger samma
// utfall som hela sviten.
let seed = 1;
const reseed = (str) => { seed = 2166136261; for (const ch of str) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0; };
Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
reseed('revolt');

const only = process.argv[2];
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); };

// Banbyggarens exempelbanor som vanliga nivåer
const EDITOR_LEVELS = EXAMPLES.map((d) => toLevel(d));

// 0. Banbyggarens kontroll: trasiga slingor ska ge tydliga fel
if (!only) {
  const ok = EXAMPLES.every((d) => validate(d).length === 0);
  check('Bygg: exempel giltiga', ok, EXAMPLES.map((d) => `${d.name} ${validate(d).map((e) => e.msg).join('; ') || 'ok'}`).join(', '));
  const open = { ...EXAMPLES[0], cells: EXAMPLES[0].cells.filter(([i, j]) => !(i === 10 && j === 11)) };
  const e1 = validate(open);
  check('Bygg: öppen slinga', e1.some((e) => e.msg === 'Banan är inte sluten' && e.cells.some(([i, j]) => i === 10 && j === 10)), e1.map((e) => e.msg).join('; '));
  const e2 = validate({ ...EXAMPLES[0], cells: EXAMPLES[0].cells.filter((c) => c[2] !== 'start') });
  check('Bygg: saknar start', e2.some((e) => e.msg === 'Saknar startruta'), e2.map((e) => e.msg).join('; '));
  const e3 = validate({ name: 'x', cells: fromPath(4, 10, 0, 'S J F R FFFFFF R FFFFFF R FFFFFF R F') });
  check('Bygg: hopp utan ansats', e3.some((e) => e.msg.startsWith('Hoppet behöver en rak ansats')), e3.map((e) => e.msg).join('; '));
  let threw = false;
  try { toLevel(open); } catch { threw = true; }
  check('Bygg: ogiltig bana byggs ej', threw);
}

function flatWorld() {
  const world = createWorld(RAPIER);
  const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setCollisionGroups(groups(G.WORLD)), b);
  return world;
}
function run(world, car, seconds, ctrl) {
  const n = Math.round(seconds / STEP);
  let minUp = 1;
  for (let i = 0; i < n; i++) {
    const c = typeof ctrl === 'function' ? ctrl(i * STEP) : ctrl;
    car.update(STEP, c);
    world.step();
    car.snapshot();
    minUp = Math.min(minUp, car.upY);
  }
  return { minUp };
}

const ALL_LEVELS = [kitchen, lagret, spokstaden, kryssaren, tradgarden, leksaksaffaren, museet, kvarteret, supermarket];
// Kurs (gir) ur rotationen och glidvinkel ur farten, i markplanet
function headingOf(car) {
  const r = car.body.rotation();
  return Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
}
function betaOf(car) {
  const v = car.body.linvel(), h = headingOf(car);
  const fwd = v.x * Math.sin(h) + v.z * Math.cos(h), lat = v.x * Math.cos(h) - v.z * Math.sin(h);
  return Math.hypot(v.x, v.z) > 2 ? Math.abs(Math.atan2(lat, Math.abs(fwd))) : 0;
}
// Köregenskaper på plan mark. 'steer': toppfart, fullt utslag i 3 s och sedan
// tvära byten. 'wall': i nästan toppfart snett mot en lång vägg, ratten rak.
function handlingRun(def, kind, helper = 0, angle = 30) {
  const world = flatWorld();
  if (kind === 'wall') {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.3, 60).setTranslation(1.6, 0.3, 30).setCollisionGroups(groups(G.WORLD)), b);
  }
  const h0 = kind === 'wall' ? angle / 57.3 : 0;
  const car = new Vehicle(world, RAPIER, def, { x: 0, y: 0.15, z: 0, heading: h0 });
  car.helper = helper;
  car.autoFlip = false;
  run(world, car, 0.5, { throttle: 0, steer: 0 });
  let v0 = 0;
  if (kind === 'wall') {
    v0 = def.topSpeed * 0.9;
    car.body.setLinvel({ x: Math.sin(h0) * v0, y: 0, z: Math.cos(h0) * v0 }, true);
  } else run(world, car, def.accTime + 1.5, { throttle: 1, steer: 0 });
  let maxBeta = 0, maxYaw = 0, minUp = 1, maxTurn = 0;
  const secs = kind === 'wall' ? 2 : 6;
  for (let i = 0; i < Math.round(secs / STEP); i++) {
    const t = i * STEP;
    const steer = kind === 'wall' ? 0 : t < 3 ? 1 : Math.floor(t / 0.6) % 2 ? 1 : -1;
    car.update(STEP, { throttle: 1, steer });
    world.step(); car.snapshot();
    maxBeta = Math.max(maxBeta, betaOf(car));
    maxYaw = Math.max(maxYaw, Math.abs(car.body.angvel().y));
    minUp = Math.min(minUp, car.upY);
    const dh = headingOf(car) - h0;
    maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh))));
  }
  const v = car.body.linvel();
  return { maxBeta, maxYaw, minUp, maxTurn, endBeta: betaOf(car), endUp: car.upY, v0, vEnd: Math.hypot(v.x, v.z) };
}

for (const id of CAR_ORDER) {
  if (only && only !== id) continue;
  const def = CARS[id];
  const tag = def.name.padEnd(11);

  // 1. Vila: står stilla, upprätt, rimlig markfrigång
  {
    const world = flatWorld();
    const car = new Vehicle(world, RAPIER, def, { x: 0, y: 0.25, z: 0 });
    run(world, car, 2, { throttle: 0, steer: 0 });
    const p = car.position;
    const lv = car.body.linvel();
    const still = Math.hypot(lv.x, lv.y, lv.z) < 0.02;
    check(`${tag} vila`, still && car.upY > 0.99 && car.grounded === 4, `höjd ${p.y.toFixed(3)} m, hjul i mark ${car.grounded}`);
  }

  // 2. Acceleration och toppfart
  let topReached;
  {
    const world = flatWorld();
    const car = new Vehicle(world, RAPIER, def, { x: 0, y: 0.15, z: 0 });
    run(world, car, 0.5, { throttle: 0, steer: 0 });
    let t20 = null, t = 0;
    for (; t < def.accTime + 3; t += STEP) {
      car.update(STEP, { throttle: 1, steer: 0 }); world.step(); car.snapshot();
      if (t20 === null && car.mph >= 20) t20 = t;
    }
    topReached = car.speed;
    const frac = car.speed / def.topSpeed;
    check(`${tag} toppfart`, frac > 0.92 && frac < 1.02 && car.upY > 0.95,
      `${car.mph.toFixed(1)} mph av ${toMph(def.topSpeed).toFixed(1)}, 0–20 mph på ${t20?.toFixed(2)} s`);

    // 3. Inbromsning från toppfart
    const z0 = car.position.z;
    let stopT = 0;
    const r = run(world, car, 4, (tt) => { if (car.speed > 0.05) stopT = tt; return { throttle: -1, steer: 0 }; });
    const dist = Math.abs(car.position.z - z0);
    check(`${tag} broms`, stopT < 2.5 && r.minUp > 0.8, `stopp efter ${stopT.toFixed(2)} s`);
    void dist;
  }

  // 4. Full styrning i halvfart: ingen vältning
  {
    const world = flatWorld();
    const car = new Vehicle(world, RAPIER, def, { x: 0, y: 0.15, z: 0 });
    run(world, car, 2.0, { throttle: 1, steer: 0 });
    const r = run(world, car, 5, { throttle: 1, steer: 1 });
    check(`${tag} cirkel`, r.minUp > 0.5, `minsta upp-y ${r.minUp.toFixed(2)}, fart ${car.mph.toFixed(1)} mph`);
  }

  // 5. Slalom i toppfart
  {
    const world = flatWorld();
    const car = new Vehicle(world, RAPIER, def, { x: 0, y: 0.15, z: 0 });
    car.autoFlip = false;
    run(world, car, def.accTime + 1, { throttle: 1, steer: 0 });
    const r = run(world, car, 5, (t) => ({ throttle: 1, steer: Math.floor(t / 0.7) % 2 ? 1 : -1 }));
    check(`${tag} slalom`, r.minUp > 0.3, `minsta upp-y ${r.minUp.toFixed(2)}`);
  }

  // 6. Fall från 1 m landar på hjulen
  {
    const world = flatWorld();
    const car = new Vehicle(world, RAPIER, def, { x: 0, y: 1.0, z: 0 });
    run(world, car, 2, { throttle: 0, steer: 0 });
    check(`${tag} landning`, car.upY > 0.95 && car.grounded >= 3, `upp-y ${car.upY.toFixed(2)}`);
  }

  // 7. Upp och ner vänds automatiskt
  {
    const world = flatWorld();
    const car = new Vehicle(world, RAPIER, def, { x: 0, y: 0.3, z: 0 });
    car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    run(world, car, 4, { throttle: 0, steer: 0 });
    check(`${tag} självvändning`, car.upY > 0.95, `upp-y ${car.upY.toFixed(2)}`);
  }

  // 8. Varvkörning med banföljare: grundbilarna på alla nivåer, övriga på två
  const lapLevels = ['rasket', 'glidaren', 'raketen'].includes(id) ? [...ALL_LEVELS] : [lagret, spokstaden];
  if (id === 'rasket' || id === 'raketen') lapLevels.push(...EDITOR_LEVELS); // banbyggarens exempel
  for (const level of lapLevels) {
    reseed(`${id}:${level.name}`);
    const world = createWorld(RAPIER);
    const lvl = buildLevel({ world, RAPIER, level });
    const T = lvl.track;
    const g = T.gridSlot(0);
    const car = new Vehicle(world, RAPIER, def, { ...g, y: g.y + 0.15 });
    const race = new Race(T, { laps: 3, countdown: 0.01 });
    const racer = race.addRacer(car, { isPlayer: true });
    const ai = new PathFollower(T);
    let respawns = 0, flips = 0, t = 0, lastProg = -Infinity, progJump = 0, autoResets = 0, air = 0, maxAir = 0, maxY = 0;
    const limit = 240;
    for (; t < limit && race.state !== 'finished'; t += STEP) {
      const c = race.canDrive ? ai.controls(car, STEP) : { throttle: 0, steer: 0 };
      car.update(STEP, c);
      world.step();
      car.snapshot();
      race.update(STEP);
      if (car.upY < 0.2) flips++;
      air = car.grounded === 0 ? air + STEP : 0; maxAir = Math.max(maxAir, air); maxY = Math.max(maxY, car.position.y);
      // Sträckan längs banan får aldrig hoppa bakåt mer än lite (backa loss)
      if (!racer.finished) { progJump = Math.max(progJump, lastProg - racer.progress); lastProg = racer.progress; }
      const p = car.position;
      if (racer.stuckTime > 4) autoResets++;
      if (p.y < -2 || Math.abs(p.x) > lvl.half || Math.abs(p.z) > lvl.half || racer.stuckTime > 4) {
        if (racer.stuckTime <= 4) respawns++;
        const rp = race.respawnPose(racer);
        car.place({ ...rp, y: rp.y + 0.2 });
        race.resyncRacer(racer);
      }
    }
    const laps = racer.bestLap ? `bästa varv ${racer.bestLap.toFixed(2)} s, bana ${T.length.toFixed(0)} m` : `varv ${racer.lap}, cp ${racer.nextCp}`;
    check(`${tag} ${level.name.padEnd(6)} 3 varv`, race.state === 'finished' && respawns === 0 && progJump < 3 && autoResets === 0, `${laps}, luft ${maxAir.toFixed(2)} s, högst ${maxY.toFixed(2)} m, bakåthopp ${progJump.toFixed(2)} m, total ${race.time.toFixed(1)} s, ut ur världen ${respawns}, fast och återsatt ${autoResets}, steg upp-och-ner ${flips}`);
  }
}

// 8b. Bilarnas personligheter: egenskaperna ska skilja sig tydligt, både i
// hela garaget och inom varje klass (kör: npm test personlighet)
if (!only || only === 'personlighet') {
  const defs = CAR_ORDER.map((id) => CARS[id]);
  const range = (xs) => Math.max(...xs) - Math.min(...xs);
  const ratio = (xs) => Math.max(...xs) / Math.min(...xs);
  const grip = defs.map((d) => d.mu * d.cornering);
  const acc = defs.map((d) => d.accTime);
  const mass = defs.map((d) => d.mass);
  const keys = ['fart', 'acc', 'grepp', 'vikt', 'svar'];
  // Inom varje klass: minst tre av fem staplar ska spänna över minst 0,3, och
  // inga två bilar får ha nästan samma staplar
  const perClass = CLASSES.map((cls) => {
    const st = defs.filter((d) => d.cls === cls).map((d) => ({ name: d.name, s: carStats(d) }));
    const wide = keys.filter((k) => range(st.map((x) => x.s[k])) >= 0.3).length;
    let closest = Infinity, pair = '';
    for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
      const dist = Math.hypot(...keys.map((k) => st[i].s[k] - st[j].s[k]));
      if (dist < closest) { closest = dist; pair = `${st[i].name}/${st[j].name}`; }
    }
    return { cls, wide, closest, pair };
  });
  check('Personligheter', ratio(grip) > 2 && ratio(acc) > 2.5 && ratio(mass) > 4 && perClass.every((c) => c.wide >= 3 && c.closest > 0.25),
    `grepp μ·styvhet ${Math.min(...grip).toFixed(1)}–${Math.max(...grip).toFixed(1)}, 0–topp ${Math.min(...acc)}–${Math.max(...acc)} s, vikt ${Math.min(...mass)}–${Math.max(...mass)} kg; ${perClass.map((c) => `${c.cls} ${c.wide}/5 breda, närmast ${c.pair} ${c.closest.toFixed(2)}`).join(', ')}`);
}

// 8c. Nybörjarbilen: snurrar inte ens med fullt rattutslag i toppfart, och
// håller sig på banan bättre än de andra Rookie-bilarna men är långsammare
// än den snabbaste av dem (kör: npm test nallen)
if (!only || only === 'nallen') {
  const kid = CARS.nallen;
  // Fullt utslag i toppfart, sedan tvära byten åt andra hållet
  const spinTest = (def) => {
    const world = flatWorld();
    const car = new Vehicle(world, RAPIER, def, { x: 0, y: 0.15, z: 0 });
    run(world, car, def.accTime + 1.5, { throttle: 1, steer: 0 });
    let maxBeta = 0, maxYaw = 0, minUp = 1;
    const steps = Math.round(6 / STEP);
    for (let i = 0; i < steps; i++) {
      const t = i * STEP;
      car.update(STEP, { throttle: 1, steer: t < 3 ? 1 : Math.floor(t / 0.6) % 2 ? 1 : -1 });
      world.step(); car.snapshot();
      const v = car.body.linvel(), r = car.body.rotation();
      const h = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)); // gir
      const fwd = v.x * Math.sin(h) + v.z * Math.cos(h), lat = v.x * Math.cos(h) - v.z * Math.sin(h);
      if (Math.hypot(v.x, v.z) > 2) maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(lat, Math.abs(fwd))));
      maxYaw = Math.max(maxYaw, Math.abs(car.body.angvel().y));
      minUp = Math.min(minUp, car.upY);
    }
    return { maxBeta, maxYaw, minUp, mph: car.mph };
  };
  const k = spinTest(kid);
  const ref = spinTest(CARS.kungen); // sladdglad jämförelse
  check('Nallen snurrar inte', k.maxBeta < 0.2 && k.maxYaw < 3 && k.minUp > 0.9 && k.mph > 15,
    `glidvinkel max ${(k.maxBeta * 57.3).toFixed(0)}°, gir max ${k.maxYaw.toFixed(2)} rad/s, fart efteråt ${k.mph.toFixed(1)} mph · Kungen för jämförelse ${(ref.maxBeta * 57.3).toFixed(0)}°, ${ref.maxYaw.toFixed(2)} rad/s`);

  // Två förare per Rookie-bil på två nivåer (utan genvägar): en skicklig
  // datorförare ger varvtiden, en "barnförare" (ratten bara helt ut eller
  // rakt, gasen i botten utom när det bromsas, lite sen reaktion) visar hur förlåtande
  // bilen är: antal snurrar, tid utanför vägen och återsättningar.
  const noShortcuts = (lv) => ({ ...lv, track: { ...lv.track, shortcuts: [] } });
  const lapRun = (def, level, child) => {
    const world = createWorld(RAPIER);
    const lvl = buildLevel({ world, RAPIER, level: noShortcuts(level) });
    const T = lvl.track;
    const g = T.gridSlot(0);
    const car = new Vehicle(world, RAPIER, def, { x: g.x, y: g.y + 0.15, z: g.z, heading: g.heading });
    const race = new Race(T, { laps: 2, countdown: 0.01 });
    const racer = race.addRacer(car, { isPlayer: true });
    const ai = new AiDriver(T, { skill: 0.95 });
    let t = 0, resets = 0, off = 0, steps = 0, idx = -1, spins = 0, sliding = false, c = { throttle: 0, steer: 0 }, next = 0;
    for (; t < 200 && race.state !== 'finished'; t += STEP) {
      const want = race.canDrive ? ai.controls(car, STEP) : { throttle: 0, steer: 0 };
      if (!child) c = want;
      else if (t >= next) {
        next = t + 0.05;
        c = { throttle: ai.reverseTime > 0 ? -1 : 1, steer: want.steer };
      }
      car.update(STEP, c);
      world.step(); car.snapshot(); race.update(STEP);
      const p = car.position, v = car.body.linvel(), r = car.body.rotation();
      const h = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
      const fwd = v.x * Math.sin(h) + v.z * Math.cos(h), lat = v.x * Math.cos(h) - v.z * Math.sin(h);
      const slide = Math.hypot(v.x, v.z) > 2 && Math.abs(Math.atan2(lat, Math.abs(fwd))) > 0.5;
      if (slide && !sliding) spins++;
      sliding = slide;
      const n = T.nearest(p.x, p.z, idx, 40, p.y); idx = n.index;
      steps++;
      if (Math.abs(n.lateral) > T.roadHalf) off++;
      if (racer.stuckTime > 4 || p.y < -2 || Math.abs(p.x) > lvl.half || Math.abs(p.z) > lvl.half) {
        resets++;
        const rp = race.respawnPose(racer); car.place({ x: rp.x, y: rp.y + 0.2, z: rp.z, heading: rp.heading }); race.resyncRacer(racer); ai.reset();
      }
    }
    return { time: race.state === 'finished' ? race.time : Infinity, resets, off: off / steps, spins };
  };
  const sum = (rs, k) => rs.reduce((a, r) => a + r[k], 0);
  const res = carsInClass('Rookie').map((d) => {
    const pro = [lagret, spokstaden].map((lv) => lapRun(d, lv, false));
    const kidRuns = [lagret, spokstaden].map((lv) => lapRun(d, lv, true));
    return { name: d.name, id: d.id, time: sum(pro, 'time'), spins: sum(kidRuns, 'spins'), resets: sum(kidRuns, 'resets'), off: sum(kidRuns, 'off') / 2, kidTime: sum(kidRuns, 'time') };
  });
  const me = res.find((r) => r.id === 'nallen');
  const others = res.filter((r) => r.id !== 'nallen');
  const fastest = Math.min(...others.map((r) => r.time));
  check('Nallen nybörjarvänlig', me.time > fastest && me.time < fastest * 1.35 && me.spins < Math.min(...others.map((r) => r.spins)) && me.resets <= 8 && me.off <= Math.min(...others.map((r) => r.off)) + 0.01,
    res.map((r) => `${r.name} ${r.time.toFixed(1)} s, barnförare: snurr ${r.spins}, återsatt ${r.resets}, utanför ${(r.off * 100).toFixed(1)} %, ${r.kidTime.toFixed(1)} s`).join(' · '));
}

// 8d. Förlåtande bilar: Rookie-bilarna snurrar inte, en väggträff vänder
// inte bilen, och körhjälpen tämjer en sladdbil (kör: npm test stabilitet)
if (!only || only === 'stabilitet') {
  const deg = (r) => (r * 57.3).toFixed(0);
  for (const d of carsInClass('Rookie')) {
    const r = handlingRun(d, 'steer');
    check(`${d.name.padEnd(11)} stabil`, r.maxBeta < 0.3 && r.maxYaw < 3 && r.minUp > 0.9,
      `fullt utslag i toppfart: glidvinkel max ${deg(r.maxBeta)}°, gir max ${r.maxYaw.toFixed(2)} rad/s`);
  }
  // Snett in i en vägg: bilen ska glida av och bli parallell med väggen
  // (kursändring ungefär lika med anfallsvinkeln), inte snurra runt.
  // Rookie-bilarna utan körhjälp, de vassare bilarna med standardläget Normal.
  for (const id of ['rasket', 'nallen', 'bjassen', 'kanelbullen', 'smulan', 'glidaren', 'kungen', 'tjuren']) {
    const help = CARS[id].cls === 'Rookie' ? 0 : 0.4;
    const a = handlingRun(CARS[id], 'wall', help, 30), b = handlingRun(CARS[id], 'wall', help, 45);
    check(`${CARS[id].name.padEnd(11)} väggträff`, a.maxTurn < 0.785 && b.maxTurn < 1.05 && a.endBeta < 0.6 && b.endBeta < 0.6 && Math.min(a.minUp, b.minUp) > 0.5 && a.endUp > 0.95 && b.endUp > 0.95,
      `${help ? 'körhjälp Normal, ' : ''}i ${a.v0.toFixed(1)} m/s: 30° in ger kursändring ${deg(a.maxTurn)}°, 45° in ger ${deg(b.maxTurn)}°, fart efteråt ${b.vEnd.toFixed(1)} m/s`);
  }
  for (const id of ['glidaren', 'kungen']) {
    const off = handlingRun(CARS[id], 'steer', 0);
    const on = handlingRun(CARS[id], 'steer', 1);
    check(`${CARS[id].name.padEnd(11)} körhjälp`, on.maxBeta < off.maxBeta * 0.8 && on.maxBeta < 0.25,
      `glidvinkel max Av ${deg(off.maxBeta)}° → Mycket ${deg(on.maxBeta)}°, gir max ${off.maxYaw.toFixed(2)} → ${on.maxYaw.toFixed(2)} rad/s`);
  }
}

// 9. Fullt fält: 8 datorförare på varje nivå ska alla gå i mål utan kaos
const FIELD_LEVELS = [kitchen, lagret, spokstaden, kryssaren, tradgarden, leksaksaffaren, museet, kvarteret, supermarket, ...EDITOR_LEVELS];
for (const level of FIELD_LEVELS) {
  if (only && only !== 'falt') break; // kör: npm test falt
  const world = createWorld(RAPIER);
  const lvl = buildLevel({ world, RAPIER, level });
  const T = lvl.track;
  const race = new Race(T, { laps: 3, countdown: 0.01 });
  const field = [...buildField(CARS.rasket, 7), { name: 'Spelaren', def: CARS.rasket, skill: 0.95, lane: 0, topMul: 1 }];
  const cars = field.map((f, slot) => {
    const g = T.gridSlot(slot);
    const v = new Vehicle(world, RAPIER, f.def, { ...g, y: g.y + 0.2 });
    v.mods.topMul = f.topMul;
    return { v, ai: new AiDriver(T, { skill: f.skill, lane: f.lane }), racer: race.addRacer(v, { name: f.name, isPlayer: false }) };
  });
  const vehicles = cars.map((c) => c.v);
  let resets = 0, t = 0, upside = 0, overtakes = 0;
  const resetBy = {};
  let lastOrder = cars.map((c) => c.racer.position).join();
  for (; t < 200 && !cars.every((c) => c.racer.finished); t += STEP) {
    for (const c of cars) c.v.update(STEP, race.canDrive ? c.ai.controls(c.v, STEP, vehicles) : { throttle: 0, steer: 0 });
    world.step();
    for (const c of cars) { c.v.snapshot(); if (c.v.upY < 0.2) upside++; }
    race.update(STEP);
    const order = cars.map((c) => c.racer.position).join();
    if (order !== lastOrder) { overtakes++; lastOrder = order; }
    for (const c of cars) {
      const p = c.v.position;
      if (p.y < -2 || Math.abs(p.x) > lvl.half || Math.abs(p.z) > lvl.half || c.racer.stuckTime > 4 || c.racer.fell) {
        resets++;
        const k = c.v.def.id.replace(/-\d+$/, '');
        resetBy[k] = (resetBy[k] || 0) + 1;
        const rp = race.respawnPose(c.racer);
        c.v.place({ ...rp, y: rp.y + 0.2 });
        race.resyncRacer(c.racer);
        c.ai.reset();
      }
    }
  }
  const done = cars.filter((c) => c.racer.finished).length;
  const times = race.finishOrder.map((r) => r.finishTime);
  const spread = times.length > 1 ? times[times.length - 1] - times[0] : 0;
  check(`Fält 8 bilar ${level.name}`, done === 8 && resets <= 10 && upside < 120 * 8,
    `i mål ${done}/8, vinnare ${race.finishOrder[0]?.name} ${times[0]?.toFixed(1)} s, spridning ${spread.toFixed(1)} s, placeringsbyten ${overtakes}, återsättningar ${resets}${resets ? ` (${Object.entries(resetBy).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}, bilsteg upp-och-ner ${upside}`);
}

// 10. Vapenkaos: 8 datorförare med vapen ska fortfarande gå i mål
for (const level of [lagret, spokstaden]) {
  if (only) break;
  const world = createWorld(RAPIER);
  const lvl = buildLevel({ world, RAPIER, level });
  const T = lvl.track;
  const race = new Race(T, { laps: 3, countdown: 0.01 });
  const field = buildField(CARS.rasket, 8 - 1, 'normal');
  field.push({ name: 'Extra', def: CARS.rasket, skill: 0.9, lane: 0, topMul: 1 });
  const cars = field.map((f, slot) => {
    const g = T.gridSlot(slot);
    const v = new Vehicle(world, RAPIER, f.def, { ...g, y: g.y + 0.2 });
    v.baseTopMul = f.topMul;
    return { vehicle: v, ai: new AiDriver(T, { skill: f.skill, lane: f.lane }), racer: race.addRacer(v, { name: f.name }) };
  });
  const weapons = new WeaponSystem({ world, RAPIER, track: T, race, cars });
  const vehicles = cars.map((c) => c.vehicle);
  const fired = {};
  let resets = 0, t = 0, bad = 0;
  for (; t < 360 && !cars.every((c) => c.racer.finished); t += STEP) {
    weapons.update(STEP);
    for (const c of cars) c.vehicle.update(STEP, race.canDrive ? c.ai.controls(c.vehicle, STEP, vehicles) : { throttle: 0, steer: 0 });
    world.step();
    for (const c of cars) {
      c.vehicle.snapshot();
      if (c.racer.lastFired) { fired[c.racer.lastFired] = (fired[c.racer.lastFired] || 0) + 1; c.racer.lastFired = null; }
      const p = c.vehicle.position;
      if (!Number.isFinite(p.x + p.y + p.z)) bad++;
    }
    race.update(STEP);
    for (const c of cars) {
      const p = c.vehicle.position;
      if (p.y < -2 || Math.abs(p.x) > lvl.half || Math.abs(p.z) > lvl.half || c.racer.stuckTime > 4 || c.racer.fell) {
        resets++;
        const rp = race.respawnPose(c.racer);
        c.vehicle.place({ ...rp, y: rp.y + 0.2 });
        race.resyncRacer(c.racer);
        c.ai.reset();
      }
    }
  }
  const done = cars.filter((c) => c.racer.finished).length;
  const shots = Object.values(fired).reduce((a, b) => a + b, 0);
  check(`Vapenkaos ${level.name}`, done === 8 && bad === 0 && shots > 15,
    `i mål ${done}/8 på ${t.toFixed(0)} s, skott ${shots} (${Object.entries(fired).map(([k, n]) => `${k} ${n}`).join(', ')}), återsättningar ${resets}`);
}

// 10b. Varje vapen avfyras utan grafik (scene = null) och med en attrapp-scen
// där effekterna körs (render) utan webbläsare (kör: npm test vapen)
if (!only || only === 'vapen') {
  const THREE = await import('three');
  const { WEAPONS, TUNE } = await import('../src/weapons/defs.js');
  // Attrapp för canvas (effekternas texturer ritas i en 2D-canvas)
  const noop = () => ctx2d;
  const ctx2d = new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : noop), set: () => true });
  const hadDoc = 'document' in globalThis;
  if (!hadDoc) globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
  for (const withScene of [false, true]) {
    const world = createWorld(RAPIER);
    const lvl = buildLevel({ world, RAPIER, level: lagret });
    const T = lvl.track;
    const race = new Race(T, { laps: 3, countdown: 0.01 });
    const cars = [0, 1, 2, 3].map((slot) => {
      const g = T.gridSlot(slot);
      const v = new Vehicle(world, RAPIER, CARS.rasket, { x: g.x, y: g.y + 0.2, z: g.z, heading: g.heading });
      return { vehicle: v, ai: null, racer: race.addRacer(v, { name: `B${slot}` }) };
    });
    const scene = withScene ? new THREE.Scene() : null;
    const evs = {};
    const events = { emit: (n) => { evs[n] = (evs[n] || 0) + 1; } };
    const weapons = new WeaponSystem({ scene, world, RAPIER, track: T, race, cars, events });
    let err = null, fired = 0;
    const steps = (n) => {
      for (let i = 0; i < n; i++) {
        weapons.update(STEP);
        for (const c of cars) c.vehicle.update(STEP, { throttle: 0.6, steer: 0 });
        world.step();
        for (const c of cars) c.vehicle.snapshot();
        race.update(STEP);
        if (scene && i % 2 === 0) weapons.render(STEP * 2);
      }
    };
    try {
      steps(30);
      for (const id of Object.keys(WEAPONS)) {
        const c = cars[fired % 2]; // de två första skjuter, de andra är mål framför/bakom
        c.racer.weaponCooldown = 0;
        if (WEAPONS[id].onPickup) { c.racer.bomb = 0.5; steps(60); fired++; continue; }
        c.racer.weapon = { id, shots: 1 };
        if (weapons.fire(c)) fired++;
        steps(40);
      }
      // Bomben smittar vid kontakt och smäller; lågt grafikläge glesar ut
      weapons.lowFx = true;
      cars[2].racer.bomb = TUNE.bomb.fuse;
      steps(30);
      steps(Math.ceil(TUNE.bomb.fuse / STEP));
      for (const c of cars) if (!Number.isFinite(c.vehicle.position.x + c.vehicle.position.y + c.vehicle.position.z)) throw new Error('NaN-position');
    } catch (e) { err = e; }
    const draws = scene ? weapons.fx.drawCalls : 0;
    check(`Vapen ${withScene ? 'med effekter' : 'utan grafik'}`, !err && fired === Object.keys(WEAPONS).length && evs.explode > 0,
      err ? String(err.stack || err).split('\n').slice(0, 3).join(' | ') : `avfyrade ${fired}/${Object.keys(WEAPONS).length}, händelser ${Object.entries(evs).map(([k, n]) => `${k} ${n}`).join(', ')}${scene ? `, effektanrop ${draws}` : ''}`);
  }
  if (!hadDoc) delete globalThis.document;
}

// 11. Genväg: en datorförare som alltid tar nivåns genväg ska gå i mål
// snabbare än utan genvägen, utan att missa checkpoints eller fastna
for (const level of [lagret, spokstaden, tradgarden, kryssaren, leksaksaffaren, museet]) {
  if (only) break;
  const own = level.track.shortcuts || [];
  const without = { ...level, track: { ...level.track, shortcuts: [] } };
  const withSc = { ...level, track: { ...level.track, shortcuts: own.map((sc) => ({ ...sc, ai: 1 })) } };
  const times = [];
  for (const lv of [without, withSc]) {
    const world = createWorld(RAPIER);
    const lvl = buildLevel({ world, RAPIER, level: lv });
    const T = lvl.track;
    const race = new Race(T, { laps: 2, countdown: 0.01 });
    const g = T.gridSlot(0);
    const car = new Vehicle(world, RAPIER, CARS.raketen, { ...g, y: g.y + 0.2 });
    const racer = race.addRacer(car, { isPlayer: true });
    const ai = new AiDriver(T, { skill: 0.95 });
    let t = 0, took = 0, resets = 0;
    for (; t < 120 && race.state !== 'finished'; t += STEP) {
      const had = !!ai.sc;
      car.update(STEP, race.canDrive ? ai.controls(car, STEP) : { throttle: 0, steer: 0 });
      if (!had && ai.sc) took++;
      world.step(); car.snapshot(); race.update(STEP);
      if (racer.stuckTime > 4 || car.position.y < -2) { resets++; const rp = race.respawnPose(racer); car.place({ ...rp, y: rp.y + 0.2 }); race.resyncRacer(racer); ai.reset(); }
    }
    times.push({ done: race.state === 'finished', time: race.time, took, resets, cps: T.checkpoints.length, n: T.shortcuts.length });
  }
  const [a, b] = times;
  check(`Genväg ${level.name}`, b.done && b.took >= 2 && b.time < a.time && b.n === own.length && own.length >= 1 && b.resets === 0,
    `utan ${a.time.toFixed(1)} s, med genväg ${b.time.toFixed(1)} s, tog genvägen ${b.took} ggr, återsatt ${b.resets}, checkpoints ${a.cps}→${b.cps}`);
}

// 11b. Nivåernas egna genvägar: en datorförare som alltid tar en viss genväg
// ska gå i mål snabbare än när ingen tar någon genväg (kör: npm test genvag)
if (!only || only === 'genvag') {
  const withChance = (level, k) => ({
    ...level,
    track: { ...level.track, shortcuts: (level.track.shortcuts || []).map((sc, j) => ({ ...sc, ai: j === k ? 1 : 0 })) },
  });
  const runSc = (level) => {
    const world = createWorld(RAPIER);
    const lvl = buildLevel({ world, RAPIER, level });
    const T = lvl.track;
    const race = new Race(T, { laps: 2, countdown: 0.01 });
    const g = T.gridSlot(0);
    const car = new Vehicle(world, RAPIER, CARS.raketen, { ...g, y: g.y + 0.2 });
    const racer = race.addRacer(car, { isPlayer: true });
    const ai = new AiDriver(T, { skill: 0.95 });
    let t = 0, took = 0, resets = 0;
    for (; t < 150 && race.state !== 'finished'; t += STEP) {
      const had = !!ai.sc;
      car.update(STEP, race.canDrive ? ai.controls(car, STEP) : { throttle: 0, steer: 0 });
      if (!had && ai.sc) took++;
      world.step(); car.snapshot(); race.update(STEP);
      const p = car.position;
      if (racer.stuckTime > 4 || p.y < -2 || Math.abs(p.x) > lvl.half || Math.abs(p.z) > lvl.half) { resets++; const rp = race.respawnPose(racer); car.place({ ...rp, y: rp.y + 0.2 }); race.resyncRacer(racer); ai.reset(); }
    }
    return { done: race.state === 'finished', time: race.time, took, resets, cps: T.checkpoints.length };
  };
  for (const [level, names] of [[kvarteret, ['grusgången', 'garaget']], [supermarket, ['hyllorna']]]) {
    const base = runSc(withChance(level, -1));
    names.forEach((name, k) => {
      const r = runSc(withChance(level, k));
      check(`Genväg ${level.name} ${name}`, base.done && r.done && r.took >= 2 && r.time < base.time && r.resets === 0,
        `utan ${base.time.toFixed(1)} s, med genväg ${r.time.toFixed(1)} s, tog genvägen ${r.took} ggr, återsättningar ${r.resets}, checkpoints ${r.cps}`);
    });
  }
}

// 12. Stuntarenan: bygg fysiken, kör fullgas över hindren från startpunkterna
// och kontrollera att alla 20 stjärnor går att nå.
if (!only || only === 'stunt') {
  const S = stuntarena.stunt;
  const half = stuntarena.floor.size / 2;
  // Fullgas rakt fram från en startpunkt (eller med styrfunktion). Returnerar
  // tagna stjärnor och om bilen höll sig hel och kvar i världen.
  const stuntRun = (spawn, carId, secs, steerFn = null, thr = 1) => {
    const world = createWorld(RAPIER);
    buildLevel({ world, RAPIER, level: stuntarena });
    const sp = S.spawns[spawn];
    const car = new Vehicle(world, RAPIER, CARS[carId], { x: sp.x, y: 0.2, z: sp.z, heading: sp.heading });
    const ss = new StuntSession({ level: stuntarena, persist: false });
    let bad = 0, out = 0, maxY = 0;
    for (let t = 0; t < secs; t += STEP) {
      car.update(STEP, { throttle: thr, steer: steerFn ? steerFn(car) : 0 });
      world.step();
      car.snapshot();
      ss.step(STEP, car);
      const p = car.position, v = car.body.linvel();
      if (!Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z)) { bad++; break; }
      if (p.y < -2 || Math.abs(p.x) > half || Math.abs(p.z) > half || Math.hypot(v.x, v.y, v.z) > 40) out++;
      maxY = Math.max(maxY, p.y);
    }
    return { got: ss.stars.filter((s) => s.got).map((s) => s.index), bad, out, maxY };
  };
  // Följ en cirkel moturs (spiralrampen runt tornet)
  const circle = (cx, cz, rr) => (car) => {
    const q = car.position, dx = q.x - cx, dz = q.z - cz, r = Math.hypot(dx, dz);
    if (r > rr + 3) return 0;
    const a = Math.atan2(dz, dx);
    const tx = -Math.sin(a) - (dx / r) * (r - rr) * 0.6, tz = Math.cos(a) - (dz / r) * (r - rr) * 0.6;
    const want = Math.atan2(tx, tz), h = car.heading();
    return Math.max(-1, Math.min(1, Math.atan2(Math.sin(want - h), Math.cos(want - h)) * 3));
  };
  {
    const world = createWorld(RAPIER);
    buildLevel({ world, RAPIER, level: stuntarena });
    check('Stuntarenan bygge', BUILD_STATS.failed === 0 && S.stars.length === 20 && S.spawns.length >= 4,
      `${BUILD_STATS.colliders} hinderdelar, ${BUILD_STATS.failed} misslyckade skal, ${S.stars.length} stjärnor, ${S.spawns.length} startpunkter`);
  }
  const runs = [
    { name: 'mitten → huvudhoppet → quarter pipe', spawn: 0, secs: 8, want: [0, 13, 15] },
    { name: 'stora hoppet', spawn: 1, secs: 6, want: [12] },
    { name: 'loopen', spawn: 2, secs: 7, want: [16] },
    { name: 'under bron → storkickern', spawn: 3, secs: 7, want: [1, 14] },
    { name: 'östra kickern', spawn: 5, secs: 6, want: [19] },
    { name: 'skålens vägg', spawn: 6, secs: 5, want: [3, 17] },
    { name: 'halfpipen', spawn: 7, secs: 6, want: [18] },
    { name: 'quarter pipen', spawn: 10, secs: 6, want: [15] },
    { name: 'tornets spiralramp', spawn: 8, secs: 12, want: [10], steer: circle(26, 22, 4.5), thr: 0.5 }, // lugn gas: Rookie-bilen styr bara till greppgränsen
  ];
  const collected = new Set();
  for (const r of runs) {
    const a = stuntRun(r.spawn, 'rasket', r.secs, r.steer, r.thr);
    a.got.forEach((i) => collected.add(i));
    const missing = r.want.filter((i) => !a.got.includes(i));
    // En snabb bil på samma sträcka: får inte explodera eller lämna världen
    const b = stuntRun(r.spawn, 'raketen', r.secs, r.steer, r.thr);
    check(`Stunt ${r.name}`, a.bad === 0 && a.out === 0 && b.bad === 0 && b.out === 0 && missing.length === 0,
      `stjärnor ${a.got.join(',') || '-'}${missing.length ? ` (saknas ${missing.join(',')})` : ''}, högst ${a.maxY.toFixed(2)} m · Raketen ${b.got.length} st, högst ${b.maxY.toFixed(2)} m${a.bad + b.bad ? ', NaN!' : ''}${a.out + b.out ? `, utanför ${a.out + b.out} steg` : ''}`);
  }
  // Alla stjärnor: inte inne i något hinder, inom räckhåll i höjd, och antingen
  // vilande på en yta (golv/däck) eller tagna av någon av körningarna ovan.
  {
    const world = createWorld(RAPIER);
    buildLevel({ world, RAPIER, level: stuntarena });
    world.step();
    const ball = new RAPIER.Ball(0.2);
    const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const bad = [];
    S.stars.forEach((s, i) => {
      let inside = false;
      world.intersectionsWithShape({ x: s.x, y: s.y, z: s.z }, { x: 0, y: 0, z: 0, w: 1 }, ball, () => { inside = true; return false; }, undefined, groups(G.WORLD, G.WORLD));
      ray.origin = { x: s.x, y: s.y, z: s.z };
      const hit = world.castRay(ray, 20, true, undefined, groups(G.WORLD, G.WORLD));
      const above = hit ? hit.timeOfImpact : Infinity;
      const onSurface = (s.reach === 'floor' || s.reach === 'deck') && above < 0.6;
      const reached = onSurface || collected.has(i);
      if (inside || s.y > S.maxDeck + 1 || !reached) bad.push(`${i}${inside ? ' inne i hinder' : ''}${s.y > S.maxDeck + 1 ? ' för högt' : ''}${!reached ? ' ej nådd' : ''}`);
    });
    const kinds = ['floor', 'deck', 'air', 'wall'].map((k) => `${k} ${S.stars.filter((s) => s.reach === k).length}`).join(', ');
    check('Stunt alla 20 stjärnor', bad.length === 0, bad.length ? bad.join('; ') : `${kinds}; ${collected.size} tagna i körningarna`);
  }
}

// 13. Doserade kurvor: vägytans lutning stämmer med specen, en doserad kurva
// går fortare än samma kurva plan, och varje nivå har dosering och höjdskillnad
if (!only || only === 'dosering') {
  const bankLevel = (deg) => ({
    id: 'dosering', name: 'Dosering', floor: { size: 90 }, walls: { height: 1 }, statics: [], props: [],
    track: {
      scale: 1, roadHalf: 1.6, spacing: 0.6, start: { x: 0, z: -14 },
      corners: [{ x: -22, z: -14, r: 7 }, { x: 22, z: -14, r: 7 }, { x: 22, z: 14, r: 7 }, { x: -22, z: 14, r: 7 }],
      bank: deg ? [[-22, -14], [22, -14], [22, 14], [-22, 14]].map((at) => ({ at, deg })) : [],
    },
  });
  {
    const world = createWorld(RAPIER);
    const T = buildLevel({ world, RAPIER, level: bankLevel(15) }).track;
    world.step();
    const i = T.nearest(22, 14).index, p = T.pts[i];
    const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x: p.x, y: 5, z: p.z }, { x: 0, y: -1, z: 0 }), 10, true, undefined, groups(G.WORLD, G.WORLD));
    const tilt = hit ? (Math.acos(Math.min(1, Math.abs(hit.normal.y))) * 180) / Math.PI : NaN;
    // Normalen ska luta in mot kurvans mitt (ytterkanten högst); mitten ligger mot origo
    const inward = hit ? hit.normal.x * -p.x + hit.normal.z * -p.z > 0 : false;
    const pose = T.poseAt(i, 0);
    const lowEdge = Math.min(T.surfaceY(i, T.roadHalf), T.surfaceY(i, -T.roadHalf));
    check('Dosering geometri', Math.abs(tilt - 15) < 0.5 && inward && Math.abs((pose.roll * 180) / Math.PI) > 14.5 && lowEdge >= 0,
      `lutning ${tilt.toFixed(2)}° (spec 15°), ${inward ? 'inåt' : 'UTÅT'}, roll ${((pose.roll * 180) / Math.PI).toFixed(1)}°, låga kanten ${lowEdge.toFixed(2)} m`);
  }
  const lapBank = (deg) => {
    const world = createWorld(RAPIER);
    const T = buildLevel({ world, RAPIER, level: bankLevel(deg) }).track;
    const g = T.gridSlot(1);
    const car = new Vehicle(world, RAPIER, CARS.raketen, { ...g, y: g.y + 0.15 });
    const race = new Race(T, { laps: 3, countdown: 0.01 });
    const racer = race.addRacer(car, { isPlayer: true });
    const ai = new AiDriver(T, { skill: 0.95 });
    let resets = 0;
    for (let t = 0; t < 90 && race.state !== 'finished'; t += STEP) {
      car.update(STEP, race.canDrive ? ai.controls(car, STEP) : { throttle: 0, steer: 0 });
      world.step(); car.snapshot(); race.update(STEP);
      if (racer.stuckTime > 4 || car.position.y < -2) { resets++; const rp = race.respawnPose(racer); car.place({ ...rp, y: rp.y + 0.2 }); race.resyncRacer(racer); ai.reset(); }
    }
    return { best: racer.bestLap ?? Infinity, resets, v: T.lineSpeed[T.nearest(22, 14).index] };
  };
  const flat = lapBank(0), banked = lapBank(15);
  check('Dosering snabbare', banked.best < flat.best && banked.resets === 0 && flat.resets === 0,
    `Raketen bästa varv plan ${flat.best.toFixed(2)} s, doserad 15° ${banked.best.toFixed(2)} s, kurvfart i profilen ${flat.v.toFixed(1)} → ${banked.v.toFixed(1)} m/s`);
  // Nivåerna: minst en doserad kurva och verklig höjdskillnad
  const info = ALL_LEVELS.map((level) => {
    const T = buildTrackData(level.track);
    let maxBank = 0, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < T.N; i++) { maxBank = Math.max(maxBank, Math.abs(T.bank[i])); lo = Math.min(lo, T.pts[i].y); hi = Math.max(hi, T.pts[i].y); }
    return { name: level.name, deg: (maxBank * 180) / Math.PI, rise: hi - lo };
  });
  check('Nivåer: dosering och höjd', info.every((r) => r.deg >= 10 && r.deg <= 18.01 && r.rise >= 0.5), info.map((r) => `${r.name} ${r.deg.toFixed(0)}°/${r.rise.toFixed(2)} m`).join(', '));
}

// 14. Trappan mellan våningarna: en långsam bil som kryper över kanten
// (Museet och Leksaksaffären) ska landa på trappan och rulla ner utan att
// fastna eller räknas som nedramlad
if (!only || only === 'trappa') {
  for (const level of [museet, leksaksaffaren]) {
    for (const crawl of [1.5, 3]) {
      const world = createWorld(RAPIER);
      const T = buildLevel({ world, RAPIER, level }).track;
      // Kanten: första glappet som ligger högt upp (övervåningen)
      let g = -1;
      for (let i = 1; i < T.N && g < 0; i++) if (T.isGap[i] && !T.isGap[i - 1] && T.pts[i].y > 1) g = i;
      let foot = g;
      while (T.pts[foot % T.N].y > 0.002) foot++;
      const start = T.poseAt(g - Math.round(3 / T.spacing), 0);
      const car = new Vehicle(world, RAPIER, CARS.rasket, { ...start, y: start.y + 0.15 });
      const ai = new AiDriver(T, { skill: 0.9 });
      let fell = false, minUp = 1, idx = start.index;
      for (let t = 0; t < 10; t += STEP) {
        const c = ai.controls(car, STEP);
        c.throttle = car.speed < crawl ? Math.min(1, c.throttle) : car.speed > crawl + 0.5 ? -0.3 : 0;
        car.update(STEP, c); world.step(); car.snapshot();
        const p = car.position;
        idx = T.nearest(p.x, p.z, idx, 40, p.y).index;
        if (p.y < T.pts[idx].y - 0.3) fell = true;
        minUp = Math.min(minUp, car.upY);
        if (((idx - foot + T.N) % T.N) < T.N / 2 && ((idx - foot + T.N) % T.N) > 3) break;
      }
      const past = ((idx - foot + T.N) % T.N) < T.N / 2;
      check(`Trappa ${level.name} ${crawl} m/s`, past && !fell && minUp > 0.5,
        `kant vid ${T.pts[g].x.toFixed(1)},${T.pts[g].z.toFixed(1)} (${T.pts[g].y.toFixed(2)} m), ${past ? 'nere på golvet' : 'kom inte ner'}, minsta upp-y ${minUp.toFixed(2)}${fell ? ', föll under vägen' : ''}`);
    }
  }
}

// 12. Upplåsning: startbilar, cuper, snabbspår, tidsutmaning och trasig sparfil
if (!only) {
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  const P = await import('../src/race/progress.js');
  const n = () => P.progressSummary().carsUnlocked;
  const perClass = {};
  for (const id of CAR_ORDER) perClass[CARS[id].cls] = (perClass[CARS[id].cls] || 0) + 1;
  const counts = [n()];
  const fast = P.applyRaceWin('Rookie');
  const tt = P.applyTimeTrial('lagret', P.CHALLENGE.lagret - 0.5);
  for (const c of ['brons', 'silver', 'guld', 'platina']) { P.applyCupWin(c); counts.push(n()); }
  store['revolt.progress'] = '{"unlocked":5,"won":["brons",7],"unlockedCars":[null,"finns-inte"],"ttBeaten":[]}';
  const bad = P.loadProgress();
  const okBad = bad.unlocked.join() === 'brons,silver' && bad.unlockedCars.length === 5 && !Object.keys(bad.ttBeaten).length;
  check('Upplåsning', CAR_ORDER.length === 21 && perClass.Rookie === 5 && CLASSES.slice(1).every((c) => perClass[c] === 4)
    && counts[0] === P.START_CARS.length && P.START_CARS.includes('nallen') && fast.length === 1
    && tt.beaten && tt.cars[0] === 'lerkakan' && counts[4] === CAR_ORDER.length && okBad,
    `bilar ${CAR_ORDER.length}, upplåsta efter start/cuper ${counts.join('→')}, snabbspår ${fast}, tidsutmaning ${tt.cars}, trasig sparfil ${okBad ? 'rättad' : 'FEL'}`);
  delete globalThis.localStorage;
}

// Resultat
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? 'OK  ' : 'FEL '} ${r.name.padEnd(26)} ${r.info}`);
}
console.log(fail ? `\n${fail} test misslyckades` : `\nAlla ${results.length} test gick igenom`);
process.exit(fail ? 1 : 0);
