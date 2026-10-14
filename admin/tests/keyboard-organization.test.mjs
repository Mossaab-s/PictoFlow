import assert from "node:assert/strict";
import test from "node:test";
import {
  orderedGroups,
  shiftedPages,
  scopedPreview,
} from "../src/lib/keyboard-organization.ts";

const profile = "profile-a";
const groups = [
  { id: "a", profile_id: profile, label: "A", sort_order: 2 },
  { id: "b", profile_id: profile, label: "B", sort_order: 0 },
  { id: "c", profile_id: profile, label: "C", sort_order: 1 },
  {
    id: "old",
    profile_id: profile,
    label: "Old",
    sort_order: 0,
    status: "archived",
  },
  { id: "foreign", profile_id: "foreign", label: "Foreign", sort_order: 0 },
];
test("page order is scoped, keeps identities and never changes its input", () => {
  assert.deepEqual(
    orderedGroups(profile, groups).map((g) => g.id),
    ["b", "c", "a"],
  );
  assert.deepEqual(shiftedPages(profile, groups, "c", -1), {
    group_ids: ["c", "b", "a"],
    expected_group_ids: ["b", "c", "a"],
  });
  assert.equal(shiftedPages(profile, groups, "b", -1), null);
  assert.equal(shiftedPages(profile, groups, "a", 1), null);
  assert.equal(shiftedPages(profile, groups, "foreign", 1), null);
  assert.equal(shiftedPages(profile, groups, "old", 1), null);
  assert.deepEqual(
    groups.map((g) => g.id),
    ["a", "b", "c", "old", "foreign"],
  );
});
test("legacy pages without ordering fields retain the API order", () => {
  const legacy = [
    { id: "z", profile_id: profile, label: "First" },
    { id: "a", profile_id: profile, label: "Second" },
  ];
  assert.deepEqual(orderedGroups(profile, legacy), legacy);
});
test("preview cannot display a foreign touch, stable anchor or inconsistent destination", () => {
  const position = {
    profile_id: profile,
    block_id: "touch",
    zone: "personal",
    position: 0,
    locked: false,
    group_id: "b",
  };
  const preview = {
    profile_id: profile,
    preview_token: "a".repeat(64),
    source_page: groups[1],
    destination_page: groups[0],
    moves: [
      {
        block: { id: "touch", profile_id: profile },
        before: position,
        after: { ...position, group_id: "a", position: 3 },
      },
    ],
  };
  assert.equal(scopedPreview(profile, preview), preview);
  for (const changed of [
    { ...preview, profile_id: "foreign" },
    { ...preview, source_page: groups[3] },
    { ...preview, destination_page: groups[4] },
    { ...preview, preview_token: "bad" },
    {
      ...preview,
      moves: [
        {
          ...preview.moves[0],
          before: { ...position, zone: "stable", locked: true },
        },
      ],
    },
    {
      ...preview,
      moves: [{ ...preview.moves[0], after: { ...position, group_id: "b" } }],
    },
  ])
    assert.equal(scopedPreview(profile, changed), null);
  const home = {
    ...preview,
    destination_page: null,
    moves: [{ ...preview.moves[0], after: { ...position, group_id: null } }],
  };
  assert.equal(scopedPreview(profile, home), home);
});
