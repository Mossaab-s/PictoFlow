import assert from "node:assert/strict";
import test from "node:test";
import {
  draftReference,
  joinKeyboard,
  keyboardPage,
  newIdentity,
  occupied,
  parseDraft,
} from "../src/lib/keyboard.ts";

const profile = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const blockId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sequenceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const interpretationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const block = {
  id: blockId,
  profile_id: profile,
  label: "Bruit",
  status: "validated",
};
const position = {
  profile_id: profile,
  block_id: blockId,
  zone: "stable",
  position: 3,
  locked: true,
};
const tile = { ...position, block };

test("HTTP LAN identity generation needs no secure-context randomUUID method", () => {
  const id = newIdentity({ getRandomValues: (bytes) => bytes.fill(255) });
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.notEqual(newIdentity(), newIdentity());
});
test("only validated blocks and positions from the selected profile reach the keyboard", () => {
  const blocks = [
    block,
    { ...block, id: "proposed", status: "proposed" },
    { ...block, id: "foreign", profile_id: "other" },
  ];
  const positions = [
    position,
    { ...position, block_id: "proposed" },
    { ...position, block_id: "foreign" },
    { ...position, profile_id: "other", position: 7 },
  ];
  assert.deepEqual(joinKeyboard(profile, blocks, positions), [tile]);
});
test("stable gaps retain their spatial slots instead of compacting the keyboard", () => {
  const page = keyboardPage([tile], 0);
  assert.deepEqual(page.slots, [null, null, null, tile]);
});
test("large imported positions remain bounded and reachable by pagination", () => {
  const last = { ...tile, position: 1000000 };
  const first = keyboardPage([last], 0);
  assert.equal(first.slots.length, 12);
  const end = keyboardPage([last], first.pages + 10);
  assert.ok(end.slots.length <= 12);
  assert.equal(end.slots.at(-1), last);
});
test("a slot occupied by another block cannot be selected as a free place", () => {
  assert.equal(occupied([position], "different", "stable", 3), true);
  assert.equal(occupied([position], blockId, "stable", 3), false);
  assert.equal(occupied([position], "different", "personal", 3), false);
});
test("draft persistence contains references, never communication text or inferred truth", () => {
  const reference = draftReference(
    { id: sequenceId, block_ids: [blockId], profile_id: profile },
    {
      state: "confirmation_required",
      candidates: [
        {
          id: interpretationId,
          text: "Personal private phrase",
          corrected_text: "Private correction",
          status: "confirmed",
        },
      ],
    },
  );
  assert.deepEqual(reference, {
    sequence_id: sequenceId,
    decision: {
      state: "confirmation_required",
      candidate_ids: [interpretationId],
    },
  });
  assert.ok(!JSON.stringify(reference).includes("Private"));
  assert.deepEqual(parseDraft(JSON.stringify(reference)), reference);
});
test("malformed cached drafts cannot redirect requests or introduce unbounded candidates", () => {
  assert.equal(parseDraft("broken json"), null);
  assert.equal(
    parseDraft(JSON.stringify({ sequence_id: "../profiles/other" })),
    null,
  );
  assert.equal(
    parseDraft(
      JSON.stringify({
        sequence_id: sequenceId,
        decision: { state: "validated", candidate_ids: [] },
      }),
    ),
    null,
  );
  assert.equal(
    parseDraft(
      JSON.stringify({
        sequence_id: sequenceId,
        decision: {
          state: "proposal",
          candidate_ids: Array(4).fill(interpretationId),
        },
      }),
    ),
    null,
  );
});
