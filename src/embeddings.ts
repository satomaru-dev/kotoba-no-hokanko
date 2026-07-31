import OpenAI from "openai";

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model = "text-embedding-3-small"
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      encoding_format: "float"
    });
    return response.data
      .sort((left, right) => left.index - right.index)
      .map((item) => item.embedding);
  }
}

/**
 * Offline fallback for development and tests. It is intentionally deterministic,
 * but production should use OpenAI embeddings for Japanese semantic recall.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = Array.from({ length: this.dimensions }, () => 0);
      const normalized = text.normalize("NFKC").toLowerCase();
      const tokens = [...normalized.matchAll(/[a-z0-9]{2,}/gu)].map(
        (match) => match[0]
      );
      for (const match of normalized.matchAll(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu
      )) {
        const value = match[0];
        for (const size of [2, 3, 4]) {
          for (let index = 0; index <= value.length - size; index += 1) {
            tokens.push(value.slice(index, index + size));
          }
        }
      }
      for (const token of tokens) {
        let hash = 2166136261;
        for (const character of token) {
          hash ^= character.codePointAt(0) ?? 0;
          hash = Math.imul(hash, 16777619);
        }
        const index = Math.abs(hash) % this.dimensions;
        vector[index] = (vector[index] ?? 0) + 1;
      }
      const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
    });
  }
}

export const cosineSimilarity = (left: number[], right: number[]): number => {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
};
