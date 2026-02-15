import { fetchWithRetry } from "../infra/fetch-retry.js";
import { createLogger } from "../infra/logger.js";

const logger = createLogger("embeddings");

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly model: string;
  readonly dimensions: number;
}

/**
 * Create an OpenAI embedding provider.
 * Uses the OpenAI embeddings API via native fetch().
 */
export function createOpenAIEmbeddingProvider(params: {
  apiKey: string;
  model?: string;
}): EmbeddingProvider {
  const { apiKey } = params;
  const model = params.model ?? "text-embedding-3-small";

  return {
    model,
    dimensions: 1536,

    async embed(texts) {
      if (texts.length === 0) {
        return [];
      }

      logger.debug(`Embedding ${texts.length} texts with ${model}`);

      const response = await fetchWithRetry("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, input: texts }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI embeddings API error ${response.status}: ${body}`);
      }

      const json = (await response.json()) as {
        data: { embedding: number[]; index: number }[];
      };

      // Sort by index to match input order (API may return out of order)
      const sorted = json.data.toSorted((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    },
  };
}
