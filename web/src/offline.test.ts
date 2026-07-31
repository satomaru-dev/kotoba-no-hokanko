import { describe, expect, it } from "vitest";
import { listQueuedCaptures, queueCapture, removeQueuedCapture } from "./offline";

describe("offline capture queue", () => {
  it("keeps a capture until synchronization succeeds", async () => {
    const item = {
      client_id: crypto.randomUUID(),
      text: "通信がなくても、この言葉は消えない。",
      captured_at: new Date().toISOString()
    };
    await queueCapture(item);
    expect((await listQueuedCaptures()).find((queued) => queued.client_id === item.client_id)).toEqual(item);
    await removeQueuedCapture(item.client_id);
    expect((await listQueuedCaptures()).find((queued) => queued.client_id === item.client_id)).toBeUndefined();
  });
});
