// Écran téléphone : l'étudiant rejoint, puis répond à chaque question du tour en cours.
import { SCENARIO, DEPARTMENTS, deptById, ROUND1_QUESTIONS, SCALES, RULES, roundName } from './content.js?v=202611221505';
import { fmt } from './analysis.js?v=202611221505';
import { icon, esc, mmss } from './ui.js?v=202611221505';
import { uid } from './store.js?v=202611221505';
import { ambient, ripples, spotlight, vibrate, keepAwake } from './fx.js?v=202611221505';

const app = document.getElementById('app');
let store;
let code = null;
let me = null;
let state = null;
let clockOffset = 0;
let screenKey = '';
const drafts = new Map();
const mine = new Map();
let sending = false;

const meKey = (c) => 'delphi-me:' + c;

export async function startPlayer(s, sessionCode) {
  store = s;
  document.body.className = 'phone';
  document.documentElement.className = 'is-phone';
  ambient();
  ripples();
  spotlight();
  if (!sessionCode) return renderCodeForm();
  await open(sessionCode.toUpperCase());
}

async function open(c) {
  const row = await store.getSession(c).catch(() => null);
  if (!row) return renderCodeForm(`Aucune session avec le code ${c}`);
  code = c;
  state = row.state;
  try {
    me = JSON.parse(localStorage.getItem(meKey(code)));
  } catch {
    me = null;
  }
  if (me) {
    const list = await store.listParticipants(code).catch(() => null);
    if (!me.secret || (list && !list.some((p) => p.id === me.id))) me = null;
  }
  // Le téléphone n'écoute que l'état de la séance : moins de trafic temps réel pour toute la classe
  store.subscribe(code, (kind, r) => {
    if (kind === 'state' && r?.state) applyState(r.state);
    if (kind === 'status' && r === 'SUBSCRIBED') resync();
  }, ['sessions']);
  if (me) await loadMine();
  render(true);
  setInterval(tick, 250);
  // Filet de sécurité : relecture de l'état si un message temps réel s'est perdu (veille, Wi-Fi, 4G)
  setInterval(resync, 8000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { resync(); keepAwake(); }
  });
  window.addEventListener('online', resync);
  document.addEventListener('pointerdown', keepAwake, { once: true });
}

let lastSent = 0;
function applyState(next) {
  if (!next) return;
  // Ignore un état plus ancien que celui déjà affiché
  if (next.sentAt && next.sentAt < lastSent) return;
  lastSent = next.sentAt || lastSent;
  const changed = JSON.stringify(next) !== JSON.stringify(state);
  state = next;
  // Décalage entre l'horloge de l'animateur et celle du téléphone, mesuré à chaque message
  if (state.sentAt && changed) clockOffset = state.sentAt - Date.now();
  if (changed) render();
}

let resyncing = false;
async function resync() {
  if (resyncing || !code) return;
  resyncing = true;
  try {
    const row = await store.getSession(code);
    if (row) applyState(row.state);
  } catch {}
  resyncing = false;
}

async function loadMine() {
  const all = await store.listAnswers(code);
  all.filter((a) => a.participant_id === me.id).forEach((a) => mine.set(`${a.round}|${a.qkey}`, a.payload));
}

function renderCodeForm(error) {
  app.innerHTML = `
  <main class="p-wrap">
    ${pHeader()}
    <form class="p-card" id="code-form">
      <h1>Rejoindre l’atelier</h1>
      <label class="field"><span>Code de la session</span><input name="code" autocomplete="off" autocapitalize="characters" maxlength="5" required></label>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <button class="btn primary block lg" type="submit">Continuer ${icon('arrow-right')}</button>
    </form>
  </main>`;
  app.querySelector('#code-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = new FormData(e.target).get('code').trim().toUpperCase();
    location.hash = '#/join/' + c;
  });
}

function pHeader(extra = '') {
  return `<header class="p-head"><span class="brand"><span class="mark" aria-hidden="true"></span><span class="name">${esc(SCENARIO.company)}</span></span>${extra}</header>`;
}

