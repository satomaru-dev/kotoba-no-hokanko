import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-memory-service-token",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const additionalAllowedEmails = [
  "sato@aflac-sp.jp"
];

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

const digestText = async (value: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(value))
  );
  return bytesToBase64(digest);
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
  if (lexical >= 0.3 || semantic >= 0.68) return "同じ悩み・発想";
  return "組み合わせ可能";
};

const sensitiveImport = (sourceUri: string, text: string): boolean =>
  /(?:^|[\\/])\.env(?:$|[\\/])|password|passwd|credential|secret|token|パスワード|認証情報|顧客|契約|被保険者|金融明細|口座|クレジット/i
    .test(sourceUri)
  || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}\b|\bAIza[0-9A-Za-z_-]{25,}\b/i
    .test(text);

type AdminClient = ReturnType<typeof createClient>;
type CandidateRow = {
  memory_id: string;
  source_type: string;
  source_uri_ciphertext: string;
  title_ciphertext: string;
  excerpt_ciphertext: string;
  recorded_at: string | null;
  semantic_score: number;
  lexical_score: number;
  combined_score: number;
};

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
  const configuredAllowed = (Deno.env.get("MEMORY_ALLOWED_EMAILS") ?? "")
    .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  const allowed = new Set([...configuredAllowed, ...additionalAllowedEmails]);
  if (configuredAllowed.length > 0 && !allowed.has(data.user.email?.toLowerCase() ?? "")) return null;
  return data.user.id;
};

const threadMetadata = async (
  admin: AdminClient,
  ownerId: string,
  rows: Array<{ memory_id: string; source_type: string }>
) => {
  const { data: threads, error: threadError } = await admin.from("idea_threads")
    .select("id,root_memory_id").eq("owner_id", ownerId).is("deleted_at", null);
  if (threadError) throw threadError;
  const threadIds = (threads ?? []).map((thread) => thread.id);
  const { data: entries, error: entryError } = threadIds.length === 0
    ? { data: [], error: null }
    : await admin.from("idea_thread_entries")
      .select("thread_id,memo_id").eq("owner_id", ownerId)
      .in("thread_id", threadIds).is("deleted_at", null);
  if (entryError) throw entryError;

  const counts = new Map<string, number>();
  const byRoot = new Map<string, string>();
  const byMemo = new Map<string, string>();
  for (const thread of threads ?? []) byRoot.set(thread.root_memory_id, thread.id);
  for (const entry of entries ?? []) {
    counts.set(entry.thread_id, (counts.get(entry.thread_id) ?? 0) + 1);
    if (entry.memo_id) byMemo.set(entry.memo_id, entry.thread_id);
  }
  return rows.map((row) => {
    const direct = row.memory_id.startsWith("thread:") ? row.memory_id.slice(7) : null;
    const threadId = direct ?? byRoot.get(row.memory_id) ?? byMemo.get(row.memory_id) ?? null;
    return {
      thread_id: threadId,
      dialogue_count: threadId ? counts.get(threadId) ?? 0 : 0,
      has_dialogue: Boolean(threadId)
    };
  });
};

