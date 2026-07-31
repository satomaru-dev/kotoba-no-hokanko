import path from "node:path";

const splitCsv = (value: string | undefined): string[] =>
  value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];

const numberFromEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export interface AppConfig {
  port: number;
  apiToken: string | null;
  databaseUrl: string | null;
  memoryFilePath: string;
  captureFilePath: string;
  minConfidence: number;
  maxResults: number;
  embeddingModel: string;
  openAiApiKey: string | null;
  obsidianRoot: string | null;
  obsidianInclude: string[];
  obsidianExclude: string[];
  connectorSnapshotPath: string | null;
  notionToken: string | null;
  notionRootPageIds: string[];
  googleClientId: string | null;
  googleClientSecret: string | null;
  googleRefreshToken: string | null;
  googleDriveFolderIds: string[];
  cloudMemoryApiUrl: string | null;
  cloudMemoryServiceToken: string | null;
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => ({
  port: numberFromEnv(env.PORT, 8787),
  apiToken: env.MEMORY_API_TOKEN?.trim() || null,
  databaseUrl: env.DATABASE_URL?.trim() || null,
  memoryFilePath: path.resolve(env.MEMORY_FILE_PATH || ".data/memories.json"),
  captureFilePath: path.resolve(env.CAPTURE_FILE_PATH || ".data/captures.json"),
  minConfidence: numberFromEnv(env.MEMORY_MIN_CONFIDENCE, 0.52),
  maxResults: Math.min(3, Math.max(1, numberFromEnv(env.MEMORY_MAX_RESULTS, 3))),
  embeddingModel: env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
  openAiApiKey: env.OPENAI_API_KEY?.trim() || null,
  obsidianRoot: env.OBSIDIAN_ROOT?.trim() || null,
  obsidianInclude: splitCsv(env.OBSIDIAN_INCLUDE),
  obsidianExclude: splitCsv(env.OBSIDIAN_EXCLUDE),
  connectorSnapshotPath: env.CONNECTOR_SNAPSHOT_PATH
    ? path.resolve(env.CONNECTOR_SNAPSHOT_PATH)
    : null,
  notionToken: env.NOTION_TOKEN?.trim() || null,
  notionRootPageIds: splitCsv(env.NOTION_ROOT_PAGE_IDS),
  googleClientId: env.GOOGLE_CLIENT_ID?.trim() || null,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET?.trim() || null,
  googleRefreshToken: env.GOOGLE_REFRESH_TOKEN?.trim() || null,
  googleDriveFolderIds: splitCsv(env.GOOGLE_DRIVE_FOLDER_IDS),
  cloudMemoryApiUrl: env.CLOUD_MEMORY_API_URL?.trim() || null,
  cloudMemoryServiceToken: env.CLOUD_MEMORY_SERVICE_TOKEN?.trim() || null
});
