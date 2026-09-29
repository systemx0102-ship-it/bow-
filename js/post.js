import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.0015 },
    uVignette: { value: 1 },
    uGrain: { value: 0.045 },
    uFlash: { value: 0 },
    uShock: { value: new THREE.Vector4(0.5, 0.5, 0, 0) }, // x,y,radius,strength
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAberration; uniform float uVignette;
    uniform float uGrain; uniform float uFlash; uniform vec4 uShock; uniform float uAspect;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 sd = (uv - uShock.xy) * vec2(uAspect,1.0);
      float r = length(sd);
      float ring = uShock.w * exp(-pow((r - uShock.z)*14.0, 2.0));
      uv -= normalize(sd + 1e-5) * ring * 0.035 / vec2(uAspect,1.0);
      vec2 off = (uv-0.5) * uAberration * (1.0 + ring*20.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      col += vec3(0.6,0.85,1.0) * ring * 0.6;
      vec2 v = (vUv-0.5)*vec2(uAspect,1.0);
      col *= mix(1.0, (1.0-smoothstep(0.2,1.15,length(v))), 0.75*uVignette);
      col += (h(vUv*1000.0 + fract(uTime)*100.0) - 0.5) * uGrain;
      col += uFlash * vec3(0.55,0.8,1.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.45, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const lens = new ShaderPass(LensShader);
  composer.addPass(lens);
  return { composer, bloom, lens };
}
