import * as THREE from 'three';
import { NOISE } from './noise.js';
import { GlowLine } from './glowline.js';

// Bow is built in its own local frame: grip at origin, limbs along ±Y,
// the "back" of the bow faces +X and the string lives on the -X side.
const HALF = 3.6;
const UPPER = [
  [0.0, 0.0], [0.1, 0.55], [0.3, 1.25], [0.42, 1.95], [0.36, 2.55],
  [0.16, 3.02], [-0.08, 3.32], [-0.2, 3.6],
];
export const TIP_X = -0.2;
export const TIP_Y = 3.6;
export const flexAt = (y, draw) => -draw * 0.42 * Math.pow(Math.abs(y) / HALF, 2);

function limbCurve() {
  const pts = [];
  for (let i = UPPER.length - 1; i > 0; i--) pts.push(new THREE.Vector3(UPPER[i][0], -UPPER[i][1], 0));
  for (const [x, y] of UPPER) pts.push(new THREE.Vector3(x, y, 0));
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

// Tube with an arbitrary radius profile and a ridged, flattened section.
function sculptedTube(curve, segs, radial, radiusFn) {
  const pos = [], nor = [], uv = [], idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(0, 0, 1);
  const P = new THREE.Vector3(), V = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    N.set(T.y, -T.x, 0).normalize(); // points to the back (+X)
    const r = radiusFn(t);
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const ridge = 1 + 0.45 * Math.pow(Math.abs(c), 10);
      const a = r * 1.0 * ridge, b = r * 1.55;
      V.copy(P).addScaledVector(N, c * a).addScaledVector(B, s * b);
      pos.push(V.x, V.y, V.z);
      const nn = new THREE.Vector3().addScaledVector(N, c / a).addScaledVector(B, s / b).normalize();
      nor.push(nn.x, nn.y, nn.z);
      uv.push(t, j / radial);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function bladeGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.2);
  s.quadraticCurveTo(0.2, -0.16, 0.46, 0.26);
  s.quadraticCurveTo(0.3, 0.12, 0.2, 0.12);
  s.quadraticCurveTo(0.12, 0.2, 0.0, 0.16);
  s.lineTo(0, -0.2);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.014, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -0.0175);
  return g;
}

function tipGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.08, -0.35);
  s.quadraticCurveTo(0.22, 0.0, 0.05, 0.95);
  s.quadraticCurveTo(-0.05, 0.4, -0.2, 0.2);
  s.quadraticCurveTo(-0.08, 0.0, -0.08, -0.35);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 12 });
  g.translate(0, 0, -0.025);
  return g;
}

/* ---------- Verlet string ---------- */
export class VerletString {
  constructor(n = 34) {
    this.n = n;
    this.p = []; this.o = []; this.pinnedMid = null;
    for (let i = 0; i < n; i++) {
      const y = THREE.MathUtils.lerp(-TIP_Y, TIP_Y, i / (n - 1));
      this.p.push(new THREE.Vector3(TIP_X, y, 0));
      this.o.push(new THREE.Vector3(TIP_X, y, 0));
    }
    this.top = new THREE.Vector3(TIP_X, TIP_Y, 0);
    this.bot = new THREE.Vector3(TIP_X, -TIP_Y, 0);
    this.energy = 0;
  }
  setAnchors(draw) {
    const fx = TIP_X + flexAt(TIP_Y, draw);
    this.top.set(fx, TIP_Y - draw * 0.12, 0);
    this.bot.set(fx, -TIP_Y + draw * 0.12, 0);
  }
  impulse(index, v) {
    for (let i = 1; i < this.n - 1; i++) {
      const w = Math.exp(-Math.pow((i - index) / 3, 2));
      this.p[i].addScaledVector(v, w);
    }
  }
  step(dt) {
    const { p, o, n } = this;
    const damp = 0.992;
    const tmp = new THREE.Vector3();
    for (let i = 1; i < n - 1; i++) {
      tmp.copy(p[i]);
      p[i].x += (p[i].x - o[i].x) * damp;
      p[i].y += (p[i].y - o[i].y) * damp;
      p[i].z += (p[i].z - o[i].z) * damp;
      o[i].copy(tmp);
    }
    p[0].copy(this.bot); p[n - 1].copy(this.top);
    const rest = this.bot.distanceTo(this.top) / (n - 1) * 0.985; // pre-tensioned
    const mid = (n - 1) / 2;
    const d = new THREE.Vector3();
    for (let it = 0; it < 14; it++) {
      if (this.pinnedMid) { p[Math.floor(mid)].copy(this.pinnedMid); p[Math.ceil(mid)].copy(this.pinnedMid); }
      for (let i = 0; i < n - 1; i++) {
        const a = p[i], b = p[i + 1];
        d.subVectors(b, a);
        const len = d.length() || 1e-6;
        const diff = (len - rest) / len;
        const wa = i === 0 ? 0 : 1, wb = i + 1 === n - 1 ? 0 : 1;
        const sum = wa + wb || 1;
        a.addScaledVector(d, (diff * wa) / sum);
        b.addScaledVector(d, (-diff * wb) / sum);
      }
    }
    let e = 0;
    for (let i = 1; i < n - 1; i++) e += p[i].distanceToSquared(o[i]);
    this.energy = e;
  }
}

