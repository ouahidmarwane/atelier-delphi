// Écran projecteur : l'animateur pilote toute la séance d'ici.
import { SCENARIO, DEPARTMENTS, deptById, STEPS, ROUND1_QUESTIONS, SCALES, RULES, EVAL_CRITERIA, roundName, decisionById, autoDecision, isPrudent, priorityOf, THEMES, themeById, BOT_LINES, BOT_NAMES, BOT_MEASURES, BOT_ARGS, QUIZ, QUIZ_DURATION, QUIZ_COLORS, quizShape, quizPoints } from './content.js?v=202611221732';
import { stats, matchThemes, analyzeOpen, candidateRisks, analyzeRatings, insightsRound1, insightsRatings, fmt, pct, topMeasures, normalize, splitLines } from './analysis.js?v=202611221732';
import { icon, esc, qrSvg, deptDots, dial, updateDial, shuffle, pick } from './ui.js?v=202611221732';
import { uid, aiGroup } from './store.js?v=202611221732';
import { ambient, countUps, bump, confetti, linkHover, ripples, spotlight, keepAwake } from './fx.js?v=202611221732';

const app = document.getElementById('app');
let store;
let code = null;
let state = null;
const participants = new Map();
const answers = new Map();
let renderQueued = null;
let firedFor = null;
let botTimers = [];
let consolidation = null;
let connection = 'connecting';

const akey = (a) => `${a.participant_id}|${a.round}|${a.qkey}`;
const SAVED = 'delphi-host-session';

export async function startHost(s, sessionCode) {
  store = s;
  document.body.className = 'host';
  document.documentElement.className = 'is-host';
  ambient();
  ripples();
  spotlight();
  bindGlobal();
  if (sessionCode) {
    const ok = await openSession(sessionCode);
    if (ok) return;
  }
  renderLanding();
}

// ---------- Accueil ----------

function renderLanding(error) {
  const saved = localStorage.getItem(SAVED);
  const opt = (vals, cur) => vals.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
  app.innerHTML = `
  <main class="landing">
    <div class="landing-inner">
      <p class="eyebrow">Gestion des risques · cas pratique</p>
      <h1>La méthode Delphi appliquée au lancement d’une ligne chez ${esc(SCENARIO.company)}</h1>
      <p class="lead">Cet écran pilote la séance au projecteur. Les étudiants rejoignent avec le QR code et répondent depuis leur téléphone, tour après tour, jusqu’au consensus.</p>
      <p class="mode-note ${store.mode}" data-mode ${store.mode === 'supabase' ? 'hidden' : ''}>${store.mode === 'supabase'
        ? ''
        : 'Mode répétition : sans serveur, les téléphones ne peuvent pas rejoindre. Ouvrez le lien étudiant dans un autre onglet pour tester, ou configurez Supabase.'}</p>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <form class="settings" id="create">
        <label><span>Temps par question au tour 1</span>
          <select name="duration">${opt([[60, '1 min'], [120, '2 min'], [180, '3 min'], [240, '4 min'], [300, '5 min']], RULES.defaultDuration)}</select></label>
        <label><span>Temps par risque aux tours de notation</span>
          <select name="rating">${opt([[45, '45 s'], [60, '1 min'], [90, '1 min 30'], [120, '2 min'], [180, '3 min']], RULES.ratingDuration)}</select></label>
        <label class="check"><input type="checkbox" name="rehearsal" ${store.mode === 'local' ? 'checked' : ''}><span>Autoriser les participants fictifs pour répéter</span></label>
        <div class="row">
          <button class="btn primary lg" type="submit">Créer la session ${icon('arrow-right')}</button>
          <button class="btn lg" type="button" data-act="quizOnly">Quiz seul</button>
          <button class="btn lg" type="button" data-act="simulate">Lancer une simulation ${icon('play')}</button>
          ${saved ? `<button class="btn lg" type="button" data-act="resume">Reprendre la session ${esc(saved)}</button>` : ''}
        </div>
      </form>
    </div>
  </main>`;
  if (store.mode === 'supabase') {
    const note = app.querySelector('[data-mode]');
    store.ping()
      .catch((err) => {
        note.hidden = false;
        note.className = 'mode-note error-note';
        note.textContent = 'Supabase ne répond pas : ' + (err.message || err) + '. Vérifiez la connexion internet ou les clés dans js/config.js.';
      });
  }
  app.querySelector('#create').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const settings = { duration: Number(f.get('duration')), rating: Number(f.get('rating')), rehearsal: f.get('rehearsal') === 'on' };
    const c = newCode();
    const initial = { phase: 'scenario', round: 0, qIndex: 0, timer: null, risks: [], roundRisks: {}, feedback: {}, resultIndex: 0, settings, sentAt: Date.now() };
    try {
      await store.createSession(c, initial);
      location.hash = '#/host/' + c;
    } catch (err) {
      renderLanding('Impossible de créer la session : ' + (err.message || err));
    }
  });
}

function newCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function openSession(c) {
  const row = await store.getSession(c).catch(() => null);
  if (!row) {
    localStorage.removeItem(SAVED);
    renderLanding(`La session ${c} est introuvable`);
    return false;
  }
  if (!store.hasHostKey(c)) {
    renderLanding(`La session ${c} est pilotée depuis un autre ordinateur : la clé d’animateur n’est pas sur cet appareil. Pour la reprendre, ouvrez-la sur l’ordinateur qui l’a créée.`);
    return false;
  }
  code = c;
  state = row.state;
  localStorage.setItem(SAVED, c);
  await refreshAll();
  loadAi();
  store.subscribe(code, onEvent);
  // Verrou : cette fenêtre devient la seule à piloter la séance
  setState({ hostId: INSTANCE });
  setInterval(tick, 200);
  // Filet de sécurité si un message temps réel s'est perdu
  setInterval(() => {
    if (['lobby', 'question', 'interlude'].includes(state.phase)) refreshAll().then(queueRender);
  }, 15000);
  const resync = () => refreshAll().then(queueRender);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { resync(); keepAwake(); } });
  window.addEventListener('online', () => { resync(); flushState(); });
  keepAwake();
  if (state.phase === 'question') scheduleBots();
  return true;
}

const INSTANCE = Math.random().toString(36).slice(2, 10);
let passive = false;

async function refreshAll() {
  try {
    const [ps, as] = await Promise.all([store.listParticipants(code), store.listAnswers(code)]);
    ps.forEach((p) => participants.set(p.id, p));
    as.forEach((a) => answers.set(akey(a), a));
  } catch (err) {
    console.warn('Resynchronisation impossible', err);
  }
}

function passiveBanner() {
  if (!passive) return '';
  return `<div class="passive">Une autre fenêtre pilote maintenant cette séance. Cette fenêtre est en lecture seule.<button class="btn" data-act="takeOver">Reprendre le pilotage ici</button></div>`;
}

let wasDown = false;
function onEvent(kind, row) {
  if (kind === 'participant' && row?.id) participants.set(row.id, row);
  else if (kind === 'answer' && row?.participant_id) answers.set(akey(row), row);
  else if (kind === 'state' && row?.state) {
    // Une autre fenêtre a pris le pilotage : celle-ci passe en lecture seule et suit l'état
    if (row.state.hostId && row.state.hostId !== INSTANCE) {
      passive = true;
      clearBots();
      state = row.state;
      render();
    }
    return;
  } else if (kind === 'status') {
    connection = row;
    updateConnection();
    if (row === 'SUBSCRIBED' && wasDown) refreshAll().then(queueRender);
    if (row !== 'SUBSCRIBED') wasDown = true;
    return;
  } else return;
  queueRender();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = setTimeout(() => {
    renderQueued = null;
    renderLive();
  }, 200);
}

// Écriture de l'état : la dernière version est renvoyée jusqu'à ce que le serveur l'accepte
let pushing = false;
let dirty = false;
async function setState(patch) {
  if (passive) return;
  state = { ...state, ...patch, sentAt: Date.now() };
  render();
  dirty = true;
  flushState();
}

async function flushState() {
  if (pushing || !dirty || passive) return;
  pushing = true;
  let wait = 800;
  while (dirty && !passive) {
    dirty = false;
    try {
      await store.setState(code, { ...state, sentAt: Date.now() });
      setSync(true);
    } catch (err) {
      dirty = true;
      setSync(false, err.message || String(err));
      if (/clé animateur/.test(err.message || '')) break;
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 5000);
    }
  }
  pushing = false;
}

let syncOk = true;
function setSync(ok, msg) {
  if (ok === syncOk) return;
  syncOk = ok;
  if (!ok) toast('Connexion perdue, nouvel essai en cours… ' + (msg ? `(${msg})` : ''), 6000);
  else toast('Connexion rétablie');
  updateConnection();
}

// ---------- Données dérivées ----------

const people = () => Object.fromEntries([...participants.values()].map((p) => [p.id, p]));
const answersOf = (round) => [...answers.values()].filter((a) => a.round === round && participants.has(a.participant_id));
const risksOf = (round) => (state.roundRisks[round] || []).map((id) => state.risks.find((r) => r.id === id)).filter(Boolean);
const ratingRounds = () => Object.keys(state.roundRisks).map(Number).sort((a, b) => a - b);

function questionsFor(round) {
  if (round === 1) return ROUND1_QUESTIONS.map((q) => ({ ...q, kind: 'text' }));
  return risksOf(round).map((r) => ({ key: r.id, title: r.label, kind: 'rating' }));
}

function round1Analysis() {
  const ans = answersOf(1);
  const ppl = people();
  const byQuestion = {};
  const useAi = ai?.status === 'ok';
  ROUND1_QUESTIONS.forEach((q) => {
    const rows = ans.filter((a) => a.qkey === q.key);
    byQuestion[q.key] = useAi ? aiOpen(q.key, rows, ppl) : analyzeOpen(rows, ppl);
  });
  const candidates = useAi ? aiCandidates(byQuestion.q1) : candidateRisks(ans, ppl);
  return { byQuestion, candidates, insights: insightsRound1(byQuestion, candidates, participants.size) };
}

// ---------- Regroupement par l'IA ----------

let ai = null;
const aiKey = () => 'delphi-ai:' + code;

function loadAi() {
  try {
    ai = JSON.parse(localStorage.getItem(aiKey())) || null;
    if (ai?.status === 'pending') ai = null;
  } catch {
    ai = null;
  }
}

function saveAi() {
  try {
    localStorage.setItem(aiKey(), JSON.stringify(ai));
  } catch {}
}

async function runAi() {
  const ppl = people();
  const refs = [];
  const lines = [];
  for (const q of ROUND1_QUESTIONS) {
    let n = 0;
    for (const a of answersOf(1).filter((x) => x.qkey === q.key)) {
      splitLines(a.payload?.text).forEach((text, k) => {
        const id = `${q.key}-${++n}`;
        refs.push({ id, pid: a.participant_id, q: q.key, k, text });
        lines.push({ id, q: q.key, text });
      });
    }
  }
  if (!lines.length) return;
  ai = { status: 'pending', started: Date.now() };
  refreshAiViews();
  try {
    await refreshAll();
    const out = await aiGroup(code, {
      questions: ROUND1_QUESTIONS.map((q) => ({ key: q.key, title: q.title })),
      themes: THEMES.map((t) => ({ id: t.id, label: t.label })),
      lines,
    });
    const byId = Object.fromEntries(refs.map((r) => [r.id, r]));
    const groups = {};
    for (const q of out.questions || []) {
      groups[q.q] = (q.groups || []).map((g) => ({
        label: g.label,
        theme: themeById[g.theme] && q.q !== 'q4' ? g.theme : '',
        target: themeById[g.theme] ? g.theme : '',
        refs: g.ids.map((id) => byId[id]).filter(Boolean).map((r) => `${r.pid}|${r.q}|${r.k}`),
      }));
    }
    ai = { status: 'ok', model: out.model, groups, at: Date.now() };
  } catch (err) {
    ai = { status: 'error', message: err.message || String(err) };
  }
  saveAi();
  if (consolidation && !consolidation.touched) consolidation = null;
  refreshAiViews();
}

