// Couche de données : même interface pour Supabase (vraie séance) et pour le mode répétition local.
import { CONFIG } from './config.js?v=202611221445';

const answerKey = (r) => `${r.participant_id}|${r.round}|${r.qkey}`;

export async function createStore() {
  const forceLocal = new URLSearchParams(location.search).has('local');
  if (!forceLocal && CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) {
    try {
      return await supabaseStore();
    } catch (err) {
      console.error('Supabase indisponible, passage en mode local', err);
    }
  }
  return localStore();
}

// Clé animateur : créée avec la session, gardée uniquement sur l'ordinateur de l'animateur
const hostKeyName = (code) => 'delphi-host-key:' + code;
export const getHostKey = (code) => {
  try {
    return localStorage.getItem(hostKeyName(code));
  } catch {
    return null;
  }
};
const setHostKey = (code, key) => {
  try {
    localStorage.setItem(hostKeyName(code), key);
  } catch {}
};
const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');

// Toutes les écritures passent par des fonctions sécurisées : clé animateur ou secret du téléphone
async function supabaseStore() {
  const { createClient } = await import('../vendor/supabase.mjs?v=202611221445');
  const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    realtime: { params: { eventsPerSecond: 20 } },
  });
  const check = (res) => {
    if (res.error) throw new Error(res.error.message || String(res.error));
    return res.data;
  };
  const withTimeout = (promise, ms = 12000) =>
    Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), ms))]);
  const rpc = async (fn, args) => check(await withTimeout(sb.rpc(fn, args)));
  return {
    mode: 'supabase',
    hasHostKey: (code) => !!getHostKey(code),
    async ping() {
      check(await withTimeout(sb.from('sessions').select('code').limit(1), 6000));
      return true;
    },
    async createSession(code, state) {
      const key = await rpc('create_session', { p_code: code, p_state: state });
      setHostKey(code, key);
    },
    async getSession(code) {
      const rows = check(await withTimeout(sb.from('sessions').select('code,state,updated_at').eq('code', code).limit(1)));
      return rows[0] || null;
    },
    async setState(code, state) {
      await rpc('set_state', { p_code: code, p_key: getHostKey(code), p_state: state });
    },
    async join(code, p) {
      const secret = await rpc('join_session', { p_code: code, p_id: p.id, p_name: p.name, p_dept: p.dept });
      return { ...p, secret };
    },
    async joinMany(code, list) {
      if (!list.length) return;
      await rpc('host_join_bots', { p_code: code, p_key: getHostKey(code), p_list: list.map((p) => ({ id: p.id, name: p.name, dept: p.dept })) });
    },
    async listParticipants(code) {
      return check(await withTimeout(sb.from('participants').select('id,session_code,name,dept,bot,joined_at').eq('session_code', code).order('joined_at')));
    },
    async submitAnswer(code, row, secret) {
      await rpc('submit_answer', { p_code: code, p_pid: row.participant_id, p_secret: secret, p_round: row.round, p_qkey: row.qkey, p_payload: row.payload });
    },
    async hostAnswers(code, rows) {
      if (!rows.length) return;
      await rpc('host_submit_answers', { p_code: code, p_key: getHostKey(code), p_rows: rows });
    },
    async listAnswers(code) {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const page = check(await withTimeout(sb.from('answers').select('session_code,participant_id,round,qkey,payload,updated_at').eq('session_code', code).range(from, from + 999)));
        all.push(...page);
        if (page.length < 1000) break;
      }
      return all;
    },
    // tables : les téléphones n'écoutent que l'état de la séance, l'animateur écoute tout
    subscribe(code, cb, tables = ['sessions', 'participants', 'answers']) {
      let ch = sb.channel('delphi-' + code + '-' + Math.random().toString(36).slice(2, 7));
      if (tables.includes('sessions')) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `code=eq.${code}` }, (e) => cb('state', e.new));
      if (tables.includes('participants')) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `session_code=eq.${code}` }, (e) => cb('participant', e.new));
      if (tables.includes('answers')) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'answers', filter: `session_code=eq.${code}` }, (e) => cb('answer', e.new));
      ch.subscribe((status) => cb('status', status));
      return () => sb.removeChannel(ch);
    },
  };
}

function localStore() {
  const key = (code) => 'delphi-local:' + code;
  const read = (code) => {
    try {
      return JSON.parse(localStorage.getItem(key(code))) || null;
    } catch {
      return null;
    }
  };
  const write = (code, db) => localStorage.setItem(key(code), JSON.stringify(db));
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('delphi-local') : null;
  const listeners = new Set();
  const emit = (code, kind, row) => {
    listeners.forEach((l) => l(code, kind, row));
    bc?.postMessage({ code, kind, row });
  };
  bc?.addEventListener('message', (e) => listeners.forEach((l) => l(e.data.code, e.data.kind, e.data.row)));

  return {
    mode: 'local',
    hasHostKey: (code) => !!getHostKey(code),
    async ping() {
      return true;
    },
    async createSession(code, state) {
      setHostKey(code, randomKey());
      write(code, { code, state, participants: {}, answers: {} });
      emit(code, 'state', { code, state });
    },
    async getSession(code) {
      const db = read(code);
      return db ? { code, state: db.state } : null;
    },
    async setState(code, state) {
      const db = read(code);
      if (!db) return;
      db.state = state;
      write(code, db);
      emit(code, 'state', { code, state });
    },
    async join(code, p) {
      await this.joinMany(code, [p]);
      return { ...p, secret: randomKey() };
    },
    async joinMany(code, list) {
      const db = read(code);
      if (!db) throw new Error('Session introuvable');
      for (const p of list) {
        const row = { ...p, session_code: code, bot: !!p.bot, joined_at: db.participants[p.id]?.joined_at || new Date().toISOString() };
        db.participants[p.id] = row;
      }
      write(code, db);
      list.forEach((p) => emit(code, 'participant', db.participants[p.id]));
    },
    async listParticipants(code) {
      const db = read(code);
      return db ? Object.values(db.participants).sort((a, b) => a.joined_at.localeCompare(b.joined_at)) : [];
    },
    async submitAnswer(code, row) {
      return this.hostAnswers(code, [row]);
    },
    async hostAnswers(code, rows) {
      const db = read(code);
      if (!db) return;
      const saved = rows.map((r) => ({ ...r, session_code: code, updated_at: new Date().toISOString() }));
      saved.forEach((r) => { db.answers[answerKey(r)] = r; });
      write(code, db);
      saved.forEach((r) => emit(code, 'answer', r));
    },
    async listAnswers(code) {
      const db = read(code);
      return db ? Object.values(db.answers) : [];
    },
    subscribe(code, cb) {
      const l = (c, kind, row) => { if (c === code) cb(kind, row); };
      listeners.add(l);
      setTimeout(() => cb('status', 'SUBSCRIBED'), 0);
      return () => listeners.delete(l);
    },
  };
}

// Regroupement par l'IA (fonction Supabase delphi-ai, qui appelle Gemini)
export async function aiGroup(code, payload, timeoutMs = 45000) {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) throw new Error('Supabase non configuré');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/delphi-ai`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CONFIG.supabaseAnonKey}`, apikey: CONFIG.supabaseAnonKey },
      body: JSON.stringify({ ...payload, code, host_key: getHostKey(code) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'délai dépassé' : err.message || String(err));
  } finally {
    clearTimeout(t);
  }
}

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
