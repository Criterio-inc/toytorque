import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Ytstruktur ur en färgtextur: ljusa partier tolkas som upphöjda och blir en
// normalkarta. Då fångar asfaltens korn och plattornas fogar solljuset, i
// stället för att ytan ser platt och målad ut. Kräver ingen bildfil.
// ---------------------------------------------------------------------------

export function bumpFrom(tex, strength = 2) {
  const src = tex.image, w = src.width, h = src.height;
  const lum = new Float32Array(w * h);
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h; i++) lum[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(w, h);
  const at = (x, y) => lum[((y + h) % h) * w + ((x + w) % w)]; // texturen upprepas, så kanterna hänger ihop
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), o = (y * w + x) * 4;
    out.data[o] = (-dx / l * 0.5 + 0.5) * 255;
    out.data[o + 1] = (dy / l * 0.5 + 0.5) * 255;
    out.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
    out.data[o + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const n = new THREE.CanvasTexture(c);
  n.wrapS = tex.wrapS; n.wrapT = tex.wrapT;
  n.repeat.copy(tex.repeat);
  n.anisotropy = tex.anisotropy;
  return n;
}