function currentQuestion() {
  if (!state || state.phase !== 'question') return null;
  if (state.round === 1) {
    const q = ROUND1_QUESTIONS[state.qIndex];
    return q ? { ...q, kind: 'text', total: ROUND1_QUESTIONS.length } : null;
  }
  const ids = state.roundRisks?.[state.round] || [];
  const risk = state.risks.find((r) => r.id === ids[state.qIndex]);
  return risk ? { key: risk.id, title: risk.label, kind: 'rating', total: ids.length } : null;
}

function keyOf() {
  if (!me) return 'join';
  if (!state) return 'none';
  return `${state.phase}|${state.round}|${state.qIndex}`;
}

function render(force) {
  const k = keyOf();
  if (!force && k === screenKey) {
    tick();
    return;
  }
  screenKey = k;
  if (!me) return renderJoin();
  const q = currentQuestion();
  if (q) return renderQuestion(q);
  renderWaiting();
}

function renderJoin(error) {
  app.innerHTML = `
  <main class="p-wrap">
    ${pHeader(`<span class="p-code num">${esc(code)}</span>`)}
    <form class="p-card" id="join-form">
      <h1>Rejoindre l’atelier Delphi</h1>
      <p class="muted">Vous représentez un département de ${esc(SCENARIO.company)}. Vos réponses restent anonymes, seul votre département apparaît.</p>
      <label class="field"><span>Votre prénom</span><input name="name" maxlength="24" autocomplete="given-name" required></label>
      <fieldset class="field"><legend>Votre département</legend>
        <div class="depts">${DEPARTMENTS.map((d) => `
          <label class="dept-opt" style="--c:${d.color}"><input type="radio" name="dept" value="${d.id}" required><span><i class="dot" style="--c:${d.color}"></i>${esc(d.name)}</span></label>`).join('')}
        </div>
      </fieldset>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <button class="btn primary block lg" type="submit">Rejoindre ${icon('arrow-right')}</button>
    </form>
  </main>`;
  app.querySelector('#join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get('name') || '').trim();
    const dept = f.get('dept');
    if (!name || !dept) return;
    const p = { id: uid(), name: name.slice(0, 24), dept };
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      me = await store.join(code, p);
      localStorage.setItem(meKey(code), JSON.stringify(me));
      keepAwake();
      render(true);
    } catch (err) {
      btn.disabled = false;
      renderJoin('Impossible de rejoindre : ' + (err.message || err));
    }
  });
}

function meChip() {
  const d = deptById[me.dept];
  return `<span class="me"><i class="dot" style="--c:${d?.color}"></i>${esc(me.name)} · ${esc(d?.name)}</span>`;
}

function renderWaiting() {
  const p = state?.phase;
  const messages = {
    scenario: ['Lisez le scénario au tableau', 'Les questions arrivent sur ce téléphone dès que l’animateur lance le tour 1.'],
    lobby: ['Vous êtes inscrit', 'Attendez le lancement du tour 1. Gardez cette page ouverte.'],
    interlude: ['Fin du tour', 'Les réponses sont en cours d’analyse. Regardez le tableau.'],
    results: ['Résultats au tableau', 'Le tour suivant arrivera ici. Gardez cette page ouverte.'],
    consolidate: ['Consolidation en cours', 'L’animateur fusionne les doublons pour préparer le tour de notation.'],
    evaluate: ['Évaluation en cours', 'L’animateur compare le niveau de chaque risque aux critères de l’entreprise pour décider quoi en faire.'],
    final: ['Consultation terminée', 'La liste hiérarchisée des risques est affichée au tableau. Merci pour votre participation.'],
  };
  const [title, text] = messages[p] || ['En attente', 'Gardez cette page ouverte.'];
  app.innerHTML = `
  <main class="p-wrap">
    ${pHeader(meChip())}
    <section class="p-card p-wait">
      <span class="pulse ${p === 'final' ? 'done' : ''}" aria-hidden="true"></span>
      <h1>${esc(title)}</h1>
      <p class="muted">${esc(text)}</p>
    </section>
  </main>`;
}

