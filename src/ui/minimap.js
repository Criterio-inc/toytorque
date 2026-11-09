// ---------------------------------------------------------------------------
// Minikarta: banan sedd uppifrån i ett hörn, med en prick per bil.
// Banan ritas en gång per nivå till en egen canvas; bara prickarna ritas om,
// och högst 30 gånger i sekunden.
// ---------------------------------------------------------------------------

// Passa in punkter (x, z) i en kvadrat med sidan size och marginalen pad.
// Ren funktion så att den går att testa utan webbläsare. z går nedåt på
// kartan, alltså samma håll som kameran tittar när bilen kör mot -z.
export function fitMap(points, size, pad) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z;
  }
  const span = Math.max(x1 - x0, z1 - z0, 1e-6);
  const scale = (size - 2 * pad) / span;
  // Centrera den kortare sidan
  const ox = pad + ((size - 2 * pad) - (x1 - x0) * scale) / 2;
  const oz = pad + ((size - 2 * pad) - (z1 - z0) * scale) / 2;
  return {
    scale,
    map: (x, z) => [ox + (x - x0) * scale, oz + (z - z0) * scale],
  };
}

const SIZE = 256; // canvasens bildpunkter; skalas med CSS

export class Minimap {
  constructor(el) {
    this.el = el;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d');
    el.appendChild(this.canvas);
    this.bg = document.createElement('canvas');
    this.bg.width = this.bg.height = SIZE;
    this.t = 0;
    this.on = true;
  }

  // Ny bana: rita vägen (och genvägarna) en gång
  setTrack(track) {
    const pts = track.pts;
    const short = (track.shortcuts || []).map((s) => s.path?.pts || []).filter((p) => p.length > 1);
    this.fit = fitMap([...pts, ...short.flat()], SIZE, 18);
    const { map, scale } = this.fit;
    const g = this.bg.getContext('2d');
    g.clearRect(0, 0, SIZE, SIZE);
    g.lineJoin = g.lineCap = 'round';
    const path = (list, closed) => {
      g.beginPath();
      list.forEach((p, i) => { const [x, y] = map(p.x, p.z); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      if (closed) g.closePath();
    };
    const w = Math.max(5, track.roadHalf * 2 * scale);
    // Mörk kant under, ljus väg över, så att den syns mot alla bakgrunder
    for (const s of short) { path(s, false); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = w * 0.7 + 4; g.stroke(); }
    path(pts, true); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = w + 5; g.stroke();
    for (const s of short) { path(s, false); g.strokeStyle = 'rgba(255,255,255,.45)'; g.setLineDash([w * 0.6, w * 0.5]); g.lineWidth = w * 0.7; g.stroke(); g.setLineDash([]); }
    path(pts, true); g.strokeStyle = 'rgba(240,244,255,.92)'; g.lineWidth = w; g.stroke();
    // Mållinjen: ett rutigt streck tvärs vägen vid första checkpointen
    const cp = track.checkpoints?.[0];
    if (cp?.normal) {
      const [ax, ay] = map(cp.x + cp.normal.x * track.roadHalf * 1.3, cp.z + cp.normal.z * track.roadHalf * 1.3);
      const [bx, by] = map(cp.x - cp.normal.x * track.roadHalf * 1.3, cp.z - cp.normal.z * track.roadHalf * 1.3);
      g.lineWidth = Math.max(3, w * 0.45);
      g.strokeStyle = '#111'; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.strokeStyle = '#fff'; g.setLineDash([g.lineWidth, g.lineWidth]); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
    }
    this.t = 1; // rita direkt
  }

  // cars: [{ x, z, color, me, p2 }]. Spelarna ritas sist så att de ligger överst.
  update(dt, cars) {
    if (!this.fit || !this.on) return;
    this.t += dt;
    if (this.t < 1 / 30) return;
    this.t = 0;
    const g = this.ctx, { map } = this.fit;
    g.clearRect(0, 0, SIZE, SIZE);
    g.drawImage(this.bg, 0, 0);
    const order = [...cars].sort((a, b) => (a.me || a.p2 ? 1 : 0) - (b.me || b.p2 ? 1 : 0));
    for (const c of order) {
      const [x, y] = map(c.x, c.z);
      const r = c.me || c.p2 ? 9 : 6.5;
      g.beginPath(); g.arc(x, y, r + 2.5, 0, Math.PI * 2); g.fillStyle = '#0b0f24'; g.fill();
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = c.me ? '#ffd23f' : c.p2 ? '#ff8a3c' : c.color; g.fill();
      if (c.me || c.p2) { g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke(); }
    }
  }

  setVisible(v) { this.on = v; this.el.classList.toggle('on', v); }

  // M: av/på, sparas till nästa gång
  toggle() {
    this.setVisible(!this.on);
    try { localStorage.setItem('revolt.minimap', this.on ? '1' : '0'); } catch { /* privat läge */ }
    return this.on;
  }
}

// Minikartan är på om spelaren inte stängt av den (M)
export function loadMapOn() {
  try { return localStorage.getItem('revolt.minimap') !== '0'; } catch { return true; }
}
export const carColor = (c) => (c._mapColor ||= '#' + (c.vehicle.def.colors?.body ?? 0xcccccc).toString(16).padStart(6, '0'));
