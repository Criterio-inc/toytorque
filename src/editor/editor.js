import * as THREE from 'three';
import { TOOLS, THEMES, ENVS, GRID, DX, DZ, RAMP_STEP } from './pieces.js';
import { walkLoop, toLevel } from './convert.js';
import { buildTrackData, buildTrackMesh } from '../track/track.js';
import { EXAMPLES, MAX_SAVED, listSaved, saveTrack, deleteSaved, exportDoc, importDoc, cloneDoc } from './storage.js';

// ---------------------------------------------------------------------------
// Banbyggaren: rutnät att lägga bitar på, kontroll av slingan, liten 3D-vy,
// spara/ladda/exportera och provkörning. Helskärmslager ovanpå spelet.
//
//   Vänsterklick lägg bit · högerklick ta bort (eller rotera på tom ruta)
//   R / mushjul rotera · Delete ta bort · 1–0 välj bit · piltangenter + Enter
//   Ctrl/Cmd+Z ångra (30 steg) · Esc tillbaka till menyn
// ---------------------------------------------------------------------------

const UNDO_MAX = 30;
const key = (i, j) => `${i},${j}`;

export class TrackEditor {
  constructor({ onClose, onRace } = {}) {
    this.onClose = onClose;
    this.onRace = onRace;
    this.cells = new Map();
    this.name = 'Min bana';
    this.theme = 'tra';
    this.env = 'rum';
    this.tool = 'straight';
    this.rot = 0;
    this.cursor = { i: 12, j: 12 };
    this.hover = null;
    this.undoStack = [];
    this.result = { loop: [], errors: [] };
    this.msg = '';
    this.isOpen = false;
    this._built = false;
    this.load(EXAMPLES[0], false);
  }

  // --- Dokument ------------------------------------------------------------------
  toDoc() {
    return { name: this.name, theme: this.theme, env: this.env, cells: [...this.cells.values()].map((c) => (c.k === 'jump' ? [c.i, c.j, c.k, c.r, c.p] : [c.i, c.j, c.k, c.r])) };
  }

  load(doc, undoable = true) {
    if (undoable) this._pushUndo();
    const d = cloneDoc(doc);
    this.name = d.name; this.theme = d.theme; this.env = d.env;
    this.cells = new Map();
    for (const [i, j, k, r, p] of d.cells) this.cells.set(key(i, j), { i, j, k, r, p: p ?? 0 });
    this._changed();
  }

