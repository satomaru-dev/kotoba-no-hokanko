create table if not exists public.memo_later_items (
  memo_id uuid primary key references public.captured_memos(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'done', 'abandoned')),
  activated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint memo_later_items_resolution_check check (
    (status = 'active' and resolved_at is null)
    or (status in ('done', 'abandoned') and resolved_at is not null)
  )
);

create index if not exists memo_later_items_owner_active_idx
  on public.memo_later_items (owner_id, status, activated_at desc);

create index if not exists memo_later_items_owner_resolved_idx
  on public.memo_later_items (owner_id, resolved_at desc)
  where status in ('done', 'abandoned');

alter table public.memo_later_items enable row level security;

create policy "Users can read their own later items"
  on public.memo_later_items for select
  using ((select auth.uid()) = owner_id);

create policy "Users can insert their own later items"
  on public.memo_later_items for insert
  with check ((select auth.uid()) = owner_id);

create policy "Users can update their own later items"
  on public.memo_later_items for update
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Users can delete their own later items"
  on public.memo_later_items for delete
  using ((select auth.uid()) = owner_id);

revoke all on table public.memo_later_items from public, anon, authenticated;
grant select, insert, update, delete on table public.memo_later_items to service_role;