const recall = async (
  admin: AdminClient,
  ownerId: string,
  query: string,
  excludeId?: string,
  requestedMax = 10,
  minimumScore = 0.1
) => {
  const maxResults = Math.min(10, Math.max(1, Math.trunc(requestedMax)));
  const indexed = await indexText(query);
  const { data, error } = await admin.rpc("match_user_memories", {
    p_owner_id: ownerId,
    p_embedding: indexed.embedding,
    p_tokens: indexed.tokens,
    p_limit: 24
  });
  if (error) throw error;

  const rejected = new Set<string>();
  if (excludeId) {
    const { data: feedback, error: feedbackError } = await admin.from("memory_feedback")
      .select("candidate_memory_id").eq("owner_id", ownerId)
      .eq("query_memo_id", excludeId).eq("verdict", "irrelevant");
    if (feedbackError) throw feedbackError;
    for (const item of feedback ?? []) rejected.add(item.candidate_memory_id);
  }

  const decrypted = await Promise.all(((data ?? []) as CandidateRow[]).map(async (row) => ({
    row,
    title: await decrypt(row.title_ciphertext),
    excerpt: await decrypt(row.excerpt_ciphertext)
  })));
  const queryTokens = tokenize(query);
  const querySet = new Set(queryTokens);
  const documentFrequency = new Map<string, number>();
  for (const item of decrypted) {
    const present = new Set(tokenize(`${item.title}\n${item.excerpt}`));
    for (const token of querySet) {
      if (present.has(token)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const totalWeight = queryTokens.reduce((sum, token) =>
    sum + Math.log((decrypted.length + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1, 0
  ) || 1;

  const ranked = decrypted.map((item) => {
    const allTokens = new Set(tokenize(`${item.title}\n${item.excerpt}`));
    const titleTokens = new Set(tokenize(item.title));
    const rareCoverage = queryTokens.reduce((sum, token) => {
      if (!allTokens.has(token)) return sum;
      return sum + Math.log((decrypted.length + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1;
    }, 0) / totalWeight;
    const titleCoverage = queryTokens.length === 0 ? 0
      : queryTokens.filter((token) => titleTokens.has(token)).length / queryTokens.length;
    const linkPenalty = (item.excerpt.match(/\[\[/g)?.length ?? 0) >= 3 ? 0.1 : 0;
    const score = Math.max(0, Math.min(1,
      Number(item.row.semantic_score) * 0.4
      + Number(item.row.lexical_score) * 0.2
      + rareCoverage * 0.28
      + titleCoverage * 0.12
      - linkPenalty
    ));
    return { ...item, score };
  }).sort((left, right) => right.score - left.score);

  const seen = new Set<string>();
  const picked = ranked.filter(({ row, excerpt, score }) => {
    if (row.memory_id === excludeId || rejected.has(row.memory_id) || score < minimumScore) return false;
    const key = `${row.source_type}:${excerpt.normalize("NFKC").slice(0, 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, maxResults);
  const metadata = await threadMetadata(admin, ownerId, picked.map(({ row }) => row));

  return picked.map(({ row, title, excerpt, score }, index) => {
    const sourceUri = row.source_type === "mobile_app"
      ? `memory://memo/${row.memory_id}`
      : row.source_type === "idea_thread"
      ? `memory://thread/${row.memory_id.slice(7)}`
      : null;
    return {
      memory_id: row.memory_id,
      date: row.recorded_at,
      excerpt: excerpt.length <= 500 ? excerpt : `${excerpt.slice(0, 499)}…`,
      source_uri: sourceUri ?? "",
      source_type: row.source_type,
      title,
      relation: inferRelation(Number(row.semantic_score), Number(row.lexical_score), excerpt),
      confidence: Number(score.toFixed(3)),
      ...metadata[index]
    };
  }).map(async (result, index) => {
    if (result.source_uri) return result;
    return {
      ...result,
      source_uri: await decrypt(picked[index]!.row.source_uri_ciphertext)
    };
  }).reduce(async (promise, item) => [...await promise, await item], Promise.resolve([] as unknown[]));
};

const revisionMap = async (admin: AdminClient, ownerId: string, ids: string[]) => {
  if (ids.length === 0) return new Map<string, unknown[]>();
  const { data, error } = await admin.from("memo_revisions")
    .select("memo_id,text_ciphertext,title_ciphertext,revised_at")
    .eq("owner_id", ownerId).in("memo_id", ids).order("revised_at", { ascending: true });
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

const loadDoLaterItems = async (
  admin: AdminClient,
  ownerId: string,
  view: "active" | "resolved"
) => {
  let query = admin.from("memo_later_items").select("*").eq("owner_id", ownerId);
  query = view === "active"
    ? query.eq("status", "active").order("activated_at", { ascending: false })
    : query.in("status", ["done", "abandoned"]).order("resolved_at", { ascending: false });
  const { data: items, error } = await query.limit(100);
  if (error) throw error;
  const memoIds = (items ?? []).map((item) => item.memo_id);
  const { data: memoRows, error: memoError } = memoIds.length === 0
    ? { data: [], error: null }
    : await admin.from("captured_memos").select("*")
      .eq("owner_id", ownerId).in("id", memoIds).is("deleted_at", null);
  if (memoError) throw memoError;
  const memos = new Map((await decryptMemos(admin, ownerId, memoRows ?? []))
    .map((memo) => [memo.id, memo]));
  return (items ?? []).flatMap((item) => {
    const memo = memos.get(item.memo_id);
    return memo ? [{ ...item, memo }] : [];
  });
};

const loadDoLaterItem = async (admin: AdminClient, ownerId: string, memoId: string) => {
  const active = (await loadDoLaterItems(admin, ownerId, "active"))
    .find((item) => item.memo_id === memoId);
  if (active) return active;
  return (await loadDoLaterItems(admin, ownerId, "resolved"))
    .find((item) => item.memo_id === memoId) ?? null;
};

const loadMemoryReference = async (admin: AdminClient, ownerId: string, memoryId: string) => {
  if (/^[0-9a-f-]{36}$/i.test(memoryId)) {
    const { data } = await admin.from("captured_memos").select("*")
      .eq("id", memoryId).eq("owner_id", ownerId).maybeSingle();
    if (data) {
      return {
        memory_id: data.id,
        source_type: "mobile_app",
        date: data.captured_at,
        title: await decrypt(data.title_ciphertext),
        text: await decrypt(data.current_ciphertext),
        source_uri: `memory://memo/${data.id}`
      };
    }
  }
  const { data } = await admin.from("memory_index").select("*")
    .eq("memory_id", memoryId).eq("owner_id", ownerId).maybeSingle();
  if (!data) return null;
  return {
    memory_id: data.memory_id,
    source_type: data.source_type,
    date: data.recorded_at,
    title: await decrypt(data.title_ciphertext),
    text: await decrypt(data.excerpt_ciphertext),
    source_uri: await decrypt(data.source_uri_ciphertext)
  };
};

const getThread = async (admin: AdminClient, ownerId: string, threadId: string) => {
  const { data: thread, error } = await admin.from("idea_threads").select("*")
    .eq("id", threadId).eq("owner_id", ownerId).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!thread) return null;
  const root = await loadMemoryReference(admin, ownerId, thread.root_memory_id);
  if (!root) return null;
  const { data: rows, error: entryError } = await admin.from("idea_thread_entries")
    .select("*").eq("thread_id", threadId).eq("owner_id", ownerId)
    .is("deleted_at", null).order("written_at", { ascending: true });
  if (entryError) throw entryError;
  const memoIds = (rows ?? []).filter((row) => row.memo_id).map((row) => row.memo_id);
  const { data: memos, error: memoError } = memoIds.length === 0
    ? { data: [], error: null }
    : await admin.from("captured_memos").select("*").eq("owner_id", ownerId).in("id", memoIds);
  if (memoError) throw memoError;
  const memoMap = new Map((await decryptMemos(admin, ownerId, memos ?? []))
    .map((memo) => [memo.id, memo]));
  const entries = await Promise.all((rows ?? []).map(async (row) => {
    if (row.entry_kind === "memo_link") {
      const memo = memoMap.get(row.memo_id);
      if (!memo) return null;
      return {
        id: row.id,
        kind: "memo_link",
        memo_id: memo.id,
        title: memo.title,
        text: memo.current_text,
        written_at: row.written_at
      };
    }
    return {
      id: row.id,
      kind: "reflection",
      memo_id: null,
      title: await decrypt(row.title_ciphertext),
      text: await decrypt(row.body_ciphertext),
      written_at: row.written_at
    };
  }));
  return { id: thread.id, root, entries: entries.filter(Boolean) };
};

const nextMorningJst = (after: Date): Date => {
  const shifted = new Date(after.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
    -1,
    0,
    0
  ));
};

const dispatchReminders = async (admin: AdminClient, ownerId: string) => {
  const now = new Date();
  const { data: reminders, error } = await admin.from("reminders").select("*")
    .eq("owner_id", ownerId).eq("status", "scheduled")
    .lte("next_attempt_at", now.toISOString()).order("next_attempt_at").limit(25);
  if (error) throw error;
  const { data: subscriptions, error: subscriptionError } = await admin.from("push_subscriptions")
    .select("*").eq("owner_id", ownerId);
  if (subscriptionError) throw subscriptionError;
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) throw new Error("VAPID keys are missing");
  webpush.setVapidDetails("mailto:memory@example.invalid", publicKey, privateKey);

  let delivered = 0;
  for (const reminder of reminders ?? []) {
    const { data: memo } = await admin.from("captured_memos").select("*")
      .eq("id", reminder.memo_id).eq("owner_id", ownerId).maybeSingle();
    if (!memo) continue;
    const text = (await decrypt(memo.current_ciphertext)).replace(/\s+/g, " ").trim();
    const payload = JSON.stringify({
      title: "もう一度考えたかった言葉があります",
      body: text.slice(0, 60),
      memo_id: memo.id,
      reminder_id: reminder.id,
      url: `${Deno.env.get("APP_PUBLIC_URL") ?? "https://satomaru-dev.github.io/kotoba-no-hokanko/"}?memo=${memo.id}&reminder=${reminder.id}`
    });
    let sent = false;
    for (const row of subscriptions ?? []) {
      try {
        await webpush.sendNotification(JSON.parse(await decrypt(row.subscription_ciphertext)), payload, {
          TTL: 86400,
          urgency: "normal"
        });
        sent = true;
      } catch (pushError) {
        const status = Number((pushError as { statusCode?: number }).statusCode ?? 0);
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete()
            .eq("id", row.id).eq("owner_id", ownerId);
        }
      }
    }
    const nextCount = Number(reminder.delivery_count) + (sent ? 1 : 0);
    const updates = sent
      ? nextCount >= 2
        ? {
          delivery_count: nextCount,
          status: "delivered",
          last_delivered_at: now.toISOString(),
          next_attempt_at: null
        }
        : {
          delivery_count: nextCount,
          last_delivered_at: now.toISOString(),
          next_attempt_at: nextMorningJst(now).toISOString()
        }
      : { next_attempt_at: nextMorningJst(now).toISOString() };
    const { error: updateError } = await admin.from("reminders").update(updates)
      .eq("id", reminder.id).eq("owner_id", ownerId);
    if (updateError) throw updateError;
    if (sent) delivered += 1;
  }
  return { processed: reminders?.length ?? 0, delivered };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const ownerId = await authenticate(request, admin);
    if (!ownerId) return json({ error: "unauthorized" }, 401);

    await admin.from("captured_memos").delete().eq("owner_id", ownerId)
      .lt("deleted_at", new Date(Date.now() - 30 * 86400_000).toISOString());

    const route = new URL(request.url).pathname.replace(/^.*\/memory-api/, "") || "/";

    if (route === "/capture" && request.method === "POST") {
      const body = await request.json();
      const id = String(body.client_id ?? "");
      const text = String(body.text ?? "").trim();
      const capturedAt = body.captured_at
        ? new Date(body.captured_at).toISOString()
        : new Date().toISOString();
      if (!/^[0-9a-f-]{36}$/i.test(id) || !text || text.length > 20_000) {
        return json({ error: "invalid_request" }, 400);
      }
      const { data: existing } = await admin.from("captured_memos").select("*")
        .eq("id", id).eq("owner_id", ownerId).maybeSingle();
      if (existing) {
        const [memo] = await decryptMemos(admin, ownerId, [existing]);
        return json({ memo, related: [] });
      }
      const related = await recall(admin, ownerId, text, id, 10, 0.1);
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
      const requestedMax = Math.min(10, Math.max(1, Math.trunc(Number(body.max_results) || 10)));
      const minimumScore = requestedMax <= 3 ? 0.24 : 0.1;
      return json({
        query,
        results: await recall(admin, ownerId, query, undefined, requestedMax, minimumScore)
      });
    }

    if (route === "/feedback" && request.method === "POST") {
      const body = await request.json();
      const queryMemoId = String(body.query_memo_id ?? "");
      const candidateMemoryId = String(body.candidate_memory_id ?? "");
      const verdict = String(body.verdict ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(queryMemoId)
        || !candidateMemoryId
        || !["relevant", "irrelevant"].includes(verdict)) {
        return json({ error: "invalid_request" }, 400);
      }
      const { data: memo } = await admin.from("captured_memos").select("id")
        .eq("id", queryMemoId).eq("owner_id", ownerId).maybeSingle();
      if (!memo) return json({ error: "not_found" }, 404);
      const { error } = await admin.from("memory_feedback").upsert({
        owner_id: ownerId,
        query_memo_id: queryMemoId,
        candidate_memory_id: candidateMemoryId,
        verdict
      }, { onConflict: "owner_id,query_memo_id,candidate_memory_id" });
      if (error) throw error;
      return json({ saved: true });
    }

    if (route === "/idea-threads" && request.method === "POST") {
      const body = await request.json();
      const rootMemoryId = String(body.root_memory_id ?? "");
      const currentMemoId = body.current_memo_id ? String(body.current_memo_id) : null;
      if (!rootMemoryId) return json({ error: "invalid_request" }, 400);
      if (rootMemoryId.startsWith("thread:")) {
        const threadId = rootMemoryId.slice(7);
        const thread = await getThread(admin, ownerId, threadId);
        if (!thread) return json({ error: "not_found" }, 404);
        if (currentMemoId) {
          const { data: memo } = await admin.from("captured_memos").select("id,captured_at")
            .eq("id", currentMemoId).eq("owner_id", ownerId).maybeSingle();
          if (!memo) return json({ error: "not_found" }, 404);
          await admin.from("idea_thread_entries").upsert({
            thread_id: threadId,
            owner_id: ownerId,
            entry_kind: "memo_link",
            memo_id: currentMemoId,
            written_at: memo.captured_at
          }, { onConflict: "thread_id,memo_id", ignoreDuplicates: true });
        }
        return json({ thread: await getThread(admin, ownerId, threadId) });
      }
      const root = await loadMemoryReference(admin, ownerId, rootMemoryId);
      if (!root) return json({ error: "not_found" }, 404);
      const { data: existing } = await admin.from("idea_threads").select("*")
        .eq("owner_id", ownerId).eq("root_memory_id", rootMemoryId)
        .is("deleted_at", null).maybeSingle();
      let thread = existing;
      if (!thread) {
        const { data, error } = await admin.from("idea_threads").insert({
          owner_id: ownerId,
          root_memory_id: rootMemoryId,
          root_source_type: root.source_type
        }).select("*").single();
        if (error) throw error;
        thread = data;
      }
      if (currentMemoId) {
        const { data: memo } = await admin.from("captured_memos").select("id,captured_at")
          .eq("id", currentMemoId).eq("owner_id", ownerId).maybeSingle();
        if (!memo) return json({ error: "not_found" }, 404);
        const { error } = await admin.from("idea_thread_entries").upsert({
          thread_id: thread.id,
          owner_id: ownerId,
          entry_kind: "memo_link",
          memo_id: currentMemoId,
          written_at: memo.captured_at
        }, { onConflict: "thread_id,memo_id", ignoreDuplicates: true });
        if (error) throw error;
      }
      return json({ thread: await getThread(admin, ownerId, thread.id) }, 201);
    }

    const threadMatch = route.match(/^\/idea-threads\/([0-9a-f-]{36})(\/entries)?$/i);
    if (threadMatch) {
      const threadId = threadMatch[1]!;
      if (!threadMatch[2] && request.method === "GET") {
        const thread = await getThread(admin, ownerId, threadId);
        return thread ? json({ thread }) : json({ error: "not_found" }, 404);
      }
      if (threadMatch[2] && request.method === "POST") {
        const thread = await getThread(admin, ownerId, threadId);
        if (!thread) return json({ error: "not_found" }, 404);
        const body = await request.json();
        const text = String(body.text ?? "").trim();
        if (!text || text.length > 20_000) return json({ error: "invalid_request" }, 400);
        const title = titleFromText(text);
        const indexed = await indexText(`${title}\n${text}`);
        const { error } = await admin.from("idea_thread_entries").insert({
          thread_id: threadId,
          owner_id: ownerId,
          entry_kind: "reflection",
          body_ciphertext: await encrypt(text),
          title_ciphertext: await encrypt(title),
          embedding: indexed.embedding,
          blind_tokens: indexed.tokens,
          written_at: new Date().toISOString()
        });
        if (error) throw error;
        return json({ thread: await getThread(admin, ownerId, threadId) }, 201);
      }
    }

    if (route === "/push/public-key" && request.method === "GET") {
      const key = Deno.env.get("VAPID_PUBLIC_KEY");
      return key ? json({ public_key: key }) : json({ error: "push_unavailable" }, 503);
    }

    if (route === "/push/subscriptions" && request.method === "POST") {
      const body = await request.json();
      const subscription = body.subscription;
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return json({ error: "invalid_request" }, 400);
      }
      const endpointHash = await digestText(String(subscription.endpoint));
      const { error } = await admin.from("push_subscriptions").upsert({
        owner_id: ownerId,
        endpoint_hash: endpointHash,
        subscription_ciphertext: await encrypt(JSON.stringify(subscription)),
        updated_at: new Date().toISOString()
      }, { onConflict: "owner_id,endpoint_hash" });
      if (error) throw error;
      return json({ subscribed: true });
    }

    if (route === "/internal/reminders/dispatch" && request.method === "POST") {
      if (request.headers.get("x-memory-service-token") !== Deno.env.get("MEMORY_SERVICE_TOKEN")) {
        return json({ error: "unauthorized" }, 401);
      }
      return json(await dispatchReminders(admin, ownerId));
    }

    if (route === "/reminders" && request.method === "GET") {
      const { data, error } = await admin.from("reminders").select("*")
        .eq("owner_id", ownerId).in("status", ["scheduled", "delivered"])
        .lte("scheduled_for", new Date().toISOString()).order("scheduled_for");
      if (error) throw error;
      const memoIds = [...new Set((data ?? []).map((item) => item.memo_id))];
      const { data: memoRows } = memoIds.length === 0
        ? { data: [] }
        : await admin.from("captured_memos").select("*")
          .eq("owner_id", ownerId).in("id", memoIds);
      const memos = new Map((await decryptMemos(admin, ownerId, memoRows ?? []))
        .map((memo) => [memo.id, memo]));
      return json({
        reminders: (data ?? []).map((item) => ({
          ...item,
          memo: memos.get(item.memo_id) ?? null
        }))
      });
    }

    const reminderCreateMatch = route.match(/^\/memos\/([0-9a-f-]{36})\/reminders$/i);
    if (reminderCreateMatch && request.method === "POST") {
      const memoId = reminderCreateMatch[1]!;
      const { data: memo } = await admin.from("captured_memos").select("id")
        .eq("id", memoId).eq("owner_id", ownerId).maybeSingle();
      if (!memo) return json({ error: "not_found" }, 404);
      const body = await request.json();
      const id = String(body.client_id ?? "");
      const remindAt = new Date(String(body.remind_at ?? ""));
      const delta = remindAt.getTime() - Date.now();
      if (!/^[0-9a-f-]{36}$/i.test(id)
        || !Number.isFinite(remindAt.getTime())
        || delta < -24 * 60 * 60 * 1000
        || delta > 366 * 24 * 60 * 60 * 1000) {
        return json({ error: "invalid_request" }, 400);
      }
      const effective = delta <= 0 ? new Date() : remindAt;
      const { data, error } = await admin.from("reminders").upsert({
        id,
        owner_id: ownerId,
        memo_id: memoId,
        scheduled_for: effective.toISOString(),
        next_attempt_at: effective.toISOString()
      }, { onConflict: "id" }).select("*").single();
      if (error) throw error;
      return json({ reminder: data }, 201);
    }

    const reminderMatch = route.match(/^\/reminders\/([0-9a-f-]{36})(\/open)?$/i);
    if (reminderMatch) {
      const id = reminderMatch[1]!;
      if (reminderMatch[2] && request.method === "POST") {
        const { error } = await admin.from("reminders").update({
          status: "opened",
          opened_at: new Date().toISOString(),
          next_attempt_at: null
        }).eq("id", id).eq("owner_id", ownerId);
        if (error) throw error;
        return json({ opened: true });
      }
      if (!reminderMatch[2] && request.method === "DELETE") {
        const { error } = await admin.from("reminders").update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          next_attempt_at: null
        }).eq("id", id).eq("owner_id", ownerId);
        if (error) throw error;
        return new Response(null, { status: 204, headers: corsHeaders });
      }
    }

    if (route === "/memos" && request.method === "GET") {
      const deleted = new URL(request.url).searchParams.get("deleted") === "true";
      let query = admin.from("captured_memos").select("*").eq("owner_id", ownerId);
      query = deleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
      const { data, error } = await query.order("captured_at", { ascending: false }).limit(50);
      if (error) throw error;
      return json({ memos: await decryptMemos(admin, ownerId, data ?? []), next_cursor: null });
    }

    if (route === "/do-later" && request.method === "GET") {
      const requestedView = new URL(request.url).searchParams.get("view") ?? "active";
      if (!["active", "resolved"].includes(requestedView)) {
        return json({ error: "invalid_request" }, 400);
      }
      return json({
        items: await loadDoLaterItems(admin, ownerId, requestedView as "active" | "resolved")
      });
    }

    const doLaterMatch = route.match(/^\/memos\/([0-9a-f-]{36})\/do-later$/i);
    if (doLaterMatch) {
      const memoId = doLaterMatch[1]!;
      const { data: memo, error: memoError } = await admin.from("captured_memos").select("id")
        .eq("id", memoId).eq("owner_id", ownerId).is("deleted_at", null).maybeSingle();
      if (memoError) throw memoError;
      if (!memo) return json({ error: "not_found" }, 404);
      const now = new Date().toISOString();
      if (request.method === "POST") {
        const { error } = await admin.from("memo_later_items").upsert({
          memo_id: memoId,
          owner_id: ownerId,
          status: "active",
          activated_at: now,
          updated_at: now,
          resolved_at: null
        }, { onConflict: "memo_id" });
        if (error) throw error;
        return json({ item: await loadDoLaterItem(admin, ownerId, memoId) }, 201);
      }
      if (request.method === "PATCH") {
        const { data: current, error: currentError } = await admin.from("memo_later_items")
          .select("memo_id,activated_at").eq("memo_id", memoId).eq("owner_id", ownerId).maybeSingle();
        if (currentError) throw currentError;
        if (!current) return json({ error: "not_found" }, 404);
        const body = await request.json();
        const action = String(body.action ?? "");
        if (!["done", "later", "abandon"].includes(action)) {
          return json({ error: "invalid_request" }, 400);
        }
        const status = action === "done" ? "done" : action === "abandon" ? "abandoned" : "active";
        const updates = {
          status,
          activated_at: action === "later" ? now : current.activated_at,
          updated_at: now,
          resolved_at: status === "active" ? null : now
        };
        const { error } = await admin.from("memo_later_items").update(updates)
          .eq("memo_id", memoId).eq("owner_id", ownerId);
        if (error) throw error;
        return json({ item: await loadDoLaterItem(admin, ownerId, memoId) });
      }
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
        if (!text || text.length > 20_000 || title.length > 200) {
          return json({ error: "invalid_request" }, 400);
        }
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
        const title = String(record.title ?? "").trim();
        const excerpt = String(record.excerpt ?? "").trim();
        const sourceUri = String(record.source_uri ?? "").trim();
        if (!record.memory_id || !title || !excerpt || !sourceUri
          || title.length > 500 || excerpt.length > 20_000
          || sensitiveImport(sourceUri, `${title}\n${excerpt}`)) continue;
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
        const { error } = await admin.from("memory_index")
          .upsert(rows, { onConflict: "memory_id" });
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
