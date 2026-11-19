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
          const previous = snapshot.data();
          revision = previous.revision;
          const next = command.type === "replay" ? core.replay(previous, command.action) : core.change(previous, command);
          if (next === previous) return { ...previous, id };
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
    return updateParticipants(db, clubId, id, [selected], [], sdk, checkSession);
  }

  async function preparePerson(db, clubId, selected, sdk, checkSession) {
    checkSession();
    const cached = core.snapshotPerson(selected);
    if (cached.rosterGender) return cached;
    await clubs.refreshIdentity(db, clubId, cached.id, sdk, checkSession, { toMillis: () => cached.createdAtMillis });
    const snapshot = await db.collection("clubs").doc(clubId).collection("people").doc(cached.id).get({ source: "server" });
    checkSession();
    if (!snapshot.exists || snapshot.data().createdAt.toMillis() !== cached.createdAtMillis) fail("Eine Person wurde entfernt. Bitte erneut auswählen.");
    return core.snapshotPerson({ ...snapshot.data(), id: snapshot.id, individual: cached.individual });
  }

  async function updateParticipants(db, clubId, id, additions, removals, sdk, checkSession = () => {}) {
    const entries = [...removals.map((remove) => ({ remove })), ...additions.map((person) => ({ person }))];
    let result;
    for (let index = 0; index < entries.length; index += core.participantBatchSize) {
      checkSession();
      const group = await Promise.all(entries.slice(index, index + core.participantBatchSize).map(async (entry) => entry.person
        ? { person: await preparePerson(db, clubId, entry.person, sdk, checkSession) } : entry));
      result = await mutate(db, clubId, id, { type: "replay", action: { type: "participants",
        additions: group.filter((entry) => entry.person).map((entry) => entry.person), removals: group.filter((entry) => entry.remove).map((entry) => entry.remove) } }, sdk, checkSession);
    }
    return result;
  }

  async function create(db, clubId, id, name, date, selected, sdk, checkSession = () => {}) {
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
    const additions = selected.filter((person) => !event.participants[core.key(person)]);
    event = await updateParticipants(db, clubId, id, additions, [], sdk, checkSession) || event;
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

  async function send(db, clubId, id, action, sdk, checkSession = () => {}) {
    if (action.type === "create") return create(db, clubId, id, action.name, action.date, action.additions, sdk, checkSession);
    if (["participants", "singles", "team"].includes(action.type)) {
      let result = await updateParticipants(db, clubId, id, action.additions, action.removals || [], sdk, checkSession);
      if (action.type === "team") return mutate(db, clubId, id, { type: "replay", action: { type: "mutate", command: action.command } }, sdk, checkSession);
      for (const command of action.toggles || []) result = await mutate(db, clubId, id, { type: "replay", action: { type: "mutate", command } }, sdk, checkSession);
      return result;
    }
    if (action.type === "delete") { await remove(db, clubId, id, action.expectedRevision, checkSession); return null; }
    return mutate(db, clubId, id, { type: "replay", action }, sdk, checkSession);
  }

  const api = Object.freeze({ create, mutate, addPerson, updateParticipants, send, remove });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubEventsStore = api;
})(typeof window === "object" ? window : globalThis);
