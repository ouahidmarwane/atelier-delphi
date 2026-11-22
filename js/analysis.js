// Analyse des réponses en temps réel : thèmes, doublons, statistiques et constats.
import { THEMES, themeById, deptById, RULES, priorityOf, decisionById, DEPARTMENTS } from './content.js?v=202611221322';

export function normalize(text) {
  return ' ' + String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() + ' ';
}

// Distance d'édition (fautes de frappe : lettre oubliée, en trop, remplacée ou inversée)
function distance(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

// Un mot correspond à un début de mot-clé, exactement ou avec une faute de frappe
function has(norm, words, stem) {
  if (norm.includes(' ' + stem)) return true;
  if (stem.includes(' ') || stem.length < 6) return false;
  const tol = stem.length >= 9 ? 2 : 1;
  for (const w of words) {
    if (w.length < stem.length - 1) continue;
    for (let L = stem.length - 1; L <= Math.min(w.length, stem.length + 1); L++) {
      if (distance(w.slice(0, L), stem) <= tol) return true;
    }
  }
  return false;
}

export function matchThemes(line) {
  const norm = normalize(line);
  const words = norm.trim().split(' ');
  const out = [];
  for (const t of THEMES) {
    const hit = t.kw.some((k) => (Array.isArray(k) ? k.every((s) => has(norm, words, s)) : has(norm, words, k)));
    if (hit) out.push(t.id);
  }
  return out;
}

export function splitLines(text) {
  return String(text || '')
    .split(/\n|;|•/)
    .map((l) => l.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter((l) => l.length > 1);
}

// Regroupe les réponses libres d'une question par thème
export function analyzeOpen(answers, people) {
  const themes = new Map();
  const other = [];
  let lines = 0;
  const respondents = new Set();
  for (const a of answers) {
    const p = people[a.participant_id];
    const dept = p ? p.dept : null;
    for (const line of splitLines(a.payload?.text)) {
      lines++;
      respondents.add(a.participant_id);
      const ids = matchThemes(line);
      if (!ids.length) { other.push({ text: line, dept }); continue; }
      for (const id of ids) {
        if (!themes.has(id)) themes.set(id, { id, label: themeById[id].label, count: 0, people: new Set(), depts: new Set(), samples: [] });
        const t = themes.get(id);
        t.count++;
        t.people.add(a.participant_id);
        if (dept) t.depts.add(dept);
        if (t.samples.length < 40) t.samples.push({ text: line, dept });
      }
    }
  }
  const list = [...themes.values()]
    .map((t) => ({ ...t, people: t.people.size, depts: orderDepts(t.depts) }))
    .sort((a, b) => b.count - a.count || b.depts.length - a.depts.length);
  return { themes: list, other, lines, respondents: respondents.size };
}

function orderDepts(set) {
  return DEPARTMENTS.map((d) => d.id).filter((id) => set.has(id));
}

// Liste des risques candidats après le tour 1 (question des risques + question des pertes)
export function candidateRisks(answers, people) {
  const q1 = analyzeOpen(answers.filter((a) => a.qkey === 'q1'), people);
  const q4 = analyzeOpen(answers.filter((a) => a.qkey === 'q4'), people);
  const merged = new Map(q1.themes.map((t) => [t.id, { ...t }]));
  for (const t of q4.themes) {
    if (t.id !== 'client') continue;
    const cur = merged.get(t.id);
    if (cur) {
      cur.count += t.count;
      cur.depts = orderDepts(new Set([...cur.depts, ...t.depts]));
    } else merged.set(t.id, { ...t });
  }
  const list = [...merged.values()].sort((a, b) => b.depts.length - a.depts.length || b.count - a.count);
  return { list, unmatched: q1.other };
}

export function stats(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  const dist = [0, 0, 0, 0, 0];
  v.forEach((x) => { dist[x - 1]++; });
  if (!n) return { n: 0, median: null, q1: null, q3: null, iqr: null, within: 0, dist };
  const q = (p) => {
    const pos = (n - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  };
  const median = q(0.5);
  const within = v.filter((x) => Math.abs(x - median) <= 1).length / n;
  return { n, median, q1: q(0.25), q3: q(0.75), iqr: q(0.75) - q(0.25), within, dist };
}

// Analyse d'un tour de notation
export function analyzeRatings(answers, risks) {
  return risks.map((risk) => {
    const rows = answers.filter((a) => a.qkey === risk.id);
    const p = stats(rows.map((r) => r.payload?.p));
    const i = stats(rows.map((r) => r.payload?.i));
    const crit = p.median != null && i.median != null ? round1(p.median * i.median) : null;
    const consensus = p.n > 0 && p.within >= RULES.consensusShare && i.within >= RULES.consensusShare;
    const agreement = p.n ? Math.min(p.within, i.within) : 0;
    const justifications = rows.map((r) => r.payload?.why).filter(Boolean);
    const measures = rows.map((r) => r.payload?.measure).filter(Boolean);
    return { ...risk, n: p.n, p, i, crit, level: crit != null ? decisionById[priorityOf(p.median, i.median)] : null, consensus, agreement, justifications, measures };
  });
}

export const round1 = (x) => Math.round(x * 10) / 10;
export const fmt = (x) => (x == null ? '–' : Number.isInteger(x) ? String(x) : x.toFixed(1).replace('.', ','));
export const pct = (x) => Math.round(x * 100) + ' %';

// Constats automatiques affichés à côté des résultats
export function insightsRound1(byQuestion, candidates, totalPeople) {
  const out = [];
  const q1 = byQuestion.q1;
  if (q1 && q1.lines) {
    const distinct = q1.themes.length;
    out.push(`${q1.lines} réponses regroupées en ${distinct} risques distincts`);
    const shared = q1.themes.filter((t) => t.depts.length >= 3);
    if (shared.length) out.push(`${shared.length} ${shared.length > 1 ? 'risques sont cités' : 'risque est cité'} par au moins 3 départements : ${shared.slice(0, 2).map((t) => lower(t.label)).join(', ')}`);
    const solo = q1.themes.filter((t) => t.depts.length === 1);
    if (solo.length) out.push(`${solo.length} ${solo.length > 1 ? 'risques ne sont vus' : 'risque n’est vu'} que par un seul département`);
    if (q1.other.length) out.push(`${q1.other.length} ${q1.other.length > 1 ? 'réponses restent' : 'réponse reste'} à classer à la main`);
  }
  const answered = Math.max(...Object.values(byQuestion).map((q) => q.respondents), 0);
  if (totalPeople) out.push(`Participation : ${answered} sur ${totalPeople} participants`);
  if (candidates?.list?.length && candidates.list[0].depts.length) {
    const top = candidates.list[0];
    out.push(`Le risque le plus partagé : ${lower(top.label)} (${top.depts.length} départements)`);
  }
  return out;
}

export function insightsRatings(results, previous) {
  const out = [];
  const ok = results.filter((r) => r.consensus);
  out.push(`${ok.length} risque${ok.length > 1 ? 's' : ''} sur ${results.length} ${ok.length > 1 ? 'font' : 'fait'} consensus`);
  const pr = (r) => Number(String(r.level?.id || 'p9').slice(1));
  const ranked = [...results].filter((r) => r.crit != null).sort((a, b) => pr(a) - pr(b) || b.crit - a.crit);
  if (ranked[0]) out.push(`Le plus critique : ${lower(ranked[0].label)}, ${ranked[0].level?.label.toLowerCase()}, criticité ${fmt(ranked[0].crit)} sur 25`);
  const p1 = results.filter((r) => r.level?.id === 'p1').length;
  if (p1) out.push(`${p1} risque${p1 > 1 ? 's tombent' : ' tombe'} en priorité 1 dans la grille de notation`);
  const split = [...results].filter((r) => !r.consensus && r.n).sort((a, b) => a.agreement - b.agreement)[0];
  if (split) out.push(`Le plus grand désaccord : ${lower(split.label)}, seulement ${pct(split.agreement)} des avis proches de la médiane`);
  if (previous) {
    const pairs = results.map((r) => [r, previous.find((p) => p.id === r.id)]).filter(([, p]) => p && p.n);
    const tighter = pairs.filter(([r, p]) => spread(r) < spread(p)).length;
    if (pairs.length) out.push(`Les avis se resserrent sur ${tighter} risque${tighter > 1 ? 's' : ''} sur ${pairs.length} par rapport au tour précédent`);
    const moved = pairs.filter(([r, p]) => r.crit != null && p.crit != null && Math.abs(r.crit - p.crit) >= 3);
    if (moved.length) out.push(`${moved.length} risque${moved.length > 1 ? 's changent' : ' change'} nettement de criticité après le retour du groupe`);
  }
  return out;
}

export const spread = (r) => (r.p.iqr ?? 0) + (r.i.iqr ?? 0);

function lower(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// Regroupe des propositions de mesures proches et garde les plus citées
export function topMeasures(measures, limit = 3) {
  const map = new Map();
  for (const m of measures) {
    const key = normalize(m).trim();
    if (!key) continue;
    const cur = map.get(key) || { text: m.trim(), count: 0 };
    cur.count++;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export { deptById };
