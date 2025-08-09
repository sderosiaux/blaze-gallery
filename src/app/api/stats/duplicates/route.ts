import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { logger } from '@/lib/logger';

interface DuplicateGroup {
  filename: string;
  count: number;
  photos: {
    id: number;
    s3_key: string;
    size: number;
    folder_path: string;
    created_at: string;
  }[];
}

export async function GET() {
  try {
    const db = getDatabase();
    
    // Find photos with duplicate filenames
    const duplicatePhotos = db.prepare(`
      SELECT 
        p.id,
        p.filename,
        p.s3_key,
        p.size,
        p.created_at,
        f.path as folder_path
      FROM photos p
      JOIN folders f ON p.folder_id = f.id
      WHERE p.filename IN (
        SELECT filename 
        FROM photos 
        GROUP BY filename 
        HAVING COUNT(*) > 1
      )
      ORDER BY p.filename, p.created_at
    `).all() as {
      id: number;
      filename: string;
      s3_key: string;
      size: number;
      created_at: string;
      folder_path: string;
    }[];

    // Group duplicates by filename
    const duplicateGroups: Record<string, DuplicateGroup> = {};
    
    for (const photo of duplicatePhotos) {
      if (!duplicateGroups[photo.filename]) {
        duplicateGroups[photo.filename] = {
          filename: photo.filename,
          count: 0,
          photos: []
        };
      }
      
      duplicateGroups[photo.filename].photos.push({
        id: photo.id,
        s3_key: photo.s3_key,
        size: photo.size,
        folder_path: photo.folder_path,
        created_at: photo.created_at
      });
      duplicateGroups[photo.filename].count++;
    }

    // Convert to array and sort by count (most duplicates first)
    const sortedGroups = Object.values(duplicateGroups)
      .sort((a, b) => b.count - a.count);

    // Calculate summary stats
    const totalDuplicateFiles = sortedGroups.length;
    const totalDuplicatePhotos = duplicatePhotos.length;
    const potentialSpaceSaved = sortedGroups.reduce((total, group) => {
      // Calculate space that could be saved by keeping only one copy of each duplicate
      const largestSize = Math.max(...group.photos.map(p => p.size));
      const otherSizes = group.photos.map(p => p.size).slice(1); // Remove one copy
      return total + otherSizes.reduce((sum, size) => sum + size, 0);
    }, 0);

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          total_duplicate_filenames: totalDuplicateFiles,
          total_duplicate_photos: totalDuplicatePhotos,
          potential_space_saved_bytes: potentialSpaceSaved
        },
        duplicates: sortedGroups
      }
    });

  } catch (error) {
    logger.apiError('Error in GET /api/stats/duplicates', error as Error, {
      method: 'GET',
      path: '/api/stats/duplicates'
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