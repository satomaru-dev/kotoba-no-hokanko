import type { AttentionHistoryItem, AttentionLevel, Memo } from "./types";

export const placementLabels: Record<AttentionLevel, string> = {
  do_later: "あとでやる",
  keep_in_mind: "しばらく見えるところに置いておきたい",
  important_insight: "今の自分にとって結構重要な気づき",
  app_improvement: "言葉の保管庫の改善アイデア",
  keep_for_use: "使うために取っておく"
};

// app_improvement is kept here only so legacy memos and their history remain readable.
export const selectablePlacementLevels: AttentionLevel[] = [
  "do_later",
  "keep_in_mind",
  "important_insight",
  "keep_for_use"
];

export const placementLabel = (level: AttentionLevel, purpose?: string | null): string =>
  level === "keep_for_use" && purpose ? `${purpose}に使うから取っておく` : placementLabels[level];

export const storagePurposes = (memos: Memo[], history: AttentionHistoryItem[]): string[] =>
  [...new Set([
    ...memos.filter(m => !m.deleted_at && m.attention_level === "keep_for_use").map(m => m.storage_purpose),
    ...history.filter(h => !h.memo.deleted_at && h.attention_level === "keep_for_use").map(h => h.storage_purpose)
  ].filter((p): p is string => Boolean(p)))].sort((a, b) => a.localeCompare(b, "ja"));

export const historicalPlacementMemos = (history: AttentionHistoryItem[], current: Memo[], level: string, purpose: string): Memo[] => {
  const memos = new Map(current.map(m => [m.id, m]));
  const result = new Map<string, Memo>();
  for (const item of history) {
    const memo = memos.get(item.memo_id) ?? item.memo;
    if (memo.deleted_at || (level && item.attention_level !== level) || (purpose && item.storage_purpose !== purpose)) continue;
    if (!result.has(memo.id)) result.set(memo.id, memo);
  }
  return [...result.values()];
};
