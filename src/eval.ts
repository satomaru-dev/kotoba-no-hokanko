import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HashEmbeddingProvider } from "./embeddings.js";
import { representativeMemories } from "./fixtures.js";
import { FileMemoryRepository } from "./file-repository.js";
import { indexDocuments } from "./indexer.js";
import { RecallService } from "./search.js";

interface EvalCase {
  query: string;
  expected: string[];
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contextual-memory-eval-"));
const repository = new FileMemoryRepository(path.join(directory, "memories.json"));
const embeddings = new HashEmbeddingProvider();
await repository.initialize();
await indexDocuments(representativeMemories, repository, embeddings);
const recall = new RecallService(repository, embeddings, 0.12, 3);
const cases = JSON.parse(
  await fs.readFile(path.resolve("evals/cases.json"), "utf8")
) as EvalCase[];

let passed = 0;
for (const item of cases) {
  const response = await recall.recall(item.query);
  const titles = response.results.map((result) => result.title);
  const useful = item.expected.some((expected) => titles.includes(expected));
  if (useful) passed += 1;
  process.stdout.write(`${useful ? "PASS" : "FAIL"} ${item.query} -> ${titles.join(" / ")}\n`);
}

await repository.close();
process.stdout.write(`\n${passed}/${cases.length} cases contained a useful top-3 result\n`);
if (passed < 16) process.exitCode = 1;
