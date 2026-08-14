import { describe, expect, it } from "vitest";
import type { DoLaterItem, Memo } from "./types";
import { mergeMemo, prependMemo, removeDoLaterMemo, removeMemo, replaceDoLaterMemo, replaceMemo } from "./memo-state";

const memo = (overrides: Partial<Memo> = {}): Memo => ({
  id: "memo-1",
  original_text: "original",
  current_text: "before",
  title: "before",
  captured_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
  deleted_at: null,
  revisions: [],
  attention_level: "keep_in_mind",
  ...overrides
});

describe("memo state updates", () => {
  it("replaces edited text while preserving its attention placement", () => {
    const updated = memo({ current_text: "after", title: "after", attention_level: undefined });
    expect(replaceMemo([memo()], updated)[0]).toMatchObject({
      current_text: "after",
      title: "after",
      attention_level: "keep_in_mind"
    });
  });

  it("moves a trashed memo between visible lists without duplication", () => {
    const trashed = mergeMemo(memo(), memo({ deleted_at: "2026-08-14T01:00:00.000Z", attention_level: undefined }));
    expect(removeMemo([memo()], trashed.id)).toEqual([]);
    expect(prependMemo([memo({ id: "memo-2" })], trashed).map((item) => item.id)).toEqual(["memo-1", "memo-2"]);
  });

  it("updates and removes memo snapshots in do-later lists", () => {
    const item = { memo_id: "memo-1", memo: memo() } as DoLaterItem;
    const updated = memo({ current_text: "after", attention_level: undefined });
    expect(replaceDoLaterMemo([item], updated)[0]?.memo.current_text).toBe("after");
    expect(removeDoLaterMemo([item], "memo-1")).toEqual([]);
  });
});
