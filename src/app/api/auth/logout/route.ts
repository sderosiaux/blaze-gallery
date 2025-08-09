import { NextRequest, NextResponse } from 'next/server';
import { revokeUserSession } from '@/lib/auth/userSession';
import { revokeGoogleTokens } from '@/lib/auth/googleOAuth';
import { validateOrigin } from '@/lib/auth/validators';

// Force dynamic rendering for auth routes
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Validate origin for CSRF protection
    if (!validateOrigin(request)) {
      return NextResponse.json(
        { error: 'Invalid origin' },
        { status: 403 }
      );
    }

    // Get session cookie
    const sessionCookie = request.cookies.get('auth_session')?.value;
    
    if (sessionCookie) {
      // Revoke the session
      revokeUserSession(sessionCookie);
    }

    // Parse request body for Google token revocation (optional)
    try {
      const body = await request.json();
      if (body.accessToken) {
        await revokeGoogleTokens(body.accessToken);
      }
    } catch {
      // Ignore JSON parsing errors - token revocation is optional
    }

    // Create response and clear session cookie
    const response = NextResponse.json({
      success: true,
      message: 'Logged out successfully'
    });
    
    response.cookies.delete('auth_session');
    
    // Also clear any OAuth cookies that might still exist
    response.cookies.delete('oauth_state');
    response.cookies.delete('oauth_code_verifier');

    return response;

  } catch (error) {
    console.error('Error during logout:', error);
    return NextResponse.json(
      { error: 'Failed to logout' },
      { status: 500 }
    );
  }
}