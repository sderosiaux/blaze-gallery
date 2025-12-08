import crypto from "crypto";
import { UserSession } from "./types";
import { authConfig } from "./config";
import { query } from "../database";

/**
 * Database-backed session storage for serverless environments
 * Sessions are stored in PostgreSQL (Neon) for persistence across function invocations
 */

interface DbSession {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  google_id: string | null;
  created_at: Date;
  expires_at: Date;
  last_activity: Date;
}

/**
 * Create a new user session in the database
 */
export async function createUserSession(user: {
  email: string;
  name: string;
  picture?: string;
  googleId: string;
}): Promise<string> {
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + authConfig.sessionDuration * 1000);

  await query(
    `INSERT INTO user_sessions (id, email, name, picture, google_id, created_at, expires_at, last_activity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      sessionId,
      user.email.toLowerCase(),
      user.name,
      user.picture || null,
      user.googleId,
      now,
      expiresAt,
      now,
    ]
  );

  // Clean up expired sessions periodically (async, don't wait)
  cleanupExpiredUserSessions().catch(console.error);

  console.log("Created user session:", {
    sessionId: `${sessionId.substring(0, 8)}...`,
    email: user.email,
    expiresAt: expiresAt.toISOString(),
  });

  return sessionId;
}

/**
 * Validate and refresh a user session from the database
 */
export async function validateUserSession(
  sessionId: string
): Promise<UserSession | null> {
  const result = await query(
    `SELECT * FROM user_sessions WHERE id = $1`,
    [sessionId]
  );

  const dbSession = result.rows[0] as DbSession | undefined;

  if (!dbSession) {
    return null;
  }

  const now = new Date();
  const expiresAt = new Date(dbSession.expires_at);

  // Check if session is expired
  if (now > expiresAt) {
    await query(`DELETE FROM user_sessions WHERE id = $1`, [sessionId]);
    console.log("User session expired and removed:", {
      sessionId: `${sessionId.substring(0, 8)}...`,
      email: dbSession.email,
    });
    return null;
  }

  // Update last activity and extend session if it's been more than 1 hour since last activity
  const oneHour = 60 * 60 * 1000;
  const lastActivity = new Date(dbSession.last_activity);
  if (now.getTime() - lastActivity.getTime() > oneHour) {
    const newExpiresAt = new Date(now.getTime() + authConfig.sessionDuration * 1000);
    await query(
      `UPDATE user_sessions SET last_activity = $1, expires_at = $2 WHERE id = $3`,
      [now, newExpiresAt, sessionId]
    );
  }

  return {
    id: dbSession.id,
    email: dbSession.email,
    name: dbSession.name,
    picture: dbSession.picture || undefined,
    createdAt: new Date(dbSession.created_at).getTime(),
    expiresAt: expiresAt.getTime(),
    lastActivity: lastActivity.getTime(),
  };
}

/**
 * Revoke a user session
 */
export async function revokeUserSession(sessionId: string): Promise<void> {
  const result = await query(
    `DELETE FROM user_sessions WHERE id = $1 RETURNING email`,
    [sessionId]
  );

  if (result.rows[0]) {
    console.log("User session revoked:", {
      sessionId: `${sessionId.substring(0, 8)}...`,
      email: result.rows[0].email,
    });
  }
}

/**
 * Get all active sessions for a user (by email)
 */
export async function getUserSessions(email: string): Promise<UserSession[]> {
  const normalizedEmail = email.toLowerCase();
  const result = await query(
    `SELECT * FROM user_sessions WHERE email = $1 AND expires_at > NOW()`,
    [normalizedEmail]
  );

  return result.rows.map((row: DbSession) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    picture: row.picture || undefined,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
    lastActivity: new Date(row.last_activity).getTime(),
  }));
}

/**
 * Revoke all sessions for a user
 */
export async function revokeUserSessions(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase();
  const result = await query(
    `DELETE FROM user_sessions WHERE email = $1`,
    [normalizedEmail]
  );

  console.log("User sessions revoked (bulk):", {
    email: normalizedEmail,
    count: result.rowCount,
  });
}

/**
 * Get session statistics
 */
export async function getSessionStats(): Promise<{
  totalSessions: number;
  activeUsers: number;
  oldestSession: Date | null;
  newestSession: Date | null;
}> {
  const statsResult = await query(`
    SELECT
      COUNT(*) as total_sessions,
      COUNT(DISTINCT email) as active_users,
      MIN(created_at) as oldest_session,
      MAX(created_at) as newest_session
    FROM user_sessions
    WHERE expires_at > NOW()
  `);

  const stats = statsResult.rows[0];

  return {
    totalSessions: parseInt(stats.total_sessions) || 0,
    activeUsers: parseInt(stats.active_users) || 0,
    oldestSession: stats.oldest_session ? new Date(stats.oldest_session) : null,
    newestSession: stats.newest_session ? new Date(stats.newest_session) : null,
  };
}

/**
 * Clean up expired sessions from the database
 */
async function cleanupExpiredUserSessions(): Promise<void> {
  const result = await query(`
    DELETE FROM user_sessions WHERE expires_at < NOW()
  `);

  if (result.rowCount && result.rowCount > 0) {
    console.log(`Cleaned up ${result.rowCount} expired user sessions`);
  }
}
