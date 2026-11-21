// Effets visuels : lumières d'ambiance, compteurs animés, confettis, survols liés, ondulation des boutons.
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ambient() {
  if (document.querySelector('.ambient')) return;
  const el = document.createElement('div');
  el.className = 'ambient';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i class="l1"></i><i class="l2"></i><i class="l3"></i>';
  document.body.prepend(el);
}

// Fait défiler un nombre de 0 à sa valeur : « 85 % », « < 50 », « 200 000 »
export function countUps(root) {
  root.querySelectorAll('[data-countup]:not([data-counted])').forEach((el, k) => {
    el.dataset.counted = '1';
    const m = el.textContent.match(/^(\D*)(\d(?:[\d\s ]*\d)?)(.*)$/);
    if (!m || reduced()) return;
    const target = Number(m[2].replace(/[\s ]/g, ''));
    const start = performance.now() + k * 90;
    const dur = 900;
    const frame = (now) => {
      const t = Math.min(1, Math.max(0, (now - start) / dur));
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = m[1] + Math.round(target * e).toLocaleString('fr-FR') + m[3];
      if (t < 1) requestAnimationFrame(frame);
    };
    el.textContent = m[1] + '0' + m[3];
    requestAnimationFrame(frame);
  });
}

// Petit rebond quand une valeur change
export function bump(el) {
  if (!el) return;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

// Confettis aux couleurs de l'atelier
export function confetti(amount = 140) {
  if (reduced()) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const colors = ['#d9480f', '#f08c3a', '#3d6fc9', '#2e9a76', '#b7832a', '#7c5cc4', '#c24d78', '#171717'];
  const parts = Array.from({ length: amount }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.5,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -6 - Math.random() * 10,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 6,
    h: 3 + Math.random() * 4,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const frame = (now) => {
    const t = now - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 3200);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < 3300) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

// Survol : une ligne du classement allume sa pastille dans la matrice, et inversement
export function linkHover(root) {
  const tip = ensureTip();
  root.querySelectorAll('[data-rank]').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      const r = el.dataset.rank;
      root.querySelectorAll(`[data-rank="${r}"]`).forEach((x) => x.classList.add('hl'));
      if (el.dataset.tip) {
        tip.textContent = el.dataset.tip;
        const b = el.getBoundingClientRect();
        tip.style.left = `${b.left + b.width / 2}px`;
        tip.style.top = `${b.top - 10}px`;
        tip.classList.add('show');
      }
    });
    el.addEventListener('mouseleave', () => {
      root.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl'));
      tip.classList.remove('show');
    });
  });
}

function ensureTip() {
  let t = document.querySelector('.fx-tip');
  if (!t) {
    t = document.createElement('div');
    t.className = 'fx-tip';
    document.body.appendChild(t);
  }
  return t;
}

// Onde lumineuse au clic sur les boutons
export function ripples() {
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn, .seg button, .pick, .dept-opt span');
    if (!b || reduced()) return;
    const r = b.getBoundingClientRect();
    const s = document.createElement('span');
    s.className = 'ripple';
    const size = Math.max(r.width, r.height) * 2;
    s.style.width = s.style.height = size + 'px';
    s.style.left = e.clientX - r.left - size / 2 + 'px';
    s.style.top = e.clientY - r.top - size / 2 + 'px';
    b.appendChild(s);
    setTimeout(() => s.remove(), 650);
  });
}

// Suivi du curseur : la lumière des cartes suit la souris
export function spotlight() {
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.panel, .join-card, .dept-col, .p-card, .timeline');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
}

export function vibrate(ms = 30) {
  navigator.vibrate?.(ms);
}
