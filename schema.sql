-- Atelier Delphi : tables Supabase
-- À coller dans Supabase > SQL Editor > New query, puis Run.

create table if not exists public.sessions (
  code text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key,
  session_code text not null references public.sessions(code) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  dept text not null,
  bot boolean not null default false,
  joined_at timestamptz not null default now()
);

create table if not exists public.answers (
  session_code text not null references public.sessions(code) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  round int not null,
  qkey text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (session_code, participant_id, round, qkey)
);

create index if not exists participants_session_idx on public.participants(session_code);
create index if not exists answers_session_idx on public.answers(session_code);

-- Accès ouvert pour la clé publique : suffisant pour un atelier en classe.
-- Supprime les données après la séance (dernière requête de ce fichier).
alter table public.sessions enable row level security;
alter table public.participants enable row level security;
alter table public.answers enable row level security;

drop policy if exists "atelier sessions" on public.sessions;
drop policy if exists "atelier participants" on public.participants;
drop policy if exists "atelier answers" on public.answers;
create policy "atelier sessions" on public.sessions for all to anon using (true) with check (true);
create policy "atelier participants" on public.participants for all to anon using (true) with check (true);
create policy "atelier answers" on public.answers for all to anon using (true) with check (true);

-- Temps réel
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.answers;

-- Après la séance, pour tout effacer :
-- delete from public.sessions;
