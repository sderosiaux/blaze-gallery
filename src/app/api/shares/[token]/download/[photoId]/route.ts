import { NextRequest, NextResponse } from 'next/server';
import { logShareAccess } from '@/lib/database';
import { getObjectStreamAuto } from '@/lib/s3';
import { validateSharedPhotoAccess } from '@/lib/shareHelpers';

interface RouteParams {
  params: { token: string; photoId: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { token, photoId } = params;

    // Validate shared photo access (requires download permission)
    const validation = await validateSharedPhotoAccess(request, token, photoId, true);
    if (validation.error) {
      return validation.error;
    }
    
    const { share, photo } = validation;

    // Log download access
    await logShareAccess(share.id, {
      ip_address: request.ip || request.headers.get('x-forwarded-for') || 'unknown',
      user_agent: request.headers.get('user-agent') || 'unknown',
      access_type: 'download',
      success: true
    });

    // Get the photo from S3 using existing infrastructure - S3 client auto-initializes
    try {
      const stream = await getObjectStreamAuto(
        photo.s3_key,
        request
      );
      
      // Convert the stream to buffer using the same pattern as existing code
      const chunks: Uint8Array[] = [];
      const readableStream = stream as any;
      
      for await (const chunk of readableStream) {
        chunks.push(chunk);
      }
      
      const buffer = Buffer.concat(chunks);
      const response = new NextResponse(buffer);
      
      // Set appropriate headers
      response.headers.set('Content-Type', photo.mime_type);
      response.headers.set('Content-Disposition', `attachment; filename="${photo.filename}"`);
      response.headers.set('Cache-Control', 'private, max-age=3600');
      response.headers.set('Content-Length', buffer.length.toString());

      return response;

    } catch (s3Error) {
      console.error('[API] S3 error downloading shared photo:', s3Error);
      return NextResponse.json(
        { error: 'Failed to download photo from storage' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('[API] Error downloading shared photo:', error);
    return NextResponse.json(
      { error: 'Failed to download photo' },
      { status: 500 }
    );
  }
}