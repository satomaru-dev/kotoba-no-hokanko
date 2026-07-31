import pg from "pg";
import type { MemoryRepository } from "./repository.js";
import type { MemoryRecord, SearchCandidate } from "./types.js";

const { Pool } = pg;

const toVector = (embedding: number[]): string => `[${embedding.join(",")}]`;

export class PostgresMemoryRepository implements MemoryRepository {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl:
        connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
          ? undefined
          : { rejectUnauthorized: false }
    });
  }

  async initialize(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async upsert(records: MemoryRecord[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const record of records) {
        await client.query(
          `INSERT INTO memories (
             memory_id, source_type, source_uri, title, recorded_at, modified_at,
             excerpt, search_text, author_role, content_hash, embedding, metadata
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, $12::jsonb
           )
           ON CONFLICT (memory_id) DO UPDATE SET
             source_type = EXCLUDED.source_type,
             source_uri = EXCLUDED.source_uri,
             title = EXCLUDED.title,
             recorded_at = EXCLUDED.recorded_at,
             modified_at = EXCLUDED.modified_at,
             excerpt = EXCLUDED.excerpt,
             search_text = EXCLUDED.search_text,
             author_role = EXCLUDED.author_role,
             content_hash = EXCLUDED.content_hash,
             embedding = EXCLUDED.embedding,
             metadata = EXCLUDED.metadata`,
          [
            record.memory_id,
            record.source_type,
            record.source_uri,
            record.title,
            record.recorded_at,
            record.modified_at,
            record.excerpt,
            record.search_text,
            record.author_role,
            record.content_hash,
            toVector(record.embedding),
            JSON.stringify(record.metadata)
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async search(
    query: string,
    embedding: number[],
    limit: number
  ): Promise<SearchCandidate[]> {
    const result = await this.pool.query<SearchCandidate>(
      `SELECT
         memory_id, source_type, source_uri, title,
         recorded_at::text, modified_at::text, excerpt, search_text,
         author_role, content_hash, metadata,
         1 - (embedding <=> $2::vector) AS semantic_score,
         GREATEST(
           similarity(title || ' ' || excerpt, $1),
           ts_rank_cd(search_vector, websearch_to_tsquery('simple', $1))
         ) AS lexical_score,
         ARRAY[]::real[] AS embedding
       FROM memories
       ORDER BY (
         (1 - (embedding <=> $2::vector)) * 0.68 +
         GREATEST(
           similarity(title || ' ' || excerpt, $1),
           ts_rank_cd(search_vector, websearch_to_tsquery('simple', $1))
         ) * 0.32
       ) DESC
       LIMIT $3`,
      [query, toVector(embedding), limit]
    );
    return result.rows.map((row) => ({
      ...row,
      semantic_score: Number(row.semantic_score),
      lexical_score: Number(row.lexical_score)
    }));
  }

  async listHashes(memoryIds: string[]): Promise<Map<string, string>> {
    if (memoryIds.length === 0) return new Map();
    const result = await this.pool.query<{ memory_id: string; content_hash: string }>(
      "SELECT memory_id, content_hash FROM memories WHERE memory_id = ANY($1)",
      [memoryIds]
    );
    return new Map(result.rows.map((row) => [row.memory_id, row.content_hash]));
  }

  async deleteBySourceUris(sourceUris: string[]): Promise<void> {
    if (sourceUris.length === 0) return;
    await this.pool.query("DELETE FROM memories WHERE source_uri = ANY($1)", [
      sourceUris
    ]);
  }

  async count(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM memories"
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
