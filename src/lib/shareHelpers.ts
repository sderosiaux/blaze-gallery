import { NextRequest, NextResponse } from 'next/server';
import { 
  getSharedFolder, 
  validateSharePassword, 
  getPhoto
} from '@/lib/database';

export interface ShareValidationResult {
  share: any;
  photo: any;
  error?: NextResponse;
}



/**
 * Common validation logic for shared photo endpoints
 * Handles share validation, password checking, and photo verification
 */
export async function validateSharedPhotoAccess(
  request: NextRequest,
  token: string,
  photoId: string,
  requireDownloadPermission = false
): Promise<ShareValidationResult> {
  const searchParams = request.nextUrl.searchParams;
  const password = searchParams.get('password');

  // Get the shared folder
  const share = await getSharedFolder(token);
  
  if (!share) {
    return {
      share: null,
      photo: null,
      error: NextResponse.json(
        { error: 'Share not found or expired' },
        { status: 404 }
      )
    };
  }

  // Check download permission if required
  if (requireDownloadPermission && !share.allow_download) {
    return {
      share,
      photo: null,
      error: NextResponse.json(
        { error: 'Downloads not allowed for this share' },
        { status: 403 }
      )
    };
  }

  // Check password if required
  if (share.password_hash) {
    if (!password) {
      return {
        share,
        photo: null,
        error: NextResponse.json(
          { error: 'Password required' },
          { status: 401 }
        )
      };
    }

    const isValidPassword = await validateSharePassword(token, password);
    if (!isValidPassword) {
      return {
        share,
        photo: null,
        error: NextResponse.json(
          { error: 'Invalid password' },
          { status: 401 }
        )
      };
    }
  }

  // Get the photo and verify it belongs to the shared folder
  const photo = await getPhoto(parseInt(photoId));
  if (!photo) {
    return {
      share,
      photo: null,
      error: NextResponse.json(
        { error: 'Photo not found' },
        { status: 404 }
      )
    };
  }

  // Verify the photo is in the shared folder
  if (!photo.s3_key.startsWith(share.folder_path)) {
    return {
      share,
      photo,
      error: NextResponse.json(
        { error: 'Photo not accessible through this share' },
        { status: 403 }
      )
    };
  }

  return { share, photo };
}