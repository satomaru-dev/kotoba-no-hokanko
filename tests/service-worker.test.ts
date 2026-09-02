import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("never intercepts or caches authentication responses, while retaining the app shell cache", () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const fetch = vi.fn().mockResolvedValue({ clone: () => ({}) });
  runInNewContext(readFileSync("web/public/sw.js", "utf8"), {
    URL, fetch,
    caches: { open: vi.fn().mockResolvedValue({ put: vi.fn() }) },
    self: {
      location: { origin: "https://example.com" },
      addEventListener: (name: string, callback: (event: unknown) => void) => { handlers[name] = callback; }
    }
  });
  for (const url of ["https://project.supabase.co/auth/v1/user", "https://example.com/auth/v1/user", "https://project.supabase.co/functions/v1/memory-api/memos"]) {
    const respondWith = vi.fn();
    handlers.fetch!({ request: { url, method: "GET" }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  }
  expect(fetch).not.toHaveBeenCalled();
  const respondWith = vi.fn();
  handlers.fetch!({ request: { url: "https://example.com/assets/app.js", method: "GET" }, respondWith });
  expect(respondWith).toHaveBeenCalledOnce();
});
