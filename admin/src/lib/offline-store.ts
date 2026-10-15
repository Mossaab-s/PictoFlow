import { checkedOffline, emptyOffline, type OfflineRecord } from "./offline.ts";

export class LocalDraftConflict extends Error {
  constructor() {
    super(
      "Le brouillon a changé dans un autre onglet. Rechargez sa copie locale.",
    );
  }
}
export class InvalidOfflineCopy extends Error {
  constructor() {
    super(
      "La copie locale est invalide. Effacez-la avant de préparer le clavier.",
    );
  }
}
async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("pictoflow-offline-v1", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("profiles", { keyPath: "profile_id" });
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Le stockage local est occupé."));
  });
}
export async function readOffline(profileId: string): Promise<OfflineRecord> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("profiles", "readonly");
      const request = tx.objectStore("profiles").get(profileId);
      request.onsuccess = () => {
        const value = request.result;
        if (value && !checkedOffline(profileId, value))
          reject(new InvalidOfflineCopy());
        else resolve(value ?? emptyOffline(profileId));
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function writeOffline(
  record: OfflineRecord,
  expectedSerial: number,
): Promise<OfflineRecord> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("profiles", "readwrite");
      const store = tx.objectStore("profiles");
      let next: OfflineRecord;
      let failure: Error | null = null;
      const request = store.get(record.profile_id);
      request.onsuccess = () => {
        if ((request.result?.serial ?? 0) !== expectedSerial) {
          failure = new LocalDraftConflict();
          tx.abort();
          return;
        }
        next = { ...record, serial: expectedSerial + 1 };
        if (!checkedOffline(record.profile_id, next)) {
          failure = new Error("Brouillon local invalide.");
          tx.abort();
          return;
        }
        store.put(next);
      };
      tx.oncomplete = () => resolve(next);
      tx.onerror = () => reject(failure ?? tx.error);
      tx.onabort = () => reject(failure ?? tx.error);
    });
  } finally {
    db.close();
  }
}
export async function removeOffline(
  profileId: string,
  expectedSerial: number,
  invalidOnly = false,
): Promise<OfflineRecord> {
  const db = await open();
  try {
    return await new Promise<OfflineRecord>((resolve, reject) => {
      const tx = db.transaction("profiles", "readwrite");
      const store = tx.objectStore("profiles");
      let failure: Error | null = null;
      let next: OfflineRecord;
      const r = store.get(profileId);
      r.onsuccess = () => {
        if (
          invalidOnly
            ? Boolean(r.result && checkedOffline(profileId, r.result))
            : (r.result?.serial ?? 0) !== expectedSerial
        ) {
          failure = new LocalDraftConflict();
          tx.abort();
          return;
        }
        const serial =
          Number.isSafeInteger(r.result?.serial) && r.result.serial >= 0
            ? r.result.serial
            : 0;
        next = { ...emptyOffline(profileId), serial: serial + 1 };
        store.put(next);
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = () => reject(failure ?? tx.error);
      tx.onerror = () => reject(failure ?? tx.error);
    });
  } finally {
    db.close();
  }
}
