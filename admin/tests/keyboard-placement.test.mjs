import assert from "node:assert/strict";
import test from "node:test";
import { placementWindow } from "../src/lib/keyboard-placement.ts";

const profile = "person-a";
const blocks = [
  { id: "water", profile_id: profile, label: "Mon verre", status: "validated" },
  { id: "book", profile_id: profile, label: "Livre", status: "validated" },
  { id: "mother", profile_id: profile, label: "Maman", status: "validated" },
  {
    id: "foreign",
    profile_id: "person-b",
    label: "Secret",
    status: "validated",
  },
  {
    id: "pending",
    profile_id: profile,
    label: "Pas encore accepté",
    status: "proposed",
  },
];
const positions = [
  {
    profile_id: profile,
    block_id: "water",
    zone: "personal",
    position: 2,
    group_id: null,
  },
  {
    profile_id: profile,
    block_id: "book",
    zone: "personal",
    position: 6,
    group_id: null,
  },
  {
    profile_id: profile,
    block_id: "mother",
    zone: "stable",
    position: 0,
    group_id: null,
  },
  {
    profile_id: profile,
    block_id: "book",
    zone: "personal",
    position: 0,
    group_id: "activities",
  },
  {
    profile_id: "person-b",
    block_id: "foreign",
    zone: "personal",
    position: 0,
    group_id: null,
  },
  // Reserve positions without exposing an unavailable or unvalidated word.
  {
    profile_id: profile,
    block_id: "unknown",
    zone: "personal",
    position: 4,
    group_id: null,
  },
  {
    profile_id: profile,
    block_id: "pending",
    zone: "personal",
    position: 8,
    group_id: null,
  },
];
const window = (
  selected,
  page = null,
  size = 12,
  zone = "personal",
  group = null,
) =>
  placementWindow(
    profile,
    "water",
    blocks,
    positions,
    zone,
    group,
    selected,
    page,
    size,
  );

test("destination cases preserve gaps, distinguish the current touch and reserve occupied places", () => {
  const layout = window(3);
  assert.equal(layout.slots.length, 12);
  assert.deepEqual(
    layout.slots.map((s) => s.position),
    Array.from({ length: 12 }, (_, i) => i),
  );
  assert.equal(layout.slots[0].occupied, false);
  assert.equal(layout.slots[0].occupant, undefined); // No foreign word or anchor in this zone.
  assert.equal(layout.slots[2].current, true);
  assert.equal(layout.slots[2].selected, true);
  assert.equal(layout.slots[2].occupied, false);
  assert.equal(layout.slots[6].occupant.label, "Livre");
  assert.equal(layout.slots[6].occupied, true);
  for (const index of [4, 8]) {
    assert.equal(layout.slots[index].occupied, true);
    assert.equal(layout.slots[index].occupant, undefined);
  }
});
test("pages and zones are independent and stable destinations remain global", () => {
  assert.equal(
    window(1, null, 12, "personal", "activities").slots[0].occupant.label,
    "Livre",
  );
  assert.equal(
    window(3, null, 12, "personal", "activities").slots[2].current,
    false,
  );
  const stable = window(1, null, 12, "stable", "ignored-page");
  assert.equal(stable.slots[0].occupant.label, "Maman");
  assert.equal(stable.slots[0].occupied, true);
  assert.equal(stable.slots[2].occupant, undefined);
});
test("browsing does not move the chosen case; a hidden occupied selection stays occupied", () => {
  const layout = window(7, 1);
  assert.equal(layout.offset, 12);
  assert.equal(layout.selectedVisible, false);
  assert.equal(layout.selectedOccupied, true);
  assert.equal(
    layout.slots.some((s) => s.selected),
    false,
  );
  const selected = window(15);
  assert.equal(selected.page, 1);
  assert.equal(selected.slots[2].selected, true);
});
test("display sizes retain coordinates and the last range ends exactly at place 1000", () => {
  for (const size of [4, 6, 12]) {
    const layout = window(1000, null, size);
    assert.equal(layout.slots.at(-1).position, 999);
    assert.equal(layout.slots.at(-1).selected, true);
    assert.equal(layout.offset, Math.floor(999 / size) * size);
    assert.equal(window(1, 10000, size).page, layout.pages - 1);
  }
  for (const value of [0, -1, NaN, 1001, 2.5]) {
    const layout = window(value);
    assert.equal(layout.validSelection, false);
    assert.equal(
      layout.slots.some((s) => s.selected),
      false,
    );
  }
  assert.equal(window(1, -5).page, 0);
  assert.equal(window(1, NaN).page, 0);
});
