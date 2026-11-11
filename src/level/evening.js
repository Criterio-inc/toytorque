import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Kvällsvariant av en utomhusbana: skymningshimmel, låg orange sol, våt väg
// som speglar himlen, tända fönster och ljuspölar under gatlyktorna.
// Banans dragning och fysik är oförändrade; bara ljus och ytor byts.
//
// evening(level) ger en ny nivå med night: true. Art-filen kan läsa flaggan
// (this.night) för att lägga till sådant som bara finns på kvällen.
// ---------------------------------------------------------------------------

const DUSK = {
  sky: 0x2a2c52,
  skyGradient: [0x141a3c, 0xe8875a, 0x4a4660],
  fog: { near: 70, far: 210, color: 0x5a5478 },
  lighting: {
    // Solen står precis över hustaken: långa orange skuggor, resten blått
    sun: { color: 0xffb482, intensity: 1.15, offset: [-30, 7, 12] },
    hemi: { sky: 0x6e86e6, ground: 0x2a2c48, intensity: 0.85 },
    exposure: 1.05,
    envIntensity: 1.0,
    envFromSky: true, // blanka ytor speglar skymningshimlen i stället för studioljuset
    shadow: { range: 24, size: 4096 },
  },
  skyDome: { top: 0x18224e, horizon: 0xe8905e, cloud: 0x8a6a80, cloudShade: 0x2c2844, coverage: 0.5, sunSize: 0.0006 },
  look: { ao: 0.8, contrast: 1.1, saturation: 1.1, warmth: -0.01, bloom: 0.42 },
};

// Våta ytor: mörkare och blankare. Tal per materialnamn: [grovhet, mörkning]
const WET = { asphalt: [0.2, 0.5], concrete: [0.3, 0.62], pavers: [0.24, 0.55], paint: [0.3, 0.8] };

export function evening(level) {
  return {
    ...level,
    ...DUSK,
    night: true,
    name: `${level.name}, kväll`,
    environment(ctx) {
      const props = level.environment.call(this, ctx);
      if (ctx.scene) dress(ctx.scene);
      return props;
    },
  };
}

// Byt material på det som redan är byggt. Materialen delas mellan banor,
// därför klonas de i stället för att ändras på plats.
function dress(scene) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const wet = WET[o.name];
    if (wet) {
      const m = o.material.clone();
      m.roughness = wet[0];
      m.color.multiplyScalar(wet[1]);
      m.envMapIntensity = 1.6;
      if (m.normalMap) m.normalScale = new THREE.Vector2(0.22, 0.22); // vattenfilmen jämnar ut kornen
      o.material = m;
    } else if (o.name === 'window') {
      const m = o.material.clone();
      m.emissive = new THREE.Color(0xffc070);
      m.emissiveMap = m.map;
      m.emissiveIntensity = 1.5;
      o.material = m;
    }
  });
}
