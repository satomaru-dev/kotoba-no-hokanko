export type SourceType =
  | "obsidian"
  | "notion"
  | "google_drive"
  | "connector_snapshot"
  | "mobile_app";

export type AuthorRole = "user" | "approved_ai" | "unknown";

export interface MemoryRecord {
  memory_id: string;
  source_type: SourceType;
  source_uri: string;
  title: string;
  recorded_at: string | null;
  modified_at: string;
  excerpt: string;
  search_text: string;
  author_role: AuthorRole;
  content_hash: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export type MemoryRelation =
  | "同じ悩み・発想"
  | "組み合わせ可能"
  | "以前と変化"
  | "試したが残らなかった";

export interface SearchCandidate extends MemoryRecord {
  semantic_score: number;
  lexical_score: number;
}

export interface RecallResult {
  memory_id: string;
  date: string | null;
  excerpt: string;
  source_uri: string;
  source_type: SourceType;
  title: string;
  relation: MemoryRelation;
  confidence: number;
}

export interface RecallResponse {
  query: string;
  results: RecallResult[];
}

export interface RawDocument {
  source_type: SourceType;
  source_uri: string;
  title: string;
  recorded_at: string | null;
  modified_at: string;
  content: string;
  author_role: AuthorRole;
  metadata?: Record<string, unknown>;
}
