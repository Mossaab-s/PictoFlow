import assert from "node:assert/strict";
import test from "node:test";
import {
  displays,
  displayStorageKey,
  parseDisplay,
  serializeDisplay,
  zoneDisplay,
} from "../src/lib/display.ts";
import { keyboardPage } from "../src/lib/keyboard.ts";

test("every display keeps stable anchors, free slots and pagination identical", () => {
  const tiles = [
    { block_id: "stop", position: 2 },
    { block_id: "help", position: 15 },
  ];
  const expected = keyboardPage(tiles, 1);
  for (const size of Object.keys(displays)) {
    const stable = zoneDisplay("stable", size);
    assert.equal(stable.columns, 4);
    assert.deepEqual(keyboardPage(tiles, 1, stable.size), expected);
    assert.equal(expected.slots[3], tiles[1]);
    assert.equal(expected.slots[0], null);
  }
});

test("changing personal display preserves every place, gap and distant touch", () => {
  const tiles = [0, 2, 5, 6, 11, 12, 999999].map((position) => ({
    position,
    block_id: `touch-${position}`,
  }));
  const before = structuredClone(tiles);
  for (const zone of ["personal", "adaptive"]) {
    for (const size of Object.keys(displays)) {
      const display = zoneDisplay(zone, size);
      for (const tile of tiles) {
        const page = keyboardPage(
          tiles,
          Math.floor(tile.position / display.size),
          display.size,
        );
        assert.ok(page.slots.length <= display.size);
        assert.equal(page.slots[tile.position - page.offset], tile);
      }
      assert.equal(keyboardPage(tiles, 0, display.size).slots[1], null);
    }
  }
  assert.deepEqual(tiles, before);
});

test("display persistence is scoped by profile and accepts only versioned choices", () => {
  assert.notEqual(displayStorageKey("first"), displayStorageKey("second"));
  for (const size of Object.keys(displays)) {
    assert.equal(parseDisplay(serializeDisplay(size)), size);
    assert.deepEqual(Object.keys(JSON.parse(serializeDisplay(size))), [
      "version",
      "size",
    ]);
  }
  for (const value of [
    null,
    "{broken",
    "null",
    '"large"',
    '{"version":2,"size":"large"}',
    '{"version":1,"size":"constructor"}',
    '{"version":1,"size":999999}',
    '{"version":1,"size":"<script>"}',
  ])
    assert.equal(parseDisplay(value), "standard");
});
