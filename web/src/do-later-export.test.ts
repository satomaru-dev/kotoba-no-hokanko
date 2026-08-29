import { describe, expect, it } from "vitest";
import { deferralsToCsv, formatJstDateTime } from "./do-later-export";

describe("do-later deferral CSV", () => {
  it("formats timestamps in JST", () => {
    expect(formatJstDateTime("2026-08-29T15:01:02.000Z")).toBe("2026-08-30 00:01:02");
  });

  it("adds a BOM and escapes commas, quotes, and line breaks", () => {
    const csv = deferralsToCsv([{
      id: "1",
      memo_id: "memo-1",
      reason: "今日は、\"余裕がない\"\nから",
      memo_text: "年金や、相続の勉強をする",
      deferred_at: "2026-08-29T00:00:00.000Z"
    }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"今日は、""余裕がない""\nから"');
    expect(csv).toContain('"年金や、相続の勉強をする"');
  });
});
