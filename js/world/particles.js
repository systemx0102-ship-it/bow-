import * as THREE from 'three';

/**
 * Stateless GPU particle system.
 * The CPU only writes a particle once (spawn state into a ring buffer);
 * motion is solved analytically in the vertex shader every frame:
 *   p(t) = p0 + v0 * (1 - e^{-kt}) / k + ½ g t²
 * so tens of thousands of sparks cost ~zero CPU per frame.
 */
export class Particles extends THREE.Points {
  constructor(max = 16000) {
    const g = new THREE.BufferGeometry();
    const mk = (n) => new THREE.BufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', mk(3)); // spawn position
    g.setAttribute('aVel', mk(3));
    g.setAttribute('aColor', mk(3));
    g.setAttribute('aData', mk(4)); // birth, life, size, gravityScale
    g.setAttribute('aDrag', mk(1));
    const data = g.attributes.aData.array;
    for (let i = 0; i < max; i++) data[i * 4] = -1e5; // dead
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPR: { value: 1 },
        uScale: { value: 400 },
        uGravity: { value: new THREE.Vector3(0, -6, 0) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aVel; attribute vec3 aColor; attribute vec4 aData; attribute float aDrag;
        uniform float uTime; uniform float uPR; uniform float uScale; uniform vec3 uGravity;
        varying vec3 vColor; varying float vAlpha; varying float vSpin;
        void main(){
          float age = uTime - aData.x;
          if(age < 0.0 || age > aData.y){ gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; return; }
          float k = max(aDrag, 0.001);
          vec3 p = position + aVel*(1.0-exp(-k*age))/k + 0.5*uGravity*aData.w*age*age;
          float lt = age/aData.y;
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          gl_Position = projectionMatrix*mv;
          float flick = 0.75 + 0.25*sin(age*40.0 + aData.x*100.0);
          gl_PointSize = aData.z * uPR * uScale / max(-mv.z, 0.1) * pow(1.0-lt, 0.5) * flick;
          vAlpha = smoothstep(0.0, 0.06, lt) * (1.0-lt);
          vColor = aColor;
          vSpin = aData.x*13.0 + age*2.0;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha; varying float vSpin;
        void main(){
          vec2 uv = gl_PointCoord*2.0-1.0;
          float c = cos(vSpin), s = sin(vSpin);
          uv = mat2(c,-s,s,c)*uv;
          float d = length(uv);
          float core = exp(-d*d*10.0);
          float spikes = max(0.0, 1.0 - abs(uv.x*uv.y)*60.0) * max(0.0, 1.0-d);
          float a = (core*1.4 + spikes*0.8) * vAlpha;
          if(a < 0.004) discard;
          gl_FragColor = vec4(vColor*a, a);
        }`,
    });
    super(g, m);
    this.max = max;
    this.cursor = 0;
    this.frustumCulled = false;
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
    this.time = 0;
  }

  emit(p, v, color, life, size, grav = 1, drag = 1.2) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const a = this.geometry.attributes;
    a.position.array.set([p.x, p.y, p.z], i * 3);
    a.aVel.array.set([v.x, v.y, v.z], i * 3);
    a.aColor.array.set([color.r, color.g, color.b], i * 3);
    a.aData.array.set([this.time, life, size, grav], i * 4);
    a.aDrag.array[i] = drag;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  burst(center, count, { speed = 8, color = new THREE.Color(0.5, 0.9, 2), life = 1.2, size = 0.6, grav = 0.4, drag = 2.2, spread = 0.2, jitterColor = 0.3 } = {}) {
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      v.randomDirection().multiplyScalar(speed * (0.3 + Math.random() * 0.9));
      p.copy(center).addScaledVector(new THREE.Vector3().randomDirection(), Math.random() * spread);
      c.copy(color).offsetHSL((Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * jitterColor);
      this.emit(p, v, c, life * (0.5 + Math.random() * 0.8), size * (0.5 + Math.random()), grav, drag);
    }
  }

  // particles that fly inward and arrive at `center` (used for charging)
  converge(center, count, radius, color, life = 0.9, size = 0.3) {
    const k = 3.5;
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      p.randomDirection().multiplyScalar(radius * (0.6 + Math.random() * 0.6)).add(center);
      // with drag k, total travel = v/k -> choose v to land exactly on centre
      v.subVectors(center, p).multiplyScalar(k * 1.02);
      this.emit(p, v, color, life, size, 0, k);
    }
  }

  update(t) {
    this.time = t;
    this.material.uniforms.uTime.value = t;
    if (this.dirtyMax >= 0) {
      const a = this.geometry.attributes;
      for (const [name, n] of [['position', 3], ['aVel', 3], ['aColor', 3], ['aData', 4], ['aDrag', 1]]) {
        const at = a[name];
        at.clearUpdateRanges();
        at.addUpdateRange(this.dirtyMin * n, (this.dirtyMax - this.dirtyMin + 1) * n);
        at.needsUpdate = true;
      }
      this.dirtyMin = Infinity;
      this.dirtyMax = -1;
    }
  }
}
