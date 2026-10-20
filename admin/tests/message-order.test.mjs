import assert from "node:assert/strict";
import test from "node:test";
import { movedMessage } from "../src/lib/message-order.ts";

test("move previews preserve every occurrence and use the final destination in both directions", () => {
  const original = ["water", "mother", "book", "water"];
  assert.deepEqual(movedMessage(original, 1, 0), [
    "mother",
    "water",
    "book",
    "water",
  ]);
  assert.deepEqual(movedMessage(original, 0, 3), [
    "mother",
    "book",
    "water",
    "water",
  ]);
  assert.deepEqual(movedMessage(original, 3, 1), [
    "water",
    "water",
    "mother",
    "book",
  ]);
  assert.deepEqual(original, ["water", "mother", "book", "water"]);
  const words = original.map((label, index) => ({ label, index }));
  assert.strictEqual(movedMessage(words, 3, 1)[1], words[3]);
  assert.strictEqual(movedMessage(words, 3, 1)[0], words[0]);
});

test("preview guards preserve empty/single/full boundaries and reject invalid positions", () => {
  for (const [items, from, to] of [
    [[], 0, 0],
    [["a"], 0, 0],
    [Array(33).fill("a"), 0, 1],
    [["a", "b"], -1, 1],
    [["a", "b"], 0, 2],
    [["a", "b"], true, 1],
    [["a", "b"], 0, 1.5],
  ])
    assert.equal(movedMessage(items, from, to), null);
  assert.deepEqual(movedMessage([...Array(31).fill("a"), "b"], 31, 0), [
    "b",
    ...Array(31).fill("a"),
  ]);
  assert.deepEqual(movedMessage(["a", "a"], 0, 1), ["a", "a"]);
});
