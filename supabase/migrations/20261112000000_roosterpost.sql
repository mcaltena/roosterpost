-- Roosterpost: tabellen. Alleen de Edge Function (service role) komt erbij.
-- RLS staat aan zonder policies: de publieke anon-sleutel kan dus niets lezen of schrijven.

create table if not exists public.kv (
  key   text primary key,
  value jsonb not null
);

create table if not exists public.people (
  id     text primary key,
  naam   text not null,
  email  text not null default '',
  rollen jsonb not null default '[]'::jsonb,
  token  text not null unique,
  push   jsonb not null default '[]'::jsonb
);

create table if not exists public.meetings (
  id         text primary key,
  datum      date not null,
  start_tijd text not null default '',
  eind_tijd  text not null default '',
  titel      text not null,
  locatie    text not null default '',
  notitie    text not null default '',
  inzet      jsonb not null default '[]'::jsonb
);
create index if not exists meetings_datum_idx on public.meetings (datum);

create table if not exists public.log (
  id    bigint generated always as identity primary key,
  ts    timestamptz not null default now(),
  entry jsonb not null
);
create index if not exists log_ts_idx on public.log (ts);

create table if not exists public.sessions (
  hash text primary key,
  exp  timestamptz not null
);

create table if not exists public.fails (
  id bigint generated always as identity primary key,
  ip text not null,
  ts timestamptz not null default now()
);
create index if not exists fails_ip_ts_idx on public.fails (ip, ts);

-- Eén rij per verzenddag: de primaire sleutel zorgt dat de wekelijkse mail maar één keer vertrekt.
create table if not exists public.weekly_claims (
  datum date primary key
);

alter table public.kv            enable row level security;
alter table public.people        enable row level security;
alter table public.meetings      enable row level security;
alter table public.log           enable row level security;
alter table public.sessions      enable row level security;
alter table public.fails         enable row level security;
alter table public.weekly_claims enable row level security;
