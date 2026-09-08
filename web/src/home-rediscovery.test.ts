import { describe, expect, it } from "vitest";
import { chooseImportantMemo } from "./home-rediscovery";
import type { Memo } from "./types";

const memo = (id: string): Memo => ({ id, original_text: id, current_text: id, title: id, captured_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null, revisions: [], attention_level: "important_insight" });

describe("important insight rotation", () => {
  it("does not repeat until the candidates have made a full cycle", () => {
    const memos = [memo("a"), memo("b"), memo("c")];
    let state = { seen: [] as string[], current: null as string | null };
    const picked: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const result = chooseImportantMemo(memos, state, () => 0);
      picked.push(result.id!); state = result.state;
    }
    const next = chooseImportantMemo(memos, state, () => 0);
    expect(new Set(picked).size).toBe(3);
    expect(next.id).not.toBe(picked.at(-1));
  });

  it("keeps showing the only candidate", () => {
    const result = chooseImportantMemo([memo("only")], { seen: ["only"], current: "only" }, () => 0);
    expect(result.id).toBe("only");
  });
});
