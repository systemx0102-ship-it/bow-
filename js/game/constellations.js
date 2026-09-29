import * as THREE from 'three';
import { GlowLine } from '../world/glowline.js';
import { radialTexture } from '../world/sky.js';

export const CONSTELLATIONS = [
  {
    name: 'Cucarachas', title: 'Zona cocina',
    center: [-6, 9, -70], scale: 7.5, wind: 0, motion: 0,
    stars: [[-0.9, 1.2], [0.8, 1.0], [0.28, 0.05], [0, -0.05], [-0.28, -0.15], [-0.75, -1.3], [0.9, -1.1]],
    lines: [[0, 1], [0, 4], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6]],
  },
  {
    name: 'Termitas', title: 'Madera y estructura · con viento',
    center: [7, 14, -80], scale: 9, wind: 4, motion: 0.6,
    stars: [[-1.2, 0.4], [-0.6, -0.35], [0, 0.2], [0.6, -0.45], [1.2, 0.5]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    name: 'Roedores', title: 'Bodega · tormenta y objetivos móviles',
    center: [-1, 17, -88], scale: 8, wind: 7, motion: 1.2,
    stars: [[0, 1.3], [-0.4, 0.3], [0.38, 0.42], [0.5, -0.95], [-0.3, -1.05]],
    lines: [[0, 1], [0, 2], [1, 2], [2, 3], [3, 4], [4, 1]],
  },
];

let haloTex;

export class Star {
  constructor(base) {
    haloTex ||= radialTexture([[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(160,220,255,0.7)'], [0.4, 'rgba(60,130,255,0.18)'], [1, 'rgba(0,0,0,0)']]);
    this.base = base.clone();
    this.pos = base.clone();
    this.group = new THREE.Group();
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.2, 2.4) });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 2), this.coreMat);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0x8fd0ff }));
    this.halo.scale.setScalar(7);
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.9, 2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 1.85, 64), this.ringMat);
    this.group.add(this.core, this.halo, this.ring);
    this.group.position.copy(base);
    this.state = 'dormant';
    this.seed = Math.random() * 10;
    this.flash = 0;
    this.radius = 1.9;
  }
  update(t, dt, camera, focus, motion) {
    this.pos.copy(this.base);
    if (motion > 0) {
      this.pos.x += Math.sin(t * 0.5 * motion + this.seed) * 1.6 * motion;
      this.pos.y += Math.cos(t * 0.37 * motion + this.seed * 2) * 1.2 * motion;
    }
    this.group.position.copy(this.pos);
    this.ring.lookAt(camera.position);
    this.flash = Math.max(0, this.flash - dt * 1.5);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3 + this.seed);
    let s = 1, ringO = 0, haloS = 7;
    if (this.state === 'dormant') {
      this.coreMat.color.setRGB(0.25, 0.45, 0.9).multiplyScalar(0.5 + focus * 0.8);
      s = 0.7;
      haloS = 3 + focus * 3;
      this.halo.material.color.setRGB(0.35, 0.55, 1);
    } else if (this.state === 'active') {
      this.coreMat.color.setRGB(0.6, 1.3, 2.6).multiplyScalar(0.9 + pulse * 0.6);
      s = 1 + pulse * 0.15;
      ringO = 0.35 + pulse * 0.4;
      this.ring.scale.setScalar(1 + (1 - pulse) * 0.25);
      haloS = 7 + pulse * 2;
      this.halo.material.color.setRGB(0.55, 0.85, 1);
    } else {
      this.coreMat.color.setRGB(1.9, 1.6, 1.1).multiplyScalar(1 + this.flash * 1.5);
      s = 1.1 + this.flash * 0.6;
      haloS = 6 + this.flash * 8;
      this.halo.material.color.setRGB(1, 0.9, 0.7);
    }
    this.core.scale.setScalar(s);
    this.halo.scale.setScalar(haloS);
    this.ringMat.opacity = ringO;
  }
}

export class Constellation {
  constructor(def, scene) {
    this.def = def;
    this.group = new THREE.Group();
    const c = new THREE.Vector3(...def.center);
    this.stars = def.stars.map(([x, y], i) => {
      const s = new Star(new THREE.Vector3(c.x + x * def.scale, c.y + y * def.scale, c.z + Math.sin(i * 2.3) * 3));
      this.group.add(s.group);
      return s;
    });
    this.lines = def.lines.map(([a, b]) => {
      const l = new GlowLine(16, { color: 0xffd9a0, core: 0xffffff, px: 2.2, intensity: 1.8, taper: 0.6 });
      l.material.uniforms.uProgress.value = 0;
      l.userData = { a, b, target: 0 };
      this.group.add(l);
      return l;
    });
    this.focus = 0;
    this.targetFocus = 0.25;
    this.completed = false;
    scene.add(this.group);
    this._pts = Array.from({ length: 16 }, () => new THREE.Vector3());
  }
  activate() { this.targetFocus = 1; this.stars.forEach((s) => s.state === 'dormant' && (s.state = 'active')); }
  reset() {
    this.completed = false;
    this.targetFocus = 0.25;
    this.stars.forEach((s) => (s.state = 'dormant'));
    this.lines.forEach((l) => { l.userData.target = 0; l.material.uniforms.uProgress.value = 0; });
  }
  get remaining() { return this.stars.filter((s) => s.state !== 'lit').length; }
  update(t, dt, camera, gameOn) {
    this.focus += (this.targetFocus - this.focus) * Math.min(1, dt * 2);
    const motion = gameOn ? this.def.motion : 0;
    for (const s of this.stars) s.update(t, dt, camera, this.focus, motion);
    for (const l of this.lines) {
      const { a, b } = l.userData;
      // lines light up as soon as both ends are lit
      l.userData.target = this.stars[a].state === 'lit' && this.stars[b].state === 'lit' ? 1 : 0;
      const u = l.material.uniforms.uProgress;
      u.value += (l.userData.target - u.value) * Math.min(1, dt * 2.2);
      const A = this.stars[a].pos, B = this.stars[b].pos;
      for (let i = 0; i < 16; i++) this._pts[i].lerpVectors(A, B, i / 15);
      l.setPoints(this._pts);
      l.material.uniforms.uTime.value = t;
    }
  }
}
