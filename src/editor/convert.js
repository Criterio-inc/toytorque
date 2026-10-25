import { CELL, GRID, DX, DZ, KINDS, RAMP_STEP, MAX_LEVEL, ROAD_HALF, THEMES, openings } from './pieces.js';
import { buildTrackData } from '../track/track.js';
import { makeConcreteFloor, makeHallWalls, addBoxStack, addPallet, addLooseBox, PALLET } from '../level/warehouseArt.js';

// ---------------------------------------------------------------------------
// Rutnät → bana. Gå slingan från startrutan, kontrollera den och gör en
// banspec (hörn i kurvrutornas mitt, höjdnycklar, glapp) och en hel nivå.
//
// Dokumentet (det som sparas): { name, theme, env, cells: [[i, j, k, r, del?], ...] }
// ---------------------------------------------------------------------------

const key = (i, j) => `${i},${j}`;

export function cellMap(doc) {
  const m = new Map();
  for (const [i, j, k, r, p] of doc.cells) m.set(key(i, j), { i, j, k, r, p: p ?? 0 });
  return m;
}

// Hoppets mått längs färdriktningen (m från ansatsrutans bakkant).
// Rak ansats ända ut i kanten, kort glapp (0,9 m) och lite lägre landning än
// Lagret, så att även långsamma datorbilar i klungan klarar hoppet.
export const JUMP = { lipStart: 0.5, lip: 6.0, land: 6.9, end: 12, yStart: 0.06, yLip: 0.46, yLand: 0.26 };

// Går slingan och ger { loop, errors }. Varje fel: { msg, cells: [[i, j]] }.
export function walkLoop(doc) {
  const m = cellMap(doc);
  const errors = [];
  const err = (msg, cells = []) => errors.push({ msg, cells });
  const all = [...m.values()];
  const starts = all.filter((c) => c.k === 'start');
  if (!all.length) { err('Banan är tom – lägg ut bitar'); return { loop: [], errors }; }
  if (!starts.length) { err('Saknar startruta'); return { loop: [], errors }; }
  if (starts.length > 1) { err('Bara en startruta får finnas', starts.map((c) => [c.i, c.j])); return { loop: [], errors }; }

  const start = starts[0];
  const loop = [];
  const seen = new Set();
  let cur = start, enter = (start.r + 2) % 4, closed = false;
  for (let n = 0; n <= GRID * GRID; n++) {
    const op = openings(cur);
    const exit = op[0] === enter ? op[1] : op[0];
    loop.push({ ...cur, enter, exit });
    seen.add(key(cur.i, cur.j));
    const ni = cur.i + DX[exit], nj = cur.j + DZ[exit];
    const next = m.get(key(ni, nj));
    const back = (exit + 2) % 4;
    if (!next || !openings(next).includes(back)) {
      const cells = [[cur.i, cur.j]];
      if (ni >= 0 && nj >= 0 && ni < GRID && nj < GRID) cells.push([ni, nj]);
      err('Banan är inte sluten', cells);
      break;
    }
    if (next === start) {
      if (back !== (start.r + 2) % 4) err('Banan kommer in i startrutan bakvägen', [[start.i, start.j]]);
      closed = true;
      break;
    }
    if (seen.has(key(ni, nj))) { err('Banan korsar sig själv', [[ni, nj]]); break; }
    cur = next;
    enter = back;
  }
  if (!closed) return { loop, errors };

  const loose = all.filter((c) => !seen.has(key(c.i, c.j)));
  if (loose.length) err('Bitar som inte hör till slingan', loose.map((c) => [c.i, c.j]));
  if (loop.length < 8) err('Banan är för kort (minst 8 rutor)', loop.map((c) => [c.i, c.j]));

  // Höjder: ramper höjer/sänker ett steg i sin färdriktning
  let level = 0;
  for (const c of loop) {
    c.l0 = level;
    if (c.k === 'rampUp' || c.k === 'rampDown') {
      const along = c.exit === c.r ? 1 : -1;
      level += (c.k === 'rampUp' ? 1 : -1) * along;
      if (level < 0) err('Rampen går ner under golvet – vänd den (R)', [[c.i, c.j]]);
      if (level > MAX_LEVEL) err(`För högt – högst ${MAX_LEVEL} ramper upp`, [[c.i, c.j]]);
    }
    c.l1 = level;
    if (c.k === 'bridge' && c.l0 <= 0) err('Bron måste ligga högre än golvet – lägg en ramp upp före', [[c.i, c.j]]);
  }
  if (level !== 0) err('Banan måste vara tillbaka på golvnivå vid start', [[start.i, start.j]]);

  // Hopp: tre rutor i rad, framåt, på golvnivå, med rak ansats och utfart
  const L = loop.length;
  const flat = (c) => (c.k === 'straight' || c.k === 'start') && c.l0 === 0;
  for (let idx = 0; idx < L; idx++) {
    const c = loop[idx];
    if (c.k !== 'jump' || c.p !== 0) continue;
    const parts = [0, 1, 2].map((k) => loop[(idx + k) % L]);
    const cells = parts.map((q) => [q.i, q.j]);
    if (!parts.every((q, k) => q.k === 'jump' && q.p === k && q.exit === c.r)) { err('Hoppet är vänt åt fel håll', cells); continue; }
    if (c.l0 !== 0) { err('Hoppet måste ligga på golvnivå', cells); continue; }
    const before = [1, 2, 3].map((k) => loop[(idx - k + L) % L]);
    if (!before.every(flat)) err('Hoppet behöver en rak ansats (3 raka rutor före)', [...cells, ...before.filter((q) => !flat(q)).map((q) => [q.i, q.j])]);
    const after = [3, 4].map((k) => loop[(idx + k) % L]);
    if (!after.every(flat)) err('Hoppet behöver en rak utfart (2 raka rutor efter)', [...cells, ...after.filter((q) => !flat(q)).map((q) => [q.i, q.j])]);
  }
  return { loop, errors };
}

