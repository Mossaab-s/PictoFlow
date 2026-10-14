import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB } from "fake-indexeddb";
import {
  checkedSnapshot,
  checkedOffline,
  editOffline,
  emptyOffline,
  offlineWords,
} from "../src/lib/offline.ts";
import {
  InvalidOfflineCopy,
  LocalDraftConflict,
  readOffline,
  writeOffline,
  removeOffline,
} from "../src/lib/offline-store.ts";
globalThis.indexedDB = indexedDB;
const profile = "11111111-1111-4111-8111-111111111111";
const block = "22222222-2222-4222-8222-222222222222";
function snapshot(p = profile) {
  return {
    profile_id: p,
    revision: "a".repeat(64),
    captured_at: "2026-10-14T10:00:00Z",
    blocks: [
      {
        id: block,
        profile_id: p,
        label: "Maman",
        status: "validated",
        stability: "personal",
        concept_id: null,
        canonical_intent: null,
        origin: "human",
      },
    ],
    positions: [
      {
        profile_id: p,
        block_id: block,
        position: 2,
        zone: "personal",
        locked: false,
        group_id: null,
      },
    ],
    representations: [],
    groups: [],
    photos: {},
  };
}
function record(p = profile) {
  return { ...emptyOffline(p), snapshot: snapshot(p) };
}

test("snapshot rejects cross-profile, unvalidated, colliding and unsafe media without changing inputs", () => {
  const s = snapshot();
  const before = structuredClone(s);
  assert.deepEqual(checkedSnapshot(profile, s), s);
  const modifications = [
    (s) => (s.profile_id = "foreign"),
    (s) => (s.blocks[0].status = "proposed"),
    (s) => (s.positions[0].profile_id = "foreign"),
    (s) => (s.positions[0].position = -1),
    (s) => s.positions.push({ ...s.positions[0] }),
    (s) => s.blocks.push({ ...s.blocks[0] }),
    (s) => (s.photos[block] = "https://remote.example/secret.png"),
    (s) => (s.positions[0].group_id = "absent"),
    (s) => (s.revision = "wrong"),
    (s) => (s.captured_at = "never"),
  ];
  for (const change of modifications) {
    const bad = structuredClone(s);
    change(bad);
    assert.equal(checkedSnapshot(profile, bad), null);
  }
  assert.deepEqual(s, before);
});

test("local selection keeps gaps, repeats and bounds without affecting a server reference", () => {
  const base = record();
  const before = structuredClone(base);
  let draft = editOffline(base, "append", block);
  draft = editOffline(draft, "append", block);
  assert.equal(offlineWords(draft), "Maman Maman");
  assert.equal(draft.snapshot.positions[0].position, 2);
  assert.equal(editOffline(draft, "undo").block_ids.length, 1);
  for (let i = 2; i < 32; i++) draft = editOffline(draft, "append", block);
  assert.throws(() => editOffline(draft, "append", block));
  assert.throws(() => editOffline(base, "append", "absent"));
  assert.deepEqual(base, before);
  assert.deepEqual(editOffline(draft, "clear").block_ids, []);
});

test("an uncertain submission stays fixed until confirmed or explicitly refused", () => {
  const base = editOffline(record(), "append", block);
  const submission = {
    request_id: "33333333-3333-4333-8333-333333333333",
    expected_revision: base.snapshot.revision,
    block_ids: [block],
    actor_role: "user",
    confirm: true,
  };
  const frozen = { ...base, submission };
  assert(checkedOffline(profile, frozen));
  assert.throws(() => editOffline(frozen, "clear"));
  assert.throws(() => editOffline(frozen, "append", block));
  assert.equal(
    checkedOffline(profile, { ...frozen, block_ids: [block, block] }),
    null,
  );
  const conflict = { ...frozen, conflict: true };
  assert.deepEqual(editOffline(conflict, "clear").block_ids, []);
  const imported = {
    ...frozen,
    imported: {
      id: submission.request_id,
      profile_id: profile,
      status: "completed",
      block_ids: [block],
    },
  };
  assert(checkedOffline(profile, imported));
  assert.equal(editOffline(imported, "clear").submission, null);
  assert.throws(() => editOffline(imported, "append", block));
  assert.equal(
    checkedOffline(profile, {
      ...imported,
      imported: { ...imported.imported, profile_id: "foreign" },
    }),
    null,
  );
});

test("IndexedDB commits one of two concurrent versions, retaining the winning words and other profiles", async () => {
  const p = "44444444-4444-4444-8444-444444444444";
  const q = "55555555-5555-4555-8555-555555555555";
  const initial = await writeOffline(record(p), 0);
  await writeOffline(record(q), 0);
  const results = await Promise.allSettled([
    writeOffline(editOffline(initial, "append", block), initial.serial),
    writeOffline(editOffline(initial, "append", block), initial.serial),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find((r) => r.status === "rejected");
  assert(rejected.reason instanceof LocalDraftConflict);
  const stored = await readOffline(p);
  assert.deepEqual(stored.block_ids, [block]);
  assert.equal(stored.serial, 2);
  assert.deepEqual((await readOffline(q)).block_ids, []);
  await assert.rejects(removeOffline(p, 1), LocalDraftConflict);
  const removed = await removeOffline(p, 2);
  assert.equal(removed.snapshot, null);
  assert.equal(removed.serial, 3);
  await assert.rejects(writeOffline(initial, 1), LocalDraftConflict);
  assert.equal((await readOffline(p)).snapshot, null);
  assert((await readOffline(q)).snapshot);
});

test("forgetting an empty copy cannot let a stale tab resurrect the removed data", async () => {
  const p = "66666666-6666-4666-8666-666666666666";
  const old = emptyOffline(p);
  const removed = await removeOffline(p, 0);
  assert.equal(removed.serial, 1);
  await assert.rejects(
    writeOffline({ ...old, snapshot: snapshot(p) }, 0),
    LocalDraftConflict,
  );
  const fresh = await writeOffline({ ...removed, snapshot: snapshot(p) }, 1);
  assert.equal(fresh.serial, 2);
});

test("damaged local data needs explicit removal and cannot delete a valid copy repaired by another tab", async () => {
  const p = "77777777-7777-4777-8777-777777777777";
  const db = await new Promise((resolve) => {
    const r = indexedDB.open("pictoflow-offline-v1", 1);
    r.onsuccess = () => resolve(r.result);
  });
  await new Promise((resolve) => {
    const tx = db.transaction("profiles", "readwrite");
    tx.objectStore("profiles").put({ profile_id: p, serial: 8, version: 99 });
    tx.oncomplete = resolve;
  });
  db.close();
  await assert.rejects(readOffline(p), InvalidOfflineCopy);
  const cleared = await removeOffline(p, 0, true);
  assert.equal(cleared.serial, 9);
  assert.equal((await readOffline(p)).snapshot, null);
  await writeOffline({ ...cleared, snapshot: snapshot(p) }, 9);
  await assert.rejects(removeOffline(p, 0, true), LocalDraftConflict);
  assert((await readOffline(p)).snapshot);
});
