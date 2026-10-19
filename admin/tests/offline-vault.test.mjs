import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB } from "fake-indexeddb";
import {
  createVault,
  deleteVault,
  listVaults,
  saveVault,
  unlockVault,
} from "../src/lib/offline-vault.ts";
import { emptyOffline, editOffline } from "../src/lib/offline.ts";
import { readOffline } from "../src/lib/offline-store.ts";

globalThis.indexedDB = indexedDB;
const owner = "99999999-9999-4999-8999-999999999999";
const profile = "11111111-1111-4111-8111-111111111111";
const block = "22222222-2222-4222-8222-222222222222";
const secret = "une phrase secrète de test";

test("accompanied handoff blocks encrypted and ordinary offline copies", async () => {
  const previous = globalThis.localStorage;
  const isolatedOwner = "88888888-8888-4888-8888-888888888888";
  await createVault(record(), isolatedOwner, secret);
  const vault = (await listVaults()).find((row) => row.owner === isolatedOwner);
  try {
    globalThis.localStorage = {
      getItem: (key) => (key === "pictoflow:accompanied" ? profile : null),
    };
    await assert.rejects(unlockVault(vault, secret), /Copie inaccessible/);
    await assert.rejects(readOffline(profile), /session accompagnée/);
  } finally {
    globalThis.localStorage = previous;
  }
});
function record() {
  return {
    ...emptyOffline(profile),
    snapshot: {
      profile_id: profile,
      revision: "a".repeat(64),
      captured_at: new Date().toISOString(),
      blocks: [
        {
          id: block,
          profile_id: profile,
          label: "Maman confidentielle",
          status: "validated",
          stability: "adaptive",
        },
      ],
      positions: [
        {
          profile_id: profile,
          block_id: block,
          zone: "personal",
          position: 3,
          locked: false,
        },
      ],
      representations: [],
      groups: [],
      photos: {},
    },
  };
}
async function row() {
  return (await listVaults()).find((r) => r.owner === owner);
}

test("protected copy needs the phrase, binds owner/profile and stores neither personal words nor keys in clear", async () => {
  await createVault(record(), owner, secret);
  const stored = await row();
  assert(
    !new TextDecoder().decode(stored.content).includes("Maman confidentielle"),
  );
  assert(!Object.keys(stored).includes("key"));
  const opened = await unlockVault(stored, secret);
  assert.equal(opened.record.snapshot.blocks[0].label, "Maman confidentielle");
  assert.equal(opened.key.extractable, false);
  await assert.rejects(unlockVault(stored, "une mauvaise phrase secrète"));
  const different = "88888888-8888-4888-8888-888888888888";
  await assert.rejects(
    unlockVault(
      { ...stored, owner: different, id: `${different}:${profile}` },
      secret,
    ),
  );
  const corrupt = structuredClone(stored);
  new Uint8Array(corrupt.content)[0] ^= 1;
  await assert.rejects(unlockVault(corrupt, secret));
  await assert.rejects(createVault(record(), owner, secret), /existe déjà/);
  await deleteVault(stored.id);
});

test("saving a draft rotates the IV and prevents old tabs from overwriting it or resurrecting a deleted copy", async () => {
  await createVault(record(), owner, secret);
  const stored = await row();
  const first = await unlockVault(stored, secret),
    second = await unlockVault(stored, secret);
  const next = await saveVault(
    first,
    editOffline(first.record, "append", block),
  );
  assert.notDeepEqual(next.row.iv, stored.iv);
  await assert.rejects(saveVault(second, second.record), /autre onglet/);
  assert.deepEqual((await unlockVault(await row(), secret)).record.block_ids, [
    block,
  ]);
  await deleteVault(stored.id);
  await assert.rejects(saveVault(next, next.record), /autre onglet/);
  assert.equal(await row(), undefined);
});

test("invalid phrases, foreign snapshots and explicit logout cannot create or reopen a protected copy", async () => {
  await assert.rejects(createVault(record(), owner, "short"));
  await assert.rejects(
    createVault({ ...record(), profile_id: "foreign" }, owner, secret),
  );
  await createVault(record(), owner, secret);
  const stored = await row();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => "1" },
  });
  await assert.rejects(unlockVault(stored, secret));
  await assert.rejects(createVault(record(), "development", secret));
  delete globalThis.localStorage;
  await deleteVault(stored.id);
});
