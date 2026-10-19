import assert from "node:assert/strict";
import test from "node:test";
import {
  orderedGroups,
  shiftedPages,
  scopedPreview,
  findKeyboardTouches,
  touchLocation,
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

const touch = (id, label, rest = {}) => ({
  id,
  label,
  profile_id: profile,
  status: "validated",
  concept_id: id,
  canonical_intent: null,
  ...rest,
});
const words = [
  touch("water", "Mon verre"),
  touch("mother", "Maman"),
  touch("book", "Livre"),
  touch("intent", "Encore", {
    concept_id: null,
    canonical_intent: "Je voudrais écouter le même morceau",
  }),
  touch("pending", "Proposition", { status: "proposed" }),
  touch("foreign", "Secret", { profile_id: "foreign" }),
];
const meanings = [
  { id: "water", profile_id: profile, label: "L’eau fraîche du réfrigérateur" },
  { id: "mother", profile_id: "foreign", label: "Secret étranger" },
];
const positions = [
  {
    profile_id: profile,
    block_id: "mother",
    zone: "stable",
    position: 0,
    locked: true,
    group_id: null,
  },
  {
    profile_id: profile,
    block_id: "water",
    zone: "personal",
    position: 2,
    locked: false,
    group_id: null,
  },
  {
    profile_id: profile,
    block_id: "book",
    zone: "personal",
    position: 5,
    locked: false,
    group_id: "b",
  },
  {
    profile_id: "foreign",
    block_id: "water",
    zone: "personal",
    position: 4,
    group_id: "a",
  },
];
const find = (query, page) =>
  findKeyboardTouches(profile, words, meanings, positions, query, page).map(
    (b) => b.id,
  );

test("touch lookup searches only validated profile words and personal meanings, ignoring case and accents", () => {
  assert.deepEqual(find("  VERRE refrigerateur  "), ["water"]);
  assert.deepEqual(find("ecouter morceau"), ["intent"]);
  assert.deepEqual(find("Secret"), []);
  assert.deepEqual(find("Proposition"), []);
  assert.deepEqual(find(""), ["water", "mother", "book", "intent"]);
});
test("page filters describe placements without treating global anchors or missing placements as Home", () => {
  assert.deepEqual(find("", "home"), ["water"]);
  assert.deepEqual(find("", "stable"), ["mother"]);
  assert.deepEqual(find("", "group:b"), ["book"]);
  assert.deepEqual(find("", "group:a"), []);
  assert.deepEqual(find("verre", "group:b"), []);
});
test("location labels preserve blank positions, distinguish global anchors and never use foreign page names", () => {
  assert.equal(
    touchLocation(profile, "water", positions, groups),
    "Accueil · Mes touches · place 3",
  );
  assert.equal(
    touchLocation(profile, "mother", positions, groups),
    "Toutes les pages · Repères stables · place 1",
  );
  assert.equal(
    touchLocation(profile, "book", positions, groups),
    "B · Mes touches · place 6",
  );
  assert.equal(
    touchLocation(profile, "absent", positions, groups),
    "À placer dans le clavier",
  );
  assert.equal(
    touchLocation(profile, "book", positions, [
      { ...groups[1], profile_id: "foreign" },
    ]),
    "Page indisponible · Mes touches · place 6",
  );
});
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
