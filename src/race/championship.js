// ---------------------------------------------------------------------------
// Mästerskap: åtta bilar, poäng 10-6-4-3-2-1-0-0, man måste
// bli topp tre i varje lopp för att gå vidare och har tre försök totalt.
// Vinner man cupen låses nästa upp. Framsteg sparas i webbläsaren.
// ---------------------------------------------------------------------------

import { CARS } from '../vehicle/carDefs.js';
import { loadProgress, saveProgress, applyCupWin, applyRaceWin } from './progress.js';

export const POINTS = [10, 6, 4, 3, 2, 1, 0, 0];
export const QUALIFY = 3;
export const TRIES = 3;

export const CUPS = [
  { id: 'brons', name: 'Bronscupen', difficulty: 'easy', laps: 3, races: ['lagret', 'kvarteret', 'kitchen', 'tradgarden'] },
  { id: 'silver', name: 'Silvercupen', difficulty: 'normal', laps: 3, races: ['spokstaden', 'supermarket', 'kryssaren', 'leksaksaffaren'] },
  { id: 'guld', name: 'Guldcupen', difficulty: 'hard', laps: 4, races: ['museet', 'kvarteret', 'kryssaren', 'spokstaden', 'tradgarden'] },
  { id: 'platina', name: 'Platinacupen', difficulty: 'hard', laps: 5, races: ['supermarket', 'museet', 'leksaksaffaren', 'lagret', 'kryssaren', 'spokstaden'] },
];

// Sparningen (och bilupplåsningen) bor i progress.js
export { loadProgress };

export class Championship {
  constructor(cup, carId) {
    this.cup = cup;
    this.carId = carId;
    this.round = 0;
    this.tries = TRIES;
    this.points = new Map(); // namn → poäng
    this.lastResult = null;
    this.over = false;
    this.failed = false;
    this.newCars = []; // bilar som det senaste record() låste upp
  }

  get level() { return this.cup.races[this.round]; }
  get roundLabel() { return `Lopp ${this.round + 1} av ${this.cup.races.length}`; }

  // Efter målgång: racers med position. Returnerar 'next' | 'retry' | 'failed' | 'done'
  record(racers) {
    const player = racers.find((r) => r.isPlayer);
    this.newCars = [];
    const sorted = [...racers].sort((a, b) => a.position - b.position);
    this.lastResult = sorted.map((r) => ({ name: r.name, position: r.position, points: POINTS[r.position - 1] ?? 0, isPlayer: r.isPlayer }));
    if (player.position > QUALIFY) {
      this.tries--;
      if (this.tries <= 0) { this.over = true; this.failed = true; return 'failed'; }
      return 'retry'; // loppet körs om, poängen räknas inte
    }
    // Snabbspår: vinst i ett lopp låser upp en bil i klassen över
    if (player.position === 1) this.newCars.push(...applyRaceWin(CARS[this.carId]?.cls));
    for (const r of this.lastResult) this.points.set(r.name, (this.points.get(r.name) || 0) + r.points);
    this.round++;
    if (this.round >= this.cup.races.length) {
      this.over = true;
      if (this.standings()[0].isPlayer) this._win();
      return 'done';
    }
    return 'next';
  }

  standings() {
    return [...this.points.entries()]
      .map(([name, points]) => ({ name, points, isPlayer: name === 'Du' }))
      .sort((a, b) => b.points - a.points || (a.isPlayer ? -1 : 1));
  }

  get won() { return this.over && !this.failed && this.standings()[0]?.isPlayer; }

  _win() {
    // Bilarna först: när cupen väl är markerad som vunnen räknas dess bilar som upplåsta
    this.newCars.push(...applyCupWin(this.cup.id));
    const p = loadProgress();
    if (!p.won.includes(this.cup.id)) p.won.push(this.cup.id);
    const i = CUPS.indexOf(this.cup);
    const next = CUPS[i + 1];
    if (next && !p.unlocked.includes(next.id)) p.unlocked.push(next.id);
    saveProgress(p);
  }
}
