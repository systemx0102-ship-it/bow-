const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ✦✧';

export function initUI({ audio, onEnter, onRitual, onRestart }) {
  const body = document.body;
  const chapters = $$('.chapter');
  let tops = [];
  let inRitual = false;
  let savedScroll = 0;

  /* ---------- split titles into glyphs ---------- */
  $$('.split').forEach((el) => {
    const text = el.textContent;
    el.setAttribute('aria-label', text);
    el.innerHTML = [...text].map((c, i) => `<span aria-hidden="true" style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
  });

  /* ---------- enter ---------- */
  const enter = (sound) => {
    if (body.classList.contains('entered')) return;
    body.classList.add('entered');
    syncSound(sound);
    onEnter(sound);
  };
  $('#enter-sound').addEventListener('click', () => enter(true));
  $('#enter-silent').addEventListener('click', () => enter(false));

  const soundBtn = $('#sound-toggle');
  const syncSound = (on) => {
    soundBtn.classList.toggle('on', on);
    soundBtn.setAttribute('aria-pressed', on);
    soundBtn.querySelector('span').textContent = on ? 'Sonido' : 'Silencio';
  };
  soundBtn.addEventListener('click', () => { const on = !audio.enabled; audio.setEnabled(on); syncSound(on); });

  /* ---------- reveal on scroll ---------- */
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); countUp(e.target); }
  }), { threshold: 0.2 });
  $$('[data-reveal]').forEach((el) => io.observe(el));

  function countUp(root) {
    $$('[data-count]', root).forEach((el) => {
      if (el.dataset.done) return;
      el.dataset.done = 1;
      const end = parseFloat(el.dataset.count);
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 1800);
        const e = 1 - Math.pow(1 - k, 4);
        el.textContent = Math.round(end * e).toLocaleString('es');
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /* ---------- rune scramble on hover ---------- */
  $$('[data-scramble]').forEach((el) => {
    const orig = el.textContent;
    let raf;
    el.addEventListener('mouseenter', () => {
      audio.tick();
      let f = 0;
      cancelAnimationFrame(raf);
      const run = () => {
        f++;
        el.textContent = [...orig].map((c, i) => (c === ' ' ? ' ' : i < f / 2 ? c : RUNES[(Math.random() * RUNES.length) | 0])).join('');
        if (f / 2 < orig.length) raf = requestAnimationFrame(run); else el.textContent = orig;
      };
      run();
    });
  });

  /* ---------- magnetic buttons ---------- */
  $$('.magnetic').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${x * 0.25}px, ${y * 0.35}px)`;
    });
    el.addEventListener('pointerleave', () => (el.style.transform = ''));
    el.addEventListener('mouseenter', () => audio.tick());
  });

  /* ---------- tilt cards ---------- */
  $$('.tilt').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--rx', `${-y * 10}deg`);
      el.style.setProperty('--ry', `${x * 12}deg`);
      el.style.setProperty('--mx', `${(x + 0.5) * 100}%`);
      el.style.setProperty('--my', `${(y + 0.5) * 100}%`);
    });
    el.addEventListener('pointerleave', () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
  });

  /* ---------- chapter rail ---------- */
  const rail = $('#rail');
  rail.innerHTML = chapters.map((c, i) => `<button data-i="${i}" aria-label="${c.dataset.title}"><b>${c.dataset.num}</b><span>${c.dataset.title}</span></button>`).join('');
  rail.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) chapters[+b.dataset.i].scrollIntoView({ behavior: 'smooth' });
  });
  const railBtns = $$('button', rail);

  /* ---------- inertial wheel scrolling ----------
   * The mouse wheel no longer jumps the page: each notch moves a target and the
   * page glides toward it, so chapter transitions feel slow and cinematic. */
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scroller = { target: scrollY, cur: scrollY, active: false };
  const maxScroll = () => document.documentElement.scrollHeight - innerHeight;
  addEventListener('wheel', (e) => {
    if (reducedMotion || inRitual || e.ctrlKey || !body.classList.contains('entered')) return;
    if (e.target.closest && e.target.closest('textarea, select')) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight : 1;
    if (!scroller.active) scroller.cur = scroller.target = scrollY;
    scroller.target = Math.max(0, Math.min(maxScroll(), scroller.target + e.deltaY * unit * 0.7));
    scroller.active = true;
  }, { passive: false });
  const stopGlide = () => { scroller.active = false; scroller.target = scroller.cur = scrollY; };
  addEventListener('keydown', stopGlide);
  addEventListener('touchstart', stopGlide, { passive: true });

  /* ---------- nav anchors ---------- */
  $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
    const t = $(a.getAttribute('href'));
    if (t) { e.preventDefault(); stopGlide(); t.scrollIntoView({ behavior: 'smooth' }); }
  }));

  /* ---------- quote form -> WhatsApp or e-mail ---------- */
  const form = $('#quote-form');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new FormData(form);
    const text = `Hola, quiero cotizar un servicio.\nNombre: ${d.get('nombre')}\nTeléfono: ${d.get('telefono')}\nServicio: ${d.get('servicio')}\nLugar: ${d.get('lugar')}\nDetalles: ${d.get('mensaje') || '-'}`;
    const wa = (form.dataset.whatsapp || '').replace(/\D/g, '');
    const mail = form.dataset.email || '';
    const note = $('#form-note');
    if (wa) window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    else if (mail) location.href = `mailto:${mail}?subject=${encodeURIComponent('Cotización de servicio')}&body=${encodeURIComponent(text)}`;
    else { note.textContent = 'Formulario de demostración: configura tu WhatsApp o correo en el atributo data-whatsapp / data-email del formulario.'; return; }
    note.textContent = '¡Gracias! Te contactaremos muy pronto.';
    audio.bell && audio.bell(880, 0.12, 1.8);
  });

  /* ---------- ritual mode ---------- */
  const startRitual = () => {
    if (inRitual) return;
    if (!body.classList.contains('entered')) enter(true);
    inRitual = true;
    savedScroll = scrollY;
    body.classList.add('in-ritual');
    onRitual(true);
  };
  const exitRitual = () => {
    if (!inRitual) return;
    inRitual = false;
    body.classList.remove('in-ritual');
    $('#victory').classList.remove('show');
    onRitual(false);
    requestAnimationFrame(() => scrollTo(0, savedScroll));
  };
  $$('[data-ritual]').forEach((b) => b.addEventListener('click', startRitual));
  $('#hud-exit').addEventListener('click', exitRitual);
  $('#v-exit').addEventListener('click', exitRitual);
  $('#v-again').addEventListener('click', () => { $('#victory').classList.remove('show'); onRestart(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') exitRitual(); });

  /* ---------- cursor ---------- */
  const cursor = $('#cursor');
  const reticle = $('#reticle');
  const P = { x: innerWidth / 2, y: innerHeight / 2 }, C = { ...P };
  addEventListener('pointermove', (e) => { P.x = e.clientX; P.y = e.clientY; body.classList.add('has-pointer'); }, { passive: true });
  document.addEventListener('pointerover', (e) => cursor.classList.toggle('hover', !!e.target.closest('a,button,.tilt,[data-ritual]')));

  return {
    measure() { tops = chapters.map((c) => c.getBoundingClientRect().top + scrollY); },
    chapterF() {
      if (!tops.length) return 0;
      const y = inRitual ? savedScroll : scrollY;
      for (let i = 0; i < tops.length - 1; i++) {
        if (y < tops[i + 1]) return i + Math.max(0, (y - tops[i]) / (tops[i + 1] - tops[i]));
      }
      return tops.length - 1;
    },
    tick(dt, t, ritual) {
      if (scroller.active) {
        scroller.cur += (scroller.target - scroller.cur) * Math.min(1, dt * 2.6);
        if (Math.abs(scroller.target - scroller.cur) < 0.5) { scroller.cur = scroller.target; scroller.active = false; }
        scrollTo(0, scroller.cur);
      }
      C.x += (P.x - C.x) * Math.min(1, dt * 18);
      C.y += (P.y - C.y) * Math.min(1, dt * 18);
      cursor.style.transform = `translate(${C.x}px, ${C.y}px)`;
      reticle.style.transform = `translate(${P.x}px, ${P.y}px)`;
      const f = this.chapterF();
      const idx = Math.round(f);
      railBtns.forEach((b, i) => b.classList.toggle('on', i === idx));
      body.style.setProperty('--scroll', f.toFixed(3));
    },
  };
}
