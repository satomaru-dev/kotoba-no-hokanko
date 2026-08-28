alter table public.memo_later_items
  add column if not exists repeat_daily boolean not null default false,
  add column if not exists repeat_next_on date;
