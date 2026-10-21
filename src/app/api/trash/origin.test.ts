/**
 * The Corbeille's writes refuse a request sent from another site's page
 * (validateOrigin), before reading its body or the database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";

const APP = "https://photos.example";

void test("a write of the Corbeille from another site is refused; from the app it goes on", async (t) => {
  const env = {
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: APP,
    GOOGLE_AUTH_ENABLED: "false",
    // No database behind: reaching it would answer 500, not 403 or 400
    DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });
  const routes = {
    "/api/trash": await import("./route"),
    "/api/trash/restore": await import("./restore/route"),
    "/api/trash/empty": await import("./empty/route"),
    "/api/stacks/keep": await import("../stacks/keep/route"),
  };
  const post = (path: string, origin: string) =>
    new NextRequest(`${APP}${path}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
    });
  for (const [path, route] of Object.entries(routes)) {
    const foreign = await route.POST(post(path, "https://evil.example"));
    assert.equal(foreign.status, 403, path);
    // From the app: past the origin, refused for its empty body
    const own = await route.POST(post(path, APP));
    assert.equal(own.status, 400, path);
  }
});
