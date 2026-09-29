import * as THREE from 'three';
import { createNebulaMaterial, createStars, createMoon, createClouds, MOON_POS } from './world/sky.js';
import { createBow, createRibbons, createShards } from './world/bow.js';
import { Particles } from './world/particles.js';
import { GlowLine } from './world/glowline.js';
import { createPost } from './post.js';
import { Audio } from './audio.js';
import { Ritual } from './game/ritual.js';
import { initUI } from './ui/ui.js';

const $ = (s) => document.querySelector(s);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => x * x * (3 - 2 * x);
const MOON_GAME = new THREE.Vector3(58, 42, -120);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const loader = {
  bar: $('#loader-bar'), pct: $('#loader-pct'), msg: $('#loader-msg'), v: 0,
  async set(v, msg) {
    this.v = v;
    this.bar.style.transform = `scaleX(${v})`;
    this.pct.textContent = String(Math.round(v * 100)).padStart(3, '0');
    if (msg) this.msg.textContent = msg;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  },
};

async function boot() {
  await loader.set(0.05, 'Despertando el vacío…');

  /* ---------- renderer ---------- */
  const canvas = $('#scene');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (e) {
    document.body.classList.add('no-webgl');
    loader.msg.textContent = 'Tu navegador no soporta WebGL.';
    return;
  }
  const PR_STEPS = [Math.min(devicePixelRatio, 1.75), 1.25, 1, 0.8];
  let prIndex = 0;
  renderer.setPixelRatio(PR_STEPS[0]);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020616, 0.0035);
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(0, 2, 40);

  await loader.set(0.15, 'Tejiendo la nebulosa…');
  // The nebula is expensive (15 noise taps per pixel) and nearly static,
  // so it is baked once into a cubemap and used as the scene background.
  const nebulaMat = createNebulaMaterial();
  const skyScene = new THREE.Scene();
  skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), nebulaMat));
  const skyRT = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  new THREE.CubeCamera(0.1, 100, skyRT).update(renderer, skyScene);
  scene.background = skyRT.texture;
  const stars = createStars(reduced ? 3000 : 7000);
  scene.add(stars);

  await loader.set(0.3, 'Alzando la luna…');
  const moon = createMoon();
  scene.add(moon);
  const clouds = createClouds();
  scene.add(clouds);

  // Environment map for reflections, rendered from a miniature copy of the sky
  await loader.set(0.42, 'Reflejando el firmamento…');
  const envScene = new THREE.Scene();
  const envSkyMat = createNebulaMaterial();
  envSkyMat.uniforms.uIntensity.value = 3.2;
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), envSkyMat));
  const envMoon = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 5, 7) }));
  envMoon.position.copy(MOON_POS).normalize().multiplyScalar(40);
  envScene.add(envMoon);
  const envPanel = new THREE.Mesh(new THREE.PlaneGeometry(40, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.2, 3), side: THREE.DoubleSide }));
  envPanel.position.set(-30, 18, 10); envPanel.lookAt(0, 0, 0);
  envScene.add(envPanel);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(envScene, 0.035).texture;
  pmrem.dispose();

  await loader.set(0.55, 'Forjando el arco…');
  scene.add(new THREE.AmbientLight(0x243a7a, 0.7));
  const moonLight = new THREE.DirectionalLight(0xc8dcff, 2.6);
  moonLight.position.copy(MOON_POS);
  scene.add(moonLight);
  const rim = new THREE.DirectionalLight(0x3d7bff, 2.2);
  rim.position.set(-8, 3, -6);
  scene.add(rim);
  const key = new THREE.DirectionalLight(0x9fdcff, 1.2);
  key.position.set(-4, 2, 8);
  scene.add(key);
  const warm = new THREE.DirectionalLight(0xffc98a, 1.6); // candle-warm fill so the gold reads as gold
  warm.position.set(5, -3, 7);
  scene.add(warm);

  const bow = createBow(envTex);
  scene.add(bow);
  const ribbons = createRibbons();
  bow.add(ribbons);
  const shards = createShards(reduced ? 120 : 260);
  scene.add(shards);
  const particles = new Particles(18000);
  scene.add(particles);

  await loader.set(0.68, 'Encendiendo el resplandor…');
  const post = createPost(renderer, scene, camera);
  const audio = new Audio();
  const ritual = new Ritual({ scene, camera, bow, particles, audio, post });

  await loader.set(0.8, 'Compilando runas (shaders)…');
  try { await renderer.compileAsync(scene, camera); } catch { renderer.compile(scene, camera); }
  await loader.set(0.93, 'Afinando el hilo estelar…');
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]); } catch {}
  await loader.set(1, 'Selene te espera.');
  document.body.classList.add('loaded');

  /* ---------- sizing ---------- */
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h);
    post.composer.setSize(w, h);
    post.composer.setPixelRatio(renderer.getPixelRatio());
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    GlowLine.res.value.set(w, h);
    post.lens.uniforms.uAspect.value = w / h;
    stars.material.uniforms.uPR.value = renderer.getPixelRatio();
    particles.material.uniforms.uPR.value = renderer.getPixelRatio();
    particles.material.uniforms.uScale.value = h * 0.5;
    ui.measure();
  };

  /* ---------- UI / state ---------- */
  const state = { entered: false, intro: 0, gameBlend: 0, gameTarget: 0, pointer: new THREE.Vector2(innerWidth / 2, innerHeight / 2), lastPointer: new THREE.Vector2(innerWidth / 2, innerHeight / 2), mouse: new THREE.Vector2() };
  const ui = initUI({
    audio,
    onEnter(withSound) {
      state.entered = true;
      audio.setEnabled(withSound);
      // the bow ignites: particles converge onto it
      particles.converge(new THREE.Vector3(0, 0, 0), 900, 7, new THREE.Color(0.5, 1.2, 2.4), 1.4, 0.35);
      setTimeout(() => particles.burst(new THREE.Vector3(0.2, 0, 0), 500, { speed: 16, size: 0.7, life: 1.8 }), 1300);
      setTimeout(() => audio.pluck(98, 0.5), 1300);
    },
    onRitual(on) {
      state.gameTarget = on ? 1 : 0;
      if (on) ritual.start(); else ritual.stop();
    },
    onRestart() { ritual.start(); },
  });
  addEventListener('resize', resize);
  resize();
  // chapter offsets change when web fonts land or content reflows
  new ResizeObserver(() => ui.measure()).observe(document.getElementById('content'));

  /* ---------- pointer ---------- */
  addEventListener('pointermove', (e) => {
    state.pointer.set(e.clientX, e.clientY);
    state.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ritual.pointer(e.clientX, e.clientY);
  }, { passive: true });
  const layer = $('#game-layer');
  layer.addEventListener('pointerdown', (e) => { ritual.pointer(e.clientX, e.clientY); layer.setPointerCapture?.(e.pointerId); ritual.press(); });
  layer.addEventListener('pointerup', () => ritual.release());
  layer.addEventListener('pointercancel', () => ritual.release());
  addEventListener('keydown', (e) => {
    if (!ritual.active) return;
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); ritual.press(); }
  });
  addEventListener('keyup', (e) => { if (ritual.active && e.code === 'Space') ritual.release(); });

  /* ---------- camera choreography (one keyframe per chapter) ---------- */
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const KEYS = [
    { pos: V(0, 0.2, 10.5), tgt: V(-2.6, 0.1, 0), rot: -0.25 }, // hero: bow right
    { pos: V(-1.5, 0.8, 8.5), tgt: V(2.4, 0.4, 0), rot: 0.85 }, // origen: bow left
    { pos: V(1.2, 2.3, 3.9), tgt: V(-1.1, 1.8, 0), rot: -0.55 }, // forja: upper limb close-up
    { pos: V(-5.2, 0.2, 2.6), tgt: V(-0.2, 0.1, 1.8), rot: 0.35 }, // hilo: along the string
    { pos: V(0, -2.2, 12), tgt: V(0, 9, -70), rot: 0.2 }, // cielo: look at the constellations
    { pos: V(0, 0.4, 12.5), tgt: V(0, 0.4, 0), rot: 0 }, // ritual
  ];
  const portraitAdjust = (k, out) => {
    const a = innerWidth / innerHeight;
    if (a >= 1) return out;
    const f = clamp01((1 - a) / 0.5);
    out.pos.z *= 1 + f * 0.45;
    out.pos.x *= 1 - f * 0.6;
    out.tgt.x *= 1 - f;
    return out;
  };
  const cur = { pos: V(0, 2, 40), tgt: V(0, 0, 0), rot: 0 };
  const tmpK = { pos: V(0, 0, 0), tgt: V(0, 0, 0), rot: 0 };
  let scrollF = 0;

  const sampleKey = (f) => {
    const i = Math.max(0, Math.min(KEYS.length - 1, Math.floor(f)));
    const j = Math.min(KEYS.length - 1, i + 1);
    const k = ease(clamp01(f - i));
    tmpK.pos.lerpVectors(KEYS[i].pos, KEYS[j].pos, k);
    tmpK.tgt.lerpVectors(KEYS[i].tgt, KEYS[j].tgt, k);
    tmpK.rot = THREE.MathUtils.lerp(KEYS[i].rot, KEYS[j].rot, k);
    return portraitAdjust(k, tmpK);
  };

  /* ---------- harp: pointer crossing the string plucks it ---------- */
  const strScreen = Array.from({ length: 34 }, () => new THREE.Vector2());
  const tmp3 = new THREE.Vector3();
  let harpCooldown = 0;
  const segCross = (a, b, c, d) => {
    const r = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
    if (Math.abs(r) < 1e-6) return false;
    const u = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / r;
    const v = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / r;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  };
  const harp = (dt) => {
    harpCooldown -= dt;
    const a = state.lastPointer, b = state.pointer;
    const moved = a.distanceTo(b);
    if (moved < 1 || ritual.active || state.gameBlend > 0.05 || harpCooldown > 0) return;
    const S = bow.userData.string;
    for (let i = 0; i < S.n; i++) {
      tmp3.copy(S.p[i]);
      bow.localToWorld(tmp3).project(camera);
      strScreen[i].set((tmp3.x * 0.5 + 0.5) * innerWidth, (-tmp3.y * 0.5 + 0.5) * innerHeight);
    }
    for (let i = 0; i < S.n - 1; i++) {
      if (segCross(a, b, strScreen[i], strScreen[i + 1])) {
        const dir = new THREE.Vector3((b.x - a.x), -(b.y - a.y), 0).normalize();
        // screen direction -> camera basis -> bow local
        const w = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(dir.x)
          .add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(dir.y));
        const q = bow.getWorldQuaternion(new THREE.Quaternion()).invert();
        w.applyQuaternion(q).multiplyScalar(Math.min(0.12, 0.02 + moved * 0.002));
        S.impulse(i, w);
        audio.harp(i / (S.n - 1));
        const wp = bow.localToWorld(S.p[i].clone());
        particles.burst(wp, 24, { speed: 3, size: 0.25, life: 0.9, grav: 0.2 });
        harpCooldown = 0.07;
        break;
      }
    }
  };

  /* ---------- adaptive quality ---------- */
  let perfAcc = 0, perfN = 0;
  const adapt = (dt) => {
    perfAcc += dt; perfN++;
    if (perfN >= 90) {
      const avg = perfAcc / perfN;
      if (avg > 1 / 40 && prIndex < PR_STEPS.length - 1) {
        prIndex++;
        renderer.setPixelRatio(PR_STEPS[prIndex]);
        resize();
      }
      perfAcc = 0; perfN = 0;
    }
  };

  /* ---------- main loop ---------- */
  const clock = new THREE.Timer();
  const qShow = new THREE.Quaternion(), eul = new THREE.Euler();
  const showPos = new THREE.Vector3();
  const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
  const smoothMouse = new THREE.Vector2();
  let t = 0;

  const frame = () => {
    clock.update();
    const dt = Math.min(clock.getDelta(), 1 / 20);
    t += dt;
    if (state.entered) state.intro = Math.min(1, state.intro + dt / 3.2);
    const introK = 1 - Math.pow(1 - state.intro, 3);

    // scroll -> chapter index
    scrollF += (ui.chapterF() - scrollF) * Math.min(1, dt * 4);
    const k = sampleKey(scrollF);
    smoothMouse.lerp(state.mouse, Math.min(1, dt * 3));

    // game blend
    state.gameBlend += (state.gameTarget - state.gameBlend) * Math.min(1, dt * 2.2);
    const gb = ease(clamp01(state.gameBlend));

    // showcase pose
    showPos.set(0, Math.sin(t * 0.8) * 0.08, 0);
    eul.set(smoothMouse.y * -0.06, k.rot + Math.sin(t * 0.25) * 0.18 + smoothMouse.x * 0.15, Math.sin(t * 0.5) * 0.02);
    qShow.setFromEuler(eul);

    // game pose (computed from a virtual camera so there's no feedback loop)
    const gp = ritual.computePose(t);

    bow.position.lerpVectors(showPos, gp.bowPos, gb);
    bow.quaternion.slerpQuaternions(qShow, gp.bowQuat, gb);
    bow.scale.setScalar(THREE.MathUtils.lerp(1, 0.3, gb));
    bow.updateMatrixWorld(true);

    // camera
    camPos.copy(k.pos).add(new THREE.Vector3(smoothMouse.x * 0.35, smoothMouse.y * 0.22, 0));
    camTgt.copy(k.tgt);
    const far = new THREE.Vector3(0, 6, 46);
    camPos.lerp(far, 1 - introK);
    camPos.lerp(gp.camPos, gb);
    camTgt.lerp(gp.camTarget, gb);
    camera.position.copy(camPos);
    if (ritual.shake > 0) camera.position.add(new THREE.Vector3().randomDirection().multiplyScalar(ritual.shake * 0.15));
    camera.lookAt(camTgt);
    camera.fov = THREE.MathUtils.lerp(42, gp.fov, gb);
    camera.updateProjectionMatrix();

    // world
    stars.material.uniforms.uTime.value = t;
    stars.rotation.y = t * 0.003;
    moon.rotation.y = t * 0.01;
    moon.position.lerpVectors(MOON_POS, MOON_GAME, gb); // out of the archer's sightline
    clouds.update(t);
    ribbons.update(t);
    ribbons.userData.mat.uniforms.uOpacity.value = (0.5 + introK * 0.5) * (1 - gb * 0.75);
    shards.update(t);
    bow.updateBow(t, dt, ritual.draw, ritual.charge);
    ritual.update(t, dt);
    particles.update(t);

    // ambient motes rising around the bow
    if (!reduced && Math.random() < 0.9) {
      const p = new THREE.Vector3((Math.random() - 0.5) * 7, -4 + Math.random() * 3, (Math.random() - 0.5) * 5);
      if (gb > 0.5) p.applyMatrix4(bow.matrixWorld);
      particles.emit(p, new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.8, 0), new THREE.Color(0.3, 0.8, 1.8), 5 + Math.random() * 3, 0.12 + Math.random() * 0.12, -0.02, 0.2);
    }
    harp(dt);
    state.lastPointer.copy(state.pointer);

    post.bloom.strength = 0.55 + ritual.draw * 0.2 + ritual.charge * 0.5 + (1 - introK) * 0.4;
    post.lens.uniforms.uTime.value = t;
    post.composer.render(dt);
    ui.tick(dt, t, ritual);
    adapt(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__selene = { scene, camera, ritual, bow, renderer, state, post, get t() { return t; },
    snap() { state.intro = 1; scrollF = ui.chapterF(); state.gameBlend = state.gameTarget; } };
}

boot();
