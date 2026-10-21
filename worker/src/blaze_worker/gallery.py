"""Photos out of the gallery: excluded_folders and the Corbeille in db/schema.sql.

The owner marks some folders « pas une galerie photo » (books, game sprites,
album art), each with everything below it, and throws photos away to the
Corbeille (photos.trashed_at), where they wait 30 days before the purge.
Either way their photos are not queued for analysis, a job claimed for one
closes as skipped (thumbs still makes its thumbnail, without colors), and
blaze-people never sees their faces. What was found in them before stays in
the database for when they come back. The rule is the one the app's queries
use (src/lib/database.ts inGallery).
"""

from __future__ import annotations

# analysis_jobs.last_error of a job closed because its photo is out of the
# gallery (an excluded folder, or the Corbeille): `blaze-enqueue --all`
# queues it again once it is back
EXCLUDED_NOTE = "out of the gallery (excluded_folders)"


def excluded(key: str = "p.s3_key") -> str:
    """SQL condition: `key`, a photo's s3_key or a folder's path and a slash, lies in a
    folder out of the gallery (the app's outOfGallery)."""
    return f"({key} LIKE ANY (ARRAY(SELECT key_like FROM excluded_folders)))"


def out_of_gallery(p: str = "p") -> str:
    """SQL condition: the photo `p` lies in a folder out of the gallery, or in the Corbeille."""
    return f"({excluded(f'{p}.s3_key')} OR {p}.trashed_at IS NOT NULL)"
