import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Himmelskupol för utomhusbanor: färgtoning, sol med sken, drivande moln och
// dis mot horisonten. Allt räknas i en shader, utan bildfiler.
//
// Nivådata (valfritt): skyDome: { top, horizon, haze, cloud, cloudShade,
//   coverage 0..1, wind [x, z], sunSize }. Solens riktning tas från nivåns ljus,
// så att skivan på himlen stämmer med skuggorna.
// ---------------------------------------------------------------------------

const vertexShader = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Bara kamerans rotation: kupolen följer med kameran och ligger alltid längst bort
    vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;

const fragmentShader = `
  uniform vec3 top, horizon, haze, cloud, cloudShade, sunDir, sunColor;
  uniform float coverage, time, sunSize;
  uniform vec2 wind;
  varying vec3 vDir;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec3 col = mix(horizon, top, pow(h, 0.45));

    // Sol: skiva, tätt sken och ett brett ljus över den sidan av himlen
    float s = max(dot(d, sunDir), 0.0);
    col += sunColor * (pow(s, 6.0) * 0.22 + pow(s, 90.0) * 0.9);
    col += sunColor * smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.5, s) * 24.0;

    // Moln på ett plan ovanför: tätare och plattare mot horisonten
    vec2 uv = d.xz / (d.y + 0.16) * 1.15 + wind * time;
    float n = fbm(uv) * 0.75 + fbm(uv * 2.7 + 3.0) * 0.25;
    float c = smoothstep(1.0 - coverage, 1.0 - coverage + 0.24, n);
    float thick = smoothstep(1.0 - coverage + 0.05, 1.0 - coverage + 0.5, n);
    vec3 cc = mix(cloud, cloudShade, thick * 0.75);
    cc += sunColor * pow(s, 10.0) * 0.5 * (1.0 - thick); // tunna kanter lyser upp nära solen
    col = mix(col, cc, c * smoothstep(0.015, 0.22, d.y));

    // Dis: horisonten löses upp i samma färg som banans dimma
    col = mix(haze, col, smoothstep(-0.02, 0.1, d.y));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function makeSkyDome(def = {}, sunOffset = [14, 26, 9], sunColor = 0xfff1dc) {
  const c = (v, fallback) => new THREE.Color(v ?? fallback);
  const mat = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    uniforms: {
      top: { value: c(def.top, 0x2b78d4) },
      horizon: { value: c(def.horizon, 0xa9d5f4) },
      haze: { value: c(def.haze, 0xc9deec) },
      cloud: { value: c(def.cloud, 0xffffff) },
      cloudShade: { value: c(def.cloudShade, 0x9fb2cc) },
      sunDir: { value: new THREE.Vector3(...sunOffset).normalize() },
      sunColor: { value: c(sunColor) },
      coverage: { value: def.coverage ?? 0.48 },
      sunSize: { value: def.sunSize ?? 0.0012 },
      wind: { value: new THREE.Vector2(...(def.wind ?? [0.006, 0.002])) },
      time: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.frustumCulled = false; // kupolen ritas runt kameran oavsett var den står
  mesh.scale.setScalar(190); // stor nog att hamna utanför hörnskuggornas djupbild
  mesh.renderOrder = -1000;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.userData.sky = true;
  mesh.userData.tick = (t) => { mat.uniforms.time.value = t; };
  return mesh;
}
