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

/** How long a search waits on the embedder. */
export interface EmbedderLimits {
  /** To connect, TLS handshake included: an unreachable host costs this much */
  connectMs: number;
  /** For the whole request */
  totalMs: number;
  /** After a failed connection, the embedder is not tried again for this long */
  retryAfterMs: number;
}

export const EMBEDDER_LIMITS: EmbedderLimits = {
  connectMs: 800,
  totalMs: 3000,
  retryAfterMs: 60_000,
};

/**
 * When this server instance may try the embedder again after it could not
 * connect (port closed by the firewall, host down, wrong certificate), so
 * that later searches do not each pay the connection timeout.
 */
export interface Reachability {
  retryAt: number;
}

const instanceReachability: Reachability = { retryAt: 0 };

/**
 * Asks the embedder for `text`'s embedding. Null on any failure, after
 * `limits.totalMs`, or at once while a failed connection is recent: the
 * caller searches without it.
 */
export function requestTextEmbedding(
  config: EmbedderConfig,
  text: string,
  limits: EmbedderLimits = EMBEDDER_LIMITS,
  reachability: Reachability = instanceReachability,
): Promise<TextEmbedding | null> {
  if (Date.now() < reachability.retryAt) return Promise.resolve(null);
  return new Promise((resolve) => {
    let connected = false;
    let settled = false;
    const finish = (value: TextEmbedding | null, unreachable = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      if (unreachable) reachability.retryAt = Date.now() + limits.retryAfterMs;
      resolve(value);
    };
    const body = JSON.stringify({ text });
    const req = request(
      new URL("/embed", config.url),
      {
        method: "POST",
        ca: config.ca,
        // A new connection each time: a kept-alive one may have been closed
        // by the embedder since (it drops idle clients after 5 s), and only
        // queries never seen before come here
        agent: false,
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
          if (res.statusCode !== 200) {
            finish(null);
            return;
          }
          try {
            finish(
              readTextEmbedding(JSON.parse(Buffer.concat(chunks).toString())),
            );
          } catch {
            finish(null);
          }
        });
        res.on("error", () => {
          finish(null);
        });
      },
    );
    req.on("socket", (socket) => {
      socket.once("secureConnect", () => {
        connected = true;
        clearTimeout(connectTimer);
      });
    });
    const connectTimer = setTimeout(() => {
      req.destroy();
      finish(null, true);
    }, limits.connectMs);
    const totalTimer = setTimeout(() => {
      req.destroy();
      finish(null);
    }, limits.totalMs);
    req.on("error", () => {
      // Refused, unreachable, or a certificate other than the pinned one
      finish(null, !connected);
    });
    req.end(body);
  });
}
