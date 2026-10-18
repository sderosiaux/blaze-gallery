"""Original in the bucket -> pixels in displayed orientation, in memory.

Two renditions come out: the full decoded resolution (faces are aligned and
embedded from it: a face under 112 px gives a degraded embedding) and a copy
at most `max_side` px long for detection. RAW files give their embedded
full-size JPEG through two range reads; only when that preview is missing or
too small does the whole file come down for a half-size demosaic.
"""

from __future__ import annotations

import io
import time
from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np
import pillow_heif
import rawpy
from PIL import Image, ImageOps

from .tiff import largest_embedded_jpeg

pillow_heif.register_heif_opener()
# Panoramas run to 100+ MP; above this is more likely a decompression bomb
Image.MAX_IMAGE_PIXELS = 250_000_000

RAW_EXTENSIONS = frozenset(
    {
        "nef", "nrw", "cr2", "cr3", "arw", "srf", "sr2", "dng", "orf",
        "pef", "srw", "raf", "rw2", "3fr", "erf", "kdc", "mrw", "iiq",
    }
)  # fmt: skip
UNSUPPORTED_MIME = frozenset({"image/svg+xml"})

# EXIF orientation -> PIL transpose that brings the stored pixels upright
_TRANSPOSE = {
    2: Image.Transpose.FLIP_LEFT_RIGHT,
    3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM,
    5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_270,
    7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_90,
}


class Unsupported(Exception):
    """Not something this pipeline analyzes (the job is skipped, not failed)."""


class Undecodable(Exception):
    """The bytes are not a readable image: retrying will not help."""


class Reader(Protocol):
    def get(self, key: str) -> bytes: ...
    def get_range(self, key: str, start: int, end: int) -> bytes: ...


@dataclass(frozen=True)
class Picture:
    # BGR uint8 (OpenCV order), displayed orientation (EXIF applied)
    full: np.ndarray
    # Same, long side <= max_side
    small: np.ndarray
    # image | raw-preview | raw-decode (half-size demosaic)
    source: str
    bytes_read: int
    fetch_seconds: float
    decode_seconds: float

    @property
    def size(self) -> tuple[int, int]:
        """Width and height of the decoded original."""
        height, width = self.full.shape[:2]
        return width, height


class _TimedReader:
    def __init__(self, reader: Reader) -> None:
        self._reader = reader
        self.seconds = 0.0
        self.bytes = 0

    def get(self, key: str) -> bytes:
        start = time.perf_counter()
        data = self._reader.get(key)
        self.seconds += time.perf_counter() - start
        self.bytes += len(data)
        return data

    def get_range(self, key: str, start: int, end: int) -> bytes:
        began = time.perf_counter()
        data = self._reader.get_range(key, start, end)
        self.seconds += time.perf_counter() - began
        self.bytes += len(data)
        return data


def is_raw(key: str, mime: str) -> bool:
    extension = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    return extension in RAW_EXTENSIONS or mime in ("image/x-adobe-dng", "image/x-nikon-nef")


def load_picture(reader: Reader, key: str, mime: str, max_side: int) -> Picture:
    if mime in UNSUPPORTED_MIME or not mime.startswith("image/"):
        raise Unsupported(f"unsupported type {mime}")
    timed = _TimedReader(reader)
    began = time.perf_counter()
    if is_raw(key, mime):
        image, source = _load_raw(timed, key, max_side)
    else:
        image, source = _open_upright(timed.get(key), orientation=None), "image"
    full = _to_bgr(image)
    small = _shrink(full, max_side)
    decode_seconds = time.perf_counter() - began - timed.seconds
    return Picture(full, small, source, timed.bytes, timed.seconds, decode_seconds)


def _open_upright(data: bytes, orientation: int | None) -> Image.Image:
    """Decoded image upright; orientation=None reads it from the file's EXIF.

    HEIC needs nothing: pillow-heif applies the container's rotation and
    resets the EXIF orientation to 1.
    """
    try:
        image = Image.open(io.BytesIO(data))
        if orientation is None:
            return ImageOps.exif_transpose(image)
        if orientation in _TRANSPOSE:
            return image.transpose(_TRANSPOSE[orientation])
        image.load()
        return image
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as error:
        raise Undecodable(str(error) or type(error).__name__) from error


def _to_bgr(image: Image.Image) -> np.ndarray:
    if image.mode == "P":
        image = image.convert("RGBA")
    if image.mode != "RGB":
        image = image.convert("RGB")
    return np.ascontiguousarray(np.asarray(image)[:, :, ::-1])


def _shrink(full: np.ndarray, max_side: int) -> np.ndarray:
    height, width = full.shape[:2]
    scale = max_side / max(width, height)
    if scale >= 1:
        return full
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return cv2.resize(full, size, interpolation=cv2.INTER_AREA)


def _load_raw(reader: _TimedReader, key: str, max_side: int) -> tuple[Image.Image, str]:
    def read(start: int, end: int) -> bytes:
        return reader.get_range(key, start, end)

    preview = largest_embedded_jpeg(read)
    if preview is not None:
        try:
            image = _open_upright(preview.jpeg, preview.orientation or 1)
        except Undecodable:
            image = None
        # Faces are aligned on the full image: a preview barely bigger than
        # the detection rendition (DNG converters store 1024 px) gives them
        # too few pixels
        if image is not None and max(image.size) >= 2 * max_side:
            return image, "raw-preview"

    # No usable preview: demosaic the whole file at half size (LibRaw applies
    # the camera's rotation)
    data = reader.get(key)
    try:
        with rawpy.imread(io.BytesIO(data)) as raw:
            rgb = raw.postprocess(half_size=True, use_camera_wb=True, output_bps=8)
    except (rawpy.LibRawError, OSError, ValueError) as error:
        raise Undecodable(f"raw: {error}") from error
    return Image.fromarray(rgb), "raw-decode"
