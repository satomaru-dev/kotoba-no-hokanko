import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CaptureStore } from "../src/capture-store.js";
import { HashEmbeddingProvider } from "../src/embeddings.js";
import { FileMemoryRepository } from "../src/file-repository.js";
import { RecallService } from "../src/search.js";
import type { Runtime } from "../src/runtime.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

const makeStore = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capture-test-"));
  directories.push(directory);
  const repository = new FileMemoryRepository(path.join(directory, "memory.json"));
  const embeddings = new HashEmbeddingProvider();
  await repository.initialize();
  const runtime = {
    config: {} as Runtime["config"],
    repository,
    embeddings,
    recall: new RecallService(repository, embeddings, 0.12, 3)
  };
  const store = new CaptureStore(path.join(directory, "captures.json"), runtime);
  await store.initialize();
  return { store, runtime };
};

describe("capture store", () => {
  it("preserves the original and makes repeat client IDs idempotent", async () => {
    const { store } = await makeStore();
    const id = "11111111-1111-4111-8111-111111111111";
    const first = await store.capture(id, "最初の言葉\n温度を残したい。", "2026-07-31T00:00:00.000Z");
    const repeated = await store.capture(id, "別の本文", "2026-07-31T01:00:00.000Z");
    expect(repeated.original_text).toBe(first.original_text);

    const updated = await store.update(id, "手直しした言葉", "手直し");
    expect(updated?.original_text).toBe("最初の言葉\n温度を残したい。");
    expect(updated?.revisions).toHaveLength(1);
  });

  it("removes trashed notes from recall and restores them", async () => {
    const { store, runtime } = await makeStore();
    const id = "22222222-2222-4222-8222-222222222222";
    await store.capture(id, "ゼロから考えると斬新すぎるアイデアになる。", "2026-07-31T00:00:00.000Z");
    expect((await runtime.recall.recall("斬新すぎるアイデア")).results).toHaveLength(1);
    await store.trash(id);
    expect((await runtime.recall.recall("斬新すぎるアイデア")).results).toHaveLength(0);
    await store.restore(id);
    expect((await runtime.recall.recall("斬新すぎるアイデア")).results).toHaveLength(1);
  });

  it("keeps a single do-later state without changing the memo", async () => {
    const { store } = await makeStore();
    const firstId = "33333333-3333-4333-8333-333333333333";
    const secondId = "44444444-4444-4444-8444-444444444444";
    const first = await store.capture(firstId, "あとで試したいアイデア", "2026-08-01T00:00:00.000Z");
    await store.capture(secondId, "もう一つのアイデア", "2026-08-01T01:00:00.000Z");

    await store.addDoLater(firstId, "2026-08-01T02:00:00.000Z");
    await store.addDoLater(secondId, "2026-08-01T03:00:00.000Z");
    await store.addDoLater(firstId, "2026-08-01T04:00:00.000Z");
    expect(store.listDoLater("active").map((item) => item.memo_id)).toEqual([firstId, secondId]);

    await store.updateDoLater(firstId, "done", "2026-08-01T05:00:00.000Z");
    expect(store.listDoLater("active").map((item) => item.memo_id)).toEqual([secondId]);
    expect(store.listDoLater("resolved")[0]?.status).toBe("done");

    await store.addDoLater(firstId, "2026-08-01T06:00:00.000Z");
    expect(store.listDoLater("resolved")).toHaveLength(0);
    expect(store.get(firstId)).toEqual(first);
  });

  it("hides deleted do-later items and shows them again after restore", async () => {
    const { store } = await makeStore();
    const id = "55555555-5555-4555-8555-555555555555";
    await store.capture(id, "あとでやるかもしれない", "2026-08-01T00:00:00.000Z");
    await store.addDoLater(id, "2026-08-01T01:00:00.000Z");
    await store.trash(id);
    expect(store.listDoLater("active")).toHaveLength(0);
    await store.restore(id);
    expect(store.listDoLater("active").map((item) => item.memo_id)).toEqual([id]);
  });
});
