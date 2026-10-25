import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// Efterbehandling för en tuffare, färgstarkare bild: glöd kring ljusa ytor,
// färggradering (mättnad, kontrast, varm ton) och vinjett. Kan stängas av
// (kvalitet "Låg") om datorn inte orkar.
// ---------------------------------------------------------------------------

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.26 },
    contrast: { value: 1.08 },
    warmth: { value: 0.03 },
    vignette: { value: 0.32 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float saturation, contrast, warmth, vignette; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      c.rgb += vec3(warmth, warmth * 0.35, -warmth * 0.6);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = c;
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.5, 2.2); // HDR före tonmappning: bara lampor och sådant som lyser själv glöder
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.grade);
    this.enabled = true;
  }

  setCamera(camera) { this.renderPass.camera = camera; }

  // Banor kan justera stämningen (natt = mer glöd, dag = mer mättnad)
  setLook({ bloom = 0.45, saturation = 1.26, warmth = 0.03, vignette = 0.3 } = {}) {
    this.bloom.strength = bloom;
    this.grade.uniforms.saturation.value = saturation;
    this.grade.uniforms.warmth.value = warmth;
    this.grade.uniforms.vignette.value = vignette;
  }

  setSize(w, h) { this.composer.setSize(w, h); }

  render(scene, camera) {
    if (!this.enabled) { this.renderer.render(scene, camera); return; }
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render();
  }
}
