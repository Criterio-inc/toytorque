// ---------------------------------------------------------------------------
// Race: nedräkning, varv, tider och placering för valfritt antal förare.
//
// Checkpoints är plan tvärs banan och måste passeras i ordning; man passerar
// när bilen går från baksidan till framsidan inom vägens bredd. Placering
// räknas ur sträcka längs mittlinjen (varv × banlängd + position på varvet).
// ---------------------------------------------------------------------------

export class Race {
  constructor(track, { laps = 3, countdown = 3, intro = 0, events = null } = {}) {
    this.events = events || { emit() {} };
    this.introLen = intro;
    this.track = track;
    this.laps = laps;
    this.countdownLen = countdown;
    this.racers = [];
    this.reset();
  }

  addRacer(vehicle, { name, isPlayer = false } = {}) {
    const r = { vehicle, name: name || vehicle.def.name, isPlayer, bestLap: null };
    this._resetRacer(r);
    this.racers.push(r);
    return r;
  }

  reset() {
    // 'intro' (kamerasvep) → 'countdown' → 'racing' → 'finished' (spelaren i mål)
    this.state = this.introLen > 0 ? 'intro' : 'countdown';
    this.intro = this.introLen;
    this.countdown = this.countdownLen;
    this._lastCount = null;
    this.time = 0;
    this.finishOrder = [];
    for (const r of this.racers) this._resetRacer(r);
  }

  _resetRacer(r) {
    r.started = false; // har passerat mållinjen första gången
    r.lap = 1;
    r.nextCp = 0;
    r.prevS = null;
    r.lapTime = 0;
    r.lastLap = null;
    r.finished = false;
    r.finishTime = null;
    r.trackIndex = -1;
    r.lastValidIndex = -1;
    r.progress = 0;
    r.wrongWayTime = 0;
    r.wrongWay = false;
    r.position = 1;
    r.stuckTime = 0;
    r.bestProgress = -Infinity;
  }

  get running() { return this.state === 'racing' || this.state === 'finished'; }
  get canDrive() { return this.running; }

  skipIntro() { if (this.state === 'intro') { this.intro = 0; this.state = 'countdown'; } }