function refreshAiViews() {
  if (state.phase === 'results' && state.round === 1) render();
  else if (state.phase === 'consolidate') render();
}

const offTopic = (label) => /hors sujet/i.test(label);
const slug = (s) => normalize(s).trim().replace(/ /g, '-').slice(0, 40);

// Même format que l'analyse par mots-clés, mais avec les groupes de l'IA
function aiOpen(qkey, rows, ppl) {
  const groups = ai.groups[qkey] || [];
  const measures = qkey === 'q4';
  // Plusieurs groupes de l'IA peuvent désigner le même risque : on les fusionne en une seule ligne
  const themes = [];
  const byId = new Map();
  const where = new Map();
  groups.forEach((g, gi) => {
    const label = g.theme && !measures ? themeById[g.theme].label : g.label;
    const id = measures ? 'm-' + slug(g.label) : g.theme || 'ai-' + slug(label) || 'ai-' + gi;
    const key = measures ? id : normalize(label);
    let ti = byId.get(id) ?? byId.get(key);
    if (ti == null) {
      ti = themes.length;
      themes.push({ id, label, count: 0, people: new Set(), depts: new Set(), samples: [], ai: !g.theme && !measures, off: offTopic(g.label) });
    }
    byId.set(id, ti);
    byId.set(key, ti);
    g.refs.forEach((r) => where.set(r, ti));
  });
  const other = [];
  let lines = 0;
  const respondents = new Set();
  for (const a of rows) {
    const dept = ppl[a.participant_id]?.dept;
    splitLines(a.payload?.text).forEach((text, k) => {
      lines++;
      respondents.add(a.participant_id);
      let gi = where.get(`${a.participant_id}|${qkey}|${k}`);
      if (gi == null) {
        // Réponse arrivée après l'analyse : on tente les mots-clés
        const ids = matchThemes(text);
        gi = themes.findIndex((t) => ids.includes(t.id));
        if (gi < 0) { other.push({ text, dept }); return; }
      }
      const t = themes[gi];
      if (t.off) { other.push({ text, dept }); return; }
      t.count++;
      t.people.add(a.participant_id);
      if (dept) t.depts.add(dept);
      if (t.samples.length < 40) t.samples.push({ text, dept });
    });
  }
  const list = themes
    .filter((t) => t.count && !t.off)
    .map((t) => ({ ...t, people: t.people.size, depts: DEPARTMENTS.map((d) => d.id).filter((id) => t.depts.has(id)) }))
    .sort((a, b) => b.count - a.count || b.depts.length - a.depts.length);
  return { themes: list, other, lines, respondents: respondents.size };
}

function aiCandidates(q1) {
  const list = [...q1.themes].sort((a, b) => b.depts.length - a.depts.length || b.count - a.count);
  return { list, unmatched: q1.other };
}

function aiBadge() {
  if (!ai) return '';
  if (ai.status === 'pending') return `<span class="ai-badge pending"><i class="spin"></i>Analyse par l’IA en cours…</span>`;
  if (ai.status === 'ok') return `<span class="ai-badge ok">${icon('check')}Regroupé par l’IA${ai.model ? ` · ${esc(ai.model)}` : ''}</span>`;
  return `<span class="ai-badge error" title="${esc(ai.message)}">IA indisponible, regroupement par mots-clés</span>`;
}

const ratingResults = (round) => analyzeRatings(answersOf(round), risksOf(round));

// Classement : d'abord la priorité de la grille, puis la criticité
const prioRank = (x) => Number(String(x.level?.id || 'p9').slice(1));
const byPriority = (a, b) => prioRank(a) - prioRank(b) || b.crit - a.crit || b.agreement - a.agreement;

function finalResults() {
  const rounds = ratingRounds();
  return state.risks.map((risk) => {
    const rated = rounds.filter((r) => state.roundRisks[r].includes(risk.id));
    const last = rated[rated.length - 1];
    const res = analyzeRatings(answersOf(last), [risk])[0];
    const measures = [...round1Measures(risk.id), ...rated.filter((r) => r >= 3).flatMap((r) => analyzeRatings(answersOf(r), [risk])[0].measures)];
    return { ...res, lastRound: last, rounds: rated.length, top: topMeasures(measures, 2) };
  }).filter((r) => r.n).sort(byPriority);
}

// Stabilité : les notes bougent-elles encore d'un tour à l'autre ?
function stabilityOf(round, x, prevX) {
  if (!prevX?.n) return null;
  const cur = answersOf(round).filter((a) => a.qkey === x.id);
  const before = new Map(answersOf(round - 1).filter((a) => a.qkey === x.id).map((a) => [a.participant_id, a.payload]));
  let pairs = 0;
  let changed = 0;
  for (const a of cur) {
    const b = before.get(a.participant_id);
    if (!b) continue;
    pairs++;
    if (b.p !== a.payload.p || b.i !== a.payload.i) changed++;
  }
  const rate = pairs ? changed / pairs : 0;
  const medDelta = Math.abs(x.p.median - prevX.p.median) + Math.abs(x.i.median - prevX.i.median);
  return { rate, medDelta, stable: pairs > 0 && rate <= RULES.stableChange && medDelta <= 0.5 };
}

// Positions opposées d'un risque sans consensus : le camp des avis bas et celui des avis hauts
function positionsOf(x) {
  const rows = answersOf(x.lastRound).filter((a) => a.qkey === x.id && a.payload);
  const mid = x.p.median + x.i.median;
  const sum = (a) => a.payload.p + a.payload.i;
  let low = rows.filter((a) => sum(a) <= mid - 1);
  let high = rows.filter((a) => sum(a) >= mid + 1);
  if (!low.length) low = rows.filter((a) => sum(a) < mid);
  if (!high.length) high = rows.filter((a) => sum(a) > mid);
  const camp = (list) => {
    if (!list.length) return null;
    const why = list.map((a) => a.payload.why).find(Boolean)
      || list.map((a) => answers.get(`${a.participant_id}|${x.lastRound - 1}|${x.id}`)?.payload?.why).find(Boolean);
    return { n: list.length, p: stats(list.map((a) => a.payload.p)).median, i: stats(list.map((a) => a.payload.i)).median, why };
  };
  return { low: camp(low), high: camp(high) };
}

// Arguments anonymes renvoyés au groupe : d'abord ceux des avis les plus éloignés de la médiane
function argsFor(round, x) {
  const rows = answersOf(round).filter((a) => a.qkey === x.id && a.payload?.why);
  const scored = rows.map((a) => {
    const dp = a.payload.p - x.p.median;
    const di = a.payload.i - x.i.median;
    return { p: a.payload.p, i: a.payload.i, why: String(a.payload.why).slice(0, 160), gap: Math.max(Math.abs(dp), Math.abs(di)), dir: dp + di >= 0 ? 'up' : 'down' };
  }).sort((a, b) => b.gap - a.gap);
  const seen = new Set();
  const out = [];
  for (const s of scored) {
    const k = normalize(s.why).trim();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length === 3) break;
  }
  return out;
}

// Mesures proposées au tour 1 qui visent ce risque (par l'IA, sinon par les mots-clés)
function round1Measures(riskId) {
  const out = [];
  const rows = answersOf(1).filter((a) => a.qkey === 'q4');
  if (ai?.status === 'ok' && ai.groups?.q4) {
    for (const g of ai.groups.q4) if (g.target === riskId) for (let k = 0; k < g.refs.length; k++) out.push(g.label);
    return out;
  }
  for (const a of rows) for (const line of splitLines(a.payload?.text)) if (matchThemes(line).includes(riskId)) out.push(line);
  return out;
}

// ---------- Rendu ----------

function stepIndex() {
  const { phase, round } = state;
  if (phase === 'scenario' || phase === 'lobby') return 0;
  if (phase === 'quiz') return 9;
  if (phase === 'final') return 8;
  if (phase === 'evaluate') return 7;
  if (phase === 'consolidate') return 2;
  const inRound = phase === 'question';
  if (round === 1) return inRound ? 1 : 2;
  if (round === 2) return inRound ? 3 : 4;
  return inRound ? 5 : 6;
}

function topbar() {
  const cur = stepIndex();
  const steps = STEPS.map((s, i) => `<li class="${i < cur ? 'done' : i === cur ? 'now' : ''}"><span>${s.label}</span></li>`).join('');
  return `
  <header class="topbar">
    <div class="brand"><span class="mark" aria-hidden="true"></span><span class="name">${esc(SCENARIO.company)}</span><span class="sub">Atelier Delphi</span></div>
    <ol class="ruler" aria-label="Étapes de la méthode">${steps}</ol>
    <div class="session">
      ${state.settings?.simulation ? `<span class="sim-tag">Simulation</span><button class="icon-btn sim-phone-btn" data-act="togglePhone" title="Vue étudiant">${icon('smartphone')}</button>` : ''}
      <span class="conn" data-conn title="Connexion"></span>
      <span class="meta">${icon('users')}<b class="num" data-count>${participants.size}</b></span>
      <span class="meta code">Code <b>${esc(code)}</b></span>
      <button class="icon-btn" data-act="fullscreen" title="Plein écran (F)">${icon('maximize')}</button>
    </div>
  </header>`;
}

function render() {
  if (!state) return;
  if (state.phase !== 'lobby') closeQrZoom();
  app.innerHTML = `<div class="shell phase-${state.phase} ${passive ? 'is-passive' : ''}">${passiveBanner()}${topbar()}<main class="stage">${stage()}</main>${controls()}</div>`;
  updateConnection();
  tick();
  afterRender();
}

let celebrated = '';
function afterRender() {
  countUps(app);
  linkHover(app);
  const key = `${state.phase}-${state.round}`;
  if (celebrated === key) return;
  if (state.phase === 'quiz' && state.quiz?.stage === 'podium') {
    celebrated = key;
    setTimeout(() => confetti(220), 1600);
  } else if (state.phase === 'final') {
    celebrated = key;
    setTimeout(() => confetti(180), 350);
  } else if (state.phase === 'results' && app.querySelector('.decision.ok')) {
    celebrated = key;
    setTimeout(() => confetti(110), 900);
  }
}

