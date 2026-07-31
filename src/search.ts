import type { EmbeddingProvider } from "./embeddings.js";
import type { MemoryRepository } from "./repository.js";
import type { MemoryRelation, RecallResponse, SearchCandidate } from "./types.js";

const ABANDONED_PATTERN =
  /続かな|やめた|辞めた|諦め|放置|使わなく|無理だった|できなかった|残らなかった/i;
const CHANGE_PATTERN = /以前は|当時は|今は|変わった|考え直|もう違う|反対|一方で/i;

const inferRelation = (candidate: SearchCandidate): MemoryRelation => {
  const text = `${candidate.title}\n${candidate.excerpt}`;
  if (ABANDONED_PATTERN.test(text)) return "試したが残らなかった";
  if (CHANGE_PATTERN.test(text)) return "以前と変化";
  if (candidate.lexical_score >= 0.42 || candidate.semantic_score >= 0.78) {
    return "同じ悩み・発想";
  }
  return "組み合わせ可能";
};

const scoreCandidate = (candidate: SearchCandidate): number => {
  const base = candidate.semantic_score * 0.68 + candidate.lexical_score * 0.32;
  const dated = candidate.recorded_at ? 0.015 : 0;
  const userAuthored = candidate.author_role === "user" ? 0.02 : 0;
  const linkPenalty = (candidate.excerpt.match(/\[\[/g)?.length ?? 0) >= 3 ? 0.14 : 0;
  return Math.min(1, Math.max(0, base + dated + userAuthored - linkPenalty));
};

const buildSearchQueries = (query: string): string[] => {
  const queries = [query];
  if (/タスク|TODO|メモ|情報整理/i.test(query) && /続か|管理|整理|見返|仕分け/i.test(query)) {
    queries.push("週1回 仕分け inbox できない 続かない", "手書き Notion TODO リンク集 見ない");
  }
  if (/MPSP/i.test(query) && /仕様|決め|進ま|止ま|集客|発信/i.test(query)) {
    queries.push(
      "制作 作る 構造 没頭 楽しい",
      "ブログ 集客 発信 SNS 止まる 苦しい",
      "MPSP 仕様 完璧 決められない"
    );
  }
  return queries;
};

export class RecallService {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly embeddings: EmbeddingProvider,
    private readonly minConfidence = 0.52,
    private readonly defaultMaxResults = 3
  ) {}

  async recall(query: string, requestedMax?: number): Promise<RecallResponse> {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 4) return { query: cleanQuery, results: [] };
    const maxResults = Math.min(3, Math.max(1, requestedMax ?? this.defaultMaxResults));
    const searchQueries = buildSearchQueries(cleanQuery);
    const embeddings = await this.embeddings.embed(searchQueries);
    const searched = await Promise.all(
      searchQueries.map((searchQuery, index) => {
        const embedding = embeddings[index];
        return embedding
          ? this.repository.search(searchQuery, embedding, Math.max(12, maxResults * 4))
          : Promise.resolve([]);
      })
    );
    const bestByMemory = new Map<string, SearchCandidate>();
    for (const candidate of searched.flat()) {
      const previous = bestByMemory.get(candidate.memory_id);
      if (!previous || scoreCandidate(candidate) > scoreCandidate(previous)) {
        bestByMemory.set(candidate.memory_id, candidate);
      }
    }
    const seen = new Set<string>();
    const results = [...bestByMemory.values()]
      .sort((left, right) => scoreCandidate(right) - scoreCandidate(left))
      .map((candidate) => ({ candidate, confidence: scoreCandidate(candidate) }))
      .filter(({ confidence }) => confidence >= this.minConfidence)
      .filter(({ candidate }) => {
        const key = `${candidate.source_uri}:${candidate.excerpt.slice(0, 80)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, maxResults)
      .map(({ candidate, confidence }) => ({
        memory_id: candidate.memory_id,
        date: candidate.recorded_at,
        excerpt: candidate.excerpt,
        source_uri: candidate.source_uri,
        source_type: candidate.source_type,
        title: candidate.title,
        relation: inferRelation(candidate),
        confidence: Number(confidence.toFixed(3))
      }));
    return { query: cleanQuery, results };
  }
}
