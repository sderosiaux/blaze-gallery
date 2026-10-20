import assert from "node:assert/strict";
import { test } from "node:test";
import { createHoldToConfirm } from "./holdToConfirm";

void test("a full second confirms once, even if the press repeats or continues", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const confirm = t.mock.fn();
  const hold = createHoldToConfirm(confirm);
  hold.start();
  t.mock.timers.tick(999);
  assert.equal(confirm.mock.callCount(), 0);
  hold.start();
  t.mock.timers.tick(1);
  assert.equal(confirm.mock.callCount(), 1);
  hold.start();
  t.mock.timers.tick(5000);
  assert.equal(confirm.mock.callCount(), 1);
  hold.cancel();
});

void test("release, leaving the button or unmount cancels a pending confirmation", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const confirm = t.mock.fn();
  const hold = createHoldToConfirm(confirm);
  hold.start();
  t.mock.timers.tick(999);
  hold.cancel();
  t.mock.timers.tick(5000);
  assert.equal(confirm.mock.callCount(), 0);
});

void test("separate short presses do not accumulate; a fresh hold gets a full second", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const confirm = t.mock.fn();
  const hold = createHoldToConfirm(confirm);
  for (let i = 0; i < 3; i++) {
    hold.start();
    t.mock.timers.tick(600);
    hold.cancel();
  }
  hold.start();
  t.mock.timers.tick(999);
  assert.equal(confirm.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(confirm.mock.callCount(), 1);
  hold.cancel();
});
