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

  it("keeps start assistance separate from the memo and preserves it on reactivation", async () => {
    const { store } = await makeStore();
    const id = "66666666-6666-4666-8666-666666666666";
    const memo = await store.capture(id, "元の言葉は変更しない", "2026-08-01T00:00:00.000Z");
    await store.addDoLater(id, "2026-08-01T01:00:00.000Z");
    await store.configureDoLater(id, {
      first_step: "まず見出しだけ読む",
      launch_url: "https://example.com/start",
      roulette_enabled: true
    });
    const configured = store.listDoLater("active")[0];
    expect(configured?.first_step).toBe("まず見出しだけ読む");
    expect(configured?.launch_url).toBe("https://example.com/start");
    expect(configured?.roulette_enabled).toBe(true);
    await store.updateDoLater(id, "done", "2026-08-01T02:00:00.000Z");
    await store.addDoLater(id, "2026-08-01T03:00:00.000Z");
    const reactivated = store.listDoLater("active")[0];
    expect(reactivated?.first_step).toBe("まず見出しだけ読む");
    expect(reactivated?.roulette_enabled).toBe(true);
    expect(store.get(id)).toEqual(memo);
  });

  it("moves a deferred active item to the bottom", async () => {
    const { store } = await makeStore();
    const firstId = "77777777-7777-4777-8777-777777777777";
    const secondId = "88888888-8888-4888-8888-888888888888";
    await store.capture(firstId, "first", "2026-08-01T00:00:00.000Z");
    await store.capture(secondId, "second", "2026-08-01T01:00:00.000Z");
    await store.addDoLater(firstId, "2026-08-01T02:00:00.000Z");
    await store.addDoLater(secondId, "2026-08-01T03:00:00.000Z");
    await store.updateDoLater(secondId, "later", "2026-08-01T04:00:00.000Z");
    expect(store.listDoLater("active").map((item) => item.memo_id)).toEqual([firstId, secondId]);
  });

  it("orders active items by attention level and preserves legacy defaults", async () => {
    const { store } = await makeStore();
    const ids = ["99999999-9999-4999-8999-999999999991", "99999999-9999-4999-8999-999999999992", "99999999-9999-4999-8999-999999999993"];
    await store.capture(ids[0]!, "one", "2026-08-01T00:00:00.000Z");
    await store.capture(ids[1]!, "two", "2026-08-01T01:00:00.000Z");
    await store.capture(ids[2]!, "three", "2026-08-01T02:00:00.000Z");
    await store.addDoLater(ids[0]!, "2026-08-01T03:00:00.000Z");
    await store.addDoLater(ids[1]!, "keep_in_mind", "2026-08-01T04:00:00.000Z");
    await store.addDoLater(ids[2]!, "important_insight", "2026-08-01T05:00:00.000Z");
    expect(store.listDoLater("active").map((item) => item.memo_id)).toEqual([ids[2], ids[1], ids[0]]);
  });

  it("reorders active do-later items and preserves the order", async () => {
    const { store } = await makeStore();
    const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"];
    for (const [index, id] of ids.entries()) await store.capture(id, id, "2026-08-01T0" + index + ":00:00.000Z");
    for (const id of ids) await store.addDoLater(id, "do_later");
    expect(await store.reorderDoLater([ids[2]!, ids[0]!, ids[1]!])).not.toBeNull();
    expect(store.listDoLater("active").map((item) => item.memo_id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it("reorders visible do-later items while preserving a trashed item", async () => {
    const { store } = await makeStore();
    const ids = ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"];
    for (const [index, id] of ids.entries()) await store.capture(id, id, "2026-08-02T0" + index + ":00:00.000Z");
    for (const id of ids) await store.addDoLater(id, "do_later");

    await store.trash(ids[1]!);
    expect(await store.reorderDoLater([ids[0]!, ids[2]!])).not.toBeNull();
    expect(store.listDoLater("active").map((item) => item.memo_id)).toEqual([ids[0], ids[2]]);

    await store.restore(ids[1]!);
    expect(store.listDoLater("active").map((item) => item.memo_id)).toContain(ids[1]);
  });

  it("records normalized search insights without changing memo data", async () => {
    const { store } = await makeStore();
    const first = await store.recordSearch("  アイデア   探索 ");
    expect(first.recent[0]?.text).toBe("アイデア 探索");
    await store.recordSearch("アイデア 探索");
    const second = store.listSearchInsights();
    expect(second.frequent[0]?.count).toBe(2);
    expect(second.recent[0]?.text).toBe("アイデア 探索");
  });});
