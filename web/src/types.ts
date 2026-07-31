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
