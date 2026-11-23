(function (root) {
  "use strict";
  const core = typeof module === "object" && module.exports ? require("./club-events-core.js") : root.ClubEventsCore;
  const clubs = typeof module === "object" && module.exports ? require("./clubs-store.js") : root.ClubsStore;
  const dates = typeof module === "object" && module.exports ? require("./start-eligibility-core.js") : root.StartEligibilityCore;
  const fail = (message) => { throw Object.assign(new Error(message), { code: "clubs/event" }); };
  const reference = (db, clubId, id) => db.collection("clubs").doc(clubId).collection("events").doc(id);

  async function mutate(db, clubId, id, command, sdk, checkSession = () => {}) {
    return mutateDocument(db, reference(db, clubId, id), command, sdk, checkSession);
  }

  async function mutateDocument(db, ref, command, sdk, checkSession) {
    const id = ref.id;
    let revision;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(ref);
          checkSession();
          if (!snapshot.exists) {
            if (command.type === "rosterRemoval") return null;
            fail("Der Termin wurde gelöscht.");
          }
          const previous = snapshot.data();
          revision = previous.revision;
          if (command.type === "rosterRemoval") {
            const member = previous.participants[command.id];
            if (previous.date < command.cutoff || member?.rosterId !== command.rosterId
              || Math.floor(member.createdAtMillis) !== command.millis) return { ...previous, id };
          }
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

  async function updateParticipants(db, clubId, id, additions, removals, sdk, checkSession = () => {}, competition = true) {
    return updateDocumentParticipants(db, clubId, reference(db, clubId, id), additions, removals, sdk, checkSession, competition);
  }

  async function updateDocumentParticipants(db, clubId, ref, additions, removals, sdk, checkSession, competition) {
    const entries = [...removals.map((remove) => ({ remove })), ...additions.map((person) => ({ person }))];
    let result;
    for (let index = 0; index < entries.length; index += core.participantBatchSize) {
      checkSession();
      const group = await Promise.all(entries.slice(index, index + core.participantBatchSize).map(async (entry) => entry.person && competition
        ? { person: await preparePerson(db, clubId, entry.person, sdk, checkSession) } : entry));
      result = await mutateDocument(db, ref, { type: "replay", action: { type: "participants",
        additions: group.filter((entry) => entry.person).map((entry) => entry.person), removals: group.filter((entry) => entry.remove).map((entry) => entry.remove) } }, sdk, checkSession);
    }
    return result;
  }

  const eventDocument = (values, sdk) => ({ ...values, participants: {}, teams: {}, assignments: {}, revision: 0,
    operation: "create", changedId: "", createdAt: sdk.FieldValue.serverTimestamp(), updatedAt: sdk.FieldValue.serverTimestamp() });

  async function createDocuments(db, clubId, occurrences, action, sdk, checkSession, seedRef) {
    const documents = occurrences.map(({ id, date }) => ({ id, ref: reference(db, clubId, id), values: core.metadata(action.name, date, action) }));
    return db.runTransaction(async (transaction) => {
      checkSession();
      const snapshots = await Promise.all(documents.map(({ ref }) => transaction.get(ref)));
      checkSession();
      if (documents.length > 1 && snapshots.some((snapshot) => snapshot.exists) && snapshots.some((snapshot) => !snapshot.exists)) {
        fail("Die Trainingsserie wurde inzwischen geändert.");
      }
      let seed;
      if (seedRef && !snapshots[0].exists) {
        const snapshot = await transaction.get(seedRef);
        checkSession();
        if (!snapshot.exists) fail("Die Personenauswahl fehlt. Bitte erneut versuchen.");
        seed = snapshot.data();
        const people = db.collection("clubs").doc(clubId).collection("people");
        const selected = Object.values(seed.participants);
        const roster = await Promise.all(selected.map((member) => transaction.get(people.doc(member.rosterId))));
        checkSession();
        if (roster.some((member, index) => !member.exists || member.data().eventRemovalDate
          || Math.floor(member.data().createdAt.toMillis()) !== selected[index].createdAtMillis)) {
          fail("Eine ausgewählte Person wurde aus dem Club entfernt. Bitte die Trainingsauswahl neu erstellen.");
        }
        transaction.delete(seedRef);
      }
      return documents.map(({ id, ref, values }, index) => {
        if (snapshots[index].exists) {
          const existing = snapshots[index].data();
          if (!core.sameMetadata(existing, values)) fail("Der Termin wurde inzwischen geändert.");
          return { ...existing, id };
        }
        const data = eventDocument(values, sdk);
        if (seed) {
          data.participants = seed.participants;
          data.trainingSeedId = seedRef.id;
        }
        transaction.set(ref, data);
        return { ...data, id };
      });
    });
  }

  async function createTraining(db, clubId, id, occurrences, action, sdk, checkSession) {
    if (!action.additions.length) return createDocuments(db, clubId, occurrences, action, sdk, checkSession);
    const seed = db.collection("clubs").doc(clubId).collection("trainingSeeds").doc(id);
    const first = reference(db, clubId, id);
    const values = core.metadata(action.name, occurrences[0].date, action);
    const pending = await db.runTransaction(async (transaction) => {
      checkSession();
      const [published, draft] = await Promise.all([transaction.get(first), transaction.get(seed)]);
      checkSession();
      if (published.exists) return false;
      if (draft.exists) {
        if (!core.sameMetadata(draft.data(), values)) fail("Die Trainingsserie wurde inzwischen geändert.");
      } else transaction.set(seed, eventDocument(values, sdk));
      return true;
    });
    if (pending) await updateDocumentParticipants(db, clubId, seed, action.additions, [], sdk, checkSession, false);
    return createDocuments(db, clubId, occurrences, action, sdk, checkSession, pending ? seed : undefined);
  }

  async function create(db, clubId, id, name, date, selected, sdk, checkSession = () => {}, details = {}) {
    const [event] = await createDocuments(db, clubId, [{ id, date }], { ...details, name }, sdk, checkSession);
    const additions = selected.filter((person) => !event.participants[core.key(person)]);
    return await updateParticipants(db, clubId, id, additions, [], sdk, checkSession, core.isCompetition(event)) || event;
  }

  async function remove(db, clubId, id, expectedRevision, checkSession = () => {}) {
    return db.runTransaction(async (transaction) => {
      const ref = reference(db, clubId, id);
      const snapshot = await transaction.get(ref);
      checkSession();
      if (!snapshot.exists) return;
      if (snapshot.data().revision !== expectedRevision) fail("Der Termin wurde geändert. Bitte erneut öffnen.");
      transaction.delete(ref);
    });
  }

  async function removeRosterPerson(db, clubId, person, sdk, checkSession = () => {}) {
    const club = db.collection("clubs").doc(clubId);
    const memberRef = club.collection("people").doc(person.id);
    const millis = Math.floor(person.createdAt.toMillis());
    const cutoff = await db.runTransaction(async (transaction) => {
      checkSession();
      const snapshot = await transaction.get(memberRef);
      checkSession();
      if (!snapshot.exists) return null;
      const member = snapshot.data();
      if (member.createdAt.toMillis() !== person.createdAt.toMillis()) fail("Die Person wurde inzwischen neu hinzugefügt.");
      if (member.eventRemovalDate) return member.eventRemovalDate;
      const date = dates.today();
      transaction.update(memberRef, { eventRemovalDate: date });
      return date;
    });
    if (!cutoff) return;
    const events = club.collection("events");
    const query = events.where("date", ">=", cutoff).orderBy("date").limit(50);
    let cursor;
    do {
      checkSession();
      const page = await (cursor ? query.startAfter(cursor) : query).get({ source: "server" });
      for (const snapshot of page.docs) {
        checkSession();
        const matches = Object.entries(snapshot.data().participants).filter(([, entry]) =>
          entry.rosterId === person.id && Math.floor(entry.createdAtMillis) === millis);
        for (const [id] of matches) await mutateDocument(db, events.doc(snapshot.id), {
          type: "rosterRemoval", id, rosterId: person.id, millis, cutoff,
        }, sdk, checkSession);
      }
      cursor = page.docs.length === 50 ? page.docs.at(-1) : null;
    } while (cursor);
    await clubs.removePerson(db, clubId, person.id, sdk, checkSession, false, false, person.createdAt);
  }

  async function listSeries(db, clubId, id, sdk, checkSession) {
    const docId = sdk.FieldPath.documentId();
    const query = db.collection("clubs").doc(clubId).collection("events")
      .where(docId, ">=", id).where(docId, "<", `${id}.`).orderBy(docId).limit(50);
    const events = [];
    let cursor;
    do {
      checkSession();
      const page = await (cursor ? query.startAfter(cursor) : query).get({ source: "server" });
      checkSession();
      events.push(...page.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
      cursor = page.docs.length === 50 ? page.docs.at(-1) : null;
    } while (cursor);
    return events.filter((event) => core.seriesId(event) === id);
  }

  async function editSeries(db, clubId, action, sdk, checkSession) {
    const edits = Object.entries(action.edits);
    const refs = edits.map(([id]) => reference(db, clubId, id));
    return db.runTransaction(async (transaction) => {
      checkSession();
      const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
      checkSession();
      return snapshots.map((snapshot, index) => {
        const [id, edit] = edits[index];
        if (!snapshot.exists || core.seriesId({ ...snapshot.data(), id }) !== action.seriesId) {
          fail("Ein Serientermin wurde entfernt. Bitte die Serie erneut öffnen.");
        }
        const previous = snapshot.data();
        const next = core.replay(previous, edit);
        if (next !== previous) transaction.set(refs[index], { ...next, updatedAt: sdk.FieldValue.serverTimestamp() });
        return { ...next, id };
      });
    });
  }

  async function send(db, clubId, id, action, sdk, checkSession = () => {}, series) {
    if (action.type === "series-metadata") return editSeries(db, clubId, action, sdk, checkSession);
    if (action.type === "create-training") {
      const occurrences = series ? Object.entries(series).map(([id, date]) => ({ id, date })) : core.occurrences(id, action);
      return createTraining(db, clubId, id, occurrences, action, sdk, checkSession);
    }
    if (action.type === "create") {
      if (action.repeatDays) {
        const occurrences = series ? Object.entries(series).map(([id, date]) => ({ id, date })) : core.occurrences(id, action);
        return createDocuments(db, clubId, occurrences, action, sdk, checkSession);
      }
      return create(db, clubId, id, action.name, action.date, action.additions, sdk, checkSession, action);
    }
    if (["participants", "singles", "team"].includes(action.type)) {
      let result = await updateParticipants(db, clubId, id, action.additions, action.removals || [], sdk, checkSession, core.isCompetition(action));
      if (action.type === "team") return mutate(db, clubId, id, { type: "replay", action: { type: "mutate", command: action.command } }, sdk, checkSession);
      for (const command of action.toggles || []) result = await mutate(db, clubId, id, { type: "replay", action: { type: "mutate", command } }, sdk, checkSession);
      return result;
    }
    if (action.type === "delete") { await remove(db, clubId, id, action.expectedRevision, checkSession); return null; }
    return mutate(db, clubId, id, { type: "replay", action }, sdk, checkSession);
  }

  const api = Object.freeze({ create, mutate, addPerson, updateParticipants, send, remove, removeRosterPerson, listSeries });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubEventsStore = api;
})(typeof window === "object" ? window : globalThis);
