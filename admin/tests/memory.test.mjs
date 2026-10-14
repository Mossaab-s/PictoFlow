import assert from "node:assert/strict";
import test from "node:test";
import {
  messageText,
  scopedMemory,
  messageTouches,
  relationWords,
  memoryMatches,
  evidenceItems,
} from "../src/lib/memory.ts";

const profile = "profile-a";
const item = {
  id: "message-a",
  profile_id: profile,
  sequence_id: "sequence-a",
  status: "corrected",
  text: "Je veux sortir",
  corrected_text: "Je veux me reposer",
  source: "fake",
};
test("a human correction is the only accepted message; refusals cannot reappear in either partition", () => {
  assert.equal(messageText(item, true), "Je veux me reposer");
  assert.equal(messageText({ ...item, corrected_text: null }, true), null);
  assert.equal(messageText(item, false), null);
  for (const status of ["rejected", "not_understood"]) {
    assert.equal(messageText({ ...item, status }, true), null);
    assert.equal(messageText({ ...item, status }, false), null);
  }
  assert.equal(
    messageText({ ...item, status: "proposed", corrected_text: null }, false),
    item.text,
  );
});
test("partitions filter foreign rows and never infer validation from provider confidence", () => {
  const memory = {
    interpretations: [
      item,
      {
        ...item,
        id: "proposal",
        status: "proposed",
        corrected_text: null,
        confidence: 1,
      },
      { ...item, profile_id: "foreign" },
    ],
    sequences: [
      { id: "sequence-a", profile_id: profile, status: "completed" },
      { id: "s", profile_id: "foreign", status: "completed" },
    ],
    blocks: [
      { id: "b", profile_id: profile, status: "validated" },
      { id: "b2", profile_id: profile, status: "archived" },
      { id: "b3", profile_id: "foreign", status: "validated" },
    ],
    relations: [
      { id: "r", profile_id: profile, status: "proposed", confidence: 1 },
      { id: "r2", profile_id: "foreign", status: "validated" },
    ],
  };
  assert.deepEqual(scopedMemory(profile, memory, true).interpretations, [item]);
  assert.equal(scopedMemory(profile, memory, true).blocks.length, 1);
  assert.equal(scopedMemory(profile, memory, true).relations.length, 0);
  assert.equal(
    scopedMemory(profile, memory, false).interpretations[0].id,
    "proposal",
  );
});
test("message illustrations retain repeated selections and unavailable positions without using foreign blocks", () => {
  const block = {
    id: "b",
    profile_id: profile,
    label: "Repos",
    status: "archived",
  };
  const sequences = [
    {
      id: "sequence-a",
      profile_id: profile,
      status: "completed",
      block_ids: ["b", "b", "missing"],
    },
  ];
  assert.deepEqual(
    messageTouches(profile, item, sequences, [
      block,
      { id: "missing", profile_id: "foreign", label: "Private word" },
    ]),
    [block, block, null],
  );
  assert.equal(
    messageTouches(
      profile,
      item,
      [{ ...sequences[0], profile_id: "foreign" }],
      [block],
    ),
    null,
  );
});
test("personal relation labels respect direction and profile identity", () => {
  const relation = {
    profile_id: profile,
    source_concept_id: "c1",
    target_concept_id: "c2",
    relation_type: "often_followed_by",
  };
  const concepts = [
    { id: "c1", profile_id: profile, label: "Boire" },
    { id: "c2", profile_id: profile, label: "Eau" },
    { id: "c2", profile_id: "foreign", label: "Private meaning" },
  ];
  assert.deepEqual(relationWords(profile, relation, concepts), [
    "Boire",
    "est souvent suivi de",
    "Eau",
  ]);
  assert.deepEqual(
    relationWords(profile, relation, [concepts[0], concepts[2]]),
    ["Boire", "est souvent suivi de", "Concept indisponible"],
  );
});
test("search accepts accents and several words, including an original correction", () => {
  assert.ok(memoryMatches("École · Lire mon livre", "ecole LIVRE"));
  assert.ok(!memoryMatches("École · Lire mon livre", "ecole boire"));
  assert.ok(memoryMatches("Livre", "  "));
});
test("evidence requires both target type and profile; a legacy unknown role remains unknown", () => {
  const event = {
    id: "decision",
    profile_id: profile,
    target_type: "interpretation",
    target_id: item.id,
    actor_role: null,
  };
  const records = [
    event,
    { ...event, id: "other-type", target_type: "communication_block" },
    { ...event, id: "other-person", profile_id: "foreign" },
  ];
  assert.deepEqual(evidenceItems(profile, "interpretation", item.id, records), [
    event,
  ]);
  assert.equal(
    evidenceItems(profile, "interpretation", item.id, records)[0].actor_role,
    null,
  );
});
