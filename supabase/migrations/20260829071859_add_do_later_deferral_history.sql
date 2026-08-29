create table if not exists public.memo_later_deferrals (
  id uuid primary key default gen_random_uuid(),
  memo_id uuid not null references public.captured_memos(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  reason_ciphertext text not null,
  memo_text_ciphertext text not null,
  deferred_at timestamptz not null default now()
);

create index if not exists memo_later_deferrals_owner_deferred_idx
  on public.memo_later_deferrals (owner_id, deferred_at asc);

create index if not exists memo_later_deferrals_memo_idx
  on public.memo_later_deferrals (memo_id, deferred_at asc);

alter table public.memo_later_deferrals enable row level security;

create policy "Users can read their own later deferrals"
  on public.memo_later_deferrals for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can insert their own later deferrals"
  on public.memo_later_deferrals for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Users can update their own later deferrals"
  on public.memo_later_deferrals for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Users can delete their own later deferrals"
  on public.memo_later_deferrals for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on table public.memo_later_deferrals from public, anon, authenticated;
grant select, insert, update, delete on table public.memo_later_deferrals to service_role;

create or replace function public.record_memo_later_deferral(
  p_memo_id uuid,
  p_owner_id uuid,
  p_reason_ciphertext text,
  p_memo_text_ciphertext text,
  p_deferred_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_manual_order bigint;
begin
  select coalesce(max(manual_order), 0) + 1
    into next_manual_order
    from public.memo_later_items
    where owner_id = p_owner_id
      and status = 'active'
      and attention_level = 'do_later'
      and memo_id <> p_memo_id;

  update public.memo_later_items
    set status = 'active',
        deferred_at = p_deferred_at,
        bottom_order = (extract(epoch from p_deferred_at) * 1000)::bigint,
        manual_order = next_manual_order,
        heavy_marked = false,
        updated_at = p_deferred_at,
        resolved_at = null
    where memo_id = p_memo_id
      and owner_id = p_owner_id
      and status = 'active'
      and repeat_daily = false;

  if not found then
    raise exception 'memo_later_item_not_found';
  end if;

  insert into public.memo_later_deferrals (
    memo_id,
    owner_id,
    reason_ciphertext,
    memo_text_ciphertext,
    deferred_at
  ) values (
    p_memo_id,
    p_owner_id,
    p_reason_ciphertext,
    p_memo_text_ciphertext,
    p_deferred_at
  );
end;
$$;

revoke execute on function public.record_memo_later_deferral(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_memo_later_deferral(uuid, uuid, text, text, timestamptz)
  to service_role;
