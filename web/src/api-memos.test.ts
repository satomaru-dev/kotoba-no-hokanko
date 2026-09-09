import { afterEach, expect, it, vi } from "vitest";
import { listMemos } from "./api";

afterEach(() => vi.unstubAllGlobals());
it("loads beyond 50 and 100 memos, carrying the cursor and deleted flag", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ memos: Array.from({ length: 100 }, (_, id) => ({ id: String(id) })), next_cursor: '["2026-09-01T00:00:00Z","99"]' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ memos: [{ id: "100" }], next_cursor: null })));
  vi.stubGlobal("fetch", fetchMock);
  expect(await listMemos(true)).toHaveLength(101);
  expect(fetchMock.mock.calls[1]![0]).toContain("deleted=true");
  expect(fetchMock.mock.calls[1]![0]).toContain("cursor=");
});
it("does not report a partial list as complete when a later page fails", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ memos: [{ id: "1" }], next_cursor: "next" })))
    .mockResolvedValueOnce(new Response("{}", { status: 500 })));
  await expect(listMemos()).rejects.toThrow();
});
