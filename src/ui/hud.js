// ---------------------------------------------------------------------------
// HUD: varv och vapenruta uppe till vänster, tider uppe
// till höger, placering och bilpanel nere till vänster, varvlampor och km/h
// nere till höger. Skriver bara till DOM när något ändrats.
// ---------------------------------------------------------------------------

import { drawWeaponIcon } from '../weapons/icons.js';
import { WEAPONS } from '../weapons/defs.js';

const $ = (id) => document.getElementById(id);
const WEAPON_IDS = Object.keys(WEAPONS);
const LIGHTS = ['#e8321f', '#f05a1c', '#f7a21b', '#f2d21a', '#b9e01f', '#55d42a', '#2fc93a'];

export function formatTime(sec) {
  if (sec == null) return null;
  const ms = Math.floor(sec * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(r).padStart(3, '0')}`;
}
// Svenska ordningstal: 1:a, 2:a, 3:e, 4:e … 11:e, 12:e, 21:a, 22:a
export const ordinal = (n) => ((n % 10 === 1 || n % 10 === 2) && n % 100 !== 11 && n % 100 !== 12 ? ':a' : ':e');

export class Hud {
  constructor() {
    this.el = {
      lap: $('lap'), tLast: $('tLast'), tBest: $('tBest'), tLap: $('tLap'), tRace: $('tRace'),
      posNum: $('posNum'), posSuf: $('posSuf'), mph: $('mph'), countdown: $('countdown'),
      message: $('message'), finish: $('finish'), finishPos: $('finishPos'), finishTime: $('finishTime'),
      finishBest: $('finishBest'), carName: $('carName'), carClass: $('carClass'), help: $('help'),
      gapA: $('gapA'), gapB: $('gapB'), stuntStars: $('stuntStars'), stuntTime: $('stuntTime'),
    };
    this.cache = {};
    this.msgTimer = 0;

    // Varvlamporna i en båge som stiger åt höger, större ju längre ut
    const speedo = $('speedo');
    this.dots = LIGHTS.map((color, i) => {
      const d = document.createElement('div');
      const t = i / (LIGHTS.length - 1);
      const size = 2.0 + t * 2.0; // vh
      const x = 2 + t * 24; // vh från vänster
      const y = 1.5 + Math.pow(t, 0.75) * 7.5; // vh från botten
      Object.assign(d.style, { width: `${size}vh`, height: `${size}vh`, left: `${x}vh`, bottom: `${y}vh`, background: color });
      d.className = 'dot off';
      speedo.appendChild(d);
      return d;
    });
    this.helpTimer = 7;

    // Vapenrutan: en canvas för ikonen och ett fält för antal skott
    const slot = $('weapon');
    this.wCanvas = document.createElement('canvas');
    this.wCanvas.width = this.wCanvas.height = 128;
    this.wCanvas.className = 'icon';
    this.wCount = document.createElement('div');
    this.wCount.className = 'count';
    slot.append(this.wCanvas, this.wCount);
    this.wCtx = this.wCanvas.getContext('2d');
    this.rouletteT = 0;
  }

  _weapon(dt, racer) {
    let id = null, count = '', key;
    if (racer.roulette > 0) {
      // Rouletten snurrar och saktar in
      this.rouletteT += dt * (4 + racer.roulette * 6);
      id = WEAPON_IDS[Math.floor(this.rouletteT) % WEAPON_IDS.length];
      key = 'r' + id;
    } else if (racer.bomb > 0) {
      id = 'bomb';
      count = String(Math.ceil(racer.bomb));
      key = 'b' + count;
    } else if (racer.weapon) {
      id = racer.weapon.id;
      count = racer.weapon.shots > 1 ? `×${racer.weapon.shots}` : '';
      key = 'w' + id + count;
    } else key = 'none';
    this.set('weapon', key, () => {
      if (id) drawWeaponIcon(this.wCtx, id, 128); else this.wCtx.clearRect(0, 0, 128, 128);
      this.wCount.textContent = count;
      $('weapon').classList.toggle('armed', !!id && racer.roulette <= 0);
    });
  }

  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  text(key, value) { this.set(key, value, (v) => { this.el[key].textContent = v; }); }

  message(text, { warn = false, time = 1.6 } = {}) {
    this.el.message.textContent = text;
    this.el.message.classList.toggle('warn', warn);
    this.el.message.classList.add('show');
    this.msgTimer = time;
  }

  // Resultatlista: de som gått i mål med tid, övriga med placering just nu
  _results(racers) {
    const list = document.getElementById('results');
    if (!list) return;
    const sorted = [...racers].sort((a, b) => a.position - b.position);
    list.innerHTML = sorted.map((r) => {
      const t = r.finished ? formatTime(r.finishTime) : '--:--:---';
      return `<div class="res${r.isPlayer ? ' me' : ''}"><span>${r.position}${ordinal(r.position)}</span><span>${r.name}</span><span class="num">${t}</span></div>`;
    }).join('');
    this._resultsAt = performance.now();
    this._racers = racers;
  }

  // Infokort under introsvepet: spelläge, etapp, bana, längd, varv
  showInfo(info, time) {
    const el = document.getElementById('raceinfo');
    if (!el) return;
    const row = (k, v) => (v == null || v === '' ? '' : `<div><span class="k">${k}:</span> <span class="v">${v}</span></div>`);
    el.innerHTML = row('Spelläge', info.mode) + row('Etapp', info.stage) + row('Bana', info.track) + row('Längd', info.length) + row('Varv', info.laps);
    el.classList.add('show');
    this.cache.intro = undefined; // så att kortet döljs om introt hoppas över
    clearTimeout(this._infoT);
    this._infoT = setTimeout(() => el.classList.remove('show'), Math.max(1, time - 0.4) * 1000);
  }

  // Stuntläget: stjärnor och tid (minuter:sekunder)
  stunt({ count, total, time }) {
    this.text('stuntStars', `★ ${count}/${total}`);
    const s = Math.floor(time);
    this.text('stuntTime', `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
  }

  setVisible(v) { document.getElementById('hud').style.display = v ? '' : 'none'; }

  showHelp(t) { this.helpTimer = t; this.cache.help = undefined; }

  toggleHelp() { this.helpTimer = this.el.help.classList.contains('hidden') ? 1e9 : 0; }

  update(dt, { race, racer, vehicle, racers }) {
    const laps = race.laps;
    this.text('lap', `${Math.min(racer.lap, laps)}/${laps}`);
    this.text('tLast', formatTime(racer.lastLap) ?? '00:00:000');
    this.text('tBest', formatTime(racer.bestLap) ?? '05:00:000');
    this.text('tLap', formatTime(racer.started ? racer.lapTime : 0));
    this.text('tRace', formatTime(race.time));
    this.text('posNum', String(racer.position));
    this.text('posSuf', ordinal(racer.position));
    // Avstånd och namn på bilen före och efter
    const others = racers || [];
    const ahead = others.find((r) => r.position === racer.position - 1);
    const behind = others.find((r) => r.position === racer.position + 1);
    const gap = (a, b) => Math.max(0, Math.round(a.progress - b.progress));
    const solo = others.length < 2;
    this.text('gapA', ahead ? `-${ahead.finished ? 0 : gap(ahead, racer)}m` : solo ? '' : '-0m');
    this.text('carName', ahead ? ahead.name : solo ? vehicle.def.name : '');
    this.text('gapB', behind ? (racer.finished ? '' : `+${gap(racer, behind)}m`) : solo ? '' : '+0m');
    this.text('carClass', behind ? behind.name : solo ? vehicle.def.cls : '');

    this.set('intro', race.state === 'intro', (v) => {
      document.getElementById('hud').classList.toggle('intro', v);
      if (!v) document.getElementById('raceinfo')?.classList.remove('show'); // introt hoppades över
    });
    this._weapon(dt, racer);
    const mph = vehicle.mph;
    this.text('mph', String(Math.round(Math.abs(vehicle.speed) * 3.6))); // km/h
    const lit = Math.round((mph / (vehicle.def.topSpeed / 0.44704)) * this.dots.length);
    this.set('lit', lit, (n) => this.dots.forEach((d, i) => d.classList.toggle('off', i >= n)));

    // Nedräkning
    const cd = ''; // nedräkningen visas som 3D-siffror i världen (startFx)
    this.set('countdown', cd, (v) => {
      this.el.countdown.style.display = v === '' ? 'none' : 'flex';
      this.el.countdown.textContent = v;
    });

    // Mål
    const done = race.state === 'finished';
    this.set('finished', done, (v) => {
      this.el.finish.style.display = v ? 'flex' : 'none';
      if (v) {
        this.el.finishPos.textContent = `${racer.position}${ordinal(racer.position)}`;
        this.el.finishTime.textContent = formatTime(racer.finishTime);
        this.el.finishBest.textContent = formatTime(racer.bestLap);
        this._results(racers || [racer]);
      }
    });

    if (done && racers && performance.now() - (this._resultsAt || 0) > 500) this._results(racers);

    // Fel håll har företräde framför andra meddelanden
    if (racer.wrongWay && !done) this.message('WRONG WAY!', { warn: true, time: 0.3 });
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.el.message.classList.remove('show');
    }
    if (race.state === 'finished') this.helpTimer = 0;
    if (this.helpTimer > 0) {
      this.helpTimer -= dt;
      this.set('help', this.helpTimer > 0, (v) => this.el.help.classList.toggle('hidden', !v));
    } else this.set('help', false, () => this.el.help.classList.add('hidden'));
  }
}
