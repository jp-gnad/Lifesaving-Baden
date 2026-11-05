// Only loaded by worktime.browser.html: all writes stay in this page's memory.
(function () {
  const core = window.WorktimeCore;
  const records = new Map();
  const listeners = new Set();
  let sequence = 0;
  const timestamp = (date) => ({ toDate: () => new Date(date), toMillis: () => new Date(date).getTime() });
  const pack = (record) => ({ ...record, day: timestamp(record.day), startedAt: timestamp(record.startedAt), endedAt: timestamp(record.endedAt), createdAt: timestamp(new Date()), updatedAt: timestamp(new Date()) });
  for (const [index, title, category, start, end] of [
    [1, "Abendtraining", "training", "18:00", "20:00"],
    [2, "Wettkampf vorbereiten", "organization", "09:00", "10:00"],
    [3, "Wettkampf betreuen", "competition", "08:00", "12:00"],
    [4, "Athletengespräche", "athleteCare", "10:00", "12:00"],
  ]) records.set(`sample-${index}`, pack(core.prepare({ date: core.shift(core.today(), -index), title, category, start, end, description: "" })));
  const publish = () => queueMicrotask(() => listeners.forEach((listener) => listener()));
  const collection = {
    where(field, operator, value) { return query([[field, operator, value]]); },
    doc(id = `new-${++sequence}`) {
      return {
        async set(record) { records.set(id, record); publish(); },
        async update(record) {
          if (!records.has(id)) throw Object.assign(new Error("Missing"), { code: "not-found" });
          records.set(id, { ...records.get(id), ...record }); publish();
        },
        async delete() { records.delete(id); publish(); },
      };
    },
  };
  function query(filters) {
    return {
      where(field, operator, value) { return query([...filters, [field, operator, value]]); },
      orderBy() { return this; },
      onSnapshot(options, receive) {
        const listener = () => receive({ metadata: { fromCache: false }, docs: [...records].filter(([, data]) => filters.every(([field, operator, value]) => operator === ">=" ? data[field].toMillis() >= value.toMillis() : data[field].toMillis() < value.toMillis())).map(([id, data]) => ({ id, data: () => data })) });
        listeners.add(listener); queueMicrotask(listener);
        return () => listeners.delete(listener);
      },
    };
  }
  const firestore = () => ({ collection: () => ({ doc: () => ({ collection: () => collection }) }) });
  firestore.Timestamp = { fromDate: timestamp };
  firestore.FieldValue = { serverTimestamp: () => timestamp(new Date()) };
  window.firebase = { firestore };
  window.LifesavingWorktime.start({ currentUser: { uid: "local-test-trainer" } }, { uid: "local-test-trainer" });
  document.body.classList.remove("auth-context-loading");
})();
