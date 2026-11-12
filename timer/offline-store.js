(function (root) {
  "use strict";

  // These names are a persisted contract with installed timers. Never rename or
  // clear them as part of a refactor: unsynchronized results may live only here.
  const databaseName = "lifesaving-timer-offline";
  const databaseVersion = 1;
  const storeName = "pendingResults";

  function create(indexedDB = root.indexedDB) {
    let databasePromise = null;

    function open() {
      if (!indexedDB) return Promise.reject(new Error("Der Offline-Speicher ist auf diesem Gerät nicht verfügbar."));
      if (databasePromise) return databasePromise;
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.addEventListener("upgradeneeded", () => {
          if (!request.result.objectStoreNames.contains(storeName)) {
            request.result.createObjectStore(storeName, { keyPath: "clientSubmissionId" });
          }
        });
        request.addEventListener("success", () => {
          const database = request.result;
          database.addEventListener("versionchange", () => {
            database.close();
            databasePromise = null;
          });
          resolve(database);
        });
        request.addEventListener("error", () => reject(request.error || new Error("Offline-Speicher konnte nicht geöffnet werden.")));
      });
      databasePromise.catch(() => { databasePromise = null; });
      return databasePromise;
    }

    async function transact(mode, operation) {
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        let result;
        // A request's success event precedes the transaction commit. A later
        // quota/I/O failure must never be reported as a safely stored result.
        transaction.addEventListener("complete", () => resolve(result));
        transaction.addEventListener("abort", () => reject(transaction.error || new Error("Offline-Speicher konnte nicht aktualisiert werden.")));
        transaction.addEventListener("error", () => reject(transaction.error || new Error("Offline-Speicher konnte nicht aktualisiert werden.")));
        try {
          const request = operation(transaction.objectStore(storeName));
          request.addEventListener("success", () => { result = request.result; });
          request.addEventListener("error", () => reject(request.error || new Error("Offline-Speicher konnte nicht gelesen werden.")));
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      });
    }

    return Object.freeze({
      getPendingResults: () => transact("readonly", (store) => store.getAll()),
      getPendingResult: (id) => transact("readonly", (store) => store.get(id)),
      putPendingResult: (record) => transact("readwrite", (store) => store.put(record)),
      deletePendingResult: (id) => transact("readwrite", (store) => store.delete(id)),
    });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { create };
  else root.TimerOfflineStore = create();
})(typeof window === "undefined" ? globalThis : window);
