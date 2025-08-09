import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { logger } from '@/lib/logger';

interface DuplicateFolderGroup {
  folder_signature: string;
  count: number;
  file_count: number;
  total_size_bytes: number;
  folders: {
    id: number;
    path: string;
    name: string;
    photo_count: number;
    total_size_bytes: number;
  }[];
}

interface DuplicateFoldersStats {
  summary: {
    total_duplicate_folder_groups: number;
    total_duplicate_folders: number;
    potential_space_saved_bytes: number;
  };
  duplicates: DuplicateFolderGroup[];
}

export async function GET() {
  try {
    const db = getDatabase();
    
    // Get folder signatures (concatenated sorted list of filename|size for each folder)
    const folderSignatures = db.prepare(`
      WITH folder_contents AS (
        SELECT 
          f.id,
          f.name,
          f.path,
          p.filename,
          p.size,
          (p.filename || '|' || p.size) as file_signature
        FROM folders f
        JOIN photos p ON f.id = p.folder_id
        WHERE f.path NOT LIKE '%/@eaDir/%'
          AND f.path NOT LIKE '%@eaDir%'
          AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
          AND p.filename NOT LIKE 'Thumbs.db'
          AND p.filename NOT LIKE '.DS_Store'
          AND p.size > 10240
      ),
      folder_signatures AS (
        SELECT 
          fc.id,
          fc.name,
          fc.path,
          COUNT(fc.file_signature) as file_count,
          SUM(fc.size) as total_size,
          GROUP_CONCAT(fc.file_signature, '::') as folder_signature
        FROM folder_contents fc
        GROUP BY fc.id, fc.name, fc.path
        HAVING file_count > 0
      )
      SELECT 
        fs.id,
        fs.name,
        fs.path,
        fs.file_count,
        fs.total_size,
        fs.folder_signature
      FROM folder_signatures fs
      WHERE fs.folder_signature IN (
        SELECT folder_signature 
        FROM folder_signatures 
        GROUP BY folder_signature 
        HAVING COUNT(*) > 1
      )
      ORDER BY fs.folder_signature, fs.path
    `).all() as {
      id: number;
      name: string;
      path: string;
      file_count: number;
      total_size: number;
      folder_signature: string;
    }[];

    // Group folders by their signature
    const duplicateGroups: Record<string, DuplicateFolderGroup> = {};
    
    for (const folder of folderSignatures) {
      if (!duplicateGroups[folder.folder_signature]) {
        duplicateGroups[folder.folder_signature] = {
          folder_signature: folder.folder_signature,
          count: 0,
          file_count: folder.file_count,
          total_size_bytes: folder.total_size,
          folders: []
        };
      }
      
      duplicateGroups[folder.folder_signature].folders.push({
        id: folder.id,
        path: folder.path,
        name: folder.name,
        photo_count: folder.file_count,
        total_size_bytes: folder.total_size
      });
      duplicateGroups[folder.folder_signature].count++;
    }

    // Convert to array and sort by potential space savings
    const sortedGroups = Object.values(duplicateGroups)
      .filter(group => group.count > 1)
      .sort((a, b) => (b.total_size_bytes * (b.count - 1)) - (a.total_size_bytes * (a.count - 1)));

    // Calculate summary stats
    const totalDuplicateFolderGroups = sortedGroups.length;
    const totalDuplicateFolders = sortedGroups.reduce((sum, group) => sum + group.count, 0);
    const potentialSpaceSaved = sortedGroups.reduce((total, group) => {
      // Space that could be saved by keeping only one copy of each duplicate folder
      return total + (group.total_size_bytes * (group.count - 1));
    }, 0);

    const result: DuplicateFoldersStats = {
      summary: {
        total_duplicate_folder_groups: totalDuplicateFolderGroups,
        total_duplicate_folders: totalDuplicateFolders,
        potential_space_saved_bytes: potentialSpaceSaved
      },
      duplicates: sortedGroups
    };

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.apiError('Error in GET /api/stats/duplicate-folders', error as Error, {
      method: 'GET',
      path: '/api/stats/duplicate-folders'
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