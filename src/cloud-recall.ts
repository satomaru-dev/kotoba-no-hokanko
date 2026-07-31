import type { RecallResponse } from "./types.js";

export interface RecallProvider {
  recall(query: string, requestedMax?: number): Promise<RecallResponse>;
}

export class CloudRecallService implements RecallProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string
  ) {}

  async recall(query: string, requestedMax = 3): Promise<RecallResponse> {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 4) return { query: cleanQuery, results: [] };
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Memory-Service-Token": this.serviceToken
      },
      body: JSON.stringify({ query: cleanQuery, max_results: Math.min(3, requestedMax) })
    });
    if (!response.ok) throw new Error(`cloud recall failed (${response.status})`);
    return response.json() as Promise<RecallResponse>;
  }
}
