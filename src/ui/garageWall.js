import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createWorld, STEP, G, groups } from '../core/physics.js';
import { Vehicle } from '../vehicle/vehicle.js';
import { CarModel } from '../vehicle/carModel.js';
import { CARS, CAR_ORDER, carStats } from '../vehicle/carDefs.js';
import { isCarUnlocked, unlockHint, progressSummary } from '../race/progress.js';

// ---------------------------------------------------------------------------
// Garaget: en vägg i en leksaksaffär med alla bilar i var sin kartong, tre
// hyllor i sjuttiotalsfärger. För man musen över en kartong (eller går dit med
// piltangenterna) lyfts den fram mot spelaren och visar bilens fakta. Låsta
// bilar har ett hänglås på kartongen och berättar hur de låses upp.
//
// Bilderna i kartongernas fönster tas en gång av spelets egen 3D-motor: varje
// bil ställs på ett golv i en liten egen fysikvärld och fotograferas.
// ---------------------------------------------------------------------------

const CLASS_COLOR = { Rookie: '#3d9a4a', Amateur: '#2c86c8', Advanced: '#7c4bc0', 'Semi-Pro': '#e07a1c', Pro: '#c8342c' };
const COLS = 7;

const CSS = `
#garage { position: fixed; inset: 0; z-index: 60; display: none; flex-direction: column; align-items: center; overflow: hidden;
  font-family: "Cooper Black", Futura, "Arial Rounded MT Bold", "Trebuchet MS", sans-serif; font-weight: 700; color: #f4e7c5; user-select: none;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(255,236,190,.28), rgba(0,0,0,0) 60%),
    repeating-linear-gradient(90deg, #7a4a26 0 5.5vh, #6d4121 5.5vh 5.8vh, #84522b 5.8vh 11.5vh, #6d4121 11.5vh 11.8vh),
    #74461f; }
#garage.on { display: flex; }
#garage .sign { margin-top: 2.2vh; padding: .8vh 5vh 1vh; background: #d9622b; color: #f9edcd; border: .5vh solid #f4e7c5; border-radius: 3vh;
  font-size: 4.6vh; letter-spacing: .25vh; text-shadow: .35vh .35vh 0 #5a2a12; box-shadow: 0 .8vh 0 #5a2a12, 0 1.6vh 2.4vh rgba(0,0,0,.45); transform: rotate(-1.2deg); }
#garage .sign small { display: block; font-size: 1.7vh; letter-spacing: .12vh; text-shadow: none; color: #ffe9a8; text-align: center; }
#garage .wall { flex: 1; width: min(96vw, 190vh); display: flex; flex-direction: column; justify-content: space-evenly; perspective: 160vh; perspective-origin: 50% 40%; padding-bottom: 1vh; }
#garage .shelf { position: relative; display: flex; justify-content: space-evenly; align-items: flex-end; transform-style: preserve-3d; padding: 0 1vw 1.5vh; }
#garage .shelf::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1.5vh; border-radius: .4vh;
  background: linear-gradient(#c58a4a, #8a5a2c 70%, #5c3a1a); box-shadow: 0 1.4vh 1.6vh rgba(0,0,0,.5); }
#garage .gbox { position: relative; width: min(12.2vw, 22.5vh); aspect-ratio: 5 / 4.1; transform-style: preserve-3d; cursor: pointer;
  transition: transform .2s cubic-bezier(.2,.9,.3,1.25), filter .2s; z-index: 1; }
#garage .gb-card { position: absolute; inset: 0; border-radius: .7vh; overflow: hidden; background: var(--c);
  box-shadow: inset 0 0 0 .45vh #f4e7c5, inset 0 0 0 .7vh rgba(0,0,0,.25), 0 .9vh 1.2vh rgba(0,0,0,.5); transition: box-shadow .2s; }
#garage .gb-rays { position: absolute; inset: -40%; background: repeating-conic-gradient(from 0deg at 50% 62%, rgba(255,255,255,.2) 0 9deg, rgba(0,0,0,.08) 9deg 18deg); }
#garage .gb-dots { position: absolute; inset: 0; background: radial-gradient(rgba(0,0,0,.16) 22%, transparent 24%) 0 0 / .7vh .7vh; mix-blend-mode: multiply; }
#garage .gb-name { position: absolute; left: 0; right: 0; top: 0; height: 24%; display: flex; align-items: center; justify-content: center;
  background: #f2c230; color: #5a2a12; font-size: 2.15vh; letter-spacing: .08vh; border-bottom: .35vh solid #5a2a12; white-space: nowrap; }
#garage .gb-win { position: absolute; left: 6%; right: 6%; top: 28%; bottom: 17%; border-radius: .6vh; background: linear-gradient(160deg, #fff7e0, #e9d6a8);
  box-shadow: inset 0 0 0 .3vh #5a2a12, inset 0 .9vh 1.4vh rgba(0,0,0,.25); overflow: hidden; }
#garage .gb-win img { position: absolute; left: 50%; top: 52%; width: 112%; transform: translate(-50%, -50%); pointer-events: none; }
#garage .gb-win::after { content: ''; position: absolute; inset: 0; background: linear-gradient(115deg, rgba(255,255,255,.55) 0 12%, rgba(255,255,255,0) 13% 44%, rgba(255,255,255,.22) 45% 52%, rgba(255,255,255,0) 53%); }
#garage .gb-foot { position: absolute; left: 0; right: 0; bottom: 0; height: 14%; display: flex; align-items: center; justify-content: space-between; padding: 0 5%;
  background: #5a2a12; color: #f4e7c5; font-size: 1.15vh; letter-spacing: .1vh; font-family: "Trebuchet MS", system-ui, sans-serif; font-weight: 700; }
#garage .gb-burst { position: absolute; right: -4%; top: 16%; width: 30%; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; text-align: center;
  background: #e03a2a; color: #fff6d8; font-size: 1.25vh; line-height: 1.05; transform: rotate(12deg);
  clip-path: polygon(50% 0, 61% 14%, 79% 7%, 80% 25%, 98% 28%, 88% 43%, 100% 57%, 84% 64%, 88% 82%, 70% 80%, 62% 97%, 50% 84%, 38% 97%, 30% 80%, 12% 82%, 16% 64%, 0 57%, 12% 43%, 2% 28%, 20% 25%, 21% 7%, 39% 14%); }
#garage .gb-mine { position: absolute; left: -9%; top: 9%; padding: .2vh 3vh; background: #2f8a85; color: #fff6d8; font-size: 1.15vh; letter-spacing: .12vh; transform: rotate(-32deg); box-shadow: 0 .3vh .5vh rgba(0,0,0,.4); display: none; }
#garage .gbox.mine .gb-mine { display: block; }
#garage .gbox.locked .gb-win img { filter: saturate(.35) brightness(.72); }
#garage .gbox.secret .gb-win img { filter: brightness(0) opacity(.75); }
#garage .gb-lock { position: absolute; left: 50%; top: 58%; width: 26%; transform: translate(-50%, -50%) rotate(-6deg); display: none; filter: drop-shadow(0 .5vh .5vh rgba(0,0,0,.55)); pointer-events: none; }
#garage .gbox.locked .gb-lock { display: block; }
/* Lyfts fram mot spelaren. --dx och --dy drar kartongen lite in mot mitten, så att den inte hamnar utanför bilden i kanterna */
#garage .gbox.hover { transform: translate(var(--dx), var(--dy)) scale(1.5) rotateZ(-1.5deg); z-index: 5; }
#garage .gbox.hover .gb-card { box-shadow: inset 0 0 0 .45vh #fff6d8, inset 0 0 0 .7vh rgba(0,0,0,.25), 0 3.4vh 3.2vh rgba(0,0,0,.6); }
#garage .gbox.hover .gb-lock { animation: gb-swing .7s ease-out; }
@keyframes gb-swing { 0% { transform: translate(-50%, -50%) rotate(-22deg); } 40% { transform: translate(-50%, -50%) rotate(10deg); } 70% { transform: translate(-50%, -50%) rotate(-10deg); } 100% { transform: translate(-50%, -50%) rotate(-6deg); } }
#garage .gb-info { position: absolute; top: -4%; width: 104%; padding: .8vh 1vh .9vh; border-radius: .9vh; background: #f4e7c5; color: #3b2412; opacity: 0; pointer-events: none;
  font-family: "Trebuchet MS", system-ui, sans-serif; font-weight: 400; font-size: .95vh; line-height: 1.3; box-shadow: 0 0 0 .2vh #5a2a12, 0 1vh 1.4vh rgba(0,0,0,.5); transition: opacity .15s; }
#garage .gbox.right .gb-info { left: 104%; }
#garage .gbox.left .gb-info { right: 104%; }
#garage .gbox.hover .gb-info { opacity: 1; }
#garage .gb-info h4 { margin: 0 0 .2vh; font: 700 1.45vh "Cooper Black", Futura, "Arial Rounded MT Bold", sans-serif; color: #c8342c; }
#garage .gb-info .meta { color: #7a4a26; font-weight: 700; }
#garage .gb-info .req { margin: .5vh 0; padding: .45vh .7vh; background: #5a2a12; color: #ffe9a8; border-radius: .5vh; font-weight: 700; }
#garage .gb-info .bar { display: grid; grid-template-columns: 38% 1fr; align-items: center; gap: .6vh; margin-top: .3vh; }
#garage .gb-info .bar i { display: block; height: .7vh; border-radius: .5vh; background: #d9c69a; overflow: hidden; }
#garage .gb-info .bar i b { display: block; height: 100%; background: #2f8a85; }
#garage .gb-info .bar.hard i b { background: #d9622b; }
#garage .hint { padding: .9vh 2.4vh 1.6vh; font: 700 1.7vh "Trebuchet MS", system-ui, sans-serif; color: #ffe9a8; text-shadow: 0 .2vh 0 rgba(0,0,0,.5); }
`;

