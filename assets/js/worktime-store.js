(function (root) {
  "use strict";
  // Day documents serialize concurrent changes. Rules also verify the insertion's
  // neighbours, so bypassing the UI cannot introduce an overlapping interval.
  async function commit(db, uid, entryId, record, sdk, requireUser = () => {}, expectedExists = null) {
    const core = typeof module !== "undefined" && module.exports ? require("./worktime-core.js") : root.WorktimeCore;
    const owner = db.collection("users").doc(uid);
    const ref = owner.collection("worktimeEntries").doc(entryId);
    if (record) {
      // Include V1 entries, which predate reservation documents. The previous
      // calendar day catches an overnight task entering the selected day.
      requireUser();
      const days = core.lockDays(record);
      const existing = await owner.collection("worktimeEntries")
        .where("day", ">=", sdk.Timestamp.fromDate(new Date(days[0] - 86400000)))
        .where("day", "<", sdk.Timestamp.fromDate(new Date(days.at(-1) + 86400000)))
        .get({ source: "server" });
      if (existing.docs.some((item) => item.id !== entryId && core.overlaps(record, item.data()))) {
        throw Object.assign(new Error("Dieser Zeitraum überschneidet sich mit einer anderen Aufgabe. Bitte passe Von oder Bis an."), { code: "worktime/overlap" });
      }
    }
    await db.runTransaction(async (transaction) => {
      requireUser();
      const snapshot = await transaction.get(ref);
      const previous = snapshot.exists ? snapshot.data() : null;
      if (expectedExists === true && !previous) throw Object.assign(new Error("Die Aufgabe wurde inzwischen gelöscht."), { code: "not-found" });
      if (expectedExists === false && previous) throw Object.assign(new Error("Diese Aufgabe existiert bereits."), { code: "worktime/stale" });
      if (!record && !previous) return;
      const days = new Set([...(previous ? core.lockDays(previous) : []), ...(record ? core.lockDays(record) : [])]);
      const locks = await Promise.all([...days].map(async (day) => {
        const lockRef = owner.collection("worktimeDays").doc(String(day));
        const lock = await transaction.get(lockRef);
        return { day, ref: lockRef, entries: lock.exists ? lock.data().entries : [] };
      }));
      const nextDays = new Set(record ? core.lockDays(record) : []);
      const changes = locks.map((lock) => {
        const base = lock.entries.filter((item) => item.id !== entryId);
        let position = 0;
        if (record && nextDays.has(lock.day)) {
          const next = { id: entryId, start: record.startedAt, end: record.endedAt };
          if (base.some((item) => core.overlaps(record, { startedAt: item.start, endedAt: item.end }))) {
            const error = new Error("Dieser Zeitraum überschneidet sich mit einer anderen Aufgabe. Bitte passe Von oder Bis an.");
            error.code = "worktime/overlap";
            throw error;
          }
          position = base.findIndex((item) => core.timestampMillis(item.start) >= core.timestampMillis(next.start));
          if (position === -1) position = base.length;
          base.splice(position, 0, next);
        }
        return { ref: lock.ref, data: { entries: base, entryId, position, updatedAt: sdk.FieldValue.serverTimestamp() } };
      });
      requireUser();
      for (const change of changes) transaction.set(change.ref, change.data);
      if (!record) transaction.delete(ref);
      else {
        const { createdAt, ...fields } = record;
        transaction.set(ref, { ...fields, createdAt: previous?.createdAt || sdk.FieldValue.serverTimestamp(), updatedAt: sdk.FieldValue.serverTimestamp() });
      }
    });
  }
  const api = Object.freeze({ commit });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WorktimeStore = api;
})(typeof window === "undefined" ? globalThis : window);