function timeLeft() {
  const t = state?.timer;
  if (!t) return null;
  if (t.pausedLeft != null) return t.pausedLeft;
  return (t.endsAt - (Date.now() + clockOffset)) / 1000;
}

function renderQuestion(q) {
  const key = `${state.round}|${q.key}`;
  const saved = mine.get(key);
  const draft = drafts.get(key) || (saved ? { ...saved } : {});
  drafts.set(key, draft);
  const label = q.kind === 'text' ? 'Question' : 'Risque';
  const head = `
    <div class="p-qhead">
      <span class="eyebrow">Tour ${state.round} · ${roundName(state.round)} · ${label} ${state.qIndex + 1}/${q.total}</span>
      <span class="p-timer num" data-timer>${mmss(timeLeft() ?? 0)}</span>
    </div>
    <div class="p-progress"><span data-bar></span></div>`;
  const body = q.kind === 'text' ? textForm(q, draft) : ratingForm(q, draft);
  app.innerHTML = `
  <main class="p-wrap">
    ${pHeader(meChip())}
    <section class="p-card p-question enter">
      ${head}
      <h1 class="p-qtitle">${esc(q.title)}</h1>
      <form id="answer" novalidate>
        ${body}
        <p class="status" data-status>${saved ? `${icon('check')} Réponse envoyée, vous pouvez encore la modifier` : ''}</p>
        <button class="btn primary block lg" type="submit" data-send>${saved ? 'Mettre à jour' : 'Envoyer'} ${icon('send')}</button>
      </form>
    </section>
  </main>`;
  bindForm(q, key, draft);
  tick();
}

function textForm(q, draft) {
  return `<p class="muted">${esc(q.hint)}</p>
    <textarea name="text" rows="6" maxlength="600" placeholder="Votre réponse">${esc(draft.text || '')}</textarea>`;
}

function ratingForm(q, draft) {
  const fb = state.round >= 3 ? state.feedback?.[state.round]?.[q.key] : null;
  const prev = state.round >= 3 ? mine.get(`${state.round - 1}|${q.key}`) : null;
  const scale = (k) => `
    <fieldset class="scale" data-scale="${k}">
      <legend><span>${SCALES[k].label}</span><span class="sel muted" data-sel="${k}">${draft[k] ? esc(SCALES[k].steps[draft[k] - 1]) : 'Choisissez une note'}</span></legend>
      <div class="seg">${[1, 2, 3, 4, 5].map((v) => `<button type="button" class="${draft[k] === v ? 'on' : ''} ${fb && Math.round(fb[k]) === v ? 'med' : ''}" data-k="${k}" data-v="${v}" aria-pressed="${draft[k] === v}">${v}</button>`).join('')}</div>
    </fieldset>`;
  const args = fb?.args || [];
  return `
    ${fb ? `<div class="fb">
      <span class="fb-title">Médiane du groupe au tour ${state.round - 1}</span>
      <div class="fb-big">
        <span><em>Probabilité</em><b class="num">${fmt(fb.p)}</b></span>
        <span><em>Gravité</em><b class="num">${fmt(fb.i)}</b></span>
      </div>
      ${prev ? `<p class="fb-mine"><span class="muted">Votre note au tour ${state.round - 1}</span><b class="num">P ${prev.p} · G ${prev.i}</b></p>` : ''}
      ${args.length ? `<div class="fb-args"><span class="muted">Arguments anonymes des avis éloignés</span>${args.map((a) => `<p><span class="arg-dir ${a.dir}">${a.dir === 'up' ? 'Plus haut' : 'Plus bas'} · P ${a.p} · G ${a.i}</span>${esc(a.why)}</p>`).join('')}</div>` : ''}
    </div>` : ''}
    ${scale('p')}${scale('i')}
    <label class="field" data-why-wrap><span data-why-label>Pourquoi cette note ? <em class="muted">facultatif</em></span>
      <textarea name="why" rows="2" maxlength="300" placeholder="Votre argument sera montré au groupe, sans votre nom">${esc(draft.why || '')}</textarea></label>
    ${state.round >= 3 ? `
      <label class="field"><span>Mesure de maîtrise proposée <em class="muted">facultative</em></span>
        <input name="measure" maxlength="120" value="${esc(draft.measure || '')}" placeholder="Ex. qualifier un second fournisseur"></label>` : ''}`;
}

