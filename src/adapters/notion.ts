import { containsLikelySecret, containsSensitivePath } from "../security.js";
import type { RawDocument } from "../types.js";

interface NotionRichText {
  plain_text?: string;
}

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

const notionRequest = async <T>(
  token: string,
  path: string,
  init?: RequestInit
): Promise<T> => {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) {
    throw new Error(`Notion ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
};

const richTextFromBlock = (block: NotionBlock): string => {
  const value = block[block.type] as
    | { rich_text?: NotionRichText[]; caption?: NotionRichText[] }
    | undefined;
  return value?.rich_text?.map((item) => item.plain_text ?? "").join("") ?? "";
};

const readChildren = async (token: string, blockId: string): Promise<string> => {
  const lines: string[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const response = await notionRequest<{
      results: NotionBlock[];
      has_more: boolean;
      next_cursor: string | null;
    }>(token, `/blocks/${blockId}/children?${query}`);
    for (const block of response.results) {
      const text = richTextFromBlock(block);
      if (text) lines.push(text);
      if (block.has_children) lines.push(await readChildren(token, block.id));
    }
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);
  return lines.filter(Boolean).join("\n");
};

const pageTitle = (properties: Record<string, unknown>): string => {
  for (const value of Object.values(properties)) {
    const property = value as { type?: string; title?: NotionRichText[] };
    if (property.type === "title") {
      return property.title?.map((item) => item.plain_text ?? "").join("") || "Untitled";
    }
  }
  return "Untitled";
};

export const readNotionDocuments = async (
  token: string,
  rootPageIds: string[]
): Promise<RawDocument[]> => {
  if (rootPageIds.length === 0) return [];
  const pageIds = rootPageIds;

  const documents: RawDocument[] = [];
  for (const id of pageIds) {
    const page = await notionRequest<{
      id: string;
      url: string;
      created_time: string;
      last_edited_time: string;
      properties: Record<string, unknown>;
    }>(token, `/pages/${id}`);
    const title = pageTitle(page.properties);
    if (containsSensitivePath(title)) continue;
    const content = await readChildren(token, page.id);
    if (!content || containsLikelySecret(content)) continue;
    documents.push({
      source_type: "notion",
      source_uri: page.url,
      title,
      recorded_at: page.created_time,
      modified_at: page.last_edited_time,
      content,
      author_role: "user",
      metadata: { notion_page_id: page.id }
    });
  }
  return documents;
};
