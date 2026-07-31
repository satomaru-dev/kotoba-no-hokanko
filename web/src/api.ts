import { createClient, type Session } from "@supabase/supabase-js";
import type {
  CaptureInput,
  CaptureResponse,
  FeedbackVerdict,
  IdeaThread,
  Memo,
  RelatedMemory,
  Reminder,
  ReminderInput
} from "./types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const cloudMode = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = cloudMode
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: true, detectSessionInUrl: true }
    })
  : null;

const edgeBase = cloudMode ? `${supabaseUrl}/functions/v1/memory-api` : "/api";

const request = async <T>(
  path: string,
  init: RequestInit = {},
  session?: Session | null
): Promise<T> => {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (cloudMode) {
    const active = session ?? (await supabase!.auth.getSession()).data.session;
    if (!active) throw new Error("ログインが必要です");
    headers.set("Authorization", `Bearer ${active.access_token}`);
    headers.set("apikey", supabaseAnonKey!);
  }
  const response = await fetch(`${edgeBase}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `通信に失敗しました (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

export const captureMemo = (input: CaptureInput): Promise<CaptureResponse> =>
  request("/capture", { method: "POST", body: JSON.stringify(input) });

export const searchMemories = async (query: string): Promise<RelatedMemory[]> => {
  const result = await request<{ query: string; results: RelatedMemory[] }>(
    "/search",
    { method: "POST", body: JSON.stringify({ query }) }
  );
  return result.results;
};

export const listMemos = async (deleted = false): Promise<Memo[]> => {
  const result = await request<{ memos: Memo[] }>(`/memos?deleted=${deleted}`);
  return result.memos;
};

export const updateMemo = async (id: string, text: string, title: string): Promise<Memo> => {
  const result = await request<{ memo: Memo }>(`/memos/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ text, title })
  });
  return result.memo;
};

export const trashMemo = (id: string): Promise<void> =>
  request(`/memos/${id}`, { method: "DELETE" });

export const restoreMemo = async (id: string): Promise<Memo> => {
  const result = await request<{ memo: Memo }>(`/memos/${id}/restore`, { method: "POST" });
  return result.memo;
};

export const saveFeedback = (
  queryMemoId: string,
  candidateMemoryId: string,
  verdict: FeedbackVerdict
): Promise<{ saved: boolean }> =>
  request("/feedback", {
    method: "POST",
    body: JSON.stringify({
      query_memo_id: queryMemoId,
      candidate_memory_id: candidateMemoryId,
      verdict
    })
  });

export const createIdeaThread = async (
  rootMemoryId: string,
  currentMemoId?: string
): Promise<IdeaThread> => {
  const result = await request<{ thread: IdeaThread }>("/idea-threads", {
    method: "POST",
    body: JSON.stringify({
      root_memory_id: rootMemoryId,
      current_memo_id: currentMemoId
    })
  });
  return result.thread;
};

export const getIdeaThread = async (id: string): Promise<IdeaThread> => {
  const result = await request<{ thread: IdeaThread }>(`/idea-threads/${id}`);
  return result.thread;
};

export const addIdeaThreadEntry = async (id: string, text: string): Promise<IdeaThread> => {
  const result = await request<{ thread: IdeaThread }>(`/idea-threads/${id}/entries`, {
    method: "POST",
    body: JSON.stringify({ text })
  });
  return result.thread;
};

export const getPushPublicKey = async (): Promise<string> => {
  const result = await request<{ public_key: string }>("/push/public-key");
  return result.public_key;
};

export const savePushSubscription = (subscription: PushSubscriptionJSON) =>
  request<{ subscribed: boolean }>("/push/subscriptions", {
    method: "POST",
    body: JSON.stringify({ subscription })
  });

export const createReminder = async (input: ReminderInput): Promise<Reminder> => {
  const result = await request<{ reminder: Reminder }>(`/memos/${input.memo_id}/reminders`, {
    method: "POST",
    body: JSON.stringify({
      client_id: input.client_id,
      remind_at: input.remind_at
    })
  });
  return result.reminder;
};

export const listDueReminders = async (): Promise<Reminder[]> => {
  const result = await request<{ reminders: Reminder[] }>("/reminders");
  return result.reminders;
};

export const markReminderOpened = (id: string) =>
  request<{ opened: boolean }>(`/reminders/${id}/open`, { method: "POST" });

export const cancelReminder = (id: string): Promise<void> =>
  request(`/reminders/${id}`, { method: "DELETE" });
