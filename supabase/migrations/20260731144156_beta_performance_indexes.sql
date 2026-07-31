create index if not exists idea_thread_entries_memo_id_idx
  on public.idea_thread_entries (memo_id)
  where memo_id is not null;

create index if not exists idea_thread_entries_owner_id_idx
  on public.idea_thread_entries (owner_id);

create index if not exists memory_feedback_query_memo_id_idx
  on public.memory_feedback (query_memo_id);

create index if not exists reminders_memo_id_idx
  on public.reminders (memo_id);
