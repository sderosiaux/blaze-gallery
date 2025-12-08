import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from "@/lib/auth/middleware";
import { query } from '@/lib/database';
import { logger } from '@/lib/logger';

// Force dynamic rendering for routes using auth
export const dynamic = 'force-dynamic';

export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    // Basic photo statistics
    const basicStatsResult = await query(`
      SELECT
        COUNT(*) as total_photos,
        SUM(size) as total_storage_bytes,
        AVG(size) as avg_photo_size_bytes,
        COUNT(DISTINCT folder_id) as total_folders_with_photos,
        SUM(CASE WHEN is_favorite = true THEN 1 ELSE 0 END) as total_favorites
      FROM photos
    `);
    const basicStats = basicStatsResult.rows[0] as {
      total_photos: number;
      total_storage_bytes: number;
      avg_photo_size_bytes: number;
      total_folders_with_photos: number;
      total_favorites: number;
    };

    // Most viewed folders (based on last_visited frequency)
    const mostViewedFoldersResult = await query(`
      SELECT
        f.name,
        f.path,
        f.photo_count,
        SUM(p.size) as total_size,
        f.last_visited,
        COUNT(p.id) as actual_photo_count,
        CASE
          WHEN f.last_visited IS NULL THEN 0
          ELSE EXTRACT(EPOCH FROM (NOW() - f.last_visited)) / 86400
        END as days_since_visited
      FROM folders f
      LEFT JOIN photos p ON f.id = p.folder_id
      WHERE f.photo_count > 0
      GROUP BY f.id, f.name, f.path, f.photo_count, f.last_visited
      ORDER BY
        CASE WHEN f.last_visited IS NULL THEN 1 ELSE 0 END,
        days_since_visited ASC
      LIMIT 10
    `);
    const mostViewedFolders = mostViewedFoldersResult.rows as Array<{
      name: string;
      path: string;
      photo_count: number;
      total_size: number;
      last_visited: string | null;
      actual_photo_count: number;
      days_since_visited: number;
    }>;

    // Largest folders by photo count
    const largestFoldersByCountResult = await query(`
      SELECT
        f.name,
        f.path,
        f.photo_count,
        SUM(p.size) as total_size,
        COUNT(p.id) as actual_photo_count
      FROM folders f
      LEFT JOIN photos p ON f.id = p.folder_id
      WHERE f.photo_count > 0
      GROUP BY f.id, f.name, f.path, f.photo_count
      ORDER BY f.photo_count DESC
      LIMIT 10
    `);
    const largestFoldersByCount = largestFoldersByCountResult.rows as Array<{
      name: string;
      path: string;
      photo_count: number;
      total_size: number;
      actual_photo_count: number;
    }>;

    // Largest folders by storage size
    const largestFoldersBySizeResult = await query(`
      SELECT
        f.name,
        f.path,
        f.photo_count,
        SUM(p.size) as total_size,
        SUM(p.size) as actual_total_size
      FROM folders f
      LEFT JOIN photos p ON f.id = p.folder_id
      WHERE f.photo_count > 0
      GROUP BY f.id, f.name, f.path, f.photo_count
      ORDER BY SUM(p.size) DESC
      LIMIT 10
    `);
    const largestFoldersBySize = largestFoldersBySizeResult.rows as Array<{
      name: string;
      path: string;
      photo_count: number;
      total_size: number;
      actual_total_size: number;
    }>;

    // File type distribution - using a subquery to handle the alias properly
    const fileTypeStatsResult = await query(`
      WITH file_extensions AS (
        SELECT
          LOWER(
            CASE
              WHEN filename ILIKE '%.jpg' THEN '.jpg'
              WHEN filename ILIKE '%.jpeg' THEN '.jpeg'
              WHEN filename ILIKE '%.png' THEN '.png'
              WHEN filename ILIKE '%.gif' THEN '.gif'
              WHEN filename ILIKE '%.bmp' THEN '.bmp'
              WHEN filename ILIKE '%.webp' THEN '.webp'
              WHEN filename ILIKE '%.tiff' THEN '.tiff'
              WHEN filename ILIKE '%.tif' THEN '.tif'
              WHEN filename ILIKE '%.nef' THEN '.nef'
              WHEN filename ILIKE '%.cr2' THEN '.cr2'
              WHEN filename ILIKE '%.cr3' THEN '.cr3'
              WHEN filename ILIKE '%.arw' THEN '.arw'
              WHEN filename ILIKE '%.dng' THEN '.dng'
              WHEN filename ILIKE '%.raf' THEN '.raf'
              WHEN filename ILIKE '%.orf' THEN '.orf'
              WHEN filename ILIKE '%.rw2' THEN '.rw2'
              WHEN filename ILIKE '%.pef' THEN '.pef'
              WHEN filename ILIKE '%.srw' THEN '.srw'
              WHEN filename ILIKE '%.x3f' THEN '.x3f'
              WHEN filename ILIKE '%.heic' THEN '.heic'
              WHEN filename ILIKE '%.avif' THEN '.avif'
              ELSE 'other'
            END
          ) as file_extension,
          size
        FROM photos
      )
      SELECT
        file_extension,
        COUNT(*) as count,
        SUM(size) as total_size_bytes,
        AVG(size) as avg_size_bytes
      FROM file_extensions
      WHERE file_extension != 'other'
      GROUP BY file_extension
      HAVING COUNT(*) > 0
      ORDER BY COUNT(*) DESC
    `);
    const fileTypeStats = fileTypeStatsResult.rows as Array<{
      file_extension: string;
      count: number;
      total_size_bytes: number;
      avg_size_bytes: number;
    }>;

    // Recently added photos (last 30 days)
    const recentPhotosResult = await query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as photos_added,
        SUM(size) as bytes_added
      FROM photos
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);
    const recentPhotos = recentPhotosResult.rows as Array<{
      date: string;
      photos_added: number;
      bytes_added: number;
    }>;

    // EXIF metadata insights
    const exifStatsResult = await query(`
      SELECT
        COUNT(CASE WHEN metadata IS NOT NULL THEN 1 END) as photos_with_metadata,
        COUNT(CASE WHEN metadata->>'camera' IS NOT NULL AND metadata->'camera'->>'make' IS NOT NULL THEN 1 END) as photos_with_camera_info,
        COUNT(CASE WHEN metadata->>'date_taken' IS NOT NULL THEN 1 END) as photos_with_date_taken,
        COUNT(CASE WHEN metadata->>'location' IS NOT NULL THEN 1 END) as photos_with_location
      FROM photos
    `);
    const exifStats = exifStatsResult.rows[0] as {
      photos_with_metadata: number;
      photos_with_camera_info: number;
      photos_with_date_taken: number;
      photos_with_location: number;
    };

    // Top cameras used
    const topCamerasResult = await query(`
      SELECT
        (metadata->'camera'->>'make') || ' ' || (metadata->'camera'->>'model') as camera,
        COUNT(*) as photo_count
      FROM photos
      WHERE metadata->'camera'->>'make' IS NOT NULL
      GROUP BY camera
      ORDER BY photo_count DESC
      LIMIT 10
    `);
    const topCameras = topCamerasResult.rows as Array<{
      camera: string;
      photo_count: number;
    }>;

    // Sync health statistics
    const syncStatsResult = await query(`
      SELECT
        COUNT(*) as total_folders,
        COUNT(CASE WHEN last_synced IS NOT NULL THEN 1 END) as synced_folders,
        COUNT(CASE WHEN last_synced >= NOW() - INTERVAL '1 day' THEN 1 END) as recently_synced,
        COUNT(CASE WHEN last_synced < NOW() - INTERVAL '7 days' OR last_synced IS NULL THEN 1 END) as stale_folders
      FROM folders
    `);
    const syncStats = syncStatsResult.rows[0] as {
      total_folders: number;
      synced_folders: number;
      recently_synced: number;
      stale_folders: number;
    };

    // Video statistics
    const videoStatsResult = await query(`
      SELECT
        COUNT(*) as total_videos,
        SUM(size) as total_size_bytes,
        AVG(size) as avg_size_bytes,
        MIN(size) as min_size_bytes,
        MAX(size) as max_size_bytes
      FROM photos
      WHERE mime_type LIKE 'video/%'
    `);
    const videoStats = videoStatsResult.rows[0] as {
      total_videos: number;
      total_size_bytes: number;
      avg_size_bytes: number;
      min_size_bytes: number;
      max_size_bytes: number;
    };

    // Video format distribution
    const videoFormatsResult = await query(`
      SELECT
        LOWER(SUBSTRING(filename FROM '\\.([^.]+)$')) as format,
        COUNT(*) as count,
        SUM(size) as total_size_bytes
      FROM photos
      WHERE mime_type LIKE 'video/%'
      GROUP BY format
      ORDER BY count DESC
    `);
    const videoFormats = videoFormatsResult.rows as Array<{
      format: string;
      count: number;
      total_size_bytes: number;
    }>;

    // Largest videos
    const largestVideosResult = await query(`
      SELECT
        p.filename,
        p.size,
        p.mime_type,
        f.path as folder_path
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.mime_type LIKE 'video/%'
      ORDER BY p.size DESC
      LIMIT 10
    `);
    const largestVideos = largestVideosResult.rows as Array<{
      filename: string;
      size: number;
      mime_type: string;
      folder_path: string;
    }>;

    // Folders with most videos
    const foldersWithMostVideosResult = await query(`
      SELECT
        f.name,
        f.path,
        COUNT(p.id) as video_count,
        SUM(p.size) as total_size_bytes
      FROM folders f
      JOIN photos p ON f.id = p.folder_id
      WHERE p.mime_type LIKE 'video/%'
      GROUP BY f.id, f.name, f.path
      ORDER BY video_count DESC
      LIMIT 10
    `);
    const foldersWithMostVideos = foldersWithMostVideosResult.rows as Array<{
      name: string;
      path: string;
      video_count: number;
      total_size_bytes: number;
    }>;

    return NextResponse.json({
      success: true,
      data: {
        basic: basicStats,
        most_viewed_folders: mostViewedFolders,
        largest_folders_by_count: largestFoldersByCount,
        largest_folders_by_size: largestFoldersBySize,
        file_types: fileTypeStats,
        recent_activity: recentPhotos,
        metadata: exifStats,
        top_cameras: topCameras,
        sync_health: syncStats,
        videos: {
          stats: videoStats,
          formats: videoFormats,
          largest: largestVideos,
          folders_with_most: foldersWithMostVideos
        }
      }
    });

  } catch (error) {
    logger.apiError('Error in GET /api/stats', error as Error, {
      method: 'GET',
      path: '/api/stats'
    });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});