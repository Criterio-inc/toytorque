import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

// ---------------------------------------------------------------------------
// Efterbehandling för en tuffare, färgstarkare bild: glöd kring ljusa ytor,
// färggradering (mättnad, kontrast, varm ton) och vinjett. Banor kan dessutom
// slå på hörnskuggor (AO) och fartoskärpa mot bildens kanter. Kan stängas av
// (grafik "Enkel") om datorn inte orkar.
// ---------------------------------------------------------------------------

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.26 },
    contrast: { value: 1.08 },
    warmth: { value: 0.03 },
    vignette: { value: 0.32 },
    blur: { value: 0 },
    sharpen: { value: 0 },
    texel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float saturation, contrast, warmth, vignette, blur, sharpen; uniform vec2 texel; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // Fartoskärpa: dra ut bilden från mitten, mest i kanterna. Mitten (bilen) förblir skarp.
      if (blur > 0.001) {
        vec2 o = vUv - vec2(0.5, 0.56);
        float k = blur * smoothstep(0.08, 0.6, dot(o, o) * 2.4);
        vec3 acc = c.rgb;
        for (int i = 1; i < 8; i++) acc += texture2D(tDiffuse, vUv - o * k * float(i) / 7.0).rgb;
        c.rgb = acc / 8.0;
      }
      // Skärpa: förstärk skillnaden mot grannpunkterna (inte där fartoskärpan verkar)
      if (sharpen > 0.001) {
        vec3 n = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb
               + texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
        c.rgb = clamp(c.rgb + (c.rgb * 4.0 - n) * sharpen * (1.0 - min(1.0, blur * 20.0)), 0.0, 1.0);
      }
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      c.rgb += vec3(warmth, warmth * 0.35, -warmth * 0.6);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = c;
    }`,
};

const AO_SCALE = 0.5; // andel av bildens bredd och höjd som hörnskuggorna räknas i

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.5, 2.2); // HDR före tonmappning: bara lampor och sådant som lyser själv glöder
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass);
    // Hörnskuggor: mörkare där ytor möts och under bilarna. Styrkan sätts per bana i setLook.
    this.ao = new GTAOPass(scene, camera, size.x, size.y, undefined, { radius: 0.45, distanceExponent: 1.6, thickness: 0.6, scale: 1.1, samples: 8 });
    this.ao.enabled = false;
    // Hörnskuggor är mjuka och behöver inte skärmens fulla upplösning. I full
    // Retina-upplösning tog de ensamma över 50 ms per bild; en fjärdedel av
    // bildpunkterna ger samma intryck för en bråkdel av kostnaden.
    const aoSize = this.ao.setSize.bind(this.ao);
    this.ao.setSize = (w, h) => aoSize(Math.ceil(w * AO_SCALE), Math.ceil(h * AO_SCALE));
    // Urklippta ytor (bladtofsar, ris) ritas som hela rutor i hörnskuggornas djupbild
    // och ger då mörka fyrkanter runt sig. De hålls utanför den bilden.
    const ao = this.ao;
    ao.overrideVisibility = () => scene.traverse((o) => {
      ao._visibilityCache.set(o, o.visible);
      if (o.isPoints || o.isLine || (o.isMesh && o.material?.alphaTest > 0)) o.visible = false;
    });
    this.composer.addPass(this.ao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.grade);
    this.enabled = true;
    this.setSize(size.x, size.y);
  }

  setCamera(camera) { this.renderPass.camera = camera; }

  // Banor kan justera stämningen (natt = mer glöd, dag = mer mättnad)
  setLook({ bloom = 0.45, saturation = 1.26, warmth = 0.03, vignette = 0.3, contrast = 1.08, ao = 0.7, speedBlur = 1, sharpen = 0.18 } = {}) {
    this.bloom.strength = bloom;
    this.grade.uniforms.saturation.value = saturation;
    this.grade.uniforms.warmth.value = warmth;
    this.grade.uniforms.vignette.value = vignette;
    this.grade.uniforms.contrast.value = contrast;
    this.grade.uniforms.sharpen.value = sharpen;
    this.ao.enabled = ao > 0;
    this.ao.blendIntensity = ao;
    this.speedBlur = speedBlur;
    this.grade.uniforms.blur.value = 0;
  }

  // Fart 0..1 av toppfarten (över 1 under turbo). Oskärpan börjar först i god fart.
  setSpeed(k) {
    const b = this.speedBlur * Math.max(0, Math.min(1.3, k) - 0.45) / 0.55;
    const u = this.grade.uniforms.blur;
    u.value += (b * 0.085 - u.value) * 0.15;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.grade.uniforms.texel.value.set(1 / (w * pr), 1 / (h * pr));
  }

  render(scene, camera) {
    if (!this.enabled) { this.renderer.render(scene, camera); return; }
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.ao.scene = scene; this.ao.camera = camera;
    this.composer.render();
  }
}
