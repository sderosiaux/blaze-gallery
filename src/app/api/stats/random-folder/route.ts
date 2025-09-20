import { NextResponse } from 'next/server';
import { requireAuth } from "@/lib/auth/middleware";
import { query } from '@/lib/database';
import { logger } from '@/lib/logger';

// Force dynamic rendering for routes using auth
export const dynamic = 'force-dynamic';

export const GET = requireAuth(async function GET() {
  try {
    // Get a random folder that contains photos
    const result = await query(`
      SELECT
        f.id,
        f.name,
        f.path,
        COUNT(p.id) as photo_count
      FROM folders f
      INNER JOIN photos p ON f.id = p.folder_id
      GROUP BY f.id, f.name, f.path
      HAVING COUNT(p.id) > 0
      ORDER BY RANDOM()
      LIMIT 1
    `);

    const randomFolder = result.rows[0] as {
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
});