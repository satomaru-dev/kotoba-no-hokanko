CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS memory_feedback (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query_memo_id uuid NOT NULL REFERENCES captured_memos(id) ON DELETE CASCADE,
  candidate_memory_id text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('relevant', 'irrelevant')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, query_memo_id, candidate_memory_id)
);

CREATE TABLE IF NOT EXISTS idea_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  root_memory_id text NOT NULL,
  root_source_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (owner_id, root_memory_id)
);

CREATE TABLE IF NOT EXISTS idea_thread_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES idea_threads(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_kind text NOT NULL CHECK (entry_kind IN ('memo_link', 'reflection')),
  memo_id uuid REFERENCES captured_memos(id) ON DELETE CASCADE,
  body_ciphertext text,
  title_ciphertext text,
  embedding vector(1536),
  blind_tokens text[] NOT NULL DEFAULT '{}',
  written_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (
    (entry_kind = 'memo_link' AND memo_id IS NOT NULL AND body_ciphertext IS NULL)
    OR
    (entry_kind = 'reflection' AND memo_id IS NULL AND body_ciphertext IS NOT NULL
      AND title_ciphertext IS NOT NULL AND embedding IS NOT NULL)
  ),
  UNIQUE (thread_id, memo_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint_hash text NOT NULL,
  subscription_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, endpoint_hash)
);

CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memo_id uuid NOT NULL REFERENCES captured_memos(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  next_attempt_at timestamptz,
  delivery_count integer NOT NULL DEFAULT 0 CHECK (delivery_count BETWEEN 0 AND 2),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'delivered', 'opened', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_delivered_at timestamptz,
  opened_at timestamptz,
  cancelled_at timestamptz
);

CREATE INDEX IF NOT EXISTS memory_feedback_owner_query_idx
  ON memory_feedback (owner_id, query_memo_id);
CREATE INDEX IF NOT EXISTS idea_threads_owner_created_idx
  ON idea_threads (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idea_thread_entries_thread_date_idx
  ON idea_thread_entries (thread_id, written_at);
CREATE INDEX IF NOT EXISTS idea_thread_entries_embedding_idx
  ON idea_thread_entries USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idea_thread_entries_tokens_idx
  ON idea_thread_entries USING gin (blind_tokens);
CREATE INDEX IF NOT EXISTS push_subscriptions_owner_idx
  ON push_subscriptions (owner_id);
CREATE INDEX IF NOT EXISTS reminders_due_idx
  ON reminders (next_attempt_at)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS reminders_owner_memo_idx
  ON reminders (owner_id, memo_id, created_at DESC);

ALTER TABLE memory_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_thread_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads memory feedback" ON memory_feedback
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY "owner reads idea threads" ON idea_threads
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY "owner reads idea thread entries" ON idea_thread_entries
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY "owner reads push subscriptions" ON push_subscriptions
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY "owner reads reminders" ON reminders
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id);

REVOKE ALL ON TABLE
  memory_feedback,
  idea_threads,
  idea_thread_entries,
  push_subscriptions,
  reminders
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  memory_feedback,
  idea_threads,
  idea_thread_entries,
  push_subscriptions,
  reminders
TO service_role;

GRANT USAGE, SELECT ON SEQUENCE memory_feedback_id_seq TO service_role;

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

    UNION ALL

    SELECT
      'thread:' || e.thread_id::text AS memory_id,
      'idea_thread'::text AS source_type,
      ''::text AS source_uri_ciphertext,
      e.title_ciphertext,
      e.body_ciphertext AS excerpt_ciphertext,
      e.written_at AS recorded_at,
      1 - (e.embedding <=> p_embedding) AS semantic_score,
      CASE WHEN cardinality(p_tokens) = 0 THEN 0::double precision ELSE
        cardinality(ARRAY(SELECT unnest(e.blind_tokens) INTERSECT SELECT unnest(p_tokens)))::double precision
        / cardinality(p_tokens)
      END AS lexical_score
    FROM idea_thread_entries e
    WHERE e.owner_id = p_owner_id
      AND e.entry_kind = 'reflection'
      AND e.deleted_at IS NULL
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
    c.semantic_score * 0.62 + c.lexical_score * 0.38 AS combined_score
  FROM candidates c
  WHERE c.semantic_score >= 0.12 OR c.lexical_score >= 0.08
  ORDER BY combined_score DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 32);
$$;

REVOKE ALL ON FUNCTION match_user_memories(uuid, vector, text[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_user_memories(uuid, vector, text[], integer)
  TO service_role;
