import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemoryMcpServer } from "./mcp.js";
import { createRuntime } from "./runtime.js";

const runtime = await createRuntime();
const server = createMemoryMcpServer(runtime);
const transport = new StdioServerTransport();

await server.connect(transport);

const shutdown = async (): Promise<void> => {
  await server.close();
  await runtime.repository.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