function renderLive() {
  if (!state) return;
  const count = app.querySelector('[data-count]');
  if (count && count.textContent !== String(participants.size)) {
    count.textContent = participants.size;
    bump(count);
  }
  if (state.phase === 'quiz') {
    const qc = app.querySelector('[data-qcount]');
    const n = String(quizAnswers(state.quiz?.key).length);
    if (qc && qc.textContent !== n) {
      qc.textContent = n;
      bump(qc);
    }
    return;
  }
  if (state.phase === 'question') {
    const live = app.querySelector('[data-live]');
    if (live) {
      const before = live.querySelector('.received b')?.textContent;
      live.innerHTML = liveAnalysis();
      if (before !== live.querySelector('.received b')?.textContent) bump(live.querySelector('.received b'));
      return;
    }
  }
  const zc = document.querySelector('[data-zoom-count]');
  if (zc && zc.textContent !== String(participants.size)) {
    zc.textContent = participants.size;
    bump(zc);
  }
  if (state.phase === 'lobby') {
    const lobby = app.querySelector('[data-lobby]');
    if (lobby) {
      const seen = new Set([...lobby.querySelectorAll('[data-pid]')].map((x) => x.dataset.pid));
      lobby.innerHTML = lobbyPeople(seen);
      if (seen.size !== participants.size) bump(lobby.querySelector('.count'));
      return;
    }
  }
  if (['scenario', 'interlude', 'final', 'consolidate', 'evaluate'].includes(state.phase)) return;
  render();
}

function updateConnection() {
  const el = app.querySelector('[data-conn]');
  if (!el) return;
  const ok = connection === 'SUBSCRIBED' && syncOk;
  el.className = 'conn ' + (ok ? 'ok' : 'ko');
  el.title = ok ? (store.mode === 'local' ? 'Mode répétition local' : 'Temps réel connecté') : 'Connexion en cours';
}

function stage() {
  switch (state.phase) {
    case 'scenario': return scenarioStage();
    case 'lobby': return lobbyStage();
    case 'question': return questionStage();
    case 'interlude': return interludeStage();
    case 'results': return state.round === 1 ? results1Stage() : ratingResultsStage();
    case 'consolidate': return consolidateStage();
    case 'evaluate': return evaluateStage();
    case 'final': return finalStage();
    case 'quiz': return quizStage();
    default: return '';
  }
}

// Scénario
function scenarioStage() {
  const facts = SCENARIO.facts.map((f) => `<li><span class="fig num" data-countup>${esc(f.figure)}</span><span class="fact"><b>${esc(f.unit)}</b> ${esc(f.text)}</span></li>`).join('');
  return `
  <section class="scenario enter">
    <div class="sc-text">
      <p class="eyebrow">${esc(SCENARIO.place)}</p>
      <h1>${esc(SCENARIO.company)}</h1>
      <p class="lead">${esc(SCENARIO.lead)}</p>
      <p class="lead ink">${esc(SCENARIO.stake)}</p>
    </div>
    <ul class="facts">${facts}</ul>
    <figure class="timeline">${timelineSvg()}<figcaption>Il reste 4 semaines entre l’arrivée des machines et le démarrage pour installer, régler, former et passer l’audit</figcaption></figure>
  </section>`;
}

function timelineSvg() {
  const W = 1200, x0 = 40, x1 = 1160, y = 64;
  const X = (w) => x0 + ((x1 - x0) * w) / 12;
  let ticks = '';
  for (let w = 0; w <= 12; w++) {
    ticks += `<line x1="${X(w)}" y1="${y}" x2="${X(w)}" y2="${y + (w % 4 === 0 ? 14 : 8)}" class="tl-tick"/>`;
    ticks += `<text x="${X(w)}" y="${y + 34}" class="tl-num">S${w}</text>`;
  }
  const marks = SCENARIO.timeline.map((m) => `
    <g class="tl-mark ${m.week === 12 ? 'end' : ''}">
      <circle cx="${X(m.week)}" cy="${y}" r="7"/>
      <text x="${X(m.week)}" y="${y - 22}" class="tl-label" text-anchor="${m.week === 0 ? 'start' : m.week === 12 ? 'end' : 'middle'}" dx="${m.week === 0 ? -8 : m.week === 12 ? 8 : 0}">${esc(m.label)}</text>
    </g>`).join('');
  return `<svg viewBox="0 0 ${W} 110" class="tl" role="img" aria-label="Frise de 12 semaines">
    <rect x="${X(8)}" y="${y - 6}" width="${X(12) - X(8)}" height="12" rx="3" class="tl-squeeze"/>
    <line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" class="tl-base"/>
    ${ticks}${marks}
  </svg>`;
}

// Inscription
function joinUrl() {
  const base = location.href.split('#')[0].split('?')[0];
  const local = new URLSearchParams(location.search).has('local') ? '?local' : '';
  return `${base}${local}#/join/${code}`;
}

function lobbyStage() {
  const url = joinUrl();
  return `
  <section class="lobby enter">
    <div class="join-card">
      <button class="qr-wrap qr-btn" data-act="zoomQr" title="Agrandir le QR code (Q)">${qrSvg(url)}<span class="qr-zoom-hint">${icon('maximize')} Agrandir</span></button>
      <div class="join-meta">
        <span class="muted">Scannez le QR code pour rejoindre</span>
        <span class="muted">Code de la session</span>
        <span class="bigcode num">${esc(code)}</span>
      </div>
    </div>
    <div class="lobby-side" data-lobby>${lobbyPeople()}</div>
  </section>`;
}

// QR code en plein écran pour que le fond de la salle puisse le scanner
function openQrZoom() {
  if (document.querySelector('.qr-zoom')) return;
  const el = document.createElement('div');
  el.className = 'qr-zoom';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'QR code agrandi');
  el.innerHTML = `
    <div class="qr-zoom-card">
      <div class="qr-wrap">${qrSvg(joinUrl())}</div>
      <div class="qr-zoom-side">
        <span class="muted">Scannez pour rejoindre</span>
        <span class="muted">Code de la session</span>
        <span class="bigcode num">${esc(code)}</span>
        <span class="zoom-count"><b class="num" data-zoom-count>${participants.size}</b> inscrits</span>
        <button class="btn" data-close>${icon('x')} Fermer</button>
        <span class="muted small">Échap ou clic hors du QR pour fermer</span>
      </div>
    </div>`;
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-close]')) closeQrZoom();
  });
  document.body.appendChild(el);
}

function closeQrZoom() {
  const el = document.querySelector('.qr-zoom');
  if (!el) return;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 200);
}

function lobbyPeople(seen = null) {
  const list = [...participants.values()];
  const cols = DEPARTMENTS.map((d) => {
    const ps = list.filter((p) => p.dept === d.id);
    const shown = ps.slice(-8);
    return `<div class="dept-col" style="--c:${d.color}">
      <div class="dept-head"><i class="dot" style="--c:${d.color}"></i><span>${esc(d.name)}</span><b class="num">${ps.length}</b></div>
      <ul>${shown.map((p) => `<li class="chip ${!seen || !seen.has(p.id) ? 'pop' : ''}" data-pid="${p.id}">${esc(p.name)}</li>`).join('')}${ps.length > shown.length ? `<li class="more">+${ps.length - shown.length}</li>` : ''}</ul>
    </div>`;
  }).join('');
  return `
    <div class="count-block"><span class="count num">${list.length}</span><span class="count-label">${list.length > 1 ? 'participants ont rejoint' : list.length === 1 ? 'participant a rejoint' : 'En attente des participants'}</span></div>
    <div class="dept-grid">${cols}</div>`;
}

// Question en cours
function questionStage() {
  const qs = questionsFor(state.round);
  const q = qs[state.qIndex];
  if (!q) return '';
  const rating = q.kind === 'rating';
  const label = roundName(state.round);
  const fb = rating && state.round >= 3 ? state.feedback?.[state.round]?.[q.key] : null;
  return `
  <section class="question enter" data-q="${state.round}-${state.qIndex}">
    <div class="q-main">
      <p class="eyebrow">Tour ${state.round} · ${label} · ${rating ? 'Risque' : 'Question'} ${state.qIndex + 1} sur ${qs.length}</p>
      <h1 class="q-title">${esc(q.title)}</h1>
      ${rating ? (fb ? medianBoard(fb) : scalesLegend()) : `<p class="q-hint">${esc(q.hint)}</p>`}
      <div class="live" data-live>${liveAnalysis()}</div>
    </div>
    <div class="q-side">${dial('lg')}</div>
  </section>`;
}

function scalesLegend() {
  const row = (k) => `<div class="legend-row"><span class="legend-name">${SCALES[k].label}</span>${SCALES[k].steps.map((s, i) => `<span class="legend-step"><b class="num">${i + 1}</b>${esc(s)}</span>`).join('')}</div>`;
  return `<div class="legend">${row('p')}${row('i')}</div>`;
}

// Retour du groupe : la médiane en grand et les arguments anonymes des avis éloignés
function medianBoard(fb) {
  const prio = decisionById[priorityOf(fb.p, fb.i)];
  const big = (k, v) => `<div class="med-cell"><span class="med-label">${SCALES[k].label}</span><span class="med-value num">${fmt(v)}</span><span class="med-step">${esc(SCALES[k].steps[Math.round(v) - 1] || '')}</span></div>`;
  const args = fb.args || [];
  return `
  <div class="median-board">
    <div class="med-head"><span>Médiane du groupe au tour ${state.round - 1}</span>${fb.n ? `<span class="muted num">${fb.n} avis</span>` : ''}</div>
    <div class="med-row">
      ${big('p', fb.p)}
      <span class="med-x">×</span>
      ${big('i', fb.i)}
      <div class="med-cell prio ${prio.id}"><span class="med-label">Grille</span><span class="med-value">${prio.label.replace('Priorité ', 'P')}</span><span class="med-step">${esc(prio.action)}</span></div>
    </div>
    ${args.length ? `<div class="args"><span class="args-title">Arguments anonymes des avis éloignés</span>
      <ul>${args.map((a, k) => `<li style="--i:${k}"><span class="arg-dir ${a.dir}">${a.dir === 'up' ? 'Note plus haute' : 'Note plus basse'} <b class="num">P ${a.p} · G ${a.i}</b></span><q>${esc(a.why)}</q></li>`).join('')}</ul></div>` : '<p class="muted small args-none">Aucun argument donné au tour précédent</p>'}
  </div>`;
}

function liveAnalysis() {
  const qs = questionsFor(state.round);
  const q = qs[state.qIndex];
  if (!q) return '';
  const rows = answersOf(state.round).filter((a) => a.qkey === q.key);
  const total = participants.size;
  const byDept = DEPARTMENTS.map((d) => {
    const members = [...participants.values()].filter((p) => p.dept === d.id);
    const done = rows.filter((a) => participants.get(a.participant_id)?.dept === d.id).length;
    return { d, members: members.length, done };
  });
  let analysis = '';
  if (q.kind === 'text') {
    const a = analyzeOpen(rows, people());
    const cross = a.themes.filter((t) => t.depts.length >= 2).length;
    const pl = (n, one, many) => `<b class="num">${n}</b> ${n > 1 ? many : one}`;
    analysis = `<li>${pl(a.lines, 'idée reçue', 'idées reçues')}</li><li>${pl(a.themes.length, 'thème détecté', 'thèmes détectés')}</li><li>${pl(cross, 'cité par plusieurs départements', 'cités par plusieurs départements')}</li><li>${pl(a.other.length, 'réponse à classer', 'réponses à classer')}</li>`;
  } else {
    analysis = `<li><b class="num">${rows.length}</b> ${rows.length > 1 ? "notes reçues" : "note reçue"}</li><li>Médiane et dispersion révélées à la clôture</li>`;
  }
  const all = total > 0 && rows.length >= total;
  return `
    <div class="live-head">
      <span class="received"><b class="num">${rows.length}</b><span class="muted"> / ${total} réponses</span></span>
      ${all ? `<span class="all">${icon('check')} Tout le monde a répondu</span>` : ''}
    </div>
    <div class="bars">${byDept.map(({ d, members, done }) => `
      <div class="bar-row">
        <span class="bar-label"><i class="dot" style="--c:${d.color}"></i>${esc(d.name)}</span>
        <span class="track"><span class="fill" style="width:${members ? (100 * done) / members : 0}%;--c:${d.color}"></span></span>
        <span class="bar-num num">${done}/${members}</span>
      </div>`).join('')}
    </div>
    <ul class="live-facts"><li class="live-title">Analyse en direct</li>${analysis}</ul>`;
}

