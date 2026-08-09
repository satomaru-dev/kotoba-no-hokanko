alter table public.memo_later_items
  add column if not exists bottom_order bigint;

create index if not exists memo_later_items_owner_bottom_order_idx
  on public.memo_later_items (owner_id, status, bottom_order asc nulls first, activated_at desc);