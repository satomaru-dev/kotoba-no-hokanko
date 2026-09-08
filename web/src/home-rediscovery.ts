import type { Memo } from "./types";

export type HomeMode = "rediscovery" | "write";
export interface RotationState { seen: string[]; current: string | null; }

export const rotationKey = (owner: string): string => `kotoba-home-rotation-v1:${owner}`;
export const modeKey = (owner: string): string => `kotoba-home-mode-v1:${owner}`;

export const readRotation = (owner: string): RotationState => {
  try {
    const value = localStorage.getItem(rotationKey(owner));
    if (!value) return { seen: [], current: null };
    const parsed = JSON.parse(value) as Partial<RotationState>;
    return { seen: Array.isArray(parsed.seen) ? parsed.seen.filter((id): id is string => typeof id === "string") : [], current: typeof parsed.current === "string" ? parsed.current : null };
  } catch { return { seen: [], current: null }; }
};

export const writeRotation = (owner: string, value: RotationState): void => {
  try { localStorage.setItem(rotationKey(owner), JSON.stringify(value)); } catch { /* optional preference */ }
};

export const readHomeMode = (owner: string): HomeMode => {
  try { return localStorage.getItem(modeKey(owner)) === "write" ? "write" : "rediscovery"; } catch { return "rediscovery"; }
};

export const writeHomeMode = (owner: string, value: HomeMode): void => {
  try { localStorage.setItem(modeKey(owner), value); } catch { /* optional preference */ }
};

export const chooseImportantMemo = (
  memos: Memo[],
  state: RotationState,
  random = Math.random
): { id: string | null; state: RotationState } => {
  const candidates = memos.filter((memo) => memo.attention_level === "important_insight");
  if (candidates.length === 0) return { id: null, state: { seen: [], current: null } };
  const ids = new Set(candidates.map((memo) => memo.id));
  const seen = state.seen.filter((id) => ids.has(id));
  let available = candidates.filter((memo) => !seen.includes(memo.id));
  if (available.length === 0) {
    const resetSeen = candidates.length > 1 && state.current ? [state.current] : [];
    available = candidates.filter((memo) => !resetSeen.includes(memo.id));
    const index = Math.floor(random() * available.length);
    const selected = available[index] ?? candidates[0]!;
    return { id: selected.id, state: { seen: [...resetSeen, selected.id], current: selected.id } };
  }
  const selected = available[Math.floor(random() * available.length)] ?? available[0]!;
  return { id: selected.id, state: { seen: [...seen, selected.id], current: selected.id } };
};
