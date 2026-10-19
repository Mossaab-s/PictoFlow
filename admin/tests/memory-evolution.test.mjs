import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryChange, evolutionPage } from "../src/lib/memory-evolution.ts";

const profile = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const snapshot = (status, corrected_text = null) => ({
  id: "phrase",
  profile_id: profile,
  sequence_id: "sequence",
  text: "Moi eau",
  status,
  corrected_text,
});
function event(
  action = "confirm",
  before = snapshot("proposed"),
  after = snapshot("confirmed"),
) {
  return {
    id: "event",
    profile_id: profile,
    target_type: "interpretation",
    target_id: "phrase",
    event_type: `interpretation_${action}`,
    previous_state: JSON.stringify(before),
    new_state: JSON.stringify(after),
    source: "human:caregiver",
    created_at: "2026-10-19T10:00:00Z",
  };
}

test("accepted changes preserve the actual historical text through later correction and withdrawal", () => {
  const confirmed = memoryChange(profile, event());
  assert.equal(confirmed.action, "confirm");
  assert.equal(confirmed.acceptedText, "Moi eau");
  assert.equal(confirmed.previousText, null);
  const corrected = memoryChange(
    profile,
    event(
      "correct",
      snapshot("confirmed"),
      snapshot("corrected", "Je voudrais de l’eau."),
    ),
  );
  assert.equal(corrected.previousText, "Moi eau");
  assert.equal(corrected.acceptedText, "Je voudrais de l’eau.");
  const withdrawn = memoryChange(
    profile,
    event(
      "reject",
      snapshot("corrected", "Je voudrais de l’eau."),
      snapshot("rejected", "Je voudrais de l’eau."),
    ),
  );
  assert.equal(withdrawn.action, "withdraw");
  assert.equal(withdrawn.acceptedText, null);
  assert.equal(withdrawn.previousText, "Je voudrais de l’eau.");
  assert.equal(confirmed.acceptedText, "Moi eau");
});

test("unaccepted refusals, unrelated events and malformed or foreign snapshots cannot claim learning", () => {
  for (const value of [
    event("reject", snapshot("proposed"), snapshot("rejected")),
    { ...event(), profile_id: other },
    { ...event(), target_type: "communication_block" },
    { ...event(), event_type: "interpretation_proposed" },
    { ...event(), new_state: "invalid JSON" },
    { ...event(), previous_state: "[]" },
    {
      ...event(),
      new_state: JSON.stringify({
        ...snapshot("confirmed"),
        profile_id: other,
      }),
    },
    {
      ...event(),
      new_state: JSON.stringify({ ...snapshot("confirmed"), id: "foreign" }),
    },
    {
      ...event(),
      new_state: JSON.stringify({
        ...snapshot("confirmed"),
        sequence_id: "foreign",
      }),
    },
    { ...event(), created_at: "invalid date" },
    event("correct", snapshot("proposed"), snapshot("corrected", "  ")),
  ])
    assert.equal(memoryChange(profile, value), null);
});

test("history pagination consumes raw scoped rows while retaining a cursor past an unreadable snapshot", () => {
  const first = event();
  const invalid = { ...event(), id: "unreadable", new_state: "{}" };
  const third = { ...event(), id: "third" };
  const page = evolutionPage(
    profile,
    [first, invalid, { ...event(), profile_id: other }, third],
    2,
  );
  assert.deepEqual(
    page.items.map((item) => item.event.id),
    ["event"],
  );
  assert.equal(page.next_cursor, "unreadable");
  assert.equal(evolutionPage(profile, [third], 2).next_cursor, null);
});
