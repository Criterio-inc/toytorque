import { CARS, CAR_ORDER, carStats } from '../vehicle/carDefs.js';
import { CUPS, Championship, loadProgress, QUALIFY } from '../race/championship.js';
import { formatTime, ordinal } from './hud.js';
import { isCarUnlocked, isCupOpen, unlockHint, applyTimeTrial, progressSummary, setDevAll, resetProgress, CHALLENGE, fmt as fmtChallenge } from '../race/progress.js';
import { loadStuntProgress } from '../stunt/stunt.js';
import { TrackEditor } from '../editor/editor.js';

// ---------------------------------------------------------------------------
// Menyerna: startmeny, bilval, banval, mästerskap, tidskörning, inställningar,
// paus och resultat. Bakom menyn går ett demolopp med filmkameror.
// Styrs med piltangenter/WASD, Enter och Esc (eller musen).
// ---------------------------------------------------------------------------

const CLASSES = ['Rookie', 'Amateur', 'Advanced', 'Semi-Pro', 'Pro'];
const BLURB = {
  lagret: 'Leksakslagret. En åtta med bro över korsningen och ett hopp på långsidan.',
  kitchen: 'Köket. Ett stort kök med matsal i riktig skala: längs bänkskåpen förbi spisen och kylen, hopp över kokböckerna, runt köksön med barstolarna och rakt in under matbordet mellan stolsbenen.',
  spokstaden: 'Spökstaden. Västerngatan, gruvtunneln och plankhoppet över bäcken.',
  kryssaren: 'Kryssaren. Kappkörning på däck, upp till soldäcket och genom promenaden.',
  tradgarden: 'Trädgården. Palmhuset med dammen, stenbron och hoppet.',
  leksaksaffaren: 'Leksaksaffären. Nattöppet bland hyllorna: regnbågsrampen, borgtunneln vid roboten och hoppet.',
  museet: 'Museet. Nattligt museum: dinosaurien, Egyptensalen, hoppet över det svarta hålet och rulltrappan upp till galleriet.',
  kvarteret: 'Kvarteret. Villagatan i solsken, skaterampen, rondellen och genvägen genom garaget.',
  supermarket: 'Supermarketen. Hyllgångar, kampanjhopp, lastkajen och det hala frysrummet.',
};
const SETTINGS_KEY = 'revolt.settings';

// Loggan som SVG: tjock svart kontur, vit innerkant, glansiga gradienter,
// fartstreck och rutig flagga (i stil med ToyTorque-omslaget)
const LOGO_SVG = `<svg class="brand" viewBox="0 0 1200 330" overflow="visible" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ToyTorque">
  <defs>
    <linearGradient id="gToy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff7a0"/><stop offset=".35" stop-color="#ffd21a"/><stop offset=".7" stop-color="#ff8a12"/><stop offset="1" stop-color="#ff4a0e"/></linearGradient>
    <linearGradient id="gTorque" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6fbff"/><stop offset=".35" stop-color="#5fd2ff"/><stop offset=".75" stop-color="#1f86f0"/><stop offset="1" stop-color="#0e4fc4"/></linearGradient>
    <linearGradient id="gShine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <pattern id="chk" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#fff"/><rect width="9" height="9" fill="#111"/><rect x="9" y="9" width="9" height="9" fill="#111"/></pattern>
  </defs>
  <g transform="translate(60 40) skewX(-14) rotate(-5 520 150)">
    <path d="M40 70 L620 22 L624 34 L44 84 Z" fill="#ff8a12" opacity=".85"/>
    <path d="M560 40 L1080 0 L1083 10 L563 52 Z" fill="#39b9ff" opacity=".85"/>
    <path d="M60 205 L760 150 L770 168 L70 222 Z" fill="#ff6a12" opacity=".9"/>
    <path d="M90 232 L700 186 L705 198 L95 244 Z" fill="#39b9ff" opacity=".85"/>
    <rect x="600" y="214" width="240" height="36" fill="url(#chk)" transform="skewX(-20)" opacity=".95"/>
    <g font-family="'Arial Black','Trebuchet MS',sans-serif" font-weight="900" font-style="italic" font-size="180" letter-spacing="-6" paint-order="stroke" stroke-linejoin="round">
      <text x="40" y="200" stroke="#0b0716" stroke-width="64" fill="#0b0716" transform="translate(10 12)">ToyTorque</text>
      <text x="40" y="200" stroke="#0b0716" stroke-width="60">ToyTorque</text>
      <text x="40" y="200" stroke="#ffffff" stroke-width="14">ToyTorque</text>
      <text x="40" y="200"><tspan fill="url(#gToy)">Toy</tspan><tspan fill="url(#gTorque)">Torque</tspan></text>
      <text x="40" y="200" fill="url(#gShine)">ToyTorque</text>
    </g>
  </g>
</svg>`;
const DIFF = [['easy', 'Lätt'], ['normal', 'Normal'], ['hard', 'Svår']];
// Körhjälp för spelarnas bilar: antisladd, antispinn och hjälp vid väggträffar
const ASSIST = [['off', 'Av', 0], ['normal', 'Normal', 0.4], ['high', 'Mycket', 1]];
const assistOf = (k) => (ASSIST.find((a) => a[0] === k) || ASSIST[1])[2];