  _pushUndo() {
    this.undoStack.push(JSON.stringify(this.toDoc()));
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) { this.flash('Inget mer att ångra'); return false; }
    this.load(JSON.parse(s), false);
    this._syncForm();
    this.flash('Ångrat');
    return true;
  }

  // --- Redigering ----------------------------------------------------------------
  setTool(id) { if (TOOLS.some((t) => t.id === id)) { this.tool = id; this.render(); } }
  rotate(d = 1) { this.rot = (this.rot + d + 4) % 4; this.render(); }

  _removeAt(i, j) {
    const c = this.cells.get(key(i, j));
    if (!c) return false;
    if (c.k === 'jump') {
      // Hela hoppet försvinner
      const ai = c.i - DX[c.r] * c.p, aj = c.j - DZ[c.r] * c.p;
      for (let p = 0; p < 3; p++) {
        const q = this.cells.get(key(ai + DX[c.r] * p, aj + DZ[c.r] * p));
        if (q && q.k === 'jump' && q.r === c.r && q.p === p) this.cells.delete(key(q.i, q.j));
      }
    } else this.cells.delete(key(i, j));
    return true;
  }

  // Lägg aktuellt verktyg på rutan. Ger false om det inte gick.
  place(i, j, { tool = this.tool, rot = this.rot, undo = true } = {}) {
    const t = TOOLS.find((x) => x.id === tool);
    if (tool === 'erase') return this.remove(i, j, { undo });
    const stamp = t.stamp(rot).map(([di, dj, k, r, p]) => ({ i: i + di, j: j + dj, k, r, p: p ?? 0 }));
    if (stamp.some((c) => c.i < 0 || c.j < 0 || c.i >= GRID || c.j >= GRID)) { this.flash('Biten får inte plats här'); return false; }
    const same = stamp.every((c) => { const q = this.cells.get(key(c.i, c.j)); return q && q.k === c.k && q.r === c.r && q.p === c.p; });
    if (same) return false;
    if (undo) this._pushUndo();
    for (const c of stamp) this._removeAt(c.i, c.j);
    // Bara en startruta: den gamla flyttas
    if (tool === 'start') for (const q of [...this.cells.values()]) if (q.k === 'start') this.cells.delete(key(q.i, q.j));
    for (const c of stamp) this.cells.set(key(c.i, c.j), c);
    this._changed();
    return true;
  }

  remove(i, j, { undo = true } = {}) {
    if (!this.cells.has(key(i, j))) return false;
    if (undo) this._pushUndo();
    this._removeAt(i, j);
    this._changed();
    return true;
  }

  clear() {
    if (!this.cells.size) return;
    this._pushUndo();
    this.cells.clear();
    this._changed();
  }

  _changed() {
    this.result = walkLoop(this.toDoc());
    this.render();
    this._schedulePreview();
  }

  validate() { return this.result.errors; }

  level() {
    if (this.result.errors.length) return null;
    return toLevel(this.toDoc());
  }

  race(mode) {
    if (this.result.errors.length) { this.flash(this.result.errors[0].msg); return false; }
    const level = this.level();
    this.onRace?.(level, mode);
    return true;
  }

  flash(text) {
    this.msg = text;
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => { this.msg = ''; this._renderStatus(); }, 2600);
    this._renderStatus();
  }

  // --- Öppna/stäng -----------------------------------------------------------------
  open() {
    if (!this._built) this._build();
    this.isOpen = true;
    this.el.style.display = 'grid';
    this._syncForm();
    this._resize();
    this._renderSaved();
    this.render();
    this._schedulePreview(0);
    const loop = () => { if (!this.isOpen) return; this._spin(); this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }

  close() {
    this.isOpen = false;
    if (this.el) this.el.style.display = 'none';
    cancelAnimationFrame(this._raf);
  }

  // --- DOM ------------------------------------------------------------------------
  _build() {
    this._built = true;
    injectStyle();
    const el = (this.el = document.createElement('div'));
    el.id = 'editor';
    el.innerHTML = `
      <div class="ed-left">
        <div class="ed-title">Bana<span>byggaren</span></div>
        <div class="ed-tools"></div>
        <div class="ed-rot"></div>
        <div class="ed-help">
          <b>Mus:</b> vänsterklick lägg · högerklick ta bort (rotera på tom ruta) · hjul rotera<br>
          <b>Tangenter:</b> 1–0 bit · R rotera · Delete ta bort · pilar + Enter · Ctrl/⌘+Z ångra · Esc meny<br>
          Banan ska vara en sluten slinga genom startrutan. Ramper höjer/sänker ${RAMP_STEP} m i pilens riktning.
        </div>
      </div>
      <div class="ed-center"><canvas class="ed-grid"></canvas></div>
      <div class="ed-right">
        <div class="ed-3dbox"><canvas class="ed-3d" width="320" height="200"></canvas><div class="ed-3dmsg">Ingen förhandsvisning – rätta felen nedan</div></div>
        <div class="ed-status"></div>
        <label>Namn <input class="ed-name" maxlength="32"></label>
        <div class="ed-row">
          <label>Stil <select class="ed-theme">${Object.entries(THEMES).map(([id, t]) => `<option value="${id}">${t.name}</option>`).join('')}</select></label>
          <label>Miljö <select class="ed-env">${Object.entries(ENVS).map(([id, e]) => `<option value="${id}">${e.name}</option>`).join('')}</select></label>
        </div>
        <div class="ed-row">
          <button data-a="test" class="go">Provkör</button>
          <button data-a="race" class="go">Kör lopp</button>
        </div>
        <div class="ed-row">
          <button data-a="undo">Ångra</button>
          <button data-a="clear">Rensa</button>
          <button data-a="save">Spara</button>
        </div>
        <div class="ed-sub">Sparade banor (högst ${MAX_SAVED})</div>
        <div class="ed-saved"></div>
        <div class="ed-sub">Exempel</div>
        <div class="ed-row">${EXAMPLES.map((e, k) => `<button data-ex="${k}">${e.name}</button>`).join('')}</div>
        <div class="ed-sub">Exportera / importera (JSON)</div>
        <textarea class="ed-json" spellcheck="false" placeholder="Klistra in en bana här och tryck Läs in"></textarea>
        <div class="ed-row">
          <button data-a="export">Exportera</button>
          <button data-a="import">Läs in</button>
        </div>
        <button data-a="close" class="back">◀ Tillbaka till menyn</button>
      </div>`;
    document.body.appendChild(el);
    const $ = (s) => el.querySelector(s);
    this.$ = $;
    this.canvas = $('.ed-grid');
    this.ctx = this.canvas.getContext('2d');

    // Palett med små ritade ikoner
    const tools = $('.ed-tools');
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.className = 'ed-tool';
      b.dataset.tool = t.id;
      b.title = `${t.name} (${t.key})`;
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      b.append(c, Object.assign(document.createElement('span'), { textContent: `${t.key} ${t.name}` }));
      b.onclick = () => this.setTool(t.id);
      tools.appendChild(b);
    }

    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.ex) { this.load(EXAMPLES[+b.dataset.ex]); this._syncForm(); this.flash(`Laddade exemplet ${EXAMPLES[+b.dataset.ex].name}`); return; }
      if (b.dataset.load) { const t = listSaved().find((x) => x.name === b.dataset.load); if (t) { this.load(t.doc); this._syncForm(); this.flash(`Laddade "${t.name}"`); } return; }
      if (b.dataset.del) { deleteSaved(b.dataset.del); this._renderSaved(); this.flash(`Tog bort "${b.dataset.del}"`); return; }
      const a = b.dataset.a;
      if (a === 'test') this.race('timetrial');
      else if (a === 'race') this.race('race');
      else if (a === 'undo') this.undo();
      else if (a === 'clear') { this.clear(); this.flash('Rensat – Ctrl/⌘+Z ångrar'); }
      else if (a === 'save') { const r = saveTrack(this.toDoc()); this.flash(r.msg); this._renderSaved(); }
      else if (a === 'export') this.exportJson();
      else if (a === 'import') this.importJson($('.ed-json').value);
      else if (a === 'close') this.onClose?.();
    });
    $('.ed-name').addEventListener('input', (e) => { this.name = e.target.value; });
    $('.ed-theme').addEventListener('change', (e) => { this._pushUndo(); this.theme = e.target.value; this._changed(); });
    $('.ed-env').addEventListener('change', (e) => { this._pushUndo(); this.env = e.target.value; this._changed(); });

    // Mus på rutnätet
    const cv = this.canvas;
    const cellAt = (e) => {
      const r = cv.getBoundingClientRect();
      const i = Math.floor(((e.clientX - r.left) / r.width) * GRID), j = Math.floor(((e.clientY - r.top) / r.height) * GRID);
      return i >= 0 && j >= 0 && i < GRID && j < GRID ? { i, j } : null;
    };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('mousemove', (e) => {
      const c = cellAt(e);
      const moved = !this.hover || !c || c.i !== this.hover.i || c.j !== this.hover.j;
      this.hover = c;
      if (c) this.cursor = { ...c };
      // Dra för att måla enkelrutsbitar (ett ångrasteg per drag)
      if (moved && c && this._drag && TOOLS.find((t) => t.id === this.tool).stamp(this.rot).length <= 1) this.place(c.i, c.j, { undo: false });
      else if (moved) this.render();
    });
    cv.addEventListener('mouseleave', () => { this.hover = null; this.render(); });
    cv.addEventListener('mousedown', (e) => {
      const c = cellAt(e);
      if (!c) return;
      e.preventDefault();
      if (e.button === 2) { if (!this.remove(c.i, c.j)) this.rotate(1); return; }
      if (e.button !== 0) return;
      this._pushUndo();
      if (!this.place(c.i, c.j, { undo: false })) this.undoStack.pop();
      this._drag = true;
    });
    window.addEventListener('mouseup', () => { this._drag = false; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.rotate(e.deltaY > 0 ? 1 : -1); }, { passive: false });

    window.addEventListener('keydown', (e) => this._key(e), true);
    window.addEventListener('resize', () => this.isOpen && this._resize());
    this._initPreview();
  }

  _key(e) {
    if (!this.isOpen) return;
    const tag = e.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const k = e.code;
    if ((e.ctrlKey || e.metaKey) && k === 'KeyZ') { if (!typing) { this.undo(); e.preventDefault(); } e.stopImmediatePropagation(); return; }
    if (typing) { if (k === 'Escape') e.target.blur(); e.stopImmediatePropagation(); return; }
    const c = this.cursor;
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    const tool = TOOLS.find((t) => t.key === e.key);
    if (move) { c.i = Math.max(0, Math.min(GRID - 1, c.i + move[0])); c.j = Math.max(0, Math.min(GRID - 1, c.j + move[1])); this.hover = { ...c }; this.render(); }
    else if (k === 'KeyR') this.rotate(e.shiftKey ? -1 : 1);
    else if (k === 'Delete' || k === 'Backspace') this.remove(c.i, c.j);
    else if (k === 'Enter' || k === 'Space') this.place(c.i, c.j);
    else if (k === 'Escape') this.onClose?.();
    else if (tool) this.setTool(tool.id);
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Spelet och menyn ska inte se tangenterna medan banbyggaren är öppen
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  exportJson() {
    const s = exportDoc(this.toDoc());
    this.$('.ed-json').value = s;
    try {
      navigator.clipboard.writeText(s).then(() => this.flash('Kopierat till urklipp'), () => this.flash('Exporterat – kopiera texten i rutan'));
    } catch { this.flash('Exporterat – kopiera texten i rutan'); }
    return s;
  }

  importJson(text) {
    try {
      const d = importDoc(text);
      this.load(d);
      this._syncForm();
      this.flash(`Läste in "${d.name}"`);
      return true;
    } catch (err) { this.flash(err.message); return false; }
  }

  _syncForm() {
    if (!this._built) return;
    this.$('.ed-name').value = this.name;
    this.$('.ed-theme').value = this.theme;
    this.$('.ed-env').value = this.env;
  }

  _renderSaved() {
    if (!this._built) return;
    const list = listSaved();
    this.$('.ed-saved').innerHTML = list.length
      ? list.map((t) => `<div class="ed-srow"><button data-load="${esc(t.name)}">${esc(t.name)}</button><button data-del="${esc(t.name)}" title="Ta bort">✕</button></div>`).join('')
      : '<div class="ed-none">Inga sparade banor än</div>';
  }

  _renderStatus() {
    if (!this._built) return;
    const errs = this.result.errors;
    const st = this.$('.ed-status');
    const loop = this.result.loop;
    const head = errs.length
      ? `<div class="bad">${errs.map((e) => `<div>⚠ ${esc(e.msg)}</div>`).join('')}</div>`
      : `<div class="good">✓ Banan är klar att köra · ${loop.length} rutor · ca ${Math.round(loop.length * 4)} m per varv</div>`;
    this.$('.ed-3dbox').classList.toggle('bad', errs.length > 0);
    st.innerHTML = head + (this.msg ? `<div class="msg">${esc(this.msg)}</div>` : '');
    for (const b of this.el.querySelectorAll('button.go')) b.disabled = errs.length > 0;
  }

  _resize() {
    const box = this.$('.ed-center').getBoundingClientRect();
    const px = Math.max(12, Math.floor(Math.min(box.width - 16, box.height - 16) / GRID));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cellPx = px;
    this.canvas.style.width = this.canvas.style.height = `${px * GRID}px`;
    this.canvas.width = this.canvas.height = px * GRID * dpr;
    this.dpr = dpr;
    this.render();
  }

  // --- Rita rutnätet ---------------------------------------------------------------
  render() {
    if (!this._built || !this.isOpen) return;
    const ctx = this.ctx, s = this.cellPx * this.dpr, W = s * GRID;
    const th = THEMES[this.theme];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.env === 'lagret' ? '#5d6166' : th.floor.colorA;
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = 'rgba(8,10,20,.55)';
    ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = 'rgba(255,255,255,.13)';
    ctx.lineWidth = 1;
    for (let k = 0; k <= GRID; k++) {
      ctx.beginPath(); ctx.moveTo(k * s + 0.5, 0); ctx.lineTo(k * s + 0.5, W); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k * s + 0.5); ctx.lineTo(W, k * s + 0.5); ctx.stroke();
    }

    const levelOf = new Map(this.result.loop.map((c) => [key(c.i, c.j), c]));
    for (const c of this.cells.values()) drawPiece(ctx, c, c.i * s, c.j * s, s, th.draw, 1);

    // Färdriktning och höjd längs slingan
    const ok = !this.result.errors.length;
    for (const [n, c] of this.result.loop.entries()) {
      const lc = levelOf.get(key(c.i, c.j));
      const h = Math.max(lc.l0, lc.l1);
      if (h > 0 && c.k !== 'rampUp' && c.k !== 'rampDown') {
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.font = `bold ${Math.round(s * 0.24)}px system-ui, sans-serif`;
        ctx.fillText(`${(h * RAMP_STEP).toFixed(1)}`, c.i * s + s * 0.06, c.j * s + s * 0.26);
      }
      if (ok && n % 2 === 1 && c.k !== 'jump') drawArrow(ctx, c.i * s + s / 2, c.j * s + s / 2, c.exit, s * 0.16, '#ffd23f');
    }

    // Problemrutor
    const t = performance.now() / 1000;
    for (const e of this.result.errors) for (const [i, j] of e.cells) {
      ctx.strokeStyle = `rgba(255,60,50,${0.75 + 0.25 * Math.sin(t * 6)})`;
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.strokeRect(i * s + 2, j * s + 2, s - 4, s - 4);
      ctx.fillStyle = 'rgba(255,40,30,.22)';
      ctx.fillRect(i * s, j * s, s, s);
    }

    // Spökbit under muspekaren/markören
    const h = this.hover || this.cursor;
    if (h) {
      const tool = TOOLS.find((x) => x.id === this.tool);
      const stamp = tool.stamp(this.rot);
      if (!stamp.length) {
        ctx.fillStyle = 'rgba(255,80,60,.35)';
        ctx.fillRect(h.i * s, h.j * s, s, s);
      }
      for (const [di, dj, k, r, p] of stamp) {
        const i = h.i + di, j = h.j + dj;
        const out = i < 0 || j < 0 || i >= GRID || j >= GRID;
        ctx.fillStyle = out ? 'rgba(255,60,50,.35)' : 'rgba(82,228,255,.22)';
        ctx.fillRect(i * s, j * s, s, s);
        drawPiece(ctx, { k, r, p: p ?? 0 }, i * s, j * s, s, th.draw, 0.8);
      }
      ctx.strokeStyle = '#52e4ff';
      ctx.lineWidth = Math.max(2, s * 0.05);
      ctx.strokeRect(h.i * s + 1, h.j * s + 1, s - 2, s - 2);
    }

    // Paletten och rotationen
    for (const b of this.el.querySelectorAll('.ed-tool')) {
      b.classList.toggle('on', b.dataset.tool === this.tool);
      const c = b.querySelector('canvas'), g = c.getContext('2d');
      g.clearRect(0, 0, 64, 64);
      const st = TOOLS.find((x) => x.id === b.dataset.tool).stamp(this.rot);
      if (!st.length) { g.font = 'bold 34px system-ui'; g.fillStyle = '#ff6b5b'; g.fillText('✕', 18, 44); continue; }
      const mi = Math.min(...st.map((q) => q[0])), mj = Math.min(...st.map((q) => q[1]));
      const span = Math.max(...st.map((q) => Math.max(q[0] - mi, q[1] - mj))) + 1;
      const cs = 64 / span;
      for (const [di, dj, k, r, p] of st) drawPiece(g, { k, r, p: p ?? 0 }, (di - mi) * cs, (dj - mj) * cs, cs, th.draw, 1);
    }
    this.$('.ed-rot').textContent = `Rotation: ${['↑ norr', '→ öster', '↓ söder', '← väster'][this.rot]}  (R)`;
    this._renderStatus();
  }

  // --- 3D-förhandsvisning --------------------------------------------------------------
  _initPreview() {
    const canvas = this.$('.ed-3d');
    try {
      this.r3 = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch { this.r3 = null; return; }
    this.r3.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.r3.setSize(320, 200, false);
    this.r3.outputColorSpace = THREE.SRGBColorSpace;
    this.s3 = new THREE.Scene();
    this.c3 = new THREE.PerspectiveCamera(40, 320 / 200, 0.5, 400);
    this.s3.add(new THREE.HemisphereLight(0xffffff, 0x555048, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(20, 40, 12);
    this.s3.add(sun);
    this.g3 = null;
    this.spinA = 0.7;
  }

  _schedulePreview(ms = 250) {
    if (!this._built || !this.r3) return;
    clearTimeout(this._prevT);
    this._prevT = setTimeout(() => this._rebuildPreview(), ms);
  }

  _rebuildPreview() {
    if (!this.r3) return;
    if (this.g3) {
      this.s3.remove(this.g3);
      this.g3.traverse((o) => { o.geometry?.dispose(); for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.dispose(); } });
      this.g3 = null;
    }
    const th = THEMES[this.theme];
    this.s3.background = new THREE.Color(this.result.errors.length ? 0x2a1a1c : 0x1a2233);
    if (!this.result.errors.length) {
      const level = toLevel(this.toDoc());
      const data = buildTrackData(level.track);
      const g = new THREE.Group();
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(level.floor.size, level.floor.size),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(this.env === 'lagret' ? 0x8e9092 : th.floor.colorA).multiplyScalar(0.45), roughness: 0.9 }));
      floor.rotation.x = -Math.PI / 2;
      g.add(floor);
      buildTrackMesh(g, data, level.trackTheme);
      this.s3.add(g);
      this.g3 = g;
      this.view = level.floor.size;
    }
    this._spin(0);
  }

  _spin(da = 0.004) {
    if (!this.r3) return;
    this.spinA += da;
    const R = (this.view || 60) * 0.5;
    this.c3.position.set(Math.cos(this.spinA) * R, R * 0.75, Math.sin(this.spinA) * R);
    this.c3.lookAt(0, 0, 0);
    this.r3.render(this.s3, this.c3);
    if (this.result.errors.length && da) return;
  }
}

