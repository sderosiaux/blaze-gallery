import assert from "node:assert/strict";
import { test } from "node:test";
import {
  embedderConfig,
  readTextEmbedding,
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
