import * as THREE from 'three';

/**
 * Screen-space extruded "fat line" with an energy glow profile.
 * Each point becomes two vertices that are pushed apart in clip space along
 * the screen-projected normal, so the line keeps a constant, crisp width at
 * any distance (or a world-space width, or a blend of both).
 */
export class GlowLine extends THREE.Mesh {
  constructor(count, opts = {}) {
    const g = new THREE.BufferGeometry();
    const n = count * 2;
    const f3 = () => new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', f3());
    g.setAttribute('aPrev', f3());
    g.setAttribute('aNext', f3());
    const side = new Float32Array(n);
    const u = new Float32Array(n);
    for (let i = 0; i < count; i++) {
      side[i * 2] = -1; side[i * 2 + 1] = 1;
      u[i * 2] = u[i * 2 + 1] = i / (count - 1);
    }
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    const idx = [];
    for (let i = 0; i < count - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    g.setIndex(idx);

    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: opts.depthTest ?? true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(opts.color ?? 0x7fd8ff) },
        uCore: { value: new THREE.Color(opts.core ?? 0xffffff) },
        uPx: { value: opts.px ?? 3 },
        uWorld: { value: opts.world ?? 0 },
        uRes: GlowLine.res,
        uOpacity: { value: opts.opacity ?? 1 },
        uProgress: { value: 1 },
        uDash: { value: opts.dash ?? 0 },
        uFade: { value: opts.fade ?? 0 },
        uTaper: { value: opts.taper ?? 0 },
        uIntensity: { value: opts.intensity ?? 1.6 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aPrev; attribute vec3 aNext; attribute float aSide; attribute float aU;
        uniform float uPx; uniform float uWorld; uniform vec2 uRes; uniform float uTaper;
        varying float vSide; varying float vU;
        void main(){
          float aspect = uRes.x/uRes.y;
          mat4 pmv = projectionMatrix*modelViewMatrix;
          vec4 c = pmv*vec4(position,1.0);
          vec4 p = pmv*vec4(aPrev,1.0);
          vec4 n = pmv*vec4(aNext,1.0);
          vec2 cs = c.xy/max(c.w,1e-4); cs.x*=aspect;
          vec2 ps = p.xy/max(p.w,1e-4); ps.x*=aspect;
          vec2 ns = n.xy/max(n.w,1e-4); ns.x*=aspect;
          vec2 d1 = cs-ps; vec2 d2 = ns-cs;
          vec2 dir;
          if(length(d1) < 1e-6) dir = normalize(d2 + 1e-7);
          else if(length(d2) < 1e-6) dir = normalize(d1 + 1e-7);
          else dir = normalize(normalize(d1)+normalize(d2));
          vec2 nrm = vec2(-dir.y, dir.x);
          nrm.x /= aspect;
          float prof = mix(1.0, sin(3.14159*clamp(aU,0.0,1.0))*0.9+0.1, uTaper);
          float w = (uPx*2.0/uRes.y*c.w + uWorld*projectionMatrix[1][1]) * prof;
          c.xy += nrm * w * aSide;
          vSide = aSide; vU = aU;
          gl_Position = c;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform vec3 uCore; uniform float uOpacity; uniform float uProgress;
        uniform float uDash; uniform float uFade; uniform float uIntensity; uniform float uTime;
        varying float vSide; varying float vU;
        void main(){
          if(vU > uProgress) discard;
          float d = abs(vSide);
          float core = (1.0-smoothstep(0.0,0.45,d));
          float glow = exp(-d*d*3.5);
          float a = (core*0.9 + glow*0.55) * uOpacity;
          if(uDash > 0.0){ float k = fract(vU*uDash - uTime*1.5); a *= smoothstep(0.0,0.15,k)*(1.0-smoothstep(0.35,0.55,k)); }
          if(uFade > 0.0) a *= pow(vU, uFade);
          float head = smoothstep(uProgress-0.04, uProgress, vU) * step(uProgress, 0.999);
          vec3 col = mix(uColor*glow, uCore, core*0.8) * uIntensity + uCore*head*2.0;
          gl_FragColor = vec4(col*a, a);
        }`,
    });
    super(g, m);
    this.count = count;
    this.frustumCulled = false;
  }

  setPoints(points) {
    const g = this.geometry;
    const P = g.attributes.position.array, A = g.attributes.aPrev.array, N = g.attributes.aNext.array;
    const c = this.count;
    for (let i = 0; i < c; i++) {
      const p = points[Math.min(i, points.length - 1)];
      const pr = points[Math.max(0, Math.min(i - 1, points.length - 1))];
      const nx = points[Math.min(i + 1, points.length - 1)];
      for (let s = 0; s < 2; s++) {
        const k = (i * 2 + s) * 3;
        P[k] = p.x; P[k + 1] = p.y; P[k + 2] = p.z;
        A[k] = pr.x; A[k + 1] = pr.y; A[k + 2] = pr.z;
        N[k] = nx.x; N[k + 1] = nx.y; N[k + 2] = nx.z;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aPrev.needsUpdate = true;
    g.attributes.aNext.needsUpdate = true;
  }

}
// shared by every line: updated once on resize
GlowLine.res = { value: new THREE.Vector2(1, 1) };