export function validate(doc) {
  return walkLoop(doc).errors;
}

// Slingans utbredning i rutor och mittpunkt (banan centreras kring origo)
function bounds(loop) {
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const c of loop) { i0 = Math.min(i0, c.i); i1 = Math.max(i1, c.i); j0 = Math.min(j0, c.j); j1 = Math.max(j1, c.j); }
  return { i0, i1, j0, j1, ci: (i0 + i1) / 2, cj: (j0 + j1) / 2 };
}

// Banspec för buildTrackData. Kastar fel om rutnätet inte är en giltig slinga.
export function toTrackSpec(doc) {
  const { loop, errors } = walkLoop(doc);
  if (errors.length) throw new Error(errors[0].msg);
  const b = bounds(loop);
  const centre = (c) => [(c.i - b.ci) * CELL, (c.j - b.cj) * CELL];
  const edge = (c, d) => { const [x, z] = centre(c); return [x + DX[d] * CELL / 2, z + DZ[d] * CELL / 2]; };
  const r3 = (v) => Math.round(v * 1000) / 1000;

  const corners = loop.filter((c) => c.k === 'curve').map((c) => { const [x, z] = centre(c); return { x, z, r: 0.45 * CELL }; });

  const elevation = [];
  const gaps = [];
  let anyHeight = false;
  for (const c of loop) {
    if (c.k === 'jump') {
      if (c.p !== 0) continue;
      anyHeight = true;
      const [ex, ez] = edge(c, (c.r + 2) % 4); // ansatsrutans bakkant
      const at = (u) => [r3(ex + DX[c.r] * u), r3(ez + DZ[c.r] * u)];
      elevation.push(
        { at: at(JUMP.lipStart), y: JUMP.yStart },
        { at: at(JUMP.lip), y: JUMP.yLip, linear: true },
        { at: at(JUMP.land), y: JUMP.yLand, linear: true },
        { at: at(JUMP.end), y: 0, linear: true },
      );
      gaps.push({ from: at(JUMP.lip), to: at(JUMP.land) });
      continue;
    }
    const ramp = c.k === 'rampUp' || c.k === 'rampDown';
    if (ramp || c.l1 > 0) anyHeight = true;
    elevation.push({ at: edge(c, c.exit).map(r3), y: r3(c.l1 * RAMP_STEP), linear: ramp });
  }

  const s = loop[0];
  const [sx, sz] = centre(s);
  return {
    scale: 1,
    roadHalf: ROAD_HALF,
    spacing: 0.6,
    checkpoints: Math.max(10, Math.min(20, Math.round(loop.length / 2))),
    barrierHeight: 0.18,
    barrierThick: 0.1,
    start: { x: sx, z: sz },
    corners,
    elevation: anyHeight ? elevation : [],
    gaps,
    // För nivåbygget: rutornas mittpunkter i meter
    _cells: loop.map((c) => centre(c)),
    _size: { w: (b.i1 - b.i0 + 1) * CELL, h: (b.j1 - b.j0 + 1) * CELL },
  };
}

