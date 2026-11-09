-- Tennis Score Tracker v0.4.0 - Live Scoreboard
-- Run this once in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.live_scoreboard_sessions (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique,
  status text not null default 'waiting' check (status in ('waiting','live','paused','between','tiebreak','finished','closed')),
  scoreboard_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Controller credentials are deliberately isolated from the publicly readable match row.
create table if not exists public.live_scoreboard_controller_tokens (
  session_id uuid primary key references public.live_scoreboard_sessions(id) on delete cascade,
  controller_token_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists live_scoreboard_sessions_public_code_idx
  on public.live_scoreboard_sessions (public_code);
create index if not exists live_scoreboard_sessions_expires_at_idx
  on public.live_scoreboard_sessions (expires_at);

alter table public.live_scoreboard_sessions enable row level security;
alter table public.live_scoreboard_controller_tokens enable row level security;

-- Public browser clients are strictly read-only on live scoreboard rows.
revoke all on table public.live_scoreboard_sessions from anon, authenticated;
grant select on table public.live_scoreboard_sessions to anon, authenticated;

-- Nobody using a browser-safe Supabase key can read controller-token hashes.
revoke all on table public.live_scoreboard_controller_tokens from anon, authenticated;

drop policy if exists "Public can read active live scoreboards" on public.live_scoreboard_sessions;
create policy "Public can read active live scoreboards"
on public.live_scoreboard_sessions
for select
to anon, authenticated
using (
  (closed_at is null and status <> 'closed' and expires_at > now())
  or
  (closed_at is not null and closed_at > now() - interval '5 minutes')
);

-- No anon/authenticated policies are created for live_scoreboard_controller_tokens.
-- Netlify Functions use the Supabase secret/service key and can access it server-side.

-- Enable Postgres Changes for the public scoreboard table if needed.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'live_scoreboard_sessions'
  ) then
    alter publication supabase_realtime add table public.live_scoreboard_sessions;
  end if;
end $$;

-- Optional cleanup helper. It does not run on a schedule by itself.
create or replace function public.cleanup_expired_live_scoreboards()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.live_scoreboard_sessions
  where expires_at < now() - interval '7 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
