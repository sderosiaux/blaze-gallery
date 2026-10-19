"""Folders out of the gallery: excluded_folders in db/schema.sql.

The owner marks some folders « pas une galerie photo » (books, game sprites,
album art), each with everything below it. Their photos are not queued for
analysis, a job claimed for one closes as skipped (thumbs still makes its
thumbnail, without colors), and blaze-people never sees their faces. What
was found in them before stays in the database for when the folder comes
back. The rule is the table's key_like pattern, the one the app's queries
use (src/lib/database.ts outOfGallery).
"""

from __future__ import annotations

# analysis_jobs.last_error of a job closed because its photo is out of the
# gallery: `blaze-enqueue --all` queues it again once the folder is back
EXCLUDED_NOTE = "out of the gallery (excluded_folders)"


def out_of_gallery(key: str = "p.s3_key") -> str:
    """SQL condition: `key`, a photo's s3_key, lies in a folder out of the gallery."""
    return f"({key} LIKE ANY (ARRAY(SELECT key_like FROM excluded_folders)))"
