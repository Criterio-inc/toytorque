import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Starten: en startportal med ljus över mållinjen och
// jättelika röda 3D-siffror med gul kant som svävar framför startfältet
// under nedräkningen (3, 2, 1, GO!).
// ---------------------------------------------------------------------------

const DIGITS = ['3', '2', '1', 'GO!'];
let _tex = null;

function digitTextures() {
  if (_tex) return _tex;
  _tex = {};
  for (const d of DIGITS) {
    const c = document.createElement('canvas');
    c.width = d === 'GO!' ? 512 : 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.font = 'italic 900 210px "Arial Black", "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = c.width / 2, y = 136;
    // "3D"-djup: förskjutna mörka lager, sedan gul kant och röd fyllning
    for (let k = 10; k > 0; k--) { ctx.fillStyle = `rgb(${90 + k * 4},20,10)`; ctx.fillText(d, x + k * 1.6, y + k * 1.6); }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 22; ctx.strokeStyle = '#1a0a00'; ctx.strokeText(d, x, y);
    ctx.lineWidth = 14; ctx.strokeStyle = '#ffd23f'; ctx.strokeText(d, x, y);
    const g = ctx.createLinearGradient(0, 40, 0, 230);
    if (d === 'GO!') { g.addColorStop(0, '#9dff6a'); g.addColorStop(1, '#1f9a2c'); } else { g.addColorStop(0, '#ff5a3c'); g.addColorStop(1, '#b3120a'); }
    ctx.fillStyle = g; ctx.fillText(d, x, y);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    _tex[d] = tex;
  }
  return _tex;
}

export class StartFx {
  constructor(group, track) {
    this.group = new THREE.Group();
    group.add(this.group);
    const p0 = track.pts[0], t0 = track.tangents[0], n0 = track.normals[0];
    const half = track.roadHalf + 0.25;
    const H = 1.1;

    // Portal: två stolpar, en balk med rutigt fält och fem startljus
    const post = new THREE.BoxGeometry(0.08, H, 0.08);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.6, roughness: 0.35 });
    for (const sd of [1, -1]) {
      const m = new THREE.Mesh(post, postMat);
      m.position.set(p0.x + n0.x * half * sd, p0.y + H / 2, p0.z + n0.z * half * sd);
      m.castShadow = true;
      this.group.add(m);
    }
    const beamC = document.createElement('canvas');
    beamC.width = 256; beamC.height = 32;
    const bc = beamC.getContext('2d');
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { bc.fillStyle = (i + j) % 2 ? '#111' : '#f2f2f2'; bc.fillRect(i * 8, j * 8, 8, 8); }
    const beamTex = new THREE.CanvasTexture(beamC);
    beamTex.colorSpace = THREE.SRGBColorSpace;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.1, 0.14, 0.08), new THREE.MeshStandardMaterial({ map: beamTex, roughness: 0.6 }));
    beam.position.set(p0.x, p0.y + H, p0.z);
    beam.rotation.y = Math.atan2(n0.x, n0.z) + Math.PI / 2;
    beam.castShadow = true;
    this.group.add(beam);
    this.lights = [];
    const lampGeo = new THREE.SphereGeometry(0.045, 12, 8);
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, roughness: 0.3 });
      const m = new THREE.Mesh(lampGeo, mat);
      const off = (i - 2) * 0.13;
      m.position.set(p0.x + n0.x * off - t0.x * 0.05, p0.y + H - 0.17, p0.z + n0.z * off - t0.z * 0.05);
      this.group.add(m);
      this.lights.push(mat);
    }

    // Siffran svävar framför startfältet, synlig från bilarna bakom linjen
    const tex = digitTextures();
    this.mats = {};
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex['3'], transparent: true, depthWrite: false, fog: false }));
    this.sprite.position.set(p0.x + t0.x * 3.2, p0.y + 1.25, p0.z + t0.z * 3.2);
    this.sprite.visible = false;
    this.group.add(this.sprite);
    this.tex = tex;
    this.shown = null;
    this.t = 0;
  }

  update(dt, race) {
    let d = null;
    if (race.state === 'countdown') d = String(Math.max(1, Math.ceil(race.countdown)));
    else if (race.running && race.time < 1.0) d = 'GO!';
    if (d !== this.shown) {
      this.shown = d;
      this.t = 0;
      if (d) { this.sprite.material.map = this.tex[d]; this.sprite.material.needsUpdate = true; }
    }
    this.t += dt;
    this.sprite.visible = !!d;
    if (d) {
      // Studsar in och snurrar lätt
      const pop = Math.min(1, this.t * 6);
      const s = (d === 'GO!' ? 3.0 : 2.2) * (0.4 + 0.6 * pop + Math.sin(this.t * 10) * 0.03 * (1 - this.t));
      this.sprite.scale.set(s * (d === 'GO!' ? 2 : 1), s, 1);
      this.sprite.material.rotation = Math.sin(this.t * 4) * 0.08;
      this.sprite.material.opacity = d === 'GO!' ? Math.max(0, 1 - Math.max(0, race.time - 0.6) * 2.5) : 1;
    }
    // Startljusen: röda tänds under nedräkningen, alla gröna vid start
    const lit = race.state === 'countdown' ? Math.min(5, Math.floor((3 - race.countdown) / 0.6) + 1) : race.running ? 5 : 0;
    this.lights.forEach((m, i) => {
      const green = race.running;
      const on = i < lit;
      m.color.setHex(on ? (green ? 0x1fd13a : 0xe0180c) : 0x220000);
      m.emissive.setHex(on ? (green ? 0x1fd13a : 0xff2010) : 0x000000);
      m.emissiveIntensity = on ? 2 : 0;
    });
  }
}