// Compte à rebours de 10 secondes
function interludeStage() {
  return `
  <section class="interlude">
    ${dial('xl')}
    <p class="interlude-label">Analyse des réponses du tour ${state.round}</p>
  </section>`;
}

// Résultats du tour 1, une question par vue
function results1Stage() {
  const { byQuestion, insights } = round1Analysis();
  const idx = Math.min(state.resultIndex, ROUND1_QUESTIONS.length - 1);
  const q = ROUND1_QUESTIONS[idx];
  const a = byQuestion[q.key];
  const max = Math.max(1, ...a.themes.map((t) => t.count));
  const shown = a.themes.slice(0, 9);
  const bars = shown.map((t, i) => `
    <li class="tbar ${i === 0 ? 'lead' : ''}" style="--i:${i}">
      <span class="tlabel">${esc(t.label)}${t.ai ? '<span class="new-tag">nouveau</span>' : ''}</span>
      <span class="ttrack"><span class="tfill" style="width:${(100 * t.count) / max}%"></span></span>
      <span class="tcount num">${t.count}</span>
      ${deptDots(t.depts)}
    </li>`).join('');
  const repeated = repeatedAnswers(answersOf(1).filter((x) => x.qkey === q.key)).slice(0, 8);
  return `
  <section class="results enter">
    <header class="res-head">
      <p class="eyebrow">Tour 1 · Identification · Résultats · Question ${idx + 1} sur ${ROUND1_QUESTIONS.length} ${aiBadge()}</p>
      <h2>${esc(q.title)}</h2>
    </header>
    <div class="res-grid">
      <div class="panel">
        <h3>${q.key === 'q4' ? 'Mesures proposées, regroupées' : 'Réponses regroupées par thème'} <span class="muted num">${a.lines} idées · ${a.respondents} participants</span></h3>
        ${shown.length ? `<ol class="tbars">${bars}</ol>` : '<p class="empty">Aucune réponse pour cette question</p>'}
        ${a.themes.length > shown.length ? `<p class="muted small">+ ${a.themes.length - shown.length} autres thèmes</p>` : ''}
        ${a.other.length ? `<p class="muted small">${a.other.length} réponse${a.other.length > 1 ? 's' : ''} hors catalogue, visible${a.other.length > 1 ? 's' : ''} à droite</p>` : ''}
      </div>
      <div class="side-stack">
        <div class="panel">
          <h3>Réponses les plus répétées</h3>
          ${repeated.length ? `<ul class="quotes">${repeated.map((r, i) => `<li style="--i:${i}"><span class="qtext">${esc(r.text)}</span><span class="qmeta">${r.count > 1 ? `<b class="num">×${r.count}</b>` : ''}${deptDots(r.depts)}</span></li>`).join('')}</ul>` : '<p class="empty">Rien à afficher</p>'}
          <p class="anon muted small">Réponses anonymes, seul le département est indiqué</p>
        </div>
        ${insightsPanel(insights)}
      </div>
    </div>
    ${legendDepts()}
  </section>`;
}

function repeatedAnswers(rows) {
  const map = new Map();
  const ppl = people();
  for (const a of rows) {
    for (const line of splitLines(a.payload?.text)) {
      const k = normalize(line).trim();
      const cur = map.get(k) || { text: line, count: 0, depts: new Set() };
      cur.count++;
      const d = ppl[a.participant_id]?.dept;
      if (d) cur.depts.add(d);
      map.set(k, cur);
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, depts: DEPARTMENTS.map((d) => d.id).filter((id) => r.depts.has(id)) }))
    .sort((a, b) => b.count - a.count || b.depts.length - a.depts.length);
}

function insightsPanel(list) {
  if (!list.length) return '';
  return `<div class="panel insights"><h3>Analyse automatique</h3><ul>${list.map((s, i) => `<li style="--i:${i}">${esc(s)}</li>`).join('')}</ul></div>`;
}

function legendDepts() {
  return `<footer class="dept-legend">${DEPARTMENTS.map((d) => `<span><i class="dot" style="--c:${d.color}"></i>${esc(d.name)}</span>`).join('')}</footer>`;
}

// Consolidation de la liste après le tour 1
function ensureConsolidation() {
  if (consolidation) return consolidation;
  const { candidates } = round1Analysis();
  const list = candidates.list;
  consolidation = {
    list,
    unmatched: candidates.unmatched,
    selected: new Set(list.slice(0, RULES.maxRisks).map((t) => t.id)),
    custom: [],
  };
  // Choix de l'animateur conservés si la page est rechargée pendant la consolidation
  try {
    const saved = JSON.parse(localStorage.getItem('delphi-consol:' + code));
    if (saved?.touched) {
      consolidation.custom = saved.custom || [];
      consolidation.selected = new Set(saved.selected || []);
      consolidation.touched = true;
    }
  } catch {}
  return consolidation;
}

function saveConsolidation() {
  if (!consolidation) return;
  try {
    localStorage.setItem('delphi-consol:' + code, JSON.stringify({ touched: true, selected: [...consolidation.selected], custom: consolidation.custom }));
  } catch {}
}

function consolidateStage() {
  const c = ensureConsolidation();
  const all = [...c.list.map((t) => ({ id: t.id, label: t.label, depts: t.depts, count: t.count })), ...c.custom.map((r) => ({ ...r, depts: [], count: null }))];
  const rows = all.map((t, i) => `
    <li>
      <button class="pick ${c.selected.has(t.id) ? 'on' : ''}" style="--i:${i}" data-act="toggle" data-id="${esc(t.id)}" aria-pressed="${c.selected.has(t.id)}">
        <span class="box">${icon('check')}</span>
        <span class="pnum num">${String(i + 1).padStart(2, '0')}</span>
        <span class="plabel">${esc(t.label)}</span>
        <span class="pmeta">${t.count != null ? `<span class="muted num">×${t.count}</span>${deptDots(t.depts)}` : '<span class="muted">ajouté</span>'}</span>
      </button>
    </li>`).join('');
  const unmatched = dedupLines(c.unmatched).slice(0, 8);
  return `
  <section class="consolidate enter">
    <header class="res-head">
      <p class="eyebrow">Analyse du tour 1 · Consolidation ${aiBadge()}</p>
      <h2>Liste des risques sans doublons</h2>
      <p class="muted">Les réponses identiques entre départements sont fusionnées. Gardez jusqu’à ${RULES.maxRisks} risques pour le tour de notation.</p>
    </header>
    <div class="res-grid">
      <div class="panel">
        <h3>Risques identifiés <span class="muted num">${c.selected.size} sélectionnés sur ${RULES.maxRisks}</span></h3>
        ${all.length ? `<ol class="picks">${rows}</ol>` : '<p class="empty">Aucun risque identifié, ajoutez-en à droite</p>'}
      </div>
      <div class="side-stack">
        <div class="panel">
          <h3>Ajouter un risque</h3>
          <form class="add" data-form="add"><input name="label" placeholder="Intitulé du risque" maxlength="90" autocomplete="off"><button class="btn" type="submit">${icon('plus')} Ajouter</button></form>
        </div>
        <div class="panel">
          <h3>Réponses hors catalogue</h3>
          ${unmatched.length ? `<ul class="quotes">${unmatched.map((u) => `<li><span class="qtext">${esc(u.text)}</span><button class="icon-btn" data-act="adopt" data-text="${esc(u.text)}" title="Ajouter comme risque">${icon('plus')}</button></li>`).join('')}</ul>` : '<p class="empty">Toutes les réponses ont été classées</p>'}
        </div>
      </div>
    </div>
  </section>`;
}

function dedupLines(list) {
  const map = new Map();
  for (const u of list) {
    const k = normalize(u.text).trim();
    if (!map.has(k)) map.set(k, u);
  }
  return [...map.values()];
}

// Résultats d'un tour de notation
function ratingViews() {
  return state.round >= 3 ? ['convergence', 'matrix', 'detail'] : ['matrix', 'detail'];
}

function ratingResultsStage() {
  const r = state.round;
  const results = ratingResults(r);
  const prev = r >= 3 ? analyzeRatings(answersOf(r - 1), risksOf(r)) : null;
  const ranked = [...results].filter((x) => x.n).sort(byPriority);
  const views = ratingViews();
  const view = views[Math.min(state.resultIndex, views.length - 1)];
  const titles = { matrix: 'Matrice des risques et classement', detail: 'Répartition des notes par risque', convergence: 'Convergence des avis' };
  let body = '';
  if (view === 'matrix') {
    body = `<div class="res-grid wide-left">
      <div class="panel matrix-panel">${matrixSvg(ranked)}</div>
      <div class="side-stack">
        <div class="panel">${rankTable(ranked)}</div>
        ${insightsPanel(insightsRatings(results, prev))}
      </div>
    </div>`;
  } else if (view === 'detail') {
    body = `<div class="hist-grid">${ranked.map((x, i) => histCard(x, i + 1)).join('')}</div>`;
  } else {
    body = `<div class="res-grid wide-left">
      <div class="panel">${convergence(results, prev)}</div>
      <div class="side-stack">${decisionPanel(results)}${insightsPanel(insightsRatings(results, prev))}</div>
    </div>`;
  }
  return `
  <section class="results enter">
    <header class="res-head">
      <p class="eyebrow">Tour ${r} · ${roundName(r)} · Résultats · Vue ${views.indexOf(view) + 1} sur ${views.length}</p>
      <h2>${titles[view]}</h2>
    </header>
    ${body}
  </section>`;
}

function cellLevel(p, i) {
  return priorityOf(p, i);
}

