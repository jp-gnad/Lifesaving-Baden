(function (root) {
  "use strict";

  function identity(person) {
    const name = String(person.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "");
    return `${name}|${Number(person.birthYear ?? person.birth_year) % 100}|${person.gender}`;
  }

  const failure = (message, status) => Object.assign(new Error(message), { status });
  const duplicate = () => failure("Diese Person ist bereits im Event vorhanden.", 409);
  const idsOf = (snapshot) => snapshot.exists ? snapshot.data().participantIds : [];

  // Before version 1 is enabled, the rules freeze participant writes. This makes
  // the server roster a stable migration source, including manual/duplicate rows.
  // Repeating interrupted or concurrent migrations writes the same reservations.
  async function migrate(db, eventRef, roster, sdk, check = () => {}) {
    if (roster.metadata?.fromCache) throw failure("Die Teilnehmerliste muss zuerst online geladen werden.", 503);
    const groups = new Map();
    for (const doc of roster.docs) {
      const key = identity(doc.data());
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(doc.id);
    }
    const entries = [...groups].map(([key, participantIds]) => [key, participantIds.sort()]);
    try {
      for (let offset = 0; offset < entries.length; offset += 100) {
        check();
        const batch = db.batch();
        for (const [key, participantIds] of entries.slice(offset, offset + 100)) {
          batch.set(eventRef.collection("participantIdentities").doc(key), {
            participantIds, changedParticipantId: participantIds[0],
          });
        }
        await batch.commit();
      }
      await db.runTransaction(async (transaction) => {
        check();
        const event = await transaction.get(eventRef);
        if (!event.exists) throw failure("Event nicht gefunden.", 404);
        if (event.data().participantIndexVersion === 1) return;
        transaction.update(eventRef, { participantIndexVersion: 1, updatedAt: sdk.serverTimestamp() });
      });
    } catch (error) {
      // Another organizer may have finished first. Once ready, rules reject any
      // stale migration batch instead of letting it overwrite live reservations.
      check();
      const current = await eventRef.get({ source: "server" });
      if (!current.exists || current.data().participantIndexVersion !== 1) throw error;
    }
    check();
  }

  async function commit(db, eventRef, participantId, next, sdk, check = () => {}, create = false) {
    const ref = eventRef.collection("participants").doc(participantId);
    return db.runTransaction(async (transaction) => {
      check();
      const current = await transaction.get(ref);
      if (create && current.exists) throw duplicate();
      if (!create && !current.exists) throw failure("Person wurde nicht gefunden.", 404);
      const before = current.exists ? current.data() : null;
      const previousKey = before ? identity(before) : null;
      const nextKey = next ? identity(next) : null;
      const keys = [...new Set([previousKey, nextKey].filter((key) => key !== null))];
      const reservations = await Promise.all(keys.map(async (key) => {
        const reservation = eventRef.collection("participantIdentities").doc(key);
        return { key, ref: reservation, ids: idsOf(await transaction.get(reservation)) };
      }));
      if (nextKey !== previousKey && reservations.find((entry) => entry.key === nextKey)?.ids.length) throw duplicate();
      check();
      for (const reservation of reservations) {
        if (previousKey === nextKey) continue;
        const participantIds = reservation.ids.filter((id) => id !== participantId);
        if (reservation.key === nextKey) participantIds.push(participantId);
        transaction.set(reservation.ref, { participantIds, changedParticipantId: participantId });
      }
      if (!next) {
        transaction.delete(ref);
        return null;
      }
      const data = { ...before, ...next, createdAt: before?.createdAt || sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() };
      transaction.set(ref, data);
      // A new server timestamp is not resolved yet. Avoid an extra read just to
      // display it; the next normal roster load supplies the authoritative date.
      return { id: participantId, data: () => ({ ...data, createdAt: before?.createdAt || null }) };
    }).catch(async (error) => {
      // A competing reservation can be rejected by rules before the SDK reports
      // an aborted transaction. Resolve that race with one fresh document read.
      const code = String(error?.code || "").replace(/^firestore\//, "");
      if (!next || !["permission-denied", "7"].includes(code)) throw error;
      check();
      const occupied = await eventRef.collection("participantIdentities").doc(identity(next))
        .get({ source: "server" }).catch(() => null);
      check();
      if (occupied?.exists && idsOf(occupied).some((id) => create || id !== participantId)) throw duplicate();
      throw error;
    });
  }

  const api = Object.freeze({ identity, migrate, commit });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TimerParticipantStore = api;
})(typeof window === "undefined" ? globalThis : window);
