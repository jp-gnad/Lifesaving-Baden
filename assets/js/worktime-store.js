(function (root) {
  "use strict";
  const overlapError = () => Object.assign(new Error("Dieser Zeitraum überschneidet sich mit einer anderen Aufgabe. Bitte passe Von oder Bis an."), { code: "worktime/overlap" });
  async function commit(db, uid, entryId, record, sdk, requireUser = () => {}, expectedExists = null) {
    const core = typeof module !== "undefined" && module.exports ? require("./worktime-core.js") : root.WorktimeCore;
    const owner = db.collection("users").doc(uid);
    const collection = owner.collection("worktimeEntries");
    const schedule = owner.collection("worktimeSchedule").doc("intervals");
    async function transact(id, nextRecord, expected, synchronize = false) {
      await db.runTransaction(async (transaction) => {
        requireUser();
        const ref = collection.doc(id);
        const [snapshot, guard] = await Promise.all([transaction.get(ref), transaction.get(schedule)]);
        const previous = snapshot.exists ? snapshot.data() : null;
        if (expected === true && !previous) throw Object.assign(new Error("Die Aufgabe wurde inzwischen gelöscht."), { code: "not-found" });
        if (expected === false && previous) throw Object.assign(new Error("Diese Aufgabe existiert bereits."), { code: "worktime/stale" });
        if (synchronize && !previous) return;
        const next = synchronize ? {
          ...previous,
          endDay: sdk.Timestamp.fromDate(core.day(core.recordEndDate(previous))),
          organization: previous.organization ?? -1, organizationName: previous.organizationName || "",
        } : nextRecord;
        if (!next && !previous) return;
        const entries = (guard.exists ? guard.data().entries : []).filter((item) => item.id !== id);
        let position = 0;
        if (next) {
          if (entries.some((item) => core.overlaps(next, { startedAt: item.start, endedAt: item.end }))) throw overlapError();
          const interval = { id, start: next.startedAt, end: next.endedAt };
          position = entries.findIndex((item) => core.timestampMillis(item.start) >= core.timestampMillis(interval.start));
          if (position === -1) position = entries.length;
          entries.splice(position, 0, interval);
        }
        requireUser();
        transaction.set(schedule, { entries, entryId: id, position, updatedAt: sdk.FieldValue.serverTimestamp() });
        if (!next) transaction.delete(ref);
        else {
          const { createdAt, ...fields } = next;
          transaction.set(ref, { ...fields, createdAt: previous?.createdAt || sdk.FieldValue.serverTimestamp(), updatedAt: sdk.FieldValue.serverTimestamp() });
        }
      });
    }
    if (record) {
      requireUser();
      // V1/V2 entries are checked and registered before new writes. A single
      // sorted reservation list covers intervals of any number of calendar days.
      const [existing, guard] = await Promise.all([collection.get({ source: "server" }), schedule.get({ source: "server" })]);
      requireUser();
      if (existing.docs.some((item) => item.id !== entryId && core.overlaps(record, item.data()))) throw overlapError();
      const indexed = new Map((guard.exists ? guard.data().entries : []).map((item) => [item.id, item]));
      for (const item of existing.docs) {
        if (item.id === entryId) continue;
        const prior = indexed.get(item.id);
        const data = item.data();
        if (!prior || core.timestampMillis(prior.start) !== core.timestampMillis(data.startedAt) || core.timestampMillis(prior.end) !== core.timestampMillis(data.endedAt)) await transact(item.id, null, null, true);
      }
    }
    await transact(entryId, record, expectedExists);
  }
  const api = Object.freeze({ commit });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WorktimeStore = api;
})(typeof window === "undefined" ? globalThis : window);