function matrixSvg(ranked) {
  const L = 64, T = 28, S = 84;
  let cells = '';
  for (let p = 1; p <= 5; p++) {
    for (let i = 1; i <= 5; i++) {
      cells += `<rect x="${L + (p - 1) * S}" y="${T + (5 - i) * S}" width="${S}" height="${S}" class="cell ${cellLevel(p, i)}"/>`;
    }
  }
  let axes = '';
  for (let k = 1; k <= 5; k++) {
    axes += `<text x="${L + (k - 0.5) * S}" y="${T + 5 * S + 26}" class="ax">${k}</text>`;
    axes += `<text x="${L - 20}" y="${T + (5 - k + 0.5) * S + 6}" class="ax">${k}</text>`;
  }
  // Position à la médiane, puis on écarte les pastilles qui se chevauchent
  const pts = ranked.map((x, idx) => ({
    x: L + (x.p.median - 0.5) * S + Math.cos(idx * 2.4) * 0.5,
    y: T + (5 - x.i.median + 0.5) * S + Math.sin(idx * 2.4) * 0.5,
  }));
  const minD = 34;
  for (let it = 0; it < 80; it++) {
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const dx = pts[b].x - pts[a].x;
        const dy = pts[b].y - pts[a].y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < minD) {
          const push = (minD - d) / 2;
          pts[a].x -= (dx / d) * push; pts[a].y -= (dy / d) * push;
          pts[b].x += (dx / d) * push; pts[b].y += (dy / d) * push;
        }
      }
    }
    pts.forEach((pt) => {
      pt.x = Math.max(L + 16, Math.min(L + 5 * S - 16, pt.x));
      pt.y = Math.max(T + 16, Math.min(T + 5 * S - 16, pt.y));
    });
  }
  const dots = pts.map((pt, idx) => `<g class="spot ${idx === 0 ? 'lead' : ''}" style="--i:${idx}" data-rank="${idx}" data-tip="${esc(`${idx + 1}. ${ranked[idx].label} · criticité ${fmt(ranked[idx].crit)}`)}">${idx === 0 ? `<circle class="ring" cx="${pt.x}" cy="${pt.y}" r="15"/>` : ''}<circle cx="${pt.x}" cy="${pt.y}" r="15"/><text x="${pt.x}" y="${pt.y + 5}">${idx + 1}</text></g>`).join('');
  return `<svg viewBox="0 0 ${L + 5 * S + 20} ${T + 5 * S + 60}" class="matrix" role="img" aria-label="Grille de notation probabilité gravité">
    <text x="${L - 40}" y="${T - 10}" class="ax-title" text-anchor="start">Gravité</text>
    ${cells}${axes}${dots}
    <text x="${L + 5 * S}" y="${T + 5 * S + 52}" class="ax-title" text-anchor="end">Probabilité</text>
  </svg>
  <div class="levels">${EVAL_CRITERIA.map((c) => `<span><i class="sw ${c.id}"></i>${c.label}</span>`).join('')}</div>`;
}

function rankTable(ranked) {
  return `<table class="rank">
    <thead><tr><th>#</th><th>Risque</th><th class="r">P</th><th class="r">G</th><th class="r">Criticité</th><th class="r">Accord</th></tr></thead>
    <tbody>${ranked.map((x, i) => `<tr style="--i:${i}" data-rank="${i}">
      <td class="num muted">${i + 1}</td>
      <td>${esc(x.label)}</td>
      <td class="r num">${fmt(x.p.median)}</td>
      <td class="r num">${fmt(x.i.median)}</td>
      <td class="r"><span class="lvl ${x.level?.id}">${fmt(x.crit)}</span></td>
      <td class="r num ${x.consensus ? 'ok' : 'warn'}">${pct(x.agreement)}</td>
    </tr>`).join('')}</tbody>
  </table>
  <p class="muted small">Accord : part des avis à ±1 de la médiane. Consensus à partir de ${pct(RULES.consensusShare)} en probabilité et en gravité.</p>`;
}

function histCard(x, rank) {
  const i = rank - 1;
  const hist = (s, label) => {
    const max = Math.max(1, ...s.dist);
    const med = Math.round(s.median ?? 0);
    return `<div class="hist"><span class="hist-label">${label} <b class="num">${fmt(s.median)}</b></span>
      <div class="hbars">${s.dist.map((v, k) => `<span class="hb ${k + 1 === med ? 'med' : ''}"><i style="height:${(100 * v) / max}%"></i><em class="num">${k + 1}</em></span>`).join('')}</div></div>`;
  };
  return `<article class="panel hcard" style="--i:${i}">
    <header><span class="num muted">${rank}</span><h4>${esc(x.label)}</h4><span class="tag ${x.consensus ? 'ok' : 'warn'}">${x.consensus ? 'Consensus' : 'Divergence'}</span></header>
    <div class="hists">${hist(x.p, 'Probabilité')}${hist(x.i, 'Gravité')}</div>
    <p class="muted small num">${x.n} avis · écart interquartile ${fmt(x.p.iqr)} et ${fmt(x.i.iqr)}</p>
  </article>`;
}

function convergence(results, prev) {
  const rows = results.map((x, i) => {
    const p = prev?.find((y) => y.id === x.id);
    const a = p?.n ? p.agreement : null;
    const b = x.agreement;
    const lo = a == null ? b : Math.min(a, b);
    const hi = a == null ? b : Math.max(a, b);
    return `<li class="conv-row" style="--i:${i}">
      <span class="conv-label">${esc(x.label)}</span>
      <span class="conv-track">
        <span class="threshold" style="left:${RULES.consensusShare * 100}%"></span>
        <span class="conv-seg" style="left:${lo * 100}%;width:${(hi - lo) * 100}%"></span>
        ${a != null ? `<span class="pt before" style="left:${a * 100}%"></span>` : ''}
        <span class="pt after ${x.consensus ? 'ok' : ''}" style="left:${b * 100}%;--from:${(a ?? b) * 100}%;--to:${b * 100}%"></span>
      </span>
      <span class="conv-val num">${a != null ? `${pct(a)} → ` : ''}<b>${pct(b)}</b></span>
      ${stabTag(stabilityOf(state.round, x, p))}
      <span class="tag ${x.consensus ? 'ok' : 'warn'}">${x.consensus ? 'Consensus' : 'À revoir'}</span>
    </li>`;
  }).join('');
  return `<h3>Accord entre les participants, tour ${state.round - 1} puis tour ${state.round}</h3>
    <ul class="conv">${rows}</ul>
    <div class="conv-legend muted small"><span><i class="pt-key before"></i>Tour ${state.round - 1}</span><span><i class="pt-key after"></i>Tour ${state.round}</span><span><i class="th-key"></i>Seuil de consensus ${pct(RULES.consensusShare)}</span></div>`;
}

function stabTag(s) {
  if (!s) return '<span></span>';
  return `<span class="stab ${s.stable ? 'on' : ''}" title="${pct(s.rate)} des participants ont changé leur note">${s.stable ? 'Stable' : 'Évolue'} <em class="num">${pct(s.rate)}</em></span>`;
}

// Où en est-on : consensus, réponses encore en mouvement, ou réponses stabilisées sans consensus
function openStatus(round = state.round) {
  const results = ratingResults(round);
  const prev = analyzeRatings(answersOf(round - 1), risksOf(round));
  const open = results.filter((x) => x.n && !x.consensus);
  const moving = open.filter((x) => !stabilityOf(round, x, prev.find((y) => y.id === x.id))?.stable);
  return { open, moving, stable: open.length - moving.length };
}

function decisionPanel(results) {
  const { open, moving } = openStatus();
  if (!open.length) {
    return `<div class="panel decision ok"><h3>Consensus atteint</h3><p>Tous les risques font consensus. La consultation peut s’arrêter et produire la liste hiérarchisée.</p></div>`;
  }
  if (!moving.length) {
    return `<div class="panel decision stable"><h3>Réponses stabilisées</h3><p>${open.length} risque${open.length > 1 ? 's restent' : ' reste'} sans consensus, mais les notes ne bougent presque plus : un nouveau tour n’apporterait rien. Selon la méthode, on clôt la consultation. Ces risques seront évalués avec le <b>principe de prudence</b>, et leurs positions opposées seront présentées dans la liste finale.</p></div>`;
  }
  return `<div class="panel decision"><h3>Pas encore de consensus</h3><p>${open.length} risque${open.length > 1 ? 's restent' : ' reste'} en dessous du seuil, dont ${moving.length} dont les notes évoluent encore. Selon la méthode, on relance un tour sur ${moving.length > 1 ? 'ces risques' : 'ce risque'}. Au-delà de 4 tours, la fatigue des participants compte : on peut aussi clore.</p></div>`;
}

function positionsHtml(pos) {
  const camp = (c, cls, label) => (c ? `<span class="pos ${cls}"><b>${label}</b> <span class="num">P ${fmt(c.p)} · G ${fmt(c.i)}</span> <span class="muted">(${c.n} avis)</span>${c.why ? `<q>${esc(c.why)}</q>` : ''}</span>` : '');
  return `<span class="positions">${camp(pos.high, 'up', 'Avis hauts')}${camp(pos.low, 'down', 'Avis bas')}</span>`;
}

// Évaluation : comparer chaque niveau aux critères et décider
function decisionOf(x) {
  const o = state.overrides?.[x.id];
  return (o && decisionById[o]) || autoDecision(x);
}

function evaluateStage() {
  const res = finalResults();
  const counts = Object.fromEntries(EVAL_CRITERIA.map((c) => [c.id, res.filter((x) => decisionOf(x).id === c.id).length]));
  const criteria = EVAL_CRITERIA.map((c, i) => `
    <li class="crit-row ${c.id}" style="--i:${i}">
      <span class="crit-band"></span>
      <span class="crit-range">${c.label}</span>
      <span class="crit-text"><b>${c.action}</b><span class="muted">${c.zone}</span><span class="muted">${c.text}</span></span>
      <span class="crit-count num">${counts[c.id]}</span>
    </li>`).join('');
  const rows = res.map((x, i) => {
    const d = decisionOf(x);
    const auto = autoDecision(x);
    return `<li class="eval-row" style="--i:${i}">
      <span class="num muted">${i + 1}</span>
      <span class="eval-label">${esc(x.label)}${isPrudent(x) ? `<span class="prudent" title="Sans consensus : évalué avec l’avis haut (3e quartile)">prudence · P ${Math.ceil(x.p.q3)} · G ${Math.ceil(x.i.q3)}</span>` : ''}${d.id !== auto.id ? '<span class="changed">modifié</span>' : ''}</span>
      <span class="lvl ${decisionOf(x).id}">${fmt(x.crit)}</span>
      <span class="decide">${EVAL_CRITERIA.map((c) => `<button class="${c.id} ${c.id === d.id ? 'on' : ''}" data-act="decide" data-id="${esc(x.id)}" data-d="${c.id}" aria-pressed="${c.id === d.id}">${c.label} · ${c.action}</button>`).join('')}</span>
    </li>`;
  }).join('');
  return `
  <section class="evaluate enter">
    <header class="res-head">
      <p class="eyebrow">Évaluation du risque · ISO 31000</p>
      <h2>Comparer chaque niveau aux critères de ${esc(SCENARIO.company)}</h2>
      <p class="muted">Le niveau vient de l’analyse des experts. La décision appartient à l’organisation : cliquez pour la modifier.</p>
    </header>
    <div class="res-grid eval-grid">
      <div class="panel">
        <h3>Critères de risque <span class="muted">grille de notation du cours</span></h3>
        <ol class="criteria">${criteria}</ol>
        <p class="muted small">La priorité vient de la case de la grille où tombe le risque : probabilité médiane et gravité médiane. La criticité affichée est probabilité × gravité, sur 25.</p>
      </div>
      <div class="panel">
        <h3>Décision par risque <span class="muted">classés par priorité puis criticité</span></h3>
        <ol class="eval-list">${rows}</ol>
      </div>
    </div>
  </section>`;
}

