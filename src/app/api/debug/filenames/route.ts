import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';

export async function GET() {
  try {
    const db = getDatabase();
    
    // Get a sample of filenames to debug extension detection
    const filenames = db.prepare(`
      SELECT 
        filename,
        LOWER(filename) as lower_filename,
        CASE 
          WHEN LOWER(filename) LIKE '%.nef' THEN 'should_match_nef'
          WHEN LOWER(filename) LIKE '%.jpg' THEN 'should_match_jpg'
          WHEN LOWER(filename) LIKE '%.jpeg' THEN 'should_match_jpeg'
          ELSE 'other'
        END as test_match
      FROM photos 
      WHERE filename LIKE '%.NEF' OR filename LIKE '%.nef' OR filename LIKE '%.Nef'
         OR filename LIKE '%.JPG' OR filename LIKE '%.jpg' OR filename LIKE '%.Jpg'
      ORDER BY filename
      LIMIT 20
    `).all();

    // Also get the current stats query result for debugging
    const currentStats = db.prepare(`
      SELECT 
        LOWER(
          CASE 
            WHEN filename LIKE '%.jpg' THEN '.jpg'
            WHEN filename LIKE '%.jpeg' THEN '.jpeg'
            WHEN filename LIKE '%.png' THEN '.png'
            WHEN filename LIKE '%.nef' THEN '.nef'
            WHEN filename LIKE '%.cr2' THEN '.cr2'
            ELSE 'other'
          END
        ) as file_extension,
        COUNT(*) as count
      FROM photos
      GROUP BY file_extension
      ORDER BY count DESC
    `).all();
    
    return NextResponse.json({
      success: true,
      data: {
        sample_filenames: filenames,
        current_stats: currentStats,
        total_photos: db.prepare('SELECT COUNT(*) as count FROM photos').get()
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}