"""The app's thumbnail, made by the worker: same size, same orientation, same object.

src/lib/thumbnails.ts (generateThumbnail, sharp 0.33.5 on libvips 8.15) is
the reference; this module reproduces it with Pillow:

- the picture upright from its EXIF orientation, then the owner's
  user_rotation (clockwise) on top;
- fit inside 400 x 400, never enlarged: the long side becomes 400, the other
  one is rounded the way libvips rounds it (fit_inside);
- a JPEG is decoded at 1/2, 1/4 or 1/8 when the shrink allows it, by sharp's
  shrink-on-load rule (libjpeg DCT scaling, Pillow's draft); then a box
  reduction by floor(shrink / 2) and Lanczos3 for the rest, which is libvips
  resize with its default gap of 2 and Pillow resize with reducing_gap=2;
- an embedded ICC profile is converted to sRGB (perceptual intent), alpha is
  flattened on black, the file carries no metadata;
- baseline JPEG, quality 80, 4:2:0, optimized Huffman tables.

The object goes to {THUMBNAIL_S3_PREFIX}/{folder of the original}/{name
without extension}-{photo id}.jpeg in the thumbnail bucket (R2), with the
app's Content-Type and Cache-Control; photos.thumbnail_path holds that key.

Deliberate differences with the app:
- user_rotation turns the pixels before the one JPEG encoding. The app
  encodes twice because sharp 0.33 ignores a rotate(angle) after rotate():
  same geometry, one generation of JPEG loss less.
- HEIC, BMP, and RAW files without a usable embedded preview get a
  thumbnail: sharp cannot read them, so the app marks them skipped.
- No size threshold: the worker downloads the original anyway.
"""

from __future__ import annotations

import functools
import io
import posixpath
import time
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import rawpy
from PIL import Image, ImageCms

from .decode import UNSUPPORTED_MIME as _UNSUPPORTED_MIME
from .decode import Reader, Undecodable, Unsupported, is_raw

# Read the same way by every task; re-exported for the thumbs task
from .describe import user_rotation as user_rotation
from .tiff import largest_embedded_jpeg

THUMB_SIDE = 400
THUMB_QUALITY = 80
CONTENT_TYPE = "image/jpeg"
CACHE_CONTROL = "public, max-age=31536000, immutable"

# EXIF orientation -> transpose that brings the stored pixels upright
_TRANSPOSE = {
    2: Image.Transpose.FLIP_LEFT_RIGHT,
    3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM,
    5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_270,
    7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_90,
}
# Clockwise quarter turns (photos.metadata.user_rotation) -> transpose
_CLOCKWISE = {
    90: Image.Transpose.ROTATE_270,
    180: Image.Transpose.ROTATE_180,
    270: Image.Transpose.ROTATE_90,
}


# -- geometry and naming --------------------------------------------------------


def _shrink(width: int, height: int, side: int) -> float:
    """sharp ResolveShrink for fit 'inside' with withoutEnlargement."""
    return max(1.0, width / side, height / side)


def fit_inside(width: int, height: int, side: int = THUMB_SIDE) -> tuple[int, int]:
    """Output size: libvips resize rounds each axis to the nearest (halves up)."""
    scale = 1.0 / _shrink(width, height, side)
    if scale >= 1.0:
        return width, height
    return max(1, int(width * scale + 0.5)), max(1, int(height * scale + 0.5))


def jpeg_shrink_on_load(width: int, height: int, side: int = THUMB_SIDE) -> int:
    """The libjpeg scale sharp decodes a JPEG at (fastShrinkOnLoad, its default)."""
    shrink = _shrink(width, height, side)
    factor = next((f for f in (8, 4, 2) if shrink >= f), 1)
    # sharp: "Lower shrink-on-load for known libjpeg rounding errors"
    if factor > 1 and int(shrink) == factor:
        factor //= 2
    return factor


def normalize_prefix(prefix: str | None) -> str:
    """normalizeThumbnailS3Prefix: trimmed, no slash at either end, 'thumbnails' when empty."""
    cleaned = (prefix or "").strip().strip("/")
    return cleaned or "thumbnails"


# Node's path.posix dirname/basename/extname, ported line for line: the
# thumbnail key must be the one the app computes, including on odd names
# ("..jpg", "dir/", "...") where Python's posixpath answers differently.


