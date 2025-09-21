import { NextResponse } from 'next/server';
import { query } from '@/lib/database';
import { logger } from '@/lib/logger';

interface IgnoredFilesStats {
  summary: {
    total_ignored_files: number;
    total_ignored_size_bytes: number;
    categories: {
      synology_thumbnails: number;
      system_files: number;
      small_files: number;
      eadir_folders: number;
    };
  };
  breakdown: {
    category: string;
    count: number;
    total_size_bytes: number;
    examples: string[];
  }[];
}

export async function GET() {
  try {
    // Get Synology thumbnails
    const synologyThumbsResult = await query(`
      SELECT COUNT(*) as count, SUM(p.size) as total_size
      FROM photos p
      WHERE p.filename LIKE 'SYNOPHOTO_THUMB_%'
    `);
    const synologyThumbs = synologyThumbsResult.rows[0] as { count: number; total_size: number | null };

    // Get system files
    const systemFilesResult = await query(`
      SELECT COUNT(*) as count, SUM(p.size) as total_size
      FROM photos p
      WHERE p.filename IN ('Thumbs.db', '.DS_Store')
         OR p.filename LIKE '.__%'
         OR p.filename LIKE 'desktop.ini'
    `);
    const systemFiles = systemFilesResult.rows[0] as { count: number; total_size: number | null };

    // Get small files (under 10KB)
    const smallFilesResult = await query(`
      SELECT COUNT(*) as count, SUM(p.size) as total_size
      FROM photos p
      JOIN folders f ON p.folder_id = f.id
      WHERE p.size <= 10240
        AND f.path NOT LIKE '%/@eaDir/%'
        AND f.path NOT LIKE '%@eaDir%'
        AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
        AND p.filename NOT IN ('Thumbs.db', '.DS_Store')
    `);
    const smallFiles = smallFilesResult.rows[0] as { count: number; total_size: number | null };

    // Get @eaDir folder files
    const eaDirFilesResult = await query(`
      SELECT COUNT(*) as count, SUM(p.size) as total_size
      FROM photos p
      JOIN folders f ON p.folder_id = f.id
      WHERE (f.path LIKE '%/@eaDir/%' OR f.path LIKE '%@eaDir%')
        AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
    `);
    const eaDirFiles = eaDirFilesResult.rows[0] as { count: number; total_size: number | null };

    // Get examples for each category
    const synologyExamplesResult = await query(`
      SELECT DISTINCT p.filename
      FROM photos p
      WHERE p.filename LIKE 'SYNOPHOTO_THUMB_%'
      LIMIT 3
    `);
    const synologyExamples = synologyExamplesResult.rows as { filename: string }[];

    const systemExamplesResult = await query(`
      SELECT DISTINCT p.filename
      FROM photos p
      WHERE p.filename IN ('Thumbs.db', '.DS_Store')
         OR p.filename LIKE '.__%'
         OR p.filename LIKE 'desktop.ini'
      LIMIT 3
    `);
    const systemExamples = systemExamplesResult.rows as { filename: string }[];

    const smallFileExamplesResult = await query(`
      SELECT DISTINCT p.filename
      FROM photos p
      JOIN folders f ON p.folder_id = f.id
      WHERE p.size <= 10240
        AND f.path NOT LIKE '%/@eaDir/%'
        AND f.path NOT LIKE '%@eaDir%'
        AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
        AND p.filename NOT IN ('Thumbs.db', '.DS_Store')
      LIMIT 3
    `);
    const smallFileExamples = smallFileExamplesResult.rows as { filename: string }[];

    const eaDirExamplesResult = await query(`
      SELECT DISTINCT f.path
      FROM photos p
      JOIN folders f ON p.folder_id = f.id
      WHERE (f.path LIKE '%/@eaDir/%' OR f.path LIKE '%@eaDir%')
        AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
      LIMIT 3
    `);
    const eaDirExamples = eaDirExamplesResult.rows as { path: string }[];

    // Ensure all values are proper numbers
    const synologyCount = Number(synologyThumbs.count) || 0;
    const systemCount = Number(systemFiles.count) || 0;
    const smallCount = Number(smallFiles.count) || 0;
    const eaDirCount = Number(eaDirFiles.count) || 0;

    const synologySize = Number(synologyThumbs.total_size) || 0;
    const systemSize = Number(systemFiles.total_size) || 0;
    const smallSize = Number(smallFiles.total_size) || 0;
    const eaDirSize = Number(eaDirFiles.total_size) || 0;

    const totalIgnored = synologyCount + systemCount + smallCount + eaDirCount;
    const totalIgnoredSize = synologySize + systemSize + smallSize + eaDirSize;

    const result: IgnoredFilesStats = {
      summary: {
        total_ignored_files: totalIgnored,
        total_ignored_size_bytes: totalIgnoredSize,
        categories: {
          synology_thumbnails: synologyCount,
          system_files: systemCount,
          small_files: smallCount,
          eadir_folders: eaDirCount,
        }
      },
      breakdown: [
        {
          category: 'Synology Thumbnails',
          count: synologyCount,
          total_size_bytes: synologySize,
          examples: synologyExamples.map(e => e.filename)
        },
        {
          category: 'System Files',
          count: systemCount,
          total_size_bytes: systemSize,
          examples: systemExamples.map(e => e.filename)
        },
        {
          category: 'Small Files (<10KB)',
          count: smallCount,
          total_size_bytes: smallSize,
          examples: smallFileExamples.map(e => e.filename)
        },
        {
          category: '@eaDir System Folders',
          count: eaDirCount,
          total_size_bytes: eaDirSize,
          examples: eaDirExamples.map(e => e.path)
        }
      ].filter(category => category.count > 0) // Only show categories with files
    };

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.apiError('Error in GET /api/stats/ignored-files', error as Error, {
      method: 'GET',
      path: '/api/stats/ignored-files'
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