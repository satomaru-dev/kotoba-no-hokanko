alter table public.memo_later_items
  add column if not exists storage_archived boolean not null default false;

create index if not exists memo_later_items_owner_storage_archive_idx
  on public.memo_later_items (owner_id, attention_level, storage_archived, updated_at desc)
  where status = 'active' and attention_level = 'keep_for_use';