def _node_dirname(path: str) -> str:
    if not path:
        return "."
    has_root = path[0] == "/"
    end = -1
    matched_slash = True
    for i in range(len(path) - 1, 0, -1):
        if path[i] == "/":
            if not matched_slash:
                end = i
                break
        else:
            matched_slash = False
    if end == -1:
        return "/" if has_root else "."
    if has_root and end == 1:
        return "//"
    return path[:end]


def _node_extname(path: str) -> str:
    start_dot, start_part, end = -1, 0, -1
    matched_slash = True
    pre_dot_state = 0
    for i in range(len(path) - 1, -1, -1):
        char = path[i]
        if char == "/":
            if not matched_slash:
                start_part = i + 1
                break
            continue
        if end == -1:
            matched_slash = False
            end = i + 1
        if char == ".":
            if start_dot == -1:
                start_dot = i
            elif pre_dot_state != 1:
                pre_dot_state = 1
        elif start_dot != -1:
            pre_dot_state = -1
    if (
        start_dot == -1
        or end == -1
        or pre_dot_state == 0
        or (pre_dot_state == 1 and start_dot == end - 1 and start_dot == start_part + 1)
    ):
        return ""
    return path[start_dot:end]


def _node_basename(path: str, suffix: str) -> str:
    start, end = 0, -1
    matched_slash = True
    if suffix and len(suffix) <= len(path):
        if suffix == path:
            return ""
        ext_idx = len(suffix) - 1
        first_non_slash_end = -1
        for i in range(len(path) - 1, -1, -1):
            char = path[i]
            if char == "/":
                if not matched_slash:
                    start = i + 1
                    break
            else:
                if first_non_slash_end == -1:
                    matched_slash = False
                    first_non_slash_end = i + 1
                if ext_idx >= 0:
                    if char == suffix[ext_idx]:
                        ext_idx -= 1
                        if ext_idx == -1:
                            end = i
                    else:
                        ext_idx = -1
                        end = first_non_slash_end
        if start == end:
            end = first_non_slash_end
        elif end == -1:
            end = len(path)
        return path[start:end]
    for i in range(len(path) - 1, -1, -1):
        if path[i] == "/":
            if not matched_slash:
                start = i + 1
                break
        elif end == -1:
            matched_slash = False
            end = i + 1
    return "" if end == -1 else path[start:end]


def mirrored_key(prefix: str, s3_key: str, suffix: str) -> str:
    """{prefix}/{folder of the original}/{name without extension}-{suffix}, as path.posix.join."""
    original = s3_key.lstrip("/")
    directory = _node_dirname(original)
    base = _node_basename(original, _node_extname(original))
    segments = [prefix]
    if directory and directory != ".":
        segments.append(directory)
    segments.append(f"{base}-{suffix}")
    return posixpath.normpath("/".join(s for s in segments if s))


def thumbnail_key(prefix: str, s3_key: str, photo_id: int) -> str:
    """getS3ThumbnailKey: {prefix}/{dir}/{base}-{id}.jpeg."""
    return mirrored_key(normalize_prefix(prefix), s3_key, f"{photo_id}.jpeg")


def local_thumbnail_path(directory: str, photo_id: int) -> str:
    """Local storage mode: path.join(THUMBNAILS_PATH, `${id}.jpeg`)."""
    return posixpath.normpath(posixpath.join(directory, f"{photo_id}.jpeg"))


# -- decoding -------------------------------------------------------------------


@dataclass(frozen=True)
class Source:
    """The original, upright (EXIF applied), sRGB, at least the thumbnail's size.

    mode RGB or L; RGBA (straight alpha) when the original has transparency.
    """

    image: Image.Image
    # The size the thumbnail's dimensions are computed from: the decoded
    # image's (after any JPEG shrink-on-load), before the early box reduction
    basis: tuple[int, int]
    # Box reduction already applied to image (1: none)
    reduced: int
    # image | raw-preview | raw-decode
    source: str
    # Size of the original upright (before any shrink-on-load)
    width: int
    height: int
    bytes_read: int
    fetch_seconds: float
    decode_seconds: float
    # The viewer's rendition before the owner's turn (display.fit), when asked for
    display: Image.Image | None = None


