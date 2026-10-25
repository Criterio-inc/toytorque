// ---------------------------------------------------------------------------
// Framsteg och upplåsning: man börjar med Rookie-bilarna
// (och en Amateur) och låser upp resten genom att vinna cuper, vinna
// enskilda mästerskapslopp ("snabbspår") och slå utmaningstider i
// tidskörning. Allt sparas i localStorage under 'revolt.progress':
//   { unlocked: [cupId], won: [cupId], unlockedCars: [carId],
//     ttBeaten: { levelId: true }, devAll: bool }
// Trasig eller gammal data rättas till vid inläsning.
// ---------------------------------------------------------------------------

import { CARS, CAR_ORDER, CLASSES } from '../vehicle/carDefs.js';
import { loadStuntProgress } from '../stunt/stunt.js';

const KEY = 'revolt.progress';
const CUP_IDS = ['brons', 'silver', 'guld', 'platina'];
const CUP_NAMES = { brons: 'Bronscupen', silver: 'Silvercupen', guld: 'Guldcupen', platina: 'Platinacupen' };

// Bilar man har från början (Nallen är nybörjarbilen)
export const START_CARS = ['rasket', 'nallen', 'bjassen', 'kanelbullen', 'smulan', 'virveln'];

// Bilar som en cupseger låser upp
export const CUP_REWARDS = {
  brons: ['giraffen', 'grusgrisen', 'spurten', 'glidaren', 'tjuren'],
  silver: ['flugan', 'lerkakan', 'pilen', 'draken'],
  guld: ['vinden', 'bulldoggen', 'raketen', 'kungen'],
  platina: ['kometen', 'rymdskeppet'],
};

// Utmaningstider i tidskörning (bästa varv, sekunder): Raskets varv med
// datorföraren gånger 1,05, avrundat uppåt till halv sekund.
export const CHALLENGE = {
  kitchen: 25.5, lagret: 21.0, spokstaden: 23.0, kryssaren: 22.5, tradgarden: 23.5,
  leksaksaffaren: 24.5, museet: 24.5, kvarteret: 28.5, supermarket: 26.0,
};

// Bonusbilar för slagna utmaningar (de kan också vinnas i sin cup)
export const TT_REWARDS = { lagret: 'lerkakan', spokstaden: 'vinden' };

// Hemliga bilen kan även låsas upp med alla stjärnor i Stuntarenan
export const STUNT_REWARD = 'rymdskeppet';

const fresh = () => ({ unlocked: ['brons'], won: [], unlockedCars: [], ttBeaten: {}, devAll: false });
const ids = (a, ok) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && ok(x)))] : []);

export function loadProgress() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch { /* trasig data: börja om */ }
  const p = fresh();
  if (!raw || typeof raw !== 'object') return p;
  p.won = ids(raw.won, (x) => CUP_IDS.includes(x));
  p.unlocked = ids(raw.unlocked, (x) => CUP_IDS.includes(x));
  if (!p.unlocked.includes('brons')) p.unlocked.unshift('brons');
  p.unlockedCars = ids(raw.unlockedCars, (x) => !!CARS[x]);
  if (raw.ttBeaten && typeof raw.ttBeaten === 'object' && !Array.isArray(raw.ttBeaten)) {
    for (const [k, v] of Object.entries(raw.ttBeaten)) if (v === true && CHALLENGE[k]) p.ttBeaten[k] = true;
  }
  p.devAll = raw.devAll === true;
  // Gamla sparfiler: cuper som redan är vunna ger sina bilar
  for (const c of p.won) {
    const next = CUP_IDS[CUP_IDS.indexOf(c) + 1];
    if (next && !p.unlocked.includes(next)) p.unlocked.push(next);
  }
  for (const c of p.won) for (const id of CUP_REWARDS[c]) if (!p.unlockedCars.includes(id)) p.unlockedCars.push(id);
  return p;
}

// Sparar framstegen. Är lagringen full rensas spökbilar och vi försöker igen.
// Ger true om det gick.
export function saveProgress(p) { return storeSafely(KEY, JSON.stringify(p)); }

// --- Lagringsutrymme ------------------------------------------------------------
// Spökbilarna (revolt.ghost.<bana>.<bil>) är det enda som växer. De hålls i en
// LRU-lista med högst MAX_GHOSTS st, och rensas först när något viktigare
// (framsteg, sparade banor) inte får plats. WebKit ger runt 5 MB.
const GHOST_PREFIX = 'revolt.ghost.';
const GHOST_INDEX = 'revolt.ghostIndex';
export const MAX_GHOSTS = 20;

function ghostIndex() {
  let idx = [];
  try { const a = JSON.parse(localStorage.getItem(GHOST_INDEX)); if (Array.isArray(a)) idx = a.filter((k) => typeof k === 'string' && k.startsWith(GHOST_PREFIX) && localStorage.getItem(k) != null); } catch { /* börja om */ }
  // Spökbilar från före listan räknas som äldst
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(GHOST_PREFIX) && !idx.includes(k)) idx.unshift(k);
    }
  } catch { /* ingen lagring */ }
  return idx;
}
function writeIndex(idx) { try { localStorage.setItem(GHOST_INDEX, JSON.stringify(idx)); } catch { /* fullt */ } }

