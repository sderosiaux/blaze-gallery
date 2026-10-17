"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useReducer, useEffect } from "react";
import { asString, isRecord } from "@/hooks/apiJson";
import type { AuthState, AuthAction, UserSession } from "@/lib/auth/types";

interface AuthContextType extends AuthState {
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const initialState: AuthState = {
  isAuthenticated: false,
  user: null,
  loading: true,
  error: null,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "AUTH_LOADING":
      return { ...state, loading: true, error: null };
    case "AUTH_SUCCESS":
      return {
        isAuthenticated: true,
        user: action.user,
        loading: false,
        error: null,
      };
    case "AUTH_ERROR":
      return {
        isAuthenticated: false,
        user: null,
        loading: false,
        error: action.error,
      };
    case "AUTH_LOGOUT":
      return {
        isAuthenticated: false,
        user: null,
        loading: false,
        error: null,
      };
    default:
      return state;
  }
}

/**
 * The session endpoint returns only some UserSession fields (auth-disabled
 * mode sends just name and email), so the UI contract is those two strings.
 */
function isUserSession(value: unknown): value is UserSession {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.email === "string"
  );
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  const refreshSession = async () => {
    try {
      dispatch({ type: "AUTH_LOADING" });

      const response = await fetch("/api/auth/session", {
        method: "GET",
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error("Failed to get session");
      }

      const body: unknown = await response.json();
      const isAuthenticated = isRecord(body) && body.isAuthenticated;
      const user = isRecord(body) ? body.user : undefined;

      if (isAuthenticated && isUserSession(user)) {
        dispatch({ type: "AUTH_SUCCESS", user });
      } else {
        dispatch({ type: "AUTH_LOGOUT" });
      }
    } catch (error) {
      console.error("Session refresh failed:", error);
      dispatch({ type: "AUTH_LOGOUT" });
    }
  };

  const login = async () => {
    try {
      dispatch({ type: "AUTH_LOADING" });

      // Get OAuth URL
      const response = await fetch("/api/auth/google/login", {
        method: "GET",
        credentials: "same-origin",
      });

      if (!response.ok) {
        const error: unknown = await response.json();
        const message = isRecord(error) ? asString(error.error) : undefined;
        throw new Error(
          message !== undefined && message !== ""
            ? message
            : "Failed to initiate login",
        );
      }

      const body: unknown = await response.json();
      const authUrl = isRecord(body) ? asString(body.authUrl) : undefined;
      if (authUrl === undefined) throw new Error("Failed to initiate login");

      // Redirect to Google OAuth
      window.location.href = authUrl;
    } catch (error) {
      console.error("Login failed:", error);
      dispatch({
        type: "AUTH_ERROR",
        error:
          error instanceof Error ? error.message : "La connexion a échoué.",
      });
    }
  };

  const logout = async () => {
    try {
      dispatch({ type: "AUTH_LOADING" });

      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        console.warn("Logout request failed, clearing local session anyway");
      }

      dispatch({ type: "AUTH_LOGOUT" });

      // Redirect to home page
      window.location.href = "/";
    } catch (error) {
      console.error("Logout failed:", error);
      // Still clear local session even if server logout failed
      dispatch({ type: "AUTH_LOGOUT" });
    }
  };

  // Check session on mount and handle OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authSuccess = urlParams.get("auth");
    const authError = urlParams.get("error");
    const reason = urlParams.get("reason");

    if (authSuccess === "success") {
      // Remove URL parameters and refresh session
      window.history.replaceState({}, document.title, window.location.pathname);
      void refreshSession();
    } else if (authError) {
      // Handle OAuth errors
      const errorMessage = getErrorMessage(authError, reason);
      dispatch({ type: "AUTH_ERROR", error: errorMessage });

      // Remove error from URL after a brief delay to ensure state is set
      setTimeout(() => {
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );
      }, 100);
    } else {
      // Regular session check
      void refreshSession();
    }
  }, []);

  const value: AuthContextType = {
    ...state,
    login,
    logout,
    refreshSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

function getErrorMessage(error: string, reason?: string | null): string {
  switch (error) {
    case "auth_disabled":
      return "La connexion est désactivée.";
    case "oauth_access_denied":
      return "Connexion annulée.";
    case "oauth_invalid_request":
      return "Demande de connexion invalide.";
    case "unauthorized":
      return reason !== null && reason !== undefined && reason !== ""
        ? reason
        : "not_authorized";
    case "rate_limit":
      return "Trop de tentatives. Réessayez plus tard.";
    case "invalid_callback":
      return "Réponse de connexion invalide.";
    case "missing_oauth_data":
      return "Données de connexion manquantes. Réessayez.";
    case "invalid_state":
      return "Contrôle de sécurité échoué. Réessayez.";
    case "callback_failed":
      return "La connexion a échoué. Réessayez.";
    case "id_token_verification_failed":
      return "Jeton de connexion invalide. Réessayez.";
    default:
      return "Erreur pendant la connexion.";
  }
}
