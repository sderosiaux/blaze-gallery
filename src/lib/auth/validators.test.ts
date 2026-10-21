import assert from "node:assert/strict";
import { test } from "node:test";

void test("validateOrigin takes the app's own origin, whole, never a prefix", async (t) => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
  Object.assign(process.env, {
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "https://app.example.com/",
  });
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });
  const { validateOrigin } = await import("./validators");
  const from = (headers: Record<string, string>) =>
    validateOrigin(
      new Request("https://app.example.com/api/x", {
        method: "POST",
        headers,
      }),
    );
  assert.equal(from({ origin: "https://app.example.com" }), true);
  assert.equal(
    from({ referer: "https://app.example.com/admin/corbeille" }),
    true,
  );
  // A prefix of another host, another scheme or port, garbage: refused
  assert.equal(from({ referer: "https://app.example.com.evil.net/x" }), false);
  assert.equal(from({ origin: "https://app.example.com.evil.net" }), false);
  assert.equal(from({ referer: "https://app.example.com@evil.net/" }), false);
  assert.equal(from({ origin: "http://app.example.com" }), false);
  assert.equal(from({ origin: "https://app.example.com:8443" }), false);
  assert.equal(from({ referer: "not a url" }), false);
  assert.equal(from({}), false);
});
