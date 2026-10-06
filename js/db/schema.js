// IndexedDB-Schema. Alles bleibt lokal im Browser dieses Geräts.
export const DB_NAME = "finance-app";
export const DB_VERSION = 2;
export const STORES = { accounts: "accounts", transactions: "transactions", contracts: "contracts" };

// Wird beim Anlegen/Erhöhen der DB_VERSION aufgerufen. Neue Versionen als `if (oldVersion < n)` ergänzen.
export function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const accounts = db.createObjectStore(STORES.accounts, { keyPath: "id" });
    accounts.createIndex("iban", "iban", { unique: false });

    const tx = db.createObjectStore(STORES.transactions, { keyPath: "id" });
    tx.createIndex("date", "date", { unique: false });
    tx.createIndex("accountId", "accountId", { unique: false });
    tx.createIndex("batchId", "batchId", { unique: false });
  }

  if (oldVersion < 2) {
    // Verträge und Anlagen (bestätigte Einträge, manuelle Einträge, ignorierte Vorschläge)
    const contracts = db.createObjectStore(STORES.contracts, { keyPath: "id" });
    contracts.createIndex("status", "status", { unique: false });
  }
}