// Résultat final
function finalStage() {
  const res = finalResults().sort((a, b) => Number(decisionOf(a).id.slice(1)) - Number(decisionOf(b).id.slice(1)) || b.crit - a.crit);
  const ok = res.filter((x) => x.consensus).length;
  const rounds = Math.max(1, ...ratingRounds());
  return `
  <section class="final enter">
    <header class="res-head">
      <p class="eyebrow">Résultat de la consultation Delphi</p>
      <h2>Liste hiérarchisée des risques du lancement de la ligne</h2>
      <p class="muted num">${rounds} tours · ${participants.size} participants · consensus sur ${ok} risque${ok > 1 ? 's' : ''} sur ${res.length}</p>
    </header>
    <div class="res-grid wide-left">
      <div class="panel">
        <table class="rank final-table">
          <thead><tr><th>#</th><th>Risque</th><th class="r">P</th><th class="r">G</th><th class="r">Criticité</th><th>Décision</th><th>Mesures de maîtrise proposées</th></tr></thead>
          <tbody>${res.map((x, i) => `<tr style="--i:${i}" data-rank="${i}">
            <td class="num muted">${i + 1}</td>
            <td><span class="rname">${esc(x.label)}</span><span class="muted small">${x.consensus ? 'Consensus' : 'Sans consensus'} · tour ${x.lastRound}</span>${x.consensus ? '' : positionsHtml(positionsOf(x))}</td>
            <td class="r num">${fmt(x.p.median)}</td>
            <td class="r num">${fmt(x.i.median)}</td>
            <td class="r"><span class="lvl ${decisionOf(x).id}">${fmt(x.crit)}</span></td>
            <td><span class="dec ${decisionOf(x).id}">${decisionOf(x).label} · ${decisionOf(x).action}</span>${isPrudent(x) ? '<span class="prudent block">principe de prudence</span>' : ''}</td>
            <td>${x.top.length ? `<ul class="measures">${x.top.map((m) => `<li>${esc(m.text)}${m.count > 1 ? ` <span class="muted num">×${m.count}</span>` : ''}</li>`).join('')}</ul>` : '<span class="muted">Aucune proposition</span>'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="side-stack">
        <div class="panel matrix-panel small-matrix">${matrixSvg(res)}</div>
      </div>
    </div>
  </section>`;
}

// ---------- Barre de commandes ----------

function controls() {
  const k = (key, label) => `<span class="hint"><kbd>${key}</kbd>${label}</span>`;
  const hints = `<div class="hints">${k('→', 'suivant')}${k('Espace', 'pause')}${k('F', 'plein écran')}${state.phase === 'lobby' ? k('Q', 'agrandir le QR') : ''}</div>`;
  const b = (act, label, cls = '', ic = '') => `<button class="btn ${cls}" data-act="${act}">${label}${ic ? icon(ic) : ''}</button>`;
  let right = '';
  switch (state.phase) {
    case 'scenario':
      right = b('toLobby', 'Afficher le QR code', 'primary', 'arrow-right');
      break;
    case 'lobby':
      right = `${b('toScenario', 'Revoir le scénario', 'ghost')}${b('zoomQr', 'Agrandir le QR code', '', 'maximize')}${state.settings?.rehearsal ? b('addBots', 'Ajouter 20 participants fictifs', '', 'user-plus') : ''}${state.settings?.quizOnly ? b('startQuiz', 'Démarrer le quiz', 'primary', 'arrow-right') : `${state.settings?.simulation ? b('startQuiz', 'Tester le quiz', 'ghost') : ''}${b('startRound1', 'Démarrer le tour 1 · Identification', 'primary', 'arrow-right')}`}`;
      break;
    case 'question': {
      const qs = questionsFor(state.round);
      const last = state.qIndex >= qs.length - 1;
      const paused = state.timer?.pausedLeft != null;
      right = `${b('addTime', '+30 s', 'ghost')}${b('pause', paused ? 'Reprendre' : 'Pause', '', paused ? 'play' : 'pause')}${b('next', last ? 'Clore le tour' : state.round === 1 ? 'Question suivante' : 'Risque suivant', 'primary', 'skip')}`;
      break;
    }
    case 'interlude':
      right = b('next', 'Voir les résultats', 'primary', 'skip');
      break;
    case 'results': {
      const count = state.round === 1 ? ROUND1_QUESTIONS.length : ratingViews().length;
      const nav = `<div class="pager">${b('prevView', '', 'icon', 'chevron-left')}<span class="num">${Math.min(state.resultIndex, count - 1) + 1} / ${count}</span>${b('nextView', '', 'icon', 'chevron-right')}</div>`;
      if (state.round === 1) right = nav + (ai?.status === 'pending' ? '' : b('rerunAi', 'Relancer l’IA', 'ghost', 'rotate')) + b('toConsolidate', 'Consolider la liste', 'primary', 'arrow-right');
      else if (state.round === 2) right = nav + b('toEvaluate', 'Clore et évaluer', 'ghost') + b('nextRound', 'Lancer le tour 3 · Convergence', 'primary', 'arrow-right');
      else {
        const st = openStatus();
        const n = st.moving.length;
        const closeFirst = st.open.length && (!n || state.round >= 4);
        right = nav + (!st.open.length
          ? b('toEvaluate', 'Passer à l’évaluation', 'primary', 'arrow-right')
          : closeFirst
            ? (n ? b('nextRound', `Tour ${state.round + 1} sur ${n} risque${n > 1 ? 's' : ''}`, 'ghost') : '') + b('toEvaluate', 'Clore et évaluer', 'primary', 'arrow-right')
            : b('toEvaluate', 'Clore et évaluer', 'ghost') + b('nextRound', `Tour ${state.round + 1} sur ${n} risque${n > 1 ? 's' : ''}`, 'primary', 'arrow-right'));
      }
      break;
    }
    case 'consolidate': {
      const n = consolidation?.selected.size ?? 0;
      right = `${b('backResults', 'Revoir les résultats', 'ghost')}<button class="btn primary" data-act="startRound2" ${n ? '' : 'disabled'}>Lancer le tour 2 · Analyse avec ${n} risque${n > 1 ? 's' : ''}${icon('arrow-right')}</button>`;
      break;
    }
    case 'evaluate':
      right = `${b('backRatings', 'Revoir les résultats', 'ghost')}${b('toFinal', 'Valider l’évaluation', 'primary', 'arrow-right')}`;
      break;
    case 'final':
      right = `${b('backEvaluate', 'Revoir l’évaluation', 'ghost')}` + `${b('newSession', 'Nouvelle session', 'ghost', 'rotate')}${b('print', 'Imprimer', '', 'printer')}${b('csv', 'Exporter en CSV', '', 'download')}${b('startQuiz', 'Lancer le quiz', 'primary', 'arrow-right')}`;
      break;
    case 'quiz': {
      const z = state.quiz;
      const last = z.index >= QUIZ.length - 1;
      if (z.stage === 'intro') right = b('quizNext', 'Commencer le quiz', 'primary', 'arrow-right');
      else if (z.stage === 'question') right = b('quizNext', 'Afficher la réponse', 'primary', 'skip');
      else if (z.stage === 'reveal') right = b('quizNext', 'Classement', 'primary', 'arrow-right');
      else if (z.stage === 'board') right = b('quizNext', last ? 'Voir le podium' : 'Question suivante', 'primary', 'arrow-right');
      else right = `${state.settings?.quizOnly ? '' : b('backFinal', 'Revenir au résultat Delphi', 'ghost')}${b('newSession', 'Nouvelle session', '', 'rotate')}`;
      break;
    }
  }
  return `<footer class="controls">${hints}<div class="actions">${right}</div></footer>`;
}

// ---------- Actions ----------

const actions = {
  resume: () => {
    location.hash = '#/host/' + localStorage.getItem(SAVED);
  },
  fullscreen: toggleFullscreen,
  toLobby: () => {
    setState({ phase: 'lobby' });
    if (state.settings?.simulation) trickleBots();
  },
  simulate: async () => {
    const settings = { duration: 40, rating: 25, rehearsal: true, simulation: true };
    const c = newCode();
    const initial = { phase: 'scenario', round: 0, qIndex: 0, timer: null, risks: [], roundRisks: {}, feedback: {}, resultIndex: 0, settings, sentAt: Date.now() };
    try {
      await store.createSession(c, initial);
      location.hash = '#/host/' + c;
    } catch (err) {
      renderLanding('Impossible de créer la simulation : ' + (err.message || err));
    }
  },
  togglePhone: () => togglePhone(),
  startQuiz: () => {
    clearBots();
    setState({ phase: 'quiz', round: 100, qIndex: 0, timer: null, quizFrom: { phase: state.phase, round: state.round }, quiz: { index: 0, key: QUIZ[0].id, stage: 'intro', duration: QUIZ_DURATION } });
  },
  quizNext: () => quizNext(),
  backFinal: () => {
    clearBots();
    setState({ phase: state.quizFrom?.phase || 'final', round: state.quizFrom?.round ?? 3, timer: null });
  },
  quizOnly: async () => {
    const settings = { duration: 180, rating: 90, rehearsal: false, quizOnly: true };
    const c = newCode();
    try {
      await store.createSession(c, { phase: 'lobby', round: 0, qIndex: 0, timer: null, risks: [], roundRisks: {}, feedback: {}, resultIndex: 0, settings, sentAt: Date.now() });
      location.hash = '#/host/' + c;
    } catch (err) {
      renderLanding('Impossible de créer le quiz : ' + (err.message || err));
    }
  },
  zoomQr: () => openQrZoom(),
  takeOver: () => {
    passive = false;
    setState({ hostId: INSTANCE });
  },
  toScenario: () => setState({ phase: 'scenario' }),
  addBots,
  startRound1: () => startQuestion(1, 0),
  addTime: () => {
    const t = state.timer;
    if (!t) return;
    if (t.pausedLeft != null) setState({ timer: { ...t, pausedLeft: t.pausedLeft + 30, duration: t.duration + 30 } });
    else setState({ timer: { ...t, endsAt: t.endsAt + 30000, duration: t.duration + 30 } });
  },
  pause: togglePause,
  next: () => {
    if (state.phase === 'question') nextQuestion();
    else if (state.phase === 'interlude') showResults();
  },
  prevView: () => setState({ resultIndex: Math.max(0, state.resultIndex - 1) }),
  nextView: () => {
    const count = state.round === 1 ? ROUND1_QUESTIONS.length : ratingViews().length;
    setState({ resultIndex: Math.min(count - 1, state.resultIndex + 1) });
  },
  rerunAi: () => runAi(),
  toConsolidate: () => {
    consolidation = null;
    ensureConsolidation();
    setState({ phase: 'consolidate' });
  },
  backResults: () => setState({ phase: 'results', round: 1, resultIndex: 0 }),
  toggle: (el) => {
    const c = ensureConsolidation();
    c.touched = true;
    const id = el.dataset.id;
    if (c.selected.has(id)) c.selected.delete(id);
    else if (c.selected.size < RULES.maxRisks) c.selected.add(id);
    else toast(`Maximum ${RULES.maxRisks} risques pour garder un tour de notation court`);
    saveConsolidation();
    render();
  },
  adopt: (el) => addCustom(el.dataset.text),
  startRound2: () => {
    const c = ensureConsolidation();
    const all = [...c.list.map((t) => ({ id: t.id, label: t.label })), ...c.custom];
    // Un risque n'entre qu'une fois dans la notation, même s'il a deux origines (IA, mots-clés, ajout manuel)
    const seen = new Set();
    const risks = all.filter((r) => {
      if (!c.selected.has(r.id)) return false;
      const k = normalize(r.label);
      if (seen.has(r.id) || seen.has(k)) return false;
      seen.add(r.id);
      seen.add(k);
      return true;
    });
    if (!risks.length) return;
    startQuestion(2, 0, { risks, roundRisks: { 2: risks.map((r) => r.id) }, feedback: {} });
  },
  nextRound: () => {
    const r = state.round;
    const results = ratingResults(r);
    const ids = r === 2 ? results.map((x) => x.id) : openStatus(r).moving.map((x) => x.id);
    const fb = Object.fromEntries(results.map((x) => [x.id, { p: x.p.median, i: x.i.median, n: x.n, args: argsFor(r, x) }]));
    startQuestion(r + 1, 0, {
      roundRisks: { ...state.roundRisks, [r + 1]: ids },
      feedback: { ...state.feedback, [r + 1]: fb },
    });
  },
  toEvaluate: () => setState({ phase: 'evaluate', timer: null, overrides: state.overrides || {} }),
  backRatings: () => setState({ phase: 'results', resultIndex: 0 }),
  backEvaluate: () => setState({ phase: 'evaluate' }),
  decide: (el) => {
    const { id, d } = el.dataset;
    const risk = finalResults().find((x) => x.id === id);
    const overrides = { ...(state.overrides || {}) };
    if (risk && autoDecision(risk).id === d) delete overrides[id];
    else overrides[id] = d;
    setState({ overrides });
  },
  toFinal: () => setState({ phase: 'final', timer: null }),
  csv: exportCsv,
  print: () => window.print(),
  newSession: () => {
    if (!confirm('Créer une nouvelle session ? La session actuelle reste enregistrée.')) return;
    localStorage.removeItem(SAVED);
    location.hash = '#/';
    location.reload();
  },
};

function addCustom(label) {
  const text = String(label || '').trim();
  if (!text) return;
  const c = ensureConsolidation();
  c.touched = true;
  const id = 'c' + (c.custom.length + 1) + '-' + Math.random().toString(36).slice(2, 6);
  c.custom.push({ id, label: text.charAt(0).toUpperCase() + text.slice(1) });
  if (c.selected.size < RULES.maxRisks) c.selected.add(id);
  saveConsolidation();
  render();
  app.querySelector('[data-form="add"] input')?.focus();
}

function startQuestion(round, qIndex, extra = {}) {
  const tmp = { ...state, ...extra, round };
  const duration = round === 1 ? tmp.settings.duration : tmp.settings.rating;
  firedFor = null;
  setState({ ...extra, phase: 'question', round, qIndex, resultIndex: 0, timer: { duration, endsAt: Date.now() + duration * 1000, pausedLeft: null } });
  scheduleBots();
}

function nextQuestion() {
  const qs = questionsFor(state.round);
  if (state.qIndex + 1 < qs.length) startQuestion(state.round, state.qIndex + 1);
  else {
    clearBots();
    firedFor = null;
    if (state.round === 1) setTimeout(runAi, 400);
    setState({ phase: 'interlude', timer: { duration: RULES.interlude, endsAt: Date.now() + RULES.interlude * 1000, pausedLeft: null } });
  }
}

async function showResults() {
  firedFor = null;
  await refreshAll();
  setState({ phase: 'results', resultIndex: 0, timer: null });
}

function togglePause() {
  const t = state.timer;
  if (!t || state.phase !== 'question') return;
  if (t.pausedLeft != null) setState({ timer: { ...t, endsAt: Date.now() + t.pausedLeft * 1000, pausedLeft: null } });
  else setState({ timer: { ...t, pausedLeft: Math.max(0, (t.endsAt - Date.now()) / 1000), endsAt: null } });
}

function tick() {
  if (state?.phase === 'quiz') return quizTick();
  if (!state || !state.timer || (state.phase !== 'question' && state.phase !== 'interlude')) return;
  const t = state.timer;
  const left = t.pausedLeft != null ? t.pausedLeft : (t.endsAt - Date.now()) / 1000;
  const d = app.querySelector('.dial');
  updateDial(d, left, t.duration, t.pausedLeft != null);
  if (state.phase === 'interlude' && d) {
    const el = d.querySelector('[data-time]');
    const v = String(Math.max(0, Math.ceil(left)));
    if (el.dataset.v !== v) {
      el.dataset.v = v;
      el.classList.remove('tickpop');
      void el.offsetWidth;
      el.classList.add('tickpop');
    }
    el.textContent = v;
  }
  if (state.phase === 'interlude' && d) d.querySelector('[data-label]').textContent = 'secondes';
  const token = `${state.phase}-${state.round}-${state.qIndex}`;
  if (state.settings?.simulation && !passive) simulationShortcut(left, token);
  if (!passive && left <= 0 && t.pausedLeft == null && firedFor !== token) {
    firedFor = token;
    if (state.phase === 'question') nextQuestion();
    else showResults();
  }
}

function exportCsv() {
  const res = finalResults().sort((a, b) => Number(decisionOf(a).id.slice(1)) - Number(decisionOf(b).id.slice(1)) || b.crit - a.crit);
  const head = ['Rang', 'Risque', 'Probabilité médiane', 'Gravité médiane', 'Criticité', 'Priorité', 'Décision', 'Prudence', 'Accord', 'Consensus', 'Dernier tour', 'Mesures proposées'];
  const rows = res.map((x, i) => [i + 1, x.label, fmt(x.p.median), fmt(x.i.median), fmt(x.crit), decisionOf(x).label, decisionOf(x).action, isPrudent(x) ? 'Oui (3e quartile)' : '', pct(x.agreement), x.consensus ? 'Oui' : 'Non', x.lastRound, x.top.map((m) => m.text).join(' | ')]);
  const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `delphi-${code}-resultats.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

let toastTimer;
function toast(msg, ms = 3200) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function bindGlobal() {
  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (passive && !['takeOver', 'fullscreen', 'zoomQr'].includes(el.dataset.act)) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el);
  });
  app.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form="add"]');
    if (!form) return;
    e.preventDefault();
    addCustom(new FormData(form).get('label'));
  });
  document.addEventListener('keydown', (e) => {
    if (!state || e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape') closeQrZoom();
    else if ((e.key === 'q' || e.key === 'Q') && state.phase === 'lobby') {
      if (document.querySelector('.qr-zoom')) closeQrZoom();
      else openQrZoom();
    } else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === ' ' && state.phase === 'question') { e.preventDefault(); togglePause(); }
    else if (e.key === 'ArrowRight') {
      if (state.phase === 'results') actions.nextView();
      else if (state.phase === 'question' || state.phase === 'interlude') actions.next();
      else if (state.phase === 'quiz' && state.quiz.stage !== 'podium') quizNext();
    } else if (e.key === 'ArrowLeft' && state.phase === 'results') actions.prevView();
  });
}

