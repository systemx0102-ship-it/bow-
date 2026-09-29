import * as THREE from 'three';
import { NOISE } from './noise.js';

export const MOON_POS = new THREE.Vector3(9, 7, -48);

/* ---------- Nebula dome ---------- */
export function createNebulaMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uMoonDir: { value: MOON_POS.clone().normalize() },
      uIntensity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uMoonDir; uniform float uIntensity;
      varying vec3 vDir;
      ${NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float t = uTime*0.004;
        float n  = fbm(d*2.1 + vec3(t,0.,-t));
        float n2 = fbm(d*4.6 + n*1.6 + vec3(0.,t*2.,0.));
        float band = exp(-pow(d.y*2.2 - d.x*0.9 + 0.25, 2.0));
        float dens = clamp(n2*0.75 + n*0.55 + band*0.55 - 0.05, 0.0, 1.0);
        vec3 base = vec3(0.004,0.008,0.03);
        vec3 mid  = vec3(0.012,0.04,0.16);
        vec3 hi   = vec3(0.06,0.22,0.75);
        vec3 cy   = vec3(0.25,0.65,1.0);
        vec3 col = mix(base, mid, smoothstep(0.0,0.6,dens));
        col += hi * pow(dens, 2.6) * 0.55;
        col += cy * pow(dens, 6.0) * 0.45;
        // dust lanes
        float lanes = smoothstep(0.1,0.6, fbm(d*9.0+n));
        col *= mix(1.0, 0.55, lanes*band);
        // moon atmosphere
        float m = max(dot(d, uMoonDir), 0.0);
        col += vec3(0.25,0.45,1.0) * (pow(m, 14.0)*0.35 + pow(m, 120.0)*0.6);
        // horizon darken
        col *= smoothstep(-0.75, 0.1, d.y)*0.7 + 0.3;
        gl_FragColor = vec4(col*uIntensity, 1.0);
      }`,
  });
}

/* ---------- Star field ---------- */
export function createStars(count = 7000) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const col = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = 320 + Math.random() * 120;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(th);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(th);
    const big = Math.random() < 0.02;
    size[i] = big ? 3.5 + Math.random() * 4 : 0.6 + Math.pow(Math.random(), 3) * 2.6;
    const k = Math.random();
    if (k < 0.7) c.setHSL(0.6 + Math.random() * 0.04, 0.8, 0.8);
    else if (k < 0.93) c.setHSL(0.55, 0.3, 0.95);
    else c.setHSL(0.11, 0.7, 0.8);
    col.set([c.r, c.g, c.b], i * 3);
    phase[i] = Math.random() * 100;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPR: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute vec3 aColor; attribute float aPhase;
      uniform float uTime; uniform float uPR;
      varying vec3 vColor; varying float vBig;
      void main(){
        float tw = 0.65 + 0.35*sin(uTime*(0.6+fract(aPhase)*2.5) + aPhase);
        vColor = aColor * tw * (aSize > 3.0 ? 2.6 : 1.3);
        vBig = step(3.0, aSize);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPR * (vBig > 0.5 ? 2.2 : 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vBig;
      void main(){
        vec2 uv = gl_PointCoord*2.0-1.0;
        float d = length(uv);
        float core = exp(-d*d*9.0);
        float spikes = vBig * (max(0.0,1.0-abs(uv.x)*14.0) + max(0.0,1.0-abs(uv.y)*14.0)) * (1.0-d);
        float a = core + spikes*0.7;
        if(a < 0.01) discard;
        gl_FragColor = vec4(vColor*a, a);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

/* ---------- Moon ---------- */
export function createMoon() {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLight: { value: new THREE.Vector3(-0.35, 0.25, 1).normalize() } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP; varying vec3 vView;
      void main(){
        vP = position;
        vN = normalize(normalMatrix*normal);
        vec4 mv = modelViewMatrix*vec4(position,1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLight; uniform float uTime;
      varying vec3 vN; varying vec3 vP; varying vec3 vView;
      ${NOISE}
      void main(){
        vec3 p = normalize(vP);
        float maria = smoothstep(-0.1, 0.45, fbm(p*1.6));
        float crat = 0.0;
        for(int i=0;i<3;i++){
          float f = 3.0*pow(2.3,float(i));
          float c = 1.0-abs(snoise(p*f+float(i)*7.0));
          crat += pow(c, 8.0)/(1.0+float(i));
        }
        float detail = fbm(p*18.0)*0.5+0.5;
        vec3 bright = vec3(0.86,0.92,1.05);
        vec3 dark = vec3(0.34,0.44,0.66);
        vec3 alb = mix(bright, dark, maria*0.75);
        alb *= 0.8 + detail*0.35;
        alb += crat*0.18;
        vec3 n = normalize(vN);
        float lit = clamp(dot(n, uLight)*0.9+0.25, 0.0, 1.0);
        float fres = pow(1.0-max(dot(n, vView),0.0), 3.0);
        vec3 col = alb*lit*0.92 + vec3(0.35,0.6,1.0)*fres*1.0;
        gl_FragColor = vec4(col,1.0);
      }`,
  });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(7, 96, 64), mat);
  group.add(moon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, 'rgba(160,200,255,0.28)'], [0.2, 'rgba(90,150,255,0.1)'], [0.55, 'rgba(40,90,255,0.03)'], [1, 'rgba(0,0,0,0)']]),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  halo.scale.set(36, 36, 1);
  group.add(halo);
  group.position.copy(MOON_POS);
  group.userData.mat = mat;
  return group;
}

