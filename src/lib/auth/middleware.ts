import { NextRequest, NextResponse } from "next/server";
import { validateUserSession } from "./userSession";
import { authConfig } from "./config";

export interface AuthenticatedRequest extends NextRequest {
  user?: {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };
}

/**
 * Middleware to protect routes with authentication
 */
export function withAuth(
  handler: (req: AuthenticatedRequest) => Promise<NextResponse> | NextResponse,
  options: {
    required?: boolean;
    adminOnly?: boolean;
  } = { required: true },
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      // If authentication is disabled, allow all requests
      if (!authConfig.enabled) {
        return handler(request as AuthenticatedRequest);
      }

      // Get session cookie
      const sessionCookie = request.cookies.get("auth_session")?.value;

      if (!sessionCookie) {
        if (options.required) {
          return NextResponse.json(
            { error: "Authentication required" },
            { status: 401 },
          );
        }
        return handler(request as AuthenticatedRequest);
      }

      // Validate session from database
      const session = await validateUserSession(sessionCookie);

      if (!session) {
        if (options.required) {
          const response = NextResponse.json(
            { error: "Invalid or expired session" },
            { status: 401 },
          );
          response.cookies.delete("auth_session");
          return response;
        }
        return handler(request as AuthenticatedRequest);
      }

      // Add user info to request
      const authenticatedRequest = request as AuthenticatedRequest;
      authenticatedRequest.user = {
        id: session.id,
        email: session.email,
        name: session.name,
        picture: session.picture,
      };

      return handler(authenticatedRequest);
    } catch (error) {
      console.error("Auth middleware error:", error);
      return NextResponse.json(
        { error: "Authentication error" },
        { status: 500 },
      );
    }
  };
}

/**
 * Check if user is authenticated (for client-side use)
 */
export async function checkAuth(request: NextRequest): Promise<{
  isAuthenticated: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };
}> {
  // If authentication is disabled, return not authenticated
  if (!authConfig.enabled) {
    return { isAuthenticated: false };
  }

  const sessionCookie = request.cookies.get("auth_session")?.value;

  if (!sessionCookie) {
    return { isAuthenticated: false };
  }

  const session = await validateUserSession(sessionCookie);

  if (!session) {
    return { isAuthenticated: false };
  }

  return {
    isAuthenticated: true,
    user: {
      id: session.id,
      email: session.email,
      name: session.name,
      picture: session.picture,
    },
  };
}

/**
 * Require authentication for an API route
 */
export function requireAuth<T extends any[]>(
  handler: (
    req: AuthenticatedRequest,
    ...args: T
  ) => Promise<NextResponse> | NextResponse,
) {
  return (req: NextRequest, ...args: T) => {
    return withAuth(
      (authReq: AuthenticatedRequest) => handler(authReq, ...args),
      { required: true },
    )(req);
  };
}

/**
 * Optional authentication for an API route
 */
export function optionalAuth<T extends any[]>(
  handler: (
    req: AuthenticatedRequest,
    ...args: T
  ) => Promise<NextResponse> | NextResponse,
) {
  return (req: NextRequest, ...args: T) => {
    return withAuth(
      (authReq: AuthenticatedRequest) => handler(authReq, ...args),
      { required: false },
    )(req);
  };
}
