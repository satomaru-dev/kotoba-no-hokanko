alter table public.memo_later_items
  add column if not exists heavy_marked boolean not null default false;

update public.memo_later_items
set heavy_marked = false
where heavy_marked is null;
