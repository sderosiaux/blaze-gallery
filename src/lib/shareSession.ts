import crypto from "crypto";
import type { SharedFolder } from "./database";
import { logger } from "./logger";

/**
 * What a guest holds once past the password of a shared link: an expiry and
 * an HMAC of the share token, that expiry and the password hash the access
 * was granted under. Nothing is stored, so a session holds across server
 * instances and restarts (serverless), and changing a link's password ends
 * every session handed out before.
 */

const SESSION_DURATION = 24 * 60 * 60 * 1000;

type SessionShare = Pick<SharedFolder, "share_token" | "password_hash">;

const globalForSecret = globalThis as unknown as {
  shareSessionSecret: Buffer | undefined;
};

function secret(): Buffer {
  const configured = process.env.AUTH_SESSION_SECRET;
  // The documented placeholders start with "your": a secret anyone can read
  // in the repo would let anyone sign a session.
  if (configured && configured.length >= 32 && !/^your/i.test(configured)) {
    return Buffer.from(configured);
  }
  if (!globalForSecret.shareSessionSecret) {
    logger.warn(
      "AUTH_SESSION_SECRET is not set: shared-link sessions only last as long as this server process",
    );
    globalForSecret.shareSessionSecret = crypto.randomBytes(32);
  }
  return globalForSecret.shareSessionSecret;
}

function sign(share: SessionShare, expiresAt: number): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`${share.share_token}.${expiresAt}.${share.password_hash ?? ""}`)
    .digest("base64url");
}

export function createShareSession(share: SessionShare): string {
  const expiresAt = Date.now() + SESSION_DURATION;
  return `${expiresAt}.${sign(share, expiresAt)}`;
}

export function isValidShareSession(
  sessionToken: string,
  share: SessionShare,
): boolean {
  const [expiry, signature, extra] = sessionToken.split(".");
  if (!expiry || !signature || extra !== undefined) return false;
  const expiresAt = Number(expiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Date.now()) return false;
  const expected = Buffer.from(sign(share, expiresAt));
  const given = Buffer.from(signature);
  return (
    given.length === expected.length && crypto.timingSafeEqual(given, expected)
  );
}
