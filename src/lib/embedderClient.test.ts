import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { test } from "node:test";
import {
  embedderConfig,
  readTextEmbedding,
  requestTextEmbedding,
  vectorLiteral,
} from "./embedderClient";

const PEM = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";

void test("the embedder is configured by all three variables, over https only", () => {
  const env = {
    EMBEDDER_URL: "https://203.0.113.7:47443",
    EMBEDDER_TOKEN: "t".repeat(64),
    EMBEDDER_CA: PEM.replace(/\n/g, "\\n"),
  };
  const config = embedderConfig(env);
  assert.ok(config);
  assert.equal(config.url.port, "47443");
  // A PEM pasted on one line with \n comes back with its newlines
  assert.equal(config.ca, PEM);
  assert.equal(embedderConfig({ ...env, EMBEDDER_TOKEN: "" }), null);
  assert.equal(embedderConfig({ ...env, EMBEDDER_CA: undefined }), null);
  assert.equal(
    embedderConfig({ ...env, EMBEDDER_URL: "http://203.0.113.7:47443" }),
    null,
  );
});

void test("only a model name and finite numbers read as an embedding", () => {
  assert.deepEqual(readTextEmbedding({ model: "m@1", embedding: [0.6, 0.8] }), {
    model: "m@1",
    embedding: [0.6, 0.8],
  });
  assert.equal(readTextEmbedding({ model: "m@1", embedding: [] }), null);
  assert.equal(readTextEmbedding({ model: "", embedding: [1] }), null);
  assert.equal(readTextEmbedding({ model: "m", embedding: [1, "2"] }), null);
  assert.equal(readTextEmbedding({ model: "m", embedding: [Infinity] }), null);
  assert.equal(readTextEmbedding({ error: "unauthorized" }), null);
  assert.equal(readTextEmbedding(null), null);
});

void test("a vector is sent to pgvector in its text form", () => {
  assert.equal(vectorLiteral([0.5, -0.25, 1e-7]), "[0.5,-0.25,1e-7]");
});

void test("an embedder that cannot be reached costs one connection timeout, then nothing", async () => {
  // Accepts the connection and never answers the TLS handshake
  const silent = createServer(() => undefined);
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const { port } = silent.address() as AddressInfo;
  const config = embedderConfig({
    EMBEDDER_URL: `https://127.0.0.1:${port}`,
    EMBEDDER_TOKEN: "t".repeat(64),
    EMBEDDER_CA: PEM,
  });
  assert.ok(config);
  const limits = { connectMs: 200, totalMs: 3000, retryAfterMs: 60_000 };
  const reachability = { retryAt: 0 };
  try {
    let began = Date.now();
    assert.equal(
      await requestTextEmbedding(config, "chat", limits, reachability),
      null,
    );
    const first = Date.now() - began;
    assert.ok(first >= 150 && first < 1000, `waited ${first} ms`);
    assert.ok(reachability.retryAt > Date.now());

    began = Date.now();
    assert.equal(
      await requestTextEmbedding(config, "chat", limits, reachability),
      null,
    );
    assert.ok(Date.now() - began < 50, "tried again within the minute");
  } finally {
    silent.close();
  }
});

void test("a refused connection is remembered too", async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const { port } = closed.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    closed.close(() => {
      resolve();
    });
  });
  const config = embedderConfig({
    EMBEDDER_URL: `https://127.0.0.1:${port}`,
    EMBEDDER_TOKEN: "t".repeat(64),
    EMBEDDER_CA: PEM,
  });
  assert.ok(config);
  const reachability = { retryAt: 0 };
  assert.equal(
    await requestTextEmbedding(config, "chat", undefined, reachability),
    null,
  );
  assert.ok(reachability.retryAt > Date.now());
});