// --- Bitarnas ritning (uppifrån, norr uppåt) -------------------------------------------
export function drawPiece(ctx, c, x, y, s, col, alpha = 1) {
  const w = s * 0.7, h = s / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x + h, y + h);
  ctx.rotate((c.r * Math.PI) / 2);
  const road = (fill = col.road) => {
    ctx.fillStyle = fill;
    ctx.fillRect(-w / 2, -h, w, s);
    ctx.fillStyle = col.edge;
    ctx.fillRect(-w / 2, -h, s * 0.05, s);
    ctx.fillRect(w / 2 - s * 0.05, -h, s * 0.05, s);
  };
  const grad = (from, to) => {
    const g = ctx.createLinearGradient(0, h, 0, -h);
    g.addColorStop(0, from); g.addColorStop(1, to);
    return g;
  };
  if (c.k === 'curve') {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = col.edge;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.arc(h, -h, h, Math.PI / 2, Math.PI); ctx.stroke();
    ctx.strokeStyle = col.road;
    ctx.lineWidth = w - s * 0.1;
    ctx.beginPath(); ctx.arc(h, -h, h, Math.PI / 2, Math.PI); ctx.stroke();
  } else if (c.k === 'straight') {
    road();
  } else if (c.k === 'start') {
    road();
    const n = 6, q = w / n;
    for (let k = 0; k < n; k++) for (let m = 0; m < 2; m++) {
      ctx.fillStyle = (k + m) % 2 ? '#111' : '#f4f4f4';
      ctx.fillRect(-w / 2 + k * q, -q + m * q, q, q);
    }
    drawArrow(ctx, 0, -h * 0.55, 0, s * 0.14, '#ffd23f', true);
  } else if (c.k === 'rampUp' || c.k === 'rampDown') {
    road(c.k === 'rampUp' ? grad('rgba(0,0,0,.35)', 'rgba(255,255,255,.55)') : grad('rgba(255,255,255,.55)', 'rgba(0,0,0,.35)'));
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = col.road; ctx.fillRect(-w / 2, -h, w, s);
    ctx.globalCompositeOperation = 'source-over';
    // Pilen pekar i rampens färdriktning; ▲ uppför, ▼ nedför
    drawArrow(ctx, 0, 0, 0, s * 0.2, c.k === 'rampUp' ? '#7dff8a' : '#ff9a6b', true);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(s * 0.2)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(c.k === 'rampUp' ? 'UPP' : 'NED', 0, h * 0.75);
  } else if (c.k === 'bridge') {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(-w / 2 + s * 0.08, -h, w, s); // skugga
    road();
    ctx.fillStyle = '#d9dde3';
    ctx.fillRect(-w / 2 - s * 0.06, -h, s * 0.08, s);
    ctx.fillRect(w / 2 - s * 0.02, -h, s * 0.08, s);
  } else if (c.k === 'jump') {
    // Del 0 ansats (stiger), del 1 krön + glapp, del 2 landning
    if (c.p === 0) {
      road(grad(col.road, '#e7c76a'));
    } else if (c.p === 1) {
      road();
      ctx.fillStyle = '#e7c76a';
      ctx.fillRect(-w / 2, -h + s * 0.5, w, s * 0.5); // sista biten av ansatsen
      ctx.fillStyle = '#0b0b0e';
      ctx.fillRect(-w / 2 - 1, -s * 0.225, w + 2, s * 0.225); // glappet (0,9 m)
    } else {
      road(grad('#d9b55a', col.road));
    }
    if (c.p === 1) drawArrow(ctx, 0, -h * 0.75, 0, s * 0.12, '#ffd23f', true);
  }
  ctx.restore();
}

