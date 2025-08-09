import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const db = getDatabase();
    
    // Get a random folder that contains photos
    const randomFolder = db.prepare(`
      SELECT 
        f.id,
        f.name,
        f.path,
        COUNT(p.id) as photo_count
      FROM folders f
      INNER JOIN photos p ON f.id = p.folder_id
      GROUP BY f.id, f.name, f.path
      HAVING photo_count > 0
      ORDER BY RANDOM()
      LIMIT 1
    `).get() as {
      id: number;
      name: string;
      path: string;
      photo_count: number;
    } | undefined;

    if (!randomFolder) {
      return NextResponse.json(
        {
          success: false,
          error: 'No folders with photos found'
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: randomFolder.id,
        name: randomFolder.name,
        path: randomFolder.path,
        photo_count: randomFolder.photo_count
      }
    });

  } catch (error) {
    logger.apiError('Error in GET /api/stats/random-folder', error as Error, {
      method: 'GET',
      path: '/api/stats/random-folder'
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