// Petits outils d'affichage partagés : icônes, QR code, minuterie, échappement.
import qrcode from '../vendor/qrcode.mjs?v=202611221401';
import { deptById } from './content.js?v=202611221401';

const ICONS = {
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  skip: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const q = 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  }
  const s = n + q * 2;
  return `<svg class="qr" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="QR code pour rejoindre"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#171717"/></svg>`;
}

export function mmss(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function deptDot(id, withName = false) {
  const d = deptById[id];
  if (!d) return '';
  return `<span class="dept"><i class="dot" style="--c:${d.color}"></i>${withName ? esc(d.name) : ''}</span>`;
}

export function deptDots(ids) {
  return `<span class="dots">${ids.map((id) => `<i class="dot" style="--c:${deptById[id]?.color}" title="${esc(deptById[id]?.name)}"></i>`).join('')}</span>`;
}

// Cadran gradué de la minuterie : 60 graduations, celles qui restent sont en couleur
export function dial(size = 'lg') {
  let ticks = '';
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * Math.PI * 2 - Math.PI / 2;
    const long = k % 5 === 0;
    const r1 = long ? 80 : 84;
    const r2 = 92;
    ticks += `<line data-k="${k}" x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}"/>`;
  }
  return `<div class="dial dial-${size}"><svg viewBox="0 0 200 200" aria-hidden="true"><g class="ticks">${ticks}</g></svg><div class="dial-center"><span class="dial-time" data-time>0:00</span><span class="dial-label" data-label>restant</span></div></div>`;
}

export function updateDial(root, left, total, paused) {
  if (!root) return;
  const on = total > 0 ? Math.ceil((60 * Math.max(0, left)) / total) : 0;
  root.querySelectorAll('.ticks line').forEach((l) => l.classList.toggle('on', Number(l.dataset.k) < on));
  const t = root.querySelector('[data-time]');
  if (t) t.textContent = mmss(left);
  const lab = root.querySelector('[data-label]');
  if (lab) lab.textContent = paused ? 'en pause' : 'restant';
  root.classList.toggle('low', left <= 10 && left > 0);
  root.classList.toggle('paused', !!paused);
}

export function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export const pick = (a) => a[Math.floor(Math.random() * a.length)];
