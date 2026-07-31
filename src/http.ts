import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { CaptureStore } from "./capture-store.js";
import { createMemoryMcpServer } from "./mcp.js";
import { createRuntime } from "./runtime.js";
import { assertAuthorized } from "./security.js";

const runtime = await createRuntime();
if (process.env.NODE_ENV === "production" && !runtime.config.apiToken) {
  throw new Error("MEMORY_API_TOKEN is required in production");
}

const captures = new CaptureStore(runtime.config.captureFilePath, runtime);
await captures.initialize();
const app = createMcpExpressApp();
app.use(express.json({ limit: "256kb" }));

app.get("/health", async (_request: Request, response: Response) => {
  response.json({
    ok: true,
    service: "contextual-memory",
    indexed_memories: await runtime.repository.count()
  });
});

const captureSchema = z.object({
  client_id: z.string().min(8).max(100),
  text: z.string().trim().min(1).max(20_000),
  captured_at: z.string().datetime().optional()
});

app.post("/api/capture", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const input = captureSchema.parse(request.body);
    const existing = captures.get(input.client_id);
    const related = existing
      ? { results: [] }
      : await runtime.recall.recall(input.text, 3);
    const memo = await captures.capture(
      input.client_id,
      input.text,
      input.captured_at ?? new Date().toISOString()
    );
    response.status(existing ? 200 : 201).json({ memo, related: related.results });
  } catch (error) {
    next(error);
  }
});

app.post("/api/search", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const { query } = z.object({ query: z.string().trim().min(2).max(20_000) }).parse(request.body);
    response.json(await runtime.recall.recall(query, 3));
  } catch (error) {
    next(error);
  }
});

app.get("/api/memos", (request: Request, response: Response) => {
  const deleted = request.query.deleted === "true";
  const cursor = typeof request.query.cursor === "string" ? request.query.cursor : null;
  const limit = Math.min(50, Math.max(1, Number(request.query.limit) || 20));
  const all = captures.list(deleted);
  const filtered = cursor ? all.filter((memo) => memo.captured_at < cursor) : all;
  const memos = filtered.slice(0, limit);
  response.json({
    memos,
    next_cursor: filtered.length > limit ? memos.at(-1)?.captured_at ?? null : null
  });
});

app.get("/api/memos/:id", (request: Request, response: Response) => {
  const memo = captures.get(String(request.params.id ?? ""));
  if (!memo) {
    response.status(404).json({ error: "not_found" });
    return;
  }
  response.json({ memo });
});

app.patch("/api/memos/:id", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const input = z.object({
      text: z.string().trim().min(1).max(20_000),
      title: z.string().trim().max(200).optional()
    }).parse(request.body);
    const memo = await captures.update(String(request.params.id ?? ""), input.text, input.title);
    if (!memo) {
      response.status(404).json({ error: "not_found" });
      return;
    }
    response.json({ memo });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/memos/:id", async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!await captures.trash(String(request.params.id ?? ""))) {
      response.status(404).json({ error: "not_found" });
      return;
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/memos/:id/restore", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const memo = await captures.restore(String(request.params.id ?? ""));
    if (!memo) {
      response.status(404).json({ error: "not_found" });
      return;
    }
    response.json({ memo });
  } catch (error) {
    next(error);
  }
});

app.all("/mcp", async (request: Request, response: Response) => {
  if (!assertAuthorized(request.header("authorization"), runtime.config.apiToken)) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  if (request.method !== "POST") {
    response.status(405).set("Allow", "POST").json({ error: "method_not_allowed" });
    return;
  }
  const server = createMemoryMcpServer(runtime);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response, request.body);
});

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist-web");
app.use(express.static(webRoot, { index: "index.html" }));
app.get("/", (_request: Request, response: Response) => {
  response.sendFile(path.join(webRoot, "index.html"));
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: "invalid_request", details: error.flatten() });
    return;
  }
  process.stderr.write(`request failed: ${error instanceof Error ? error.message : "unknown"}\n`);
  response.status(500).json({ error: "internal_error" });
});

const listener = app.listen(runtime.config.port, () => {
  process.stdout.write(
    `ことばの保管庫: http://127.0.0.1:${runtime.config.port}\nMCP: http://127.0.0.1:${runtime.config.port}/mcp\n`
  );
});

const shutdown = async (): Promise<void> => {
  listener.close();
  await runtime.repository.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
