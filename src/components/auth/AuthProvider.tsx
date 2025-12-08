"use client";

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  ReactNode,
} from "react";
import { AuthState, AuthAction } from "@/lib/auth/types";

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

      const { isAuthenticated, user } = await response.json();

      if (isAuthenticated && user) {
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
        const error = await response.json();
        throw new Error(error.error || "Failed to initiate login");
      }

      const { authUrl } = await response.json();

      // Redirect to Google OAuth
      window.location.href = authUrl;
    } catch (error) {
      console.error("Login failed:", error);
      dispatch({
        type: "AUTH_ERROR",
        error: error instanceof Error ? error.message : "Login failed",
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
      refreshSession();
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
      refreshSession();
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
      return "Authentication is currently disabled";
    case "oauth_access_denied":
      return "Authentication was cancelled";
    case "oauth_invalid_request":
      return "Invalid authentication request";
    case "unauthorized":
      return reason || "You are not authorized to access this application";
    case "rate_limit":
      return "Too many authentication attempts. Please try again later.";
    case "invalid_callback":
      return "Invalid authentication response";
    case "missing_oauth_data":
      return "Authentication data missing. Please try again.";
    case "invalid_state":
      return "Authentication security check failed. Please try again.";
    case "callback_failed":
      return "Authentication failed. Please try again.";
    case "id_token_verification_failed":
      return "Failed to verify authentication token. Please try again.";
    default:
      return "An error occurred during authentication";
  }
}
