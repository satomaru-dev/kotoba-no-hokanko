import type { EmbeddingProvider } from "./embeddings.js";
import type { MemoryRepository } from "./repository.js";
import {
  chunkDocument,
  makeContentHash,
  makeExcerpt,
  makeMemoryId
} from "./text.js";
import type { MemoryRecord, RawDocument } from "./types.js";

const batch = <T>(items: T[], size: number): T[][] => {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
};

export interface IndexSummary {
  documents: number;
  chunks: number;
  addedOrUpdated: number;
  unchanged: number;
}

export const indexDocuments = async (
  documents: RawDocument[],
  repository: MemoryRepository,
  embeddings: EmbeddingProvider
): Promise<IndexSummary> => {
  const pending = documents.flatMap((document) =>
    chunkDocument(document).map((content, chunkIndex) => ({
      document,
      content,
      chunkIndex,
      memoryId: makeMemoryId(document.source_uri, chunkIndex),
      contentHash: makeContentHash(content)
    }))
  );
  const existingHashes = await repository.listHashes(
    pending.map((item) => item.memoryId)
  );
  const changed = pending.filter(
    (item) => existingHashes.get(item.memoryId) !== item.contentHash
  );

  let upserted = 0;
  for (const group of batch(changed, 64)) {
    const vectors = await embeddings.embed(
      group.map((item) => `${item.document.title}\n${item.content}`)
    );
    const records: MemoryRecord[] = group.map((item, index) => ({
      memory_id: item.memoryId,
      source_type: item.document.source_type,
      source_uri: item.document.source_uri,
      title: item.document.title,
      recorded_at: item.document.recorded_at,
      modified_at: item.document.modified_at,
      excerpt: makeExcerpt(item.content),
      search_text: item.content,
      author_role: item.document.author_role,
      content_hash: item.contentHash,
      embedding: vectors[index] ?? [],
      metadata: {
        ...(item.document.metadata ?? {}),
        chunk_index: item.chunkIndex
      }
    }));
    await repository.upsert(records);
    upserted += records.length;
  }

  return {
    documents: documents.length,
    chunks: pending.length,
    addedOrUpdated: upserted,
    unchanged: pending.length - upserted
  };
};