/* ---------- Bow assembly ---------- */
export function createBow(envMap) {
  const root = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uDraw: { value: 0 }, uCharge: { value: 0 } };
  const curve = limbCurve();
  const radius = (t) => {
    const u = Math.abs(t * 2 - 1);
    let r = THREE.MathUtils.lerp(0.17, 0.028, THREE.MathUtils.smoothstep(u, 0.0, 1.0));
    r += 0.05 * Math.exp(-Math.pow(u / 0.08, 2));
    r += 0.025 * Math.exp(-Math.pow((u - 0.5) / 0.05, 2));
    return r;
  };

  const flexChunk = /* glsl */ `
    #include <begin_vertex>
    vObj = position;
    transformed.x -= uDraw * 0.42 * pow(abs(transformed.y)/${HALF.toFixed(2)}, 2.0);
  `;

  // Limb: dark sky-steel with living crystal veins
  const limbMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a1330, metalness: 0.92, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15,
    envMap, envMapIntensity: 1.4, iridescence: 0.4, iridescenceIOR: 1.6,
  });
  limbMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'uniform float uDraw;\nvarying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', flexChunk);
    sh.fragmentShader = 'uniform float uTime; uniform float uCharge; uniform float uDraw;\nvarying vec3 vObj;\n' + NOISE +
      sh.fragmentShader.replace('#include <emissivemap_fragment>', /* glsl */ `
        #include <emissivemap_fragment>
        float vn = 1.0 - abs(snoise(vObj*vec3(3.5,1.1,3.5) + vec3(0.0, uTime*0.05, 0.0)));
        float vein = pow(vn, 22.0);
        float fine = pow(1.0 - abs(snoise(vObj*vec3(9.0,3.0,9.0))), 30.0)*0.5;
        float pulse = 0.6 + 0.4*sin(uTime*2.2 - vObj.y*2.5);
        totalEmissiveRadiance += vec3(0.15,0.65,1.8) * (vein + fine) * pulse * (0.8 + uDraw*1.6 + uCharge*4.0);
      `);
  };
  const limb = new THREE.Mesh(sculptedTube(curve, 260, 28, radius), limbMat);
  root.add(limb);

  // Gold inlay tracing the back of the limbs
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xf0c27a, metalness: 1, roughness: 0.25, envMap, envMapIntensity: 1.4, clearcoat: 0.6, emissive: 0x5a3a10, emissiveIntensity: 0.8 });
  gold.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'uniform float uDraw;\nvarying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', flexChunk);
  };
  const goldPlain = new THREE.MeshPhysicalMaterial({ color: 0xf0c27a, metalness: 1, roughness: 0.3, envMap, envMapIntensity: 0.9, clearcoat: 0.6, emissive: 0x4a2e0a, emissiveIntensity: 0.7 });
  const goldRim = /* glsl */ `
    #include <emissivemap_fragment>
    float rimG = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.5);
    totalEmissiveRadiance += vec3(1.0, 0.68, 0.3) * rimG * 0.9;
  `;
  const inlayCurvePts = curve.getSpacedPoints(120).map((p, i, arr) => {
    const t = i / (arr.length - 1);
    const T = curve.getTangentAt(t);
    const N = new THREE.Vector3(T.y, -T.x, 0).normalize();
    return p.clone().addScaledVector(N, radius(t) * 1.38);
  });
  const inlay = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(inlayCurvePts), 240, 0.018, 6), gold);
  root.add(inlay);

  // Blades (instanced, flexing through the same shader chunk)
  const bladeGeo = bladeGeometry();
  const stations = [];
  for (const sign of [1, -1]) for (const u of [0.1, 0.24, 0.38, 0.52, 0.66, 0.78, 0.88]) stations.push({ t: 0.5 + sign * u * 0.5, sign, u });
  const bladeMatrices = [];
  const m4 = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  for (const st of stations) {
    const P = curve.getPointAt(st.t);
    const T = curve.getTangentAt(st.t).multiplyScalar(st.sign); // toward the tip
    const Nb = new THREE.Vector3(T.y * st.sign, -T.x * st.sign, 0).normalize(); // back
    const Bz = new THREE.Vector3(0, 0, 1);
    const r = radius(st.t);
    const sc = 0.38 + r * 4.2;
    for (const ang of [0, 1.35, -1.35]) {
      const out = Nb.clone().multiplyScalar(Math.cos(ang)).addScaledVector(Bz, Math.sin(ang)).normalize();
      X.copy(out); Y.copy(T); Z.crossVectors(X, Y).normalize(); Y.crossVectors(Z, X).normalize();
      m4.makeBasis(X, Y, Z);
      const s = ang === 0 ? sc : sc * 0.72;
      m4.scale(new THREE.Vector3(s, s * (ang === 0 ? 1 : 0.8), s));
      m4.setPosition(P.clone().addScaledVector(out, r * 0.7));
      bladeMatrices.push(m4.clone());
    }
  }
  const blades = new THREE.InstancedMesh(bladeGeo, gold, bladeMatrices.length);
  bladeMatrices.forEach((m, i) => blades.setMatrixAt(i, m));
  // blade flex happens per-instance in the vertex shader using the instance origin
  const bladeMat = goldPlain.clone();
  bladeMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', goldRim);
    sh.vertexShader = 'uniform float uDraw;\n' + sh.vertexShader.replace('#include <project_vertex>', /* glsl */ `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      mvPosition.x -= uDraw * 0.42 * pow(abs(mvPosition.y)/${HALF.toFixed(2)}, 2.0);
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
    `);
  };
  blades.material = bladeMat;
  root.add(blades);

  // Tip blades
  const tipGeo = tipGeometry();
  const tipMat = goldPlain.clone();
  tipMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', goldRim); };
  const tips = [];
  for (const sign of [1, -1]) {
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(TIP_X + 0.02, sign * (TIP_Y - 0.1), 0);
    tip.scale.set(sign === 1 ? 1 : 1, sign, 1);
    tip.rotation.z = sign * 0.25;
    tip.userData.base = tip.position.clone();
    root.add(tip);
    tips.push(tip);
  }

  // Tide crystals
  const crystalMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uCharge: uniforms.uCharge, uDraw: uniforms.uDraw },
    vertexShader: /* glsl */ `
      uniform float uDraw;
      varying vec3 vW; varying vec3 vL; varying vec3 vView;
      void main(){
        vL = position;
        vec4 w = modelMatrix*vec4(position,1.0);
        vW = w.xyz;
        vec4 mv = viewMatrix*w;
        vView = -mv.xyz;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uCharge; uniform float uDraw;
      varying vec3 vW; varying vec3 vL; varying vec3 vView;
      void main(){
        vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
        vec3 v = normalize(vView);
        float fres = pow(1.0 - abs(dot(n, v)), 2.0);
        float facet = fract(sin(dot(floor(n*4.0), vec3(12.9898,78.233,37.719)))*43758.5453);
        float inner = 0.5 + 0.5*sin(vL.y*18.0 - uTime*3.0);
        vec3 deep = vec3(0.02,0.25,0.9);
        vec3 cyan = vec3(0.35,0.95,1.6);
        vec3 col = mix(deep, cyan, facet*0.6 + fres) * (1.1 + inner*0.5);
        col += vec3(1.0)*pow(fres, 3.0)*1.5;
        col *= 1.0 + uDraw*0.8 + uCharge*2.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const crystalGeo = new THREE.OctahedronGeometry(1, 0);
  const crystals = [];
  const addCrystal = (x, y, z, sx, sy, rz = 0) => {
    const c = new THREE.Mesh(crystalGeo, crystalMat);
    c.position.set(x, y, z);
    c.scale.set(sx, sy, sx);
    c.rotation.z = rz;
    c.userData.base = c.position.clone();
    root.add(c);
    crystals.push(c);
    return c;
  };
  addCrystal(0.2, 0, 0, 0.14, 0.42); // heart crystal
  addCrystal(0.16, 0, 0.2, 0.06, 0.18);
  addCrystal(0.16, 0, -0.2, 0.06, 0.18);
  for (const s of [1, -1]) {
    const t = 0.5 + s * 0.25;
    const P = curve.getPointAt(t);
    addCrystal(P.x + 0.14, P.y, 0, 0.07, 0.24, s * -0.2);
    const P2 = curve.getPointAt(0.5 + s * 0.45);
    addCrystal(P2.x + 0.05, P2.y, 0, 0.05, 0.15);
  }
  // grip wrap (dark leather-like torus rings)
  const wrapMat = new THREE.MeshStandardMaterial({ color: 0x0b0f1c, roughness: 0.6, metalness: 0.4, envMap });
  for (let i = -3; i <= 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 8, 24), i % 3 === 0 ? goldPlain : wrapMat);
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(1, 1.4, 1);
    ring.position.set(0.02, i * 0.08, 0);
    root.add(ring);
  }

  // Heart light
  const heart = new THREE.PointLight(0x5cc8ff, 6, 6, 2);
  heart.position.set(0.5, 0, 0);
  root.add(heart);

  // String
  const string = new VerletString(34);
  const stringLine = new GlowLine(34, { color: 0x7fe0ff, px: 1.6, world: 0.006, intensity: 2.4 });
  root.add(stringLine);
  const nockGlow = new GlowLine(2, { color: 0xbff4ff, px: 7, intensity: 2 });
  nockGlow.visible = false;

  // Nocked arrow (local frame, points along +X)
  const nocked = createArrowMesh();
  nocked.visible = false;
  root.add(nocked);

  const state = { draw: 0 };
  root.userData = { uniforms, string, stringLine, crystals, tips, heart, nocked, state, curve, limbMat };

  root.updateBow = (t, dt, draw, charge) => {
    uniforms.uTime.value = t;
    uniforms.uDraw.value = draw;
    uniforms.uCharge.value = charge;
    for (const c of crystals) c.position.x = c.userData.base.x + flexAt(c.userData.base.y, draw);
    for (const tp of tips) tp.position.x = tp.userData.base.x + flexAt(tp.userData.base.y, draw);
    heart.intensity = 5 + Math.sin(t * 2.2) * 1.5 + draw * 10 + charge * 30;
    string.setAnchors(draw);
    if (draw > 0.001) {
      string.pinnedMid = (string.pinnedMid || new THREE.Vector3()).set(TIP_X - draw * 1.35, 0.0, 0);
    } else string.pinnedMid = null;
    // fixed-step physics for stability
    root.userData.acc = (root.userData.acc || 0) + Math.min(dt, 0.05);
    const h = 1 / 120;
    while (root.userData.acc >= h) { string.step(h); root.userData.acc -= h; }
    stringLine.setPoints(string.p);
    stringLine.material.uniforms.uIntensity.value = 2.2 + draw * 1.5 + charge * 3 + Math.min(string.energy * 400, 3);
    if (nocked.visible) nocked.position.set(TIP_X - draw * 1.35, 0.0, 0);
  };
  return root;
}

export function createArrowMesh() {
  const g = new THREE.Group();
  const shaftMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.2, 2.2) });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.4, 6), shaftMat);
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = 1.2;
  g.add(shaft);
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 2.2, 3.2) });
  const head = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), headMat);
  head.scale.set(0.26, 0.07, 0.07);
  head.position.x = 2.5;
  g.add(head);
  const fl = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.7, 1.6), side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.09), fl);
    f.position.x = 0.22;
    f.rotation.x = (i / 3) * Math.PI;
    f.position.y = 0;
    g.add(f);
  }
  g.userData.materials = [shaftMat, headMat, fl];
  return g;
}

/* ---------- Energy ribbons spiralling around the bow ---------- */
export function createRibbons() {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uOpacity; varying vec2 vUv;
      ${NOISE}
      void main(){
        float edge = smoothstep(0.0,0.5,vUv.y)*(1.0-smoothstep(0.5,1.0,vUv.y));
        float ends = smoothstep(0.0,0.12,vUv.x)*(1.0-smoothstep(0.85,1.0,vUv.x));
        float n = fbm3(vec3(vUv.x*7.0 - uTime*0.35, vUv.y*1.5, uTime*0.1));
        float streak = pow(max(0.0, 0.5+0.5*sin(vUv.x*40.0 - uTime*4.0 + n*6.0)), 6.0);
        float a = (smoothstep(-0.2,0.6,n)*0.55 + streak*0.6) * edge * ends * uOpacity;
        vec3 col = mix(vec3(0.05,0.3,1.0), vec3(0.5,1.0,1.6), streak + edge*0.3);
        gl_FragColor = vec4(col*a, a);
      }`,
  });
  for (let k = 0; k < 3; k++) {
    const segs = 220;
    const pos = [], uv = [], idx = [];
    const phase = (k / 3) * Math.PI * 2;
    const turns = 1.15 + k * 0.2;
    const width = 0.22 + k * 0.05;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = t * Math.PI * 2 * turns + phase;
      const r = 0.55 + Math.sin(t * Math.PI) * (0.7 + k * 0.15);
      const y = THREE.MathUtils.lerp(-3.9, 3.9, t);
      const cx = 0.25 + Math.cos(a) * r, cz = Math.sin(a) * r;
      for (const s of [-1, 1]) {
        pos.push(cx, y + s * width, cz);
        uv.push(t, s < 0 ? 0 : 1);
      }
      if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, mat);
    mesh.rotation.y = k * 0.7;
    mesh.userData.speed = 0.12 + k * 0.05;
    group.add(mesh);
  }
  group.userData.mat = mat;
  group.update = (t) => {
    mat.uniforms.uTime.value = t;
    group.children.forEach((m, i) => (m.rotation.y = i * 0.7 + t * m.userData.speed * (i % 2 ? -1 : 1)));
  };
  return group;
}

/* ---------- Orbiting shards ---------- */
export function createShards(count = 260) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.0, 2.2) });
  const mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), mat, count);
  const data = [];
  for (let i = 0; i < count; i++) {
    data.push({
      r: 3 + Math.pow(Math.random(), 0.7) * 11,
      a: Math.random() * Math.PI * 2,
      y: (Math.random() - 0.5) * 16,
      sp: (0.03 + Math.random() * 0.12) * (Math.random() < 0.5 ? -1 : 1),
      s: 0.02 + Math.pow(Math.random(), 3) * 0.1,
      rot: Math.random() * 10,
      bob: Math.random() * 10,
    });
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  mesh.frustumCulled = false;
  mesh.update = (t) => {
    for (let i = 0; i < count; i++) {
      const d = data[i];
      const a = d.a + t * d.sp;
      p.set(Math.cos(a) * d.r * 1.3, d.y + Math.sin(t * 0.4 + d.bob) * 0.4, Math.sin(a) * d.r * 0.55 - 3);
      e.set(t * 0.7 + d.rot, t * 0.5 + d.rot, 0);
      q.setFromEuler(e);
      sc.set(d.s, d.s * 2.4, d.s);
      m4.compose(p, q, sc);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}
