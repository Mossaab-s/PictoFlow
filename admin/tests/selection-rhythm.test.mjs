import test from "node:test";
import assert from "node:assert/strict";
import { selectionObservation } from "../src/lib/selection-rhythm.ts";

test("a new message begins a new observation; previous network blocking is distinguished", () => {
  assert.deepEqual(selectionObservation(null, "first", 100, "pointer"), {
    interval_ms: null,
    blocked_ms: 0,
    input_method: "pointer",
  });
  const previous = { sequenceId: "first", clickedAt: 100, releasedAt: 600 };
  assert.deepEqual(selectionObservation(previous, "first", 1400, "keyboard"), {
    interval_ms: 1300,
    blocked_ms: 500,
    input_method: "keyboard",
  });
  assert.equal(
    selectionObservation(previous, "second", 1400, "pointer").interval_ms,
    null,
  );
});

test("clock resets and excessive gaps start again without invented timing", () => {
  const previous = { sequenceId: "first", clickedAt: 100, releasedAt: 600 };
  for (const now of [0, NaN, Infinity, 86400200]) {
    assert.equal(
      selectionObservation(previous, "first", now, "unknown").interval_ms,
      null,
    );
  }
  const rounded = selectionObservation(previous, "first", 599.6, "pointer");
  assert(rounded.blocked_ms <= rounded.interval_ms);
});