// Hänglås i mässing, eget ritat
const LOCK = `<svg viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg"><path d="M16 36V24a16 16 0 0 1 32 0v12" fill="none" stroke="#c9ccd2" stroke-width="8" stroke-linecap="round"/><path d="M16 36V24a16 16 0 0 1 32 0v12" fill="none" stroke="#6c7078" stroke-width="2"/><rect x="6" y="34" width="52" height="42" rx="7" fill="#e2a52b" stroke="#5a3a12" stroke-width="3"/><rect x="10" y="38" width="44" height="8" rx="3" fill="#f6cf6a"/><circle cx="32" cy="54" r="6" fill="#5a3a12"/><path d="M29 56h6l2 12h-10z" fill="#5a3a12"/></svg>`;

const bar = (label, v, cls = '') => `<div class="bar ${cls}"><span>${label}</span><i><b style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></b></i></div>`;

export class GarageWall {
  constructor(game) {
    this.game = game;
    this.thumbs = null; // bil-id → bild, tas första gången garaget öppnas
    this.isOpen = false;
    this.index = 0;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.id = 'garage';
    document.body.appendChild(this.el);
    this.el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.close(); });
  }

  // Fotografera alla bilar: var och en ställs på ett golv i en egen liten fysikvärld,
  // får sätta sig på fjädrarna och ritas snett framifrån mot genomskinlig bakgrund.
  _shoot() {
    const RAPIER = this.game.RAPIER, W = 460, H = 300;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(W, H);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.75;
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
    sun.position.set(1.5, 3, 2);
    scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x8a7458, 0.9));
    const cam = new THREE.PerspectiveCamera(24, W / H, 0.05, 10);
    cam.position.set(0.66, 0.34, 0.74);
    cam.lookAt(0, 0.045, 0);
    const out = {};
    for (const id of CAR_ORDER) {
      const world = createWorld(RAPIER);
      world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.1, 4).setTranslation(0, -0.1, 0).setFriction(0.9).setCollisionGroups(groups(G.WORLD)), world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
      const v = new Vehicle(world, RAPIER, CARS[id], { x: 0, y: 0.15, z: 0, heading: 0 });
      v.autoFlip = false;
      for (let k = 0; k < 110; k++) { v.update(STEP, { throttle: 0, steer: k > 70 ? 0.6 : 0 }); world.step(); v.snapshot(); }
      const model = new CarModel(v);
      model.update(1, 0);
      scene.add(model.root);
      r.render(scene, cam);
      out[id] = r.domElement.toDataURL('image/png');
      scene.remove(model.root);
      world.free();
    }
    pm.dispose();
    r.dispose();
    return out;
  }

  // sel: menyns val ({ carId, cls }), onClose anropas när väggen stängs
  open(sel, onClose) {
    this.sel = sel; this.onClose = onClose;
    this.thumbs ||= this._shoot();
    this.index = Math.max(0, CAR_ORDER.indexOf(sel.carId));
    this._build();
    this.el.classList.add('on');
    this.isOpen = true;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('on');
    this.onClose?.();
  }

  _build() {
    const levelName = (id) => this.game.levels.find((l) => l.id === id)?.name ?? id;
    const box = (id, i) => {
      const d = CARS[id], open = isCarUnlocked(id), secret = !open && d.secret, s = carStats(d);
      const name = secret ? '???' : d.name;
      const info = open
        ? `<h4>${d.name}</h4><div class="meta">${d.cls} · ${d.engine === 'Glow' ? 'Glow (nitro)' : 'El'} · ${d.drive}${d.assist ? ' · körhjälp' : ''}</div>
           ${d.desc ? `<div>${d.desc}</div>` : ''}${bar('Fart', s.fart)}${bar('Acceleration', s.acc)}${bar('Grepp', s.grepp)}${bar('Vikt', s.vikt)}${bar('Svårighet', s.svar, 'hard')}`
        : `<h4>🔒 ${name}</h4><div class="meta">${d.cls}${secret ? ' · hemlig bil' : ` · ${d.engine === 'Glow' ? 'Glow (nitro)' : 'El'} · ${d.drive}`}</div>
           <div class="req">${unlockHint(id, levelName)}</div>${secret ? '' : `${d.desc ? `<div>${d.desc}</div>` : ''}${bar('Fart', s.fart)}${bar('Acceleration', s.acc)}${bar('Svårighet', s.svar, 'hard')}`}`;
      return `<div class="gbox ${i % COLS < 4 ? 'right' : 'left'}${open ? '' : ' locked'}${secret ? ' secret' : ''}${id === this.sel.carId ? ' mine' : ''}" data-i="${i}" style="--c:${CLASS_COLOR[d.cls] || '#888'};--dx:${((3 - (i % COLS)) * 1.3).toFixed(1)}vw;--dy:${((1 - Math.floor(i / COLS)) * 3.5).toFixed(1)}vh">
        <div class="gb-card"><div class="gb-rays"></div><div class="gb-dots"></div>
          <div class="gb-name">${name.toUpperCase()}</div>
          <div class="gb-win"><img alt="" src="${this.thumbs[id]}"></div>
          <div class="gb-foot"><span>${d.cls.toUpperCase()}</span><span>RADIOSTYRD</span></div>
          <div class="gb-burst">${secret ? '?' : `${Math.round(d.topSpeed * 3.6)}<br>km/h`}</div>
          <div class="gb-mine">DIN BIL</div></div>
        <div class="gb-lock">${LOCK}</div>
        <div class="gb-info">${info}</div></div>`;
    };
    const rows = [];
    for (let k = 0; k < CAR_ORDER.length; k += COLS) rows.push(CAR_ORDER.slice(k, k + COLS).map((id, j) => box(id, k + j)).join(''));
    this.el.innerHTML = `<div class="sign">★ BILHYLLAN ★<small>${progressSummary().carsUnlocked} av ${CAR_ORDER.length} bilar upplåsta</small></div>
      <div class="wall">${rows.map((r) => `<div class="shelf">${r}</div>`).join('')}</div>
      <div class="hint">För musen över en kartong · klicka eller tryck Enter för att välja bilen · Esc tillbaka</div>`;
    this.boxes = [...this.el.querySelectorAll('.gbox')];
    this.boxes.forEach((b, i) => {
      b.addEventListener('mouseenter', () => this._focus(i, false));
      b.addEventListener('click', () => { this._focus(i, false); this._pick(); });
    });
    this._focus(this.index, true);
  }

  _focus(i, quiet) {
    if (i !== this.index && !quiet) this.game.events.emit('ui', { name: 'move' });
    this.index = i;
    this.boxes.forEach((b, k) => b.classList.toggle('hover', k === i));
  }

  // Välj bilen som sin (bara upplåsta)
  _pick() {
    const id = CAR_ORDER[this.index];
    if (!isCarUnlocked(id)) { this.game.events.emit('ui', { name: 'back' }); return; }
    this.sel.carId = id; this.sel.cls = CARS[id].cls;
    this.game.events.emit('ui', { name: 'select' });
    this.boxes.forEach((b, k) => b.classList.toggle('mine', k === this.index));
  }

  // Tangenter medan väggen är öppen. Returnerar true om tangenten togs om hand.
  key(code) {
    const n = CAR_ORDER.length, i = this.index;
    if (code === 'ArrowLeft' || code === 'KeyA') this._focus((i - 1 + n) % n);
    else if (code === 'ArrowRight' || code === 'KeyD') this._focus((i + 1) % n);
    else if (code === 'ArrowUp' || code === 'KeyW') this._focus((i - COLS + n) % n);
    else if (code === 'ArrowDown' || code === 'KeyS') this._focus((i + COLS) % n);
    else if (code === 'Enter' || code === 'Space') this._pick();
    else if (code === 'Escape' || code === 'Backspace') this.close();
    else return false;
    return true;
  }
}