export class Menu {
  constructor(game) {
    this.game = game;
    this.levels = game.levels;
    this.settings = { difficulty: 'normal', laps: 3, opponents: 7, weapons: true, gfx: 'high', assist: 'normal', ...loadSettings() };
    game.setAssist(assistOf(this.settings.assist));
    game.setGraphics(this.settings.gfx === 'low');
    game.shakeOn = this.settings.shake !== false;
    this.sel = { carId: game.carId, cls: CARS[game.carId].cls, level: game.levelDef.id, cup: CUPS[0] };
    this.stack = [];
    this.index = 0;
    this.open = false;
    this.flow = null; // 'race' | 'cup' | 'timetrial' | 'stunt'
    this.cup = null;
    this.resultShown = false;
    this.swallowUntil = 0;

    this.el = document.createElement('div');
    this.el.id = 'menu';
    document.body.appendChild(this.el);

    // Spelet frågar menyn först om knapptryck
    game.onAction = (a) => this._onGameAction(a);
    window.addEventListener('keydown', (e) => this._key(e));
    // Med mus eller styrplatta: högerklick går tillbaka (som Esc)
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.open || !this.screen) return;
      if (this.screen.onBack) this.screen.onBack(); else if (this.stack.length) this.back();
    });
    // Dold flik eller tappat fokus mitt i ett lopp: pausa, så att datorförarna
    // inte kör vidare medan spelaren är borta (Cmd+Tab i Mac-appen)
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.autoPause(); });
    window.addEventListener('blur', () => this.autoPause());
    // Sparandet misslyckades (lagringen full eller avstängd)
    window.addEventListener('revolt:savefailed', () => this.game.hud.message('Kunde inte spara', { warn: true, time: 2.5 }));
  }

  autoPause() {
    const g = this.game;
    if (this.open || this.editor?.isOpen || g.replaying) return;
    if (!['race', 'timetrial', 'stunt'].includes(g.mode) || g.race.state === 'finished') return;
    this.stack = [];
    this.go(this.pauseScreen(), { replace: true });
  }

  // --- Navigering ----------------------------------------------------------------
  go(screen, opts = {}) {
    if (!opts.replace && this.screen) this.stack.push({ screen: this.screen, index: this.index });
    this.screen = screen;
    this.index = opts.index ?? 0;
    this.show();
    screen.enter?.();
  }

  back() {
    const prev = this.stack.pop();
    if (!prev) return;
    this.screen = prev.screen;
    this.index = prev.index;
    this.ui('back');
    this.show();
    this.screen.enter?.();
  }

  home() {
    this.stack = [];
    this.screen = null;
    this.flow = null;
    this.cup = null;
    this.game.setup({ mode: 'demo', level: this._randomLevel() });
    this.game.audio?.playMusic?.('menu');
    this.go(this.mainScreen(), { replace: true });
  }

  show() {
    this.open = true;
    document.body.classList.add('menu-open');
    this.game.paused = this.game.mode !== 'demo' && this.game.mode !== 'showroom';
    this.el.style.display = 'flex';
    this.render();
  }

  hide() {
    this.open = false;
    this.swallowUntil = performance.now() + 150; // samma knapptryck ska inte nå spelet
    document.body.classList.remove('menu-open');
    this.el.style.display = 'none';
    this.game.paused = false;
  }

  ui(name) { this.game.events.emit('ui', { name }); }

  _key(e) {
    if (!this.open) return;
    const items = this.screen.items.filter((i) => !i.disabled);
    const cur = items[this.index];
    const k = e.code;
    if (k === 'ArrowUp' || k === 'KeyW') { this.index = (this.index - 1 + items.length) % items.length; this.ui('move'); this.render(); this.screen.onMove?.(items[this.index]); }
    else if (k === 'ArrowDown' || k === 'KeyS') { this.index = (this.index + 1) % items.length; this.ui('move'); this.render(); this.screen.onMove?.(items[this.index]); }
    else if (k === 'ArrowLeft' || k === 'KeyA') { if (cur?.left) { cur.left(); this.ui('move'); this.render(); } else if (this.screen.left) { this.screen.left(); this.ui('move'); } }
    else if (k === 'ArrowRight' || k === 'KeyD') { if (cur?.right) { cur.right(); this.ui('move'); this.render(); } else if (this.screen.right) { this.screen.right(); this.ui('move'); } }
    else if (k === 'Enter' || k === 'Space') { if (cur?.select) { this.ui('select'); cur.select(); } }
    else if (k === 'Escape' || k === 'Backspace') { if (this.screen.onBack) this.screen.onBack(); else if (this.stack.length) this.back(); }
    else return;
    e.preventDefault();
    // Samma tangenttryck får inte nå banbyggaren som just öppnades (Enter la annars en bit)
    e.stopImmediatePropagation();
  }

  // Under lopp: Esc öppnar paus. Med menyn öppen äter vi alla spelets knappar.
  _onGameAction(a) {
    if (this.editor?.isOpen) return true; // banbyggaren äter allt
    if (this.open || performance.now() < this.swallowUntil) return true;
    if (a === 'pause') { this.go(this.pauseScreen(), { replace: true }); this.stack = []; return true; }
    if (a === 'restart' && this.game.race.state === 'finished') return true; // resultatmenyn sköter det
    // Inga genvägar i menyflöden: Enter mitt i loppet ska inte starta om (det görs i pausmenyn,
    // annars kan man i mästerskapet köra om utan att förbruka försök)
    if (a === 'restart' || a === 'level' || a.startsWith('car')) return this.flow !== null;
    return false;
  }

  // Efter målgång: visa resultatmenyn en stund senare
  // Anropas av spelet varje bild (fungerar även när fönstret är dolt)
  tick() {
    {
      const g = this.game;
      if (g.race.state !== 'finished') { this.resultShown = false; this._finishAt = 0; }
      if (this.open || g.mode === 'demo' || g.mode === 'showroom') { this.resultShown = false; return; }
      if (g.race.state === 'finished' && !this.resultShown) {
        this.resultShown = true;
        this._finishAt = performance.now();
      }
      if (this.resultShown && this._finishAt && performance.now() - this._finishAt > 2600) {
        this._finishAt = 0;
        this.stack = [];
        this.go(this.flow === 'cup' ? this.cupResultScreen() : this.resultScreen(), { replace: true });
      }
    }
  }

  // --- Skärmar ------------------------------------------------------------------
  mainScreen() {
    return {
      title: 'LOGO', sub: 'Radiostyrd racing',
      items: [
        { label: 'Enkelt lopp', select: () => { this.flow = 'race'; this.go(this.carScreen(() => this.go(this.trackScreen(() => this.startRace())))); } },
        { label: 'Mästerskap', select: () => { this.flow = 'cup'; this.go(this.cupScreen()); } },
        { label: 'Två spelare', select: () => { this.flow = 'race2'; this.go(this.carScreen(() => this.go(this.carScreen(() => this.go(this.trackScreen(() => this.startRace(2))), 2)))); } },
        { label: 'Tidskörning', select: () => { this.flow = 'timetrial'; this.go(this.carScreen(() => this.go(this.trackScreen(() => this.startTimeTrial())))); } },
        // --- Stuntläge: fri körning i Stuntarenan ---
        { get label() { const p = loadStuntProgress(); return `Stuntarena <small>★ ${p.stars.length}/20${p.allStars ? ' · klar' : ''}</small>`; }, select: () => { this.flow = 'stunt'; this.go(this.carScreen(() => this.startStunt())); } },
        { label: 'Banbyggaren', select: () => this.openEditor() },
        { label: 'Inställningar', select: () => this.go(this.optionsScreen()) },
      ],
      onBack: () => {},
      enter: () => this._demoBehind(),
      hint: '↑↓ välj · Enter starta',
    };
  }

  carScreen(next, player = 1) {
    const key = player === 2 ? 'carId2' : 'carId';
    if (!this.sel[key]) this.sel[key] = this.sel.carId;
    const self = this;
    const list = () => CAR_ORDER.filter((id) => CARS[id].cls === this.sel.cls);
    const classes = CLASSES.filter((c) => CAR_ORDER.some((id) => CARS[id].cls === c));
    const preview = () => this.game.setup({ mode: 'showroom', carId: this.sel[key], level: this.sel.level });
    const scr = {
      title: player === 2 ? 'Spelare 2: välj bil' : this.flow === 'race2' ? 'Spelare 1: välj bil' : 'Välj bil',
      get sub() { return `◀ ${self.sel.cls} ▶`; },
      get items() {
        // Låsta bilar går att titta på men inte välja
        return list().map((id) => {
          const locked = !isCarUnlocked(id);
          return { label: locked ? `🔒 ${CARS[id].secret ? '???' : CARS[id].name}` : CARS[id].name, id, locked, select: () => { if (locked) self.ui('back'); else next(); } };
        });
      },
      side: () => (isCarUnlocked(this.sel[key])
        ? carCard(CARS[this.sel[key]])
        : lockedCard(CARS[this.sel[key]], unlockHint(this.sel[key], (id) => this._levelName(id)))),
      enter: () => {
        const ids = list();
        if (!ids.includes(this.sel[key])) this.sel[key] = ids.find((id) => isCarUnlocked(id)) ?? ids[0];
        this.index = Math.max(0, ids.indexOf(this.sel[key]));
        this.render();
        preview();
      },
      onMove: (item) => { this.sel[key] = item.id; this.render(); preview(); },
      left: () => switchClass(-1),
      right: () => switchClass(1),
      get hint() { return `↑↓ bil · ◀▶ klass · Enter välj · Esc tillbaka · ${progressSummary().carsUnlocked}/${CAR_ORDER.length} bilar upplåsta`; },
    };
    const switchClass = (d) => {
      const i = classes.indexOf(this.sel.cls);
      this.sel.cls = classes[(i + d + classes.length) % classes.length];
      this.sel[key] = list().find((id) => isCarUnlocked(id)) ?? list()[0];
      this.index = Math.max(0, list().indexOf(this.sel[key]));
      this.render();
      preview();
    };
    return scr;
  }

  trackScreen(next) {
    const preview = () => this.game.setup({ mode: 'demo', level: this.sel.level, carId: this.sel.carId });
    return {
      title: 'Välj bana',
      items: this.levels.map((l) => ({ label: l.name, id: l.id, select: () => next() })),
      side: () => trackCard(this.levels.find((l) => l.id === this.sel.level), this),
      enter: () => {
        this.index = Math.max(0, this.levels.findIndex((l) => l.id === this.sel.level));
        this.render();
        preview();
      },
      onMove: (item) => { this.sel.level = item.id; this.render(); preview(); },
      hint: '↑↓ bana · Enter kör · Esc tillbaka',
    };
  }

  cupScreen() {
    const prog = loadProgress();
    return {
      title: 'Mästerskap',
      items: CUPS.map((c) => {
        const open = isCupOpen(c.id, prog);
        return {
          label: `${c.name}${prog.won.includes(c.id) ? ' ★' : ''}${open ? '' : ' (låst)'}`,
          disabled: !open,
          select: () => { this.sel.cup = c; this.go(this.carScreen(() => this.startCup())); },
        };
      }),
      side: () => `<div class="card"><h3>Så funkar det</h3><p>Åtta bilar kör ${CUPS[0].races.length}–${CUPS[CUPS.length - 1].races.length} lopp. Poäng 10, 6, 4, 3, 2, 1. Du måste bli topp ${QUALIFY} i varje lopp och har tre försök på dig. Vinner du cupen öppnas nästa.</p>
        ${CUPS.map((c) => `<p><b>${c.name}</b>: ${c.races.map((id) => this._levelName(id)).join(', ')} · ${DIFF.find((d) => d[0] === c.difficulty)[1]}</p>`).join('')}</div>`,
      enter: () => this._demoBehind(),
      hint: '↑↓ välj cup · Enter · Esc tillbaka',
    };
  }

  optionsScreen() {
    const s = this.settings;
    const cyc = (arr, v, d) => arr[(arr.indexOf(v) + d + arr.length) % arr.length];
    const vol = () => this.game.audio?.getVolume?.() || null;
    const items = [
      { get label() { return `Svårighet: ${DIFF.find((d) => d[0] === s.difficulty)[1]}`; }, left: () => { s.difficulty = cyc(DIFF.map((d) => d[0]), s.difficulty, -1); }, right: () => { s.difficulty = cyc(DIFF.map((d) => d[0]), s.difficulty, 1); } },
      { get label() { return `Körhjälp: ${(ASSIST.find((a) => a[0] === s.assist) || ASSIST[1])[1]}`; }, left: () => { s.assist = cyc(ASSIST.map((a) => a[0]), s.assist, -1); this.game.setAssist(assistOf(s.assist)); }, right: () => { s.assist = cyc(ASSIST.map((a) => a[0]), s.assist, 1); this.game.setAssist(assistOf(s.assist)); } },
      { get label() { return `Varv: ${s.laps}`; }, left: () => { s.laps = Math.max(1, s.laps - 1); }, right: () => { s.laps = Math.min(9, s.laps + 1); } },
      { get label() { return `Motståndare: ${s.opponents}`; }, left: () => { s.opponents = Math.max(0, s.opponents - 1); }, right: () => { s.opponents = Math.min(7, s.opponents + 1); } },
      { get label() { return `Vapen: ${s.weapons ? 'På' : 'Av'}`; }, left: () => { s.weapons = !s.weapons; }, right: () => { s.weapons = !s.weapons; } },
      { get label() { return `Grafik: ${s.gfx === 'low' ? 'Enkel' : 'Tuff'}`; }, left: () => { s.gfx = s.gfx === 'low' ? 'high' : 'low'; this.game.setGraphics(s.gfx === 'low'); }, right: () => { s.gfx = s.gfx === 'low' ? 'high' : 'low'; this.game.setGraphics(s.gfx === 'low'); } },
      { get label() { return `Skakning: ${s.shake !== false ? 'På' : 'Av'}`; }, left: () => { s.shake = s.shake === false; this.game.shakeOn = s.shake; }, right: () => { s.shake = s.shake === false; this.game.shakeOn = s.shake; } },
    ];
    if (vol()) {
      for (const [k, name] of [['music', 'Musik'], ['sfx', 'Ljudeffekter']]) {
        items.push({
          get label() { return `${name}: ${Math.round((vol()[k] ?? 1) * 10)}`; },
          left: () => this.game.audio.setVolume({ [k]: Math.max(0, (vol()[k] ?? 1) - 0.1) }),
          right: () => this.game.audio.setVolume({ [k]: Math.min(1, (vol()[k] ?? 1) + 0.1) }),
        });
      }
    }
    items.push({ label: 'Framsteg', select: () => this.go(this.progressScreen()) });
    items.push({ label: 'Om spelet', select: () => this.go(this.aboutScreen()) });
    items.push({ label: 'Klar', select: () => this.back() });
    for (const it of items) for (const f of ['left', 'right']) if (it[f]) { const fn = it[f]; it[f] = () => { fn(); saveSettings(s); }; }
    return { title: 'Inställningar', items, onBack: () => { saveSettings(s); this.back(); }, hint: '↑↓ välj · ◀▶ ändra · Esc klar' };
  }

  pauseScreen() {
    const stunt = this.game.mode === 'stunt';
    return {
      title: 'Paus',
      items: [
        { label: 'Fortsätt', select: () => this.hide() },
        { label: stunt ? 'Börja om' : 'Starta om loppet', select: () => { this.hide(); this._restart(); } },
        ...(stunt ? [{ label: 'Nollställ stjärnorna', select: () => { this.game.stunt?.resetStars(); this.hide(); this._restart(); } }] : []),
        ...(this.flow === 'editor' ? [{ label: 'Till banbyggaren', select: () => this.openEditor() }] : []),
        { label: 'Till startmenyn', select: () => this.home() },
      ],
      onBack: () => this.hide(),
      hint: 'Esc fortsätt',
    };
  }

  resultScreen() {
    const g = this.game;
    const r = g.racer;
    const best = g.ghost?.bestTime;
    // Tidskörning: jämför bästa varvet med banans utmaningstid (en gång per målgång)
    const tt = g.mode === 'timetrial' ? applyTimeTrial(g.levelDef.id, r.bestLap) : null;
    // Två spelare: vem av spelarna kom först, och båda placeringarna
    const r2 = g.p2?.racer;
    const pl = (x) => `${x.position}${ordinal(x.position)}`;
    const scr = {
      title: g.mode === 'timetrial' ? 'Tidskörning' : r2 ? `Spelare ${r2.position < r.position ? 2 : 1} vann!` : `${pl(r)} plats`,
      sub: r2 ? `${g.levelDef.name} · Spelare 1: ${pl(r)} · Spelare 2: ${pl(r2)}` : `${g.levelDef.name} · ${CARS[g.carId].name}`,
      items: [
        { label: 'Kör igen', select: () => { this.hide(); this._restart(); } },
        this.flow === 'editor' ? { label: 'Till banbyggaren', select: () => this.openEditor() } : { label: 'Byt bana', select: () => { this.stack = []; this.screen = null; this.go(this.trackScreen(() => (this.flow === 'timetrial' ? this.startTimeTrial() : this.startRace(this.flow === 'race2' ? 2 : 1))), { replace: true }); } },
        ...this._replayItem(() => scr),
        { label: 'Till startmenyn', select: () => this.home() },
      ],
      side: () => `<div class="card"><h3>Resultat</h3>
        <p>Total tid: <b>${formatTime(r.finishTime) ?? '--'}</b></p>
        <p>Bästa varv: <b>${formatTime(r.bestLap) ?? '--'}</b></p>
        ${best != null ? `<p>Banrekord (spöke): <b>${formatTime(best)}</b></p>` : ''}
        ${tt?.challenge != null ? `<p>Utmaning: <b>${fmtChallenge(tt.challenge)}</b> · ${tt.beaten ? '<span class="ok">Slagen! ★</span>' : '<span class="no">Inte slagen</span>'}</p>` : ''}
        ${g.mode !== 'timetrial' ? resultsTable(g.race.racers) : ''}</div>`,
      onBack: () => this.home(),
      hint: 'Enter välj',
    };
    return this._withUnlocks(tt?.cars, scr);
  }

  // --- Upplåsning: "UPPLÅST!" före resultatskärmen om något nytt öppnats ---
  _withUnlocks(newCars, scr) {
    if (!newCars?.length) return scr;
    const cont = () => { this.stack = []; this.go(scr, { replace: true }); };
    return {
      title: '<span class="unlocked">UPPLÅST!</span>',
      sub: newCars.length === 1 ? 'En ny bil i garaget' : `${newCars.length} nya bilar i garaget`,
      items: [{ label: 'Fortsätt', select: cont }],
      side: () => `<div class="unlockgrid">${newCars.map((id) => carCard(CARS[id], true)).join('')}</div>`,
      onBack: cont,
      hint: 'Enter fortsätt',
    };
  }

  // --- Framsteg: cuper, bilar, tidsutmaningar; utvecklarläge och nollställning ---
  progressScreen() {
    const sum = () => progressSummary();
    const toggle = () => setDevAll(!sum().devAll);
    return {
      title: 'Framsteg',
      get sub() { const p = sum(); return `${p.carsUnlocked}/${p.carsTotal} bilar · ${p.cupsWon}/${p.cupsTotal} cuper`; },
      items: [
        { get label() { return `Utvecklarläge, lås upp allt: ${sum().devAll ? 'På' : 'Av'}`; }, select: () => { toggle(); this.render(); }, left: toggle, right: toggle },
        { label: 'Nollställ framsteg', select: () => this.go(this.confirmScreen('Nollställ?', 'Cuper, bilar och tidsutmaningar börjar om från början. Spökbilar och stuntstjärnor finns kvar.', () => { resetProgress(); this.back(); })) },
        { label: 'Tillbaka', select: () => this.back() },
      ],
      side: () => {
        const p = sum();
        const cups = CUPS.map((c) => `${p.won.includes(c.id) ? '★' : '☆'} ${c.name}`).join(' · ');
        const cls = CLASSES.map((k) => {
          const all = CAR_ORDER.filter((id) => CARS[id].cls === k);
          return `${k} <b>${all.filter((id) => p.cars.includes(id)).length}/${all.length}</b>`;
        }).join(' · ');
        const tt = Object.entries(CHALLENGE).map(([id, t]) => [p.ttLevels.includes(id) ? '★' : '☆', this._levelName(id), fmtChallenge(t), p.ttLevels.includes(id)]);
        return `<div class="card"><h3>Cuper ${p.cupsWon}/${p.cupsTotal}</h3><p>${cups}</p>
          <h3>Bilar ${p.carsUnlocked}/${p.carsTotal}</h3><p>${cls}</p>
          <h3>Tidsutmaningar ${p.ttBeaten}/${p.ttTotal}</h3>${table(tt)}
          <p class="meta">Vinn ett mästerskapslopp så låses en bil i klassen över din upp.</p></div>`;
      },
      hint: '↑↓ välj · Enter · Esc tillbaka',
    };
  }

  // Upphov och licenser. Hela licenstexterna följer med i licenser.txt.
  aboutScreen() {
    return {
      title: 'Om spelet',
      items: [{ label: 'Tillbaka', select: () => this.back() }],
      side: () => `<div class="card"><h3>ToyTorque</h3>
        <p>Radiostyrd racing av Pär Levander, Critero Consulting. Fri programvara under MIT-licensen.</p>
        <h3>Byggt med</h3>
        <p>three.js (MIT) och Rapier (Apache 2.0). Licenstexterna finns i filen licenser.txt bredvid spelet.</p></div>`,
      hint: 'Enter · Esc tillbaka',
    };
  }

  confirmScreen(title, text, yes) {
    return {
      title,
      items: [{ label: 'Nej', select: () => this.back() }, { label: 'Ja, nollställ', select: yes }],
      side: () => `<div class="card"><p>${text}</p></div>`,
      hint: 'Enter välj · Esc avbryt',
    };
  }

  // "Se repris": spela upp loppet och kom tillbaka till samma skärmobjekt
  // (cupResultScreen() får inte anropas igen, då räknas poängen två gånger)
  _replayItem(getScreen) {
    if (!this.game.canReplay) return [];
    return [{
      label: 'Se repris',
      select: () => {
        const scr = getScreen();
        const index = scr.items.filter((i) => !i.disabled).findIndex((i) => i.label === 'Se repris');
        const ok = this.game.startReplay(() => {
          this.stack = [];
          this.go(scr, { replace: true, index: Math.max(0, index) });
          this._swallow();
        });
        if (ok) { this.stack = []; this.hide(); this.game.input.queue.length = 0; }
      },
    }];
  }

  cupResultScreen() {
    const c = this.cup;
    const outcome = c.record(this.game.race.racers);
    const titles = { next: 'Vidare!', retry: 'Försök igen', failed: 'Utslagen', done: c.won ? `Du vann ${c.cup.name}!` : `${c.cup.name} klar` };
    const items = [];
    if (outcome === 'next') items.push({ label: `Nästa lopp: ${this._levelName(c.level)}`, select: () => this.startCupRound() });
    if (outcome === 'retry') items.push({ label: `Kör om (${c.tries} försök kvar)`, select: () => this.startCupRound() });
    items.push(...this._replayItem(() => scr));
    items.push({ label: 'Till startmenyn', select: () => this.home() });
    const scr = {
      title: titles[outcome],
      sub: outcome === 'retry' ? `Du måste bli topp ${QUALIFY} för att gå vidare` : outcome === 'done' || outcome === 'failed' ? c.cup.name : c.roundLabel,
      items,
      side: () => `<div class="card"><h3>Loppet</h3>${table(c.lastResult.map((r) => [`${r.position}${ordinal(r.position)}`, r.name, outcome === 'retry' || outcome === 'failed' ? '' : `+${r.points}`, r.isPlayer]))}
        <h3>Ställning</h3>${table(c.standings().map((r, i) => [`${i + 1}.`, r.name, `${r.points} p`, r.isPlayer]))}</div>`,
      onBack: () => this.home(),
      hint: 'Enter välj',
    };
    return this._withUnlocks(c.newCars, scr); // record() har körts en gång ovan
  }

  // --- Starta lopp --------------------------------------------------------------
  startRace(players = 1) {
    const s = this.settings;
    this.stack = [];
    this.hide();
    this.game.raceInfo = { mode: players === 2 ? 'Två spelare' : 'Enkelt lopp' };
    this.game.setup({ mode: 'race', level: this.sel.level, carId: this.sel.carId, carId2: this.sel.carId2, players, opponents: s.opponents, difficulty: s.difficulty, laps: s.laps, weapons: s.weapons });
    this.game.audio?.playMusic?.(this.sel.level);
    this._swallow();
  }

  startTimeTrial() {
    this.stack = [];
    this.hide();
    this.game.setup({ mode: 'timetrial', level: this.sel.level, carId: this.sel.carId, laps: this.settings.laps, weapons: false });
    this.game.audio?.playMusic?.(this.sel.level);
    this._swallow();
  }

  // --- Stuntläge ---
  startStunt() {
    this.stack = [];
    this.hide();
    this.game.setup({ mode: 'stunt', level: 'stuntarena', carId: this.sel.carId, weapons: false });
    this.game.audio?.playMusic?.('stuntarena');
    this._swallow();
  }

  startCup() {
    this.cup = new Championship(this.sel.cup, this.sel.carId);
    this.startCupRound();
  }

  startCupRound() {
    const c = this.cup;
    this.stack = [];
    this.hide();
    this.game.raceInfo = { mode: c.cup.name, stage: `${c.round + 1} / ${c.cup.races.length}` };
    this.game.setup({ mode: 'race', level: c.level, carId: c.carId, opponents: 7, difficulty: c.cup.difficulty, laps: c.cup.laps, weapons: true });
    this.game.audio?.playMusic?.(c.level);
    this._swallow();
  }

  _restart() {
    const g = this.game;
    g.setup({ mode: g.mode, level: g.levelDef.id, carId: g.carId, laps: g.opts.laps, weapons: g.opts.weapons, players: g.opts.players, carId2: g.opts.carId2 });
    this._swallow();
  }

  // --- Banbyggaren (src/editor) ---------------------------------------------------
  openEditor() {
    this.editor ||= new TrackEditor({
      onClose: () => { this.editor.close(); this.home(); },
      onRace: (level, mode) => {
        // Bilval först, sedan loppet på den egna banan
        this.editor.close();
        this.editorRun = { level, mode };
        this.flow = 'editor';
        this.stack = [];
        this.screen = null;
        const scr = this.carScreen(() => this.startEditorRace());
        scr.onBack = () => this.openEditor();
        this.go(scr);
      },
    });
    this.stack = [];
    this.screen = null;
    this.hide();
    this._demoBehind();
    this.game.paused = true; // bara stillbild bakom banbyggaren
    this.editor.open();
  }

  startEditorRace() {
    const s = this.settings, { level, mode } = this.editorRun;
    this.stack = [];
    this.hide();
    if (mode === 'timetrial') this.game.setup({ mode, level, carId: this.sel.carId, laps: s.laps, weapons: false });
    else this.game.setup({ mode: 'race', level, carId: this.sel.carId, opponents: s.opponents, difficulty: s.difficulty, laps: s.laps, weapons: s.weapons });
    this.game.audio?.playMusic?.(level.music);
    this._swallow();
  }

  // Knappen som startade loppet ska inte nå det nya loppet (setup kan ta tid)
  _swallow() { this.game.input.queue.length = 0; this.swallowUntil = performance.now() + 150; }

  _demoBehind() { if (this.game.mode !== 'demo') this.game.setup({ mode: 'demo', level: this._randomLevel() }); }

  _levelName(id) { return this.levels.find((l) => l.id === id)?.name ?? id; }
  _randomLevel() { return this.levels[Math.floor(Math.random() * this.levels.length)].id; }

  // --- Rita -----------------------------------------------------------------------
  render() {
    const s = this.screen;
    if (!s) return;
    const items = s.items;
    let k = -1;
    const rows = items.map((it) => {
      if (!it.disabled) k++;
      const on = !it.disabled && k === this.index;
      const arrows = it.left ? '<span class="arr">◀</span>' : '';
      const arrowsR = it.right ? '<span class="arr">▶</span>' : '';
      return `<li class="${on ? 'on' : ''}${it.disabled ? ' off' : ''}${it.locked ? ' locked' : ''}" data-i="${it.disabled ? -1 : k}">${on ? arrows : ''}${it.label}${on ? arrowsR : ''}</li>`;
    }).join('');
    this.el.innerHTML = `
      <div class="panel">
        <div class="logo">${s.title === 'LOGO' ? LOGO_SVG : s.title}</div>
        ${s.sub ? `<div class="sub">${s.sub}</div>` : ''}
        <ul>${rows}</ul>
      </div>
      ${s.side ? `<div class="side">${s.side()}</div>` : ''}
      <div class="hintbar">${s.hint || ''}</div>`;
    this.el.querySelectorAll('li[data-i]').forEach((li) => {
      const i = +li.dataset.i;
      if (i < 0) return;
      li.onmouseenter = () => { if (this.index !== i) { this.index = i; this.render(); this.screen.onMove?.(this.screen.items.filter((x) => !x.disabled)[i]); } };
      li.onclick = () => { const it = this.screen.items.filter((x) => !x.disabled)[i]; this.ui('select'); it.select?.(); };
    });
  }
}

