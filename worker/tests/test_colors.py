"""Color measures on synthetic pictures whose answer is known."""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from blaze_worker import colors as C

SCHEMA = Path(__file__).resolve().parents[2] / "db" / "schema.sql"


def solid(rgb: tuple[int, int, int], size: tuple[int, int] = (120, 90)) -> Image.Image:
    return Image.new("RGB", size, rgb)


def top(found: C.Colors) -> str:
    return C.HUES[int(np.argmax(found.hues))]


def test_lab_matches_reference_values():
    lab = C.srgb_to_lab(np.array([[255, 255, 255], [255, 0, 0], [0, 0, 255], [0, 0, 0]]))
    assert lab[0] == pytest.approx([100, 0, 0], abs=0.01)
    assert lab[1] == pytest.approx([53.24, 80.09, 67.20], abs=0.05)
    assert lab[2] == pytest.approx([32.30, 79.19, -107.86], abs=0.05)
    assert lab[3] == pytest.approx([0, 0, 0], abs=0.01)
    back = C.lab_to_srgb(lab)
    assert back == pytest.approx(
        np.array([[255, 255, 255], [255, 0, 0], [0, 0, 255], [0, 0, 0]]), abs=0.5
    )


def test_red_center_on_blue_border_is_red_only_with_the_center_weight():
    # A red square covering 41% of the frame, in the middle of a blue one
    size = 200
    image = Image.new("RGB", (size, size), (40, 90, 200))
    side = round(size * 0.64)
    corner = (size - side) // 2
    image.paste((210, 25, 30), (corner, corner, corner + side, corner + side))

    weighted = C.analyze(image).named()
    flat = C.analyze(image, sigma=0).named()

    assert weighted["red"] > weighted["blue"]
    assert flat["red"] < flat["blue"]
    assert flat["red"] == pytest.approx(0.41, abs=0.02)
    assert weighted["red"] == pytest.approx(0.53, abs=0.03)


def test_grey_card_is_neutral_grey():
    found = C.analyze(solid((128, 128, 128)))
    assert found.named()["grey"] == pytest.approx(1.0, abs=1e-6)
    assert found.colorfulness < 1
    assert found.chroma < 1
    assert found.palette_hex == ("#808080",)
    assert found.palette_share == (1.0,)


def test_black_and_white_photo_is_monochrome():
    rng = np.random.default_rng(7)
    grey = np.add.outer(np.arange(90), np.arange(120)) * 1.2 + rng.normal(0, 12, (90, 120))
    image = Image.fromarray(grey.clip(0, 255).astype(np.uint8), "L")
    found = C.analyze(image)
    assert found.monochrome
    named = found.named()
    assert named["black"] + named["grey"] + named["white"] == pytest.approx(1.0, abs=1e-6)


def test_a_grey_photo_with_a_small_colored_subject_is_not_monochrome():
    # Overcast grey scene with a red jacket in the middle
    image = solid((150, 146, 140), (160, 120))
    image.paste((190, 30, 35), (72, 48, 92, 80))
    found = C.analyze(image)
    assert not found.monochrome
    assert found.named()["red"] >= 0.03


def test_a_faintly_tinted_photo_is_neutral_not_monochrome():
    # Beige-grey, no subject: "Neutres" (colorfulness < 15), not black and white
    rng = np.random.default_rng(5)
    base = np.array([168, 156, 138]) + rng.normal(0, 6, (90, 120, 1))
    found = C.analyze(Image.fromarray(base.clip(0, 255).astype(np.uint8), "RGB"))
    assert not found.monochrome
    assert found.colorfulness < 15


