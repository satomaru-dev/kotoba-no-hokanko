import fs from "node:fs/promises";
import { loadConfig } from "./config.js";
import type { MemoryRecord } from "./types.js";

const config = loadConfig();
if (!config.cloudMemoryApiUrl || !config.cloudMemoryServiceToken) {
  throw new Error("CLOUD_MEMORY_API_URL and CLOUD_MEMORY_SERVICE_TOKEN are required");
}

const records = JSON.parse(
  await fs.readFile(config.memoryFilePath, "utf8")
) as MemoryRecord[];

let imported = 0;
for (let index = 0; index < records.length; index += 50) {
  const group = records.slice(index, index + 50).map((record) => ({
    memory_id: record.memory_id,
    source_type: record.source_type,
    source_uri: record.source_uri,
    title: record.title,
    excerpt: record.excerpt,
    recorded_at: record.recorded_at,
    modified_at: record.modified_at
  }));
  const response = await fetch(
    `${config.cloudMemoryApiUrl.replace(/\/$/, "")}/import`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Memory-Service-Token": config.cloudMemoryServiceToken
      },
      body: JSON.stringify({ records: group })
    }
  );
  if (!response.ok) {
    throw new Error(`cloud import failed at record ${index} (${response.status})`);
  }
  const result = await response.json() as { imported: number };
  imported += result.imported;
  process.stdout.write(`Imported ${imported}/${records.length}\n`);
}