// --- Kort och tabeller ------------------------------------------------------------
function bar(label, v, cls = '') {
  const pct = Math.round(Math.max(0.06, Math.min(1, v)) * 100);
  return `<div class="stat"><span>${label}</span><div class="bar ${cls}"><i style="width:${pct}%"></i></div></div>`;
}

function carCard(d, fresh = false) {
  const s = carStats(d);
  return `<div class="card${fresh ? ' fresh' : ''}">
    <h3>${fresh ? '🔓 ' : ''}${d.name}</h3>
    <p class="meta">${d.cls} · ${d.engine === 'Glow' ? 'Glow (nitro)' : 'El'} · ${d.drive}${d.assist ? ' · körhjälp' : ''}</p>
    ${d.desc ? `<p class="desc">${d.desc}</p>` : ''}
    ${bar('Fart', s.fart)}
    ${bar('Acceleration', s.acc)}
    ${bar('Grepp', s.grepp)}
    ${bar('Vikt', s.vikt)}
    ${bar('Svårighet', s.svar, 'hard')}
    <p class="meta">${Math.round(d.topSpeed * 3.6)} km/h · 0–topp ${d.accTime.toFixed(1)} s · ${d.mass.toFixed(1)} kg</p>
  </div>`;
}

// Låst bil: vad som krävs för att låsa upp den
function lockedCard(d, hint) {
  if (d.secret) return `<div class="card lockedcard"><h3>🔒 ???</h3><p class="meta">${d.cls} · hemlig bil</p><p class="req">${hint}</p></div>`;
  return `<div class="card lockedcard"><h3>🔒 ${d.name}</h3>
    <p class="meta">${d.cls} · ${d.engine === 'Glow' ? 'Glow (nitro)' : 'El'} · ${d.drive}</p>
    <p class="req">${hint}</p>
    ${d.desc ? `<p class="desc">${d.desc}</p>` : ''}
    <p class="meta">${Math.round(d.topSpeed * 3.6)} km/h · 0–topp ${d.accTime.toFixed(1)} s · ${d.mass.toFixed(1)} kg</p></div>`;
}