/* ---------- Volumetric-looking clouds (billboard fbm) ---------- */
export function createClouds() {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      varying vec2 vUv; varying float vSeed;
      void main(){ vUv = uv; vSeed = aSeed;
        gl_Position = projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uOpacity;
      varying vec2 vUv; varying float vSeed;
      ${NOISE}
      void main(){
        vec2 p = vUv*2.0-1.0;
        float r = length(p*vec2(1.0,1.6));
        vec3 q = vec3(p*1.8, vSeed*10.0 + uTime*0.02);
        float n = fbm3(q + snoise(q*1.7 + uTime*0.01)*0.35);
        float d = smoothstep(0.05, 0.75, n*0.9 + 0.55 - r*0.95);
        if(d < 0.005) discard;
        float top = smoothstep(-0.6, 0.8, p.y + n*0.6);
        vec3 col = mix(vec3(0.01,0.025,0.09), vec3(0.14,0.3,0.85), top);
        col += vec3(0.3,0.55,1.0)*pow(top,4.0)*0.35;
        gl_FragColor = vec4(col, d*0.75*uOpacity);
      }`,
  });
  const n = 16;
  const geo = new THREE.PlaneGeometry(1, 1);
  const seeds = new Float32Array(n);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const clouds = [];
  for (let i = 0; i < n; i++) {
    seeds[i] = Math.random();
    const side = i % 2 ? 1 : -1;
    const lower = i < 11;
    const s = 34 + Math.random() * 30;
    const pos = lower
      ? new THREE.Vector3((Math.random() - 0.5) * 200, -30 - s * 0.25 - Math.random() * 8, -70 - Math.random() * 110)
      : new THREE.Vector3(side * (75 + Math.random() * 50), 5 + Math.random() * 40, -110 - Math.random() * 60);
    clouds.push({ pos, s, drift: (Math.random() - 0.5) * 0.6 });
    m4.compose(pos, q, new THREE.Vector3(s * 1.6, s, 1));
    mesh.setMatrixAt(i, m4);
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  group.add(mesh);
  group.userData = { mat, mesh, clouds };
  group.update = (t) => {
    mat.uniforms.uTime.value = t;
    for (let i = 0; i < n; i++) {
      const c = clouds[i];
      const p = c.pos.clone();
      p.x += Math.sin(t * 0.02 * (1 + c.drift) + i) * 8;
      m4.compose(p, q, new THREE.Vector3(c.s * 1.6, c.s, 1));
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  return group;
}

/* ---------- helpers ---------- */
export function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
