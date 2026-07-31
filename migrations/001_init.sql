CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS memories (
  memory_id text PRIMARY KEY,
  source_type text NOT NULL,
  source_uri text NOT NULL,
  title text NOT NULL,
  recorded_at timestamptz,
  modified_at timestamptz NOT NULL,
  excerpt text NOT NULL,
  search_text text NOT NULL,
  author_role text NOT NULL CHECK (author_role IN ('user', 'approved_ai', 'unknown')),
  content_hash text NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(search_text, ''))
  ) STORED
);

CREATE INDEX IF NOT EXISTS memories_embedding_idx
  ON memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS memories_search_idx
  ON memories USING gin (search_vector);
CREATE INDEX IF NOT EXISTS memories_trigram_idx
  ON memories USING gin ((title || ' ' || excerpt) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS memories_source_uri_idx ON memories (source_uri);
CREATE INDEX IF NOT EXISTS memories_recorded_at_idx ON memories (recorded_at DESC);
