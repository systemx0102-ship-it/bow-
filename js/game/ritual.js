import * as THREE from 'three';
import { CONSTELLATIONS, Constellation, Star } from './constellations.js';
import { GlowLine } from '../world/glowline.js';
import { createArrowMesh, TIP_X } from '../world/bow.js';

const UP = new THREE.Vector3(0, 1, 0);
const GRAV = 11;
const PLANE_Z = -80;

const $ = (id) => document.getElementById(id);

/**
 * "El Ritual": the archery system.
 * - Hold to draw (non-linear draw curve), release to shoot
 * - Ballistic arrows with gravity + solar wind, swept-sphere collision
 * - Perfect-release window, combos, fatigue sway, Nova charged shot
 */
export class Ritual {
  constructor({ scene, camera, bow, particles, audio, post }) {
    Object.assign(this, { scene, camera, bow, particles, audio, post });
    this.active = false;
    this.constellations = CONSTELLATIONS.map((d) => new Constellation(d, scene));
    this.gcam = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2(0, 0.1);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -PLANE_Z);
    this.aim = new THREE.Vector3(0, 10, PLANE_Z);
    this.aimSmooth = this.aim.clone();
    this.arrows = [];
    this.comets = [];
    this.draw = 0; this.drawing = false; this.fullTime = 0; this.charge = 0;
    this.shake = 0;
    this.shock = null;
    this.flash = 0;
    this.pose = { camPos: new THREE.Vector3(), camTarget: new THREE.Vector3(), bowPos: new THREE.Vector3(), bowQuat: new THREE.Quaternion(), fov: 55 };
    this.preview = new GlowLine(44, { color: 0x9fe6ff, px: 2.2, intensity: 1.4, dash: 22, opacity: 0.8 });
    this.preview.visible = false;
    scene.add(this.preview);
    this._v = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    this.qBase = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));
    this.qCant = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.32);
    this.hud = {
      root: $('hud'), score: $('hud-score'), combo: $('hud-combo'), level: $('hud-level'), dots: $('hud-dots'),
      wind: $('hud-wind'), windArrow: $('hud-wind-arrow'), energy: $('hud-energy'), energyLabel: $('hud-energy-label'),
      banner: $('hud-banner'), popups: $('popups'), victory: $('victory'), reticle: $('reticle'),
    };
    this.windValue = 0;
  }

  /* ---------- lifecycle ---------- */
  start() {
    this.active = true;
    this.level = 0; this.score = 0; this.combo = 0; this.maxCombo = 0; this.shots = 0; this.hits = 0; this.energy = 0;
    this.shownScore = 0;
    this.arrows.forEach((a) => this.killArrow(a, true));
    this.comets.forEach((c) => this.scene.remove(c.star.group));
    this.comets = [];
    this.constellations.forEach((c) => c.reset());
    this.hud.victory.classList.remove('show');
    this.startLevel(0);
    this.cometTimer = 7;
  }
  stop() {
    this.active = false;
    this.drawing = false; this.draw = 0; this.charge = 0;
    this.preview.visible = false;
    this.bow.userData.nocked.visible = false;
    this.constellations.forEach((c) => c.reset());
    this.comets.forEach((c) => this.scene.remove(c.star.group));
    this.comets = [];
    this.audio.setTension(0);
  }
  startLevel(i) {
    this.level = i;
    const c = this.constellations[i];
    c.activate();
    this.banner(`<small>Nivel ${['I', 'II', 'III'][i]}</small>${c.def.name}<em>${c.def.title}</em>`);
    this.renderDots();
    this.hud.level.textContent = c.def.name;
  }
  get current() { return this.constellations[this.level]; }

  /* ---------- input ---------- */
  pointer(x, y) {
    this.ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  }
  press() {
    if (!this.active || this.locked) return;
    this.drawing = true;
    this.fullTime = 0;
    this.bow.userData.nocked.visible = true;
  }
  release() {
    if (!this.drawing) return;
    this.drawing = false;
    const d = this.draw;
    if (d < 0.18) { this.bow.userData.nocked.visible = false; return; }
    this.fire(d);
  }

  /* ---------- core simulation ---------- */
  computePose(t) {
    const g = this.gcam;
    g.aspect = innerWidth / innerHeight;
    g.fov = innerWidth / innerHeight < 0.8 ? 68 : 55;
    this.pose.fov = g.fov - this.draw * 7 - this.charge * 4;
    g.fov = this.pose.fov;
    g.updateProjectionMatrix();
    const camPos = this.pose.camPos.set(0, 1.6, 10);
    const tgt = this.pose.camTarget.set(0, 10, -75);
    tgt.x += (this.aimSmooth.x - tgt.x) * 0.1;
    tgt.y += (this.aimSmooth.y - tgt.y) * 0.1;
    g.position.copy(camPos); g.lookAt(tgt); g.updateMatrixWorld();

    this.ray.setFromCamera(this.ndc, g);
    this.ray.ray.intersectPlane(this.plane, this.aim);
    this.aimSmooth.lerp(this.aim, 0.35);

    // the bow is held in camera space, low and slightly right
    const portrait = innerWidth / innerHeight < 0.8;
    this.pose.bowPos.set(portrait ? 0.45 : 1.05, -1.2 - this.draw * 0.05, -3.6 + this.draw * 0.3);
    g.localToWorld(this.pose.bowPos);
    // fatigue sway after holding full draw too long
    const fat = Math.max(0, Math.min(1, (this.fullTime - 3.2) / 3));
    const aim = this._v.copy(this.aimSmooth);
    if (fat > 0) { aim.x += Math.sin(t * 7.3) * fat * 3.5; aim.y += Math.cos(t * 5.1) * fat * 2.5; }
    this._m.lookAt(aim, this.pose.bowPos, UP);
    this.pose.bowQuat.setFromRotationMatrix(this._m).multiply(this.qCant).multiply(this.qBase);
    return this.pose;
  }

  nockWorld(out) { return this.bow.localToWorld(out.set(TIP_X - this.draw * 1.35 + 2.4, 0, 0)); }
  arrowDir(out) {
    const a = this.bow.localToWorld(new THREE.Vector3(0, 0, 0));
    const b = this.bow.localToWorld(new THREE.Vector3(1, 0, 0));
    return out.subVectors(b, a).normalize();
  }
  speedFor(d) { return 24 + 112 * Math.pow(d, 1.4); }

  fire(d) {
    const nova = this.charge >= 1;
    const mesh = createArrowMesh();
    mesh.scale.setScalar(this.bow.scale.x * (nova ? 1.6 : 1));
    const start = this.bow.localToWorld(new THREE.Vector3(TIP_X - d * 1.35, 0, 0));
    const dir = this.arrowDir(new THREE.Vector3());
    const vel = dir.clone().multiplyScalar(this.speedFor(d) * (nova ? 1.25 : 1));
    mesh.position.copy(start);
    if (nova) mesh.userData.materials.forEach((m) => m.color.multiplyScalar(1.8));
    this.scene.add(mesh);
    const trail = new GlowLine(24, { color: nova ? 0xffc27a : 0x6fd6ff, px: nova ? 6 : 3, intensity: 2, fade: 1.6, taper: 0 });
    this.scene.add(trail);
    const hist = Array.from({ length: 24 }, () => start.clone());
    const perfect = d >= 0.999 && this.fullTime < 0.4;
    this.arrows.push({ mesh, pos: start.clone(), prev: start.clone(), vel, age: 0, nova, perfect, trail, hist, hitAny: false, dead: false });
    this.shots++;
    this.bow.userData.nocked.visible = false;
    this.audio.release(d, nova);
    this.shake = 0.12 * d + (nova ? 0.5 : 0);
    if (nova) { this.energy = 0; this.flash = 0.35; this.charge = 0; }
    if (perfect) this.popupWorld(this.aimSmooth, 'Perfecto', 'perfect');
    // release impulse on the verlet string: the string overshoots and sings
    this.bow.userData.string.pinnedMid = null;
    this.draw = 0;
    this.fullTime = 0;
  }

  update(t, dt) {
    // draw curve: fast at first, heavier towards full draw
    if (this.active && this.drawing) {
      this.draw = Math.min(1, this.draw + dt * 1.9 * (1 - 0.6 * this.draw));
      if (this.draw > 0.985) this.draw = 1;
      if (this.draw >= 1) this.fullTime += dt;
      if (this.energy >= 1 && this.fullTime > 0.9) {
        const was = this.charge;
        this.charge = Math.min(1, this.charge + dt * 1.1);
        if (this.charge < 1) this.particles.converge(this.nockWorld(new THREE.Vector3()), 6, 1.6, new THREE.Color(1.8, 1.3, 0.6), 0.7, 0.14);
        if (was < 1 && this.charge >= 1) { this.audio.bell(1320, 0.12, 2); this.popupWorld(this.aimSmooth, 'Nova', 'nova'); }
      }
    } else if (!this.drawing) {
      this.draw = Math.max(0, this.draw - dt * 6);
      this.charge = Math.max(0, this.charge - dt * 3);
    }
    this.audio.setTension(this.drawing ? this.draw : 0, this.charge);

    // wind
    const W = this.active ? this.current.def.wind : 0;
    this.windValue = W * (Math.sin(t * 0.33) * 0.7 + Math.sin(t * 1.1 + 2) * 0.3);

    // constellations
    for (const c of this.constellations) c.update(t, dt, this.camera, this.active);
    this.updateArrows(t, dt);
    this.updateComets(t, dt);
    this.updatePreview(t);
    this.updateFx(dt);
    if (this.active) this.updateHud(dt);
  }

  updatePreview(t) {
    const show = this.active && this.drawing && this.draw > 0.12;
    this.preview.visible = show;
    if (!show) return;
    const p = this.bow.localToWorld(new THREE.Vector3(TIP_X - this.draw * 1.35, 0, 0));
    const v = this.arrowDir(new THREE.Vector3()).multiplyScalar(this.speedFor(this.draw));
    const pts = [];
    const h = 0.035;
    for (let i = 0; i < 44; i++) {
      pts.push(p.clone());
      v.y -= GRAV * h; v.x += this.windValue * h;
      p.addScaledVector(v, h);
    }
    this.preview.setPoints(pts);
    const u = this.preview.material.uniforms;
    u.uProgress.value = [0.9, 0.55, 0.32][this.level] ?? 0.4;
    u.uOpacity.value = 0.35 + this.draw * 0.5;
    u.uTime.value = t;
  }

  updateArrows(t, dt) {
    const seg = new THREE.Vector3(), toC = new THREE.Vector3(), closest = new THREE.Vector3();
    for (const a of this.arrows) {
      if (a.dead) continue;
      a.age += dt;
      a.prev.copy(a.pos);
      a.vel.y -= GRAV * dt;
      a.vel.x += this.windValue * dt;
      a.pos.addScaledVector(a.vel, dt);
      a.mesh.position.copy(a.pos);
      a.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), this._v.copy(a.vel).normalize());
      a.hist.pop(); a.hist.unshift(a.pos.clone());
      a.trail.setPoints([...a.hist].reverse());
      // sparks along the path
      const col = a.nova ? new THREE.Color(2, 1.3, 0.5) : new THREE.Color(0.4, 1.1, 2.2);
      for (let i = 0; i < (a.nova ? 6 : 2); i++) {
        const p = seg.lerpVectors(a.prev, a.pos, Math.random());
        this.particles.emit(p, new THREE.Vector3().randomDirection().multiplyScalar(a.nova ? 2.5 : 0.8), col, 0.6 + Math.random() * 0.5, a.nova ? 0.5 : 0.25, 0.1, 2);
      }
      // swept-sphere collision against every live target (prevents tunnelling at 130 u/s)
      const targets = this.liveTargets();
      for (const s of targets) {
        seg.subVectors(a.pos, a.prev);
        const len2 = seg.lengthSq() || 1e-6;
        const k = THREE.MathUtils.clamp(toC.subVectors(s.pos, a.prev).dot(seg) / len2, 0, 1);
        closest.copy(a.prev).addScaledVector(seg, k);
        const r = s.radius * (a.nova ? 1.9 : 1);
        if (closest.distanceTo(s.pos) < r) {
          this.hitStar(s, a, closest);
          if (!a.nova) { this.killArrow(a); break; }
        }
      }
      if (!a.dead && (a.age > 4 || a.pos.y < -40 || a.pos.z < -180)) {
        if (!a.hitAny) this.miss(a);
        this.killArrow(a);
      }
    }
    this.arrows = this.arrows.filter((a) => !a.dead || a.fade > 0);
    for (const a of this.arrows) if (a.dead) {
      a.fade -= dt * 2.5;
      a.trail.material.uniforms.uOpacity.value = Math.max(0, a.fade);
      if (a.fade <= 0) { this.scene.remove(a.trail); a.trail.geometry.dispose(); a.trail.material.dispose(); }
    }
  }

  liveTargets() {
    const out = [];
    if (this.active) {
      for (const s of this.current.stars) if (s.state === 'active') out.push(s);
      for (const c of this.comets) if (!c.hit) out.push(c.star);
    }
    return out;
  }

  killArrow(a, instant = false) {
    a.dead = true;
    a.fade = instant ? 0 : 1;
    this.scene.remove(a.mesh);
    if (instant) this.scene.remove(a.trail);
  }

  hitStar(s, a, at) {
    const comet = this.comets.find((c) => c.star === s);
    a.hitAny = true;
    this.hits++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    let pts = Math.round(100 * (1 + (this.combo - 1) * 0.5));
    if (a.perfect) pts *= 2;
    if (a.nova) pts *= 3;
    if (comet) { comet.hit = true; pts += 500; this.energy = 1; }
    else { s.state = 'lit'; s.flash = 1; this.energy = Math.min(1, this.energy + 0.25); }
    this.score += pts;
    this.audio.hit(this.combo - 1);
    const gold = new THREE.Color(1.6, 1.2, 0.6);
    this.particles.burst(s.pos, a.nova ? 380 : 180, { speed: a.nova ? 22 : 13, color: comet ? new THREE.Color(1.6, 0.6, 1.8) : gold, life: 1.5, size: 0.9, grav: 0.3, drag: 1.6, spread: 0.6 });
    this.particles.burst(s.pos, 80, { speed: 4, color: new THREE.Color(0.6, 1.4, 2.5), life: 2.2, size: 0.8, grav: -0.2, drag: 1 });
    this.shockAt(s.pos, a.nova ? 1.3 : 0.8);
    this.shake = Math.max(this.shake, a.nova ? 0.6 : 0.2);
    this.popupWorld(s.pos, `+${pts}`, a.nova ? 'nova' : 'score');
    if (this.combo > 1) this.popupWorld(s.pos, `Combo ×${this.combo}`, 'combo', 1);
    // Nova detonation: chain-hit everything nearby
    if (a.nova) {
      for (const o of this.liveTargets()) if (o !== s && o.pos.distanceTo(at) < 9) this.hitStar(o, { ...a, nova: false, perfect: false }, o.pos);
    }
    this.renderDots();
    if (!comet && this.current.remaining === 0 && !this.current.completed) this.completeLevel();
  }

  miss(a) {
    if (this.combo > 1) this.popupWorld(a.pos, 'Combo roto', 'miss');
    this.combo = 0;
    this.audio.miss();
  }

  completeLevel() {
    const c = this.current;
    c.completed = true;
    this.score += 1000;
    this.audio.complete();
    this.flash = 0.5;
    const center = new THREE.Vector3();
    c.stars.forEach((s) => center.add(s.pos));
    center.divideScalar(c.stars.length);
    this.particles.burst(center, 520, { speed: 28, color: new THREE.Color(1.1, 0.95, 0.7), life: 2.4, size: 0.8, grav: 0.15, drag: 1.1, spread: 4 });
    this.shockAt(center, 1.6);
    this.banner(`<small>+1000 · Plaga eliminada</small>${c.def.name}<em>zona libre de plagas</em>`);
    this.locked = true;
    setTimeout(() => {
      this.locked = false;
      if (!this.active) return;
      if (this.level < this.constellations.length - 1) this.startLevel(this.level + 1);
      else this.victory();
    }, 3200);
  }

  victory() {
    const acc = this.shots ? this.hits / this.shots : 0;
    const rank = acc >= 0.85 ? ['S', 'Exterminador de Élite'] : acc >= 0.65 ? ['A', 'Técnico Certificado'] : acc >= 0.45 ? ['B', 'Fumigador en Formación'] : ['C', 'Aprendiz de Fumigador'];
    $('v-rank').textContent = rank[0];
    $('v-title').textContent = rank[1];
    $('v-score').textContent = this.score.toLocaleString('es');
    $('v-acc').textContent = Math.round(acc * 100) + '%';
    $('v-combo').textContent = '×' + this.maxCombo;
    $('v-shots').textContent = this.shots;
    this.hud.victory.classList.add('show');
    this.audio.complete();
    this.locked = true;
    setTimeout(() => (this.locked = false), 600);
  }

  updateComets(t, dt) {
    if (!this.active || this.level < 1) return;
    this.cometTimer -= dt;
    if (this.cometTimer <= 0 && this.comets.length < 2) {
      this.cometTimer = 7 + Math.random() * 4;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const star = new Star(new THREE.Vector3(-dir * 60, 6 + Math.random() * 16, -62));
      star.state = 'active';
      star.radius = 1.7;
      this.scene.add(star.group);
      this.comets.push({ star, dir, speed: 11 + this.level * 4, hit: false, t: 0 });
    }
    for (const c of this.comets) {
      c.t += dt;
      const s = c.star;
      s.base.x += c.dir * c.speed * dt;
      s.base.y += Math.sin(c.t * 2) * dt * 2;
      s.update(t, dt, this.camera, 1, 0);
      s.coreMat.color.setRGB(2.2, 0.8, 2.4);
      s.halo.material.color.setRGB(1, 0.5, 1);
      this.particles.emit(s.pos, new THREE.Vector3(-c.dir * 6, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2), new THREE.Color(1.6, 0.6, 2), 1.2, 0.9, 0, 1.5);
      if (c.hit || Math.abs(s.base.x) > 65) { this.scene.remove(s.group); c.gone = true; }
    }
    this.comets = this.comets.filter((c) => !c.gone);
  }

  shockAt(p, strength) {
    const v = p.clone().project(this.camera);
    this.shock = { x: v.x * 0.5 + 0.5, y: v.y * 0.5 + 0.5, t: 0, s: strength };
  }

  updateFx(dt) {
    const L = this.post.lens.uniforms;
    if (this.shock) {
      this.shock.t += dt;
      const k = this.shock.t / 1.1;
      L.uShock.value.set(this.shock.x, this.shock.y, k * 1.2, Math.max(0, (1 - k)) * this.shock.s);
      if (k >= 1) { this.shock = null; L.uShock.value.w = 0; }
    }
    this.flash = Math.max(0, this.flash - dt * 1.2);
    L.uFlash.value = this.flash;
    L.uAberration.value = 0.0015 + this.draw * 0.004 + this.charge * 0.006;
    this.shake = Math.max(0, this.shake - dt * 1.8);
  }

  /* ---------- HUD ---------- */
  renderDots() {
    const c = this.current;
    this.hud.dots.innerHTML = c.stars.map((s) => `<i class="${s.state === 'lit' ? 'on' : ''}"></i>`).join('');
  }
  updateHud(dt) {
    this.shownScore += (this.score - this.shownScore) * Math.min(1, dt * 8);
    this.hud.score.textContent = Math.round(this.shownScore).toLocaleString('es');
    this.hud.combo.textContent = '×' + Math.max(1, this.combo);
    this.hud.combo.parentElement.classList.toggle('hot', this.combo >= 3);
    const w = this.windValue;
    this.hud.wind.textContent = Math.abs(w).toFixed(1);
    this.hud.windArrow.style.transform = `scaleX(${w < 0 ? -1 : 1})`;
    this.hud.windArrow.style.opacity = Math.abs(w) < 0.05 ? 0.25 : 1;
    this.hud.energy.style.setProperty('--e', this.energy);
    this.hud.energy.classList.toggle('full', this.energy >= 1);
    this.hud.energyLabel.textContent = this.energy >= 1 ? (this.charge >= 1 ? 'Nova cargada · suelta' : 'Nova lista · mantén la tensión') : 'Energía de precisión';
    const r = this.hud.reticle;
    r.style.setProperty('--d', this.draw);
    r.style.setProperty('--c', this.charge);
    r.classList.toggle('full', this.draw >= 1);
  }
  banner(html) {
    const b = this.hud.banner;
    b.innerHTML = html;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }
  popupWorld(p, text, kind, row = 0) {
    const v = p.clone().project(this.camera);
    const el = document.createElement('div');
    el.className = 'pop ' + kind;
    el.textContent = text;
    el.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
    el.style.top = ((-v.y * 0.5 + 0.5) * innerHeight + row * 34) + 'px';
    this.hud.popups.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}
