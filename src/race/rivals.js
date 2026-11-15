// ---------------------------------------------------------------------------
// Rivaler: åtta namngivna förare som möts en i taget i duell, var och en på
// sin hemmabana. Slår man en rival öppnas nästa. Rivalen kör en bil ur samma
// klass som spelarens, så duellen avgörs av körningen och inte av bilvalet.
// Tre av rivalerna lämnar ifrån sig en bil när de förlorar.
//
// Framstegen sparas i webbläsaren under 'revolt.rivals': { beaten: [id] }.
// Ren spelregel utan grafik, så att den kan köras i node-testerna.
// ---------------------------------------------------------------------------

import { carsInClass } from '../vehicle/carDefs.js';
import { storeSafely, unlockCar } from './progress.js';

const KEY = 'revolt.rivals';

// evening: duellen körs i skymning (banan måste ha en kvällsvariant).
// skill och topMul stiger genom kampanjen. Den första rivalen är klart långsammare än
// cupernas lättaste förare, den sista ungefär som en förare på Normal. reward: bil som låses upp vid seger.
export const RIVALS = [
  { id: 'kork', name: 'Kapten Kork', level: 'lagret', laps: 2, skill: 0.68, topMul: 0.91, colors: { body: 0xb5651d, trim: 0x2b2b2b, accent: 0xf5e6c8 },
    line: 'Jag kan varenda pall i det här lagret. Du hinner inte ens se mig.' },
  { id: 'fjader', name: 'Fröken Fjäder', level: 'kitchen', laps: 2, skill: 0.71, topMul: 0.92, colors: { body: 0xf2f2f2, trim: 0xe84a8a, accent: 0xe84a8a },
    line: 'Lätt på foten, lätt i kurvorna. Försök hänga med över spisen.' },
  { id: 'rut', name: 'Rostiga Rut', level: 'tradgarden', laps: 3, skill: 0.74, topMul: 0.93, colors: { body: 0x8a4b2a, trim: 0x3f7d3a, accent: 0xd9c7a0 }, reward: 'giraffen',
    line: 'Rost är bara erfarenhet som syns. Vi ses på stenbron.' },
  { id: 'kloss', name: 'Bromsklossen', level: 'kvarteret', laps: 3, skill: 0.77, topMul: 0.94, evening: true, colors: { body: 0x2f3b52, trim: 0xffc533, accent: 0xffc533 },
    line: 'Jag bromsar sent och ber aldrig om ursäkt. Kvällsrunda i kvarteret?' },
  { id: 'tage', name: 'Turbo-Tage', level: 'spokstaden', laps: 3, skill: 0.8, topMul: 0.95, colors: { body: 0xd42a2a, trim: 0x111111, accent: 0xffffff },
    line: 'Jag sparar aldrig på turbon. Dammet du ser är mitt.' },
  { id: 'dimman', name: 'Dimman', level: 'kryssaren', laps: 3, skill: 0.83, topMul: 0.96, evening: true, colors: { body: 0x7f8c99, trim: 0x1c2733, accent: 0x9fe8ff }, reward: 'pilen',
    line: 'Ingen ser mig komma. I skymningen på däck ser du mig inte gå heller.' },
  { id: 'pedal', name: 'Professor Pedal', level: 'supermarket', laps: 3, skill: 0.86, topMul: 0.97, colors: { body: 0x2a7d6f, trim: 0xf0e8d0, accent: 0xff7a3c },
    line: 'Idealspåret är en fråga om geometri. Jag har räknat på det.' },
  { id: 'mastaren', name: 'Mästaren', level: 'skejtparken', laps: 4, skill: 0.9, topMul: 0.98, evening: true, colors: { body: 0x111318, trim: 0xd4af37, accent: 0xd4af37 }, reward: 'kungen',
    line: 'Alla andra har du slagit. Nu kör vi tills lyktorna tänds.' },
];

export function loadRivals() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch { /* trasig data: börja om */ }
  const ok = new Set(RIVALS.map((r) => r.id));
  const beaten = Array.isArray(raw?.beaten) ? [...new Set(raw.beaten.filter((x) => typeof x === 'string' && ok.has(x)))] : [];
  return { beaten };
}

// En rival går att utmana när den föregående är slagen (den första är alltid öppen)
export function isRivalOpen(i, st = loadRivals()) {
  return i === 0 || st.beaten.includes(RIVALS[i - 1].id);
}

// Efter duellen: spelarens placering. Returnerar { won, first, next, cars, all }.
// first = första segern mot just den rivalen, cars = nyupplåsta bilar.
export function recordDuel(rivalId, position) {
  const i = RIVALS.findIndex((r) => r.id === rivalId);
  const st = loadRivals();
  const won = position === 1 && i >= 0;
  const first = won && !st.beaten.includes(rivalId);
  const cars = [];
  if (first) {
    st.beaten.push(rivalId);
    storeSafely(KEY, JSON.stringify(st));
    const reward = RIVALS[i].reward;
    if (reward && unlockCar(reward)) cars.push(reward);
  }
  return { won, first, next: won ? RIVALS[i + 1] || null : null, cars, all: st.beaten.length === RIVALS.length };
}

// Rivalens plats i startfältet: en bil ur spelarens klass (helst en annan modell) i rivalens färger
export function rivalEntry(rival, playerDef) {
  const others = carsInClass(playerDef.cls).filter((c) => c.id !== playerDef.id);
  const base = others[RIVALS.indexOf(rival) % Math.max(1, others.length)] || playerDef;
  return {
    name: rival.name,
    def: { ...base, id: `${base.id}-rival`, name: rival.name, colors: { ...rival.colors } },
    skill: rival.skill, lane: 0, topMul: rival.topMul,
  };
}
