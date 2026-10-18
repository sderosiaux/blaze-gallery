import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ageOn,
  asFaceBox,
  folderDate,
  takenOn,
  turnBox,
  uprightTurn,
  type FaceBox,
} from "./faces";

const box: FaceBox = [0.1, 0.2, 0.3, 0.4];

function close(actual: number[], expected: number[]) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => {
    assert.ok(
      Math.abs(v - (expected[i] ?? NaN)) < 1e-9,
      `${v} vs ${expected[i]}`,
    );
  });
}

void test("a box follows the photo turned by hand, clockwise", () => {
  close(turnBox(box, 0), [0.1, 0.2, 0.3, 0.4]);
  close(turnBox(box, 90), [0.4, 0.1, 0.4, 0.3]);
  close(turnBox(box, 180), [0.6, 0.4, 0.3, 0.4]);
  close(turnBox(box, 270), [0.2, 0.6, 0.4, 0.3]);
});

void test("four quarter turns bring a box back", () => {
  let b = box;
  for (let i = 0; i < 4; i++) b = turnBox(b, 90);
  close(b, box);
});

void test("photo 110417: a face found turned 90, on a photo turned 90 by hand", () => {
  // Stored values of face 1609; the viewer draws it here, upright
  const stored: FaceBox = [0.1921652, 0.30931345, 0.2956662, 0.3598983];
  close(turnBox(stored, 90), [
    1 - 0.30931345 - 0.3598983,
    0.1921652,
    0.3598983,
    0.2956662,
  ]);
  assert.equal(uprightTurn(90, 90), 0);
});

void test("the turn that stands a face up undoes what the hand rotation did not", () => {
  assert.equal(uprightTurn(0, 0), 0);
  assert.equal(uprightTurn(90, 0), 90);
  assert.equal(uprightTurn(270, 0), 270);
  assert.equal(uprightTurn(0, 90), 270);
  assert.equal(uprightTurn(270, 90), 180);
});

void test("a box comes from the database as four finite numbers, or not at all", () => {
  close(asFaceBox([0.1, "0.2", 0.3, 0.4]) ?? [], [0.1, 0.2, 0.3, 0.4]);
  assert.equal(asFaceBox([0.1, 0.2, 0.3]), null);
  assert.equal(asFaceBox([0.1, 0.2, 0.3, "x"]), null);
  assert.equal(asFaceBox(null), null);
});

void test("the folder date is the deepest folder named with one, like the worker", () => {
  assert.equal(
    folderDate(
      "pc-fixe/A TRIER/TODO/PHOTOS 2/2011-04-30 Mariage/mariage civil celine stefi 5",
    ),
    "2011-04-30T00:00:00.000Z",
  );
  assert.equal(folderDate("a/2018-01 ski"), "2018-01-01T00:00:00.000Z");
  assert.equal(folderDate("pc-fixe/Backup Windows Phone"), null);
  assert.equal(folderDate(null), null);
});

void test("EXIF wins unless the folder disagrees by more than six months", () => {
  const wedding = "x/2011-04-30 Mariage/civil";
  // Photo 223694: the camera clock said June 2010
  assert.deepEqual(takenOn("2010-06-30T01:42:50.000Z", wedding), {
    taken: "2011-04-30T00:00:00.000Z",
    source: "folder",
  });
  assert.deepEqual(takenOn("2011-05-02T10:00:00.000Z", wedding), {
    taken: "2011-05-02T10:00:00.000Z",
    source: "exif",
  });
  assert.deepEqual(takenOn(undefined, wedding), {
    taken: "2011-04-30T00:00:00.000Z",
    source: "folder",
  });
  assert.deepEqual(
    takenOn("2014-11-29T17:17:15.000Z", "x/Backup Windows Phone"),
    {
      taken: "2014-11-29T17:17:15.000Z",
      source: "exif",
    },
  );
  assert.deepEqual(takenOn(null, "x/y"), { taken: null, source: null });
});

void test("an age needs a birth date: none is guessed", () => {
  assert.equal(ageOn(null, "2020-01-01T00:00:00.000Z"), null);
  assert.equal(ageOn("2000-03-15", "2018-03-14T12:00:00.000Z"), 17);
  assert.equal(ageOn("2000-03-15", "2018-03-15T12:00:00.000Z"), 18);
  assert.equal(ageOn("2000-03-15", "1999-12-31T00:00:00.000Z"), null);
});
