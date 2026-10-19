"""The viewer's display rendition, made by the worker where the app can't make it.

The viewer shows a 2048 px copy of each photo, which the app renders with
sharp on first view and stores (src/lib/displayRendition.ts, the
reference). Prebuilt sharp can't decode HEIC: for those photos the app
answers 415 and the viewer has nothing a browser can show. The app reads a
stored rendition before trying to render one, so the worker, which decodes
HEIC, stores it where the app looks:

- key: {display prefix}/{folder of the original}/{name without
  extension}-{id}-v{VERSION}[-r{turn}].jpg, the display prefix being the
  thumbnail prefix's sibling ("thumbnails" -> "display", "a/thumbnails" ->
  "a/display"); in local mode {THUMBNAILS_PATH}/display/{id}-v{VERSION}[-r{turn}].jpg.
  One object per hand rotation, like the app;
- pixels: upright from the file (pillow-heif applies the container's
  rotation, as libheif does for libvips), sRGB, fit inside 2048 x 2048,
  never enlarged, alpha on white, then the owner's user_rotation clockwise;
- JPEG quality 82, 4:2:0, progressive, no metadata; Content-Type and
  Cache-Control as the app stores it.

Only HEIC/HEIF (what decodable() in the app turns away). RAW stays with the
app: it renders those from their embedded JPEG, and a worker copy would take
precedence over it for the same key. BMP and the rest fall back to the
original, which a browser shows.

Deliberate difference with the app: no mozjpeg (trellis quantisation,
its own tables), so the files are somewhat larger at the same quality.
"""

from __future__ import annotations

import io
import posixpath

from PIL import Image

from .decode import is_raw
from .thumbnail import _node_dirname, fit_inside, flatten, mirrored_key, normalize_prefix, turn

DISPLAY_SIDE = 2048
DISPLAY_QUALITY = 82
# Part of the key, as VERSION in displayRendition.ts: both change together
DISPLAY_VERSION = 1
# What the app's sharp can't decode (decodable() in displayRendition.ts)
_FOR_MIME = frozenset({"image/heic", "image/heif"})


def applies(s3_key: str, mime: str) -> bool:
    """Photos whose rendition only the worker can make."""
    return mime.lower() in _FOR_MIME and not is_raw(s3_key, mime)


def display_prefix(thumbnail_prefix: str) -> str:
    """storagePrefix(): next to the thumbnail prefix."""
    parent = _node_dirname(normalize_prefix(thumbnail_prefix))
    return "display" if parent == "." else posixpath.normpath(f"{parent}/display")


def _name(photo_id: int, rotation: int) -> str:
    return f"{photo_id}-v{DISPLAY_VERSION}{f'-r{rotation}' if rotation else ''}.jpg"


def display_key(thumbnail_prefix: str, s3_key: str, photo_id: int, rotation: int) -> str:
    """storageKey() in s3 mode."""
    return mirrored_key(display_prefix(thumbnail_prefix), s3_key, _name(photo_id, rotation))


def local_display_path(directory: str, photo_id: int, rotation: int) -> str:
    """storageKey() in local mode: path.join(THUMBNAILS_PATH, "display", name)."""
    return posixpath.normpath(posixpath.join(directory, "display", _name(photo_id, rotation)))


def fit(image: Image.Image) -> Image.Image:
    """The full-size picture, upright, down to the rendition's size (thumbnail.load_source)."""
    size = fit_inside(*image.size, DISPLAY_SIDE)
    if size == image.size:
        return image
    return image.resize(size, Image.Resampling.LANCZOS, reducing_gap=2.0)


def render(fitted: Image.Image, rotation: int) -> Image.Image:
    """The rendition's pixels: transparency on white, like the stage, then the owner's turn."""
    return turn(flatten(fitted, background=255), rotation)


def encode(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(
        out,
        "JPEG",
        quality=DISPLAY_QUALITY,
        subsampling="4:2:0",
        optimize=True,
        progressive=True,
    )
    return out.getvalue()
