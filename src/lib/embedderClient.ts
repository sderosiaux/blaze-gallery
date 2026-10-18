import { request } from "node:https";

/**
 * The query embedder on the worker machine (blaze-embedder, worker/): an
 * HTTPS endpoint with a self-signed certificate. The app trusts that
 * certificate only (EMBEDDER_CA), not the system's authorities, and sends
 * EMBEDDER_TOKEN as a Bearer token.
 *
 *   EMBEDDER_URL    https://<host>:<port>
 *   EMBEDDER_TOKEN  the token the embedder was started with
 *   EMBEDDER_CA     its certificate, PEM (newlines may be written \n)
 */
export interface EmbedderConfig {
  url: URL;
  token: string;
  ca: string;
}

export interface TextEmbedding {
  /** L2-normalized */
  embedding: number[];
  /** The space it lives in, as photo_embeddings.model names it */
  model: string;
}

/** Null when any of the three is missing: search goes on without content. */
export function embedderConfig(
  env: Record<string, string | undefined> = process.env,
): EmbedderConfig | null {
  const { EMBEDDER_URL, EMBEDDER_TOKEN, EMBEDDER_CA } = env;
  if (!EMBEDDER_URL || !EMBEDDER_TOKEN || !EMBEDDER_CA) return null;
  const url = new URL(EMBEDDER_URL);
  if (url.protocol !== "https:") return null;
  return { url, token: EMBEDDER_TOKEN, ca: EMBEDDER_CA.replace(/\\n/g, "\n") };
}

/** The embedder's answer, if it is one; anything else reads as no answer. */
export function readTextEmbedding(body: unknown): TextEmbedding | null {
  if (typeof body !== "object" || body === null) return null;
  const { embedding, model } = body as Record<string, unknown>;
  if (typeof model !== "string" || model === "" || !Array.isArray(embedding))
    return null;
  if (
    embedding.length === 0 ||
    !embedding.every((v) => typeof v === "number" && Number.isFinite(v))
  )
    return null;
  return { embedding: embedding as number[], model };
}

/** pgvector's text form of a vector, for a `$n::halfvec` parameter. */
export function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

/**
 * Asks the embedder for `text`'s embedding. Null on any failure or after
 * `timeoutMs` (connection and answer included): the caller searches without it.
 */
export function requestTextEmbedding(
  config: EmbedderConfig,
  text: string,
  timeoutMs: number,
): Promise<TextEmbedding | null> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ text });
    const req = request(
      new URL("/embed", config.url),
      {
        method: "POST",
        ca: config.ca,
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          clearTimeout(timer);
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          try {
            resolve(
              readTextEmbedding(JSON.parse(Buffer.concat(chunks).toString())),
            );
          } catch {
            resolve(null);
          }
        });
        res.on("error", () => {
          resolve(null);
        });
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      resolve(null);
    }, timeoutMs);
    req.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    req.end(body);
  });
}
