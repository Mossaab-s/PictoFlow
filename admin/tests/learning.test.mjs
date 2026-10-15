import assert from "node:assert/strict";
import test from "node:test";
import { compositionMemory, replayAvailable } from "../src/lib/learning.ts";

const current = {
  id: "now",
  profile_id: "p",
  status: "completed",
  block_ids: ["a", "b", "b"],
};
const previous = { ...current, id: "before" };
const item = {
  id: "meaning",
  profile_id: "p",
  sequence_id: "before",
  status: "corrected",
  text: "Proposition",
  corrected_text: "Ma phrase choisie",
  created_at: "2026-10-15T10:00:00Z",
  source: "fake",
};
const memory = {
  sequences: [previous],
  interpretations: [item],
  blocks: [],
  relations: [],
};

test("PCL recall requires accepted human meaning and preserves corrections without promoting a new message", () => {
  assert.deepEqual(compositionMemory("p", current, memory), {
    retained: null,
    previous: [item],
  });
  for (const status of ["proposed", "rejected", "not_understood"]) {
    assert.deepEqual(
      compositionMemory("p", current, {
        ...memory,
        interpretations: [{ ...item, status, confidence: 1 }],
      }).previous,
      [],
    );
  }
  assert.equal(
    compositionMemory("p", current, {
      ...memory,
      interpretations: [{ ...item, sequence_id: current.id }],
      sequences: [current],
    }).retained.corrected_text,
    "Ma phrase choisie",
  );
  assert.equal(current.status, "completed");
});

test("same touches means same order and repetitions in the same profile and declared context", () => {
  for (const sequence of [
    { ...previous, block_ids: ["a", "b"] },
    { ...previous, block_ids: ["b", "a", "b"] },
    { ...previous, profile_id: "other" },
    { ...previous, context_id: "other-context" },
    { ...previous, status: "in_progress" },
  ])
    assert.equal(
      compositionMemory("p", current, { ...memory, sequences: [sequence] })
        .previous.length,
      0,
    );
  assert.equal(
    compositionMemory("p", { ...current, profile_id: "other" }, memory).previous
      .length,
    0,
  );
  assert.equal(
    compositionMemory("p", current, {
      ...memory,
      interpretations: [{ ...item, profile_id: "other" }],
    }).previous.length,
    0,
  );
  assert.equal(
    compositionMemory("p", current, {
      ...memory,
      interpretations: [{ ...item, corrected_text: "" }],
    }).previous.length,
    0,
  );
});

test("current accepted meaning stays distinct from a bounded, deduplicated history", () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({
    ...item,
    id: String(index),
    corrected_text: "Phrase " + index,
    created_at: `2026-10-15T10:00:0${index}Z`,
  }));
  const retained = { ...item, id: "retained", sequence_id: current.id };
  const result = compositionMemory("p", current, {
    ...memory,
    sequences: [current, previous],
    interpretations: [...rows, retained, { ...rows[5], id: "duplicate" }],
  });
  assert.equal(result.retained, retained);
  assert.deepEqual(
    result.previous.map((row) => row.corrected_text),
    ["Phrase 5", "Phrase 4", "Phrase 3"],
  );
});

test("replaying a composition needs all validated touches and keeps duplicates", () => {
  const blocks = ["a", "b"].map((id) => ({
    id,
    profile_id: "p",
    status: "validated",
  }));
  assert(replayAvailable("p", current, blocks));
  assert.deepEqual(current.block_ids, ["a", "b", "b"]);
  assert.equal(replayAvailable("p", current, blocks.slice(0, 1)), false);
  assert.equal(
    replayAvailable(
      "p",
      current,
      blocks.map((block) => ({ ...block, profile_id: "other" })),
    ),
    false,
  );
  assert.equal(
    replayAvailable(
      "p",
      current,
      blocks.map((block) => ({ ...block, status: "rejected" })),
    ),
    false,
  );
  assert.equal(
    replayAvailable(
      "p",
      { ...current, block_ids: Array(33).fill("a") },
      blocks,
    ),
    false,
  );
});
