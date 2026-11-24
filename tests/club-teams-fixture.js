// Used only by club_teams.browser.html. No Firebase SDK, network or credentials.
(function () {
  "use strict";
  const records = new Map();
  const listeners = new Set();
  const uid = "fixture-trainer";
  const clubId = "fixture-club";
  const year = window.StartEligibilityCore.seasonYear(window.StartEligibilityCore.today());
  let sequence = 0;
  const options = new URLSearchParams(window.parent.location.search);
  const networkDelay = Number(options.get("delay")) || 0;
  const rosterDelay = Number(options.get("rosterDelay")) || 0;
  const admin = options.has("admin");
  const network = window.clubEventFixtureNetwork = { started: 0, completed: 0 };
  const timestamp = (date = new Date()) => ({ toDate: () => new Date(date), toMillis: () => +date, isEqual: (other) => +date === other.toMillis() });
  const now = timestamp(new Date(`${year}-01-01T00:00:00Z`));
  const publish = () => queueMicrotask(() => listeners.forEach((listener) => listener()));
  records.set(`clubs/${clubId}`, { name: "DLRG Musterstadt", managerIds: [uid], responsibilityVersion: 2, status: "active", createdAt: now, updatedAt: now });
  if (options.has("multi") && !admin) {
    for (const [id, name] of [["fixture-south", "DLRG Südstadt"], ["fixture-valley", "DLRG Ortsgruppe Oberes Murgtal und Umgebung"]]) {
      records.set(`clubs/${id}`, { ...records.get(`clubs/${clubId}`), name });
    }
  }
  const names = ["Anna Keller", "Clara Wagner", "Emma Fischer", "Lena Schulz", "Ben Schneider", "Emil Weber", "Jonas Becker", "Paul Hoffmann", "Mia Schäfer", "Sophie Koch", "Lea Zimmermann", "Finn Braun", "Alexandra Müller-Lüdenscheidt"];
  const people = names.map((name, index) => ({
    id: `person-${index}`, personId: `person-${index}`, accountUid: "", name, birthYear: year - (index < 4 ? 14 : index < 8 ? 16 : index === 12 ? 18 : 12),
    gender: index >= 4 && index < 8 || index === 11 ? "m" : "w", organization: "Musterstadt", activeYears: [year, year + 1],
    ...Object.fromEntries(window.ClubsCore.dateKeys.map((key) => [key, null])), createdAt: now, updatedAt: now,
  }));
  if (options.has("many")) for (let index = 0; index < 36; index += 1) people.push({
    ...people[0], id: `extra-${index}`, personId: `extra-${index}`, name: `Testperson ${String(index + 1).padStart(2, "0")}`,
    gender: index < 4 || index % 2 ? "m" : "w",
  });
  for (const person of people) {
    records.set(`clubs/${clubId}/people/${person.id}`, person);
    records.set(`timerParticipantDirectory/${person.id}`, { ...person, searchName: window.StartEligibilityCore.normalizeSearch(person.name) });
  }
  if (options.has("ageGroups")) {
    for (const [id, firstName, birthYear] of [["junior", "Anna", year - 12], ["senior", "Ben", year - 19], ["unknown", "Clara", null]]) {
      const name = `Muster ${firstName}`;
      records.set(`timerParticipantDirectory/${id}`, { name, birthYear, gender: "w", organization: "Musterstadt",
        searchName: window.StartEligibilityCore.normalizeSearch(name) });
    }
  }
  if (options.has("multi") && !admin) {
    records.set(`clubs/${clubId}/people/account_${uid}`, { ...people[0], id: `account_${uid}`, personId: "", accountUid: uid, name: "Anna Trainer", birthYear: 1990 });
    records.set("clubs/fixture-south/people/south-person", { ...people[0], id: "south-person", personId: "south-person", name: "Sofia Süd" });
  }
  records.set(`clubProfiles/${uid}`, { name: "Anna Trainer", role: "trainer", personId: "", birthYear: 1990, organization: "Musterstadt", gender: "w" });
  records.set(`users/${uid}`, { displayName: "Anna Trainer", email: "trainer@example.test", role: "trainer" });
  records.set("users/fixture-organizer", { displayName: "Ben Organisator", email: "ben@example.test", role: "organizer" });
  records.set("clubDirectory/muster", { name: "DLRG Musterstadt" });
  records.set("clubDirectory/neu", { name: "DLRG Neue Gliederung" });
  if (admin && options.has("many")) for (let index = 0; index < 72; index++) records.set(`clubs/extra-${String(index).padStart(3, "0")}`, {
    name: `DLRG Testclub ${String(index + 1).padStart(2, "0")}`, managerIds: [uid], responsibilityVersion: 2, status: "active", needsResponsible: false, createdAt: now, updatedAt: now,
  });
  if (!admin) {
  let event = { name: "Landesmeisterschaften", date: window.StartEligibilityCore.today(), year, participants: {}, teams: {}, assignments: {}, revision: 0, createdAt: now, updatedAt: now };
  for (const person of people.slice(0, 11)) event = window.ClubEventsCore.change(event, { type: "add", id: person.id, person });
  event = window.ClubEventsCore.change(event, { type: "team", id: "girls", memberIds: people.slice(0, 4).map(p => p.id), expected: null });
  event = window.ClubEventsCore.change(event, { type: "team", id: "boys", memberIds: people.slice(4, 8).map(p => p.id), expected: null });
  if (options.has("many")) {
    for (const person of people.slice(13, 17)) event = window.ClubEventsCore.change(event, { type: "add", id: person.id, person });
    event = window.ClubEventsCore.change(event, { type: "team", id: "younger-boys", memberIds: people.slice(13, 17).map(p => p.id), expected: null });
  }
  event = window.ClubEventsCore.change(event, { type: "individual", id: "person-0", expected: true, enabled: false });
  people[1].activeYears = [year + 1];
  people[11].activeYears = [year];
  people[12].activeYears = [year + 1];
  records.set(`clubs/${clubId}/events/sample`, event);
  records.set(`clubs/${clubId}/events/past`, { ...event, name: "Herbstwettkampf", date: `${year - 1}-10-20`, year: year - 1, participants: {}, teams: {}, assignments: {}, revision: 0 });
  records.set(`clubs/${clubId}/events/future`, { ...event, name: "Frühjahrswettkampf", date: `${year + 1}-03-20`, year: year + 1, participants: {}, teams: {}, assignments: {}, revision: 0 });
  if (options.has("weeks")) {
    const { start } = window.ClubEventsCore.eventWeek(window.StartEligibilityCore.today());
    for (const [id, name, category, offset] of [["week-training", "Rettungsschwimmen", "training", 7],
      ["week-organization", "Abstimmung der Ortsgruppe", "organization", 13], ["next-week", "Bezirksmeisterschaften", "competition", 14]]) {
      const date = window.StartEligibilityCore.asDate(start);
      date.setUTCDate(date.getUTCDate() + offset);
      const day = window.StartEligibilityCore.dateKey(date);
      const metadata = window.ClubEventsCore.metadata(name, day, { category, startTime: "17:30", endTime: "19:00", repeatDays: category === "training" ? 7 : 0 });
      records.set(`clubs/${clubId}/events/${id}`, { ...event, ...metadata, teams: {}, assignments: {} });
    }
  }
  if (options.has("persist")) {
    const saved = JSON.parse(window.parent.sessionStorage.getItem("club-event-fixture-server-v1") || "[]");
    for (const [path, value] of saved) records.set(path, value);
  }

  }

  function snapshot(path) { return { id: path.split("/").pop(), exists: records.has(path), data: () => records.get(path), metadata: { fromCache: false } }; }
  function listen(read, options, receive, onError, rosterClub) {
    let ready = false;
    const listener = () => { if (ready) (receive || options)(read()); };
    listeners.add(listener);
    const start = () => {
      if (!listeners.has(listener)) return;
      if (rosterClub && rosterClub === new URLSearchParams(window.parent.location.search).get("rosterFail")) {
        listeners.delete(listener);
        onError(new Error("Simulierter Lesefehler"));
        return;
      }
      ready = true;
      listener();
    };
    const timer = rosterClub && rosterDelay ? setTimeout(start, rosterDelay) : undefined;
    if (!timer) queueMicrotask(start);
    return () => { clearTimeout(timer); listeners.delete(listener); };
  }
  function doc(path) {
    return {
      path, id: path.split("/").pop(), collection: (name) => collection(`${path}/${name}`),
      get: async () => snapshot(path),
      onSnapshot: (options, receive) => listen(() => snapshot(path), options, receive),
    };
  }
  function collection(path, filters = [], max = Infinity, after = null, field = "", direction = "asc") {
    const compare = (a, b) => {
      const first = field && field !== "__name__" ? String(a.data()[field]) : a.id;
      const second = field && field !== "__name__" ? String(b.data()[field]) : b.id;
      return (first.localeCompare(second) || a.id.localeCompare(b.id)) * (direction === "desc" ? -1 : 1);
    };
    const read = () => ({ docs: [...records.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
      .filter((key) => filters.every(([name, op, value]) => {
        const actual = name === "__name__" ? key.split("/").pop() : records.get(key)[name];
        return op === "array-contains" ? actual.includes(value)
          : op === "array-contains-any" ? value.some((entry) => actual.includes(entry)) : op === "in" ? value.includes(actual)
          : op === ">=" ? actual >= value : op === "<=" ? actual <= value : op === "<" ? actual < value : actual === value;
      }))
      .map(snapshot).sort(compare).filter((entry) => !after || compare(entry, after) > 0).slice(0, max), metadata: { fromCache: false } });
    return {
      doc: (id = String(++sequence).padStart(20, "0")) => doc(`${path}/${id}`), get: async () => {
        const result = read();
        return { ...result, empty: !result.docs.length };
      },
      where: (name, op, value) => collection(path, [...filters, [name, op, value]], max, after, field, direction),
      orderBy: (name, order = "asc") => collection(path, filters, max, after, name, order), limit: (size) => collection(path, filters, size, after, field, direction),
      startAt: (value) => collection(path, [...filters, [field, ">=", value]], max, after, field, direction),
      endAt: (value) => collection(path, [...filters, [field, "<=", value]], max, after, field, direction),
      startAfter: (cursor) => collection(path, filters, max, cursor, field, direction),
      onSnapshot: (options, receive, onError) => listen(read, options, receive, onError, /^clubs\/([^/]+)\/people$/.exec(path)?.[1]),
    };
  }
  const db = { collection, async runTransaction(action) {
    network.started += 1;
    if (networkDelay) await new Promise((resolve) => setTimeout(resolve, networkDelay));
    if (options.has("fail") && network.started === 1) throw Object.assign(new Error("Simulierter Verbindungsfehler"), { code: "unavailable" });
    const writes = [];
    const result = await action({ get: async (ref) => snapshot(ref.path),
      set: (ref, data) => writes.push(() => records.set(ref.path, data)),
      update: (ref, data) => writes.push(() => records.set(ref.path, { ...records.get(ref.path), ...data })),
      delete: (ref) => writes.push(() => records.delete(ref.path)),
    });
    writes.forEach((write) => write());
    if (options.has("persist")) window.parent.sessionStorage.setItem("club-event-fixture-server-v1", JSON.stringify([...records].filter(([path]) => path.startsWith(`clubs/${clubId}/events/`))));
    network.completed += 1;
    publish();
    return result;
  } };
  const firestore = () => db;
  firestore.FieldValue = { serverTimestamp: timestamp };
  firestore.FieldPath = { documentId: () => "__name__" };
  firestore.Timestamp = { fromDate: timestamp, now: () => timestamp() };
  window.firebase = { firestore };
  document.body.classList.remove("auth-context-loading");
  if (admin) window.LifesavingClubsAdmin.start({ currentUser: { uid } }, { uid }, { isAdmin: true });
  else {
    window.LifesavingClubs.start({ currentUser: { uid } }, { uid }, { isAdmin: false });
    if (!options.has("multi")) {
      const content = document.getElementById("se-content");
      const observer = new MutationObserver(() => {
        if (content.hidden) return;
        observer.disconnect();
        document.querySelector('[data-club-tab="events"]').click();
      });
      observer.observe(content, { attributes: true, attributeFilter: ["hidden"] });
    }
  }
})();