// Markera en spökbil som nyss använd (sist i listan = nyast)
export function touchGhost(key) {
  const idx = ghostIndex().filter((k) => k !== key);
  idx.push(key);
  while (idx.length > MAX_GHOSTS) { try { localStorage.removeItem(idx.shift()); } catch { /* ingen lagring */ } }
  writeIndex(idx);
}

// Ta bort de n äldsta spökbilarna (utom keep). Ger antalet borttagna.
export function evictGhosts(n = Infinity, keep = null) {
  const idx = ghostIndex();
  let removed = 0;
  for (let i = 0; i < idx.length && removed < n;) {
    if (idx[i] === keep) { i++; continue; }
    try { localStorage.removeItem(idx[i]); } catch { /* ingen lagring */ }
    idx.splice(i, 1);
    removed++;
  }
  writeIndex(idx);
  return removed;
}

// localStorage.setItem som rensar spökbilar och försöker igen om det är fullt.
// Misslyckas det ändå skickas händelsen 'revolt:savefailed' (menyn visar en rad).
export function storeSafely(key, value, { ghost = false } = {}) {
  const tryIt = () => { try { localStorage.setItem(key, value); return true; } catch { return false; } };
  if (tryIt()) return true;
  // Först hälften av de äldsta spökena, sedan alla (utom det som sparas)
  if (evictGhosts(Math.ceil(ghostIndex().length / 2), key) && tryIt()) return true;
  if (evictGhosts(Infinity, key) && tryIt()) return true;
  if (!ghost) { try { window.dispatchEvent(new Event('revolt:savefailed')); } catch { /* ej webbläsare */ } }
  return false;
}

export function isCarUnlocked(id, p = loadProgress()) {
  if (!CARS[id]) return false;
  if (p.devAll || START_CARS.includes(id) || p.unlockedCars.includes(id)) return true;
  if (id === STUNT_REWARD && loadStuntProgress().allStars) return true;
  return false;
}

export function isCupOpen(id, p = loadProgress()) { return p.devAll || p.unlocked.includes(id); }

// Lås upp en bil; returnerar true om den var låst innan
export function unlockCar(id) {
  const p = loadProgress();
  if (!CARS[id] || isCarUnlocked(id, { ...p, devAll: false })) return false;
  p.unlockedCars.push(id);
  saveProgress(p);
  return true;
}
const unlockMany = (list) => list.filter((id) => unlockCar(id));

// Cupseger: cupens bilar. Returnerar nya bil-id.
export function applyCupWin(cupId) { return unlockMany(CUP_REWARDS[cupId] || []); }

// Förstaplats i ett mästerskapslopp: en låst bil i klassen över bilens egen
// (aldrig den hemliga). Returnerar nya bil-id (0 eller 1 st).
export function applyRaceWin(carCls) {
  const next = CLASSES[CLASSES.indexOf(carCls) + 1];
  if (!next) return [];
  const id = CAR_ORDER.find((c) => CARS[c].cls === next && c !== STUNT_REWARD && !isCarUnlocked(c, { ...loadProgress(), devAll: false }));
  return id ? unlockMany([id]) : [];
}

// Tidskörning klar: { challenge, beaten, first, cars }
export function applyTimeTrial(levelId, bestLap) {
  const challenge = CHALLENGE[levelId] ?? null;
  const beaten = challenge != null && bestLap != null && bestLap <= challenge;
  let first = false;
  let cars = [];
  if (beaten) {
    const p = loadProgress();
    first = !p.ttBeaten[levelId];
    if (first) { p.ttBeaten[levelId] = true; saveProgress(p); }
    if (TT_REWARDS[levelId]) cars = unlockMany([TT_REWARDS[levelId]]);
  }
  return { challenge, beaten, first, cars };
}

// Text som talar om hur en låst bil låses upp
export function unlockHint(id, levelName = (l) => l) {
  const parts = [];
  const cup = CUP_IDS.find((c) => CUP_REWARDS[c].includes(id));
  const tt = Object.entries(TT_REWARDS).find(([, c]) => c === id)?.[0];
  if (tt) parts.push(`slå tiden ${fmt(CHALLENGE[tt])} på ${levelName(tt)} i tidskörning`);
  if (cup) parts.push(`vinn ${CUP_NAMES[cup]}`);
  if (id === STUNT_REWARD) parts.push('ta alla 20 stjärnor i Stuntarenan');
  const t = parts.join(' eller ');
  return t ? t[0].toUpperCase() + t.slice(1) : 'Låst';
}

export function progressSummary() {
  const p = loadProgress();
  const cars = CAR_ORDER.filter((id) => isCarUnlocked(id, p));
  return {
    cupsWon: p.won.length, cupsTotal: CUP_IDS.length, won: p.won,
    carsUnlocked: cars.length, carsTotal: CAR_ORDER.length, cars,
    ttBeaten: Object.keys(p.ttBeaten).length, ttTotal: Object.keys(CHALLENGE).length, ttLevels: Object.keys(p.ttBeaten),
    devAll: p.devAll,
  };
}

export function setDevAll(on) { const p = loadProgress(); p.devAll = !!on; saveProgress(p); }
export function resetProgress() { saveProgress(fresh()); }

// 21.0 → "00:21:000" (samma format som HUD:en)
export function fmt(t) {
  const ms = Math.round(t * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}:${String(ms % 1000).padStart(3, '0')}`;
}
