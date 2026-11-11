-- DU Meet: run once in Supabase -> SQL Editor -> New query -> Run.
-- Names are prefixed "dumeet" so they never clash with other apps in the same project.
create table if not exists public.dumeet_docs (
  collection text not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (collection, id)
);
-- Only the server (service key) reads and writes; nobody else.
alter table public.dumeet_docs enable row level security;

-- Private bucket for files shared in chat.
insert into storage.buckets (id, name, public)
values ('dumeet-media', 'dumeet-media', false)
on conflict (id) do nothing;
