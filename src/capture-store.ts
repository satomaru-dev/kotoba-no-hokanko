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

export type AttentionLevel = "do_later" | "keep_in_mind" | "important_insight";
export type DoLaterStatus = "active" | "done" | "abandoned";

export interface DoLaterItem {
  memo_id: string;
  status: DoLaterStatus;
  activated_at: string;
  deferred_at: string | null;
  bottom_order: number | null;
  manual_order: number | null;
  attention_level: AttentionLevel;
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
  bottom_order: number | null;
  manual_order: number | null;
  attention_level: AttentionLevel;
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
        bottom_order: null,
        manual_order: null,
        attention_level: "do_later",
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
    const activeAttention = new Map([...this.doLater.values()]
      .filter((item) => item.status === "active")
      .map((item) => [item.memo_id, item.attention_level]));
    return [...this.memos.values()]
      .filter((memo) => deleted ? Boolean(memo.deleted_at) : !memo.deleted_at)
      .map((memo) => ({ ...memo, attention_level: activeAttention.get(memo.id) ?? null }))
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
          const rank = { do_later: 1, keep_in_mind: 2, important_insight: 3 } as const;
          const leftRank = rank[left.attention_level] ?? 1;
          const rightRank = rank[right.attention_level] ?? 1;
          if (leftRank !== rightRank) return rightRank - leftRank;
          const leftManual = left.manual_order !== null;
          const rightManual = right.manual_order !== null;
          if (leftManual !== rightManual) return leftManual ? 1 : -1;
          if (leftManual && rightManual) return (left.manual_order ?? 0) - (right.manual_order ?? 0);
          const leftBottom = left.bottom_order !== null;
          const rightBottom = right.bottom_order !== null;
          if (leftBottom !== rightBottom) return leftBottom ? 1 : -1;
          if (leftBottom && rightBottom) return (left.bottom_order ?? 0) - (right.bottom_order ?? 0);
          return right.activated_at.localeCompare(left.activated_at);
        }
        const leftDate = left.resolved_at ?? left.updated_at;
        const rightDate = right.resolved_at ?? right.updated_at;
        return rightDate.localeCompare(leftDate);
      });
  }

  async addDoLater(id: string, attentionLevelOrNow: AttentionLevel | string = "do_later", now = new Date().toISOString()): Promise<DoLaterItem | null> {
    const legacyTimestamp = attentionLevelOrNow.includes("T");
    const attentionLevel: AttentionLevel = legacyTimestamp ? "do_later" : attentionLevelOrNow as AttentionLevel;
    if (legacyTimestamp) now = attentionLevelOrNow;
    const memo = this.memos.get(id);
    if (!memo || memo.deleted_at) return null;
    const previous = this.doLater.get(id);
    const item: StoredDoLaterItem = {
      ...(previous ?? {
        deferred_at: null,
        bottom_order: null,
        manual_order: null,
        attention_level: "do_later",
        first_step: null,
        launch_url: null,
        roulette_enabled: false
      }),
      memo_id: id,
      status: "active",
      activated_at: now,
      deferred_at: null,
      bottom_order: null,
      manual_order: null,
      attention_level: attentionLevel,
      updated_at: now,
      resolved_at: null
    };
    this.doLater.set(id, item);
    await this.persist();
    return { ...item, memo };
  }

  async updateAttentionLevel(id: string, attentionLevel: AttentionLevel, now = new Date().toISOString()): Promise<DoLaterItem | null> {
    const memo = this.memos.get(id);
    const current = this.doLater.get(id);
    if (!memo || memo.deleted_at || !current || current.status !== "active") return null;
    const item: StoredDoLaterItem = { ...current, attention_level: attentionLevel, updated_at: now };
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
      activated_at: current.activated_at,
      deferred_at: action === "later" ? now : current.deferred_at,
      bottom_order: action === "later" ? Date.parse(now) : current.bottom_order,
      manual_order: action === "later" ? Math.max(-1, ...[...this.doLater.values()].filter((item) => item.status === "active" && item.attention_level === "do_later" && item.memo_id !== id).map((item) => item.manual_order ?? -1)) + 1 : current.manual_order,
      updated_at: now,
      resolved_at: status === "active" ? null : now
    };
    this.doLater.set(id, item);
    await this.persist();
    return { ...item, memo };
  }

  async reorderDoLater(ids: string[], now = new Date().toISOString()): Promise<DoLaterItem[] | null> {
    const active = [...this.doLater.values()].filter((item) => {
      const memo = this.memos.get(item.memo_id);
      return item.status === "active"
        && item.attention_level === "do_later"
        && Boolean(memo)
        && !memo?.deleted_at;
    });
    const allowed = new Set(active.map((item) => item.memo_id));
    if (ids.length !== allowed.size || new Set(ids).size !== ids.length || ids.some((id) => !allowed.has(id))) return null;
    ids.forEach((id, index) => {
      const item = this.doLater.get(id)!;
      this.doLater.set(id, { ...item, manual_order: index + 1, updated_at: now });
    });
    await this.persist();
    return this.listDoLater("active");
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
