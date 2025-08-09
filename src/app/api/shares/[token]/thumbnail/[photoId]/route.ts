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
    
    console.log(`[SHARED_THUMBNAIL] Request for token=${token}, photoId=${photoId}`);

    // Validate shared thumbnail access (allows password-protected shares)
    const validation = await validateSharedThumbnailAccess(request, token, photoId);
    if (validation.error) {
      console.log(`[SHARED_THUMBNAIL] Validation failed:`, validation.error);
      return validation.error;
    }
    
    const { photo } = validation;

    console.log(`[SHARED_THUMBNAIL] Using common serveThumbnail for photo ${photo.id}`);
    
    // Use the common thumbnail serving logic
    const result = await thumbnailService.serveThumbnail(photo, request, false);
    
    if ('error' in result) {
      console.log(`[SHARED_THUMBNAIL] serveThumbnail returned error:`, result.error);
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    console.log(`[SHARED_THUMBNAIL] serveThumbnail success, buffer size:`, result.buffer.length);
    
    // Override cache control for shared content (shorter than regular thumbnails)
    const sharedHeaders = {
      ...result.headers,
      "Cache-Control": "private, max-age=86400", // 24 hours for shared content
    };
    
    return new NextResponse(result.buffer as any, {
      headers: sharedHeaders,
    });

  } catch (error) {
    console.error('[API] Error serving shared thumbnail:', error);
    return NextResponse.json(
      { error: 'Failed to serve thumbnail' },
      { status: 500 }
    );
  }
}