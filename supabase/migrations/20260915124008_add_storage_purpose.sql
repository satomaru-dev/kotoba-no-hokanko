alter table public.memo_later_items add column storage_purpose_ciphertext text;
alter table public.memo_attention_history add column storage_purpose_ciphertext text;
alter table public.memo_later_items drop constraint memo_later_items_attention_level_check;
alter table public.memo_later_items add constraint memo_later_items_attention_level_check
  check (attention_level in ('do_later','keep_in_mind','important_insight','app_improvement','keep_for_use'));
alter table public.memo_attention_history drop constraint memo_attention_history_attention_level_check;
alter table public.memo_attention_history add constraint memo_attention_history_attention_level_check
  check (attention_level in ('do_later','keep_in_mind','important_insight','app_improvement','keep_for_use'));
alter table public.memo_later_items add constraint memo_later_items_purpose_check
  check ((attention_level = 'keep_for_use') = (storage_purpose_ciphertext is not null));
alter table public.memo_attention_history add constraint memo_attention_history_purpose_check
  check ((attention_level = 'keep_for_use') = (storage_purpose_ciphertext is not null));
create index memo_attention_history_owner_page_idx on public.memo_attention_history(owner_id, started_at desc, id desc);

-- The API encrypts purpose text and reuses the current ciphertext for unchanged text.
-- Serialize on the owned memo; check the observed purpose to reject conflicting updates.
create function public.set_memo_placement(
  p_memo_id uuid, p_owner_id uuid, p_level text,
  p_purpose_ciphertext text default null,
  p_expected_purpose_ciphertext text default null,
  p_repeat_daily boolean default null,
  p_require_active boolean default false
) returns void language plpgsql security invoker set search_path = ''
as $$
declare
  previous public.memo_later_items%rowtype;
  unchanged boolean;
  at_time timestamptz := clock_timestamp();
begin
  perform 1 from public.captured_memos where id = p_memo_id and owner_id = p_owner_id and deleted_at is null for update;
  if not found then raise exception 'memo_not_found'; end if;
  select * into previous from public.memo_later_items where memo_id = p_memo_id and owner_id = p_owner_id for update;
  if p_require_active and (previous.memo_id is null or previous.status <> 'active') then raise exception 'placement_not_found'; end if;
  if previous.storage_purpose_ciphertext is distinct from p_expected_purpose_ciphertext then raise exception 'placement_conflict'; end if;
  if p_level is null then
    update public.memo_attention_history set ended_at = at_time where memo_id = p_memo_id and owner_id = p_owner_id and ended_at is null;
    delete from public.memo_later_items where memo_id = p_memo_id and owner_id = p_owner_id;
    return;
  end if;
  if p_level not in ('do_later','keep_in_mind','important_insight','app_improvement','keep_for_use')
    or ((p_level = 'keep_for_use') <> (p_purpose_ciphertext is not null)) then raise exception 'invalid_placement'; end if;
  unchanged := previous.memo_id is not null and previous.status = 'active'
    and previous.attention_level = p_level
    and previous.storage_purpose_ciphertext is not distinct from p_purpose_ciphertext;
  if not unchanged then
    update public.memo_attention_history set ended_at = at_time where memo_id = p_memo_id and owner_id = p_owner_id and ended_at is null;
    insert into public.memo_attention_history(memo_id, owner_id, attention_level, storage_purpose_ciphertext, started_at)
      values(p_memo_id, p_owner_id, p_level, p_purpose_ciphertext, at_time);
  end if;
  insert into public.memo_later_items(memo_id, owner_id, status, attention_level, storage_purpose_ciphertext,
    activated_at, updated_at, resolved_at, repeat_daily, repeat_next_on, heavy_marked, deferred_at, bottom_order, manual_order)
  values(p_memo_id, p_owner_id, 'active', p_level, p_purpose_ciphertext,
    case when unchanged and p_level <> 'do_later' then previous.activated_at else at_time end, at_time, null,
    p_level = 'do_later' and coalesce(p_repeat_daily, previous.repeat_daily, false),
    case when unchanged and p_level = 'do_later' and coalesce(p_repeat_daily, previous.repeat_daily, false) then previous.repeat_next_on else null end,
    case when unchanged then previous.heavy_marked else false end,
    case when unchanged and p_level <> 'do_later' then previous.deferred_at else null end,
    case when unchanged and p_level <> 'do_later' then previous.bottom_order else null end,
    case when unchanged and p_level <> 'do_later' then previous.manual_order else null end)
  on conflict (memo_id) do update set
    status = excluded.status, attention_level = excluded.attention_level, storage_purpose_ciphertext = excluded.storage_purpose_ciphertext,
    activated_at = excluded.activated_at, updated_at = excluded.updated_at, resolved_at = null,
    repeat_daily = excluded.repeat_daily, repeat_next_on = excluded.repeat_next_on, heavy_marked = excluded.heavy_marked,
    deferred_at = excluded.deferred_at, bottom_order = excluded.bottom_order, manual_order = excluded.manual_order;
end;
$$;
revoke all on function public.set_memo_placement(uuid,uuid,text,text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.set_memo_placement(uuid,uuid,text,text,text,boolean,boolean) to service_role;
