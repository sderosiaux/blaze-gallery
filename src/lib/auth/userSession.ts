import crypto from 'crypto';
import { UserSession } from './types';
import { authConfig } from './config';

// Persistent session store that survives hot reloads in development
// Using the same globalThis pattern as shareSession.ts
const globalForUserSessions = globalThis as unknown as {
  userSessions: Map<string, UserSession> | undefined;
};

const userSessions: Map<string, UserSession> = 
  globalForUserSessions.userSessions ?? (globalForUserSessions.userSessions = new Map());

/**
 * Create a new user session
 */
export function createUserSession(user: {
  email: string;
  name: string;
  picture?: string;
  googleId: string;
}): string {
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  
  const session: UserSession = {
    id: sessionId,
    email: user.email.toLowerCase(),
    name: user.name,
    picture: user.picture,
    createdAt: now,
    expiresAt: now + (authConfig.sessionDuration * 1000),
    lastActivity: now,
  };
  
  userSessions.set(sessionId, session);
  
  // Clean up expired sessions periodically
  cleanupExpiredUserSessions();
  
  console.log('🔐 Created user session:', {
    sessionId: `${sessionId.substring(0, 8)}...`,
    email: user.email,
    expiresAt: new Date(session.expiresAt).toISOString()
  });
  
  return sessionId;
}

/**
 * Validate and refresh a user session
 */
export function validateUserSession(sessionId: string): UserSession | null {
  const session = userSessions.get(sessionId);
  
  if (!session) {
    return null;
  }
  
  const now = Date.now();
  
  // Check if session is expired
  if (now > session.expiresAt) {
    userSessions.delete(sessionId);
    console.log('🕐 User session expired and removed:', {
      sessionId: `${sessionId.substring(0, 8)}...`,
      email: session.email
    });
    return null;
  }
  
  // Update last activity and extend session if it's been more than 1 hour since last activity
  const oneHour = 60 * 60 * 1000;
  if (now - session.lastActivity > oneHour) {
    session.lastActivity = now;
    session.expiresAt = now + (authConfig.sessionDuration * 1000);
    userSessions.set(sessionId, session);
  }
  
  return session;
}

/**
 * Revoke a user session
 */
export function revokeUserSession(sessionId: string): void {
  const session = userSessions.get(sessionId);
  if (session) {
    userSessions.delete(sessionId);
    console.log('🚪 User session revoked:', {
      sessionId: `${sessionId.substring(0, 8)}...`,
      email: session.email
    });
  }
}

/**
 * Get all active sessions for a user (by email)
 */
export function getUserSessions(email: string): UserSession[] {
  const normalizedEmail = email.toLowerCase();
  return Array.from(userSessions.values())
    .filter(session => session.email === normalizedEmail);
}

/**
 * Revoke all sessions for a user
 */
export function revokeUserSessions(email: string): void {
  const normalizedEmail = email.toLowerCase();
  const sessionsToRevoke = Array.from(userSessions.entries())
    .filter(([_, session]) => session.email === normalizedEmail);
  
  sessionsToRevoke.forEach(([sessionId, session]) => {
    userSessions.delete(sessionId);
    console.log('🚪 User session revoked (bulk):', {
      sessionId: `${sessionId.substring(0, 8)}...`,
      email: session.email
    });
  });
}

/**
 * Get session statistics
 */
export function getSessionStats(): {
  totalSessions: number;
  activeUsers: number;
  oldestSession: Date | null;
  newestSession: Date | null;
} {
  const sessions = Array.from(userSessions.values());
  const emails = new Set(sessions.map(s => s.email));
  
  return {
    totalSessions: sessions.length,
    activeUsers: emails.size,
    oldestSession: sessions.length > 0 
      ? new Date(Math.min(...sessions.map(s => s.createdAt)))
      : null,
    newestSession: sessions.length > 0
      ? new Date(Math.max(...sessions.map(s => s.createdAt)))
      : null,
  };
}

/**
 * Clean up expired sessions
 */
function cleanupExpiredUserSessions(): void {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [sessionId, session] of userSessions.entries()) {
    if (now > session.expiresAt) {
      userSessions.delete(sessionId);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} expired user sessions`);
  }
}

// Cleanup expired sessions every hour
if (typeof window === 'undefined') {
  setInterval(cleanupExpiredUserSessions, 60 * 60 * 1000);
}