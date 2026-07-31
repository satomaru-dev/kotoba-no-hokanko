import fs from "node:fs/promises";
import { containsLikelySecret, containsSensitivePath } from "../security.js";
import type { RawDocument, SourceType } from "../types.js";

interface SnapshotLine {
  source_type: SourceType;
  source_uri: string;
  title: string;
  recorded_at?: string | null;
  modified_at?: string;
  content: string;
  author_role?: "user" | "approved_ai" | "unknown";
  metadata?: Record<string, unknown>;
}

export const readConnectorSnapshot = async (
  filePath: string
): Promise<RawDocument[]> => {
  try {
    const data = await fs.readFile(filePath, "utf8");
    return data
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SnapshotLine)
      .filter((item) => !containsSensitivePath(`${item.title} ${item.source_uri}`))
      .filter((item) => !containsLikelySecret(item.content))
      .map((item) => ({
        source_type: item.source_type,
        source_uri: item.source_uri,
        title: item.title,
        recorded_at: item.recorded_at ?? null,
        modified_at: item.modified_at ?? new Date().toISOString(),
        content: item.content,
        author_role: item.author_role ?? "user",
        metadata: item.metadata ?? {}
      }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};
