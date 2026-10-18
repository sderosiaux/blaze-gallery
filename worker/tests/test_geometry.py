"""Orientation handling without a database or models: EXIF, RAW previews, turned detection."""

from __future__ import annotations

import io
import struct

import numpy as np
import pytest
from PIL import Image

from blaze_worker.decode import Unsupported, load_picture
from blaze_worker.faces import _rotate, _to_displayed, _uprightness
from blaze_worker.tiff import largest_embedded_jpeg


class BytesReader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.requests = 0

    def get(self, key: str) -> bytes:
        self.requests += 1
        return self.data

    def get_range(self, key: str, start: int, end: int) -> bytes:
        self.requests += 1
        return self.data[start : end + 1]


def jpeg(width: int, height: int, orientation: int | None = None) -> bytes:
    image = Image.new("RGB", (width, height), (200, 30, 30))
    # A marker in the stored top-left corner
    image.paste((0, 255, 0), (0, 0, 8, 8))
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    out = io.BytesIO()
    image.save(out, "JPEG", exif=exif.tobytes(), quality=95)
    return out.getvalue()


def tiff_with_preview(preview: bytes, orientation: int) -> bytes:
    """Little-endian TIFF: IFD0 with orientation, size and a JPEG preview pointer."""
    entries = [
        (0x0100, 4, 1, 6000),  # width
        (0x0101, 4, 1, 4000),  # height
        (0x0112, 3, 1, orientation),
        (0x0201, 4, 1, 0),  # JPEG offset, patched below
        (0x0202, 4, 1, len(preview)),
    ]
    ifd_offset = 8
    ifd_size = 2 + len(entries) * 12 + 4
    preview_offset = ifd_offset + ifd_size
    out = bytearray(b"II*\x00" + struct.pack("<I", ifd_offset))
    out += struct.pack("<H", len(entries))
    for tag, kind, count, value in entries:
        if tag == 0x0201:
            value = preview_offset
        packed = struct.pack("<HI", value, 0)[:4] if kind == 3 else struct.pack("<I", value)
        out += struct.pack("<HHI", tag, kind, count) + packed
    out += struct.pack("<I", 0)
    out += preview
    return bytes(out)


def marker_corner(image: np.ndarray) -> tuple[int, int]:
    """(x, y) quadrant of the green marker: 0 = left/top, 1 = right/bottom."""
    green = (image[:, :, 1] > 200) & (image[:, :, 2] < 100)
    ys, xs = np.nonzero(green)
    height, width = image.shape[:2]
    return int(xs.mean() > width / 2), int(ys.mean() > height / 2)


def test_exif_orientation_is_applied_to_both_renditions():
    # Orientation 6: stored landscape, displayed portrait turned clockwise
    picture = load_picture(BytesReader(jpeg(400, 200, orientation=6)), "a.jpg", "image/jpeg", 100)
    assert picture.full.shape[:2] == (400, 200)
    assert max(picture.small.shape[:2]) == 100
    # Stored top-left ends up top-right once turned clockwise
    assert marker_corner(picture.full) == (1, 0)
    assert picture.source == "image"


def test_raw_uses_the_embedded_preview_with_the_ifd0_orientation():
    preview = jpeg(300, 200)
    data = tiff_with_preview(preview, orientation=8)
    reader = BytesReader(data)
    found = largest_embedded_jpeg(lambda s, e: reader.get_range("x", s, e))
    assert found is not None and found.jpeg == preview and found.orientation == 8

    picture = load_picture(BytesReader(data), "DSC_0001.NEF", "image/x-nikon-nef", 100)
    assert picture.source == "raw-preview"
    # Orientation 8: turned counter-clockwise, stored top-left ends bottom-left
    assert picture.full.shape[:2] == (300, 200)
    assert marker_corner(picture.full) == (0, 1)


def test_svg_is_unsupported():
    with pytest.raises(Unsupported):
        load_picture(BytesReader(b"<svg/>"), "a.svg", "image/svg+xml", 100)


@pytest.mark.parametrize("degrees", [0, 90, 270])
def test_points_found_on_a_turned_image_map_back_to_the_displayed_one(degrees):
    height, width = 40, 60
    image = np.zeros((height, width, 3), np.uint8)
    image[5, 10] = 255
    turned = _rotate(image, degrees)
    ys, xs = np.nonzero(turned[:, :, 0])
    turned_h, turned_w = turned.shape[:2]
    x, y = _to_displayed((xs[0] + 0.5) / turned_w, (ys[0] + 0.5) / turned_h, degrees)
    assert x == pytest.approx(10.5 / width)
    assert y == pytest.approx(5.5 / height)


def test_uprightness_tells_upright_from_sideways_and_upside_down():
    upright = np.array([[30, 40], [70, 40], [50, 60], [35, 80], [65, 80]], np.float32)
    assert _uprightness(upright) > 0.99
    # Turned 90 degrees: eyes and mouth side by side
    sideways = upright[:, ::-1].copy()
    assert abs(_uprightness(sideways)) < 0.1
    upside_down = upright.copy()
    upside_down[:, 1] = 120 - upside_down[:, 1]
    assert _uprightness(upside_down) < -0.99
