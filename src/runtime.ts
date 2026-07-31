import { loadConfig } from "./config.js";
import {
  HashEmbeddingProvider,
  OpenAIEmbeddingProvider,
  type EmbeddingProvider
} from "./embeddings.js";
import { FileMemoryRepository } from "./file-repository.js";
import { PostgresMemoryRepository } from "./postgres-repository.js";
import type { MemoryRepository } from "./repository.js";
import { RecallService } from "./search.js";
import { CloudRecallService, type RecallProvider } from "./cloud-recall.js";

export interface Runtime {
  config: ReturnType<typeof loadConfig>;
  embeddings: EmbeddingProvider;
  repository: MemoryRepository;
  recall: RecallProvider;
}

export const createRuntime = async (): Promise<Runtime> => {
  const config = loadConfig();
  const repository: MemoryRepository = config.databaseUrl
    ? new PostgresMemoryRepository(config.databaseUrl)
    : new FileMemoryRepository(config.memoryFilePath);
  const embeddings: EmbeddingProvider = config.openAiApiKey
    ? new OpenAIEmbeddingProvider(config.openAiApiKey, config.embeddingModel)
    : new HashEmbeddingProvider();
  await repository.initialize();
  return {
    config,
    embeddings,
    repository,
    recall: config.cloudMemoryApiUrl && config.cloudMemoryServiceToken
      ? new CloudRecallService(config.cloudMemoryApiUrl, config.cloudMemoryServiceToken)
      : new RecallService(
          repository,
          embeddings,
          config.minConfidence,
          config.maxResults
        )
  };
};
