import assert from "node:assert/strict";
import test from "node:test";
import {
  pictograms,
  pictogramReference,
  pictogramFromReference,
  searchPictograms,
} from "../src/lib/pictograms.ts";

test("catalog search accepts accents, synonyms and several terms without changing order", () => {
  assert.deepEqual(
    searchPictograms("  TELEPHONE  ").map((item) => item.key),
    ["phone"],
  );
  assert.deepEqual(
    searchPictograms("téléphone mobile").map((item) => item.key),
    ["phone"],
  );
  assert.deepEqual(
    searchPictograms("repas").map((item) => item.key),
    ["eat"],
  );
  assert.deepEqual(
    searchPictograms("coeur").map((item) => item.key),
    ["love"],
  );
  assert.deepEqual(searchPictograms("telephone livre"), []);
  assert.deepEqual(searchPictograms("introuvable"), []);
  assert.deepEqual(searchPictograms(" \t "), pictograms);
});

test("category and query both filter the library; changing them never changes the catalog", () => {
  const original = structuredClone(pictograms);
  assert.ok(
    searchPictograms("", "needs").every((item) => item.category === "needs"),
  );
  assert.deepEqual(searchPictograms("phone", "needs"), []);
  assert.deepEqual(
    searchPictograms("portable", "activities").map((item) => item.key),
    ["phone"],
  );
  assert.deepEqual(pictograms, original);
});

test("every displayed drawing has a unique key and a stable local reference", () => {
  const keys = pictograms.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const item of pictograms)
    assert.equal(pictogramFromReference(pictogramReference(item.key)), item);
});
