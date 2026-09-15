begin;
do $$
declare
  owner uuid;
  memo uuid := gen_random_uuid();
  n bigint;
begin
  select owner_id into owner from public.captured_memos limit 1;
  if owner is null then raise exception 'test needs an existing owner'; end if;
  insert into public.captured_memos(id,owner_id,original_ciphertext,current_ciphertext,title_ciphertext,embedding,blind_tokens,captured_at)
    select memo,owner,original_ciphertext,current_ciphertext,title_ciphertext,embedding,blind_tokens,clock_timestamp()
    from public.captured_memos limit 1;
  perform public.set_memo_placement(memo,owner,'keep_in_mind');
  perform public.set_memo_placement(memo,owner,'keep_for_use','encrypted-purpose-A');
  perform public.set_memo_placement(memo,owner,'keep_for_use','encrypted-purpose-A','encrypted-purpose-A');
  select count(*) into n from public.memo_attention_history where memo_id=memo;
  if n <> 2 then raise exception 'duplicate history'; end if;
  perform public.set_memo_placement(memo,owner,'keep_for_use','encrypted-purpose-B','encrypted-purpose-A');
  begin
    perform public.set_memo_placement(memo,gen_random_uuid(),'keep_in_mind');
    raise exception 'owner check missing';
  exception when others then
    if sqlerrm <> 'memo_not_found' then raise; end if;
  end;
  begin
    perform public.set_memo_placement(memo,owner,'keep_in_mind',null,'stale-purpose');
    raise exception 'conflict check missing';
  exception when others then
    if sqlerrm <> 'placement_conflict' then raise; end if;
  end;
  if not exists(select 1 from public.memo_later_items where memo_id=memo and storage_purpose_ciphertext='encrypted-purpose-B') then raise exception 'failed request changed state'; end if;
  perform public.set_memo_placement(memo,owner,null,null,'encrypted-purpose-B');
  if not exists(select 1 from public.captured_memos where id=memo) then raise exception 'memo lost'; end if;
  if exists(select 1 from public.memo_later_items where memo_id=memo) then raise exception 'placement not cleared'; end if;
  select count(*) into n from public.memo_attention_history where memo_id=memo and ended_at is not null;
  if n <> 3 then raise exception 'history lost'; end if;
  update public.captured_memos set deleted_at=clock_timestamp() where id=memo;
  begin
    perform public.set_memo_placement(memo,owner,'keep_in_mind');
    raise exception 'trash check missing';
  exception when others then
    if sqlerrm <> 'memo_not_found' then raise; end if;
  end;
  delete from public.captured_memos where id=memo;
  if exists(select 1 from public.memo_attention_history where memo_id=memo) then raise exception 'cascade missing'; end if;
  if has_function_privilege('anon','public.set_memo_placement(uuid,uuid,text,text,text,boolean,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.set_memo_placement(uuid,uuid,text,text,text,boolean,boolean)','EXECUTE')
    or not has_function_privilege('service_role','public.set_memo_placement(uuid,uuid,text,text,text,boolean,boolean)','EXECUTE') then raise exception 'function permissions'; end if;
  if has_table_privilege('anon','public.memo_attention_history','SELECT')
    or has_table_privilege('authenticated','public.memo_attention_history','SELECT') then raise exception 'table permissions'; end if;
end $$;
rollback;
select 'placement database checks passed; test data rolled back' as result;
