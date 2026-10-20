import assert from "node:assert/strict";
import test from "node:test";
import { insertedMessage } from "../src/lib/message-insertion.ts";

test("insertion previews preserve all occurrences around every gap, including equal identities", () => {
  const original = ["mother", "water", "book", "water"];
  for (let gap = 0; gap <= original.length; gap++) {
    const result = insertedMessage(original, "water", gap);
    assert.equal(result[gap], "water");
    assert.deepEqual(
      [...result.slice(0, gap), ...result.slice(gap + 1)],
      original,
    );
  }
  assert.deepEqual(original, ["mother", "water", "book", "water"]);
  const words = original.map((label) => ({ label }));
  const added = { label: "new" };
  assert.strictEqual(insertedMessage(words, added, 0)[0], added);
  assert.strictEqual(insertedMessage(words, added, 0)[1], words[0]);
});

test("insertion previews reach 32 selections and reject empty/full drafts or invalid gaps", () => {
  assert.deepEqual(insertedMessage(["a"], "b", 1), ["a", "b"]);
  assert.deepEqual(insertedMessage(Array(31).fill("a"), "b", 31), [
    ...Array(31).fill("a"),
    "b",
  ]);
  for (const [items, gap] of [
    [[], 0],
    [Array(32).fill("a"), 0],
    [["a"], -1],
    [["a"], 2],
    [["a"], true],
    [["a"], 0.5],
    [["a"], "0"],
  ]) {
    assert.equal(insertedMessage(items, "b", gap), null);
  }
});
