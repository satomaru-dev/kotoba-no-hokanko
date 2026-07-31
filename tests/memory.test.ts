import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HashEmbeddingProvider } from "../src/embeddings.js";
import { representativeMemories } from "../src/fixtures.js";
import { FileMemoryRepository } from "../src/file-repository.js";
import { indexDocuments } from "../src/indexer.js";
import { RecallService } from "../src/search.js";
import { containsLikelySecret, containsSensitivePath } from "../src/security.js";
import { extractUserAuthoredText } from "../src/text.js";

const tempDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  );
});

const makeRecall = async (): Promise<RecallService> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));
  tempDirectories.push(directory);
  const repository = new FileMemoryRepository(path.join(directory, "memories.json"));
  const embeddings = new HashEmbeddingProvider();
  await repository.initialize();
  await indexDocuments(representativeMemories, repository, embeddings);
  return new RecallService(repository, embeddings, 0.12, 3);
};

describe("contextual recall", () => {
  it("returns the February and April task-management memories", async () => {
    const response = await (await makeRecall()).recall("タスク管理が続かない");
    expect(response.results.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "週1回の仕分けはできない",
        "TODOに疑問や議事録まで混ざっている"
      ])
    );
    expect(response.results.length).toBeLessThanOrEqual(3);
  });

  it("distinguishes MPSP production from marketing paralysis", async () => {
    const response = await (await makeRecall()).recall(
      "MPSPを作るのは楽しいのに集客で止まる"
    );
    expect(response.results.map((item) => item.title)).toEqual(
      expect.arrayContaining(["MPSP制作中は没頭できる", "MPSPは集客で止まる"])
    );
  });

  it("does not force memories into a simple shopping operation", async () => {
    const response = await (await makeRecall()).recall("Amazonの注文履歴の開き方");
    expect(response.results).toEqual([]);
  });
});

describe("privacy boundaries", () => {
  it("rejects customer and credential paths", () => {
    expect(containsSensitivePath("顧客/山田様/契約.md")).toBe(true);
    expect(containsSensitivePath("notes/.env")).toBe(true);
    expect(containsSensitivePath("PB/自己理解.md")).toBe(false);
  });

  it("rejects likely secrets", () => {
    expect(containsLikelySecret("api_key=sk-exampleabcdefghijklmnopqrstuv")).toBe(true);
  });

  it("indexes only the user's part of archived AI chats", () => {
    const source =
      "## 🧑 質問 (User)\n自分の悩み\n\n---\n## 🤖 回答 (Assistant)\nAIだけの提案";
    expect(extractUserAuthoredText(source)).toBe("自分の悩み");
  });
});
