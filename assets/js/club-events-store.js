(function (root) {
  "use strict";
  const core = typeof module === "object" && module.exports ? require("./club-events-core.js") : root.ClubEventsCore;
  const clubs = typeof module === "object" && module.exports ? require("./clubs-store.js") : root.ClubsStore;
  const fail = (message) => { throw Object.assign(new Error(message), { code: "clubs/event" }); };
  const reference = (db, clubId, id) => db.collection("clubs").doc(clubId).collection("events").doc(id);

  async function mutate(db, clubId, id, command, sdk, checkSession = () => {}) {
    const ref = reference(db, clubId, id);
    let revision;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(ref);
          checkSession();
          if (!snapshot.exists) fail("Das Event wurde gelöscht.");
          revision = snapshot.data().revision;
          const next = core.change(snapshot.data(), command);
          transaction.set(ref, { ...next, updatedAt: sdk.FieldValue.serverTimestamp() });
          return { ...next, id };
        });
      } catch (error) {
        // Rules can observe a concurrent revision before the SDK receives an
        // aborted-transaction response. Retry only a demonstrated event change.
        if (error.code === "permission-denied" && attempt < 2 && revision !== undefined) {
          checkSession();
          const latest = await ref.get({ source: "server" });
          checkSession();
          if (latest.exists && latest.data().revision !== revision) continue;
        }
        throw error;
      }
    }
  }

  async function addPerson(db, clubId, id, selected, sdk, checkSession = () => {}) {
    checkSession();
    if (!selected.rosterGender) await clubs.refreshIdentity(db, clubId, selected.id, sdk, checkSession, selected.createdAt);
    const snapshot = await db.collection("clubs").doc(clubId).collection("people").doc(selected.id).get({ source: "server" });
    checkSession();
    if (!snapshot.exists || snapshot.data().createdAt.toMillis() !== selected.createdAt.toMillis()) fail("Eine Person wurde entfernt. Bitte erneut auswählen.");
    const person = { ...snapshot.data(), id: snapshot.id };
    return mutate(db, clubId, id, { type: "add", id: core.key(person), person }, sdk, checkSession);
  }

  async function create(db, clubId, id, name, date, selected, sdk, checkSession = () => {}) {
    if (!selected.length) fail("Bitte Personen auswählen.");
    const values = core.metadata(name, date);
    const ref = reference(db, clubId, id);
    let event = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      checkSession();
      if (snapshot.exists) {
        const existing = snapshot.data();
        if (existing.name !== values.name || existing.date !== values.date) fail("Das Event wurde inzwischen geändert.");
        return { ...existing, id };
      }
      const data = { ...values, participants: {}, teams: {}, assignments: {}, revision: 0, operation: "create", changedId: "",
        createdAt: sdk.FieldValue.serverTimestamp(), updatedAt: sdk.FieldValue.serverTimestamp() };
      transaction.set(ref, data);
      return { ...data, id };
    });
    // Each addition validates one current roster identity. A failed creation can
    // resume with the same ID; already saved participants keep their start flags.
    for (const person of selected) {
      checkSession();
      if (event.participants[core.key(person)]) continue;
      try { event = await addPerson(db, clubId, id, person, sdk, checkSession); }
      catch (error) {
        if (error.code === "clubs/event" && error.message === "Die Person nimmt bereits teil.") continue;
        throw error;
      }
    }
    return event;
  }

  async function remove(db, clubId, id, expectedRevision, checkSession = () => {}) {
    return db.runTransaction(async (transaction) => {
      const ref = reference(db, clubId, id);
      const snapshot = await transaction.get(ref);
      checkSession();
      if (!snapshot.exists) return;
      if (snapshot.data().revision !== expectedRevision) fail("Das Event wurde geändert. Bitte erneut öffnen.");
      transaction.delete(ref);
    });
  }

  const api = Object.freeze({ create, mutate, addPerson, remove });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubEventsStore = api;
})(typeof window === "object" ? window : globalThis);
