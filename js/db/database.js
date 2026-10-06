// IndexedDB-Zugriffsschicht (rein lokal, keine Netzwerkzugriffe).
import { DB_NAME, DB_VERSION, upgrade } from "./schema.js";

let dbPromise = null;

export const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("Dieser Browser unterstützt keine lokale Datenbank (IndexedDB)."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Die Datenbank ist in einem anderen Tab geöffnet. Bitte andere Tabs schließen."));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

// Führt `work(transaction)` in einer Transaktion aus und wartet auf deren Abschluss.
async function run(storeNames, mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Datenbankvorgang abgebrochen."));
    work(tx, (value) => { result = value; });
  });
}

export const getAll = (store) =>
  run(store, "readonly", (tx, set) => {
    const request = tx.objectStore(store).getAll();
    request.onsuccess = () => set(request.result);
  });

// Schreibt Datensätze mehrerer Stores atomar: { accounts: [...], transactions: [...] }
export const putBatch = (recordsByStore) =>
  run(Object.keys(recordsByStore), "readwrite", (tx) => {
    for (const [store, records] of Object.entries(recordsByStore)) {
      const objectStore = tx.objectStore(store);
      records.forEach((record) => objectStore.put(record));
    }
  });

export const deleteRecord = (store, id) =>
  run(store, "readwrite", (tx) => { tx.objectStore(store).delete(id); });

export const deleteByIndex = (store, indexName, value) =>
  run(store, "readwrite", (tx) => {
    const objectStore = tx.objectStore(store);
    const request = objectStore.index(indexName).openKeyCursor(IDBKeyRange.only(value));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      objectStore.delete(cursor.primaryKey);
      cursor.continue();
    };
  });