// Liten triangel i riktningen d (0 norr). local=true: redan roterat.
function drawArrow(ctx, x, y, d, size, color, local = false) {
  ctx.save();
  ctx.translate(x, y);
  if (!local) ctx.rotate((d * Math.PI) / 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,.6)';
  ctx.lineWidth = Math.max(1, size * 0.15);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.85, size * 0.6);
  ctx.lineTo(-size * 0.85, size * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function injectStyle() {
  if (document.getElementById('editor-style')) return;
  const st = document.createElement('style');
  st.id = 'editor-style';
  st.textContent = `
    #editor { position: fixed; inset: 0; z-index: 30; display: none; grid-template-columns: 200px 1fr 340px; gap: 12px; padding: 12px;
      background: radial-gradient(circle at 50% 30%, #1b2140, #0b0d18 75%); color: #f3f3f0;
      font-family: "Trebuchet MS", system-ui, sans-serif; font-size: 13px; }
    #editor button { font: inherit; font-weight: 700; color: #f3f3f0; background: #232a52; border: 2px solid #3946c8; border-radius: 7px; padding: 5px 9px; cursor: pointer; }
    #editor button:hover { background: #2f3a75; }
    #editor button:disabled { opacity: .4; cursor: not-allowed; }
    #editor button.go { background: #1d6b34; border-color: #3fd46a; font-size: 15px; flex: 1; }
    #editor button.back { margin-top: auto; }
    #editor .ed-left, #editor .ed-right { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 0; }
    #editor .ed-title { font-size: 26px; font-style: italic; font-weight: 800; color: #ffd23f; text-shadow: 2px 2px 0 #7a0d08; }
    #editor .ed-title span { color: #52e4ff; text-shadow: 2px 2px 0 #1a4fb0; }
    #editor .ed-tools { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    #editor .ed-tool { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px; font-size: 11px; }
    #editor .ed-tool canvas { width: 44px; height: 44px; }
    #editor .ed-tool.on { border-color: #52e4ff; background: #134a6a; box-shadow: 0 0 8px #52e4ff88; }
    #editor .ed-rot { color: #9fdcff; font-weight: 700; }
    #editor .ed-help { color: #b8c2dc; line-height: 1.45; font-size: 12px; }
    #editor .ed-center { display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 0; }
    #editor .ed-grid { border: 3px solid #3946c8; border-radius: 6px; cursor: crosshair; box-shadow: 0 0 24px rgba(0,0,0,.6); }
    #editor .ed-3d { width: 320px; height: 200px; border-radius: 8px; border: 2px solid #3946c8; }
    #editor .ed-3dbox { position: relative; }
    #editor .ed-3dmsg { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; text-align: center; padding: 20px; color: #ff8a7a; font-weight: 700; }
    #editor .ed-3dbox.bad .ed-3dmsg { display: flex; }
    #editor .ed-status { min-height: 40px; }
    #editor .ed-status .bad { color: #ff8a7a; font-weight: 700; }
    #editor .ed-status .good { color: #6dff8f; font-weight: 700; }
    #editor .ed-status .msg { color: #ffd23f; margin-top: 4px; }
    #editor label { display: flex; flex-direction: column; gap: 2px; color: #9fdcff; font-weight: 700; }
    #editor .ed-row > label { flex: 1; min-width: 0; }
    #editor input, #editor select, #editor textarea { font: inherit; color: #f3f3f0; background: #10142a; border: 2px solid #3946c8; border-radius: 6px; padding: 4px 6px; }
    #editor textarea { height: 54px; resize: vertical; font-family: ui-monospace, monospace; font-size: 11px; }
    #editor .ed-row { display: flex; gap: 6px; }
    #editor .ed-row > button { flex: 1; }
    #editor .ed-sub { color: #ffd23f; font-weight: 700; margin-top: 4px; }
    #editor .ed-srow { display: flex; gap: 4px; margin-bottom: 4px; }
    #editor .ed-srow button:first-child { flex: 1; text-align: left; }
    #editor .ed-none { color: #7d86a3; }
  `;
  document.head.appendChild(st);
}