class _TimedReader:
    def __init__(self, reader: Reader) -> None:
        self._reader = reader
        self.seconds = 0.0
        self.bytes = 0

    def get(self, key: str) -> bytes:
        began = time.perf_counter()
        data = self._reader.get(key)
        self.seconds += time.perf_counter() - began
        self.bytes += len(data)
        return data

    def get_range(self, key: str, start: int, end: int) -> bytes:
        began = time.perf_counter()
        data = self._reader.get_range(key, start, end)
        self.seconds += time.perf_counter() - began
        self.bytes += len(data)
        return data


def load_source(
    reader: Reader, key: str, mime: str, display: Callable[[Image.Image], Image.Image] | None = None
) -> Source:
    """display: makes the viewer's rendition from the full-size picture, upright and sRGB.

    Only for originals decoded at full size (not RAW, not a JPEG shrunk on load).
    """
    if mime in _UNSUPPORTED_MIME or not mime.startswith("image/"):
        raise Unsupported(f"unsupported type {mime}")
    timed = _TimedReader(reader)
    began = time.perf_counter()
    if is_raw(key, mime):
        image, width, height, source = _open_raw(timed, key)
    else:
        image, width, height = _open(timed.get(key), orientation=None)
        source = "image"
    rendition = None
    if display is not None:
        if source != "image" or image.size != (width, height):
            raise ValueError(f"{key}: no full-size picture to make a display rendition from")
        # Before the box reduction: the full-size picture is not kept
        rendition = display(image)
    basis = image.size
    image, reduced = _box_reduce(image)
    decode_seconds = time.perf_counter() - began - timed.seconds
    return Source(
        image,
        basis,
        reduced,
        source,
        width,
        height,
        timed.bytes,
        timed.seconds,
        decode_seconds,
        rendition,
    )


def _box_reduce(image: Image.Image) -> tuple[Image.Image, int]:
    """The box step of the resize, done now: a 40 MP PNG is not held at full size.

    libvips resize (gap 2) and Pillow resize (reducing_gap=2) both average
    floor(shrink / 2) x floor(shrink / 2) blocks before the Lanczos pass;
    render() then only has the Lanczos pass left.
    """
    factor = int(_shrink(*image.size, THUMB_SIDE) / 2)
    if factor < 2:
        return image, 1
    if image.mode == "RGBA":
        # Premultiplied, as Pillow and libvips resample alpha
        return image.convert("RGBa").reduce(factor).convert("RGBA"), factor
    return image.reduce(factor), factor


