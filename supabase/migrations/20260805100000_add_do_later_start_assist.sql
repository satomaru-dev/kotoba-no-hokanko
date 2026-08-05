alter table public.memo_later_items
  add column if not exists first_step_ciphertext text,
  add column if not exists launch_url_ciphertext text,
  add column if not exists roulette_enabled boolean not null default false;

create index if not exists memo_later_items_owner_roulette_idx
  on public.memo_later_items (owner_id, status, roulette_enabled, activated_at desc)
  where status = 'active' and roulette_enabled = true;
