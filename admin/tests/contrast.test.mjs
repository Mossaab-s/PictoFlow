import assert from "node:assert/strict";
import test from "node:test";
import {
  contrastStorageKey,
  parseContrast,
  serializeContrast,
} from "../src/lib/contrast.ts";

test("contrast is an isolated presentation choice and rejects stale or damaged values", () => {
  assert.notEqual(contrastStorageKey("first"), contrastStorageKey("second"));
  assert.equal(parseContrast(serializeContrast(true)), true);
  assert.equal(parseContrast(serializeContrast(false)), false);
  assert.deepEqual(Object.keys(JSON.parse(serializeContrast(true))), [
    "version",
    "enhanced",
  ]);
  for (const bad of [
    null,
    "{bad",
    "null",
    '{"version":2,"enhanced":true}',
    '{"version":1,"enhanced":"true"}',
    "true",
  ])
    assert.equal(parseContrast(bad), false);
});
