import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-memory-service-token",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const secretBytes = (): Uint8Array => {
  const value = Deno.env.get("MEMORY_ENCRYPTION_KEY");
  if (!value) throw new Error("MEMORY_ENCRYPTION_KEY is missing");
  const bytes = base64ToBytes(value);
  if (bytes.length !== 32) throw new Error("MEMORY_ENCRYPTION_KEY must be 32 bytes");
  return bytes;
};

const encryptionKey = () =>
  crypto.subtle.importKey("raw", secretBytes(), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
const hmacKey = () =>
  crypto.subtle.importKey("raw", secretBytes(), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

const encrypt = async (plain: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(plain)
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
};

const decrypt = async (value: string): Promise<string> => {
  if (!value) return "";
  const [ivPart, cipherPart] = value.split(".");
  if (!ivPart || !cipherPart) throw new Error("invalid ciphertext");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivPart) },
    await encryptionKey(),
    base64ToBytes(cipherPart)
  );
  return new TextDecoder().decode(plain);
};

const tokenize = (text: string): string[] => {
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9]{2,}/gu)) tokens.add(match[0]);
  for (const match of normalized.matchAll(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu
  )) {
    const value = match[0];
    for (const size of [2, 3, 4]) {
      for (let index = 0; index <= value.length - size; index += 1) {
        tokens.add(value.slice(index, index + size));
      }
    }
  }
  return [...tokens].slice(0, 512);
};

const indexText = async (text: string): Promise<{ tokens: string[]; embedding: number[] }> => {
  const key = await hmacKey();
  const vector = Array.from({ length: 1536 }, () => 0);
  const blind: string[] = [];
  for (const token of tokenize(text)) {
    const digest = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token))
    );
    blind.push(bytesToBase64(digest));
    const index = ((digest[0] ?? 0) * 256 + (digest[1] ?? 0)) % vector.length;
    vector[index] = (vector[index] ?? 0) + ((digest[2] ?? 0) % 2 === 0 ? 1 : -1);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return {
    tokens: blind,
    embedding: magnitude === 0 ? vector : vector.map((value) => value / magnitude)
  };
};

const titleFromText = (text: string): string => {
  const first = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "無題のことば";
  return first.length <= 42 ? first : `${first.slice(0, 41)}…`;
};

const inferRelation = (semantic: number, lexical: number, excerpt: string): string => {
  if (/続かな|やめた|諦め|放置|使わなく|無理だった|残らなかった/.test(excerpt)) {
    return "試したが残らなかった";
  }
  if (/以前は|当時は|今は|変わった|考え直|もう違う/.test(excerpt)) return "以前と変化";
  if (lexical >= 0.35 || semantic >= 0.72) return "同じ悩み・発想";
  return "組み合わせ可能";
};

type AdminClient = ReturnType<typeof createClient>;

const authenticate = async (request: Request, admin: AdminClient): Promise<string | null> => {
  const serviceToken = request.headers.get("x-memory-service-token");
  if (serviceToken && serviceToken === Deno.env.get("MEMORY_SERVICE_TOKEN")) {
    return Deno.env.get("MEMORY_OWNER_ID") ?? null;
  }
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const allowed = (Deno.env.get("MEMORY_ALLOWED_EMAILS") ?? "")
    .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(data.user.email?.toLowerCase() ?? "")) return null;
  return data.user.id;
};

const recall = async (admin: AdminClient, ownerId: string, query: string, excludeId?: string) => {
  const indexed = await indexText(query);
  const { data, error } = await admin.rpc("match_user_memories", {
    p_owner_id: ownerId,
    p_embedding: indexed.embedding,
    p_tokens: indexed.tokens,
    p_limit: 16
  });
  if (error) throw error;
  const results = [];
  for (const row of data ?? []) {
    if (row.memory_id === excludeId || Number(row.combined_score) < 0.24) continue;
    const excerpt = await decrypt(row.excerpt_ciphertext);
    const sourceUri = row.source_type === "mobile_app"
      ? `memory://memo/${row.memory_id}`
      : await decrypt(row.source_uri_ciphertext);
    results.push({
      memory_id: row.memory_id,
      date: row.recorded_at,
      excerpt: excerpt.length <= 500 ? excerpt : `${excerpt.slice(0, 499)}…`,
      source_uri: sourceUri,
      source_type: row.source_type,
      title: await decrypt(row.title_ciphertext),
      relation: inferRelation(Number(row.semantic_score), Number(row.lexical_score), excerpt),
      confidence: Number(Number(row.combined_score).toFixed(3))
    });
    if (results.length === 3) break;
  }
  return results;
};

