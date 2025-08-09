import { NextRequest, NextResponse } from 'next/server';
import { 
  getSharedFolder, 
  validateSharePassword, 
  logShareAccess,
  getPhoto
} from '@/lib/database';
import { getObjectStream, initializeS3Client } from '@/lib/s3';
import { getConfig } from '@/lib/config';

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

    // Check if downloads are allowed
    if (!share.allow_download) {
      return NextResponse.json(
        { error: 'Downloads not allowed for this share' },
        { status: 403 }
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

    // Log download access
    await logShareAccess(share.id, {
      ip_address: request.ip || request.headers.get('x-forwarded-for') || 'unknown',
      user_agent: request.headers.get('user-agent') || 'unknown',
      access_type: 'download',
      success: true
    });

    // Initialize S3 client
    const config = await getConfig();
    initializeS3Client({
      endpoint: config.backblaze_endpoint,
      bucket: config.backblaze_bucket,
      accessKeyId: config.backblaze_access_key,
      secretAccessKey: config.backblaze_secret_key,
    });

    // Get the photo from S3 using existing infrastructure
    try {
      const stream = await getObjectStream(
        config.backblaze_bucket,
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