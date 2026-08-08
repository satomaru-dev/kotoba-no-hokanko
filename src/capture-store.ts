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

export type DoLaterStatus = "active" | "done" | "abandoned";

export interface DoLaterItem {
  memo_id: string;
  status: DoLaterStatus;
  activated_at: string;
  deferred_at: string | null;
  updated_at: string;
  resolved_at: string | null;
  first_step: string | null;
  launch_url: string | null;
  roulette_enabled: boolean;
  memo: CapturedMemo;
}

interface StoredDoLaterItem {
  memo_id: string;
  status: DoLaterStatus;
  activated_at: string;
  deferred_at: string | null;
  updated_at: string;
  resolved_at: string | null;
  first_step: string | null;
  launch_url: string | null;
  roulette_enabled: boolean;
}

export interface DoLaterConfiguration {
  first_step: string | null;
  launch_url: string | null;
  roulette_enabled: boolean;
}

export interface SearchTerm {
  text: string;
  count: number;
  last_used_at: string;
}

export interface SearchInsights {
  recent: SearchTerm[];
  frequent: SearchTerm[];
}

interface StoredCaptureData {
  memos: CapturedMemo[];
  do_later: StoredDoLaterItem[];
  search_insights?: SearchTerm[];
}

const titleFromText = (text: string): string => {
  const first = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "無題のことば";
  return first.length <= 42 ? first : `${first.slice(0, 41)}…`;
};

export class CaptureStore {
  private memos = new Map<string, CapturedMemo>();
  private doLater = new Map<string, StoredDoLaterItem>();
  private searchInsights = new Map<string, SearchTerm>();

  constructor(
    private readonly filePath: string,
    private readonly runtime: Runtime
  ) {}

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8")) as CapturedMemo[] | StoredCaptureData;
      const memos = Array.isArray(parsed) ? parsed : parsed.memos;
      const doLater = Array.isArray(parsed) ? [] : (parsed.do_later ?? []);
      const searchInsights = Array.isArray(parsed) ? [] : (parsed.search_insights ?? []);
      this.memos = new Map(memos.map((memo) => [memo.id, memo]));
      this.searchInsights = new Map(searchInsights.map((item) => [item.text, item]));
      this.doLater = new Map(doLater.map((item) => [item.memo_id, {
        deferred_at: null,
        first_step: null,
        launch_url: null,
        roulette_enabled: false,
        ...(item as Partial<StoredDoLaterItem>)
      } as StoredDoLaterItem]));
      for (const memo of memos.filter((item) => !item.deleted_at)) await this.index(memo);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    const data: StoredCaptureData = {
      memos: [...this.memos.values()],
      do_later: [...this.doLater.values()],
      search_insights: [...this.searchInsights.values()]
    };
    await fs.writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
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

  listDoLater(view: "active" | "resolved"): DoLaterItem[] {
    return [...this.doLater.values()]
      .filter((item) => view === "active" ? item.status === "active" : item.status !== "active")
      .map((item) => ({ ...item, memo: this.memos.get(item.memo_id)! }))
      .filter((item) => item.memo && !item.memo.deleted_at)
      .sort((left, right) => {
        if (view === "active") {
          const leftDeferred = left.deferred_at !== null;
          const rightDeferred = right.deferred_at !== null;
          if (leftDeferred !== rightDeferred) return leftDeferred ? 1 : -1;
          if (leftDeferred && rightDeferred) return left.deferred_at!.localeCompare(right.deferred_at!);
          return right.activated_at.localeCompare(left.activated_at);
        }
        const leftDate = left.resolved_at ?? left.updated_at;
        const rightDate = right.resolved_at ?? right.updated_at;
        return rightDate.localeCompare(leftDate);
      });
  }

  async addDoLater(id: string, now = new Date().toISOString()): Promise<DoLaterItem | null> {
    const memo = this.memos.get(id);
    if (!memo || memo.deleted_at) return null;
    const previous = this.doLater.get(id);
    const item: StoredDoLaterItem = {
      ...(previous ?? {
        deferred_at: null,
        first_step: null,
        launch_url: null,
        roulette_enabled: false
      }),
      memo_id: id,
      status: "active",
      activated_at: now,
      deferred_at: null,
      updated_at: now,
      resolved_at: null
    };
    this.doLater.set(id, item);
    await this.persist();
    return { ...item, memo };
  }

  async updateDoLater(
    id: string,
    action: "done" | "later" | "abandon",
    now = new Date().toISOString()
  ): Promise<DoLaterItem | null> {
    const memo = this.memos.get(id);
    const current = this.doLater.get(id);
    if (!memo || memo.deleted_at || !current) return null;
    const status: DoLaterStatus = action === "done"
      ? "done"
      : action === "abandon"
        ? "abandoned"
        : "active";
    const item: StoredDoLaterItem = {
      ...current,
      status,
      activated_at: action === "later" ? now : current.activated_at,
      deferred_at: action === "later" ? now : current.deferred_at,
      updated_at: now,
      resolved_at: status === "active" ? null : now
    };
    this.doLater.set(id, item);
    await this.persist();
    return { ...item, memo };
  }

  async configureDoLater(
    id: string,
    configuration: DoLaterConfiguration,
    now = new Date().toISOString()
  ): Promise<DoLaterItem | null> {
    const memo = this.memos.get(id);
    const current = this.doLater.get(id);
    if (!memo || memo.deleted_at || !current) return null;
    const item: StoredDoLaterItem = { ...current, ...configuration, updated_at: now };
    this.doLater.set(id, item);
    await this.persist();
    return { ...item, memo };
  }

listSearchInsights(): SearchInsights {
    const terms = [...this.searchInsights.values()];
    return {
      recent: [...terms].sort((left, right) => right.last_used_at.localeCompare(left.last_used_at)).slice(0, 8),
      frequent: [...terms].sort((left, right) => right.count - left.count || right.last_used_at.localeCompare(left.last_used_at)).slice(0, 8)
    };
  }

  async recordSearch(query: string, now = new Date().toISOString()): Promise<SearchInsights> {
    const text = query.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ja-JP");
    if (!text) return this.listSearchInsights();
    const previous = this.searchInsights.get(text);
    this.searchInsights.set(text, {
      text,
      count: (previous?.count ?? 0) + 1,
      last_used_at: now
    });
    await this.persist();
    return this.listSearchInsights();
  }
}
