import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const db = getDatabase();
    
    // Basic photo statistics
    const basicStats = db.prepare(`
      SELECT 
        COUNT(*) as total_photos,
        SUM(size) as total_storage_bytes,
        AVG(size) as avg_photo_size_bytes,
        COUNT(DISTINCT folder_id) as total_folders_with_photos,
        SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) as total_favorites
      FROM photos
    `).get() as {
      total_photos: number;
      total_storage_bytes: number;
      avg_photo_size_bytes: number;
      total_folders_with_photos: number;
      total_favorites: number;
    };

    // Most viewed folders (based on last_visited frequency)
    const mostViewedFolders = db.prepare(`
      SELECT 
        f.name,
        f.path,
        f.photo_count,
        SUM(p.size) as total_size,
        f.last_visited,
        COUNT(p.id) as actual_photo_count,
        CASE 
          WHEN f.last_visited IS NULL THEN 0
          ELSE julianday('now') - julianday(f.last_visited)
        END as days_since_visited
      FROM folders f
      LEFT JOIN photos p ON f.id = p.folder_id
      WHERE f.photo_count > 0
      GROUP BY f.id
      ORDER BY 
        CASE WHEN f.last_visited IS NULL THEN 1 ELSE 0 END,
        days_since_visited ASC
      LIMIT 10
    `).all() as Array<{
      name: string;
      path: string;
      photo_count: number;
      total_size: number;
      last_visited: string | null;
      actual_photo_count: number;
      days_since_visited: number;
    }>;

    // Largest folders by photo count
    const largestFoldersByCount = db.prepare(`
      SELECT 
        f.name,
        f.path,
        f.photo_count,
        SUM(p.size) as total_size,
        COUNT(p.id) as actual_photo_count
      FROM folders f
      LEFT JOIN photos p ON f.id = p.folder_id
      WHERE f.photo_count > 0
      GROUP BY f.id
      ORDER BY f.photo_count DESC
      LIMIT 10
    `).all() as Array<{
      name: string;
      path: string;
      photo_count: number;
      total_size: number;
      actual_photo_count: number;
    }>;

    // Largest folders by storage size
    const largestFoldersBySize = db.prepare(`
      SELECT 
        f.name,
        f.path,
        f.photo_count,
        SUM(p.size) as total_size,
        SUM(p.size) as actual_total_size
      FROM folders f
      LEFT JOIN photos p ON f.id = p.folder_id
      WHERE f.photo_count > 0
      GROUP BY f.id
      ORDER BY SUM(p.size) DESC
      LIMIT 10
    `).all() as Array<{
      name: string;
      path: string;
      photo_count: number;
      total_size: number;
      actual_total_size: number;
    }>;

    // File type distribution - simple approach that works reliably
    const fileTypeStats = db.prepare(`
      SELECT 
        LOWER(
          CASE 
            WHEN filename LIKE '%.jpg' THEN '.jpg'
            WHEN filename LIKE '%.jpeg' THEN '.jpeg'
            WHEN filename LIKE '%.png' THEN '.png'
            WHEN filename LIKE '%.gif' THEN '.gif'
            WHEN filename LIKE '%.bmp' THEN '.bmp'
            WHEN filename LIKE '%.webp' THEN '.webp'
            WHEN filename LIKE '%.tiff' THEN '.tiff'
            WHEN filename LIKE '%.tif' THEN '.tif'
            WHEN filename LIKE '%.nef' THEN '.nef'
            WHEN filename LIKE '%.cr2' THEN '.cr2'
            WHEN filename LIKE '%.cr3' THEN '.cr3'
            WHEN filename LIKE '%.arw' THEN '.arw'
            WHEN filename LIKE '%.dng' THEN '.dng'
            WHEN filename LIKE '%.raf' THEN '.raf'
            WHEN filename LIKE '%.orf' THEN '.orf'
            WHEN filename LIKE '%.rw2' THEN '.rw2'
            WHEN filename LIKE '%.pef' THEN '.pef'
            WHEN filename LIKE '%.srw' THEN '.srw'
            WHEN filename LIKE '%.x3f' THEN '.x3f'
            WHEN filename LIKE '%.heic' THEN '.heic'
            WHEN filename LIKE '%.avif' THEN '.avif'
            ELSE 'other'
          END
        ) as file_extension,
        COUNT(*) as count,
        SUM(size) as total_size_bytes,
        AVG(size) as avg_size_bytes
      FROM photos
      GROUP BY file_extension
      HAVING count > 0 AND file_extension != 'other'
      ORDER BY count DESC
    `).all() as Array<{
      file_extension: string;
      count: number;
      total_size_bytes: number;
      avg_size_bytes: number;
    }>;

    // Recently added photos (last 30 days)
    const recentPhotos = db.prepare(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as photos_added,
        SUM(size) as bytes_added
      FROM photos
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `).all() as Array<{
      date: string;
      photos_added: number;
      bytes_added: number;
    }>;

    // EXIF metadata insights
    const exifStats = db.prepare(`
      SELECT 
        COUNT(CASE WHEN metadata IS NOT NULL THEN 1 END) as photos_with_metadata,
        COUNT(CASE WHEN json_extract(metadata, '$.camera.make') IS NOT NULL THEN 1 END) as photos_with_camera_info,
        COUNT(CASE WHEN json_extract(metadata, '$.date_taken') IS NOT NULL THEN 1 END) as photos_with_date_taken,
        COUNT(CASE WHEN json_extract(metadata, '$.location') IS NOT NULL THEN 1 END) as photos_with_location
      FROM photos
    `).get() as {
      photos_with_metadata: number;
      photos_with_camera_info: number;
      photos_with_date_taken: number;
      photos_with_location: number;
    };

    // Top cameras used
    const topCameras = db.prepare(`
      SELECT 
        json_extract(metadata, '$.camera.make') || ' ' || json_extract(metadata, '$.camera.model') as camera,
        COUNT(*) as photo_count
      FROM photos
      WHERE json_extract(metadata, '$.camera.make') IS NOT NULL
      GROUP BY camera
      ORDER BY photo_count DESC
      LIMIT 10
    `).all() as Array<{
      camera: string;
      photo_count: number;
    }>;

    // Sync health statistics
    const syncStats = db.prepare(`
      SELECT 
        COUNT(*) as total_folders,
        COUNT(CASE WHEN last_synced IS NOT NULL THEN 1 END) as synced_folders,
        COUNT(CASE WHEN last_synced >= datetime('now', '-1 day') THEN 1 END) as recently_synced,
        COUNT(CASE WHEN last_synced < datetime('now', '-7 days') OR last_synced IS NULL THEN 1 END) as stale_folders
      FROM folders
    `).get() as {
      total_folders: number;
      synced_folders: number;
      recently_synced: number;
      stale_folders: number;
    };

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
        generated_at: new Date().toISOString()
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
}