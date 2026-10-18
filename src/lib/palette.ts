/**
 * A folder's palette from its photos' palettes. The database sums the
 * photos' palette colors per coarse RGB bin (lib/database.ts); this folds
 * the heaviest bins into at most five colors a glance tells apart.
 */

/** One color of a palette and its part of it; parts sum to 1. */
export interface Swatch {
  hex: string;
  share: number;
}

/** Palette colors of many photos that fell in one bin: summed shares and share-weighted mean sRGB. */
export interface ColorBin {
  weight: number;
  r: number;
  g: number;
  b: number;
}

export const PALETTE_SIZE = 5;

/**
 * CIE76 distance under which two bins read as one color in a 4 px strip.
 * Adjacent RGB bins straddling a border (a grey sky split at 128) are a few
 * units apart; two colors a viewer names differently are 20+.
 */
const SAME_COLOR = 12;

/** Thinner than this, a segment is a sliver nobody sees. */
const MIN_SHARE = 0.02;

type Lab = [number, number, number];

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB 0..255 to CIE L*a*b* (D65), as the worker measures colors. */
export function srgbToLab(r: number, g: number, b: number): Lab {
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) =>
    t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function distance(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function toHex(r: number, g: number, b: number): string {
  const channel = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

interface Kept {
  weight: number;
  /** Share-weighted sums of the channels */
  r: number;
  g: number;
  b: number;
  lab: Lab;
}

/**
 * Heaviest bins first: a bin close to a color already kept adds to it (and
 * moves it toward itself), else it becomes the next color, up to `size`.
 * Shares are of the colors kept; slivers are left out. Empty when no bin
 * weighs anything.
 */
export function foldPalette(
  bins: readonly ColorBin[],
  size = PALETTE_SIZE,
): Swatch[] {
  const kept: Kept[] = [];
  const heaviest = [...bins]
    .filter((bin) => bin.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  for (const bin of heaviest) {
    const lab = srgbToLab(bin.r, bin.g, bin.b);
    const near = kept.find((k) => distance(k.lab, lab) < SAME_COLOR);
    if (near) {
      near.weight += bin.weight;
      near.r += bin.r * bin.weight;
      near.g += bin.g * bin.weight;
      near.b += bin.b * bin.weight;
      near.lab = srgbToLab(
        near.r / near.weight,
        near.g / near.weight,
        near.b / near.weight,
      );
    } else if (kept.length < size) {
      kept.push({
        weight: bin.weight,
        r: bin.r * bin.weight,
        g: bin.g * bin.weight,
        b: bin.b * bin.weight,
        lab,
      });
    }
  }
  const total = kept.reduce((sum, k) => sum + k.weight, 0);
  const visible = kept
    .filter((k) => k.weight / total >= MIN_SHARE)
    .sort((a, b) => b.weight - a.weight);
  const shown = visible.reduce((sum, k) => sum + k.weight, 0);
  return visible.map((k) => ({
    hex: toHex(k.r / k.weight, k.g / k.weight, k.b / k.weight),
    share: k.weight / shown,
  }));
}
