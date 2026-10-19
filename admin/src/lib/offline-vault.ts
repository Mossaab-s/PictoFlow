import { checkedOffline, type OfflineRecord } from "./offline.ts";

export const vaultDatabase = "pictoflow-offline-vault-v1";
export type VaultRow = {
  id: string;
  owner: string;
  profile_id: string;
  version: 1;
  serial: number;
  saved_at: string;
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  content: ArrayBuffer;
};
export type VaultSession = {
  row: VaultRow;
  key: CryptoKey;
  record: OfflineRecord;
};
const encoder = new TextEncoder();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const failure = () =>
  new Error(
    "Copie inaccessible : vérifiez votre phrase secrète ou préparez une nouvelle copie.",
  );
function requireLocalAccess() {
  if (
    globalThis.localStorage?.getItem("pictoflow:explicit-logout") === "1" ||
    globalThis.localStorage?.getItem("pictoflow:accompanied")
  )
    throw new Error(
      "Cet appareil est déconnecté. Reconnectez-vous avant d’ouvrir une copie.",
    );
}
function valid(row: VaultRow) {
  return (
    row?.version === 1 &&
    (row.owner === "development" || uuid.test(row.owner)) &&
    uuid.test(row.profile_id) &&
    row.id === `${row.owner}:${row.profile_id}` &&
    Number.isSafeInteger(row.serial) &&
    row.serial >= 0 &&
    Number.isFinite(Date.parse(row.saved_at)) &&
    row.salt instanceof Uint8Array &&
    row.salt.length === 16 &&
    row.iv instanceof Uint8Array &&
    row.iv.length === 12 &&
    row.content instanceof ArrayBuffer &&
    row.content.byteLength <= 40 * 1024 * 1024
  );
}
function aad(row: Pick<VaultRow, "id">) {
  return encoder.encode(`pictoflow:vault:1:${row.id}`);
}
async function keyFor(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  if (passphrase.length < 15 || passphrase.length > 256 || !passphrase.trim())
    throw failure();
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function encrypted(
  row: VaultRow,
  key: CryptoKey,
  record: OfflineRecord,
): Promise<VaultRow> {
  if (!checkedOffline(row.profile_id, record)) throw failure();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const content = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(row) },
    key,
    encoder.encode(JSON.stringify(record)),
  );
  return { ...row, iv, content, saved_at: new Date().toISOString() };
}
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(vaultDatabase, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("copies", { keyPath: "id" });
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(failure());
    request.onblocked = () => reject(failure());
  });
}
export async function listVaults(): Promise<VaultRow[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("copies", "readonly");
      const request = tx.objectStore("copies").getAll();
      request.onsuccess = () => resolve(request.result.filter(valid));
      request.onerror = () => reject(failure());
    });
  } finally {
    db.close();
  }
}
async function commit(row: VaultRow, expected: number | null) {
  requireLocalAccess();
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("copies", "readwrite");
      const store = tx.objectStore("copies");
      const request = store.get(row.id);
      let conflict = false;
      request.onsuccess = () => {
        try {
          requireLocalAccess();
        } catch {
          tx.abort();
          return;
        }
        if (
          expected === null
            ? request.result !== undefined
            : request.result?.serial !== expected
        ) {
          conflict = true;
          tx.abort();
        } else store.put(row);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(
          conflict
            ? new Error(
                "La copie a changé dans un autre onglet ou existe déjà. Verrouillez puis rouvrez-la avant de poursuivre.",
              )
            : failure(),
        );
    });
  } finally {
    db.close();
  }
}
export async function createVault(
  record: OfflineRecord,
  owner: string,
  passphrase: string,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const row: VaultRow = {
    id: `${owner}:${record.profile_id}`,
    owner,
    profile_id: record.profile_id,
    version: 1,
    serial: 0,
    saved_at: new Date().toISOString(),
    salt,
    iv: new Uint8Array(12),
    content: new ArrayBuffer(0),
  };
  if (!valid(row)) throw failure();
  const key = await keyFor(passphrase, salt);
  await commit(await encrypted(row, key, record), null);
}
export async function unlockVault(
  row: VaultRow,
  passphrase: string,
): Promise<VaultSession> {
  try {
    requireLocalAccess();
    if (!valid(row)) throw failure();
    const key = await keyFor(passphrase, row.salt);
    const bytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: row.iv, additionalData: aad(row) },
      key,
      row.content,
    );
    const record = checkedOffline(
      row.profile_id,
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    if (!record || !record.snapshot) throw failure();
    return { row, key, record };
  } catch {
    throw failure();
  }
}
export async function saveVault(
  session: VaultSession,
  record: OfflineRecord,
): Promise<VaultSession> {
  const row = await encrypted(
    { ...session.row, serial: session.row.serial + 1 },
    session.key,
    record,
  );
  await commit(row, session.row.serial);
  return { ...session, row, record };
}
export async function deleteVault(id: string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("copies", "readwrite");
      tx.objectStore("copies").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(failure());
    });
  } finally {
    db.close();
  }
}
