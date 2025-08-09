import { NextRequest, NextResponse } from 'next/server';
import { 
  getSharedFolder, 
  validateSharePassword, 
  getPhoto
} from '@/lib/database';
import { thumbnailService } from '@/lib/thumbnails';

interface RouteParams {
  params: { token: string; photoId: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { token, photoId } = params;
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
          { error: 'Password required' },
          { status: 401 }
        );
      }

      const isValidPassword = await validateSharePassword(token, password);
      if (!isValidPassword) {
        return NextResponse.json(
          { error: 'Invalid password' },
          { status: 401 }
        );
      }
    }

    // Get the photo and verify it belongs to the shared folder
    const photo = await getPhoto(parseInt(photoId));
    if (!photo) {
      return NextResponse.json(
        { error: 'Photo not found' },
        { status: 404 }
      );
    }

    // Verify the photo is in the shared folder
    if (!photo.s3_key.startsWith(share.folder_path)) {
      return NextResponse.json(
        { error: 'Photo not accessible through this share' },
        { status: 403 }
      );
    }

    // Get the thumbnail using the same service as the regular endpoint
    if (photo.thumbnail_path) {
      const thumbnailBuffer = await thumbnailService.getThumbnailBuffer(
        photo.thumbnail_path
      );

      if (thumbnailBuffer) {
        return new NextResponse(thumbnailBuffer as any, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "private, max-age=86400", // 24 hours for shared content
            "Content-Length": thumbnailBuffer.length.toString(),
          },
        });
      }
    }

    // If no thumbnail exists, return error
    return NextResponse.json(
      { error: 'Thumbnail not available' },
      { status: 404 }
    );

  } catch (error) {
    console.error('[API] Error serving shared thumbnail:', error);
    return NextResponse.json(
      { error: 'Failed to serve thumbnail' },
      { status: 500 }
    );
  }
}