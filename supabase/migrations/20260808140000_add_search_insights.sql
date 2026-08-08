create table if not exists public.search_insights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  query_hash text not null,
  query_ciphertext text not null,
  search_count integer not null default 1 check (search_count > 0),
  last_used_at timestamptz not null default now(),
  unique (owner_id, query_hash)
);

create index if not exists search_insights_owner_recent_idx
  on public.search_insights (owner_id, last_used_at desc);
create index if not exists search_insights_owner_frequency_idx
  on public.search_insights (owner_id, search_count desc, last_used_at desc);

alter table public.search_insights enable row level security;
create policy "Users can read their own search insights"
  on public.search_insights for select
  using ((select auth.uid()) = owner_id);
create policy "Users can insert their own search insights"
  on public.search_insights for insert
  with check ((select auth.uid()) = owner_id);
create policy "Users can update their own search insights"
  on public.search_insights for update
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Users can delete their own search insights"
  on public.search_insights for delete
  using ((select auth.uid()) = owner_id);

revoke all on table public.search_insights from public, anon, authenticated;
grant select, insert, update, delete on table public.search_insights to service_role;