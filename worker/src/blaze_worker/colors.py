"""What colors a photo holds, weighted toward a large center, in CIE Lab/LCh.

Everything is measured on a copy at most 128 px long (the thumbnail's
pixels, reduced by area), upright as the owner sees it (EXIF orientation and
user_rotation), in the colors it is displayed with (no white balance
correction: a photo taken under tungsten light looks orange-brown on screen,
and that is what a color filter matches).

Weights. Each pixel counts exp(-dx^2 / 2 sx^2 - dy^2 / 2 sy^2), dx and dy
from the center, sx = sigma * width, sy = sigma * height. The owner asked
for "mostly the center", a large one, sky and faces included. At sigma 0.40
the border counts on average 0.36 of the center (corners 0.21) and the
central quarter of the frame carries 35% of the weight instead of 25%.
Measured on the library: a girl in a pink cardigan in the middle of a garden
reads pink 0.20 (0.16 unweighted), a red hoodie in the center red 0.38
(0.33), while the blue sky around a cathedral's spire still reads blue 0.21
(0.27 unweighted).

Hue shares. Every pixel spreads its weight over the 12 families with soft
boundaries (a hue on a border does not flip the photo from one family to the
other); shares sum to 1. See Params for the boundaries and why.

Palette. Weighted k-means (k = 5) in Lab from a deterministic start: the
colors and the weight each one carries, most important first.

Colorfulness: Hasler & Suesstrunk (2003) M, weighted. Chroma and luminance:
weighted means of C* and L*. Monochrome: 95% of the weight below C* 6.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

HUES = (
    "red",
    "orange",
    "yellow",
    "green",
    "teal",
    "blue",
    "purple",
    "pink",
    "brown",
    "black",
    "grey",
    "white",
)
_INDEX = {name: i for i, name in enumerate(HUES)}

# Algorithm version, stored with each row: a change of any parameter below is a new model
MODEL = "lab-center-v1"
CENTER_SIGMA = 0.40
SIDE = 128
PALETTE_SIZE = 5


@dataclass(frozen=True)
class Params:
    # Chroma C* below lo is neutral, above hi a color; linear in between
    chroma_lo: float = 6.0
    chroma_hi: float = 14.0
    # Warm, light, low-chroma pixels (skin, sand, beige walls) need more
    # chroma before they count as a color
    warm_chroma_lo: float = 10.0
    warm_chroma_hi: float = 24.0
    warm_hue: tuple[float, float] = (35.0, 90.0)
    warm_light: tuple[float, float] = (50.0, 65.0)
    # Neutral lightness: black below, white above (ramps)
    black: tuple[float, float] = (22.0, 32.0)
    white: tuple[float, float] = (72.0, 84.0)
    # Hue boundaries (degrees, Lab hue angle), going around: each family
    # runs from its boundary to the next one. Anchors: red objects 25-45,
    # orange 55-75, yellow 80-103, foliage 105-140, turquoise/cyan ~190,
    # blue sky and sea 255-275. Lab bends saturated dark blue toward purple:
    # LED violet and purple stage light measure 300-320, navy screens ~296,
    # magenta 328, hot pink ~350.
    bounds: tuple[tuple[str, float], ...] = (
        ("red", 18.0),
        ("orange", 50.0),
        ("yellow", 78.0),
        ("green", 103.0),
        ("teal", 165.0),
        ("blue", 215.0),
        ("purple", 300.0),
        ("pink", 338.0),
    )
    # Half-width of the soft transition at each boundary (degrees)
    soft: float = 6.0
    # Warm hues (red, orange, yellow): chroma ramp from earth tone to vivid.
    # Skin sits at hue 35-52 with C* 15-45 (measured on portraits under
    # flash, daylight and tungsten): there a color must be very saturated to
    # be red or orange. Sunsets, autumn leaves and gold sit at hue 60-90 with
    # C* 25-50: there a lower chroma is already orange or yellow.
    vivid_skin: tuple[float, float] = (40.0, 55.0)
    vivid_gold: tuple[float, float] = (22.0, 34.0)
    skin_to_gold_hue: tuple[float, float] = (52.0, 65.0)
    # Muted warm pixels lighter than this are pastel, not brown
    pastel_light: tuple[float, float] = (78.0, 88.0)
    # Muted reds below this hue and above this lightness are pink
    pink_hue: tuple[float, float] = (26.0, 34.0)
    pink_light: tuple[float, float] = (45.0, 55.0)
    # Vivid orange / yellow darker than this are brown
    dark_vivid_light: tuple[float, float] = (25.0, 40.0)
    # Monochrome: 95% of the (weighted) pixels below this chroma. B&W scans
    # measure 0-3.7, colorless fog and overcast 3-6, a muted color photo
    # with one small colored subject 6+
    mono_chroma: float = 6.0


DEFAULT = Params()


@dataclass(frozen=True)
class Colors:
    hues: tuple[float, ...]
    palette_hex: tuple[str, ...]
    palette_share: tuple[float, ...]
    colorfulness: float
    chroma: float
    luminance: float
    monochrome: bool
    # Not stored in photo_colors: the measure monochrome is decided on
    chroma_p95: float

    def named(self) -> dict[str, float]:
        return dict(zip(HUES, self.hues, strict=True))


# -- color space ----------------------------------------------------------------

_M = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ]
)
_M_INV = np.linalg.inv(_M)
_WHITE = np.array([0.95047, 1.0, 1.08883])
_EPS = (6 / 29) ** 3


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """uint8 or 0..255 float (..., 3) sRGB -> (..., 3) L*, a*, b* (D65)."""
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    linear = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    xyz = linear @ _M.T / _WHITE
    f = np.where(xyz > _EPS, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    lightness = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([lightness, a, b], axis=-1)


def lab_to_srgb(lab: np.ndarray) -> np.ndarray:
    """(..., 3) Lab -> (..., 3) sRGB 0..255 floats, clipped."""
    lab = np.asarray(lab, dtype=np.float64)
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], axis=-1)
    xyz = np.where(f > 6 / 29, f**3, 3 * (6 / 29) ** 2 * (f - 4 / 29)) * _WHITE
    linear = np.clip(xyz @ _M_INV.T, 0, 1)
    c = np.where(linear <= 0.0031308, 12.92 * linear, 1.055 * linear ** (1 / 2.4) - 0.055)
    return np.clip(c * 255, 0, 255)


def lab_to_hex(lab: np.ndarray) -> str:
    r, g, b = (round(float(v)) for v in lab_to_srgb(lab))
    return f"#{r:02x}{g:02x}{b:02x}"


# -- weights and memberships ------------------------------------------------------


def center_weights(height: int, width: int, sigma: float = CENTER_SIGMA) -> np.ndarray:
    if sigma <= 0:
        return np.ones((height, width))
    y = (np.arange(height) + 0.5) / height - 0.5
    x = (np.arange(width) + 0.5) / width - 0.5
    gy = np.exp(-(y**2) / (2 * sigma**2))
    gx = np.exp(-(x**2) / (2 * sigma**2))
    return np.outer(gy, gx)


def _ramp(value: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """0 at or below lo, 1 at or above hi, linear in between."""
    return np.clip((value - lo) / (hi - lo), 0.0, 1.0)


def _arc(hue: np.ndarray, start: float, end: float, soft: float) -> np.ndarray:
    """Membership of hue (degrees) in the arc start -> end (counterclockwise), soft edges."""
    span = (end - start) % 360
    offset = (hue - start) % 360
    # Distance inside the arc from its nearer edge (negative outside)
    inside = np.minimum(offset, span - offset)
    outside = np.minimum((start - hue) % 360, (hue - end) % 360)
    signed = np.where(offset <= span, inside, -outside)
    return np.clip(0.5 + signed / (2 * soft), 0.0, 1.0)


def memberships(lab: np.ndarray, params: Params = DEFAULT) -> np.ndarray:
    """(N, 3) Lab -> (N, 12) soft memberships in HUES order, rows summing to 1."""
    lightness, a, b = lab[:, 0], lab[:, 1], lab[:, 2]
    chroma = np.hypot(a, b)
    hue = np.degrees(np.arctan2(b, a)) % 360
    p = params

    warm = _arc(hue, p.warm_hue[0], p.warm_hue[1], p.soft) * _ramp(lightness, *p.warm_light)
    lo = p.chroma_lo + warm * (p.warm_chroma_lo - p.chroma_lo)
    hi = p.chroma_hi + warm * (p.warm_chroma_hi - p.chroma_hi)
    colored = np.clip((chroma - lo) / (hi - lo), 0.0, 1.0)
    neutral = 1.0 - colored

    out = np.zeros((lab.shape[0], len(HUES)))
    black = 1.0 - _ramp(lightness, *p.black)
    white = _ramp(lightness, *p.white)
    out[:, _INDEX["black"]] = neutral * black
    out[:, _INDEX["white"]] = neutral * white
    out[:, _INDEX["grey"]] = neutral * np.clip(1.0 - black - white, 0.0, 1.0)

    names = [name for name, _ in p.bounds]
    starts = [start for _, start in p.bounds]
    family = np.zeros((lab.shape[0], len(names)))
    for i, start in enumerate(starts):
        family[:, i] = _arc(hue, start, starts[(i + 1) % len(starts)], p.soft)
    family /= family.sum(axis=1, keepdims=True)
    hue_part = {name: family[:, i] * colored for i, name in enumerate(names)}

    # Warm hues need a vivid chroma to be red, orange or yellow. Below it
    # they are earth tones (wood, hair, skin, tungsten-lit walls): brown,
    # except muted reds that are light, or light and bluish-red (hue under
    # ~30: pink paper, pink clothes), which are pink. Muted orange and yellow
    # stay themselves only when very light (pastel); dark ones are brown even
    # when vivid.
    gold = _ramp(hue, *p.skin_to_gold_hue) * (hue < 180)
    vivid_lo = p.vivid_skin[0] + gold * (p.vivid_gold[0] - p.vivid_skin[0])
    vivid_hi = p.vivid_skin[1] + gold * (p.vivid_gold[1] - p.vivid_skin[1])
    muted = 1.0 - np.clip((chroma - vivid_lo) / (vivid_hi - vivid_lo), 0.0, 1.0)
    pastel = _ramp(lightness, *p.pastel_light)
    dark = (1.0 - muted) * (1.0 - _ramp(lightness, *p.dark_vivid_light))
    pinkish = np.maximum(pastel, (1.0 - _ramp(hue, *p.pink_hue)) * _ramp(lightness, *p.pink_light))
    red = hue_part["red"]
    hue_part["red"] = red * (1.0 - muted)
    hue_part["pink"] = hue_part["pink"] + red * muted * pinkish
    brown = red * muted * (1.0 - pinkish)
    for name in ("orange", "yellow"):
        moved = hue_part[name] * np.clip(muted * (1.0 - pastel) + dark, 0.0, 1.0)
        hue_part[name] = hue_part[name] - moved
        brown = brown + moved

    for name, values in hue_part.items():
        out[:, _INDEX[name]] = values
    out[:, _INDEX["brown"]] = brown
    return out


# -- palette -----------------------------------------------------------------------


def palette(lab: np.ndarray, weights: np.ndarray, k: int = PALETTE_SIZE, iterations: int = 30):
    """Weighted k-means in Lab; returns (centers, shares) sorted by share, empty clusters dropped.

    Pixels are first pooled by Lab rounded to 1 unit (weights summed): same
    result, a few times fewer points. Start: the heaviest point, then
    repeatedly the point with the largest weight x squared distance to the
    centers so far. No randomness: the same photo gives the same palette.
    """
    total = weights.sum()
    if total <= 0 or lab.shape[0] == 0:
        return np.zeros((0, 3)), np.zeros(0)
    keys, inverse = np.unique(np.round(lab).astype(np.int32), axis=0, return_inverse=True)
    inverse = inverse.reshape(-1)
    w = np.bincount(inverse, weights=weights, minlength=len(keys))
    points = (
        np.stack(
            [
                np.bincount(inverse, weights=weights * lab[:, i], minlength=len(keys))
                for i in range(3)
            ],
            axis=1,
        )
        / np.maximum(w, 1e-12)[:, None]
    )
    keep = w > 0
    points, w = points[keep], w[keep]
    squared = (points**2).sum(axis=1)

    def distances(c: np.ndarray) -> np.ndarray:
        return np.maximum(squared[:, None] - 2 * points @ c.T + (c**2).sum(axis=1)[None, :], 0)

    chosen = [int(np.argmax(w))]
    nearest = distances(points[chosen])[:, 0]
    for _ in range(1, k):
        score = nearest * w
        if score.max() <= 1e-9:
            break
        chosen.append(int(np.argmax(score)))
        nearest = np.minimum(nearest, distances(points[chosen[-1:]])[:, 0])
    c = points[chosen]
    n = len(c)
    for _ in range(iterations):
        label = distances(c).argmin(axis=1)
        mass = np.bincount(label, weights=w, minlength=n)
        sums = np.stack(
            [np.bincount(label, weights=w * points[:, i], minlength=n) for i in range(3)], axis=1
        )
        moved = np.where(mass[:, None] > 0, sums / np.maximum(mass, 1e-12)[:, None], c)
        done = np.allclose(moved, c, atol=1e-3)
        c = moved
        if done:
            break
    shares = np.bincount(distances(c).argmin(axis=1), weights=w, minlength=n) / total
    kept = shares > 0
    c, shares = c[kept], shares[kept]
    order = np.argsort(-shares, kind="stable")
    return c[order], shares[order]


# -- measures ------------------------------------------------------------------------


def _weighted_std(values: np.ndarray, weights: np.ndarray) -> tuple[float, float]:
    mean = float(np.average(values, weights=weights))
    var = float(np.average((values - mean) ** 2, weights=weights))
    return mean, var**0.5


def colorfulness(rgb: np.ndarray, weights: np.ndarray) -> float:
    """Hasler & Suesstrunk (2003) M on sRGB 0..255, weighted."""
    r, g, b = (rgb[:, i].astype(np.float64) for i in range(3))
    rg = r - g
    yb = 0.5 * (r + g) - b
    mean_rg, std_rg = _weighted_std(rg, weights)
    mean_yb, std_yb = _weighted_std(yb, weights)
    return float(np.hypot(std_rg, std_yb) + 0.3 * np.hypot(mean_rg, mean_yb))


def _weighted_percentile(values: np.ndarray, weights: np.ndarray, q: float) -> float:
    order = np.argsort(values)
    cumulative = np.cumsum(weights[order])
    index = np.searchsorted(cumulative, q * cumulative[-1])
    return float(values[order][min(index, len(values) - 1)])


def reduce(image: Image.Image, side: int = SIDE) -> Image.Image:
    """Area reduction to at most side px long (no enlargement)."""
    width, height = image.size
    scale = side / max(width, height)
    if scale >= 1:
        return image
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return image.resize(size, Image.Resampling.BOX)


def pixels(image: Image.Image, sigma: float = CENTER_SIGMA) -> tuple[np.ndarray, np.ndarray]:
    """(N, 3) sRGB and (N,) weights: center weight times alpha."""
    small = reduce(image)
    if small.mode == "RGBA":
        rgba = np.asarray(small, dtype=np.float64)
        rgb, alpha = rgba[..., :3], rgba[..., 3] / 255.0
    else:
        rgb = np.asarray(small.convert("RGB"), dtype=np.float64)
        alpha = np.ones(rgb.shape[:2])
    weights = center_weights(rgb.shape[0], rgb.shape[1], sigma) * alpha
    return rgb.reshape(-1, 3), weights.reshape(-1)


def analyze(image: Image.Image, sigma: float = CENTER_SIGMA, params: Params = DEFAULT) -> Colors:
    rgb, weights = pixels(image, sigma)
    if weights.sum() <= 0:
        # Fully transparent: nothing to see; count it as white
        weights = np.ones_like(weights)
    lab = srgb_to_lab(rgb)
    total = weights.sum()
    shares = (memberships(lab, params) * weights[:, None]).sum(axis=0) / total
    chroma_values = np.hypot(lab[:, 1], lab[:, 2])
    p95 = _weighted_percentile(chroma_values, weights, 0.95)
    centers, palette_shares = palette(lab, weights)
    return Colors(
        hues=tuple(round(float(v), 4) for v in shares),
        palette_hex=tuple(lab_to_hex(c) for c in centers),
        palette_share=tuple(round(float(s), 4) for s in palette_shares),
        colorfulness=round(colorfulness(rgb, weights), 2),
        chroma=round(float(np.average(chroma_values, weights=weights)), 2),
        luminance=round(float(np.average(lab[:, 0], weights=weights)), 2),
        monochrome=bool(p95 < params.mono_chroma),
        chroma_p95=round(p95, 2),
    )
