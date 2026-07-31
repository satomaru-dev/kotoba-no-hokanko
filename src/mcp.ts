import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Runtime } from "./runtime.js";

const inputSchema = {
  query: z.string().min(4).describe("The current personal idea, worry, or decision"),
  max_results: z.number().int().min(1).max(3).optional().default(3)
};

export const createMemoryMcpServer = (runtime: Runtime): McpServer => {
  const server = new McpServer({
    name: "contextual-memory",
    version: "0.1.0"
  });

  server.registerTool(
    "recall_related",
    {
      title: "Recall related personal memories",
      description:
        "Find up to three strongly related past notes. Use before answering personal ideas, worries, or decisions; do not use for simple factual or operational questions.",
      inputSchema
    },
    async ({ query, max_results }) => {
      const response = await runtime.recall.recall(query, max_results);
      return {
        content: [{ type: "text", text: JSON.stringify(response.results, null, 2) }],
        structuredContent: { query: response.query, results: response.results }
      };
    }
  );

  return server;
};
