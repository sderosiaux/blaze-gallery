import { getFolderByPath, query } from "./database";
import { getConfig } from "./config";
import { logger } from "./logger";
import { thumbnailService } from "./thumbnails";

/**
 * Builds the missing thumbnails of one folder, a few at a time. The browser
 * calls it in a loop while the folder is open, so a folder that has been
 * opened once is complete for every later visit, without reading the whole
 * bucket ahead of time. Each call stays short (one batch) because a
 * serverless function cannot be relied on to keep working after it answers.
 */

const RAW_PATTERN = String.raw`\.(nef|nrw|cr2|arw|srf|sr2|dng|orf|pef|srw|3fr|erf|kdc|mrw|iiq)$`;

// Images still without a thumbnail. RAW files skipped for their size are
// included: their thumbnail now comes from the embedded JPEG, whatever the size.
const MISSING = `
  p.mime_type LIKE 'image/%'
  AND (
    p.thumbnail_status IN ('none', 'pending')
    OR (p.thumbnail_status = 'skipped_size' AND lower(p.filename) ~ '${RAW_PATTERN}')
  )`;

export interface WarmupResult {
  /** Photos whose thumbnail now exists, in this batch */
  generated: string[];
  /** Photos that could not get one (unsupported, corrupted, too large) */
  skipped: string[];
  /** Images of the folder still without a thumbnail after this batch */
  remaining: number;
  /**
   * Where the next batch starts (opaque). Null once the end of the folder is
   * reached; photos that failed for a passing reason are retried next visit.
   */
  next: string | null;
}

interface MissingRow {
  id: string;
  s3_key: string;
  filename: string;
}

// Opaque "filename|id" cursor, so a photo that keeps failing never blocks the rest
function parseCursor(cursor: string | null): [string, string] | null {
  if (!cursor) return null;
  const at = cursor.lastIndexOf("|");
  if (at <= 0) return null;
  const id = cursor.slice(at + 1);
  return /^\d+$/.test(id) ? [cursor.slice(0, at), id] : null;
}

export async function warmFolderThumbnails(
  folderPath: string,
  after: string | null,
  { batchSize = 12, concurrency = 6 } = {},
): Promise<WarmupResult | null> {
  const folder = await getFolderByPath(folderPath);
  if (!folder) return null;

  const from = parseCursor(after);
  const { rows } = await query<MissingRow>(
    `SELECT p.id, p.s3_key, p.filename FROM photos p
     WHERE p.folder_id = $1 AND ${MISSING}
       ${from ? "AND (p.filename, p.id) > ($3::text, $4::bigint)" : ""}
     ORDER BY p.filename, p.id
     LIMIT $2`,
    from ? [folder.id, batchSize, from[0], from[1]] : [folder.id, batchSize],
  );
  const last = rows[rows.length - 1];

  const bucket = getConfig().backblaze_bucket;
  const generated: string[] = [];
  const skipped: string[] = [];
  const queue = [...rows];

  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try {
        const path = await thumbnailService.generateThumbnail({
          bucket,
          s3Key: row.s3_key,
          photoId: Number(row.id),
        });
        // An empty path means the file was marked corrupted
        (path ? generated : skipped).push(row.id);
      } catch (error) {
        // Unsupported or over the size threshold: the photo's status says
        // so now, and it leaves the "missing" set.
        skipped.push(row.id);
        logger.debug("Folder warm-up skipped a photo", {
          photoId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, worker),
  );

  const { rows: left } = await query<{ remaining: number }>(
    `SELECT COUNT(*)::int AS remaining FROM photos p
     WHERE p.folder_id = $1 AND ${MISSING}`,
    [folder.id],
  );

  return {
    generated,
    skipped,
    remaining: left[0]?.remaining ?? 0,
    next:
      rows.length === batchSize && last ? `${last.filename}|${last.id}` : null,
  };
}
