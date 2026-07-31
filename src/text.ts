import { createHash } from "node:crypto";
import type { RawDocument } from "./types.js";

const normalizeWhitespace = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export const extractUserAuthoredText = (content: string): string => {
  if (!content.includes("## 🧑 質問 (User)")) return content;
  const matches = [
    ...content.matchAll(/## 🧑 質問 \(User\)\s*([\s\S]*?)(?=\n---\s*\n|\n## 🤖|$)/g)
  ];
  return matches.map((match) => match[1]?.trim()).filter(Boolean).join("\n\n");
};

export const chunkDocument = (
  document: RawDocument,
  maxChars = 1200,
  overlapChars = 150
): string[] => {
  const withoutFrontmatter = document.content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
  const source = normalizeWhitespace(extractUserAuthoredText(withoutFrontmatter));
  if (!source) return [];
  const chunks: string[] = [];
  for (const section of source.split(/(?=^#{1,4}\s+)/m)) {
    const clean = normalizeWhitespace(section);
    if (clean.replace(/^#{1,6}\s+/gm, "").trim().length < 20) continue;
    if (clean.length <= maxChars) {
      chunks.push(clean);
      continue;
    }
    let start = 0;
    while (start < clean.length) {
      let end = Math.min(clean.length, start + maxChars);
      if (end < clean.length) {
        const paragraphEnd = clean.lastIndexOf("\n\n", end);
        if (paragraphEnd > start + maxChars / 2) end = paragraphEnd;
      }
      chunks.push(clean.slice(start, end).trim());
      if (end >= clean.length) break;
      start = Math.max(start + 1, end - overlapChars);
    }
  }
  return chunks;
};

export const makeContentHash = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

export const makeMemoryId = (sourceUri: string, chunkIndex: number): string =>
  createHash("sha256").update(`${sourceUri}#${chunkIndex}`).digest("hex").slice(0, 32);

export const makeExcerpt = (text: string, maxChars = 500): string => {
  const clean = normalizeWhitespace(text).replace(/^#{1,6}\s+/gm, "");
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars - 1)}…`;
};

export const inferDateFromName = (name: string): string | null => {
  const match = name.match(
    /\b(19|20)\d{2}[-_.年](1[0-2]|0?[1-9])[-_.月](3[01]|[12]\d|0?[1-9])/
  );
  if (!match) return null;
  const [year, month, day] = match[0].replace(/[年月_.]/g, "-").split("-");
  return `${year}-${month?.padStart(2, "0")}-${day?.padStart(2, "0")}T00:00:00.000Z`;
};
