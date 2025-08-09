import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
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
    const db = getDatabase();
    
    // Get Synology thumbnails
    const synologyThumbs = db.prepare(`
      SELECT COUNT(*) as count, SUM(p.size) as total_size
      FROM photos p
      WHERE p.filename LIKE 'SYNOPHOTO_THUMB_%'
    `).get() as { count: number; total_size: number | null };

    // Get system files
    const systemFiles = db.prepare(`
      SELECT COUNT(*) as count, SUM(p.size) as total_size
      FROM photos p
      WHERE p.filename IN ('Thumbs.db', '.DS_Store')
         OR p.filename LIKE '.__%'
         OR p.filename LIKE 'desktop.ini'
    `).get() as { count: number; total_size: number | null };

    // Get small files (under 10KB)
    const smallFiles = db.prepare(`
      SELECT COUNT(*) as count, SUM(p.size) as total_size
      FROM photos p
      JOIN folders f ON p.folder_id = f.id
      WHERE p.size <= 10240
        AND f.path NOT LIKE '%/@eaDir/%'
        AND f.path NOT LIKE '%@eaDir%'
        AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
        AND p.filename NOT IN ('Thumbs.db', '.DS_Store')
    `).get() as { count: number; total_size: number | null };

    // Get @eaDir folder files
    const eaDirFiles = db.prepare(`
      SELECT COUNT(*) as count, SUM(p.size) as total_size
      FROM photos p
      JOIN folders f ON p.folder_id = f.id
      WHERE (f.path LIKE '%/@eaDir/%' OR f.path LIKE '%@eaDir%')
        AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
    `).get() as { count: number; total_size: number | null };

    // Get examples for each category
    const synologyExamples = db.prepare(`
      SELECT DISTINCT p.filename
      FROM photos p
      WHERE p.filename LIKE 'SYNOPHOTO_THUMB_%'
      LIMIT 3
    `).all() as { filename: string }[];

    const systemExamples = db.prepare(`
      SELECT DISTINCT p.filename
      FROM photos p
      WHERE p.filename IN ('Thumbs.db', '.DS_Store')
         OR p.filename LIKE '.__%'
         OR p.filename LIKE 'desktop.ini'
      LIMIT 3
    `).all() as { filename: string }[];

    const smallFileExamples = db.prepare(`
      SELECT DISTINCT p.filename
      FROM photos p
      JOIN folders f ON p.folder_id = f.id
      WHERE p.size <= 10240
        AND f.path NOT LIKE '%/@eaDir/%'
        AND f.path NOT LIKE '%@eaDir%'
        AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
        AND p.filename NOT IN ('Thumbs.db', '.DS_Store')
      LIMIT 3
    `).all() as { filename: string }[];

    const eaDirExamples = db.prepare(`
      SELECT DISTINCT f.path
      FROM photos p
      JOIN folders f ON p.folder_id = f.id
      WHERE (f.path LIKE '%/@eaDir/%' OR f.path LIKE '%@eaDir%')
        AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
      LIMIT 3
    `).all() as { path: string }[];

    const totalIgnored = (synologyThumbs.count || 0) + (systemFiles.count || 0) + 
                        (smallFiles.count || 0) + (eaDirFiles.count || 0);
    
    const totalIgnoredSize = (synologyThumbs.total_size || 0) + (systemFiles.total_size || 0) + 
                           (smallFiles.total_size || 0) + (eaDirFiles.total_size || 0);

    const result: IgnoredFilesStats = {
      summary: {
        total_ignored_files: totalIgnored,
        total_ignored_size_bytes: totalIgnoredSize,
        categories: {
          synology_thumbnails: synologyThumbs.count || 0,
          system_files: systemFiles.count || 0,
          small_files: smallFiles.count || 0,
          eadir_folders: eaDirFiles.count || 0,
        }
      },
      breakdown: [
        {
          category: 'Synology Thumbnails',
          count: synologyThumbs.count || 0,
          total_size_bytes: synologyThumbs.total_size || 0,
          examples: synologyExamples.map(e => e.filename)
        },
        {
          category: 'System Files',
          count: systemFiles.count || 0,
          total_size_bytes: systemFiles.total_size || 0,
          examples: systemExamples.map(e => e.filename)
        },
        {
          category: 'Small Files (<10KB)',
          count: smallFiles.count || 0,
          total_size_bytes: smallFiles.total_size || 0,
          examples: smallFileExamples.map(e => e.filename)
        },
        {
          category: '@eaDir System Folders',
          count: eaDirFiles.count || 0,
          total_size_bytes: eaDirFiles.total_size || 0,
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