-- Sécurité : la clé publique ne peut plus que lire. Toutes les écritures passent par des fonctions
-- qui vérifient la clé animateur (créée avec la session) ou le secret du téléphone (créé à l'inscription).
create table if not exists public.session_keys (
  code text primary key references public.sessions(code) on delete cascade,
  host_key text not null,
  ai_calls int not null default 0
);
create table if not exists public.participant_keys (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  secret text not null
);
alter table public.session_keys enable row level security;
alter table public.participant_keys enable row level security;
revoke all on public.session_keys from anon, authenticated;
revoke all on public.participant_keys from anon, authenticated;

drop policy if exists "atelier sessions" on public.sessions;
drop policy if exists "atelier participants" on public.participants;
drop policy if exists "atelier answers" on public.answers;
create policy "lecture sessions" on public.sessions for select to anon using (true);
create policy "lecture participants" on public.participants for select to anon using (true);
create policy "lecture answers" on public.answers for select to anon using (true);
revoke insert, update, delete on public.sessions, public.participants, public.answers from anon, authenticated;

create or replace function public._check_payload(p jsonb) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'réponse invalide'; end if;
  if pg_column_size(p) > 4000 then raise exception 'réponse trop longue'; end if;
  if p ? 'text' and char_length(p->>'text') > 700 then raise exception 'texte trop long'; end if;
  if p ? 'why' and char_length(p->>'why') > 320 then raise exception 'justification trop longue'; end if;
  if p ? 'measure' and char_length(p->>'measure') > 130 then raise exception 'mesure trop longue'; end if;
  if p ? 'p' and not ((p->>'p') ~ '^[1-5]$') then raise exception 'note invalide'; end if;
  if p ? 'i' and not ((p->>'i') ~ '^[1-5]$') then raise exception 'note invalide'; end if;
end $$;

create or replace function public._check_host(p_code text, p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.session_keys where code = p_code and host_key = p_key) then
    raise exception 'clé animateur invalide';
  end if;
end $$;

create or replace function public.create_session(p_code text, p_state jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare k text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if p_code !~ '^[A-Z0-9]{4,8}$' then raise exception 'code invalide'; end if;
  if pg_column_size(p_state) > 200000 then raise exception 'état trop volumineux'; end if;
  insert into public.sessions(code, state) values (p_code, p_state);
  insert into public.session_keys(code, host_key) values (p_code, k);
  return k;
end $$;

create or replace function public.set_state(p_code text, p_key text, p_state jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_host(p_code, p_key);
  if pg_column_size(p_state) > 200000 then raise exception 'état trop volumineux'; end if;
  update public.sessions set state = p_state, updated_at = now() where code = p_code;
end $$;

create or replace function public.join_session(p_code text, p_id uuid, p_name text, p_dept text) returns text
language plpgsql security definer set search_path = public as $$
declare s text := encode(extensions.gen_random_bytes(24), 'hex');
declare n text := btrim(p_name);
begin
  if not exists (select 1 from public.sessions where code = p_code) then raise exception 'session introuvable'; end if;
  if char_length(n) < 1 or char_length(n) > 24 then raise exception 'prénom invalide'; end if;
  if p_dept not in ('prod', 'supply', 'maint', 'qual', 'rh') then raise exception 'département invalide'; end if;
  if (select count(*) from public.participants where session_code = p_code) >= 120 then raise exception 'session complète'; end if;
  insert into public.participants(id, session_code, name, dept, bot) values (p_id, p_code, n, p_dept, false);
  insert into public.participant_keys(participant_id, secret) values (p_id, s);
  return s;
end $$;

create or replace function public.submit_answer(p_code text, p_pid uuid, p_secret text, p_round int, p_qkey text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare st jsonb;
begin
  if not exists (
    select 1 from public.participant_keys k join public.participants p on p.id = k.participant_id
    where k.participant_id = p_pid and k.secret = p_secret and p.session_code = p_code
  ) then raise exception 'participant inconnu'; end if;
  select state into st from public.sessions where code = p_code;
  if (st->>'round')::int is distinct from p_round or coalesce(st->>'phase', '') not in ('question', 'interlude') then
    raise exception 'question fermée';
  end if;
  if char_length(p_qkey) > 80 then raise exception 'question invalide'; end if;
  perform public._check_payload(p_payload);
  insert into public.answers(session_code, participant_id, round, qkey, payload, updated_at)
  values (p_code, p_pid, p_round, p_qkey, p_payload, now())
  on conflict (session_code, participant_id, round, qkey) do update set payload = excluded.payload, updated_at = now();
end $$;

create or replace function public.host_join_bots(p_code text, p_key text, p_list jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_host(p_code, p_key);
  if jsonb_array_length(p_list) > 60 then raise exception 'trop de participants'; end if;
  insert into public.participants(id, session_code, name, dept, bot)
  select (x->>'id')::uuid, p_code, left(btrim(x->>'name'), 24), x->>'dept', true
  from jsonb_array_elements(p_list) x
  where x->>'dept' in ('prod', 'supply', 'maint', 'qual', 'rh')
  on conflict (id) do nothing;
end $$;

create or replace function public.host_submit_answers(p_code text, p_key text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform public._check_host(p_code, p_key);
  for r in select * from jsonb_array_elements(p_rows) loop
    perform public._check_payload(r->'payload');
    insert into public.answers(session_code, participant_id, round, qkey, payload, updated_at)
    select p_code, p.id, (r->>'round')::int, r->>'qkey', r->'payload', now()
    from public.participants p where p.id = (r->>'participant_id')::uuid and p.session_code = p_code and p.bot
    on conflict (session_code, participant_id, round, qkey) do update set payload = excluded.payload, updated_at = now();
  end loop;
end $$;

create or replace function public.ai_ticket(p_code text, p_key text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.session_keys set ai_calls = ai_calls + 1 where code = p_code and host_key = p_key returning ai_calls into n;
  return n is not null and n <= 25;
end $$;

revoke all on function public._check_host(text, text) from anon, authenticated, public;
revoke all on function public.create_session(text, jsonb), public.set_state(text, text, jsonb), public.join_session(text, uuid, text, text),
  public.submit_answer(text, uuid, text, int, text, jsonb), public.host_join_bots(text, text, jsonb),
  public.host_submit_answers(text, text, jsonb), public.ai_ticket(text, text), public._check_payload(jsonb) from public;
grant execute on function public.create_session(text, jsonb), public.set_state(text, text, jsonb), public.join_session(text, uuid, text, text),
  public.submit_answer(text, uuid, text, int, text, jsonb), public.host_join_bots(text, text, jsonb),
  public.host_submit_answers(text, text, jsonb), public.ai_ticket(text, text) to anon, authenticated;
