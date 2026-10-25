import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createWorld, STEP, MAX_STEPS_PER_FRAME } from './physics.js';
import { buildLevel } from '../level/levelBuilder.js';
import { Vehicle } from '../vehicle/vehicle.js';
import { CarModel } from '../vehicle/carModel.js';
import { Skidmarks } from '../vehicle/skidmarks.js';
import { CARS, CAR_ORDER } from '../vehicle/carDefs.js';
import { Race } from '../race/race.js';
import { Input } from '../input/input.js';
import { ChaseCamera } from '../camera/chaseCamera.js';
import { Hud, ordinal } from '../ui/hud.js';
import { AiDriver } from '../ai/pathFollower.js';
import { buildField } from '../race/field.js';
import { WeaponSystem } from '../weapons/weaponSystem.js';
import { Events } from './events.js';
import { Ghost } from '../race/ghost.js';
import { StartFx } from '../ui/startFx.js';
import { Post } from './post.js';
import { Dust } from '../vehicle/dust.js';

// Dammfärg per bana (sand, grus, gatudamm; annars ljus däckrök)
const DUST = { spokstaden: 0xd9b88a, tradgarden: 0xcdbb98, kvarteret: 0xb9ad9a, kryssaren: 0xd8cdbd };
import { Replay } from '../race/replay.js';
import { StuntSession } from '../stunt/stunt.js';

// ---------------------------------------------------------------------------
// Game: äger renderare, fysikvärld, nivå, bilar, lopp, kamera och HUD.
// Fast fysiksteg med interpolerad rendering emellan.
// ---------------------------------------------------------------------------

const BASE_FOV = 60;

export class Game {
  constructor(RAPIER, { container, levels, extraLevels = [], level, carId = 'rasket', opponents = 7, difficulty = 'normal' }) {
    this.RAPIER = RAPIER;
    this.opponents = opponents;
    this.difficulty = difficulty;
    this.assist = 0.4; // spelarnas körhjälp 0..1 (sätts från inställningarna)
    this.levels = levels;
    this.extraLevels = extraLevels; // nivåer utanför banvalet (Stuntarenan)
    this.levelDef = level;
    // Lopplägen: race (vanligt lopp), timetrial (ensam, utan vapen, med spöke),
    // demo (alla datorstyrda bakom menyn), showroom (bilen visas i bilvalet),
    // stunt (fri körning i Stuntarenan, stjärnjakt)
    this.opts = { mode: 'race', laps: null, weapons: true };
    this.onAction = null; // appen (menyn) får första tjing på knapptryck

    // Renderare
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    // Miljöbelysning ger blanka golv och lackade bilar något att spegla
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.03, 200);

    const hemi = new THREE.HemisphereLight(0xfff6e8, 0x6d6457, 0.75);
    this.scene.add(hemi);
    this.hemi = hemi;
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -7; sc.right = sc.top = 7; sc.near = 1; sc.far = 60;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    this.sunOffset = new THREE.Vector3(14, 26, 9);

    this.post = new Post(renderer, this.scene, this.camera);
    this.events = new Events();
    // --- Stuntläge: meddelande när en stjärna tas ---
    this.events.on('star', (d) => this.hud.message(d.all ? 'ALLA STJÄRNOR! BONUS UPPLÅST' : `★ ${d.count}/${d.total}`, { time: d.all ? 6 : 1.4 }));
    // --- Kameraskak: explosioner i närheten och träffar på den egna bilen ---
    this.shakeOn = true; // Inställningar: Skakning
    this.events.on('explode', (d) => { if (!d.replay) this._shake(d.pos, 0.3 + 0.55 * (d.size ?? 0.6), null); });
    this.events.on('hit', (d) => this._shake(null, d.kind === 'blast' ? 0.25 : 0.4, d.car));
    this.input = new Input();
    this.hud = new Hud();
    this.clock = new THREE.Clock();
    this.acc = 0;
    this.frames = 0;
    this.paused = false;

    this._buildWorld(carId);

