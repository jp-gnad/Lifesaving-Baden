// Used only by club_teams.browser.html. No Firebase SDK, network or credentials.
(function () {
  "use strict";
  const records = new Map();
  const listeners = new Set();
  const uid = "fixture-trainer";
  const clubId = "fixture-club";
  const year = window.StartEligibilityCore.seasonYear(window.StartEligibilityCore.today());
  let sequence = 0;
  const timestamp = (date = new Date()) => ({ toDate: () => new Date(date), toMillis: () => +date, isEqual: (other) => +date === other.toMillis() });
  const now = timestamp();
  const publish = () => queueMicrotask(() => listeners.forEach((listener) => listener()));
  records.set(`clubs/${clubId}`, { name: "DLRG Musterstadt", managerIds: [uid], responsibilityVersion: 2, status: "active", createdAt: now, updatedAt: now });
  const names = ["Anna Keller", "Clara Wagner", "Emma Fischer", "Lena Schulz", "Ben Schneider", "Emil Weber", "Jonas Becker", "Paul Hoffmann", "Mia Schäfer", "Sophie Koch", "Lea Zimmermann", "Finn Braun", "Alexandra Müller-Lüdenscheidt"];
  const people = names.map((name, index) => ({
    id: `person-${index}`, personId: `person-${index}`, accountUid: "", name, birthYear: year - (index < 4 ? 14 : index < 8 ? 16 : index === 12 ? 18 : 12),
    gender: index >= 4 && index < 8 || index === 11 ? "m" : "w", organization: "Musterstadt", activeYears: [year, year + 1],
    ...Object.fromEntries(window.ClubsCore.dateKeys.map((key) => [key, null])), createdAt: now, updatedAt: now,
  }));
  for (const person of people) {
    records.set(`clubs/${clubId}/people/${person.id}`, person);
    records.set(`timerParticipantDirectory/${person.id}`, person);
  }
  let season = window.ClubTeamsCore.change({}, "girls", people.slice(0, 4), year, null);
  season = window.ClubTeamsCore.change(season, "boys", people.slice(4, 8), year, null);
  records.set(`clubs/${clubId}/teamSeasons/${year}`, season);

  function snapshot(path) { return { id: path.split("/").pop(), exists: records.has(path), data: () => records.get(path), metadata: { fromCache: false } }; }
  function listen(read, options, receive) {
    const listener = () => (receive || options)(read());
    listeners.add(listener);
    queueMicrotask(listener);
    return () => listeners.delete(listener);
  }
  function doc(path) {
    return {
      path, id: path.split("/").pop(), collection: (name) => collection(`${path}/${name}`),
      get: async () => snapshot(path),
      onSnapshot: (options, receive) => listen(() => snapshot(path), options, receive),
    };
  }
  function collection(path, filters = []) {
    const read = () => ({ docs: [...records.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
      .filter((key) => filters.every(([field, op, value]) => op === "array-contains" ? records.get(key)[field].includes(value) : records.get(key)[field] === value)).map(snapshot), metadata: { fromCache: false } });
    return {
      doc: (id = `new-${++sequence}`) => doc(`${path}/${id}`), get: async () => read(),
      where: (field, op, value) => collection(path, [...filters, [field, op, value]]),
      onSnapshot: (options, receive) => listen(read, options, receive),
    };
  }
  const db = { collection, async runTransaction(action) {
    const writes = [];
    const result = await action({ get: async (ref) => snapshot(ref.path),
      set: (ref, data) => writes.push(() => records.set(ref.path, data)),
      update: (ref, data) => writes.push(() => records.set(ref.path, { ...records.get(ref.path), ...data })),
      delete: (ref) => writes.push(() => records.delete(ref.path)),
    });
    writes.forEach((write) => write());
    publish();
    return result;
  } };
  const firestore = () => db;
  firestore.FieldValue = { serverTimestamp: timestamp };
  window.firebase = { firestore };
  document.body.classList.remove("auth-context-loading");
  window.LifesavingClubs.start({ currentUser: { uid } }, { uid }, { isAdmin: false });
  document.querySelector('[data-club-tab="team"]').click();
})();
