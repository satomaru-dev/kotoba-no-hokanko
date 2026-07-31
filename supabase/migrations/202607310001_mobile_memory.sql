CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS captured_memos (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_ciphertext text NOT NULL,
  current_ciphertext text NOT NULL,
  title_ciphertext text NOT NULL,
  embedding vector(1536) NOT NULL,
  blind_tokens text[] NOT NULL DEFAULT '{}',
  captured_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS memo_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  memo_id uuid NOT NULL REFERENCES captured_memos(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text_ciphertext text NOT NULL,
  title_ciphertext text NOT NULL,
  revised_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_index (
  memory_id text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_uri_ciphertext text NOT NULL,
  title_ciphertext text NOT NULL,
  excerpt_ciphertext text NOT NULL,
  embedding vector(1536) NOT NULL,
  blind_tokens text[] NOT NULL DEFAULT '{}',
  recorded_at timestamptz,
  modified_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS captured_memos_owner_date_idx
  ON captured_memos (owner_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS memo_revisions_memo_id_idx
  ON memo_revisions (memo_id);
CREATE INDEX IF NOT EXISTS memo_revisions_owner_date_idx
  ON memo_revisions (owner_id, revised_at DESC);
CREATE INDEX IF NOT EXISTS memory_index_owner_date_idx
  ON memory_index (owner_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS captured_memos_embedding_idx
  ON captured_memos USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS captured_memos_tokens_idx
  ON captured_memos USING gin (blind_tokens);
CREATE INDEX IF NOT EXISTS memory_index_embedding_idx
  ON memory_index USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS memory_index_tokens_idx
  ON memory_index USING gin (blind_tokens);

ALTER TABLE captured_memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE memo_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads captured memos" ON captured_memos
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY "owner reads revisions" ON memo_revisions
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY "owner reads memory index" ON memory_index
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id);

CREATE OR REPLACE FUNCTION preserve_original_memo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.original_ciphertext IS DISTINCT FROM OLD.original_ciphertext THEN
    RAISE EXCEPTION 'original memo text is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_original_memo_trigger ON captured_memos;
CREATE TRIGGER preserve_original_memo_trigger
  BEFORE UPDATE ON captured_memos
  FOR EACH ROW EXECUTE FUNCTION preserve_original_memo();

CREATE OR REPLACE FUNCTION match_user_memories(
  p_owner_id uuid,
  p_embedding vector(1536),
  p_tokens text[],
  p_limit integer DEFAULT 12
)
RETURNS TABLE (
  memory_id text,
  source_type text,
  source_uri_ciphertext text,
  title_ciphertext text,
  excerpt_ciphertext text,
  recorded_at timestamptz,
  semantic_score double precision,
  lexical_score double precision,
  combined_score double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH candidates AS (
    SELECT
      m.id::text AS memory_id,
      'mobile_app'::text AS source_type,
      ''::text AS source_uri_ciphertext,
      m.title_ciphertext,
      m.current_ciphertext AS excerpt_ciphertext,
      m.captured_at AS recorded_at,
      1 - (m.embedding <=> p_embedding) AS semantic_score,
      CASE WHEN cardinality(p_tokens) = 0 THEN 0::double precision ELSE
        cardinality(ARRAY(SELECT unnest(m.blind_tokens) INTERSECT SELECT unnest(p_tokens)))::double precision
        / cardinality(p_tokens)
      END AS lexical_score
    FROM captured_memos m
    WHERE m.owner_id = p_owner_id AND m.deleted_at IS NULL
    UNION ALL
    SELECT
      i.memory_id,
      i.source_type,
      i.source_uri_ciphertext,
      i.title_ciphertext,
      i.excerpt_ciphertext,
      i.recorded_at,
      1 - (i.embedding <=> p_embedding) AS semantic_score,
      CASE WHEN cardinality(p_tokens) = 0 THEN 0::double precision ELSE
        cardinality(ARRAY(SELECT unnest(i.blind_tokens) INTERSECT SELECT unnest(p_tokens)))::double precision
        / cardinality(p_tokens)
      END AS lexical_score
    FROM memory_index i
    WHERE i.owner_id = p_owner_id
  )
  SELECT
    c.memory_id,
    c.source_type,
    c.source_uri_ciphertext,
    c.title_ciphertext,
    c.excerpt_ciphertext,
    c.recorded_at,
    c.semantic_score,
    c.lexical_score,
    c.semantic_score * 0.72 + c.lexical_score * 0.28 AS combined_score
  FROM candidates c
  WHERE c.semantic_score >= 0.16 OR c.lexical_score >= 0.12
  ORDER BY combined_score DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 24);
$$;

REVOKE ALL ON FUNCTION match_user_memories(uuid, vector, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION match_user_memories(uuid, vector, text[], integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION match_user_memories(uuid, vector, text[], integer) TO service_role;

REVOKE ALL ON TABLE captured_memos, memo_revisions, memory_index
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE captured_memos, memo_revisions, memory_index
  TO service_role;
GRANT USAGE, SELECT ON SEQUENCE memo_revisions_id_seq TO service_role;