@pytest.mark.parametrize(
    ("rgb", "family"),
    [
        ((200, 20, 30), "red"),
        ((255, 140, 0), "orange"),
        ((250, 215, 30), "yellow"),
        ((60, 140, 50), "green"),
        ((0, 128, 128), "teal"),
        ((100, 150, 220), "blue"),
        ((30, 60, 160), "blue"),
        ((128, 0, 128), "purple"),
        ((255, 105, 180), "pink"),
        ((240, 175, 185), "pink"),
        ((120, 70, 30), "brown"),
        ((245, 245, 245), "white"),
        ((12, 12, 12), "black"),
        ((128, 128, 128), "grey"),
    ],
)
def test_named_colors_land_in_their_family(rgb, family):
    assert top(C.analyze(solid(rgb))) == family


# Medians of faces measured on the library (L*, C*, hue): flash, flushed,
# daylight, tungsten, light skin
@pytest.mark.parametrize(
    "skin", [(64, 31, 41), (57, 39, 45), (60, 18, 48), (46, 29, 50), (74, 28, 58), (80, 19, 54)]
)
def test_skin_is_not_orange_or_red(skin):
    lightness, chroma, hue = skin
    lab = np.array([lightness, chroma * np.cos(np.radians(hue)), chroma * np.sin(np.radians(hue))])
    rgb = tuple(round(float(v)) for v in C.lab_to_srgb(lab))
    named = C.analyze(solid(rgb)).named()
    assert named["orange"] < 0.2
    assert named["red"] < 0.2


def test_shares_sum_to_one_and_follow_the_schema_order():
    rng = np.random.default_rng(1)
    image = Image.fromarray(rng.integers(0, 256, (64, 96, 3), dtype=np.uint8), "RGB")
    found = C.analyze(image)
    assert len(found.hues) == 12
    assert sum(found.hues) == pytest.approx(1.0, abs=1e-3)
    assert sum(found.palette_share) == pytest.approx(1.0, abs=1e-3)
    assert 1 <= len(found.palette_hex) <= 5
    # The SQL comment on photo_colors is the contract for the UI and MCP
    text = SCHEMA.read_text()
    order = text[text.index("ALWAYS in this order") :].split("\n")[1:3]
    listed = re.findall(r"(\d+) ([a-z]+)", " ".join(order))
    assert [int(n) for n, _ in listed] == list(range(1, 13))
    assert [name for _, name in listed] == list(C.HUES)


def test_palette_is_deterministic_and_finds_both_colors():
    image = solid((20, 60, 200), (100, 100))
    image.paste((230, 200, 20), (0, 0, 100, 30))
    first = C.analyze(image)
    second = C.analyze(image)
    assert first == second
    assert set(first.palette_hex) == {"#143cc8", "#e6c814"}
    assert first.palette_hex[0] == "#143cc8"


def test_quarter_turns_change_nothing():
    rng = np.random.default_rng(3)
    image = Image.fromarray(rng.integers(0, 256, (60, 100, 3), dtype=np.uint8), "RGB")
    image.paste((220, 30, 30), (40, 20, 60, 40))
    a = C.analyze(image)
    b = C.analyze(image.transpose(Image.Transpose.ROTATE_90))
    assert a.hues == pytest.approx(b.hues, abs=2e-3)
    assert a.colorfulness == pytest.approx(b.colorfulness, abs=0.05)


def test_transparent_pixels_do_not_count():
    image = Image.new("RGBA", (100, 100), (255, 0, 0, 0))
    image.paste((30, 160, 40, 255), (25, 25, 75, 75))
    named = C.analyze(image).named()
    assert named["green"] == pytest.approx(1.0, abs=1e-3)


def test_weights_and_measures_scale():
    weights = C.center_weights(101, 201, 0.4)
    assert weights[50, 100] == pytest.approx(1.0, abs=1e-3)
    # Middle of an edge and corner at sigma 0.4
    assert weights[50, 0] == pytest.approx(np.exp(-0.25 / 0.32), abs=0.01)
    assert weights[0, 0] == pytest.approx(np.exp(-0.5 / 0.32), abs=0.01)
    assert C.analyze(solid((255, 0, 255))).colorfulness > 80
    assert C.analyze(solid((10, 10, 10))).luminance < 5
