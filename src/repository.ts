import type { MemoryRecord, SearchCandidate } from "./types.js";

export interface MemoryRepository {
  initialize(): Promise<void>;
  upsert(records: MemoryRecord[]): Promise<void>;
  search(query: string, embedding: number[], limit: number): Promise<SearchCandidate[]>;
  listHashes(memoryIds: string[]): Promise<Map<string, string>>;
  deleteBySourceUris(sourceUris: string[]): Promise<void>;
  count(): Promise<number>;
  close(): Promise<void>;
}
