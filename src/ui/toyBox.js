import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Leksakskartongen i bilvalet och garaget: bilen står i ett lågt tråg med ett
// högt tryckt bakstycke, som en leksak på hyllan. Låsta bilar har ett mörkt
// fönster med texten LÅST framför sig. Ren grafik, ingen fysik.
// ---------------------------------------------------------------------------

const CLASS_COLOR = { Rookie: '#3fae4a', Amateur: '#2f8fe0', Advanced: '#8a4fd8', 'Semi-Pro': '#f08a1c', Pro: '#d8342c' };
const W = 0.36, L = 0.68, H = 0.34, T = 0.008; // trågets bredd och längd, bakstyckets höjd, kartongens tjocklek

const tex = (w, h, draw) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};

// Bakstycket: klassens färg med strålar bakom bilen och bilens namn överst
function backCard(def, locked) {
  return tex(1024, 400, (g, w, h) => {
    const col = CLASS_COLOR[def.cls] || '#888';
    g.fillStyle = col; g.fillRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h * 0.9);
    for (let k = 0; k < 28; k++) {
      g.rotate((Math.PI * 2) / 28);
      g.fillStyle = k % 2 ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.07)';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-40, -900); g.lineTo(40, -900); g.fill();
    }
    g.restore();
    g.fillStyle = '#12162e'; g.fillRect(0, 0, w, 120);
    g.fillStyle = '#ffd23f'; g.font = 'italic 900 84px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(locked && def.secret ? '???' : def.name.toUpperCase(), 30, 62, w - 330);
    g.fillStyle = '#ffffff'; g.font = 'italic 700 40px system-ui, sans-serif'; g.textAlign = 'right';
    g.fillText(def.cls.toUpperCase(), w - 30, 64);
  });
}

// Skylten på trågets framkant: bilens namn
function nameCard(def, locked) {
  return tex(512, 96, (g, w, h) => {
    g.fillStyle = '#12162e'; g.fillRect(0, 0, w, h);
    g.fillStyle = CLASS_COLOR[def.cls] || '#888'; g.fillRect(0, h - 10, w, 10);
    g.fillStyle = '#ffd23f'; g.font = 'italic 900 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(locked && def.secret ? '???' : def.name.toUpperCase(), w / 2, h / 2 - 4, w - 30);
  });
}

function lockCard() {
  return tex(512, 256, (g, w, h) => {
    g.fillStyle = 'rgba(10,12,30,0.86)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffd23f'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#ffd23f'; g.font = 'italic 900 96px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('LÅST', w / 2, h / 2);
  });
}

// pose: { x, y, z, heading } där bilen står. Förpackningen är ett lågt tråg med ett högt
// tryckt bakstycke längs bilens högra sida. Fram och upptill är den öppen, så att bilen syns.
export function makeToyBox(def, pose, locked = false) {
  const group = new THREE.Group();
  const card = new THREE.MeshStandardMaterial({ color: 0xb8905a, roughness: 0.9 });
  const add = (w, h, d, x, y, z, mat = card) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const plane = (w, h, map, x, y, z, rotY, extra = {}) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, roughness: 0.6, ...extra }));
    m.rotation.y = rotY; m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  const RIM = 0.045;
  add(W + T * 2, T, L + T * 2, 0, T / 2, 0);                                   // botten
  add(T, RIM, L + T * 2, W / 2 + T / 2, RIM / 2, 0);                            // framkant
  for (const s of [1, -1]) add(W, RIM, T, 0, RIM / 2, s * (L / 2 + T / 2));     // låga gavlar
  add(T, H, L + T * 2, -W / 2 - T / 2, H / 2, 0);                               // högt bakstycke
  // Tryck på bakstyckets båda sidor och bilens namn på framkanten
  const print = backCard(def, locked);
  plane(L, H - 0.006, print, -W / 2 + 0.001, H / 2, 0, Math.PI / 2);
  plane(L, H - 0.006, print, -W / 2 - T - 0.001, H / 2, 0, -Math.PI / 2);
  plane(L, RIM - 0.004, nameCard(def, locked), W / 2 + T + 0.001, RIM / 2, 0, Math.PI / 2);
  if (locked) {
    // Låst bil: ett mörkt fönster framför bilen
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L, 0.17), new THREE.MeshBasicMaterial({ map: lockCard(), transparent: true, side: THREE.DoubleSide }));
    m.rotation.y = Math.PI / 2; m.position.set(W / 2 + T / 2, RIM + 0.085, 0);
    group.add(m);
  }
  group.position.set(pose.x, pose.y, pose.z);
  group.rotation.y = pose.heading || 0;
  return group;
}
