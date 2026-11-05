// Only loaded by worktime.browser.html: every write stays in page memory.
(function () {
  const core = window.WorktimeCore;
  const uid = "local-test-trainer";
  const prefix = `users/${uid}`;
  const records = new Map();
  const listeners = new Set();
  let sequence = 0;
  const timestamp = (date) => ({ toDate: () => new Date(date), toMillis: () => new Date(date).getTime() });
  const pack = (record) => ({ ...record, day: timestamp(record.day), endDay: timestamp(record.endDay), startedAt: timestamp(record.startedAt), endedAt: timestamp(record.endedAt), createdAt: timestamp(new Date()), updatedAt: timestamp(new Date()) });
  const names = ["LV Baden", "Ettlingen", "Privat"];
  records.set(`${prefix}/worktimeSettings/preferences`, { organizations: names });
  for (const [index, [offset, title, category, start, end, organization, description]] of [
    [1, "Abendtraining", "training", "18:00", "20:00", 0, "Technik, Ausdauer und Staffelwechsel"],
    [1, "Trainingsvorbereitung", "organization", "13:00", "14:00", 1, "Abläufe und Gruppen für das Training abstimmen"],
    [1, "Kurzbesprechung", "other", "20:15", "21:00", 2, "Rückblick und nächste Schritte"],
    [2, "Wettkampf vorbereiten", "organization", "09:00", "10:00", 1, "Meldeliste und Helfereinteilung"],
    [3, "Wettkampf betreuen", "competition", "08:00", "12:00", 0, "Betreuung der Mannschaft vor Ort"],
    [4, "Athletengespräche", "athleteCare", "10:00", "12:00", 2, "Persönliche Ziele und Trainingsfortschritt"],
    [5, "Trainerfortbildung", "education", "09:00", "11:30", 0, "Neue Trainingsmethoden und Technikübungen"],
  ].entries()) {
    const id = `sample-${index}`;
    const record = pack(core.prepare({ date: core.shift(core.today(), -offset), title, category, start, end, organization, organizationName: names[organization], description }));
    records.set(`${prefix}/worktimeEntries/${id}`, record);
    const path = `${prefix}/worktimeSchedule/intervals`;
    const entries = records.get(path)?.entries || [];
    entries.push({ id, start: record.startedAt, end: record.endedAt });
    entries.sort((a, b) => a.start.toMillis() - b.start.toMillis());
    records.set(path, { entries, entryId: id, position: 0, updatedAt: timestamp(new Date()) });
  }
  const publish = () => queueMicrotask(() => listeners.forEach((listener) => listener()));
  function doc(path) {
    return {
      id: path.split("/").pop(), path, collection: (name) => collection(`${path}/${name}`),
      async set(data) { records.set(path, data); publish(); },
      async get() { return { exists: records.has(path), data: () => records.get(path) }; },
      onSnapshot(receive) {
        const listener = () => receive({ exists: records.has(path), data: () => records.get(path), metadata: { fromCache: false } });
        listeners.add(listener); queueMicrotask(listener);
        return () => listeners.delete(listener);
      },
    };
  }
  function collection(path) {
    return { doc: (id = `new-${++sequence}`) => doc(`${path}/${id}`), get: () => query(path, []).get(), where: (field, operator, value) => query(path, [[field, operator, value]]) };
  }
  function query(path, filters) {
    const docs = () => [...records].filter(([name, data]) => name.startsWith(`${path}/`) && name.slice(path.length + 1).indexOf("/") === -1 && filters.every(([field, operator, value]) => operator === ">=" ? data[field].toMillis() >= value.toMillis() : operator === ">" ? data[field].toMillis() > value.toMillis() : data[field].toMillis() < value.toMillis())).map(([name, data]) => ({ id: name.split("/").pop(), data: () => data }));
    return {
      async get() { return { docs: docs() }; },
      where(field, operator, value) { return query(path, [...filters, [field, operator, value]]); },
      orderBy() { return this; },
      onSnapshot(options, receive) {
        const listener = () => receive({ metadata: { fromCache: false }, docs: docs() });
        listeners.add(listener); queueMicrotask(listener);
        return () => listeners.delete(listener);
      },
    };
  }
  const db = { collection, async runTransaction(action) {
    const writes = [];
    await action({
      async get(ref) { return { exists: records.has(ref.path), data: () => records.get(ref.path) }; },
      set(ref, data) { writes.push(() => records.set(ref.path, data)); },
      delete(ref) { writes.push(() => records.delete(ref.path)); },
    });
    writes.forEach((write) => write()); publish();
  } };
  const firestore = () => db;
  firestore.Timestamp = { fromDate: timestamp };
  firestore.FieldValue = { serverTimestamp: () => timestamp(new Date()) };
  window.firebase = { firestore };
  window.LifesavingWorktime.start({ currentUser: { uid } }, { uid });
  document.body.classList.remove("auth-context-loading");
})();
