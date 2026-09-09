create table if not exists public.memo_attention_history (
  id uuid primary key default gen_random_uuid(),
  memo_id uuid not null references public.captured_memos(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  attention_level text not null check (attention_level in ('do_later','keep_in_mind','important_insight','app_improvement')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists memo_attention_history_owner_started_idx
  on public.memo_attention_history (owner_id, started_at desc);
create index if not exists memo_attention_history_memo_started_idx
  on public.memo_attention_history (memo_id, started_at desc);

alter table public.memo_attention_history enable row level security;

create policy "Users can read their own attention history"
  on public.memo_attention_history for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can insert their own attention history"
  on public.memo_attention_history for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Users can update their own attention history"
  on public.memo_attention_history for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Users can delete their own attention history"
  on public.memo_attention_history for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on table public.memo_attention_history from public, anon, authenticated;
grant select, insert, update, delete on table public.memo_attention_history to service_role;

insert into public.memo_attention_history (memo_id, owner_id, attention_level, started_at)
select memo_id, owner_id, attention_level, activated_at
from public.memo_later_items
where status = 'active'
  and attention_level in ('do_later','keep_in_mind','important_insight','app_improvement');