// ---------- Participants fictifs pour répéter ----------

const TRUTH = {
  machines: [4, 5], demarrage: [4, 5], penalites: [3, 4], fournisseur: [3, 5], stock: [3, 3], cout_matiere: [3, 3],
  capacite: [4, 3], pannes: [3, 4], pieces: [3, 3], maint_prev: [3, 3], reglage: [3, 3], qualite: [3, 4], audit: [2, 5],
  recrutement: [4, 4], formation: [4, 3], absence: [3, 2], securite: [2, 4], budget: [3, 3], planification: [3, 3], client: [2, 5],
};
const clamp = (x) => Math.max(1, Math.min(5, Math.round(x)));

async function addBots() {
  const existing = new Set([...participants.values()].map((p) => p.name));
  const names = shuffle(BOT_NAMES.filter((n) => !existing.has(n)));
  const list = [];
  for (let k = 0; k < 20; k++) {
    const name = names[k] || `Étudiant ${participants.size + k + 1}`;
    list.push({ id: uid(), name, dept: DEPARTMENTS[(participants.size + k) % DEPARTMENTS.length].id, bot: true });
  }
  list.forEach((p) => participants.set(p.id, { ...p, joined_at: new Date().toISOString() }));
  renderLive();
  await store.joinMany(code, list);
}

function clearBots() {
  botTimers.forEach(clearTimeout);
  botTimers = [];
}

function scheduleBots() {
  clearBots();
  if (!state.settings?.rehearsal) return;
  const qs = questionsFor(state.round);
  const q = qs[state.qIndex];
  if (!q) return;
  const bots = [...participants.values()].filter((p) => p.bot);
  const spreadMs = Math.min(state.timer.duration * 0.4, 14) * 1000;
  const prevAgreement = state.round >= 3 ? analyzeRatings(answersOf(state.round - 1), [{ id: q.key, label: q.title }])[0].agreement : null;
  for (const p of bots) {
    if (answers.has(`${p.id}|${state.round}|${q.key}`)) continue;
    if (!state.settings?.simulation && Math.random() < 0.06) continue;
    const delay = 1200 + Math.random() * spreadMs;
    const round = state.round;
    const stubborn = round >= 3 && (prevAgreement ?? 1) < 0.72 && Math.random() < (round === 3 ? 0.6 : 0.05);
    botTimers.push(setTimeout(() => {
      if (state.phase !== 'question' || state.round !== round) return;
      store.hostAnswers(code, [{ participant_id: p.id, round, qkey: q.key, payload: botPayload(p, round, q, stubborn) }]).catch(() => {});
    }, delay));
  }
}

function botPayload(p, round, q, stubborn = false) {
  if (round === 1) {
    const lines = shuffle(BOT_LINES[p.dept][q.key]).slice(0, 1 + Math.floor(Math.random() * (q.key === 'q4' ? 2 : 3)));
    return { text: lines.join('\n') };
  }
  const [tp, ti] = TRUTH[q.key] || [2 + (q.key.length % 3), 3];
  const own = (BOT_LINES[p.dept].q1 || []).some((l) => matchThemes(l).includes(q.key));
  const noise = () => pick([-2, -1, -1, 0, 0, 0, 0, 1, 1, 2]);
  if (round === 2) {
    const out = { p: clamp(tp + noise()), i: clamp(ti + noise() + (own ? 1 : 0)) };
    const d = out.p + out.i - tp - ti;
    if (Math.abs(d) >= 2 && Math.random() < 0.8) out.why = pick(BOT_ARGS[d > 0 ? 'up' : 'down']);
    return out;
  }
  const prev = answers.get(`${p.id}|${round - 1}|${q.key}`)?.payload || { p: clamp(tp + noise()), i: clamp(ti + noise()) };
  const fb = state.feedback?.[round]?.[q.key] || { p: tp, i: ti };
  const toward = stubborn
    ? (a, m) => clamp(a + (Math.random() < 0.5 ? Math.sign(a - m || pick([-1, 1])) : 0))
    : (a, m) => clamp(a + (m - a) * (0.6 + Math.random() * 0.35) + (Math.random() < 0.08 ? pick([-1, 1]) : 0));
  const np = toward(prev.p, fb.p);
  const ni = toward(prev.i, fb.i);
  const out = { p: np, i: ni };
  if (Math.abs(np - fb.p) >= RULES.justifyGap || Math.abs(ni - fb.i) >= RULES.justifyGap) out.why = pick(BOT_ARGS[np + ni >= fb.p + fb.i ? 'up' : 'down']);
  if (Math.random() < 0.6) out.measure = Math.random() < 0.75 && BOT_MEASURES[q.key] ? BOT_MEASURES[q.key] : pick(['Nommer un responsable et suivre chaque semaine', 'Prévoir un plan B validé par la direction']);
  return out;
}

