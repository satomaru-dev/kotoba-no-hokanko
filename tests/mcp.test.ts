import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { HashEmbeddingProvider } from "../src/embeddings.js";
import { representativeMemories } from "../src/fixtures.js";
import { FileMemoryRepository } from "../src/file-repository.js";
import { indexDocuments } from "../src/indexer.js";
import { createMemoryMcpServer } from "../src/mcp.js";
import { RecallService } from "../src/search.js";
import type { Runtime } from "../src/runtime.js";

const tempDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  );
});

describe("MCP interface", () => {
  it("publishes only recall_related and caps results at three", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-"));
    tempDirectories.push(directory);
    const repository = new FileMemoryRepository(path.join(directory, "memory.json"));
    const embeddings = new HashEmbeddingProvider();
    await repository.initialize();
    await indexDocuments(representativeMemories, repository, embeddings);
    const runtime = {
      config: {} as Runtime["config"],
      repository,
      embeddings,
      recall: new RecallService(repository, embeddings, 0.12, 3)
    };
    const server = createMemoryMcpServer(runtime);
    const client = new Client({ name: "test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["recall_related"]);
    const result = await client.callTool({
      name: "recall_related",
      arguments: { query: "タスク管理が続かない", max_results: 3 }
    });
    const structured = result.structuredContent as { results: unknown[] };
    expect(structured.results.length).toBeGreaterThan(0);
    expect(structured.results.length).toBeLessThanOrEqual(3);

    await client.close();
    await server.close();
    await repository.close();
  });
});
