"""The viewer's display rendition, made by the worker for HEIC: keys, pixels, file.

Keys come from fixtures/display_keys.json, written by the app's own code
(fixtures/display_keys.ts). Expected sizes were produced by sharp 0.33.5
(resize 2048 x 2048, fit inside, without enlargement) on the same inputs.
"""

from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
import pillow_heif
import pytest
from PIL import Image

from blaze_worker import display
from blaze_worker.thumbnail import fit_inside, load_source, render
from blaze_worker.thumbstore import ThumbnailStore, thumbnail_settings

from .test_thumbnail import Bucket, corner, jpeg, quadrants

pillow_heif.register_heif_opener()

FIXTURES = Path(__file__).parent / "fixtures"
CONNECTION = {
    "THUMBNAIL_S3_ENDPOINT": "http://127.0.0.1:9",
    "THUMBNAIL_S3_BUCKET": "thumbs",
    "THUMBNAIL_S3_ACCESS_KEY": "x",
    "THUMBNAIL_S3_SECRET_KEY": "x",
}


def heic(image: Image.Image, orientation: int = 1) -> bytes:
    """As an iPhone stores it: the sensor's pixels, the turn in the container (irot)."""
    out = io.BytesIO()
    exif = Image.Exif()
    if orientation != 1:
        exif[0x0112] = orientation
    image.save(out, "HEIF", quality=90, exif=exif.tobytes())
    return out.getvalue()


def made(data: bytes, rotation: int, key: str = "a.heic") -> Image.Image:
    """The stored rendition, decoded."""
    source = load_source(Bucket(data), key, "image/heic", display=display.fit)
    assert source.display is not None
    return Image.open(io.BytesIO(display.encode(display.render(source.display, rotation))))


