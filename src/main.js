import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './core/game.js';
import { kitchen } from './level/kitchen.js';
import { lagret } from './level/lagret.js';
import { spokstaden } from './level/spokstaden.js';
import { kryssaren } from './level/kryssaren.js';
import { tradgarden } from './level/tradgarden.js';
import { leksaksaffaren } from './level/leksaksaffaren.js';
import { museet } from './level/museet.js';
import { kvarteret } from './level/kvarteret.js';
import { supermarket } from './level/supermarket.js';
import { stuntarena } from './level/stuntarena.js';
import { CARS } from './vehicle/carDefs.js';
import { Menu } from './ui/menu.js';
import { attachAudio } from './audio/audio.js';

// ---------------------------------------------------------------------------
// ToyTorque: start. Spelet öppnar startmenyn. För snabbtest kan ett lopp startas
// direkt med ?level=<nivåns id> (och ?car=, ?ai=0..7, ?diff=easy|normal|hard).
// ?level=stuntarena startar stuntläget direkt.
// ---------------------------------------------------------------------------

await RAPIER.init();

const LEVELS = [lagret, kitchen, spokstaden, kryssaren, tradgarden, leksaksaffaren, museet, kvarteret, supermarket];
const params = new URLSearchParams(location.search);
const carId = CARS[params.get('car')] ? params.get('car') : 'rasket';
const level = LEVELS.find((l) => l.id === params.get('level')) || LEVELS[0];
const opponents = params.has('ai') ? Math.max(0, Math.min(7, +params.get('ai') || 0)) : 7;

const game = new Game(RAPIER, { container: document.getElementById('app'), levels: LEVELS, extraLevels: [stuntarena], level, carId, opponents, difficulty: params.get('diff') || 'normal' });
attachAudio(game); // procedurellt ljud, startar vid första tangent/klick
document.getElementById('loading').remove();
game.run();

const menu = new Menu(game);
game.menu = menu;
if (params.get('level') === 'stuntarena') { menu.flow = 'stunt'; game.setup({ mode: 'stunt', level: 'stuntarena', carId }); }
else if (params.has('level')) menu.flow = null; // direkt in i ett lopp
else menu.home();

// Felsökningskrokar, bara i utvecklingsläge
if (import.meta.env.DEV) {
  const { attachDebug } = await import('./debug/dbg.js');
  attachDebug(game);
}
