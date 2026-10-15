import assert from "node:assert/strict";
import test from "node:test";
import { keyboardUsage } from "../src/lib/keyboard-usage.ts";

const block = {
  id: "b",
  profile_id: "p",
  label: "Boire",
  status: "validated",
  stability: "adaptive",
};
const sequence = (id) => ({
  id,
  profile_id: "p",
  status: "completed",
  block_ids: ["b", "b"],
});
const meaning = (id) => ({
  id: "meaning-" + id,
  sequence_id: id,
  profile_id: "p",
  text: "Initial",
  corrected_text: "Je veux de l’eau",
  status: "corrected",
});
const memory = {
  sequences: [sequence("1"), sequence("2")],
  interpretations: [meaning("1"), meaning("2")],
  blocks: [],
  relations: [],
};

test("usage counts accepted messages once each, with the human correction, and never mutates placements", () => {
  const placements = [
    {
      profile_id: "p",
      block_id: "b",
      position: 4,
      zone: "personal",
      locked: false,
    },
  ];
  const before = structuredClone(placements);
  assert.deepEqual(keyboardUsage("p", memory, [block], placements), [
    { block, count: 2, examples: ["Je veux de l’eau", "Je veux de l’eau"] },
  ]);
  assert.deepEqual(placements, before);
});

test("foreign, unfinished, unaccepted, repeated rows and stable or unavailable touches cannot suggest a move", () => {
  for (const status of ["proposed", "rejected", "not_understood"])
    assert.deepEqual(
      keyboardUsage(
        "p",
        {
          ...memory,
          interpretations: [meaning("1"), { ...meaning("2"), status }],
        },
        [block],
        [],
      ),
      [],
    );
  for (const row of [
    { ...sequence("2"), profile_id: "other" },
    { ...sequence("2"), status: "in_progress" },
    sequence("1"),
  ])
    assert.deepEqual(
      keyboardUsage(
        "p",
        { ...memory, sequences: [sequence("1"), row] },
        [block],
        [],
      ),
      [],
    );
  for (const row of [
    { ...block, profile_id: "other" },
    { ...block, status: "rejected" },
    { ...block, stability: "stable" },
  ])
    assert.deepEqual(keyboardUsage("p", memory, [row], []), []);
  for (const row of [
    { zone: "stable", locked: false },
    { zone: "personal", locked: true },
  ])
    assert.deepEqual(
      keyboardUsage(
        "p",
        memory,
        [block],
        [{ profile_id: "p", block_id: "b", ...row }],
      ),
      [],
    );
});
