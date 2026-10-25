import { DX, DZ, curveRot } from './pieces.js';
import { isDoc } from './convert.js';
import { storeSafely } from '../race/progress.js';

// ---------------------------------------------------------------------------
// Sparade banor (högst 8 i localStorage), export/import som JSON och två
// inbyggda exempelbanor.
// ---------------------------------------------------------------------------

export const STORE_KEY = 'revolt.tracks';
export const MAX_SAVED = 8;

export function listSaved() {
  try {
    const arr = JSON.parse(localStorage.getItem(STORE_KEY));
    return Array.isArray(arr) ? arr.filter((t) => t && isDoc(t.doc)) : [];
  } catch { return []; }
}

// Sparar under dokumentets namn (samma namn skrivs över). Ger { ok, msg }.
export function saveTrack(doc) {
  const name = (doc.name || '').trim();
  if (!name) return { ok: false, msg: 'Ge banan ett namn först' };
  const list = listSaved();
  const i = list.findIndex((t) => t.name === name);
  if (i < 0 && list.length >= MAX_SAVED) return { ok: false, msg: `Högst ${MAX_SAVED} sparade banor – ta bort en först` };
  const entry = { name, savedAt: Date.now(), doc: cloneDoc({ ...doc, name }) };
  if (i >= 0) list[i] = entry; else list.push(entry);
  if (!storeSafely(STORE_KEY, JSON.stringify(list))) return { ok: false, msg: 'Kunde inte spara (lagringen är full eller avstängd)' };
  return { ok: true, msg: `Sparade "${name}"` };
}

export function deleteSaved(name) {
  const list = listSaved().filter((t) => t.name !== name);
  storeSafely(STORE_KEY, JSON.stringify(list));
}

export function exportDoc(doc) {
  return JSON.stringify({ revoltTrack: 1, ...cloneDoc(doc) });
}

// Ger dokumentet eller kastar ett fel med svensk text
export function importDoc(text) {
  let d;
  try { d = JSON.parse(String(text).trim()); } catch { throw new Error('Det där är inte giltig JSON'); }
  if (!isDoc(d)) throw new Error('JSON-texten är ingen bana från banbyggaren');
  return cloneDoc({ name: String(d.name || 'Importerad bana').slice(0, 32), theme: d.theme, env: d.env, cells: d.cells });
}

export function cloneDoc(d) {
  return {
    name: d.name ?? '',
    theme: ['tra', 'matta', 'asfalt'].includes(d.theme) ? d.theme : 'asfalt',
    env: ['rum', 'lagret'].includes(d.env) ? d.env : 'rum',
    cells: d.cells.map((c) => c.slice()),
  };
}

// Sköldpaddsritning: från en ruta i en riktning, en bokstav per ruta.
//   S start, F rak, U ramp upp, D ramp ned, B bro, J hopp (3 rutor), L/R kurva
export function fromPath(i, j, dir, path) {
  const cells = [];
  for (const t of path.replace(/\s+/g, '')) {
    if (t === 'J') {
      for (let p = 0; p < 3; p++) { cells.push([i, j, 'jump', dir, p]); i += DX[dir]; j += DZ[dir]; }
      continue;
    }
    if (t === 'L' || t === 'R') {
      const nd = (dir + (t === 'R' ? 1 : 3)) % 4;
      cells.push([i, j, 'curve', curveRot((dir + 2) % 4, nd)]);
      dir = nd;
    } else {
      const k = { S: 'start', F: 'straight', U: 'rampUp', D: 'rampDown', B: 'bridge' }[t];
      cells.push([i, j, k, k === 'straight' || k === 'bridge' ? dir % 2 : dir]);
    }
    i += DX[dir]; j += DZ[dir];
  }
  return cells;
}

export const EXAMPLES = [
  {
    name: 'Plankrundan', theme: 'tra', env: 'rum',
    // Uppför vänsterrakan med hoppet, S-kurva på högersidan, runt tillbaka
    cells: fromPath(4, 14, 0, 'S FFF J FF R FFFFFF R FFF RL FFFFF R FFFFF R'),
  },
  {
    name: 'Lagerslingan', theme: 'asfalt', env: 'lagret',
    // Bro på vänsterrakan, hårnål längst till höger, lång raka ner
    cells: fromPath(3, 16, 0, 'S FF UU BB DD F R FFFFFFFFFF R FFFF RR FF L FFF L FFFFFFFF R FFFFF R'),
  },
];
