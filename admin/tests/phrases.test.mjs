import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptedPhrase,
  phraseList,
  shortcutChoice,
  phraseId,
} from "../src/lib/phrases.ts";

const profile = "profile-a";
const item = {
  id: "i",
  profile_id: profile,
  sequence_id: "s",
  status: "corrected",
  text: "Texte d’origine",
  corrected_text: "Je veux du calme",
  created_at: "2026-10-14T10:00:00Z",
  source: "fake",
  shortcut: true,
};
const sequence = {
  id: "s",
  profile_id: profile,
  status: "completed",
  block_ids: ["b", "b"],
};

test("reuse requires an accepted, matching profile and completed source, with the correction intact", () => {
  const value = { interpretation: item, sequence };
  assert.equal(acceptedPhrase(profile, value), value);
  for (const status of ["proposed", "rejected", "not_understood"])
    assert.equal(
      acceptedPhrase(profile, {
        ...value,
        interpretation: { ...item, status, confidence: 1 },
      }),
      null,
    );
  assert.equal(
    acceptedPhrase(profile, {
      ...value,
      interpretation: { ...item, corrected_text: null },
    }),
    null,
  );
  assert.equal(
    acceptedPhrase(profile, {
      ...value,
      sequence: { ...sequence, id: "other" },
    }),
    null,
  );
  assert.equal(
    acceptedPhrase(profile, {
      ...value,
      sequence: { ...sequence, profile_id: "foreign" },
    }),
    null,
  );
  assert.equal(
    acceptedPhrase(profile, {
      ...value,
      sequence: { ...sequence, status: "in_progress" },
    }),
    null,
  );
  assert.equal(acceptedPhrase("foreign", value), null);
  assert.deepEqual(value.sequence.block_ids, ["b", "b"]);
});
test("shortcut filtering never promotes full-confidence proposals or reads original rejected meanings", () => {
  const items = [
    item,
    {
      ...item,
      id: "newer",
      created_at: "2026-10-14T11:00:00Z",
      shortcut: false,
    },
    { ...item, id: "foreign", profile_id: "foreign" },
    { ...item, id: "proposal", status: "proposed", confidence: 1 },
    { ...item, id: "missing", sequence_id: "missing" },
  ];
  assert.deepEqual(phraseList(profile, items, [sequence], "", true), [item]);
  assert.deepEqual(
    phraseList(profile, items, [sequence], "", false).map((i) => i.id),
    ["i", "newer"],
  );
  assert.equal(
    phraseList(profile, items, [sequence], "ORIGINE", false).length,
    0,
  );
  assert.equal(
    phraseList(profile, items, [sequence], "veux CALME", true).length,
    1,
  );
  assert.equal(items.length, 5);
});
test("the explicit request sends the displayed human correction and known shortcut state", () => {
  assert.deepEqual(shortcutChoice(item, false), {
    selected: false,
    expected_selected: true,
    expected_text: item.corrected_text,
  });
  assert.equal(shortcutChoice({ ...item, status: "rejected" }, true), null);
  assert.equal(shortcutChoice({ ...item, corrected_text: null }, true), null);
  assert.equal(
    shortcutChoice({ ...item, shortcut: undefined }, true).expected_selected,
    false,
  );
});
test("links carry only one valid message identity", () => {
  const id = "f365e0ac-0dc6-4c14-9aaa-ef6c16288f58";
  assert.equal(phraseId(id), id);
  for (const value of [
    null,
    undefined,
    [id],
    "Texte personnel",
    "<script>",
    "../foreign",
    "00000000--------00000000000000000000",
  ])
    assert.equal(phraseId(value), null);
});