export { deptById };


// ---------- Simulation (temporaire, pour vérifier le déroulement sans téléphones) ----------

let trickling = false;
// Les étudiants fictifs arrivent un par un dans la salle d'attente, comme en vrai
async function trickleBots() {
  if (trickling) return;
  trickling = true;
  const taken = new Set([...participants.values()].map((p) => p.name));
  const names = shuffle(BOT_NAMES.filter((n) => !taken.has(n)));
  for (let k = 0; k < 20 && state.phase === 'lobby'; k++) {
    const p = { id: uid(), name: names[k] || `Étudiant ${k + 1}`, dept: DEPARTMENTS[k % DEPARTMENTS.length].id, bot: true };
    participants.set(p.id, { ...p, joined_at: new Date().toISOString() });
    queueRender();
    store.joinMany(code, [p]).catch(() => {});
    await new Promise((r) => setTimeout(r, 350 + Math.random() * 650));
  }
  trickling = false;
}

// Quand tout le monde a répondu, le compte à rebours passe à 3 secondes pour ne pas attendre
let shortened = null;
function simulationShortcut(left, token) {
  if (state.phase !== 'question' || shortened === token || left <= 4 || state.timer.pausedLeft != null) return;
  const q = questionsFor(state.round)[state.qIndex];
  if (!q || !participants.size) return;
  const done = [...participants.keys()].filter((id) => answers.has(`${id}|${state.round}|${q.key}`)).length;
  if (done < participants.size) return;
  shortened = token;
  setState({ timer: { ...state.timer, endsAt: Date.now() + 3000 } });
}

// Un téléphone simulé à côté du tableau : c'est la vraie page étudiant, on peut y répondre soi-même
function togglePhone() {
  let el = document.querySelector('.sim-phone');
  if (el) {
    el.remove();
    return;
  }
  el = document.createElement('aside');
  el.className = 'sim-phone';
  el.innerHTML = `<div class="sim-phone-bar"><span>Vue étudiant</span><button class="icon-btn" data-close aria-label="Fermer">${icon('x')}</button></div>
    <iframe title="Téléphone simulé" src="${location.pathname}${location.search}#/join/${code}"></iframe>`;
  el.querySelector('[data-close]').addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}


// ---------- Quiz de fin, façon Kahoot ----------

const quizAnswers = (key) => [...answers.values()].filter((a) => a.round === 100 && a.qkey === key && participants.has(a.participant_id));

// Score cumulé jusqu'à la question `upto` incluse
function quizScores(upto) {
  const rows = new Map([...participants.values()].map((p) => [p.id, { p, total: 0, gained: 0, correct: null }]));
  QUIZ.slice(0, upto + 1).forEach((z, i) => {
    for (const a of quizAnswers(z.id)) {
      const r = rows.get(a.participant_id);
      if (!r) continue;
      const pts = quizPoints(Number(a.payload?.c) === z.c, a.payload?.ms);
      r.total += pts;
      if (i === upto) {
        r.gained = pts;
        r.correct = pts > 0;
      }
    }
  });
  return [...rows.values()].sort((a, b) => b.total - a.total || a.p.name.localeCompare(b.p.name));
}

function quizOpen(i) {
  const z = QUIZ[i];
  firedFor = null;
  setState({ qIndex: i, quiz: { index: i, key: z.id, stage: 'question', duration: QUIZ_DURATION }, timer: { endsAt: Date.now() + QUIZ_DURATION * 1000, duration: QUIZ_DURATION } });
  scheduleQuizBots(z);
}

async function quizReveal() {
  clearBots();
  await refreshAll();
  const z = state.quiz;
  const ranks = quizScores(z.index);
  // Résultat de chacun, lu par son téléphone : [rang, total, points gagnés, juste (1), faux (0) ou sans réponse (-1)]
  const res = {};
  ranks.forEach((r, k) => { res[r.p.id] = [k + 1, r.total, r.gained, r.correct === null ? -1 : r.correct ? 1 : 0]; });
  setState({ timer: null, quiz: { ...z, stage: 'reveal', correct: QUIZ[z.index].c, res } });
}

function quizNext() {
  const z = state.quiz;
  if (z.stage === 'intro') return quizOpen(0);
  if (z.stage === 'question') return quizReveal();
  if (z.stage === 'reveal') return setState({ quiz: { ...z, stage: 'board' } });
  if (z.stage === 'board') {
    if (z.index >= QUIZ.length - 1) return setState({ quiz: { ...z, stage: 'podium' } });
    return quizOpen(z.index + 1);
  }
}

let quizFired = null;
function quizTick() {
  const z = state.quiz;
  if (!z || z.stage !== 'question' || !state.timer || passive) return;
  const left = (state.timer.endsAt - Date.now()) / 1000;
  const el = app.querySelector('[data-qtime]');
  const v = String(Math.max(0, Math.ceil(left)));
  if (el && el.textContent !== v) {
    el.textContent = v;
    el.classList.toggle('low', left <= 5);
  }
  const bar = app.querySelector('[data-qbar]');
  if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, left / z.duration))})`;
  // Fin du temps, ou tout le monde a répondu : on révèle la réponse
  const all = participants.size > 0 && quizAnswers(z.key).length >= participants.size;
  if ((left <= 0 || all) && quizFired !== z.key) {
    quizFired = z.key;
    setTimeout(quizReveal, all && left > 0 ? 600 : 0);
  }
}

function scheduleQuizBots(z) {
  clearBots();
  if (!state.settings?.rehearsal) return;
  const bots = [...participants.values()].filter((p) => p.bot);
  for (const p of bots) {
    const ms = 1500 + Math.random() * 11000;
    const right = Math.random() < 0.72;
    const wrong = z.a.map((_, k) => k).filter((k) => k !== z.c);
    const c = right ? z.c : pick(wrong);
    botTimers.push(setTimeout(() => {
      if (state.phase !== 'quiz' || state.quiz.key !== z.id || state.quiz.stage !== 'question') return;
      const row = { participant_id: p.id, round: 100, qkey: z.id, payload: { c, ms: Math.round(ms) } };
      answers.set(akey(row), row);
      renderLive();
      store.hostAnswers(code, [row]).catch(() => {});
    }, ms));
  }
}

function quizTiles(z, reveal) {
  const counts = z.a.map((_, k) => quizAnswers(z.id).filter((a) => Number(a.payload?.c) === k).length);
  return `<div class="qtiles n${z.a.length}">${z.a.map((t, k) => `
    <div class="qtile ${reveal ? (k === z.c ? 'right' : 'wrong') : ''}" style="--qc:${QUIZ_COLORS[k]}">
      ${quizShape(k)}<span class="qt-text">${esc(t)}</span>
      ${reveal ? `<span class="qt-count num">${counts[k]}</span>${k === z.c ? `<span class="qt-check">${icon('check')}</span>` : ''}` : ''}
    </div>`).join('')}</div>`;
}

function quizBars(z) {
  const counts = z.a.map((_, k) => quizAnswers(z.id).filter((a) => Number(a.payload?.c) === k).length);
  const max = Math.max(1, ...counts);
  return `<div class="qbars">${counts.map((n, k) => `
    <div class="qbar-col ${k === z.c ? 'right' : ''}" style="--qc:${QUIZ_COLORS[k]}">
      <span class="qb-n num">${n}${k === z.c ? icon('check') : ''}</span>
      <span class="qb-bar" style="--h:${Math.max(4, (n / max) * 100)}%"></span>
      <span class="qb-shape">${quizShape(k)}</span>
    </div>`).join('')}</div>`;
}

function quizStage() {
  const zs = state.quiz;
  const z = QUIZ[zs.index];
  const head = `<p class="eyebrow">Quiz · Question ${zs.index + 1} sur ${QUIZ.length}</p>`;
  if (zs.stage === 'intro') {
    return `<section class="quiz quiz-intro enter">
      <p class="eyebrow">Quiz · ${QUIZ.length} questions</p>
      <h1>Avez-vous bien suivi la présentation ?</h1>
      <p class="lead">Répondez sur votre téléphone. Plus vous répondez vite, plus vous gagnez de points.</p>
      <div class="quiz-legend">${QUIZ_COLORS.map((c, k) => `<span style="--qc:${c}">${quizShape(k)}</span>`).join('')}</div>
      <p class="muted"><b class="num">${participants.size}</b> joueurs connectés</p>
    </section>`;
  }
  if (zs.stage === 'question') {
    return `<section class="quiz enter" data-q="quiz-${zs.index}">
      ${head}
      <h1 class="quiz-q">${esc(z.q)}</h1>
      <div class="quiz-mid">
        <div class="quiz-timer"><b class="num" data-qtime>${QUIZ_DURATION}</b></div>
        <div class="quiz-bar"><span data-qbar></span></div>
        <div class="quiz-count"><b class="num" data-qcount>${quizAnswers(z.id).length}</b><span>réponses</span></div>
      </div>
      ${quizTiles(z, false)}
    </section>`;
  }
  if (zs.stage === 'reveal') {
    return `<section class="quiz enter">
      ${head}
      <h1 class="quiz-q">${esc(z.q)}</h1>
      ${quizBars(z)}
      ${quizTiles(z, true)}
    </section>`;
  }
  const ranks = quizScores(zs.index);
  if (zs.stage === 'board') {
    const top = ranks.slice(0, 5);
    const max = Math.max(1, ...top.map((r) => r.total));
    return `<section class="quiz quiz-board enter">
      <p class="eyebrow">Classement · après la question ${zs.index + 1} sur ${QUIZ.length}</p>
      <h1>Classement</h1>
      <ol class="board">${top.map((r, k) => `
        <li style="--d:${k * 90}ms;--w:${(r.total / max) * 100}%">
          <span class="b-rank num">${k + 1}</span>
          <span class="b-name">${esc(r.p.name)}</span>
          ${r.gained ? `<span class="b-gain num">+${r.gained}</span>` : '<span class="b-gain"></span>'}
          <span class="b-score num" data-countup>${r.total}</span>
        </li>`).join('')}</ol>
      ${ranks.length > 5 ? `<p class="muted">${ranks.length - 5} autres joueurs : chacun voit sa place sur son téléphone</p>` : ''}
    </section>`;
  }
  // Podium
  const [a, b, c] = ranks;
  const step = (r, place, cls) => r ? `<div class="pod ${cls}">
      <span class="pod-name">${esc(r.p.name)}</span>
      <span class="pod-score num">${r.total} pts</span>
      <div class="pod-block"><span class="num">${place}</span></div>
    </div>` : `<div class="pod ${cls} empty"></div>`;
  return `<section class="quiz quiz-podium enter">
    <p class="eyebrow">Quiz terminé</p>
    <h1>Podium</h1>
    <div class="podium">${step(b, 2, 'p2')}${step(a, 1, 'p1')}${step(c, 3, 'p3')}</div>
  </section>`;
}
