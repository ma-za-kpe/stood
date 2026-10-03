// Stood landing page: tiny, dependency-free interactions.
// The "Try the gate" demo mirrors the decision rule in docs/tech/T03-domain-model.md:
// any hard failure → Refused (named field); any uncertainty → In review; all pass → Released.
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ICONS = {
    volt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    flare: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  };
  const chip = (tone, label) => `<span class="chip chip--${tone}">${ICONS[tone]}${label}</span>`;

  // Fixture scenarios: synthetic, illustrative only.
  const SCENARIOS = {
    good: {
      checks: {
        plot: ['ok', '8 m from pin'],
        fresh: ['ok', 'no match'],
        code: ['ok', 'read'],
        stage: ['ok', 'foundation'],
      },
      tone: 'volt',
      label: 'Released',
      sentence: 'Foundation released. £4,000 paid. Kojo stood on the plot at 10:42.',
      money: 'PayPal · CAPTURED · £4,000',
    },
    plot: {
      checks: {
        plot: ['bad', '1.4 km off'],
        fresh: ['run', 'skipped'],
        code: ['run', 'skipped'],
        stage: ['run', 'skipped'],
      },
      tone: 'flare',
      label: 'Refused',
      sentence: 'Wrong plot. 1.4 km off. Nothing was paid.',
      money: 'PayPal · VOIDED · £0 moved',
    },
    reused: {
      checks: {
        plot: ['ok', '11 m from pin'],
        fresh: ['bad', 'matches 12 March'],
        code: ['run', 'skipped'],
        stage: ['run', 'skipped'],
      },
      tone: 'flare',
      label: 'Refused',
      sentence: 'Old photos. These match the photos from 12 March. Nothing was paid.',
      money: 'PayPal · VOIDED · £0 moved',
    },
    blurry: {
      checks: {
        plot: ['ok', '6 m from pin'],
        fresh: ['ok', 'no match'],
        code: ['unsure', 'can’t read'],
        stage: ['ok', 'foundation'],
      },
      tone: 'sun',
      label: 'In review',
      sentence: 'A person is checking these photos. £4,000 is still held, not paid.',
      money: 'PayPal · AUTHORIZED · held',
    },
  };

  const picks = document.querySelectorAll('.pick');
  const rows = document.querySelectorAll('#live-checks li');
  const result = document.getElementById('result');
  let timer = [];

  const setRow = (li, cls, text) => {
    const b = li.querySelector('b');
    b.className = cls;
    b.textContent = text;
  };

  const run = (key) => {
    const sc = SCENARIOS[key];
    timer.forEach(clearTimeout);
    timer = [];
    for (const p of picks) p.setAttribute('aria-pressed', String(p.dataset.scenario === key));
    for (const li of rows) setRow(li, 'run', 'checking…');
    result.innerHTML = `${chip('sun', 'Checking')}<p class="result__sentence">£4,000 is held, not paid.</p><p class="result__money mono">PayPal · AUTHORIZED</p>`;
    const step = reduce ? 0 : 380;
    rows.forEach((li, i) => {
      timer.push(
        setTimeout(
          () => {
            const [cls, text] = sc.checks[li.dataset.k];
            setRow(li, cls, text);
          },
          step * (i + 1),
        ),
      );
    });
    timer.push(
      setTimeout(
        () => {
          result.innerHTML = `${chip(sc.tone, sc.label)}<p class="result__sentence">${sc.sentence}</p><p class="result__money mono">${sc.money}</p>`;
        },
        step * (rows.length + 1),
      ),
    );
  };

  for (const p of picks) p.addEventListener('click', () => run(p.dataset.scenario));

  // Hero card: cycle In review → Released → Refused.
  const card = document.querySelector('[data-cycle]');
  const money = document.querySelector('[data-money]');
  const states = [
    { html: chip('sun', 'In review'), s: '£4,000 is held, not paid.', m: 'AUTHORIZED · £4,000' },
    { html: chip('volt', 'Released'), s: 'Foundation released. £4,000 paid.', m: 'CAPTURED · £4,000' },
    { html: chip('flare', 'Refused'), s: 'Wrong plot. 1.4 km off. Nothing was paid.', m: 'VOIDED · £0 moved' },
  ];
  if (card && !reduce) {
    let i = 0;
    setInterval(() => {
      i = (i + 1) % states.length;
      card.innerHTML = `${states[i].html}<p class="decision__sentence">${states[i].s}</p>`;
      money.textContent = states[i].m;
    }, 3200);
  }

  // ===== Motion layer =====
  const root = document.documentElement;
  // Intro plays once per session (and never with reduced motion)
  let seen = false;
  try {
    seen = sessionStorage.getItem('stood-intro') === '1';
    sessionStorage.setItem('stood-intro', '1');
  } catch {}
  if (seen || reduce) root.classList.add('no-intro');
  else setTimeout(() => document.getElementById('intro')?.remove(), 2200);
  // Failsafe: if animations stall (background tab, low power), settle everything visible.
  setTimeout(() => root.classList.add('settled'), seen || reduce ? 1500 : 3800);

  // Split the hero headline into rising words (keeps <em> intact)
  const h1 = document.querySelector('.hero .display');
  if (h1 && !reduce) {
    let i = 0;
    const wrap = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) {
              frag.append(part);
              return;
            }
            const w = document.createElement('span');
            w.className = 'w';
            const inner = document.createElement('span');
            inner.textContent = part;
            inner.style.setProperty('--i', i++);
            w.append(inner);
            frag.append(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) wrap(n);
      });
    };
    wrap(h1);
  }

  // Scroll reveals with stagger
  for (const g of document.querySelectorAll('.reveal-group')) {
    [...g.children].forEach((c, n) => {
      c.style.setProperty('--n', n);
    });
  }
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        e.target.querySelectorAll?.('[data-count]').forEach(countUp);
        if (e.target.matches('[data-count]')) countUp(e.target);
        io.unobserve(e.target);
      }),
    { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
  );
  for (const el of document.querySelectorAll('.reveal, .reveal-group')) io.observe(el);

  // Count-up numbers
  function countUp(el) {
    const end = Number(el.dataset.count);
    const t0 = performance.now();
    const dur = reduce ? 0 : 1400;
    const f = (t) => {
      const p = dur ? Math.min(1, (t - t0) / dur) : 1;
      el.textContent = Math.round(end * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }

  if (!reduce && matchMedia('(pointer: fine)').matches) {
    // Cursor spotlight
    const hero = document.querySelector('[data-spot]');
    hero?.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', `${e.clientX - r.left}px`);
      hero.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
    // 3D tilt
    document.querySelectorAll('[data-tilt]').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(900px) rotateY(${x * 14}deg) rotateX(${-y * 12}deg) translateY(-4px)`;
      });
      el.addEventListener('pointerleave', () => {
        el.style.transform = '';
      });
    });
    // Magnetic buttons
    document.querySelectorAll('[data-magnet]').forEach((b) => {
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.22}px, ${(e.clientY - r.top - r.height / 2) * 0.32}px)`;
      });
      b.addEventListener('pointerleave', () => {
        b.style.transform = '';
      });
    });
  }
})();