function trackCard(l, menu) {
  return `<div class="card"><h3>${l.name}</h3><p>${BLURB[l.id] ?? ''}</p><p class="meta">${menu.settings.laps} varv · ${menu.settings.opponents} motståndare · vapen ${menu.settings.weapons ? 'på' : 'av'}</p></div>`;
}

function table(rows) {
  return `<table>${rows.map(([a, b, c, me]) => `<tr class="${me ? 'me' : ''}"><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('')}</table>`;
}

function resultsTable(racers) {
  const sorted = [...racers].sort((a, b) => a.position - b.position);
  return table(sorted.map((r) => [`${r.position}${ordinal(r.position)}`, r.name, r.finished ? formatTime(r.finishTime) : '--', r.isPlayer]));
}

// Sparade inställningar rensas: okända värden faller tillbaka på standard
function loadSettings() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch { return {}; }
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  const pick = (k, ok) => { if (ok.includes(raw[k])) out[k] = raw[k]; };
  pick('difficulty', DIFF.map((d) => d[0]));
  pick('assist', ASSIST.map((a) => a[0]));
  pick('gfx', ['high', 'low']);
  pick('weapons', [true, false]);
  pick('shake', [true, false]);
  if (Number.isInteger(raw.laps)) out.laps = Math.max(1, Math.min(9, raw.laps));
  if (Number.isInteger(raw.opponents)) out.opponents = Math.max(0, Math.min(7, raw.opponents));
  return out;
}
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* inget sparande */ } }
