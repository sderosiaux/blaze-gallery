import { NextRequest, NextResponse } from 'next/server';
import { 
  getSharedFolder, 
  validateSharePassword, 
  incrementShareViewCount,
  logShareAccess,
  getPhotosInFolder,
  getFolderByPath
} from '@/lib/database';
import { shouldCountView } from '@/lib/shareHelpers';
import { createShareSession, validateShareSession } from '@/lib/shareSession';

interface RouteParams {
  params: { token: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { token } = params;
    const searchParams = request.nextUrl.searchParams;
    const password = searchParams.get('password');

    // Get the shared folder
    const share = await getSharedFolder(token);
    
    if (!share) {
      return NextResponse.json(
        { error: 'Share not found or expired' },
        { status: 404 }
      );
    }

    // Check password if required
    if (share.password_hash) {
      if (!password) {
        return NextResponse.json(
          { error: 'Password required', requires_password: true },
          { status: 401 }
        );
      }

      const isValidPassword = await validateSharePassword(token, password);
      if (!isValidPassword) {
        // Log failed password attempt
        await logShareAccess(share.id, {
          ip_address: request.ip || request.headers.get('x-forwarded-for') || 'unknown',
          user_agent: request.headers.get('user-agent') || 'unknown',
          access_type: 'password_attempt',
          success: false
        });

        return NextResponse.json(
          { error: 'Invalid password' },
          { status: 401 }
        );
      }
    }

    // Get folder and photos
    const folder = await getFolderByPath(share.folder_path);
    if (!folder) {
      return NextResponse.json(
        { error: 'Shared folder no longer exists' },
        { status: 404 }
      );
    }

    const photos = await getPhotosInFolder(folder.id);

    // Increment view count with rate limiting (1 view per IP per hour)
    if (shouldCountView(request, token)) {
      await incrementShareViewCount(token);
    }
    await logShareAccess(share.id, {
      ip_address: request.ip || request.headers.get('x-forwarded-for') || 'unknown',
      user_agent: request.headers.get('user-agent') || 'unknown',
      access_type: 'view',
      success: true
    });

    // Return share details and photos (without sensitive info)
    const { password_hash, ...shareResponse } = share;
    
    return NextResponse.json({
      success: true,
      share: {
        ...shareResponse,
        has_password: !!password_hash
      },
      folder: {
        name: folder.name,
        path: folder.path,
        photo_count: photos.length
      },
      photos: photos
    });

  } catch (error) {
    console.error('[API] Error accessing shared folder:', error);
    return NextResponse.json(
      { error: 'Failed to access shared folder' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { token } = params;
    const body = await request.json();
    const { action, password } = body;

    if (action === 'validate_password') {
      const share = await getSharedFolder(token);
      
      if (!share) {
        return NextResponse.json(
          { error: 'Share not found or expired' },
          { status: 404 }
        );
      }

      if (!share.password_hash) {
        return NextResponse.json(
          { error: 'No password required for this share' },
          { status: 400 }
        );
      }

      const isValid = await validateSharePassword(token, password);
      
      // Log password attempt
      await logShareAccess(share.id, {
        ip_address: request.ip || request.headers.get('x-forwarded-for') || 'unknown',
        user_agent: request.headers.get('user-agent') || 'unknown',
        access_type: 'password_attempt',
        success: isValid
      });

      if (isValid) {
        // Create session token for authenticated access
        const sessionToken = createShareSession(token);
        
        // Get folder and photos for authenticated access
        const folder = await getFolderByPath(share.folder_path);
        if (!folder) {
          return NextResponse.json(
            { error: 'Shared folder no longer exists' },
            { status: 404 }
          );
        }

        const photos = await getPhotosInFolder(folder.id);

        // Return complete share data with session token
        const { password_hash, ...shareResponse } = share;
        
        return NextResponse.json({
          success: true,
          data: {
            session_token: sessionToken,
            share: {
              ...shareResponse,
              has_password: !!password_hash
            },
            folder: {
              name: folder.name,
              path: folder.path,
              photo_count: photos.length
            },
            photos: photos
          }
        });
      }

      return NextResponse.json({
        success: false,
        error: 'Invalid password'
      }, { status: 401 });
    }

    if (action === 'validate_session') {
      const sessionToken = request.headers.get('x-share-session');
      
      if (!sessionToken) {
        return NextResponse.json(
          { error: 'Session token required' },
          { status: 401 }
        );
      }

      const validatedShareToken = validateShareSession(sessionToken);
      if (!validatedShareToken || validatedShareToken !== token) {
        return NextResponse.json(
          { error: 'Invalid or expired session' },
          { status: 401 }
        );
      }

      // Session is valid, return share data
      const share = await getSharedFolder(token);
      if (!share) {
        return NextResponse.json(
          { error: 'Share not found or expired' },
          { status: 404 }
        );
      }

      const folder = await getFolderByPath(share.folder_path);
      if (!folder) {
        return NextResponse.json(
          { error: 'Shared folder no longer exists' },
          { status: 404 }
        );
      }

      const photos = await getPhotosInFolder(folder.id);

      const { password_hash, ...shareResponse } = share;
      
      return NextResponse.json({
        success: true,
        data: {
          share: {
            ...shareResponse,
            has_password: !!password_hash
          },
          folder: {
            name: folder.name,
            path: folder.path,
            photo_count: photos.length
          },
          photos: photos
        }
      });
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );

  } catch (error) {
    console.error('[API] Error validating share password:', error);
    return NextResponse.json(
      { error: 'Failed to validate password' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { token } = params;

    const share = await getSharedFolder(token);
    
    if (!share) {
      return NextResponse.json(
        { error: 'Share not found' },
        { status: 404 }
      );
    }

    // Deactivate the share instead of deleting it (for audit purposes)
    const { deactivateShare } = await import('@/lib/database');
    await deactivateShare(token);

    return NextResponse.json({
      success: true,
      message: 'Share deactivated successfully'
    });

  } catch (error) {
    console.error('[API] Error deactivating share:', error);
    return NextResponse.json(
      { error: 'Failed to deactivate share' },
      { status: 500 }
    );
  }
}