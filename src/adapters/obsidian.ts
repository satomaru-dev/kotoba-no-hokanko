import fs from "node:fs/promises";
import path from "node:path";
import { containsLikelySecret, containsSensitivePath } from "../security.js";
import { inferDateFromName } from "../text.js";
import type { RawDocument } from "../types.js";

const inferAuthorRole = (content: string): RawDocument["author_role"] => {
  const match = content.match(
    /^---\s*\n[\s\S]*?\nauthor_role:\s*(user|approved_ai|unknown)\s*\n[\s\S]*?\n---/m
  );
  return (match?.[1] as RawDocument["author_role"] | undefined) ?? "user";
};

const shouldInclude = (relativePath: string, includeRules: string[]): boolean => {
  if (includeRules.length === 0) return true;
  const normalized = relativePath.replaceAll("\\", "/");
  return includeRules.some((rule) => {
    const clean = rule.replaceAll("\\", "/").replace(/\*\*\/?$/, "");
    if (rule === "*.md" && !normalized.includes("/")) return true;
    return normalized.startsWith(clean);
  });
};

const toFileUri = (filePath: string): string =>
  new URL(`file:///${filePath.replaceAll("\\", "/")}`).toString();

export const readObsidianDocuments = async (
  root: string,
  includeRules: string[] = [],
  excludeRules: string[] = []
): Promise<RawDocument[]> => {
  const rootPath = path.resolve(root);
  const documents: RawDocument[] = [];
  const extraDeny = excludeRules.map((rule) => {
    const escaped = rule
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("**", ".*")
      .replaceAll("*", "[^/\\\\]*");
    return new RegExp(escaped, "i");
  });

  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(rootPath, absolutePath);
      if (containsSensitivePath(relativePath, extraDeny)) continue;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") && entry.name !== ".obsidian") continue;
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") continue;
      if (!shouldInclude(relativePath, includeRules)) continue;
      const content = await fs.readFile(absolutePath, "utf8");
      if (containsLikelySecret(content)) continue;
      const stats = await fs.stat(absolutePath);
      documents.push({
        source_type: "obsidian",
        source_uri: toFileUri(absolutePath),
        title: path.basename(entry.name, ".md"),
        recorded_at: inferDateFromName(entry.name),
        modified_at: stats.mtime.toISOString(),
        content,
        author_role: inferAuthorRole(content),
        metadata: { relative_path: relativePath.replaceAll("\\", "/") }
      });
    }
  };

  await visit(rootPath);
  return documents;
};
