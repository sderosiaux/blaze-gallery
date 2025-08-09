import { NextRequest, NextResponse } from 'next/server';
import { thumbnailService } from '@/lib/thumbnails';
import { validateSharedThumbnailAccess } from '@/lib/shareHelpers';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { token: string; photoId: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { token, photoId } = params;

    // Validate shared thumbnail access (allows password-protected shares)
    const validation = await validateSharedThumbnailAccess(request, token, photoId);
    if (validation.error) {
      return validation.error;
    }
    
    const { photo } = validation;

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