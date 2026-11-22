// Couche de données : même interface pour Supabase (vraie séance) et pour le mode répétition local.
import { CONFIG } from './config.js?v=202611221412';

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

async function supabaseStore() {
  const { createClient } = await import('../vendor/supabase.mjs?v=202611221412');
  const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    realtime: { params: { eventsPerSecond: 20 } },
  });
  const check = (res) => {
    if (res.error) throw res.error;
    return res.data;
  };
  return {
    mode: 'supabase',
    async ping() {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), 6000));
      const res = await Promise.race([sb.from('sessions').select('code').limit(1), timeout]);
      if (res.error) throw res.error;
      return true;
    },
    async createSession(code, state) {
      check(await sb.from('sessions').insert({ code, state }));
    },
    async getSession(code) {
      const rows = check(await sb.from('sessions').select('*').eq('code', code).limit(1));
      return rows[0] || null;
    },
    async setState(code, state) {
      check(await sb.from('sessions').update({ state, updated_at: new Date().toISOString() }).eq('code', code));
    },
    async join(code, p) {
      check(await sb.from('participants').upsert({ id: p.id, session_code: code, name: p.name, dept: p.dept, bot: !!p.bot }));
      return p;
    },
    async joinMany(code, list) {
      if (!list.length) return;
      check(await sb.from('participants').upsert(list.map((p) => ({ id: p.id, session_code: code, name: p.name, dept: p.dept, bot: !!p.bot }))));
    },
    async listParticipants(code) {
      return check(await sb.from('participants').select('*').eq('session_code', code).order('joined_at'));
    },
    async upsertAnswers(code, rows) {
      if (!rows.length) return;
      check(await sb.from('answers').upsert(rows.map((r) => ({ ...r, session_code: code, updated_at: new Date().toISOString() }))));
    },
    async listAnswers(code) {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const page = check(await sb.from('answers').select('*').eq('session_code', code).range(from, from + 999));
        all.push(...page);
        if (page.length < 1000) break;
      }
      return all;
    },
    subscribe(code, cb) {
      const ch = sb.channel('delphi-' + code + '-' + Math.random().toString(36).slice(2, 7))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `code=eq.${code}` }, (e) => cb('state', e.new))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `session_code=eq.${code}` }, (e) => cb('participant', e.new))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'answers', filter: `session_code=eq.${code}` }, (e) => cb('answer', e.new))
        .subscribe((status) => cb('status', status));
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
    async ping() {
      return true;
    },
    async createSession(code, state) {
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
      return this.joinMany(code, [p]).then(() => p);
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
    async upsertAnswers(code, rows) {
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
export async function aiGroup(payload, timeoutMs = 45000) {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) throw new Error('Supabase non configuré');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/delphi-ai`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CONFIG.supabaseAnonKey}`, apikey: CONFIG.supabaseAnonKey },
      body: JSON.stringify(payload),
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