  update(dt) {
    if (this.state === 'intro') {
      this.intro -= dt;
      if (this.intro <= 0) { this.intro = 0; this.state = 'countdown'; }
    } else if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this._lastCount && n > 0) { this._lastCount = n; this.events.emit('countdown', { n }); }
      if (this.countdown <= 0) { this.countdown = 0; this.state = 'racing'; this.events.emit('go'); }
    } else {
      this.time += dt;
    }
    const T = this.track;
    for (const r of this.racers) {
      const p = r.vehicle.position;
      let near = T.nearest(p.x, p.z, r.trackIndex, 40, p.y);
      // Långt från huvudbanan (genväg, avåkning): sök hela banan
      if (near.d2 > (T.roadHalf + 1.5) ** 2) near = T.nearest(p.x, p.z, -1, 40, p.y);
      r.trackIndex = near.index;
      const roadY = T.surfaceY ? T.surfaceY(near.index, Math.max(-T.roadHalf, Math.min(T.roadHalf, near.lateral))) : T.pts[near.index].y;
      const onRoad = Math.abs(near.lateral) < T.roadHalf && p.y > roadY - 0.1 && p.y < roadY + 0.5;
      if (onRoad && r.vehicle.grounded >= 2 && !T.isGap[near.index]) r.lastValidIndex = near.index;
      // Nere i ett hoppglapp (under vägen): räknas som att ha ramlat av
      let pit = false;
      if (roadY > 0.12 && p.y < roadY - 0.15 && Math.abs(near.lateral) < T.roadHalf + 0.3) {
        for (let k = -8; k <= 8 && !pit; k++) pit = T.isGap[(near.index + k + T.N) % T.N];
      }
      r.fell = pit;

      // Fel håll: kör mot banans riktning en stund
      const lv = r.vehicle.body.linvel();
      const t = T.tangents[near.index];
      const along = lv.x * t.x + lv.z * t.z;
      const offMain = Math.abs(near.lateral) > T.roadHalf + 1; // på en genväg räknas inte fel håll
      r.wrongWayTime = along < -1 && !offMain ? r.wrongWayTime + dt : Math.max(0, r.wrongWayTime - dt * 2);
      r.wrongWay = r.wrongWayTime > 1;

      if (this.running && !r.finished) {
        r.lapTime += dt;
        this._checkCrossing(r, p);
      }
      r.progress = r.finished ? 1e9 - r.finishTime : this._progress(r, near.index);

      // Ingen framfart på länge: datorförare sätts tillbaka automatiskt,
      // spelaren får trycka R själv.
      if (this.running && !r.finished) {
        if (r.progress > r.bestProgress + 0.5) { r.bestProgress = r.progress; r.stuckTime = 0; }
        // Utanför huvudbanan i fart (en lång eller långsam genväg) står
        // sträckan still fast bilen kör: räkna då bara långsamt
        else r.stuckTime += offMain && Math.abs(r.vehicle.speed) > 2 ? dt * 0.25 : dt;
      }
    }

    // Placering
    const sorted = [...this.racers].sort((a, b) => b.progress - a.progress);
    sorted.forEach((r, i) => { r.position = i + 1; });
  }

  // Sträcka längs banan, mätt mot nästa checkpoint så att den inte hoppar
  // ett helt varv strax före mållinjen.
  _progress(r, index) {
    const T = this.track;
    const L = T.length;
    const cp = T.checkpoints[r.nextCp];
    const laps = r.started ? r.lap - 1 : -1;
    const target = laps * L + (r.nextCp === 0 ? L : T.dist[cp.index]);
    let d = T.dist[index] - T.dist[cp.index];
    d = ((d + L / 2) % L + L) % L - L / 2;
    return target + d;
  }

  _checkCrossing(r, p) {
    const cp = this.track.checkpoints[r.nextCp];
    const dx = p.x - cp.x, dz = p.z - cp.z;
    const s = dx * cp.tangent.x + dz * cp.tangent.z;
    const lat = dx * cp.normal.x + dz * cp.normal.z;
    const crossed = r.prevS !== null && r.prevS < 0 && s >= 0 && Math.abs(lat) <= cp.halfWidth && Math.abs(p.y - cp.y) < 1.2;
    r.prevS = s;
    if (!crossed) return;

    const N = this.track.checkpoints.length;
    if (r.nextCp === 0) {
      if (!r.started) {
        r.started = true;
        r.lapTime = 0;
      } else {
        r.lastLap = r.lapTime;
        if (r.bestLap == null || r.lapTime < r.bestLap) r.bestLap = r.lapTime;
        r.lapTime = 0;
        r.lap += 1;
        if (r.lap > this.laps) {
          r.finished = true;
          r.lap = this.laps;
          r.finishTime = this.time;
          this.finishOrder.push(r);
          if (r.isPlayer && this.racers.every((o) => !o.isPlayer || o.finished)) this.state = 'finished';
          this.events.emit('finish', { racer: r, position: this.finishOrder.length });
        } else {
          this.events.emit('lap', { racer: r, lap: r.lap });
          if (r.lap === this.laps) this.events.emit('finalLap', { racer: r });
        }
      }
    }
    r.nextCp = (r.nextCp + 1) % N;
    // Ny checkpoint: börja mäta från aktuell sida.
    const ncp = this.track.checkpoints[r.nextCp];
    r.prevS = (p.x - ncp.x) * ncp.tangent.x + (p.z - ncp.z) * ncp.tangent.z;
  }

  // Var en förare ska sättas tillbaka.
  respawnPose(r) {
    // Nere i ett hoppglapp: sätt bilen på landningen efter glappet. Annars kan
    // en långsam bil som startar om före hoppet ramla ner i samma glapp igen.
    if (r.fell) {
      const T = this.track;
      let i = r.trackIndex, k = 0;
      while (k < 12 && !T.isGap[(i + T.N) % T.N]) { i--; k++; } // glappet bakom eller under bilen
      if (T.isGap[(i + T.N) % T.N]) {
        while (T.isGap[(i + T.N) % T.N]) i++;
        return T.poseAt(i + 3, 0);
      }
    }
    // Några punkter bakåt så att bilen aldrig hamnar precis på ett checkpoint-plan.
    const idx = r.lastValidIndex >= 0 ? this.track.safeIndex(r.lastValidIndex - 3) : 0;
    return this.track.poseAt(idx, 0);
  }

  // Tillbaka på vägen där bilen är nu: mitt på banan, i färdriktningen.
  // Långt från banan (eller okänt läge) används senaste giltiga punkt.
  roadPoseNear(r) {
    const T = this.track;
    const p = r.vehicle.position;
    let idx = r.trackIndex;
    if (idx < 0) idx = T.nearest(p.x, p.z, -1, 40, p.y).index;
    const q = T.pts[idx];
    const far = Math.hypot(q.x - p.x, q.z - p.z) > 8 || Math.abs(q.y - p.y) > 1.5;
    if (far && r.lastValidIndex >= 0) idx = r.lastValidIndex;
    return T.poseAt(T.safeIndex(idx), 0);
  }

  // Efter respawn kan bilen hamna på andra sidan en checkpoint; mät om.
  resyncRacer(r) {
    r.stuckTime = 0;
    r.bestProgress = -Infinity;
    const p = r.vehicle.position;
    const cp = this.track.checkpoints[r.nextCp];
    const s = (p.x - cp.x) * cp.tangent.x + (p.z - cp.z) * cp.tangent.z;
    r.prevS = Math.min(s, -1e-3);
    r.trackIndex = -1;
  }
}
