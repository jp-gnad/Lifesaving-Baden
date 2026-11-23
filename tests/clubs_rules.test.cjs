const { before, after, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../assets/js/clubs-core.js");
const store = require("../assets/js/clubs-store.js");
const events = require("../assets/js/club-events-store.js");
const eventCore = require("../assets/js/club-events-core.js");
const teamCore = require("../assets/js/club-teams-core.js");
const links = require("../assets/js/person-link-store.js");
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("A local emulator is required.");
const enabled = Boolean(host);
let env;
let sdk;
let succeeds;
let fails;
const p1 = "1111111111111111";
const p2 = "2222222222222222";
const p3 = "3333333333333333";
const person = (name) => ({ name, birthYear: 2000, gender: "m", organization: "Testgruppe", searchName: name.toLowerCase() });
const api = () => ({ FieldValue: { serverTimestamp: sdk.serverTimestamp, arrayUnion: sdk.arrayUnion, arrayRemove: sdk.arrayRemove, delete: sdk.deleteField },
  FieldPath: { documentId: sdk.documentId }, Timestamp: sdk.Timestamp });
const dbFor = (uid, claims = {}) => uid ? env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore() : env.unauthenticatedContext().firestore();

function compat(db) {
  const eventQuery = (name, filters) => ({
    where: (...args) => eventQuery(name, [...filters, sdk.where(...args)]),
    orderBy: (...args) => eventQuery(name, [...filters, sdk.orderBy(...args)]),
    limit: (size) => eventQuery(name, [...filters, sdk.limit(size)]),
    startAfter: (cursor) => eventQuery(name, [...filters, sdk.startAfter(cursor.native)]),
    async get() { return { docs: (await sdk.getDocs(sdk.query(sdk.collection(db, name), ...filters))).docs.map(wrap) }; },
  });
  const collection = (name) => ({
    where: (...args) => eventQuery(name, [sdk.where(...args)]),
    limit: (size) => ({ async get() { const snapshot = await sdk.getDocs(sdk.query(sdk.collection(db, name), sdk.limit(size))); return { docs: snapshot.docs.map(wrap) }; } }),
    async get() { const snapshot = await sdk.getDocs(sdk.collection(db, name)); return { docs: snapshot.docs.map(wrap) }; },
    doc(id) {
      const native = id === undefined ? sdk.doc(sdk.collection(db, name)) : sdk.doc(db, `${name}/${id}`);
      return {
        id: native.id, native, collection: (child) => collection(`${native.path}/${child}`),
        async get() { return wrap(await sdk.getDoc(native)); },
        set: (data, options) => sdk.setDoc(native, data, options), update: (data) => sdk.updateDoc(native, data), delete: () => sdk.deleteDoc(native),
      };
    },
  });
  const wrap = (snapshot) => ({ id: snapshot.id, native: snapshot, exists: snapshot.exists(), data: () => snapshot.data() });
  return { collection, runTransaction: (action) => sdk.runTransaction(db, (tx) => action({
    async get(ref) { return wrap(await tx.get(ref.native)); },
    set: (ref, data, options) => options ? tx.set(ref.native, data, options) : tx.set(ref.native, data),
    update: (ref, data) => tx.update(ref.native, data), delete: (ref) => tx.delete(ref.native),
  })) };
}

async function seed(records) {
  await env.withSecurityRulesDisabled(async (context) => {
    for (const [id, data] of Object.entries(records)) await sdk.setDoc(sdk.doc(context.firestore(), id), data);
  });
}

async function create(name, uid) { return store.createClub(compat(dbFor("admin")), name, uid, api()); }
const assign = (id, uid) => store.assignResponsible(compat(dbFor("admin")), id, uid, api());
const rosterRef = (db, club, id) => sdk.doc(db, `clubs/${club}/people/${id}`);

before(async () => {
  if (!enabled) return;
  const testing = require("@firebase/rules-unit-testing");
  sdk = require("firebase/firestore");
  sdk.setLogLevel("silent");
  succeeds = testing.assertSucceeds;
  fails = testing.assertFails;
  env = await testing.initializeTestEnvironment({ projectId: "demo-lifesaving-clubs", firestore: { rules: fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8") } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  if (!enabled) return;
  await env.clearFirestore();
  const records = {};
  for (const [uid, role, id] of [["admin", "admin", ""], ["a", "trainer", ""], ["b", "trainer", p2], ["o", "organizer", p3], ["outsider", "trainer", ""], ["athlete", "athlete", ""]]) {
    const data = { role, displayName: uid, birthDate: "1990-01-01", ...(id ? { personLink: { id, ...person(uid), searchName: undefined } } : {}) };
    if (id) { delete data.personLink.searchName; records[`personAccountLinks/${id}`] = { uid }; }
    records[`users/${uid}`] = data;
    records[`clubProfiles/${uid}`] = core.profile(data);
  }
  records[`timerParticipantDirectory/${p1}`] = person("Person");
  records[`timerParticipantDirectory/${p2}`] = person("b");
  records[`timerParticipantDirectory/${p3}`] = person("o");
  await seed(records);
});

test("club-local people stay in their roster and support activity, evidence and event selection", { skip: !enabled }, async () => {
  const club = await create("Lokaler Kader", "a");
  const db = compat(dbFor("a"));
  const year = new Date().getUTCFullYear();
  const input = { name: "  Alex Nachwuchs  ", birthYear: year - 14, gender: "w" };
  await fails(store.createLocalPerson(compat(dbFor("outsider")), club, input, api()));
  await fails(store.createLocalPerson(compat(dbFor("athlete")), club, input, api()));
  const id = await store.createLocalPerson(db, club, input, api());
  const ref = rosterRef(dbFor("a"), club, id);
  const added = (await sdk.getDoc(ref)).data();
  assert.equal(core.isLocalPerson({ ...added, id }), true);
  assert.equal(added.name, "Alex Nachwuchs");
  assert.deepEqual(added.activeYears, []);
  assert.equal((await sdk.getDoc(sdk.doc(dbFor("a"), `timerParticipantDirectory/${id}`))).exists(), false);
  await fails(sdk.getDoc(rosterRef(dbFor("outsider"), club, id)));

  await store.setActive(db, club, id, year, true, api(), undefined, added.createdAt);
  const proof = sdk.Timestamp.fromDate(new Date(`${year}-01-01T00:00:00Z`));
  await store.saveDates(db, club, id, { healthDeclaration: proof }, api(), undefined, added.createdAt);
  const updated = (await sdk.getDoc(ref)).data();
  assert.deepEqual(updated.activeYears, [year]);
  assert.equal(updated.healthDeclaration.toMillis(), proof.toMillis());
  await events.create(db, club, "local-event", "Training", `${year}-06-01`, [], api());
  await events.addPerson(db, club, "local-event", { ...updated, id, rosterGender: updated.gender }, api());
  const event = (await sdk.getDoc(sdk.doc(dbFor("a"), `clubs/${club}/events/local-event`))).data();
  assert.equal(event.participants[id].rosterId, id);

  await store.removePerson(db, club, id, api());
  assert.equal((await sdk.getDoc(ref)).exists(), false);
});

test("local roster rules reject forged identities and activity outside the normal flow", { skip: !enabled }, async () => {
  const club = await create("Lokale Daten schützen", "a");
  const db = dbFor("a");
  const year = new Date().getUTCFullYear();
  const localId = "local_0123456789abcdefghij";
  const data = { name: "Neue Person", birthYear: year - 14, gender: "m", personId: "", accountUid: "", organization: "", activeYears: [],
    ...core.proofDates(), createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() };
  const ref = rosterRef(db, club, localId);
  for (const invalid of [{ accountUid: "b" }, { personId: p1 }, { birthYear: year + 1 }, { gender: "" }, { name: " " }, { activeYears: [year] }]) {
    await fails(sdk.setDoc(ref, { ...data, ...invalid }));
  }
  await fails(sdk.setDoc(rosterRef(db, club, "not-local"), data));
  await succeeds(sdk.setDoc(ref, data));
  await fails(sdk.updateDoc(ref, { personId: p1, updatedAt: sdk.serverTimestamp() }));
  await fails(sdk.updateDoc(ref, { accountUid: "b", updatedAt: sdk.serverTimestamp() }));
  await fails(sdk.updateDoc(ref, { activeYears: [year + 2], updatedAt: sdk.serverTimestamp() }));
  await fails(sdk.updateDoc(rosterRef(dbFor("outsider"), club, localId), { activeYears: [year], updatedAt: sdk.serverTimestamp() }));
});

test("verified admins can create a local person without being assigned to the club", { skip: !enabled }, async () => {
  const club = await create("Kader ohne Admin-Zuordnung", "a");
  const details = { name: "Testperson", birthYear: new Date().getUTCFullYear() - 14, gender: "w" };
  for (const admin of [dbFor("admin"), dbFor("claims-only-admin", { admin: true })]) {
    const id = await store.createLocalPerson(compat(admin), club, details, api());
    const saved = await sdk.getDoc(rosterRef(admin, club, id));
    assert.equal(saved.data().name, details.name);
    assert.equal(core.isLocalPerson({ ...saved.data(), id }), true);
  }
  await fails(store.createLocalPerson(compat(dbFor("admin", { email_verified: false })), club, details, api()));
});

async function eventFixture(legacy = false) {
  const id = await create("Mannschaften", "a");
  const db = compat(dbFor("a"));
  const year = new Date().getUTCFullYear();
  const ids = Array.from({ length: 10 }, (_, index) => `team${index}`);
  await seed(Object.fromEntries(ids.map((key, index) => [`timerParticipantDirectory/${key}`, { ...person(`Person ${index}`), birthYear: year - (index === 0 ? 18 : 14), gender: index === 1 ? "m" : "w" }])));
  for (const key of ids) {
    await store.importPerson(db, id, key, api());
    await store.setActive(db, id, key, year, true, api());
    await store.setActive(db, id, key, year + 1, true, api());
  }
  if (legacy) for (const key of ids) {
    const data = (await sdk.getDoc(rosterRef(dbFor("a"), id, key))).data();
    delete data.gender;
    await seed({ [`clubs/${id}/people/${key}`]: data });
  }
  const selected = await Promise.all(ids.map(async (key) => {
    const data = (await sdk.getDoc(rosterRef(dbFor("a"), id, key))).data();
    return { ...data, id: key, rosterGender: data.gender };
  }));
  const ref = (event = "event", uid = "a") => sdk.doc(dbFor(uid), `clubs/${id}/events/${event}`);
  return { id, db, year, selected, ref };
}

async function createEvent(f, id = "event", people = f.selected, year = f.year) {
  return events.create(f.db, f.id, id, "Wettkampf", `${year}-06-20`, people, api());
}
const command = (f, change, id = "event") => events.mutate(f.db, f.id, id, change, api());

test("removing a roster person updates every page of planned appointments and preserves historical snapshots", { skip: !enabled }, async () => {
  const f = await eventFixture();
  const dates = require("../assets/js/start-eligibility-core.js");
  const today = dates.today();
  const beforeToday = dates.asDate(today);
  beforeToday.setUTCDate(beforeToday.getUTCDate() - 1);
  const yesterday = dates.dateKey(beforeToday);
  const person = f.selected[0];
  const planned = await events.create(f.db, f.id, "planned", "Wettkampf", today, f.selected.slice(0, 5), api());
  for (const [id, count] of [["planned", 5], ["short", 4]]) {
    if (id === "short") await events.create(f.db, f.id, id, "Wettkampf", today, f.selected.slice(0, 4), api());
    await command(f, { type: "team", id: "team", memberIds: f.selected.slice(0, count).map(({ id }) => id), expected: null }, id);
  }
  for (const category of ["training", "organization"]) {
    await events.create(f.db, f.id, category, category, today, [person], api(), undefined,
      { category, startTime: "18:00", endTime: "19:00" });
  }
  const admin = dbFor("admin");
  const history = { ...(await sdk.getDoc(f.ref("planned"))).data(), date: yesterday, year: Number(yesterday.slice(0, 4)) };
  const extra = { ...(await sdk.getDoc(f.ref("training"))).data() };
  await seed(Object.fromEntries([
    [`clubs/${f.id}/events/history`, history],
    ...Array.from({ length: 50 }, (_, index) => [`clubs/${f.id}/events/z${index}`, extra]),
  ]));
  const writeRemoval = async (id) => {
    const ref = f.ref(id);
    const before = (await sdk.getDoc(ref)).data();
    return sdk.setDoc(ref, { ...eventCore.change(before, { type: "rosterRemoval", id: person.id }), updatedAt: sdk.serverTimestamp() });
  };
  await fails(sdk.updateDoc(rosterRef(dbFor("outsider"), f.id, person.id), { eventRemovalDate: today }));
  await fails(writeRemoval("planned"));
  await succeeds(sdk.updateDoc(rosterRef(admin, f.id, person.id), { eventRemovalDate: today }));
  await fails(writeRemoval("history"));
  await fails(events.create(f.db, f.id, "racing", "Wettkampf", today, [person], api()));
  await events.removeRosterPerson(f.db, f.id, person, api());
  assert.equal((await sdk.getDoc(rosterRef(admin, f.id, person.id))).exists(), false);
  for (const id of ["planned", "short", "training", "organization", "z49"]) {
    const saved = (await sdk.getDoc(f.ref(id))).data();
    assert.equal(saved.participants[person.id], undefined, id);
    assert.equal(saved.assignments[person.id], undefined, id);
    if (id === "planned") assert.deepEqual(saved.teams.team.memberIds, f.selected.slice(1, 5).map(({ id }) => id));
    if (id === "short") {
      assert.deepEqual(saved.teams, {});
      assert.deepEqual(saved.assignments, {});
      assert.equal(saved.participants.team1.individual, true);
    }
  }
  assert.deepEqual((await sdk.getDoc(f.ref("history"))).data(), history);
  assert.ok(planned.participants[person.id]);
});

test("training and organization accept inactive club members and protect the schedule", { skip: !enabled }, async () => {
  const f = await eventFixture();
  const inactive = f.selected[0];
  await store.setActive(f.db, f.id, inactive.id, f.year, false, api());
  const details = { type: "create", name: "Termin", date: `${f.year}-06-20`, startTime: "18:00", endTime: "19:30", additions: [] };
  for (const category of ["training", "organization"]) {
    const original = await events.send(f.db, f.id, category, { ...details, category }, api());
    const selected = await events.send(f.db, f.id, category, { type: "participants", category,
      additions: f.selected.slice(0, 4) }, api());
    assert.equal(Object.keys(selected.participants).length, 4);
    assert.equal(selected.participants[inactive.id].name, inactive.name);
    const updated = await command(f, { type: "metadata", name: original.name, date: original.date, startTime: "18:30", endTime: "20:00",
      expectedRevision: selected.revision }, category);
    assert.equal(updated.startTime, "18:30");
    const stored = (await sdk.getDoc(f.ref(category))).data();
    const write = (patch) => sdk.setDoc(f.ref(category), { ...stored, operation: "metadata", revision: stored.revision + 1, updatedAt: sdk.serverTimestamp(), ...patch });
    await fails(write({ startTime: "20:01" }));
    await fails(write({ startTime: "9:05" }));
    await fails(write({ category: category === "training" ? "organization" : "training" }));
    await fails(write({ operation: "individual", changedId: inactive.id }));
    await fails(write({ operation: "team", changedId: "forged" }));
    await fails(write({ operation: "remove", changedId: inactive.id, endTime: "19:45" }));
  }
  await fails(events.send(compat(dbFor("athlete")), f.id, "forbidden", { ...details, category: "training" }, api()));
});

test("a verified admin can add a group with existing microsecond-precision club identities to a training", { skip: !enabled }, async () => {
  const f = await eventFixture();
  const admin = compat(dbFor("admin"));
  const firstThree = f.selected.slice(0, 3);
  const precise = new sdk.Timestamp(firstThree[0].createdAt.seconds, 123456000);
  await seed(Object.fromEntries(firstThree.map(({ id, rosterGender, ...person }) => [
    `clubs/${f.id}/people/${id}`, { ...person, createdAt: precise },
  ])));
  await events.send(admin, f.id, "training", { type: "create", category: "training", name: "Training",
    date: `${f.year}-06-20`, startTime: "18:00", endTime: "19:30", additions: [] }, api());
  const additions = firstThree.map((person) => eventCore.snapshotPerson({ ...person, createdAt: precise }));
  assert.ok(additions.every(({ createdAtMillis }) => !Number.isInteger(createdAtMillis)), "Queued data retains SDK precision");
  const updated = await events.send(admin, f.id, "training", { type: "participants", category: "training", additions }, api());
  assert.deepEqual(Object.keys(updated.participants).sort(), firstThree.map(({ id }) => id).sort());
  assert.equal(updated.participants[firstThree[0].id].createdAtMillis, Math.floor(precise.toMillis()));
});

test("creating a training series commits up to 52 dates atomically and retries use the same documents", { skip: !enabled }, async () => {
  const f = await eventFixture();
  const action = { type: "create", category: "training", name: "Training", date: `${f.year}-01-01`,
    startTime: "17:00", endTime: "18:00", repeatDays: 7, repeatUntil: `${f.year}-12-24`, additions: [] };
  const first = await events.send(f.db, f.id, "weekly", action, api());
  const retried = await events.send(f.db, f.id, "weekly", action, api());
  assert.equal(first.length, 52);
  assert.deepEqual(first.map(({ id, date }) => ({ id, date })), retried.map(({ id, date }) => ({ id, date })));
  assert.equal((await sdk.getDoc(f.ref("weekly-52"))).data().repeatDays, 7);
  await fails(events.send(f.db, f.id, "invalid-series", { ...action, date: `${f.year + 1}-12-24`, repeatUntil: `${f.year + 2}-01-14` }, api()));
  assert.equal((await sdk.getDoc(f.ref("invalid-series"))).exists(), false);
});

test("series edits load legacy occurrences by ID and update future metadata atomically", { skip: !enabled }, async () => {
  const f = await eventFixture();
  const dates = require("../assets/js/start-eligibility-core.js");
  const today = dates.today();
  const id = "AbC01234567890123456";
  const action = { type: "create-training", category: "training", name: "Serie", date: today, plannedOn: today,
    repeatUntil: dates.addMonths(today, 12), startTime: "18:00", endTime: "19:00", repeatDays: 7, additions: [] };
  await events.send(f.db, f.id, id, action, api());
  let entries = await events.listSeries(f.db, f.id, id, api(), () => {});
  assert.equal(entries.length, 53);
  const selected = entries.find((entry) => entry.id === `${id}-3`);
  const first = entries.find((entry) => entry.id === id);
  const other = entries.find((entry) => entry.id === `${id}-4`);
  await command(f, { type: "metadata", name: "Abweichende Uhrzeit", date: other.date, startTime: "16:00", endTime: "19:00",
    expectedRevision: other.revision }, other.id);
  const change = (source) => ({ type: "series-metadata", seriesId: id, edits: eventCore.seriesEdits(selected,
    { ...selected, endTime: "20:00" }, source, today) });
  const read = async (id) => (await sdk.getDoc(f.ref(id))).data();
  await assert.rejects(events.send(f.db, f.id, selected.id, change(entries), api()), /inzwischen geändert|wurde geändert/);
  assert.equal((await read(selected.id)).endTime, "19:00", "A concurrent metadata change aborts the whole transaction");
  entries = await events.listSeries(f.db, f.id, id, api(), () => {});
  const retry = change(entries);
  await events.send(f.db, f.id, selected.id, retry, api());
  await events.send(f.db, f.id, selected.id, retry, api());
  assert.equal((await read(first.id)).endTime, "19:00");
  assert.equal((await read(other.id)).name, "Abweichende Uhrzeit");
  assert.equal((await read(other.id)).startTime, "16:00");
  assert.equal((await read(other.id)).endTime, "20:00");
  assert.equal((await read(`${id}-53`)).endTime, "20:00");
  assert.equal((await read(selected.id)).revision, selected.revision + 1);
});

test("training publication validates the selection once and atomically seeds up to 53 independent occurrences", { skip: !enabled }, async () => {
  const f = await eventFixture();
  const dates = require("../assets/js/start-eligibility-core.js");
  const today = dates.today();
  const end = dates.addMonths(today, 12);
  const admin = compat(dbFor("admin"));
  const action = { type: "create-training", category: "training", name: "Serie", date: today, plannedOn: today, repeatUntil: end,
    startTime: "18:00", endTime: "19:00", repeatDays: 7, additions: f.selected.slice(0, 7).map(eventCore.snapshotPerson) };
  const first = await events.send(admin, f.id, "seeded", action, api());
  assert.equal(first.length, 53);
  assert.ok(first.every((event) => Object.keys(event.participants).length === 7));
  const retry = await events.send(admin, f.id, "seeded", action, api());
  assert.deepEqual(retry.map(({ id }) => id), first.map(({ id }) => id));
  const read = (id) => sdk.getDoc(f.ref(id));
  assert.equal((await read("seeded-53")).data().participants.team6.name, "Person 6");
  const live = (await read("seeded")).data();
  await fails(sdk.setDoc(f.ref("seeded-99"), { ...live, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() }));
  const seed = sdk.doc(dbFor("a"), `clubs/${f.id}/trainingSeeds/seeded`);
  assert.equal((await sdk.getDoc(seed)).exists(), false);
  await fails(sdk.setDoc(seed, { ...live, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() }));
  await events.send(admin, f.id, "seeded-53", { type: "participants", category: "training", additions: [], removals: ["team6"] }, api());
  assert.ok((await read("seeded")).data().participants.team6);
  assert.equal((await read("seeded-53")).data().participants.team6, undefined);
  await assert.rejects(events.send(admin, f.id, "invalid", { ...action, additions: [{ ...action.additions[0], name: "Falsche Identität" }] }, api()),
    { code: "permission-denied" });
  assert.equal((await read("invalid")).exists(), false);
});

test("club events default to individual entries and reserve teams independently in each event", { skip: !enabled }, async () => {
  const f = await eventFixture();
  let event = await createEvent(f);
  assert.equal(Object.values(event.participants).every((person) => person.individual), true);
  const ids = Object.keys(event.participants).slice(0, 4);
  event = await command(f, { type: "team", id: "one", memberIds: ids, expected: null });
  assert.equal(eventCore.namedTeams(event)[0].name, "AK 17/18 männlich · 1");
  assert.equal(event.participants[ids[0]].individual, true);
  await command(f, { type: "individual", id: ids[0], enabled: false, expected: true });
  event = await command(f, { type: "team", id: "one", memberIds: f.selected.slice(0, 5).map((p) => p.id), expected: event.teams.one });
  event = await command(f, { type: "team", id: "one", memberIds: f.selected.slice(5, 10).map((p) => p.id), expected: event.teams.one });
  event = await command(f, { type: "team", id: "one", memberIds: null, expected: event.teams.one });
  assert.equal(event.participants[ids[0]].individual, false);
  assert.equal(event.assignments[ids[0]], undefined);
  await command(f, { type: "individual", id: ids[0], enabled: true, expected: false });
  await createEvent(f, "other");
  await command(f, { type: "team", id: "one", memberIds: ids, expected: null }, "other");
  assert.equal((await sdk.getDoc(f.ref())).data().assignments[ids[0]], undefined);
});

test("concurrent team claims reject duplicates and preserve unrelated event changes", { skip: !enabled }, async () => {
  const f = await eventFixture();
  await createEvent(f);
  const ids = f.selected.slice(0, 4).map((p) => p.id);
  const results = await Promise.allSettled(["one", "two"].map((id) => command(f, { type: "team", id, memberIds: ids, expected: null })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const event = (await sdk.getDoc(f.ref())).data();
  const [id, team] = Object.entries(event.teams)[0];
  await Promise.all([
    command(f, { type: "team", id, memberIds: [...ids, f.selected[4].id], expected: team }),
    command(f, { type: "team", id: "other", memberIds: f.selected.slice(5, 10).map((p) => p.id), expected: null }),
  ]);
  assert.equal(Object.keys((await sdk.getDoc(f.ref())).data().teams).length, 2);
  await assert.rejects(command(f, { type: "team", id, memberIds: ids, expected: team }), /geändert/);
});

test("event rules enforce club access, source identities, bounded queries and immutable snapshots", { skip: !enabled }, async () => {
  const f = await eventFixture();
  await createEvent(f, "event", f.selected.slice(0, 8));
  const before = (await sdk.getDoc(f.ref())).data();
  const write = (next, uid = "a") => sdk.setDoc(f.ref("event", uid), { ...next, revision: before.revision + 1, updatedAt: sdk.serverTimestamp() });
  for (const uid of ["outsider", "athlete", null]) {
    await fails(sdk.getDoc(f.ref("event", uid)));
    await fails(write(before, uid));
  }
  await fails(sdk.getDocs(sdk.collection(dbFor("a"), `clubs/${f.id}/events`)));
  await succeeds(sdk.getDocs(sdk.query(sdk.collection(dbFor("a"), `clubs/${f.id}/events`), sdk.limit(50))));
  await succeeds(sdk.getDoc(f.ref("event", "admin")));
  const invalid = structuredClone(before);
  invalid.operation = "individual"; invalid.changedId = "team0";
  invalid.participants.team0.name = "Falscher Name";
  await fails(write(invalid));
  invalid.participants = structuredClone(before.participants);
  invalid.participants.team0.individual = false;
  await fails(write(invalid));
  for (const count of [3, 6]) {
    const next = structuredClone(before);
    const ids = f.selected.slice(0, count).map((p) => p.id);
    next.operation = "team"; next.changedId = "one"; next.teams.one = { order: 1, memberIds: ids };
    for (const id of ids) next.assignments[id] = "one";
    await fails(write(next));
  }
  const forged = structuredClone(before);
  forged.operation = "team"; forged.changedId = "one";
  forged.teams.one = { order: 1, memberIds: ["team0", "team1", "team2", "team3"] };
  await fails(write(forged));
  const wrongIdentity = eventCore.change(before, { type: "add", id: f.selected[8].id, person: { ...f.selected[8], gender: "m" } });
  await fails(write(wrongIdentity));
  await store.setActive(f.db, f.id, f.selected[9].id, f.year, false, api());
  const wrongActivity = eventCore.change(before, { type: "add", id: f.selected[9].id, person: f.selected[9] });
  await fails(write(wrongActivity));
  const nextYear = eventCore.change(before, { type: "metadata", name: "Event", date: `${f.year}-12-20`, expectedRevision: before.revision });
  nextYear.year += 1; nextYear.date = `${nextYear.year}-12-20`;
  await fails(write(nextYear));
});

test("only active event-year people may be added; later inactivity and team-only flags survive edits and deletion", { skip: !enabled }, async () => {
  const f = await eventFixture();
  await store.setActive(f.db, f.id, "team0", f.year, false, api());
  await assert.rejects(createEvent(f, "wrong", [f.selected[0]]), { code: "permission-denied" });
  await createEvent(f, "next", f.selected.slice(0, 4), f.year + 1);
  const source = f.selected[0];
  let next = (await sdk.getDoc(f.ref("next"))).data();
  await store.setActive(f.db, f.id, source.id, f.year + 1, false, api());
  next = await command(f, { type: "team", id: "one", memberIds: Object.keys(next.participants), expected: null }, "next");
  await command(f, { type: "individual", id: source.id, expected: true, enabled: false }, "next");
  await command(f, { type: "team", id: "one", memberIds: null, expected: next.teams.one }, "next");
  next = (await sdk.getDoc(f.ref("next"))).data();
  assert.equal(next.participants[source.id].individual, false);
  assert.equal(Object.keys(next.participants).length, 4);
  await store.removePerson(f.db, f.id, source.id, api());
  assert.equal((await sdk.getDoc(f.ref("next"))).data().participants[source.id].name, source.name);
  await store.deleteClub(compat(dbFor("admin")), f.id, api());
  assert.equal((await sdk.getDoc(f.ref("next", "admin"))).exists(), false);
});

test("legacy source refresh retains evidence, and an interrupted event creation resumes without duplicates", { skip: !enabled }, async () => {
  const f = await eventFixture(true);
  const date = sdk.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
  await store.saveDates(f.db, f.id, "team0", { rescueSilver: date }, api());
  await createEvent(f, "event", f.selected.slice(0, 4));
  await createEvent(f, "event", f.selected.slice(0, 8));
  const event = (await sdk.getDoc(f.ref())).data();
  assert.equal(Object.keys(event.participants).length, 8);
  assert.equal(event.participants.team0.gender, "w");
  const roster = (await sdk.getDoc(rosterRef(dbFor("a"), f.id, "team0"))).data();
  assert.equal(roster.rescueSilver.toMillis(), date.toMillis());
  assert.deepEqual(roster.activeYears, [f.year, f.year + 1]);
  await fails(sdk.updateDoc(rosterRef(dbFor("a"), f.id, "team0"), { gender: "m", updatedAt: sdk.serverTimestamp() }));
  await assert.rejects(events.remove(f.db, f.id, "event", -1), /geändert/);
  await events.remove(f.db, f.id, "event", event.revision);
  assert.equal((await sdk.getDoc(f.ref())).exists(), false);
});

test("empty club events accept direct team-only entries and later additional individual starts", { skip: !enabled }, async () => {
  const f = await eventFixture();
  const empty = await createEvent(f, "direct", []);
  assert.deepEqual(empty.participants, {});
  const additions = f.selected.slice(0, 5).map((person) => eventCore.snapshotPerson({ ...person, individual: false }));
  let event = await events.send(f.db, f.id, "direct", { type: "team", additions,
    command: { type: "team", id: "one", memberIds: additions.map((person) => person.id), expected: null } }, api());
  assert.equal(Object.values(event.participants).every((person) => !person.individual), true);
  assert.equal(Object.values(event.assignments).every((id) => id === "one"), true);
  event = await events.send(f.db, f.id, "direct", { type: "singles", additions: [], removals: [],
    toggles: [{ type: "individual", id: additions[0].id, enabled: true, expected: false }] }, api());
  assert.equal(event.participants[additions[0].id].individual, true);
  assert.equal(event.assignments[additions[0].id], "one");
});

test("a bulk selection rejects stale inactive people atomically", { skip: !enabled }, async () => {
  const f = await eventFixture();
  await createEvent(f, "bulk", []);
  await store.setActive(f.db, f.id, f.selected[1].id, f.year, false, api());
  await assert.rejects(events.updateParticipants(f.db, f.id, "bulk", f.selected.slice(0, 3), [], api()), { code: "permission-denied" });
  assert.deepEqual((await sdk.getDoc(f.ref("bulk"))).data().participants, {});
});

test("club event period queries include all years and page by event date", { skip: !enabled }, async () => {
  const id = await create("Eventzeiträume", "a");
  const year = new Date().getUTCFullYear();
  const today = `${year}-07-01`;
  const timestamp = sdk.Timestamp.now();
  const record = (date) => ({ name: date, date, year: Number(date.slice(0, 4)), participants: {}, teams: {}, assignments: {}, revision: 0,
    operation: "create", changedId: "", createdAt: timestamp, updatedAt: timestamp });
  const records = { [`clubs/${id}/events/today`]: record(today), [`clubs/${id}/events/past`]: record(`${year - 1}-12-20`) };
  for (let index = 0; index < 59; index++) {
    const date = new Date(Date.UTC(year + 1, 0, index + 1)).toISOString().slice(0, 10);
    records[`clubs/${id}/events/future${index}`] = record(date);
  }
  await seed(records);
  const ref = sdk.collection(dbFor("a"), `clubs/${id}/events`);
  const planned = sdk.query(ref, sdk.where("date", ">=", today), sdk.orderBy("date", "asc"), sdk.limit(50));
  const first = await sdk.getDocs(planned);
  const next = await sdk.getDocs(sdk.query(planned, sdk.startAfter(first.docs.at(-1))));
  assert.equal(first.size, 50);
  assert.equal(next.size, 10);
  assert.equal(first.docs[0].id, "today");
  assert.equal(new Set([...first.docs, ...next.docs].map((entry) => entry.id)).size, 60);
  const past = await sdk.getDocs(sdk.query(ref, sdk.where("date", "<", today), sdk.orderBy("date", "desc"), sdk.limit(50)));
  assert.deepEqual(past.docs.map((entry) => entry.id), ["past"]);
});

test("only admins create unique clubs with an initial responsible account and inactive roster entry", { skip: !enabled }, async () => {
  await fails(store.createClub(compat(dbFor("a")), "Ettlingen", "a", api()));
  const id = await create("Ettlingen", "a");
  const admin = dbFor("admin");
  const club = (await sdk.getDoc(sdk.doc(admin, `clubs/${id}`))).data();
  assert.deepEqual(club.managerIds, ["a"]);
  assert.deepEqual((await sdk.getDoc(rosterRef(admin, id, "account_a"))).data().activeYears, []);
  await assert.rejects(create(" ettlingen ", "b"), { code: "clubs/duplicate" });
  await succeeds(create("DLRG Ettlingen", "b"));
  await assert.rejects(create("Ohne Trainer", "athlete"), { code: "clubs/role" });
  await succeeds(create("Admin als Verantwortlicher", "admin"));
  await fails(sdk.getDoc(sdk.doc(dbFor("outsider"), `clubs/${id}`)));
  await fails(sdk.getDoc(sdk.doc(dbFor("athlete"), `clubs/${id}`)));
});

test("club evidence is isolated and leaving then rejoining starts without previous dates", { skip: !enabled }, async () => {
  const first = await create("Erster Club", "a");
  const second = await create("Zweiter Club", "b");
  const a = compat(dbFor("a"));
  const b = compat(dbFor("b"));
  await store.importPerson(a, first, p1, api());
  await store.importPerson(b, second, p1, api());
  await store.saveDates(a, first, p1, { rescueSilver: sdk.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")) }, api());
  const firstMembership = (await sdk.getDoc(rosterRef(dbFor("a"), first, p1))).data();
  assert.equal((await sdk.getDoc(rosterRef(dbFor("a"), first, p1))).data().rescueSilver.toDate().toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal((await sdk.getDoc(rosterRef(dbFor("b"), second, p1))).data().rescueSilver, null);
  await fails(sdk.getDoc(rosterRef(dbFor("outsider"), first, p1)));
  await fails(sdk.getDoc(rosterRef(dbFor("athlete"), first, p1)));
  await fails(sdk.getDoc(rosterRef(dbFor("b"), first, p1)));
  await succeeds(sdk.getDoc(rosterRef(dbFor("admin"), first, p1)));
  await store.removePerson(a, first, p1, api());
  assert.equal((await sdk.getDoc(rosterRef(dbFor("a"), first, p1))).exists(), false);
  await store.importPerson(a, first, p1, api());
  await assert.rejects(store.saveDates(a, first, p1, { rescueSilver: firstMembership.rescueSilver }, api(), () => {}, firstMembership.createdAt), { code: "clubs/stale-person" });
  assert.equal((await sdk.getDoc(rosterRef(dbFor("a"), first, p1))).data().rescueSilver, null);
  assert.equal((await sdk.getDoc(rosterRef(dbFor("b"), second, p1))).data().rescueSilver, null);
});

test("activity is separate by club and year and a new import starts inactive", { skip: !enabled }, async () => {
  const first = await create("Erster Club", "a");
  const second = await create("Zweiter Club", "b");
  const a = compat(dbFor("a"));
  await store.importPerson(a, first, p1, api());
  await store.importPerson(compat(dbFor("b")), second, p1, api());
  const year = new Date().getUTCFullYear();
  await store.setActive(a, first, p1, year, true, api());
  await store.setActive(a, first, p1, year + 1, true, api());
  await store.setActive(a, first, p1, year + 1, false, api());
  assert.deepEqual((await sdk.getDoc(rosterRef(dbFor("a"), first, p1))).data().activeYears, [year]);
  assert.deepEqual((await sdk.getDoc(rosterRef(dbFor("b"), second, p1))).data().activeYears, []);
  await fails(sdk.updateDoc(rosterRef(dbFor("a"), first, p1), { activeYears: [year + 2], updatedAt: sdk.serverTimestamp() }));
});

test("club finance isolates years and enforces active membership, exact cents and club access", { skip: !enabled }, async () => {
  const club = await create("Club Finanzen", "a");
  const otherClub = await create("Anderer Club Finanzen", "b");
  const db = dbFor("a");
  const admin = dbFor("admin");
  const manager = compat(db);
  const year = new Date().getUTCFullYear();
  const ledger = (uid, season = year, id = club) => sdk.doc(uid, `clubs/${id}/finance/${season}`);
  await store.importPerson(manager, club, p1, api());
  const localId = await store.createLocalPerson(manager, club, { name: "Testperson", birthYear: year - 14, gender: "w" }, api());
  for (const [id, season] of [[p1, year], [p1, year + 1], [localId, year]]) await store.setActive(manager, club, id, season, true, api());
  const member = async (id) => ({ ...(await sdk.getDoc(rosterRef(db, club, id))).data(), id });
  const first = await member(p1);
  const local = await member(localId);
  await store.saveContribution(manager, club, year, first, core.parseContribution("12,34"), null, api());
  await store.saveContribution(manager, club, year, local, 0, null, api());
  await store.saveContribution(compat(admin), club, year + 1, first, 2001, null, api());
  assert.deepEqual((await sdk.getDoc(ledger(db))).data().contributions, { [p1]: 1234, [localId]: 0 });
  assert.deepEqual((await sdk.getDoc(ledger(db, year + 1))).data().contributions, { [p1]: 2001 });
  assert.equal((await sdk.getDoc(ledger(dbFor("b"), year, otherClub))).exists(), false);
  await fails(sdk.getDoc(ledger(dbFor("b"))));
  await fails(store.saveContribution(compat(dbFor("outsider")), club, year, first, 300, 1234, api()));
  await fails(sdk.deleteDoc(ledger(admin)));
  await assert.rejects(store.saveContribution(manager, club, year, first, 1500, null, api()), /inzwischen geändert/);
  const write = (contributions, changedPersonId = p1, rosterId = p1) => sdk.setDoc(ledger(db), {
    year, contributions, changedPersonId, rosterId, updatedAt: sdk.serverTimestamp(),
  });
  for (const amount of [-1, 0.5, 100_000_000, "1500"]) await fails(write({ [p1]: amount, [localId]: 0 }));
  await fails(write({ [p1]: 1500, [localId]: 1 }));
  await fails(write({ [p1]: 1234, [localId]: 1 }, localId, p1));
  await store.setActive(manager, club, p1, year, false, api());
  await fails(write({ [p1]: 1500, [localId]: 0 }));
  assert.equal((await sdk.getDoc(ledger(db))).data().contributions[p1], 1234);
  await store.setActive(manager, club, p1, year, true, api());
  await store.saveContribution(manager, club, year, first, null, 1234, api());
  assert.deepEqual((await sdk.getDoc(ledger(db))).data().contributions, { [localId]: 0 });
  await store.deleteClub(compat(admin), club, api());
  await env.withSecurityRulesDisabled(async (context) => {
    for (const season of [year, year + 1]) assert.equal((await sdk.getDoc(ledger(context.firestore(), season))).exists(), false);
  });
});

test("imports never grant responsibility; only admins assign staff accounts", { skip: !enabled }, async () => {
  const id = await create("Gemeinsam", "a");
  const a = compat(dbFor("a"));
  await store.importPerson(a, id, p2, api());
  await store.importPerson(a, id, p3, api());
  assert.deepEqual((await sdk.getDoc(sdk.doc(dbFor("a"), `clubs/${id}`))).data().managerIds, ["a"]);
  for (const uid of ["b", "o"]) {
    await fails(sdk.getDoc(sdk.doc(dbFor(uid), `clubs/${id}`)));
    await fails(sdk.getDoc(rosterRef(dbFor(uid), id, p2)));
  }
  await fails(store.assignResponsible(a, id, "o", api()));
  await assert.rejects(assign(id, "athlete"), { code: "clubs/role" });
  await succeeds(assign(id, "admin"));
  await store.removePerson(compat(dbFor("admin")), id, "account_admin", api(), () => {}, true);
  const evidence = sdk.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
  await store.saveDates(a, id, p3, { rescueSilver: evidence }, api());
  await assign(id, "o");
  assert.equal((await sdk.getDoc(rosterRef(dbFor("o"), id, "account_o"))).data().rescueSilver.toMillis(), evidence.toMillis());
  assert.equal((await sdk.getDoc(rosterRef(dbFor("o"), id, p3))).exists(), false);
  await fails(store.removePerson(a, id, "account_o", api()));
  await fails(store.removePerson(compat(dbFor("o")), id, "account_a", api()));
  await store.removePerson(compat(dbFor("admin")), id, "account_o", api(), () => {}, true);
  assert.equal((await sdk.getDoc(rosterRef(dbFor("a"), id, p3))).data().rescueSilver.toMillis(), evidence.toMillis());
  await fails(sdk.getDoc(sdk.doc(dbFor("o"), `clubs/${id}`)));
  await store.removePerson(a, id, p3, api());
  await assert.rejects(store.removePerson(a, id, "account_a", api()), { code: "clubs/last-manager" });
  await fails(sdk.updateDoc(sdk.doc(dbFor("a"), `clubs/${id}`), { managerIds: [], changedManagerId: "a", updatedAt: sdk.serverTimestamp() }));
  await succeeds(sdk.getDoc(sdk.doc(dbFor("admin"), `clubs/${id}`)));
});

test("parallel departures leave a responsible manager and role changes cannot bypass the index", { skip: !enabled }, async () => {
  const id = await create("Nebenläufig", "a");
  await assign(id, "b");
  const results = await Promise.allSettled([
    store.removePerson(compat(dbFor("a")), id, "account_a", api()),
    store.removePerson(compat(dbFor("b")), id, "account_b", api()),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const managers = (await sdk.getDoc(sdk.doc(dbFor("admin"), `clubs/${id}`))).data().managerIds;
  assert.equal(managers.length, 1);
  const last = managers[0];
  await fails(sdk.updateDoc(sdk.doc(dbFor("admin"), `users/${last}`), { role: "athlete" }));
  await fails(sdk.deleteDoc(sdk.doc(dbFor(last), `users/${last}`)));
  await fails(sdk.setDoc(sdk.doc(dbFor(last), `clubAccounts/${last}`), { clubIds: [], changedClubId: id, updatedAt: sdk.serverTimestamp() }));
});

test("account downgrade preparation checks every club and preserves ordinary roster membership", { skip: !enabled }, async () => {
  const first = await create("Gemeinsam", "a");
  const second = await create("Allein", "a");
  await assign(first, "b");
  const admin = compat(dbFor("admin"));
  await assert.rejects(store.prepareAccountChange(admin, "a", api()), { code: "clubs/last-manager" });
  assert.equal((await sdk.getDoc(sdk.doc(dbFor("admin"), `clubs/${first}`))).data().managerIds.includes("a"), true);
  await assign(second, "b");
  await store.prepareAccountChange(admin, "a", api());
  await succeeds(sdk.updateDoc(sdk.doc(dbFor("admin"), "users/a"), { role: "standard" }));
  assert.equal((await sdk.getDoc(rosterRef(dbFor("b"), first, "account_a"))).exists(), true);
  await fails(sdk.getDoc(sdk.doc(dbFor("a"), `clubs/${first}`)));
});

test("only admins delete clubs and a recreated club starts without old evidence", { skip: !enabled }, async () => {
  const id = await create("Löschen", "a");
  const a = compat(dbFor("a"));
  await store.importPerson(a, id, p1, api());
  await store.saveDates(a, id, p1, { healthDeclaration: sdk.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")) }, api());
  await fails(store.deleteClub(a, id, api()));
  await store.deleteClub(compat(dbFor("admin")), id, api());
  assert.equal((await sdk.getDoc(rosterRef(dbFor("admin"), id, p1))).exists(), false);
  await succeeds(sdk.updateDoc(sdk.doc(dbFor("admin"), "users/a"), { role: "athlete" }));
  const recreated = await create("Löschen", "b");
  await store.importPerson(compat(dbFor("b")), recreated, p1, api());
  assert.equal((await sdk.getDoc(rosterRef(dbFor("b"), recreated, p1))).data().healthDeclaration, null);
});

test("retired personal start eligibility records are inaccessible", { skip: !enabled }, async () => {
  await seed({ "users/a/startEligibility/old": { name: "Alt" } });
  for (const uid of ["a", "admin", "outsider"]) await fails(sdk.getDoc(sdk.doc(dbFor(uid), "users/a/startEligibility/old")));
});

test("an unlinked responsible account merges into its database person without duplicate roster entries", { skip: !enabled }, async () => {
  const id = await create("Verknüpfung", "a");
  const a = compat(dbFor("a"));
  const admin = compat(dbFor("admin"));
  await store.importPerson(a, id, p1, api());
  const year = new Date().getUTCFullYear();
  await store.setActive(a, id, p1, year, true, api());
  await store.saveDates(a, id, "account_a", { rescueSilver: sdk.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")) }, api());
  await links.commit(admin, "a", p1, { uid: "admin" }, api().FieldValue);
  await store.syncResponsibleMemberships(admin, "a", api());
  const roster = await sdk.getDocs(sdk.collection(dbFor("a"), `clubs/${id}/people`));
  assert.deepEqual(roster.docs.map((doc) => doc.id), ["account_a"]);
  assert.deepEqual(roster.docs[0].data().activeYears, [year]);
  assert.equal(roster.docs[0].data().rescueSilver.toDate().getUTCFullYear(), 2026);
});

test("admins can link an unlinked organizer who is already the sole club manager", { skip: !enabled }, async () => {
  const uid = "unlinked-organizer";
  const account = { role: "organizer", displayName: "Organisator", adminReviewPending: true };
  await seed({ [`users/${uid}`]: account, [`clubProfiles/${uid}`]: core.profile(account) });
  const id = await create("Organisator verknüpfen", uid);
  const admin = compat(dbFor("admin"));
  const year = new Date().getUTCFullYear();
  await store.setActive(admin, id, `account_${uid}`, year, true, api());
  const proof = sdk.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
  await store.saveDates(admin, id, `account_${uid}`, { rescueSilver: proof }, api());
  await succeeds(links.commit(admin, uid, p1, { uid: "admin" }, api().FieldValue));
  await succeeds(store.syncResponsibleMemberships(admin, uid, api()));
  const club = (await sdk.getDoc(sdk.doc(dbFor("admin"), `clubs/${id}`))).data();
  const linked = (await sdk.getDoc(sdk.doc(dbFor("admin"), `users/${uid}`))).data();
  const member = (await sdk.getDoc(rosterRef(dbFor("admin"), id, `account_${uid}`))).data();
  assert.deepEqual(club.managerIds, [uid]);
  assert.equal(linked.role, "organizer");
  assert.equal(linked.personLink.id, p1);
  assert.equal(linked.adminReviewPending, false);
  assert.deepEqual((await sdk.getDoc(sdk.doc(dbFor("admin"), `personAccountLinks/${p1}`))).data(), { uid });
  assert.equal(member.personId, p1);
  assert.deepEqual(member.activeYears, [year]);
  assert.equal(member.rescueSilver.isEqual(proof), true);
});

test("linking a responsible organizer tolerates legacy non-text account birth dates", { skip: !enabled }, async () => {
  const uid = "legacy-organizer";
  await seed({ [`users/${uid}`]: { role: "organizer", displayName: "Organisator" } });
  const id = await create("Altes Organisatorkonto", uid);
  const admin = compat(dbFor("admin"));
  for (const birthDate of [null, sdk.Timestamp.fromDate(new Date("1990-01-01T00:00:00Z"))]) {
    // Owner profile writes permit these older formats. Linking must use the
    // selected directory person's birth year, without parsing the old value.
    await succeeds(sdk.updateDoc(sdk.doc(dbFor(uid), `users/${uid}`), { birthDate }));
    await succeeds(links.commit(admin, uid, p1, { uid: "admin" }, api().FieldValue));
    await succeeds(store.syncResponsibleMemberships(admin, uid, api()));
    assert.equal((await sdk.getDoc(rosterRef(dbFor("admin"), id, `account_${uid}`))).data().birthYear, person("Person").birthYear);
    await succeeds(links.commit(admin, uid, null, { uid: "admin" }, api().FieldValue));
  }
});

test("demoting or deleting a linked manager retains their person and evidence in the club", { skip: !enabled }, async () => {
  const id = await create("Person bleibt", "b");
  const admin = compat(dbFor("admin"));
  await assign(id, "o");
  const year = new Date().getUTCFullYear();
  await store.setActive(compat(dbFor("b")), id, "account_b", year, true, api());
  await store.saveDates(compat(dbFor("b")), id, "account_b", { healthDeclaration: sdk.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")) }, api());
  await store.prepareAccountChange(admin, "b", api());
  const plain = (await sdk.getDoc(rosterRef(dbFor("o"), id, p2))).data();
  assert.deepEqual(plain.activeYears, [year]);
  assert.equal((await sdk.getDoc(rosterRef(dbFor("o"), id, "account_b"))).exists(), false);
  await links.deleteAccount(compat(dbFor("b")), "b");
  await store.setActive(compat(dbFor("o")), id, p2, year + 1, true, api());
  assert.equal((await sdk.getDoc(rosterRef(dbFor("o"), id, p2))).data().healthDeclaration.toDate().getUTCFullYear(), 2026);
});

test("members remain accessible through another managed club after one club removes them", { skip: !enabled }, async () => {
  const first = await create("A Eins", "a");
  const second = await create("A Zwei", "a");
  const a = compat(dbFor("a"));
  await store.importPerson(a, first, p1, api());
  await store.importPerson(a, second, p1, api());
  await store.saveDates(a, first, p1, { rescueSilver: sdk.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")) }, api());
  await store.saveDates(a, second, p1, { rescueSilver: sdk.Timestamp.fromDate(new Date("2025-01-01T00:00:00Z")) }, api());
  await store.removePerson(a, first, p1, api());
  assert.equal((await sdk.getDoc(rosterRef(dbFor("a"), second, p1))).exists(), true);
  assert.equal((await sdk.getDoc(rosterRef(dbFor("a"), second, p1))).data().rescueSilver.toDate().getUTCFullYear(), 2025);
  await store.importPerson(a, first, p1, api());
  assert.equal((await sdk.getDoc(rosterRef(dbFor("a"), first, p1))).data().rescueSilver, null);
});

test("restoring a global trainer role grants no responsibility until explicit admin assignment", { skip: !enabled }, async () => {
  const id = await create("Rollenwechsel", "b");
  const adminDb = dbFor("admin");
  const admin = compat(adminDb);
  await assign(id, "o");
  await store.saveDates(compat(dbFor("b")), id, "account_b", { rescueSilver: sdk.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")) }, api());
  await store.prepareAccountChange(admin, "b", api());
  await sdk.runTransaction(adminDb, async (transaction) => {
    const ref = sdk.doc(adminDb, "users/b");
    const account = await transaction.get(ref);
    transaction.update(ref, { role: "athlete" });
    transaction.set(sdk.doc(adminDb, "clubProfiles/b"), core.profile({ ...account.data(), role: "athlete" }));
  });
  assert.equal((await sdk.getDoc(rosterRef(dbFor("o"), id, p2))).data().rescueSilver.toDate().getUTCFullYear(), 2026);
  await sdk.runTransaction(adminDb, async (transaction) => {
    const ref = sdk.doc(adminDb, "users/b");
    const account = await transaction.get(ref);
    transaction.update(ref, { role: "trainer" });
    transaction.set(sdk.doc(adminDb, "clubProfiles/b"), core.profile({ ...account.data(), role: "trainer" }));
  });
  await fails(sdk.getDoc(sdk.doc(dbFor("b"), `clubs/${id}`)));
  await store.syncResponsibleMemberships(admin, "b", api());
  await fails(sdk.getDoc(sdk.doc(dbFor("b"), `clubs/${id}`)));
  await assign(id, "b");
  assert.equal((await sdk.getDoc(sdk.doc(dbFor("b"), `clubs/${id}`))).data().managerIds.includes("b"), true);
  assert.equal((await sdk.getDoc(rosterRef(dbFor("b"), id, "account_b"))).data().rescueSilver.toDate().getUTCFullYear(), 2026);
});

test("unlinking a responsible account still allows club activity and evidence editing", { skip: !enabled }, async () => {
  const id = await create("Zuordnung ändern", "b");
  const b = compat(dbFor("b"));
  await links.unlinkOwn(b, "b", api().FieldValue);
  const year = new Date().getUTCFullYear();
  await store.setActive(b, id, "account_b", year, true, api());
  await store.saveDates(b, id, "account_b", { healthDeclaration: sdk.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")) }, api());
  const member = (await sdk.getDoc(rosterRef(dbFor("b"), id, "account_b"))).data();
  assert.equal(member.personId, "");
  assert.deepEqual(member.activeYears, [year]);
  assert.equal(member.healthDeclaration.toDate().getUTCFullYear(), 2026);
});

test("ordinary membership of an admin, trainer, organizer or athlete never changes club permissions", { skip: !enabled }, async () => {
  const id = await create("Kontorollen sind keine Clubrollen", "a");
  const fourth = "4444444444444444";
  const fifth = "5555555555555555";
  const adminData = { role: "admin", displayName: "admin", personLink: { id: fourth, ...person("admin") } };
  const athleteData = { role: "athlete", displayName: "athlete", personLink: { id: fifth, ...person("athlete") } };
  await seed({
    "users/admin": adminData, "clubProfiles/admin": core.profile(adminData), [`personAccountLinks/${fourth}`]: { uid: "admin" },
    "users/athlete": athleteData, "clubProfiles/athlete": core.profile(athleteData), [`personAccountLinks/${fifth}`]: { uid: "athlete" },
    [`timerParticipantDirectory/${fourth}`]: person("admin"), [`timerParticipantDirectory/${fifth}`]: person("athlete"),
  });
  for (const personId of [p2, p3, fourth, fifth]) {
    assert.equal(await store.importPerson(compat(dbFor("a")), id, personId, api()), personId);
    assert.equal((await sdk.getDoc(rosterRef(dbFor("a"), id, personId))).data().accountUid, "");
  }
  assert.deepEqual((await sdk.getDoc(sdk.doc(dbFor("admin"), `clubs/${id}`))).data().managerIds, ["a"]);
  for (const uid of ["b", "o", "athlete"]) await fails(sdk.getDoc(sdk.doc(dbFor(uid), `clubs/${id}`)));
  await succeeds(sdk.getDoc(sdk.doc(dbFor("admin"), `clubs/${id}`)));
  await assign(id, "b");
  const second = await create("Anderer Club", "a");
  await store.importPerson(compat(dbFor("a")), second, p2, api());
  await fails(sdk.getDoc(sdk.doc(dbFor("b"), `clubs/${second}`)));
});

test("rules reject direct responsibility escalation, including forged roster and index writes", { skip: !enabled }, async () => {
  const id = await create("Keine Selbstbeförderung", "a");
  await store.importPerson(compat(dbFor("a")), id, p2, api());
  const a = dbFor("a");
  const member = (await sdk.getDoc(rosterRef(a, id, p2))).data();
  await fails(sdk.setDoc(rosterRef(a, id, "account_b"), { ...member, accountUid: "b", createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() }));
  const batch = sdk.writeBatch(a);
  batch.update(sdk.doc(a, `clubs/${id}`), { managerIds: ["a", "b"], changedManagerId: "b", updatedAt: sdk.serverTimestamp() });
  batch.set(rosterRef(a, id, "account_b"), { ...member, accountUid: "b", createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() });
  batch.set(sdk.doc(a, "clubAccounts/b"), { clubIds: [id], changedClubId: id, updatedAt: sdk.serverTimestamp() });
  await fails(batch.commit());
  await fails(sdk.updateDoc(sdk.doc(a, `clubs/${id}`), { responsibilityVersion: 1, updatedAt: sdk.serverTimestamp() }));
});

test("legacy automatic permissions are blocked and migrated without losing membership evidence", { skip: !enabled }, async () => {
  const id = await create("Altbestand", "a");
  await assign(id, "b");
  await store.saveDates(compat(dbFor("b")), id, "account_b", { rescueSilver: sdk.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")) }, api());
  await sdk.updateDoc(sdk.doc(dbFor("admin"), `clubs/${id}`), { responsibilityVersion: sdk.deleteField(), updatedAt: sdk.serverTimestamp() });
  await fails(sdk.getDoc(sdk.doc(dbFor("b"), `clubs/${id}`)));
  await fails(sdk.getDoc(sdk.doc(dbFor("a"), `clubs/${id}`)));
  await store.migrateResponsibilities(compat(dbFor("admin")), id, api());
  assert.deepEqual((await sdk.getDoc(sdk.doc(dbFor("a"), `clubs/${id}`))).data().managerIds, ["a"]);
  await fails(sdk.getDoc(sdk.doc(dbFor("b"), `clubs/${id}`)));
  assert.equal((await sdk.getDoc(rosterRef(dbFor("a"), id, p2))).data().rescueSilver.toDate().getUTCFullYear(), 2026);
  await assign(id, "b");
  await store.migrateResponsibilities(compat(dbFor("admin")), id, api());
  await succeeds(sdk.getDoc(sdk.doc(dbFor("b"), `clubs/${id}`)));
});

test("the last organizer cannot leave or forge an orphan alert without beginning account deletion", { skip: !enabled }, async () => {
  const id = await create("Verlassen gesperrt", "o");
  await assert.rejects(store.removePerson(compat(dbFor("o")), id, "account_o", api()), { code: "clubs/last-manager" });
  const db = dbFor("o");
  const batch = sdk.writeBatch(db);
  batch.update(sdk.doc(db, `clubs/${id}`), { managerIds: [], needsResponsible: true, changedManagerId: "o", updatedAt: sdk.serverTimestamp() });
  batch.update(sdk.doc(db, "clubAccounts/o"), { clubIds: [], changedClubId: id, updatedAt: sdk.serverTimestamp() });
  await fails(batch.commit());
  await assert.rejects(store.prepareAccountChange(compat(dbFor("admin")), "o", api()), { code: "clubs/last-manager" });
  assert.equal((await sdk.getDoc(sdk.doc(db, "users/o"))).data().accountDeletionStartedAt, undefined);
});

test("removing an organizer's responsibility allows linking and reassignment without starting account deletion", { skip: !enabled }, async () => {
  const uid = "ordinary-organizer";
  const account = { role: "organizer", displayName: "Organisator" };
  await seed({ [`users/${uid}`]: account });
  const id = await create("Verantwortung wechseln", uid);
  await assign(id, "a");
  const adminDb = dbFor("admin"), admin = compat(adminDb);
  const year = new Date().getUTCFullYear();
  await store.setActive(admin, id, `account_${uid}`, year, true, api());
  await succeeds(store.removePerson(admin, id, `account_${uid}`, api(), () => {}, true));
  assert.deepEqual((await sdk.getDoc(sdk.doc(adminDb, `users/${uid}`))).data(), account);
  assert.deepEqual((await sdk.getDoc(sdk.doc(adminDb, `clubs/${id}`))).data().managerIds, ["a"]);
  await succeeds(links.commit(admin, uid, p1, { uid: "admin" }, api().FieldValue));
  await succeeds(assign(id, uid));
  const restored = (await sdk.getDoc(sdk.doc(adminDb, `users/${uid}`))).data();
  assert.equal(restored.accountDeletionStartedAt, undefined);
  assert.equal(restored.role, "organizer");
  assert.equal(restored.personLink.id, p1);
  assert.deepEqual((await sdk.getDoc(rosterRef(adminDb, id, `account_${uid}`))).data().activeYears, [year]);
  assert.deepEqual((await sdk.getDoc(sdk.doc(adminDb, `clubs/${id}`))).data().managerIds, ["a", uid]);
});

test("a deletion marker blocks admin linking and reassignment until an out-of-band correction", { skip: !enabled }, async () => {
  const uid = "marked-organizer";
  await seed({ [`users/${uid}`]: { role: "organizer", displayName: "Organisator", accountDeletionStartedAt: sdk.Timestamp.now() } });
  const id = await create("Markiertes Konto", "a");
  const adminDb = dbFor("admin"), admin = compat(adminDb);
  await assert.rejects(assign(id, uid), { code: "clubs/account-deleting" });
  await fails(links.commit(admin, uid, p1, { uid: "admin" }, api().FieldValue));
  // Neither the owner nor an admin browser may undo an actual deletion flow.
  for (const db of [dbFor(uid), adminDb]) {
    await fails(sdk.updateDoc(sdk.doc(db, `users/${uid}`), { accountDeletionStartedAt: sdk.deleteField() }));
  }
  // Simulate a targeted Console/Admin SDK repair of a confirmed false marker.
  await env.withSecurityRulesDisabled(async context => {
    await sdk.updateDoc(sdk.doc(context.firestore(), `users/${uid}`), { accountDeletionStartedAt: sdk.deleteField() });
  });
  await succeeds(links.commit(admin, uid, p1, { uid: "admin" }, api().FieldValue));
  await succeeds(assign(id, uid));
  assert.equal((await sdk.getDoc(sdk.doc(adminDb, `users/${uid}`))).data().personLink.id, p1);
  assert.equal((await sdk.getDoc(rosterRef(adminDb, id, `account_${uid}`))).data().personId, p1);
});

test("deleting the sole organizer preserves the database member and evidence and alerts admins until reassigned", { skip: !enabled }, async () => {
  const id = await create("Ohne Verantwortlichen", "o");
  const owner = dbFor("o");
  const db = compat(owner);
  const year = new Date().getUTCFullYear();
  const evidence = sdk.Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
  await store.setActive(db, id, "account_o", year, true, api());
  await store.saveDates(db, id, "account_o", { rescueSilver: evidence }, api());
  await store.prepareAccountDeletion(db, "o", api());
  await links.deleteAccount(db, "o");
  const admin = dbFor("admin");
  const club = (await sdk.getDoc(sdk.doc(admin, `clubs/${id}`))).data();
  assert.deepEqual(club.managerIds, []);
  assert.equal(club.needsResponsible, true);
  assert.equal(club.status, "active");
  assert.equal((await sdk.getDoc(sdk.doc(admin, "users/o"))).exists(), false);
  assert.equal((await sdk.getDoc(sdk.doc(admin, "clubProfiles/o"))).exists(), false);
  const person = (await sdk.getDoc(rosterRef(admin, id, p3))).data();
  assert.equal(person.accountUid, "");
  assert.deepEqual(person.activeYears, [year]);
  assert.equal(person.rescueSilver.toMillis(), evidence.toMillis());
  assert.equal((await sdk.getDoc(rosterRef(admin, id, "account_o"))).exists(), false);
  assert.equal((await sdk.getDoc(sdk.doc(admin, `timerParticipantDirectory/${p3}`))).exists(), true);
  const alerts = sdk.query(sdk.collection(admin, "clubs"), sdk.where("needsResponsible", "==", true));
  assert.equal((await sdk.getDocs(alerts)).size, 1);
  await fails(sdk.getDocs(sdk.query(sdk.collection(dbFor("outsider"), "clubs"), sdk.where("needsResponsible", "==", true))));
  await assign(id, "a");
  assert.equal((await sdk.getDocs(alerts)).size, 0);
  assert.equal((await sdk.getDoc(rosterRef(dbFor("a"), id, p3))).data().rescueSilver.toMillis(), evidence.toMillis());
});

test("account deletion cleanup is restartable across multiple clubs and cannot be cancelled into an ordinary departure", { skip: !enabled }, async () => {
  const first = await create("Eins", "b");
  const second = await create("Zwei", "b");
  const third = await create("Drei", "b");
  await assign(third, "a");
  const b = dbFor("b");
  await store.prepareAccountDeletion(compat(b), "b", api());
  await fails(sdk.updateDoc(sdk.doc(b, "users/b"), { accountDeletionStartedAt: sdk.deleteField() }));
  await fails(sdk.updateDoc(sdk.doc(b, "users/b"), { role: "organizer" }));
  await assert.rejects(assign(third, "b"), { code: "clubs/account-deleting" });
  await store.prepareAccountDeletion(compat(b), "b", api());
  await links.deleteAccount(compat(b), "b");
  const admin = dbFor("admin");
  for (const id of [first, second, third]) {
    assert.equal((await sdk.getDoc(rosterRef(admin, id, p2))).exists(), true);
    assert.equal((await sdk.getDoc(sdk.doc(admin, `clubs/${id}`))).data().needsResponsible, id !== third);
  }
  assert.deepEqual((await sdk.getDoc(sdk.doc(admin, "clubAccounts/b"))).data().clubIds, []);
});

test("parallel account deletions may leave an orphan club with exactly one unresolved alert", { skip: !enabled }, async () => {
  const id = await create("Beide löschen", "b").catch(error => { error.message = `create: ${error.message}`; throw error; });
  await assign(id, "o").catch(error => { error.message = `assign: ${error.message}`; throw error; });
  const results = await Promise.allSettled(["b", "o"].map(async uid => {
    await store.prepareAccountDeletion(compat(dbFor(uid)), uid, api()).catch(error => { error.message = `prepare ${uid}: ${error.message}`; throw error; });
    await links.deleteAccount(compat(dbFor(uid)), uid).catch(error => { error.message = `delete ${uid}: ${error.message}`; throw error; });
  }));
  for (const result of results) if (result.status === "rejected") throw result.reason;
  const admin = dbFor("admin");
  const club = (await sdk.getDoc(sdk.doc(admin, `clubs/${id}`))).data();
  assert.deepEqual(club.managerIds, []);
  assert.equal(club.needsResponsible, true);
  assert.equal((await sdk.getDoc(rosterRef(admin, id, p2))).exists(), true);
  assert.equal((await sdk.getDoc(rosterRef(admin, id, p3))).exists(), true);
  await store.deleteClub(compat(admin), id, api()).catch(error => { error.message = `delete club: ${error.message}`; throw error; });
  assert.equal((await sdk.getDocs(sdk.query(sdk.collection(admin, "clubs"), sdk.where("needsResponsible", "==", true)))).size, 0);
});

test("grouped profile queries keep administrator list access separate from trainer document access", { skip: !enabled }, async () => {
  await seed({ "clubProfiles/a": { name: "Anna", role: "trainer" }, "clubProfiles/b": { name: "Ben", role: "trainer" } });
  const read = (uid) => sdk.getDocs(sdk.query(sdk.collection(dbFor(uid), "clubProfiles"), sdk.where(sdk.documentId(), "in", ["a", "b"]), sdk.limit(10)));
  const result = await succeeds(read("admin"));
  assert.equal(result.size, 2);
  await fails(read("a"));
  await succeeds(sdk.getDoc(sdk.doc(dbFor("a"), "clubProfiles/b")));
  await fails(sdk.getDoc(sdk.doc(dbFor("athlete"), "clubProfiles/b")));
});
