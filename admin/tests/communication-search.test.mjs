import assert from "node:assert/strict";
import test from "node:test";
import { findCommunicationTouches } from "../src/lib/communication-search.ts";

const profile = "person-a";
const groups = [
  { id: "needs", profile_id: profile, label: "Besoins" },
  { id: "outings", profile_id: profile, label: "Sorties", status: "active" },
  { id: "old", profile_id: profile, label: "Ancienne", status: "archived" },
  { id: "foreign", profile_id: "person-b", label: "Secret" },
];
function tile(id, label, group = null, extra = {}) {
  return {
    profile_id: profile,
    block_id: id,
    zone: "personal",
    position: 2,
    locked: false,
    group_id: group,
    block: {
      id,
      profile_id: profile,
      label,
      status: "validated",
      concept_id: `concept-${id}`,
      representation_id: `image-${id}`,
      canonical_intent: "Boire dans mon verre",
      origin: "human",
      stability: "adaptive",
    },
    ...extra,
  };
}
const water = tile("water", "Eau", "needs");
const pool = tile("pool", "Eau", "outings");
const heart = tile("heart", "Mon cœur préféré");
const mother = tile("mother", "Maman", null, { zone: "stable", locked: true });
const tiles = [water, pool, heart, mother];
const find = (query, source = tiles) =>
  findCommunicationTouches(profile, source, groups, query);

test("lookup matches displayed personal words across pages, ignoring case, accents and œ", () => {
  assert.deepEqual(
    find(" EAU ").map((t) => t.block_id),
    ["water", "pool"],
  );
  assert.deepEqual(
    find("prefere COEUR").map((t) => t.block_id),
    ["heart"],
  );
  assert.deepEqual(
    find("maman").map((t) => t.block_id),
    ["mother"],
  );
  assert.deepEqual(find("boire"), []); // No inferred meaning or catalogue synonym.
  assert.deepEqual(find(""), []);
  assert.deepEqual(find("   "), []);
});
test("lookup rejects foreign or nonvalidated touches and unavailable pages before rendering words", () => {
  const rejected = [
    { ...water, profile_id: "person-b" },
    { ...water, block: { ...water.block, profile_id: "person-b" } },
    { ...water, block_id: "other" },
    ...["proposed", "rejected", "archived"].map((status) => ({
      ...water,
      block: { ...water.block, status },
    })),
    { ...water, group_id: "old" },
    { ...water, group_id: "unknown" },
    { ...water, group_id: "foreign" },
    { ...water, zone: "stable", group_id: "needs" },
    { ...water, zone: "unknown" },
    { ...water, position: -1 },
    { ...water, position: 0.5 },
  ];
  assert.deepEqual(find("Eau", rejected), []);
});
test("different touches with the same word remain distinct; repeated input identities appear once without reordering", () => {
  const result = find("Eau", [water, water, pool, pool]);
  assert.deepEqual(
    result.map((t) => t.block_id),
    ["water", "pool"],
  );
  assert.equal(result[0].group_id, "needs");
  assert.equal(result[1].group_id, "outings");
  assert.equal(result[0].position, 2);
});
test("lookup keeps owned validated images and strips foreign, stale or mismatched representations without losing the word", () => {
  const representation = {
    id: "image-water",
    profile_id: profile,
    concept_id: "concept-water",
    type: "pictogram",
    source: "pictoflow",
    asset_reference: "fixture",
    status: "validated",
  };
  const withImage = { ...water, representation };
  assert.deepEqual(find("Eau", [withImage])[0].representation, representation);
  for (const changed of [
    { profile_id: "person-b" },
    { concept_id: "other" },
    { id: "other" },
    { status: "proposed" },
    { status: "archived" },
  ]) {
    const input = {
      ...water,
      representation: { ...representation, ...changed },
    };
    const result = find("Eau", [input]);
    assert.equal(result[0].block_id, "water");
    assert.equal(result[0].representation, undefined);
    assert.deepEqual(input.representation, { ...representation, ...changed });
  }
});
