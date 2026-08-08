alter table public.memo_later_items
  add column if not exists deferred_at timestamptz;

create index if not exists memo_later_items_owner_deferred_idx
  on public.memo_later_items (owner_id, status, deferred_at asc, activated_at desc)
  where status = 'active';
