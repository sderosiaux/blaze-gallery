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

// In-memory cache for view rate limiting
// In production, you'd want to use Redis or a database table
const viewRateCache = new Map<string, number>();

// Cache cleanup interval (run every hour to remove old entries)
const CACHE_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
let cleanupInterval: NodeJS.Timeout | null = null;

// Initialize cache cleanup
function initializeViewRateCleanup() {
  if (cleanupInterval) return;
  
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, timestamp] of viewRateCache.entries()) {
      // Remove entries older than 1 hour
      if (now - timestamp > 60 * 60 * 1000) {
        viewRateCache.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[VIEW_RATE] Cleaned up ${cleanedCount} expired view rate entries`);
    }
  }, CACHE_CLEANUP_INTERVAL);
}

/**
 * Check if a view should be counted based on IP and share token rate limiting
 * Returns true if the view should be counted (not seen this IP+token combo in the last hour)
 */
export function shouldCountView(request: NextRequest, token: string): boolean {
  // Initialize cleanup on first use
  initializeViewRateCleanup();
  
  const ip = request.ip || request.headers.get('x-forwarded-for') || 'unknown';
  const cacheKey = `${token}:${ip}`;
  const now = Date.now();
  const lastViewed = viewRateCache.get(cacheKey);
  
  // If no previous view or last view was more than 1 hour ago, count it
  if (!lastViewed || now - lastViewed > 60 * 60 * 1000) {
    viewRateCache.set(cacheKey, now);
    return true;
  }
  
  return false;
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