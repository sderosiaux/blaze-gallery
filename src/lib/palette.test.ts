import assert from "node:assert/strict";
import { test } from "node:test";
import type { ColorBin } from "./palette";
import { foldPalette, srgbToLab } from "./palette";

const bin = (weight: number, r: number, g: number, b: number): ColorBin => ({
  weight,
  r,
  g,
  b,
});

const close = (actual: number, expected: number, tolerance = 0.05) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
};

void test("srgbToLab matches the reference values the worker uses", () => {
  const [l, a, b] = srgbToLab(255, 0, 0);
  close(l, 53.24);
  close(a, 80.09);
  close(b, 67.2);
  const [lw, aw, bw] = srgbToLab(255, 255, 255);
  close(lw, 100);
  close(aw, 0);
  close(bw, 0);
});

void test("two bins of one grey split by a border become one color", () => {
  const palette = foldPalette([
    bin(0.3, 126, 126, 126),
    bin(0.2, 130, 130, 130),
  ]);
  assert.equal(palette.length, 1);
  assert.equal(palette[0]?.share, 1);
  // Moved toward the lighter half by its weight: (126*.3 + 130*.2) / .5
  assert.equal(palette[0]?.hex, "#808080");
});

void test("keeps at most five colors, heaviest first, shares summing to 1", () => {
  const palette = foldPalette([
    bin(0.05, 250, 250, 250),
    bin(0.3, 20, 60, 200),
    bin(0.2, 30, 150, 40),
    bin(0.15, 200, 30, 30),
    bin(0.1, 240, 200, 20),
    bin(0.12, 120, 60, 20),
    bin(0.08, 150, 40, 160),
  ]);
  assert.equal(palette.length, 5);
  assert.deepEqual(
    palette.map((s) => s.hex),
    ["#143cc8", "#1e9628", "#c81e1e", "#783c14", "#f0c814"],
  );
  close(
    palette.reduce((sum, s) => sum + s.share, 0),
    1,
    1e-3,
  );
});

void test("a merge that makes a color heavier moves it up", () => {
  const palette = foldPalette([
    bin(0.3, 200, 30, 30),
    bin(0.25, 20, 60, 200),
    bin(0.2, 22, 62, 204),
  ]);
  assert.deepEqual(
    palette.map((s) => s.hex.slice(0, 3)),
    ["#15", "#c8"],
  );
});

void test("slivers are left out and the rest fills the strip", () => {
  const palette = foldPalette([bin(0.99, 20, 60, 200), bin(0.01, 200, 30, 30)]);
  assert.deepEqual(palette, [{ hex: "#143cc8", share: 1 }]);
});

void test("no weight, no palette", () => {
  assert.deepEqual(foldPalette([]), []);
  assert.deepEqual(foldPalette([bin(0, 10, 10, 10)]), []);
});
