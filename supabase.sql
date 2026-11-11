-- DU Meet: run once in Supabase → SQL Editor → New query → Run.
create table if not exists public.docs (
  collection text not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (collection, id)
);
-- Only the server (service key) reads and writes; nobody else.
alter table public.docs enable row level security;

-- Private bucket for photos, voice notes and call moments.
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;