function needsWhy(q, draft) {
  if (state.round < 3) return false;
  const fb = state.feedback?.[state.round]?.[q.key];
  if (!fb || !draft.p || !draft.i) return false;
  return Math.abs(draft.p - fb.p) >= RULES.justifyGap || Math.abs(draft.i - fb.i) >= RULES.justifyGap;
}

function bindForm(q, key, draft) {
  const form = app.querySelector('#answer');
  const syncWhy = () => {
    const lab = form.querySelector('[data-why-label]');
    if (!lab) return;
    lab.innerHTML = needsWhy(q, draft)
      ? 'Justification <em class="req">obligatoire, votre note s’écarte de la médiane</em>'
      : 'Pourquoi cette note ? <em class="muted">facultatif</em>';
  };
  syncWhy();
  form.addEventListener('input', (e) => {
    if (e.target.name) draft[e.target.name] = e.target.value;
  });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const k = b.dataset.k;
    draft[k] = Number(b.dataset.v);
    form.querySelectorAll(`[data-k="${k}"]`).forEach((x) => {
      const on = Number(x.dataset.v) === draft[k];
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', on);
    });
    form.querySelector(`[data-sel="${k}"]`).textContent = SCALES[k].steps[draft[k] - 1];
    syncWhy();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const status = form.querySelector('[data-status]');
    let payload;
    if (q.kind === 'text') {
      const text = String(draft.text || '').trim();
      if (!text) return showError(status, 'Écrivez au moins une réponse');
      payload = { text };
    } else {
      if (!draft.p || !draft.i) return showError(status, 'Choisissez une note en probabilité et en gravité');
      if (needsWhy(q, draft) && !String(draft.why || '').trim()) return showError(status, 'Ajoutez une justification');
      payload = { p: draft.p, i: draft.i };
      if (String(draft.why || '').trim()) payload.why = draft.why.trim();
      if (state.round >= 3 && String(draft.measure || '').trim()) payload.measure = draft.measure.trim();
    }
    sending = true;
    const btn = form.querySelector('[data-send]');
    btn.disabled = true;
    try {
      await store.submitAnswer(code, { participant_id: me.id, round: state.round, qkey: q.key, payload }, me.secret);
      mine.set(key, payload);
      status.className = 'status ok';
      status.innerHTML = `${icon('check')} Réponse envoyée, vous pouvez encore la modifier`;
      btn.innerHTML = `${icon('check')} Envoyé`;
      btn.classList.add('sent');
      vibrate(40);
      setTimeout(() => {
        btn.classList.remove('sent');
        btn.innerHTML = `Mettre à jour ${icon('send')}`;
      }, 1400);
    } catch (err) {
      showError(status, 'Envoi impossible, réessayez');
    } finally {
      sending = false;
      btn.disabled = timeLeft() != null && timeLeft() <= 0;
    }
  });
}

function showError(el, msg) {
  el.className = 'status error';
  el.textContent = msg;
}

function tick() {
  if (!state || state.phase !== 'question' || !state.timer) return;
  const left = timeLeft();
  const t = app.querySelector('[data-timer]');
  if (t) t.textContent = state.timer.pausedLeft != null ? 'Pause' : mmss(left);
  const bar = app.querySelector('[data-bar]');
  if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, left / state.timer.duration))})`;
  const low = left <= 10 && left > 0 && state.timer.pausedLeft == null;
  bar?.parentElement.classList.toggle('low', low);
  t?.classList.toggle('low', low);
  const btn = app.querySelector('[data-send]');
  if (btn && left <= 0 && state.timer.pausedLeft == null) {
    btn.disabled = true;
    btn.textContent = 'Temps écoulé';
  }
}
