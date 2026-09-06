alter table public.memo_later_items
  drop constraint if exists memo_later_items_attention_level_check;

alter table public.memo_later_items
  add constraint memo_later_items_attention_level_check
  check (attention_level in ('do_later', 'keep_in_mind', 'important_insight', 'app_improvement'));
