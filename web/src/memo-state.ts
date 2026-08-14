import type { DoLaterItem, Memo } from "./types";

export const mergeMemo = (previous: Memo, updated: Memo): Memo => ({
  ...updated,
  attention_level: updated.attention_level ?? previous.attention_level ?? null
});

export const replaceMemo = (items: Memo[], updated: Memo): Memo[] =>
  items.map((item) => item.id === updated.id ? mergeMemo(item, updated) : item);

export const prependMemo = (items: Memo[], memo: Memo): Memo[] => [
  memo,
  ...items.filter((item) => item.id !== memo.id)
];

export const removeMemo = (items: Memo[], memoId: string): Memo[] =>
  items.filter((item) => item.id !== memoId);

export const replaceDoLaterMemo = (items: DoLaterItem[], updated: Memo): DoLaterItem[] =>
  items.map((item) => item.memo_id === updated.id
    ? { ...item, memo: mergeMemo(item.memo, updated) }
    : item);

export const removeDoLaterMemo = (items: DoLaterItem[], memoId: string): DoLaterItem[] =>
  items.filter((item) => item.memo_id !== memoId);
