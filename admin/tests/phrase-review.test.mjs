import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewGroups } from "../src/lib/phrase-review.ts";
import { pathPermitted } from "../src/lib/access.ts";

const p = "11111111-1111-4111-8111-111111111111";
const sequence = (id, profile_id = p, status = "completed") => ({
  id,
  profile_id,
  status,
  block_ids: [],
});
const phrase = (id, sequence_id, status = "proposed", extra = {}) => ({
  id,
  profile_id: p,
  sequence_id,
  status,
  text: id,
  corrected_text: null,
  created_at: "2026-10-18T12:00:00Z",
  ...extra,
});

test("pending review groups hypotheses by completed personal message and excludes resolved siblings", () => {
  const items = [
    phrase("a", "one"),
    phrase("b", "one"),
    phrase("c", "two"),
    phrase("d", "two", "corrected", { corrected_text: "Mon sens" }),
    phrase("e", "draft"),
    phrase("f", "foreign"),
    phrase("g", "one", "proposed", { profile_id: "other" }),
    phrase("h", "absent"),
  ];
  const sequences = [
    sequence("one"),
    sequence("two"),
    sequence("draft", p, "in_progress"),
    sequence("foreign", "other"),
  ];
  const pending = reviewGroups(p, sequences, items, true);
  assert.deepEqual(
    pending.map((group) => group.candidates.map((item) => item.id)),
    [["a", "b"]],
  );
  assert.deepEqual(
    reviewGroups(p, sequences, items, false).map((group) =>
      group.candidates.map((item) => item.id),
    ),
    [["d"]],
  );
  assert.equal(
    items[2].status,
    "proposed",
    "Hiding a resolved sibling never mutates its recorded status",
  );
});

test("recent decisions distinguish refusals from accepted memory and sort new messages first", () => {
  const items = [
    phrase("old", "one", "rejected"),
    phrase("new", "two", "confirmed", { created_at: "2026-10-19T12:00:00Z" }),
    phrase("refusal", "three", "not_understood"),
  ];
  assert.deepEqual(
    reviewGroups(
      p,
      [sequence("one"), sequence("two"), sequence("three")],
      items,
      false,
    ).map((group) => group.sequence.id),
    ["two", "one"],
  );
  assert.equal(
    reviewGroups(
      p,
      [sequence("one"), sequence("two"), sequence("three")],
      items,
      true,
    ).length,
    0,
  );
});

test("review-only support can review without composing; preparation/history alone cannot", () => {
  const session = (capabilities) => ({
    enabled: true,
    csrf_token: "synthetic",
    account: {
      is_admin: false,
      profile_access: { [p]: "editor" },
      profile_capabilities: { [p]: capabilities },
    },
  });
  assert(
    pathPermitted(
      session(["review_meanings"]),
      `/accompagnement/personnes/${p}/a-verifier`,
    ),
  );
  assert(!pathPermitted(session(["review_meanings"]), `/communication/${p}`));
  for (const capability of [
    "prepare_keyboard",
    "view_history",
    "manage_meanings",
    "export_profile",
  ])
    assert(
      !pathPermitted(
        session([capability]),
        `/accompagnement/personnes/${p}/a-verifier`,
      ),
    );
  assert(
    !pathPermitted(
      session(["review_meanings"]),
      "/accompagnement/personnes/22222222-2222-4222-8222-222222222222/a-verifier",
    ),
  );
});
