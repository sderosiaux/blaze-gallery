"""The app's thumbnail rules, reproduced: sizes, orientation, keys, storage guards.

Expected sizes and keys were produced by the app's own code (sharp 0.33.5,
Node's path.posix) on the same inputs.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from blaze_worker.decode import Unsupported
from blaze_worker.thumbnail import (
    CACHE_CONTROL,
    encode,
    fit_inside,
    jpeg_shrink_on_load,
    load_source,
    normalize_prefix,
    render,
    thumbnail_key,
    user_rotation,
)
from blaze_worker.thumbstore import ThumbnailStore, thumbnail_settings


class Bucket:
    def __init__(self, data: bytes) -> None:
        self.data = data

    def get(self, key: str) -> bytes:
        return self.data

    def get_range(self, key: str, start: int, end: int) -> bytes:
        return self.data[start : end + 1]


def quadrants(width: int, height: int) -> Image.Image:
    """Red top-left, green top-right, blue bottom-left, white bottom-right."""
    image = Image.new("RGB", (width, height))
    w, h = width // 2, height // 2
    image.paste((220, 0, 0), (0, 0, w, h))
    image.paste((0, 200, 0), (w, 0, width, h))
    image.paste((0, 0, 220), (0, h, w, height))
    image.paste((255, 255, 255), (w, h, width, height))
    return image


def jpeg(image: Image.Image, orientation: int = 1) -> bytes:
    out = io.BytesIO()
    exif = Image.Exif()
    if orientation != 1:
        exif[0x0112] = orientation
    image.save(out, "JPEG", quality=95, exif=exif.tobytes())
    return out.getvalue()


def corner(image: Image.Image, x: float, y: float) -> str:
    r, g, b = image.convert("RGB").getpixel(
        (int(x * (image.width - 1)), int(y * (image.height - 1)))
    )
    scores = {
        "red": r - g - b,
        "green": g - r - b,
        "blue": b - r - g,
        "white": min(r, g, b) - 128,
    }
    return max(scores, key=scores.__getitem__)


# (width, height, format) -> size sharp writes
@pytest.mark.parametrize(
    ("width", "height", "fmt", "expected"),
    [
        (6000, 4000, "jpeg", (400, 267)),
        (4000, 6000, "jpeg", (267, 400)),
        (1600, 1201, "jpeg", (400, 300)),
        (5481, 4256, "jpeg", (400, 311)),
        (4140, 1657, "jpeg", (400, 160)),
        (984, 3878, "jpeg", (102, 400)),
        (5000, 401, "jpeg", (400, 32)),
        (399, 401, "jpeg", (398, 400)),
        (400, 300, "jpeg", (400, 300)),
        (4140, 1657, "png", (400, 160)),
        (5000, 401, "png", (400, 32)),
        (250, 125, "png", (250, 125)),
    ],
)
def test_size_is_the_one_sharp_writes(width, height, fmt, expected):
    factor = jpeg_shrink_on_load(width, height) if fmt == "jpeg" else 1
    assert fit_inside(width // factor, height // factor) == expected


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("pc-fixe/2019 - Québec/IMG_1711.NEF", "thumbnails/pc-fixe/2019 - Québec/IMG_1711-7.jpeg"),
        ("/lead/slash/IMG.JPG", "thumbnails/lead/slash/IMG-7.jpeg"),
        ("a//double/x.jpg", "thumbnails/a/double/x-7.jpeg"),
        ("noext", "thumbnails/noext-7.jpeg"),
        (".hidden", "thumbnails/.hidden-7.jpeg"),
        ("dir/photo.", "thumbnails/dir/photo-7.jpeg"),
        ("dir/a.b.c.jpeg", "thumbnails/dir/a.b.c-7.jpeg"),
        ("a/../b/x.png", "thumbnails/b/x-7.jpeg"),
        ("dir/.x.jpg", "thumbnails/dir/.x-7.jpeg"),
        ("dir/..jpg", "thumbnails/dir/.-7.jpeg"),
        ("trailing/", "thumbnails/trailing-7.jpeg"),
        ("dir/...", "thumbnails/dir/..-7.jpeg"),
    ],
)
def test_key_is_the_one_the_app_computes(key, expected):
    assert thumbnail_key("thumbnails", key, 7) == expected


def test_prefix_is_normalized_like_the_app():
    assert normalize_prefix(" /thumbs/ ") == "thumbs"
    assert normalize_prefix("") == "thumbnails"
    assert normalize_prefix(None) == "thumbnails"
    assert thumbnail_key("/x/y/", "a/b.jpg", 1) == "x/y/a/b-1.jpeg"


def test_exif_orientation_then_user_rotation():
    # Stored landscape with orientation 6: displayed as portrait, red top-right
    data = jpeg(quadrants(1200, 800), orientation=6)
    source = load_source(Bucket(data), "a.jpg", "image/jpeg")
    assert (source.width, source.height) == (800, 1200)

    upright = render(source, 0)
    assert upright.size == (267, 400)
    assert corner(upright, 0.1, 0.1) == "blue"
    assert corner(upright, 0.9, 0.1) == "red"

    # The owner turned it a quarter clockwise on top
    turned = render(source, 90)
    assert turned.size == (400, 267)
    assert corner(turned, 0.9, 0.1) == "blue"
    assert corner(turned, 0.9, 0.9) == "red"

    encoded = Image.open(io.BytesIO(encode(turned)))
    assert encoded.format == "JPEG" and encoded.size == (400, 267)
    assert not encoded.getexif()


def test_small_images_are_not_enlarged_and_large_pngs_are_reduced_early():
    small = io.BytesIO()
    quadrants(120, 80).save(small, "PNG")
    assert render(load_source(Bucket(small.getvalue()), "s.png", "image/png"), 0).size == (120, 80)

    large = io.BytesIO()
    quadrants(4001, 2999).save(large, "PNG")
    source = load_source(Bucket(large.getvalue()), "l.png", "image/png")
    assert source.basis == (4001, 2999) and source.reduced == 5
    image = render(source, 0)
    assert image.size == (400, 300)
    assert corner(image, 0.1, 0.1) == "red" and corner(image, 0.9, 0.9) == "white"


def test_transparency_is_flattened_on_black():
    image = Image.new("RGBA", (64, 64), (255, 255, 255, 0))
    image.paste((255, 255, 255, 255), (0, 0, 32, 64))
    out = io.BytesIO()
    image.save(out, "PNG")
    source = load_source(Bucket(out.getvalue()), "t.png", "image/png")
    assert source.image.mode == "RGBA"
    pixels = np.asarray(Image.open(io.BytesIO(encode(render(source, 0)))).convert("L"))
    assert pixels[:, :28].mean() > 245
    assert pixels[:, 36:].mean() < 10


def test_svg_and_videos_are_skipped():
    with pytest.raises(Unsupported):
        load_source(Bucket(b"<svg/>"), "a.svg", "image/svg+xml")
    with pytest.raises(Unsupported):
        load_source(Bucket(b""), "a.mp4", "video/mp4")


def test_user_rotation_reads_like_the_app():
    assert user_rotation({"user_rotation": 90}) == 90
    assert user_rotation({"user_rotation": "90"}) == 0
    assert user_rotation({"user_rotation": 45}) == 0
    assert user_rotation(None) == 0


def test_store_never_falls_back_to_the_originals_bucket():
    with pytest.raises(SystemExit, match="never writes to the originals bucket"):
        thumbnail_settings({"THUMBNAIL_STORAGE": "s3", "THUMBNAIL_S3_BUCKET": "t"})
    with pytest.raises(SystemExit, match="THUMBNAILS_PATH"):
        thumbnail_settings({"THUMBNAIL_STORAGE": "local"})


def test_store_writes_only_under_its_prefix(tmp_path):
    settings = thumbnail_settings(
        {
            "THUMBNAIL_STORAGE": "s3",
            "THUMBNAIL_S3_ENDPOINT": "http://127.0.0.1:9",
            "THUMBNAIL_S3_BUCKET": "thumbs",
            "THUMBNAIL_S3_ACCESS_KEY": "k",
            "THUMBNAIL_S3_SECRET_KEY": "s",
            "THUMBNAIL_S3_PREFIX": "/thumbnails/",
        }
    )
    store = ThumbnailStore(settings, 2)
    assert store.path_for("a/b.jpg", 3) == "thumbnails/a/b-3.jpeg"
    with pytest.raises(ValueError, match="outside the thumbnail prefix"):
        store.put("photos/a.jpg", b"x")

    local = ThumbnailStore(thumbnail_settings({"THUMBNAILS_PATH": str(tmp_path)}), 1)
    path = local.path_for("a/b.jpg", 3)
    assert path == f"{tmp_path}/3.jpeg"
    local.put(path, b"jpeg")
    assert local.get(path) == b"jpeg"
    assert CACHE_CONTROL == "public, max-age=31536000, immutable"