def _open(data: bytes, orientation: int | None) -> tuple[Image.Image, int, int]:
    """Decoded upright and in sRGB; orientation=None reads it from the file.

    Returns the image (possibly shrunk on load) and the full upright size.
    """
    try:
        image = Image.open(io.BytesIO(data))
        stored_w, stored_h = image.size
        factor = 1
        if image.format in ("JPEG", "MPO"):
            factor = jpeg_shrink_on_load(stored_w, stored_h)
            if factor > 1:
                image.draft(None, (stored_w // factor, stored_h // factor))
        if orientation is None:
            orientation = image.getexif().get(0x0112, 1)
        image.load()
        shrunk = (stored_w // factor, stored_h // factor)
        if factor > 1 and image.size != shrunk:
            # libjpeg rounds a scaled size up, libvips drops the partial pixel
            image = image.crop((0, 0, *shrunk))
        image = _to_srgb(image)
        if orientation in _TRANSPOSE:
            image = image.transpose(_TRANSPOSE[orientation])
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as error:
        raise Undecodable(str(error) or type(error).__name__) from error
    upright = (stored_h, stored_w) if orientation in (5, 6, 7, 8) else (stored_w, stored_h)
    return image, upright[0], upright[1]


def _open_raw(reader: _TimedReader, key: str) -> tuple[Image.Image, int, int, str]:
    def read(start: int, end: int) -> bytes:
        return reader.get_range(key, start, end)

    preview = largest_embedded_jpeg(read)
    if preview is not None:
        try:
            image, width, height = _open(preview.jpeg, preview.orientation or 1)
        except Undecodable:
            image = None
        # The app takes the preview whatever its size; one smaller than the
        # thumbnail would come out blurred: demosaic instead
        if image is not None and max(width, height) >= THUMB_SIDE:
            return image, width, height, "raw-preview"

    data = reader.get(key)
    try:
        with rawpy.imread(io.BytesIO(data)) as raw:
            rgb = raw.postprocess(half_size=True, use_camera_wb=True, output_bps=8)
    except (rawpy.LibRawError, OSError, ValueError) as error:
        raise Undecodable(f"raw: {error}") from error
    image = Image.fromarray(rgb)
    return image, image.width, image.height, "raw-decode"


@functools.lru_cache(maxsize=32)
def _transform(icc: bytes, mode: str) -> ImageCms.ImageCmsTransform | None:
    try:
        source = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        return ImageCms.buildTransform(
            source,
            ImageCms.createProfile("sRGB"),
            mode,
            "RGBA" if mode == "RGBA" else "RGB",
            renderingIntent=ImageCms.Intent.PERCEPTUAL,
        )
    except (ImageCms.PyCMSError, OSError, ValueError, TypeError):
        # sharp warns "Invalid embedded profile" and goes on without it
        return None


def _to_srgb(image: Image.Image) -> Image.Image:
    """RGB / L / RGBA in sRGB, like sharp's pipeline before the resize."""
    icc = image.info.get("icc_profile")
    if image.mode == "P":
        image = image.convert("RGBA" if "transparency" in image.info else "RGB")
    elif image.mode in ("I;16", "I;16B", "I;16L", "I"):
        # 16-bit grey: libvips keeps the high byte when saving 8-bit
        values = np.asarray(image, dtype=np.uint32)
        shift = 8 if values.max(initial=0) > 255 else 0
        image = Image.fromarray((values >> shift).clip(0, 255).astype(np.uint8), "L")
    elif image.mode == "1":
        image = image.convert("L")
    elif image.mode == "LA":
        image = image.convert("RGBA")
    elif image.mode not in ("RGB", "RGBA", "L", "CMYK"):
        image = image.convert("RGB")

    if icc and image.mode in ("RGB", "RGBA", "CMYK"):
        transform = _transform(bytes(icc), image.mode)
        if transform is not None:
            image = ImageCms.applyTransform(image, transform)
    if image.mode == "CMYK":
        image = image.convert("RGB")
    if image.mode == "RGBA":
        alpha = image.getchannel("A")
        if alpha.getextrema()[0] == 255:
            image = image.convert("RGB")
    return image


# -- rendering ------------------------------------------------------------------


def render(source: Source, rotation: int) -> Image.Image:
    """The thumbnail's pixels: fit inside 400 x 400, then the owner's rotation."""
    size = fit_inside(*source.basis)
    image = source.image
    if size != image.size:
        # The original's extent in the reduced image: a partial last block
        # must not stretch the picture (what Pillow does inside one resize)
        box = (0.0, 0.0, source.basis[0] / source.reduced, source.basis[1] / source.reduced)
        # Pillow premultiplies alpha for the resampling, as libvips does
        image = image.resize(size, Image.Resampling.LANCZOS, box=box, reducing_gap=2.0)
    return turn(image, rotation)


def turn(image: Image.Image, rotation: int) -> Image.Image:
    """The owner's user_rotation: clockwise quarter turns, lossless."""
    if rotation in _CLOCKWISE:
        return image.transpose(_CLOCKWISE[rotation])
    return image


def flatten(image: Image.Image, background: int = 0) -> Image.Image:
    """Alpha onto a grey level, black by default (libvips jpegsave); RGB/L unchanged."""
    if image.mode != "RGBA":
        return image
    rgba = np.asarray(image, dtype=np.uint16)
    alpha = rgba[..., 3:4]
    rgb = (rgba[..., :3] * alpha + background * (255 - alpha) + 127) // 255
    return Image.fromarray(rgb.astype(np.uint8), "RGB")


def encode(image: Image.Image) -> bytes:
    out = io.BytesIO()
    flatten(image).save(
        out,
        "JPEG",
        quality=THUMB_QUALITY,
        subsampling="4:2:0",
        optimize=True,
        progressive=False,
    )
    return out.getvalue()
