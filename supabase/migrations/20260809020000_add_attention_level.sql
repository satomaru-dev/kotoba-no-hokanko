alter table public.memo_later_items add column if not exists attention_level text not null default 'do_later';

alter table public.memo_later_items drop constraint if exists memo_later_items_attention_level_check;

alter table public.memo_later_items add constraint memo_later_items_attention_level_check check (attention_level in ('do_later','keep_in_mind','important_insight'));

create index if not exists memo_later_items_owner_attention_idx on public.memo_later_items (owner_id, status, attention_level, activated_at desc);