    window.addEventListener('resize', () => this.resize());
  }

  // Starta ett nytt lopp / läge. cfg: { level, carId, opponents, difficulty, laps, weapons, mode }
  setup(cfg = {}) {
    if (cfg.level) {
      const all = [...this.levels, ...this.extraLevels];
      this.levelDef = (typeof cfg.level === 'object' ? cfg.level : all.find((l) => l.id === cfg.level)) || this.levelDef;
    }
    if (cfg.opponents != null) this.opponents = cfg.opponents;
    if (cfg.difficulty) this.difficulty = cfg.difficulty;
    this.opts = { mode: cfg.mode || 'race', laps: cfg.laps ?? null, weapons: cfg.weapons ?? true, players: cfg.players || 1, carId2: cfg.carId2 || null };
    this.paused = false;
    this._buildWorld(cfg.carId || this.carId);
  }

  get mode() { return this.opts.mode; }

  // Grafik: Tuff (efterbehandling, skarp bild på Retina) eller Enkel (ingen
  // efterbehandling och en bildpunkt per skärmpunkt: ungefär fyra gånger färre
  // pixlar att rita på en Retina-skärm)
  setGraphics(low) {
    this.post.enabled = !low;
    const pr = Math.min(window.devicePixelRatio || 1, low ? 1 : 2);
    if (this.renderer.getPixelRatio() !== pr) {
      this.renderer.setPixelRatio(pr);
      this.post.composer.setPixelRatio(pr);
      this.resize();
    }
  }

  // Körhjälp för spelarnas bilar (inställningen Av/Normal/Mycket)
  setAssist(v) {
    this.assist = v;
    if (this.player && this.mode !== 'demo') this.player.helper = v;
    if (this.p2) this.p2.vehicle.helper = v;
  }

  _buildWorld(carId) {
    // Ny fysikvärld varje gång (enkelt och utan läckor mellan lopp)
    if (this.world) this.world.free();
    if (this.levelGroup) {
      this.scene.remove(this.levelGroup);
      this.levelGroup.traverse((o) => {
        o.geometry?.dispose();
        if (o.isInstancedMesh) o.dispose();
        for (const m of [].concat(o.material || [])) {
          for (const k of ['map', 'roughnessMap', 'emissiveMap', 'normalMap']) m[k]?.dispose();
          m.dispose();
        }
      });
    }
    this.world = createWorld(this.RAPIER);

    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);
    this.level = buildLevel({ scene: this.levelGroup, world: this.world, RAPIER: this.RAPIER, level: this.levelDef });
    const L = this.levelDef;
    this.scene.background?.isTexture && this.scene.background.dispose();
    this.scene.background = L.skyGradient ? makeSkyTexture(L.skyGradient) : new THREE.Color(L.sky);
    this.scene.fog = new THREE.Fog(L.fog.color ?? L.sky, L.fog.near, L.fog.far);
    this._applyLighting(L.lighting || {});
    this.track = this.level.track;
    this.trackGroup = this.level.trackGroup;

    this.skids = new Skidmarks(this.levelGroup);
    this.dust = new Dust(this.levelGroup, this.levelDef.dust ?? DUST[this.levelDef.id] ?? 0xcfcfcf);
    this.post.setLook(this.levelDef.look || {});
    const mode = this.opts.mode;
    const quiet = mode === 'demo' || mode === 'showroom';
    const stunt = mode === 'stunt'; // fri körning: inga varv, ingen nedräkning
    const laps = mode === 'demo' ? 99 : stunt ? 1e6 : this.opts.laps ?? this.levelDef.laps;
    this.race = new Race(this.track, { laps, events: quiet || stunt ? null : this.events, intro: quiet || stunt ? 0 : this.introTime ?? 3.5, countdown: quiet || stunt ? 0.01 : 3 });
    const gc = this.track.gridSlot(3);
    this.gridCenter = new THREE.Vector3(this.track.poseAt(gc.index, 0).x, gc.y, this.track.poseAt(gc.index, 0).z);

    // Startfält: datorförarna först, spelaren sist (som i mästerskapet)
    this.carId = carId;
    this.cars = [];
    const solo = mode === 'timetrial' || mode === 'showroom' || stunt;
    // Två spelare (delad skärm): plats för spelare 2 i fältet
    const two = mode === 'race' && this.opts.players === 2;
    const field = solo ? [] : buildField(CARS[carId], mode === 'demo' ? 7 : two ? Math.min(6, this.opponents) : this.opponents, this.difficulty);
    field.forEach((f, slot) => {
      const g = this.track.gridSlot(slot);
      const v = new Vehicle(this.world, this.RAPIER, f.def, { ...g, y: g.y + 0.2 });
      v.baseTopMul = f.topMul;
      const ai = new AiDriver(this.track, { skill: f.skill, lane: f.lane });
      this._addCar(v, ai, f.name, false);
    });
    this.p2 = null;
    if (two) {
      const g2 = this.track.gridSlot(field.length);
      const def2 = CARS[this.opts.carId2] || CARS[carId];
      const v2 = new Vehicle(this.world, this.RAPIER, def2, { ...g2, y: g2.y + 0.2 });
      v2.helper = this.assist;
      this.p2 = this._addCar(v2, null, 'Spelare 2', true);
    }
    const g = stunt ? { y: 0, ...this.levelDef.stunt.spawns[0] } : this.track.gridSlot(field.length + (two ? 1 : 0));
    this.player = new Vehicle(this.world, this.RAPIER, CARS[carId], { ...g, y: g.y + 0.2 });
    this.player.helper = mode === 'demo' ? 0 : this.assist;
    // I demoläget kör datorn även "spelarens" bil
    const pc = this._addCar(this.player, mode === 'demo' ? new AiDriver(this.track, { skill: 0.95 }) : null, two ? 'Spelare 1' : 'Du', mode !== 'demo');
    this.p1 = pc;
    this.playerModel = pc.model;
    this.racer = pc.racer;
    this.vehicles = this.cars.map((c) => c.vehicle);
    this.weapons = new WeaponSystem({ scene: this.levelGroup, world: this.world, RAPIER: this.RAPIER, track: this.track, race: this.race, cars: this.cars, events: quiet ? null : this.events, enabled: this.opts.weapons && mode !== 'timetrial' && mode !== 'showroom' && !stunt });
    this.ghost = mode === 'timetrial' ? new Ghost(this) : null;
    // --- Repris: spela in varje lopp och tidskörning ---
    if (this.replay) { this.replay.onEnd = null; this.replay.dispose(); }
    this.replaying = false;
    this.replay = mode === 'race' || mode === 'timetrial' ? new Replay(this) : null;
    // --- slut repris ---
    this.director = { car: this.cars[0], t: 0, kind: 'chase', spot: null };
    this.hud.setVisible(!quiet);
    this.startFx = quiet || stunt ? null : new StartFx(this.levelGroup, this.track);
    if (this.race.state === 'intro') {
      // Infokort före loppet
      const info = this.raceInfo || {};
      this.hud.showInfo({
        mode: info.mode || (mode === 'timetrial' ? 'Tidskörning' : 'Enkelt lopp'),
        stage: info.stage, track: this.levelDef.name,
        length: `${Math.round(this.track.length)} m`, laps: laps,
      }, this.race.introLen);
      this.raceInfo = null;
    }
    // --- Stuntläge: stjärnor, HUD-klass ---
    this.stunt = stunt ? new StuntSession({ level: this.levelDef, scene: this.levelGroup, events: this.events }) : null;
    document.body.classList.toggle('stunt-mode', stunt);
    if (stunt) this.hud.message(`${this.levelDef.name} · ★ ${this.stunt.count}/${this.stunt.total}`, { time: 3 });
    if (!quiet) this.hud.showHelp(this.race.introLen + 5);

    this.camera.fov = BASE_FOV; // ny kamera utgår alltid från grund-FOV
    this.chase = new ChaseCamera(this.camera, this.world, this.RAPIER);
    // Spelare 2 får en egen kamera och en egen följekamera (nedre halvan)
    this.camera2 ||= new THREE.PerspectiveCamera(BASE_FOV, 1, 0.03, 200);
    this.camera2.fov = BASE_FOV;
    this.chase2 = this.p2 ? new ChaseCamera(this.camera2, this.world, this.RAPIER) : null;
    document.body.classList.toggle('split', !!this.p2);
    if (!this.p2) { this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix(); }
    this.hud.setSplit?.(!!this.p2);
    this.lastLap = 1;
    this.acc = 0;
  }

  // Skaka varje kamera efter avståndet från dess bil (delad skärm: var och en för sig)
  _shake(pos, amount, car) {
    if (!this.shakeOn || this.replaying) return;
    const pairs = [[this.chase, this.p1], [this.chase2, this.p2]];
    for (const [cam, own] of pairs) {
      if (!cam || !own) continue;
      if (car) { if (car === own) cam.addShake(amount); continue; }
      const d = own.vehicle.currPos.distanceTo(pos);
      const k = Math.max(0, 1 - d / 5);
      if (k > 0) cam.addShake(amount * k * k);
    }
  }

  // Nivåns ljus (valfritt i nivådatan):
  //   lighting: { sun: {color, intensity, offset:[x,y,z]}, hemi: {sky, ground, intensity},
  //               exposure, envIntensity }
  _applyLighting(Lt) {
    const sun = Lt.sun || {}, hemi = Lt.hemi || {};
    this.sun.color.set(sun.color ?? 0xfff1dc);
    this.sun.intensity = sun.intensity ?? 2.1;
    this.sunOffset.set(...(sun.offset ?? [14, 26, 9]));
    this.hemi.color.set(hemi.sky ?? 0xfff6e8);
    this.hemi.groundColor.set(hemi.ground ?? 0x6d6457);
    this.hemi.intensity = hemi.intensity ?? 0.75;
    this.renderer.toneMappingExposure = Lt.exposure ?? 1.05;
    this.scene.environmentIntensity = Lt.envIntensity ?? 0.55;
  }

  _addCar(vehicle, ai, name, isPlayer) {
    const model = new CarModel(vehicle);
    this.levelGroup.add(model.root);
    const racer = this.race.addRacer(vehicle, { name, isPlayer });
    const car = { vehicle, model, ai, racer };
    this.cars.push(car);
    return car;
  }

  restart(carId = this.carId) {
    this._buildWorld(carId);
  }

  nextLevel() {
    const i = this.levels.indexOf(this.levelDef);
    this.levelDef = this.levels[(i + 1) % this.levels.length];
    this._buildWorld(this.carId);
    this.hud.message(this.levelDef.name, { time: 1.4 });
  }

  reposition(car = this.cars[this.cars.length - 1], here = false) {
    // --- Stuntläge: F vänder bilen där den är, R (och ramlat ut) närmaste startpunkt ---
    if (this.stunt && here) car.vehicle.flip();
    const p = this.stunt ? (here ? null : this.stunt.respawnPose(car.vehicle.position)) : here ? this.race.roadPoseNear(car.racer) : this.race.respawnPose(car.racer);
    if (p) car.vehicle.place({ ...p, y: p.y + 0.2 });
    this.race.resyncRacer(car.racer);
    car.ai?.reset();
    if (car.vehicle === this.player) this.chase.snap = true;
    if (this.p2 && car === this.p2) this.chase2.snap = true;
    this.events.emit('respawn', { car });
  }

  // Ett fysiksteg för alla bilar
  step(controlsOverride) {
    if (this.mode === 'showroom') { this.player.update(STEP, { throttle: 0, steer: 0 }); this.world.step(); this.player.snapshot(); return; }
    const go = this.race.canDrive;
    const playerDone = this.race.state === 'finished';
    const c = controlsOverride || this.input.controls(this.p2 ? 'p1' : 'all');
    const c2 = this.p2 ? this.input.controls('p2') : null;
    this.weapons.update(STEP);
    const lead = this.racer.progress;
    const rubber = !playerDone; // ingen ikapphämtning när spelaren gått i mål
    for (const car of this.cars) {
      const v = car.vehicle;
      if (car.ai) {
        // Ikapphämtning: långt efter spelaren → lite snabbare, långt före → lite lugnare
        car.ai.catchup = rubber && !car.racer.finished ? Math.max(-1, Math.min(1, (lead - car.racer.progress) / 40)) : 0;
        v.update(STEP, go ? car.ai.controls(v, STEP, this.vehicles) : { throttle: 0, steer: 0 });
      } else {
        const cc = car === this.p2 ? c2 : c;
        v.update(STEP, go && !playerDone && !car.racer.finished ? cc : { throttle: 0, steer: cc.steer });
      }
    }
    // Hastighet före steget, för att känna igen krockar
    for (const car of this.cars) { const lv = car.vehicle.body.linvel(); (car.vPrev ||= new THREE.Vector3()).set(lv.x, lv.y, lv.z); }
    this.world.step();
    for (const car of this.cars) {
      const v = car.vehicle;
      v.snapshot();
      const lv = v.body.linvel();
      const dv = Math.hypot(lv.x - car.vPrev.x, lv.y - car.vPrev.y, lv.z - car.vPrev.z);
      // Mer hastighetsändring än motor och grepp ger på ett steg = krock eller landning
      if (dv > 0.9 && (car.impactCool || 0) <= 0) {
        car.impactCool = 0.15;
        this.events.emit(v.grounded && v.airTime === 0 && car.vPrev.y < -1.5 ? 'land' : 'impact', { car, pos: v.currPos.clone(), strength: dv / 1 });
        if (dv > 1.6) this.dust.burst(v.currPos, Math.min(3, dv / 2)); // dammoln vid hård landning/krock
      }
      if (car.impactCool > 0) car.impactCool -= STEP;
    }
    this.race.update(STEP);
    this.ghost?.step();
    this.replay?.record(STEP); // repris
    // --- Stuntläge: loopstyrning och stjärnor (inget "fel håll" i en arena) ---
    if (this.stunt) { this.stunt.step(STEP, this.player); this.racer.wrongWay = false; }

    // Ramlat ut ur världen, eller datorförare som fastnat: tillbaka på banan
    for (const car of this.cars) {
      const p = car.vehicle.position;
      const out = !Number.isFinite(p.x + p.y + p.z) || p.y < -2 || Math.abs(p.x) > this.level.half || Math.abs(p.z) > this.level.half;
      if (out || car.racer.fell || (car.ai && car.racer.stuckTime > 4)) this.reposition(car);
    }
  }

  handleActions() {
    const acts = this.input.actions().filter((a) => !(this.onAction && this.onAction(a)));
    if (this.mode === 'demo' || this.mode === 'showroom') return;
    // Introsvepet hoppas över med valfri knapp eller gas
    if (this.race.state === 'intro' && (acts.length || this.input.controls().throttle > 0)) {
      this.race.skipIntro();
      if (acts.includes('fire')) acts.splice(acts.indexOf('fire'), 1);
    }
    for (const a of acts) {
      if (a === 'reposition') this.reposition(this.p1);
      else if (a === 'flip') this.reposition(this.p1, true); // F: mitt på vägen här, i färdriktningen
      else if (a === 'camera') this.hud.message(`Kamera: ${this.chase.next()}`, { time: 1 });
      else if (a === 'restart') this.restart();
      else if (a === 'level') this.nextLevel();
      else if (a === 'fire' && !this.paused) this.weapons.fire(this.p1 || this.cars[this.cars.length - 1]);
      else if (a === 'fire2' && this.p2 && !this.paused) this.weapons.fire(this.p2);
      else if (a === 'flip2' && this.p2) this.reposition(this.p2, true);
      else if (a === 'reposition2' && this.p2) this.reposition(this.p2);
      else if (a === 'help') this.hud.toggleHelp();
      else if (a.startsWith('car')) {
        const id = ['rasket', 'glidaren', 'raketen'][+a.slice(3) - 1]; // snabbval: Rookie, Advanced, Pro
        if (id) { this.restart(id); this.hud.message(`${CARS[id].name} · ${CARS[id].cls}`, { time: 1.4 }); }
      } else if (a === 'pause') {
        this.paused = !this.paused;
        this.hud.message(this.paused ? 'PAUS' : '', { time: this.paused ? 1e9 : 0.01 });
      }
    }
  }

  frame() {
    this.frames++;
    let dt = Math.min(this.clock.getDelta(), 0.1);
    // --- Repris: ingen fysik, bara uppspelning ---
    if (this.replaying) { this.input.actions(); this.render(dt); return; }
    // --- slut repris ---
    this.handleActions();
    if (this.paused) dt = 0;
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < MAX_STEPS_PER_FRAME) {
      this.step();
      this.acc -= STEP;
      n++;
    }
    if (n === MAX_STEPS_PER_FRAME) this.acc = 0;
    this.render(dt, this.acc / STEP);
  }

  render(dt, alpha = 1) {
    if (this.replaying) return this.replay.render(dt); // repris
    for (const car of this.cars) {
      car.model.update(alpha, dt);
      this.skids.update(car.vehicle);
      this.dust.fromCar(car.vehicle, dt);
    }
    for (const pr of this.level.props) {
      const t = pr.body.translation(), r = pr.body.rotation();
      pr.mesh.position.set(t.x, t.y, t.z);
      pr.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    this.trackGroup?.userData.animate?.(this.clock.elapsedTime);
    this.weapons.lowFx = !this.post.enabled; // Grafik: Enkel ger glesare vapeneffekter
    this.weapons.render(dt);
    this.skids.flush();
    this.dust.update(dt);

    this.ghost?.render(alpha);
    this.startFx?.update(dt, this.race);
    const focus = this.mode === 'demo' ? this._direct(dt) : this.cars[this.cars.length - 1];
    const root = focus.model.root;
    const rs = this.race.state;
    if (!(this.mode === 'demo' && this.director.kind === 'trackside')) {
      this.chase.update(dt, root.position, root.quaternion, focus.vehicle.body.linvel(), focus.vehicle.speed, focus.vehicle.def.topSpeed, {
        phase: this.mode === 'showroom' ? 'finish' : rs === 'intro' ? 'intro' : rs === 'finished' ? 'finish' : 'race',
        introLeft: this.race.intro, introLen: this.race.introLen, gridCenter: this.gridCenter,
      });
    }

    // Skuggkameran följer bilen så skuggorna blir skarpa
    this.sun.target.position.copy(root.position);
    this.sun.position.copy(root.position).add(this.sunOffset);

    if (this.racer.lap !== this.lastLap) {
      this.lastLap = this.racer.lap;
      if (this.racer.lap === this.race.laps && !this.racer.finished) this.hud.message('FINAL LAP!', { time: 2 });
    }
    this.hud.update(dt, { race: this.race, racer: this.racer, vehicle: this.player, racers: this.race.racers });
    if (this.stunt) { this.stunt.render(dt, this.clock.elapsedTime); this.hud.stunt({ count: this.stunt.count, total: this.stunt.total, time: this.stunt.time }); }
    this.menu?.tick();
    if (this.p2 && !this.replaying) return this._renderSplit(dt);
    this.post.render(this.scene, this.camera);
  }

  // Delad skärm: spelare 1 överst, spelare 2 nederst (utan efterbehandling)
  _renderSplit(dt) {
    const r = this.renderer;
    const w = window.innerWidth, h = window.innerHeight, hh = Math.floor(h / 2);
    const car = this.p2, root = car.model.root, rs = this.race.state;
    this.chase2.update(dt, root.position, root.quaternion, car.vehicle.body.linvel(), car.vehicle.speed, car.vehicle.def.topSpeed, {
      phase: rs === 'intro' ? 'intro' : car.racer.finished ? 'finish' : 'race',
      introLeft: this.race.intro, introLen: this.race.introLen, gridCenter: this.gridCenter,
    });
    this.camera.aspect = this.camera2.aspect = w / hh;
    this.camera.updateProjectionMatrix();
    this.camera2.updateProjectionMatrix();
    this.hud2Update(dt);
    r.setScissorTest(true);
    r.setViewport(0, hh, w, h - hh); r.setScissor(0, hh, w, h - hh);
    r.render(this.scene, this.camera);
    r.setViewport(0, 0, w, hh); r.setScissor(0, 0, w, hh);
    r.render(this.scene, this.camera2);
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
  }

  // Liten HUD för spelare 2 i nedre halvan
  hud2Update() {
    let el = document.getElementById('hud2');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hud2';
      document.body.appendChild(el);
    }
    const r = this.p2.racer, v = this.p2.vehicle;
    const ord = ordinal;
    const w = r.weapon ? `⚡ ${r.weapon.id}${r.weapon.shots > 1 ? ' ×' + r.weapon.shots : ''}` : r.roulette > 0 ? '⚡ …' : '';
    const txt = `<div class="p2pos">${r.position}<sup>${ord(r.position)}</sup></div><div class="p2lap">Lap ${Math.min(r.lap, this.race.laps)}/${this.race.laps}</div><div class="p2w">${w}</div><div class="p2spd">${Math.round(Math.abs(v.speed) * 3.6)} km/h</div><div class="p2name">Spelare 2</div>`;
    if (el._t !== txt) { el.innerHTML = txt; el._t = txt; }
  }

  // Filmkamera bakom menyn: följer en bil i taget, ibland från en fast
  // punkt vid banan som bilen susar förbi.
  _direct(dt) {
    const D = this.director;
    D.t -= dt;
    if (D.t <= 0 || !D.car) {
      D.car = this.cars[Math.floor(Math.random() * this.cars.length)];
      D.kind = Math.random() < 0.45 ? 'trackside' : 'chase';
      D.t = D.kind === 'trackside' ? 4.5 : 6;
      this.chase.snap = true;
      if (D.kind === 'trackside') {
        // Ställ kameran en bit fram längs banan, vid sidan av vägen
        const T = this.track, i = D.car.racer.trackIndex >= 0 ? D.car.racer.trackIndex : 0;
        const side = Math.random() < 0.5 ? 1 : -1;
        const p = T.poseAt(i + Math.round(9 / T.spacing), side * (T.roadHalf + 0.6));
        D.spot = new THREE.Vector3(p.x, p.y + 0.35 + Math.random() * 0.5, p.z);
      }
    }
    if (D.kind === 'trackside') {
      const target = D.car.model.root.position;
      this.camera.position.copy(D.spot);
      this.camera.lookAt(target.x, target.y + 0.05, target.z);
      const d = D.spot.distanceTo(target);
      this.camera.fov = Math.max(18, Math.min(55, 50 - d * 2.5)); // zoomar in när bilen är långt bort
      this.camera.updateProjectionMatrix();
    }
    return D.car;
  }

  // --- Repris -------------------------------------------------------------------
  // Spela upp det senaste loppet. onEnd anropas när reprisen avslutas
  // (Esc/Enter eller slutet av inspelningen). Fysiken står still under tiden.
  get canReplay() { return !!this.replay && this.replay.frames > 1; }

  startReplay(onEnd) {
    if (!this.canReplay || this.replaying) return false;
    this.replaying = true;
    if (!this.replay.begin(() => { this.replaying = false; this.acc = 0; this.clock.getDelta(); onEnd?.(); })) { this.replaying = false; return false; }
    return true;
  }

  stopReplay() { if (this.replaying) this.replay.end(); }
  // --- slut repris ---

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post.setSize(window.innerWidth, window.innerHeight);
    if (!this.p2) { this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix(); }
  }

  run() {
    const loop = () => { requestAnimationFrame(loop); this.frame(); };
    loop();
  }
}

// Himmel som vertikal gradient: skyGradient = [topp, horisont, (botten)]
function makeSkyTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  const cols = stops.map((s) => '#' + new THREE.Color(s).getHexString());
  g.addColorStop(0, cols[0]);
  g.addColorStop(0.5, cols[1]);
  g.addColorStop(1, cols[2] ?? cols[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
