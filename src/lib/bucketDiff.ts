import type { S3Object } from "./s3";
import { getFolderFromKey, isMediaFile } from "./s3";

/**
 * What a full scan has to change: the database snapshot against the bucket
 * listing. No I/O here, so the rules (above all, when nothing may be removed)
 * are tested without a bucket or a database.
 */

/** What the database holds for one file of the bucket */
export interface KnownPhoto {
  id: number;
  size: number;
  /** photos.modified_at, epoch milliseconds */
  modifiedAt: number;
  /** photos.etag; null until read */
  etag: string | null;
}

/** One ListObjectsV2 page */
export interface ListingPage {
  objects: readonly S3Object[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

/** A known key whose file was replaced (new size or date) */
export interface ChangedPhoto {
  id: number;
  object: S3Object;
}

export interface RemovedPhoto {
  id: number;
  key: string;
}

export interface BucketDiff {
  /** Distinct objects listed, media or not */
  listed: number;
  /** Folder of every listed object: non-media files get theirs too, as they always did */
  folders: ReadonlySet<string>;
  /** Media files the database doesn't know */
  added: readonly S3Object[];
  changed: readonly ChangedPhoto[];
  /** Photos whose file is no longer in the bucket */
  removed: readonly RemovedPhoto[];
}

/** The listing stopped before its last page: a key missing from it proves nothing. */
export class IncompleteListingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompleteListingError";
  }
}

/**
 * Same comparison as FILE_CHANGED in database.ts: a replaced file has a new
 * size or date, or another ETag once the stored one is known.
 */
export function isFileChanged(known: KnownPhoto, object: S3Object): boolean {
  return (
    known.size !== object.size ||
    known.modifiedAt !== object.lastModified.getTime() ||
    (known.etag !== null && object.etag !== "" && known.etag !== object.etag)
  );
}

/**
 * Takes the listing page by page, keeping only the keys seen and the
 * differences (not the whole bucket), then yields the diff. Removals only
 * exist once the last page arrived: with no page, or a last page still
 * truncated (an error cut the listing, or a page came without a token to
 * continue), finish() throws instead.
 */
export class BucketDiffer {
  private readonly seen = new Set<string>();
  private readonly folders = new Set<string>();
  private readonly added: S3Object[] = [];
  private readonly changed: ChangedPhoto[] = [];
  private lastPage: ListingPage | undefined;

  constructor(private readonly known: ReadonlyMap<string, KnownPhoto>) {}

  /** Distinct objects taken in so far */
  get listed(): number {
    return this.seen.size;
  }

  addPage(page: ListingPage): void {
    if (this.lastPage !== undefined && !this.lastPage.isTruncated) {
      throw new Error("Listing page received after the last one");
    }
    this.lastPage = page;

    for (const object of page.objects) {
      if (this.seen.has(object.key)) continue;
      this.seen.add(object.key);
      this.folders.add(getFolderFromKey(object.key));

      const known = this.known.get(object.key);
      if (known === undefined) {
        if (isMediaFile(object.key)) this.added.push(object);
      } else if (isFileChanged(known, object)) {
        this.changed.push({ id: known.id, object });
      }
    }
  }

  finish(): BucketDiff {
    const last = this.lastPage;
    if (last === undefined) {
      throw new IncompleteListingError("The listing returned no page");
    }
    // A token on a page that claims to be the last one is just as ambiguous
    if (last.isTruncated || last.nextContinuationToken !== undefined) {
      throw new IncompleteListingError(
        `The listing stopped after ${this.seen.size} objects, before its last page`,
      );
    }

    const removed: RemovedPhoto[] = [];
    for (const [key, photo] of this.known) {
      if (!this.seen.has(key)) removed.push({ id: photo.id, key });
    }

    return {
      listed: this.seen.size,
      folders: this.folders,
      added: this.added,
      changed: this.changed,
      removed,
    };
  }
}

export function diffBucket(
  known: ReadonlyMap<string, KnownPhoto>,
  pages: Iterable<ListingPage>,
): BucketDiff {
  const differ = new BucketDiffer(known);
  for (const page of pages) differ.addPage(page);
  return differ.finish();
}

/** Share of the library one scan may remove unless told otherwise */
export const MAX_REMOVED_SHARE = 0.05;

/**
 * Losing more than MAX_REMOVED_SHARE of the library in one scan points at a
 * listing gone wrong (another bucket, a wiped prefix) as much as at a
 * cleanup: the scan then stops and waits for an explicit go-ahead.
 */
export function isMassRemoval(removed: number, known: number): boolean {
  return removed > known * MAX_REMOVED_SHARE;
}

export interface FolderToCreate {
  path: string;
  name: string;
  /** null for a top-level folder and for the root ("") */
  parentPath: string | null;
}

/**
 * Folders missing from the database for these paths, ancestors included,
 * parents before children. Top-level folders have no parent, not even the
 * root folder (path "", named "Root"), which only exists when files sit at
 * the bucket's root.
 */
export function missingFolders(
  paths: Iterable<string>,
  known: ReadonlyMap<string, unknown>,
): FolderToCreate[] {
  const missing = new Map<string, FolderToCreate>();
  const want = (folder: FolderToCreate) => {
    if (!known.has(folder.path) && !missing.has(folder.path)) {
      missing.set(folder.path, folder);
    }
  };

  for (const path of paths) {
    if (path === "") {
      want({ path: "", name: "Root", parentPath: null });
      continue;
    }
    const parts = path.split("/");
    parts.forEach((name, index) => {
      want({
        path: parts.slice(0, index + 1).join("/"),
        name,
        parentPath: index === 0 ? null : parts.slice(0, index).join("/"),
      });
    });
  }

  return [...missing.values()].sort(
    (a, b) => folderDepth(a.path) - folderDepth(b.path),
  );
}

export function folderDepth(path: string): number {
  return path.split("/").length;
}