const revisionMap = async (admin: AdminClient, ownerId: string, ids: string[]) => {
  if (ids.length === 0) return new Map<string, unknown[]>();
  const { data, error } = await admin
    .from("memo_revisions")
    .select("memo_id,text_ciphertext,title_ciphertext,revised_at")
    .eq("owner_id", ownerId)
    .in("memo_id", ids)
    .order("revised_at", { ascending: true });
  if (error) throw error;
  const map = new Map<string, unknown[]>();
  for (const row of data ?? []) {
    const list = map.get(row.memo_id) ?? [];
    list.push({
      text: await decrypt(row.text_ciphertext),
      title: await decrypt(row.title_ciphertext),
      revised_at: row.revised_at
    });
    map.set(row.memo_id, list);
  }
  return map;
};

const decryptMemos = async (admin: AdminClient, ownerId: string, rows: Record<string, string>[]) => {
  const revisions = await revisionMap(admin, ownerId, rows.map((row) => row.id));
  return Promise.all(rows.map(async (row) => ({
    id: row.id,
    original_text: await decrypt(row.original_ciphertext),
    current_text: await decrypt(row.current_ciphertext),
    title: await decrypt(row.title_ciphertext),
    captured_at: row.captured_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    revisions: revisions.get(row.id) ?? []
  })));
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const ownerId = await authenticate(request, admin);
    if (!ownerId) return json({ error: "unauthorized" }, 401);

    await admin.from("captured_memos")
      .delete().eq("owner_id", ownerId)
      .lt("deleted_at", new Date(Date.now() - 30 * 86400_000).toISOString());

    const pathname = new URL(request.url).pathname;
    const route = pathname.replace(/^.*\/memory-api/, "") || "/";

    if (route === "/capture" && request.method === "POST") {
      const body = await request.json();
      const id = String(body.client_id ?? "");
      const text = String(body.text ?? "").trim();
      const capturedAt = body.captured_at ? new Date(body.captured_at).toISOString() : new Date().toISOString();
      if (!/^[0-9a-f-]{36}$/i.test(id) || !text || text.length > 20_000) {
        return json({ error: "invalid_request" }, 400);
      }
      const { data: existing } = await admin.from("captured_memos").select("*")
        .eq("id", id).eq("owner_id", ownerId).maybeSingle();
      if (existing) {
        const [memo] = await decryptMemos(admin, ownerId, [existing]);
        return json({ memo, related: [] });
      }
      const related = await recall(admin, ownerId, text, id);
      const title = titleFromText(text);
      const indexed = await indexText(`${title}\n${text}`);
      const cipher = await encrypt(text);
      const row = {
        id,
        owner_id: ownerId,
        original_ciphertext: cipher,
        current_ciphertext: cipher,
        title_ciphertext: await encrypt(title),
        embedding: indexed.embedding,
        blind_tokens: indexed.tokens,
        captured_at: capturedAt,
        updated_at: capturedAt
      };
      const { data, error } = await admin.from("captured_memos").insert(row).select("*").single();
      if (error) throw error;
      const [memo] = await decryptMemos(admin, ownerId, [data]);
      return json({ memo, related }, 201);
    }

    if (route === "/search" && request.method === "POST") {
      const body = await request.json();
      const query = String(body.query ?? "").trim();
      if (query.length < 2 || query.length > 20_000) return json({ error: "invalid_request" }, 400);
      return json({ query, results: await recall(admin, ownerId, query) });
    }

    if (route === "/memos" && request.method === "GET") {
      const deleted = new URL(request.url).searchParams.get("deleted") === "true";
      let query = admin.from("captured_memos").select("*").eq("owner_id", ownerId);
      query = deleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
      const { data, error } = await query.order("captured_at", { ascending: false }).limit(50);
      if (error) throw error;
      return json({ memos: await decryptMemos(admin, ownerId, data ?? []), next_cursor: null });
    }

    const memoMatch = route.match(/^\/memos\/([0-9a-f-]{36})(\/restore)?$/i);
    if (memoMatch) {
      const id = memoMatch[1]!;
      const { data: current, error: currentError } = await admin.from("captured_memos")
        .select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle();
      if (currentError) throw currentError;
      if (!current) return json({ error: "not_found" }, 404);

      if (memoMatch[2] && request.method === "POST") {
        const { data, error } = await admin.from("captured_memos")
          .update({ deleted_at: null, updated_at: new Date().toISOString() })
          .eq("id", id).eq("owner_id", ownerId).select("*").single();
        if (error) throw error;
        const [memo] = await decryptMemos(admin, ownerId, [data]);
        return json({ memo });
      }
      if (request.method === "DELETE") {
        const { error } = await admin.from("captured_memos")
          .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", id).eq("owner_id", ownerId);
        if (error) throw error;
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      if (request.method === "PATCH") {
        const body = await request.json();
        const text = String(body.text ?? "").trim();
        const title = String(body.title ?? "").trim() || titleFromText(text);
        if (!text || text.length > 20_000 || title.length > 200) return json({ error: "invalid_request" }, 400);
        const { error: revisionError } = await admin.from("memo_revisions").insert({
          memo_id: id,
          owner_id: ownerId,
          text_ciphertext: current.current_ciphertext,
          title_ciphertext: current.title_ciphertext
        });
        if (revisionError) throw revisionError;
        const indexed = await indexText(`${title}\n${text}`);
        const { data, error } = await admin.from("captured_memos").update({
          current_ciphertext: await encrypt(text),
          title_ciphertext: await encrypt(title),
          embedding: indexed.embedding,
          blind_tokens: indexed.tokens,
          updated_at: new Date().toISOString()
        }).eq("id", id).eq("owner_id", ownerId).select("*").single();
        if (error) throw error;
        const [memo] = await decryptMemos(admin, ownerId, [data]);
        return json({ memo });
      }
    }

    if (route === "/import" && request.method === "POST") {
      if (request.headers.get("x-memory-service-token") !== Deno.env.get("MEMORY_SERVICE_TOKEN")) {
        return json({ error: "unauthorized" }, 401);
      }
      const body = await request.json();
      const records = Array.isArray(body.records) ? body.records.slice(0, 50) : [];
      const rows = [];
      for (const record of records) {
        const title = String(record.title ?? "");
        const excerpt = String(record.excerpt ?? "");
        const sourceUri = String(record.source_uri ?? "");
        if (!record.memory_id || !title || !excerpt || !sourceUri) continue;
        const indexed = await indexText(`${title}\n${excerpt}`);
        rows.push({
          memory_id: String(record.memory_id),
          owner_id: ownerId,
          source_type: String(record.source_type ?? "connector_snapshot"),
          source_uri_ciphertext: await encrypt(sourceUri),
          title_ciphertext: await encrypt(title),
          excerpt_ciphertext: await encrypt(excerpt),
          embedding: indexed.embedding,
          blind_tokens: indexed.tokens,
          recorded_at: record.recorded_at || null,
          modified_at: record.modified_at || new Date().toISOString()
        });
      }
      if (rows.length > 0) {
        const { error } = await admin.from("memory_index").upsert(rows, { onConflict: "memory_id" });
        if (error) throw error;
      }
      return json({ imported: rows.length });
    }

    return json({ error: "not_found" }, 404);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "memory api failure");
    return json({ error: "internal_error" }, 500);
  }
});
