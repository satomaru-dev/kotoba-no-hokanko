import fs from "node:fs/promises";
import path from "node:path";
import type { Runtime } from "./runtime.js";
import { makeContentHash } from "./text.js";
import type { MemoryRecord } from "./types.js";

export interface MemoRevision {
  text: string;
  title: string;
  revised_at: string;
}

export interface CapturedMemo {
  id: string;
  original_text: string;
  current_text: string;
  title: string;
  captured_at: string;
  updated_at: string;
  deleted_at: string | null;
  revisions: MemoRevision[];
}

const titleFromText = (text: string): string => {
  const first = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "無題のことば";
  return first.length <= 42 ? first : `${first.slice(0, 41)}…`;
};

export class CaptureStore {
  private memos = new Map<string, CapturedMemo>();

  constructor(
    private readonly filePath: string,
    private readonly runtime: Runtime
  ) {}

  async initialize(): Promise<void> {
    try {
      const value = JSON.parse(await fs.readFile(this.filePath, "utf8")) as CapturedMemo[];
      this.memos = new Map(value.map((memo) => [memo.id, memo]));
      for (const memo of value.filter((item) => !item.deleted_at)) await this.index(memo);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify([...this.memos.values()], null, 2), "utf8");
    await fs.rename(temporary, this.filePath);
  }

  private async index(memo: CapturedMemo): Promise<void> {
    const [embedding] = await this.runtime.embeddings.embed([`${memo.title}\n${memo.current_text}`]);
    const record: MemoryRecord = {
      memory_id: memo.id,
      source_type: "mobile_app",
      source_uri: `memory://memo/${memo.id}`,
      title: memo.title,
      recorded_at: memo.captured_at,
      modified_at: memo.updated_at,
      excerpt: memo.current_text.slice(0, 500),
      search_text: memo.current_text,
      author_role: "user",
      content_hash: makeContentHash(memo.current_text),
      embedding: embedding ?? [],
      metadata: { captured_in: "ことばの保管庫" }
    };
    await this.runtime.repository.upsert([record]);
  }

  async capture(id: string, text: string, capturedAt: string): Promise<CapturedMemo> {
    const existing = this.memos.get(id);
    if (existing) return existing;
    const memo: CapturedMemo = {
      id,
      original_text: text,
      current_text: text,
      title: titleFromText(text),
      captured_at: capturedAt,
      updated_at: capturedAt,
      deleted_at: null,
      revisions: []
    };
    this.memos.set(id, memo);
    await this.persist();
    await this.index(memo);
    return memo;
  }

  list(deleted = false): CapturedMemo[] {
    return [...this.memos.values()]
      .filter((memo) => deleted ? Boolean(memo.deleted_at) : !memo.deleted_at)
      .sort((left, right) => right.captured_at.localeCompare(left.captured_at));
  }

  get(id: string): CapturedMemo | undefined {
    return this.memos.get(id);
  }

  async update(id: string, text: string, title?: string): Promise<CapturedMemo | null> {
    const memo = this.memos.get(id);
    if (!memo || memo.deleted_at) return null;
    memo.revisions.push({
      text: memo.current_text,
      title: memo.title,
      revised_at: new Date().toISOString()
    });
    memo.current_text = text;
    memo.title = title?.trim() || titleFromText(text);
    memo.updated_at = new Date().toISOString();
    await this.persist();
    await this.index(memo);
    return memo;
  }

  async trash(id: string): Promise<boolean> {
    const memo = this.memos.get(id);
    if (!memo || memo.deleted_at) return false;
    memo.deleted_at = new Date().toISOString();
    memo.updated_at = memo.deleted_at;
    await this.persist();
    await this.runtime.repository.deleteBySourceUris([`memory://memo/${id}`]);
    return true;
  }

  async restore(id: string): Promise<CapturedMemo | null> {
    const memo = this.memos.get(id);
    if (!memo || !memo.deleted_at) return null;
    memo.deleted_at = null;
    memo.updated_at = new Date().toISOString();
    await this.persist();
    await this.index(memo);
    return memo;
  }
}
