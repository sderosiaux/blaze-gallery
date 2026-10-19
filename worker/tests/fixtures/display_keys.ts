/**
 * Writes display_keys.json next to this file: where the app reads each
 * photo's display rendition (src/lib/displayRendition.ts). test_display.py
 * pins the worker's keys to it, and displayRendition.test.ts fails while the
 * file is not what the app computes. Regenerate after any change to the
 * rendition's key (storageKey, storagePrefix, VERSION), from the repo root:
 *
 *   npx tsx worker/tests/fixtures/display_keys.ts           # --print: stdout only
 *
 * The key is caught where getDisplayRendition reads the stored rendition
 * (S3 GetObject, or the file read in local mode), answered "not found" so
 * nothing leaves the machine. getConfig caches the environment: each
 * configuration runs in its own process.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { S3Client } from "@aws-sdk/client-s3";
import type { QuarterTurn } from "@/lib/rotation";

/** The app's settings that place renditions (THUMBNAIL_STORAGE and the rest). */
type Settings = Record<string, string>;

interface Case {
  settings: Settings;
  id: number;
  s3_key: string;
  rotation: QuarterTurn;
}

interface Expected extends Case {
  key: string;
}

// getConfig refuses to load without an originals bucket, and the s3 mode
// wants a full thumbnail bucket; never contacted
const CONNECTION = {
  BACKBLAZE_ENDPOINT: "http://127.0.0.1:9",
  BACKBLAZE_BUCKET: "originals",
  BACKBLAZE_ACCESS_KEY: "x",
  BACKBLAZE_SECRET_KEY: "x",
  THUMBNAIL_S3_ENDPOINT: "http://127.0.0.1:9",
  THUMBNAIL_S3_BUCKET: "thumbs",
  THUMBNAIL_S3_ACCESS_KEY: "x",
  THUMBNAIL_S3_SECRET_KEY: "x",
};
const PROD = { THUMBNAIL_STORAGE: "s3", THUMBNAIL_S3_PREFIX: "thumbnails" };
const NICE = "Photos/Été 2023/Plage à Nice.heic";

const CASES: Case[] = [
  {
    settings: PROD,
    id: 167220,
    s3_key: "pc-fixe/2022 iCloud/IMG_7961.HEIC",
    rotation: 0,
  },
  {
    settings: PROD,
    id: 167220,
    s3_key: "pc-fixe/2022 iCloud/IMG_7961.HEIC",
    rotation: 90,
  },
  { settings: PROD, id: 42, s3_key: NICE, rotation: 90 },
  { settings: PROD, id: 42, s3_key: NICE, rotation: 180 },
  { settings: PROD, id: 42, s3_key: NICE, rotation: 270 },
  // "é" decomposed (NFD, as macOS writes names): kept as is, not normalized
  {
    settings: PROD,
    id: 43,
    s3_key: "Photos/Cafe\u0301 du coin.HEIF",
    rotation: 0,
  },
  { settings: PROD, id: 7, s3_key: "IMG_0001.HEIC", rotation: 0 },
  { settings: PROD, id: 8, s3_key: "//leading/slashes/x.heic", rotation: 270 },
  { settings: PROD, id: 9, s3_key: "dir/archive.tar.heic", rotation: 0 },
  { settings: PROD, id: 10, s3_key: "dir/.heic", rotation: 90 },
  { settings: PROD, id: 11, s3_key: "a/../b/./c.HEIC", rotation: 0 },
  { settings: PROD, id: 12, s3_key: "dir/no-extension", rotation: 0 },
  {
    settings: { THUMBNAIL_STORAGE: "s3", THUMBNAIL_S3_PREFIX: "a/thumbnails" },
    id: 42,
    s3_key: "x/y.heic",
    rotation: 90,
  },
  {
    settings: { THUMBNAIL_STORAGE: "s3", THUMBNAIL_S3_PREFIX: " /x//thumbs/ " },
    id: 5,
    s3_key: "y.heic",
    rotation: 0,
  },
  {
    // The app creates this directory when it loads
    settings: {
      THUMBNAIL_STORAGE: "local",
      THUMBNAILS_PATH: "/tmp/blaze-display-keys/",
    },
    id: 42,
    s3_key: NICE,
    rotation: 90,
  },
];

/** In a child process: the key read for each case, all under one configuration. */
async function readKeys(cases: Case[]): Promise<string[]> {
  const seen: string[] = [];
  const notFound = (name: string, code: string) =>
    Object.assign(new Error("not found"), { name, code });
  S3Client.prototype.send = async function (command: {
    input: { Key?: string };
  }) {
    seen.push(command.input.Key ?? "");
    throw notFound("NoSuchKey", "NoSuchKey");
  } as unknown as typeof S3Client.prototype.send;
  fs.promises.readFile = async function (file: unknown) {
    seen.push(String(file));
    throw notFound("Error", "ENOENT");
  } as unknown as typeof fs.promises.readFile;

  const { getDisplayRendition } = await import("@/lib/displayRendition");
  const keys: string[] = [];
  for (const c of cases) {
    seen.length = 0;
    // The stored read comes first; whatever follows (415 with prebuilt
    // sharp, a failed original read with a HEIC-capable one) is irrelevant
    await getDisplayRendition(
      { id: c.id, s3_key: c.s3_key, mime_type: "image/heic" },
      c.rotation,
    ).catch(() => undefined);
    const key = seen[0];
    if (key === undefined) throw new Error(`no read for ${c.s3_key}`);
    keys.push(key);
  }
  return keys;
}

function main(): void {
  const groups = new Map<string, Case[]>();
  for (const c of CASES) {
    const group = JSON.stringify(c.settings);
    groups.set(group, [...(groups.get(group) ?? []), c]);
  }
  const expected: Expected[] = [];
  for (const [settings, cases] of groups) {
    const out = execFileSync(
      process.execPath,
      [...process.execArgv, __filename, "--child"],
      {
        // Only the case's settings: none inherited from the shell
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          ...CONNECTION,
          ...(JSON.parse(settings) as Settings),
          LOG_LEVEL: "ERROR",
        },
        input: JSON.stringify(cases),
        encoding: "utf8",
      },
    );
    const keys = JSON.parse(out.trim().split("\n").pop() ?? "[]") as string[];
    cases.forEach((c, i) => {
      const key = keys[i];
      if (key === undefined) throw new Error(`no key for ${c.s3_key}`);
      expected.push({ ...c, key });
    });
  }
  const json = `${JSON.stringify(expected, null, 2)}\n`;
  if (process.argv.includes("--print")) {
    process.stdout.write(json);
    return;
  }
  const target = path.join(__dirname, "display_keys.json");
  fs.writeFileSync(target, json);
  console.log(`${expected.length} keys -> ${target}`);
}

if (process.argv.includes("--child")) {
  const cases = JSON.parse(fs.readFileSync(0, "utf8")) as Case[];
  readKeys(cases).then(
    (keys) => {
      process.stdout.write(`\n${JSON.stringify(keys)}\n`);
    },
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
} else {
  main();
}