const hash = (str) => { let h = 2166136261; for (let k = 0; k < str.length; k++) h = Math.imul(h ^ str.charCodeAt(k), 16777619); return (h >>> 0).toString(36); };
const slug = (s) => String(s || 'bana').toLowerCase().replace(/[^a-z0-9åäö]+/g, '-').replace(/^-|-$/g, '') || 'bana';

// Hel nivå (samma form som de vanliga nivåerna) av ett banbyggardokument
export function toLevel(doc) {
  const spec = toTrackSpec(doc);
  const theme = THEMES[doc.theme] || THEMES.asfalt;
  const cells = spec._cells, size = spec._size;
  delete spec._cells; delete spec._size;
  const floorSize = Math.max(40, Math.ceil(Math.max(size.w, size.h) + 18));
  const half = floorSize / 2;
  const nearTrack = (x, z, d) => cells.some(([cx, cz]) => Math.abs(cx - x) < CELL / 2 + d && Math.abs(cz - z) < CELL / 2 + d);

  // Lösa koner vid sidan av vägen, bara på plana rutor långt från hopp
  const data = buildTrackData(spec);
  const props = [];
  const colors = [0xff5252, 0xffd740, 0x40c4ff, 0x69f0ae];
  data.checkpoints.forEach((cp, k) => {
    if (k % 3 !== 1 || props.length >= 6) return;
    const i = cp.index, N = data.N;
    for (let d = -30; d <= 30; d++) if (data.pts[(i + d + N) % N].y > 0.01 || data.isGap[(i + d + N) % N]) return;
    props.push({ kind: 'cone', cp: k, lateral: (k % 2 ? -1 : 1) * (ROAD_HALF + 0.45), color: colors[props.length % 4] });
  });

  const warehouse = doc.env === 'lagret';
  const level = {
    id: `bygg-${slug(doc.name)}-${hash(JSON.stringify(doc.cells))}`, // spöket hör till just den här layouten
    name: doc.name || 'Egen bana',
    music: warehouse ? 'lagret' : 'kitchen',
    custom: true,
    laps: 3,
    sky: warehouse ? 0x9fa6ad : theme.sky,
    fog: { near: floorSize * 0.45, far: floorSize * 1.25 },
    floor: { size: floorSize, ...theme.floor },
    walls: { height: 7, color: theme.walls },
    trackTheme: theme.track,
    track: spec,
    statics: [],
    props,
  };

  if (!warehouse) {
    // Några möbler i rummets hörn, där banan inte går
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = sx * (half - 2.6), z = sz * (half - 2.6);
      if (nearTrack(x, z, 3)) continue;
      level.statics.push({ size: [3.6, 2.4 + ((sx + sz + 2) % 3) * 1.6, 3.6], at: [x, 0, z], color: 0xcdbb9a });
    }
    for (const s of level.statics) s.at[1] = s.size[1] / 2;
  } else {
    level.environment = ({ scene, world, RAPIER }) => {
      const H = 9;
      makeConcreteFloor(scene, world, RAPIER, { size: floorSize });
      makeHallWalls(scene, world, RAPIER, { size: floorSize, height: H });
      let seed = 1;
      const loose = [];
      const edge = half - 2.2;
      // Kartongstaplar och pallar längs väggarna
      for (let t = -edge + 3; t <= edge - 3; t += 9) {
        for (const [x, z, rot] of [[t, -edge, 0], [t, edge, 0], [-edge, t, Math.PI / 2], [edge, t, Math.PI / 2]]) {
          if (nearTrack(x, z, 2.5)) continue;
          if ((seed % 3) === 0) {
            addPallet(scene, world, RAPIER, { x, z, rotY: rot });
            addBoxStack(scene, world, RAPIER, { x, z, y: PALLET.h, rotY: rot, cols: 1, rows: 1, layers: 2, seed: seed++ });
          } else {
            addBoxStack(scene, world, RAPIER, { x, z, rotY: rot, cols: 2, rows: 2, layers: 1 + (seed % 3), seed: seed++ });
          }
        }
      }
      for (const [x, z] of [[edge - 4, 0], [0, edge - 4], [-(edge - 4), 0]]) {
        if (!nearTrack(x, z, 1.5)) loose.push(addLooseBox(scene, world, RAPIER, { x, z, size: 0.22, seed: seed++ }));
      }
      return loose.filter((p) => p && p.body);
    };
  }
  return level;
}

// Snabb kontroll för importerad data
export function isDoc(d) {
  return d && typeof d === 'object' && Array.isArray(d.cells) && d.cells.every((c) =>
    Array.isArray(c) && Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[0] >= 0 && c[1] >= 0 && c[0] < GRID && c[1] < GRID && KINDS[c[2]] && Number.isInteger(c[3]));
}
