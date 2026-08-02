export type Relation =
  | "同じ悩み・発想"
  | "組み合わせ可能"
  | "以前と変化"
  | "試したが残らなかった";

export interface RelatedMemory {
  memory_id: string;
  date: string | null;
  excerpt: string;
  source_uri: string;
  source_type: string;
  title: string;
  relation: Relation;
  confidence: number;
  thread_id: string | null;
  dialogue_count: number;
  has_dialogue: boolean;
}

export interface MemoRevision {
  text: string;
  title: string;
  revised_at: string;
}

export interface Memo {
  id: string;
  original_text: string;
  current_text: string;
  title: string;
  captured_at: string;
  updated_at: string;
  deleted_at: string | null;
  revisions: MemoRevision[];
}

export interface CaptureInput {
  client_id: string;
  text: string;
  captured_at: string;
}

export interface CaptureResponse {
  memo: Memo;
  related: RelatedMemory[];
}

export type FeedbackVerdict = "relevant" | "irrelevant";

export interface IdeaThreadEntry {
  id: string;
  kind: "memo_link" | "reflection";
  memo_id: string | null;
  title: string;
  text: string;
  written_at: string;
}

export interface IdeaThread {
  id: string;
  root: {
    memory_id: string;
    source_type: string;
    date: string | null;
    title: string;
    text: string;
    source_uri: string;
  };
  entries: IdeaThreadEntry[];
}

export interface Reminder {
  id: string;
  memo_id: string;
  scheduled_for: string;
  next_attempt_at: string | null;
  delivery_count: number;
  status: "scheduled" | "delivered" | "opened" | "cancelled";
  memo?: Memo | null;
}

export interface ReminderInput {
  client_id: string;
  memo_id: string;
  remind_at: string;
}

export type DoLaterStatus = "active" | "done" | "abandoned";
export type DoLaterAction = "done" | "later" | "abandon";

export interface DoLaterItem {
  memo_id: string;
  status: DoLaterStatus;
  activated_at: string;
  updated_at: string;
  resolved_at: string | null;
  memo: Memo;
}
