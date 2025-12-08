export interface UserSession {
  id: string;
  email: string;
  name: string;
  picture?: string;
  createdAt: number;
  expiresAt: number;
  lastActivity: number;
}

export interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface GoogleUserInfo {
  sub: string; // Google user ID
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  // Alternative field names that Google sometimes uses
  id?: string; // Alternative to sub
  verified_email?: boolean; // Alternative to email_verified
}

export interface AuthConfig {
  enabled: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
  emailWhitelist: string[];
  sessionSecret?: string;
  sessionDuration: number; // seconds
}

export interface AuthState {
  isAuthenticated: boolean;
  user: UserSession | null;
  loading: boolean;
  error: string | null;
}

export type AuthAction =
  | { type: "AUTH_LOADING" }
  | { type: "AUTH_SUCCESS"; user: UserSession }
  | { type: "AUTH_ERROR"; error: string }
  | { type: "AUTH_LOGOUT" };
