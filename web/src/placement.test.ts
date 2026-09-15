import { describe, expect, it } from "vitest";
import { historicalPlacementMemos, placementLabel, storagePurposes } from "./placement";
import type { AttentionHistoryItem, Memo } from "./types";

const memo: Memo = { id: "a", original_text: "原文", current_text: "原文", title: "", captured_at: "", updated_at: "", deleted_at: null, revisions: [], attention_level: null };
const history: AttentionHistoryItem[] = ["旅行", "ブログ", "旅行"].map((purpose, i) => ({ id: String(i), memo_id: "a", memo, attention_level: "keep_for_use", storage_purpose: purpose, started_at: "", ended_at: "" }));
describe("placement selection", () => {
  it("uses the original purpose text in its label", () => expect(placementLabel("keep_for_use", "旅行の計画")).toBe("旅行の計画に使うから取っておく"));
  it("deduplicates suggestions but does not rewrite similar names", () => {
    expect(storagePurposes([], history)).toHaveLength(2);
    expect(storagePurposes([{ ...memo, attention_level: "keep_for_use", storage_purpose: "旅行計画" }], history)).toHaveLength(3);
  });
  it("finds cleared memos by previous purpose without duplicating memos", () => {
    expect(historicalPlacementMemos(history, [memo], "keep_for_use", "旅行")).toEqual([memo]);
    expect(historicalPlacementMemos(history, [memo], "keep_in_mind", "")).toEqual([]);
    expect(historicalPlacementMemos(history, [{ ...memo, deleted_at: "today" }], "", "")).toEqual([]);
  });
});
