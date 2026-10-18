"""A picture of what colors.py measured: the thumbnail, its 12 shares, its palette."""

from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont

from .colors import HUES, Colors

# Display swatch per family (drawing only)
SWATCHES = {
    "red": "#d62828",
    "orange": "#f77f00",
    "yellow": "#f6c90e",
    "green": "#2a9d3f",
    "teal": "#14b8a6",
    "blue": "#1d4ed8",
    "purple": "#7b2cbf",
    "pink": "#f472b6",
    "brown": "#8b5a2b",
    "black": "#111111",
    "grey": "#8a8a8a",
    "white": "#f4f4f4",
}

_PANEL = 380
_ROW = 20


def draw(thumbnail: Image.Image, found: Colors, title: str) -> Image.Image:
    image = thumbnail.convert("RGB")
    height = max(image.height, 40 + _ROW * len(HUES) + 120)
    canvas = Image.new("RGB", (image.width + _PANEL + 30, height + 70), "white")
    canvas.paste(image, (10, 30))
    pen = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=13)
    pen.text((10, 8), title, fill="black", font=font)

    x0 = image.width + 30
    pen.text((x0, 30), "hues (weighted shares)", fill="black", font=font)
    for i, (name, share) in enumerate(zip(HUES, found.hues, strict=True)):
        y = 52 + i * _ROW
        pen.text((x0, y), f"{name:7s} {share:5.2f}", fill="black", font=font)
        pen.rectangle((x0 + 100, y + 2, x0 + 100 + 260, y + 14), outline="#dddddd")
        pen.rectangle((x0 + 100, y + 2, x0 + 100 + 260 * share, y + 14), fill=SWATCHES[name])

    y = 52 + len(HUES) * _ROW + 12
    pen.text((x0, y), "palette", fill="black", font=font)
    x = float(x0)
    for hexa, share in zip(found.palette_hex, found.palette_share, strict=True):
        width = share * _PANEL
        pen.rectangle((x, y + 20, x + width, y + 56), fill=hexa)
        x += width
    for i, (hexa, share) in enumerate(zip(found.palette_hex, found.palette_share, strict=True)):
        column, line = divmod(i, 3)
        pen.text(
            (x0 + column * 130, y + 62 + line * 16), f"{hexa} {share:.2f}", fill="black", font=font
        )
    pen.text(
        (10, height + 40),
        f"colorfulness {found.colorfulness:.1f}   chroma {found.chroma:.1f}   "
        f"luminance {found.luminance:.1f}   monochrome {found.monochrome}",
        fill="black",
        font=font,
    )
    # The palette strip as it would sit under a cover
    x = 10.0
    for hexa, share in zip(found.palette_hex, found.palette_share, strict=True):
        width = share * image.width
        pen.rectangle((x, 32 + image.height, x + width, 40 + image.height), fill=hexa)
        x += width
    return canvas