CASES = json.loads((FIXTURES / "display_keys.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[f"{c['id']}-r{c['rotation']}" for c in CASES])
def test_key_is_the_one_the_app_reads(case):
    store = ThumbnailStore(thumbnail_settings({**CONNECTION, **case["settings"]}), 1)
    assert store.display_path_for(case["s3_key"], case["id"], case["rotation"]) == case["key"]


def test_fixture_covers_the_cases_that_differ():
    keys = [c["key"] for c in CASES]
    assert len(set(keys)) == len(keys)
    assert {c["rotation"] for c in CASES} == {0, 90, 180, 270}
    assert {c["settings"]["THUMBNAIL_STORAGE"] for c in CASES} == {"s3", "local"}
    # A decomposed accent, as macOS names files, stays decomposed
    assert any("e\u0301" in c["key"] for c in CASES)


def test_store_writes_renditions_next_to_thumbnails_only():
    settings = {**CONNECTION, "THUMBNAIL_STORAGE": "s3", "THUMBNAIL_S3_PREFIX": "a/thumbs"}
    store = ThumbnailStore(thumbnail_settings(settings), 1)
    written = []

    class Client:
        def put_object(self, **kwargs):
            written.append(kwargs)

    store._client = Client()  # type: ignore[assignment]
    key = store.display_path_for("x/y.heic", 4, 90)
    assert key == "a/display/x/y-4-v1-r90.jpg"
    store.put(key, b"jpeg")
    assert written == [
        {
            "Bucket": "thumbs",
            "Key": key,
            "Body": b"jpeg",
            "ContentType": "image/jpeg",
            "CacheControl": "public, max-age=31536000, immutable",
        }
    ]
    for outside in ("display/x/y-4-v1.jpg", "a/displayed/x.jpg", "a/photos/x.heic"):
        with pytest.raises(ValueError, match="outside the thumbnail prefixes"):
            store.put(outside, b"jpeg")
    assert store.display_location == "s3://thumbs/a/display"


def test_local_store_finds_what_it_wrote(tmp_path):
    store = ThumbnailStore(thumbnail_settings({"THUMBNAILS_PATH": str(tmp_path)}), 1)
    path = store.display_path_for("x/y.heic", 4, 0)
    assert path == f"{tmp_path}/display/4-v1.jpg"
    assert not store.exists(path)
    store.put(path, b"jpeg")
    assert store.exists(path) and store.get(path) == b"jpeg"


@pytest.mark.parametrize(
    ("mime", "key", "expected"),
    [
        ("image/heic", "a/IMG_1.HEIC", True),
        ("image/HEIF", "a/IMG_1.heif", True),
        ("image/jpeg", "a/IMG_1.jpg", False),
        ("image/avif", "a/IMG_1.avif", False),
        ("image/bmp", "a/IMG_1.bmp", False),
        ("image/x-adobe-dng", "a/IMG_1.dng", False),
        # RAW by its extension: the app makes it from the embedded JPEG
        ("image/heic", "a/IMG_1.dng", False),
    ],
)
def test_only_what_the_app_cannot_decode(mime, key, expected):
    assert display.applies(key, mime) is expected


@pytest.mark.parametrize(
    ("width", "height", "expected"),
    [
        (4032, 3024, (2048, 1536)),
        (3024, 4032, (1536, 2048)),
        (5712, 4284, (2048, 1536)),
        (8064, 6048, (2048, 1536)),
        (5000, 3333, (2048, 1365)),
        (4000, 2250, (2048, 1152)),
        (2049, 1000, (2048, 1000)),
        (3001, 4999, (1229, 2048)),
        (2048, 1536, (2048, 1536)),
        (1000, 800, (1000, 800)),
    ],
)
def test_size_is_the_one_sharp_writes(width, height, expected):
    assert fit_inside(width, height, display.DISPLAY_SIDE) == expected


def test_container_rotation_then_user_rotation_like_a_jpeg_with_exif():
    # Stored landscape and turned by the container: displayed as portrait
    stored = quadrants(4032, 3024)
    upright = made(heic(stored, orientation=6), 0)
    assert upright.size == (1536, 2048)
    assert corner(upright, 0.1, 0.1) == "blue"
    assert corner(upright, 0.9, 0.1) == "red"
    assert corner(upright, 0.9, 0.9) == "green"

    # The owner turned it a quarter clockwise on top
    turned = made(heic(stored, orientation=6), 90)
    assert turned.size == (2048, 1536)
    assert corner(turned, 0.9, 0.1) == "blue"
    assert corner(turned, 0.9, 0.9) == "red"

    # Same corners as the thumbnail the app shows for a JPEG stored that way
    for rotation in (0, 90, 180, 270):
        rendition = made(heic(stored, orientation=6), rotation)
        thumb = render(load_source(Bucket(jpeg(stored, 6)), "a.jpg", "image/jpeg"), rotation)
        assert (rendition.width > rendition.height) == (thumb.width > thumb.height)
        for x, y in ((0.1, 0.1), (0.9, 0.1), (0.1, 0.9), (0.9, 0.9)):
            assert corner(rendition, x, y) == corner(thumb, x, y), (rotation, x, y)


def test_small_photos_are_not_enlarged():
    assert made(heic(quadrants(800, 600)), 0).size == (800, 600)
    assert made(heic(quadrants(800, 600)), 270).size == (600, 800)


def test_file_is_a_bare_jpeg_at_quality_82():
    image = made(heic(quadrants(3000, 2000), orientation=6), 0)
    assert image.format == "JPEG" and image.mode == "RGB"
    assert image.info.get("progressive") and "icc_profile" not in image.info
    assert not image.getexif() and "exif" not in image.info
    reference = io.BytesIO()
    Image.new("RGB", (16, 16)).save(reference, "JPEG", quality=82, subsampling="4:2:0")
    assert image.quantization == Image.open(reference).quantization
    assert image.layer[0][1:3] == (2, 2)  # 4:2:0


def test_transparency_is_flattened_on_white():
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    image.paste((0, 0, 0, 255), (0, 0, 32, 64))
    pixels = np.asarray(display.render(image, 0).convert("L"))
    assert pixels[:, 36:].mean() > 245
    assert pixels[:, :28].mean() < 10


def test_full_size_picture_only():
    # A JPEG is decoded shrunk on load for the thumbnail: too small for the viewer
    data = jpeg(quadrants(4000, 3000))
    with pytest.raises(ValueError, match="full-size"):
        load_source(Bucket(data), "a.jpg", "image/jpeg", display=display.fit)
    source = load_source(Bucket(data), "a.jpg", "image/jpeg")
    assert source.display is None
