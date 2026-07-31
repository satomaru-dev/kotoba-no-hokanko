import { readGoogleDriveDocuments } from "./adapters/google-drive.js";
import { pathToFileURL } from "node:url";
import { readNotionDocuments } from "./adapters/notion.js";
import { readObsidianDocuments } from "./adapters/obsidian.js";
import { readConnectorSnapshot } from "./adapters/snapshot.js";
import { indexDocuments } from "./indexer.js";
import { createRuntime } from "./runtime.js";
import type { RawDocument } from "./types.js";

export const runSync = async (): Promise<void> => {
  const runtime = await createRuntime();
  try {
    const documents: RawDocument[] = [];
    const { config } = runtime;

    if (config.obsidianRoot) {
      documents.push(
        ...(await readObsidianDocuments(
          config.obsidianRoot,
          config.obsidianInclude,
          config.obsidianExclude
        ))
      );
    }
    if (config.connectorSnapshotPath) {
      documents.push(...(await readConnectorSnapshot(config.connectorSnapshotPath)));
    }
    if (config.notionToken) {
      documents.push(
        ...(await readNotionDocuments(config.notionToken, config.notionRootPageIds))
      );
    }
    if (
      config.googleClientId &&
      config.googleClientSecret &&
      config.googleRefreshToken &&
      config.googleDriveFolderIds.length > 0
    ) {
      documents.push(
        ...(await readGoogleDriveDocuments(
          config.googleClientId,
          config.googleClientSecret,
          config.googleRefreshToken,
          config.googleDriveFolderIds
        ))
      );
    }

    const summary = await indexDocuments(
      documents,
      runtime.repository,
      runtime.embeddings
    );
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await runtime.repository.close();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSync().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
