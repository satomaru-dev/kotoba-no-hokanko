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
import { WorkspaceStore } from "./workspaces.js";

const runtime = await createRuntime();
if (process.env.NODE_ENV === "production" && !runtime.config.apiToken) {
  throw new Error("MEMORY_API_TOKEN is required in production");
}

const captures = new CaptureStore(runtime.config.captureFilePath, runtime);
await captures.initialize();
const workspaces = new WorkspaceStore(path.join(path.dirname(runtime.config.captureFilePath), "workspaces.json"));
await workspaces.initialize();
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
      : await runtime.recall.recall(input.text, 10);
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
    response.json(await runtime.recall.recall(query, 10));
  } catch (error) {
    next(error);
  }
});

app.get("/api/search-insights", (_request: Request, response: Response) => {
  response.json(captures.listSearchInsights());
});

app.post("/api/search-insights", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const { query } = z.object({ query: z.string().trim().min(2).max(20_000) }).parse(request.body);
    response.json(await captures.recordSearch(query));
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

app.get("/api/do-later", (request: Request, response: Response) => {
  const view = request.query.view === "resolved" ? "resolved" : "active";
  response.json({ items: captures.listDoLater(view) });
});

app.post("/api/memos/:id/do-later", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const body = request.body as { attention_level?: string };
    const item = await captures.addDoLater(String(request.params.id ?? ""), z.enum(["do_later", "keep_in_mind", "important_insight"]).catch("do_later").parse(body.attention_level));
    if (!item) {
      response.status(404).json({ error: "not_found" });
      return;
    }
    response.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/memos/:id/do-later", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const body = request.body as { order?: unknown };
    if (body.order !== undefined) {
      const ids = Array.isArray(body.order) ? body.order.map((value) => String(value)) : [];
      const items = await captures.reorderDoLater(ids);
      if (!items) { response.status(400).json({ error: "invalid_request" }); return; }
      response.json({ item: items.find((item) => item.memo_id === String(request.params.id ?? "")) ?? items[0] });
      return;
    }
    next();
  } catch (error) { next(error); }
});

app.patch("/api/memos/:id/do-later", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const body = request.body as { action?: string; configuration?: unknown; attention_level?: string };
    const id = String(request.params.id ?? "");
    const item = body.attention_level !== undefined
      ? await captures.updateAttentionLevel(id, z.enum(["do_later", "keep_in_mind", "important_insight"]).parse(body.attention_level))
      : body.configuration !== undefined
      ? await captures.configureDoLater(id, z.object({
          first_step: z.string().max(500).nullable(),
          launch_url: z.string().url().refine((value) => /^https?:$/.test(new URL(value).protocol)).nullable(),
          roulette_enabled: z.boolean()
        }).parse(body.configuration))
      : await captures.updateDoLater(id, z.object({
          action: z.enum(["done", "later", "abandon"])
        }).parse(body).action);
    if (!item) {
      response.status(404).json({ error: "not_found" });
      return;
    }
    response.json({ item });
  } catch (error) {
    next(error);
  }
});

const workspaceId = (request: Request): string => String(request.params.id ?? "");

app.get("/api/memos/:id/workspace", async (request: Request, response: Response, next: NextFunction) => {
  try {
    response.json({ workspace: await workspaces.get(workspaceId(request)) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/memos/:id/workspace", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const input = z.object({
      mode: z.enum(["choose", "create"]),
      label: z.string().trim().max(80).optional()
    }).parse(request.body);
    const result = await workspaces.createOrChoose(workspaceId(request), input.mode, input.label);
    response.status(result.status === "success" ? 201 : 200).json({ status: result.status, workspace: result.value });
  } catch (error) {
    next(error);
  }
});

app.post("/api/memos/:id/workspace/path", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const input = z.object({
      mode: z.enum(["choose", "create"]),
      path: z.string().trim().min(1).max(1000),
      label: z.string().trim().max(80).optional()
    }).parse(request.body);
    const result = await workspaces.createFromPath(workspaceId(request), input.mode, input.path, input.label);
    response.status(result.status === "success" ? 201 : 200).json({ status: result.status, workspace: result.value });
  } catch (error) {
    next(error);
  }
});

app.post("/api/memos/:id/workspace/files", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const result = await workspaces.addFiles(workspaceId(request));
    response.json({ status: result.status, ...result.value });
  } catch (error) {
    next(error);
  }
});

app.post("/api/memos/:id/workspace/open", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const result = await workspaces.open(workspaceId(request));
    response.json({ status: result.status, workspace: result.value });
  } catch (error) {
    next(error);
  }
});

app.get("/api/workspace-helper/health", async (_request: Request, response: Response, next: NextFunction) => {
  try {
    response.json({ status: await workspaces.helperHealth() });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/memos/:id/workspace", async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!await workspaces.unlink(workspaceId(request))) {
      response.status(404).json({ error: "workspace_not_found" });
      return;
    }
    response.status(204).end();
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
