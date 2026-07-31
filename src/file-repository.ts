import fs from "node:fs/promises";
import path from "node:path";
import { cosineSimilarity } from "./embeddings.js";
import type { MemoryRepository } from "./repository.js";
import type { MemoryRecord, SearchCandidate } from "./types.js";

const tokenize = (text: string): Set<string> => {
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens = new Set(
    [...normalized.matchAll(/[a-z0-9]{2,}/gu)].map((match) => match[0])
  );
  for (const match of normalized.matchAll(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu
  )) {
    const value = match[0];
    for (const size of [2, 3, 4]) {
      for (let index = 0; index <= value.length - size; index += 1) {
        tokens.add(value.slice(index, index + size));
      }
    }
  }
  return tokens;
};

const lexicalSimilarity = (query: string, candidate: string): number => {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return 0;
  const candidateTokens = tokenize(candidate);
  let matches = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token) || candidate.includes(token)) matches += 1;
  }
  return matches / queryTokens.size;
};

export class FileMemoryRepository implements MemoryRepository {
  private records = new Map<string, MemoryRecord>();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as MemoryRecord[];
      this.records = new Map(parsed.map((record) => [record.memory_id, record]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(
      temporaryPath,
      JSON.stringify([...this.records.values()], null, 2),
      "utf8"
    );
    await fs.rename(temporaryPath, this.filePath);
  }

  async upsert(records: MemoryRecord[]): Promise<void> {
    for (const record of records) this.records.set(record.memory_id, record);
    await this.persist();
  }

  async search(
    query: string,
    embedding: number[],
    limit: number
  ): Promise<SearchCandidate[]> {
    return [...this.records.values()]
      .map((record) => ({
        ...record,
        semantic_score: Math.max(0, cosineSimilarity(embedding, record.embedding)),
        lexical_score: lexicalSimilarity(
          query,
          `${record.title}\n${record.search_text}`
        )
      }))
      .sort(
        (left, right) =>
          right.semantic_score * 0.68 +
          right.lexical_score * 0.32 -
          (left.semantic_score * 0.68 + left.lexical_score * 0.32)
      )
      .slice(0, limit);
  }

  async listHashes(memoryIds: string[]): Promise<Map<string, string>> {
    return new Map(
      memoryIds
        .map((id) => [id, this.records.get(id)?.content_hash] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    );
  }

  async deleteBySourceUris(sourceUris: string[]): Promise<void> {
    const allowed = new Set(sourceUris);
    let changed = false;
    for (const [id, record] of this.records) {
      if (!allowed.has(record.source_uri)) continue;
      this.records.delete(id);
      changed = true;
    }
    if (changed) await this.persist();
  }

  async count(): Promise<number> {
    return this.records.size;
  }

  async close(): Promise<void> {}
}
