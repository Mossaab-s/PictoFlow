import assert from "node:assert/strict";
import { test } from "node:test";
import {
  visibleNeeds,
  needExamples,
  needParameter,
  needTouch,
} from "../src/lib/vocabulary-needs.ts";
const p = "profile",
  other = "other";
const need = {
  id: "need",
  profile_id: p,
  validated_intent: "Je voudrais de l’eau",
  status: "proposed",
  created_at: "2026-10-19T10:00:00Z",
  occurrence_count: 5,
  validated_count: 4,
};
const sample = {
  sequence: {
    id: "sequence",
    profile_id: p,
    status: "completed",
    block_ids: ["water", "water"],
  },
  interpretation: {
    id: "phrase",
    profile_id: p,
    sequence_id: "sequence",
    status: "corrected",
    text: "eau eau",
    corrected_text: need.validated_intent,
  },
};
const evidence = {
  profile_id: p,
  gap_id: need.id,
  eligible: true,
  examples: [sample],
};
test("need links accept exactly one UUID and keep invalid requests distinct from ordinary creation", () => {
  const id = "273163ae-4e9b-4c74-ac56-c55375fd892a";
  assert.equal(needParameter(undefined), null);
  assert.equal(needParameter(id.toUpperCase()), id);
  for (const invalid of [
    "",
    "other",
    [id],
    [id, id],
    null,
    12,
    id + "?meaning=other",
  ])
    assert.equal(needParameter(invalid), "");
});
test("need resumption finds the unique linked touch in its own profile regardless of human decision", () => {
  const block = {
    id: "touch",
    profile_id: p,
    semantic_gap_id: need.id,
    status: "rejected",
  };
  assert.equal(
    needTouch(p, need.id, [
      { ...block, profile_id: other },
      { ...block, semantic_gap_id: "other" },
      block,
    ]),
    block,
  );
  assert.equal(needTouch(p, "absent", [block]), undefined);
  assert.throws(() =>
    needTouch(p, need.id, [block, { ...block, id: "duplicate" }]),
  );
});
test("need lists keep pending and decided states separate, scoped and searchable without accents", () => {
  const approved = { ...need, id: "accepted", status: "approved" };
  const later = { ...need, id: "later", created_at: "2026-10-20T10:00:00Z" };
  const input = [need, { ...need, profile_id: other }, approved, later];
  assert.deepEqual(
    visibleNeeds(p, input, true, "voudrais eau").map((item) => item.id),
    ["later", "need"],
  );
  assert.deepEqual(
    visibleNeeds(p, input, false, "").map((item) => item.id),
    ["accepted"],
  );
  assert.equal(input[0], need);
});
test("examples preserve ordered repetitions and require current acceptance of the exact expression", () => {
  const pending = {
    ...sample,
    interpretation: {
      ...sample.interpretation,
      status: "proposed",
      corrected_text: null,
    },
  };
  const foreign = {
    ...sample,
    sequence: { ...sample.sequence, profile_id: other },
  };
  const mismatch = {
    ...sample,
    interpretation: { ...sample.interpretation, sequence_id: "foreign" },
  };
  assert.deepEqual(
    needExamples(p, need, {
      ...evidence,
      examples: [sample, pending, foreign, mismatch],
    }),
    [sample],
  );
  assert.deepEqual(sample.sequence.block_ids, ["water", "water"]);
  assert.throws(() =>
    needExamples(p, need, { ...evidence, gap_id: "foreign" }),
  );
  assert.throws(() =>
    needExamples(p, need, { ...evidence, profile_id: other }),
  );
});
test("withdrawn evidence stays readable without inventing eligible examples", () => {
  assert.deepEqual(
    needExamples(p, need, { ...evidence, eligible: false, examples: [] }),
    [],
  );
  assert.throws(
    () => needExamples(p, need, { ...evidence, examples: [] }),
    /Actualisez/,
  );
});
