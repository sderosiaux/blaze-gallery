import crypto from 'crypto';

interface ShareSession {
  token: string;
  shareToken: string;
  createdAt: number;
  expiresAt: number;
}

// In-memory session store (consider Redis for production)
const sessions: Map<string, ShareSession> = new Map();

// Session duration: 24 hours
const SESSION_DURATION = 24 * 60 * 60 * 1000;

export function createShareSession(shareToken: string): string {
  const sessionToken = crypto.randomUUID();
  const now = Date.now();
  
  const session: ShareSession = {
    token: sessionToken,
    shareToken,
    createdAt: now,
    expiresAt: now + SESSION_DURATION
  };
  
  sessions.set(sessionToken, session);
  
  // Clean up expired sessions periodically
  cleanupExpiredSessions();
  
  return sessionToken;
}

export function validateShareSession(sessionToken: string): string | null {
  const session = sessions.get(sessionToken);
  
  if (!session) {
    return null;
  }
  
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionToken);
    return null;
  }
  
  return session.shareToken;
}

export function revokeShareSession(sessionToken: string): void {
  sessions.delete(sessionToken);
}

function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token);
    }
  }
}

// Cleanup expired sessions every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);