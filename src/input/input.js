// ---------------------------------------------------------------------------
// Input: tangentbord och handkontroll → controls-struct + engångshändelser.
//   W/↑ gas, S/↓ broms/back, A/D ←/→ styr
//   Mellanslag/E avfyra vapen, F tillbaka mitt på vägen, R senaste punkten, C kamera
//   Enter starta om loppet, 1–3 byt bil, L byt bana, H visa/dölj hjälp
// ---------------------------------------------------------------------------

const ACTIONS = {
  // Spelare 2 vid delad skärm: piltangenter, höger Shift avfyrar, - vänder, . tillbaka
  ShiftRight: 'fire2', Slash: 'flip2', Period: 'reposition2',
  KeyR: 'reposition', KeyF: 'flip', KeyL: 'level', Space: 'fire', KeyE: 'fire', KeyC: 'camera', Enter: 'restart', KeyH: 'help',
  Digit1: 'car1', Digit2: 'car2', Digit3: 'car3', Escape: 'pause', KeyP: 'pause',
};
const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.queue = [];
    this.override = null; // för test: sätt controls direkt
    this._padPrev = {};
    target.addEventListener('keydown', (e) => {
      if (BLOCK.has(e.code)) e.preventDefault();
      this.keys.add(e.code); // även vid upprepning: hållen tangent efter fokusbyte
      if (e.repeat) return;
      const a = ACTIONS[e.code];
      if (a) this.queue.push(a);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // Engångshändelser sedan förra anropet
  actions() {
    this._pollPadButtons();
    const q = this.queue;
    this.queue = [];
    return q;
  }

  // scheme: 'all' (en spelare, båda tangentgrupperna), 'p1' (WASD) eller 'p2' (pilar).
  // Handkontroll 1 hör till spelare 1, handkontroll 2 till spelare 2.
  controls(scheme = 'all') {
    if (this.override && scheme !== 'p2') return this.override;
    const k = this.keys;
    const wasd = scheme !== 'p2', arrows = scheme !== 'p1';
    const has = (a, b) => (wasd && k.has(a)) || (arrows && k.has(b));
    let throttle = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
    let steer = (has('KeyA', 'ArrowLeft') ? 1 : 0) - (has('KeyD', 'ArrowRight') ? 1 : 0);

    const pad = this._pad(scheme === 'p2' ? 1 : 0);
    if (pad) {
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steer = -ax;
      const rt = pad.buttons[7]?.value || 0, lt = pad.buttons[6]?.value || 0;
      if (rt > 0.05 || lt > 0.05) throttle = rt - lt;
    }
    return { throttle, steer };
  }

  _pad(n = 0) {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
    return pads[n] || null;
  }

  _pollPadButtons() {
    const pad = this._pad();
    if (!pad) return;
    const map = { 0: 'fire', 3: 'reposition', 1: 'flip', 4: 'camera', 9: 'restart' };
    for (const [b, a] of Object.entries(map)) {
      const down = !!pad.buttons[b]?.pressed;
      if (down && !this._padPrev[b]) this.queue.push(a);
      this._padPrev[b] = down;
    }
  }
}
