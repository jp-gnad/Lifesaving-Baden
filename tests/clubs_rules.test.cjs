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
const api = () => ({ FieldValue: { serverTimestamp: sdk.serverTimestamp, arrayUnion: sdk.arrayUnion, arrayRemove: sdk.arrayRemove, delete: sdk.deleteField }, Timestamp: sdk.Timestamp });
const dbFor = (uid, claims = {}) => uid ? env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore() : env.unauthenticatedContext().firestore();

function compat(db) {
  const collection = (name) => ({
    limit: (size) => ({ async get() { const snapshot = await sdk.getDocs(sdk.query(sdk.collection(db, name), sdk.limit(size))); return { docs: snapshot.docs.map(wrap) }; } }),
    async get() { const snapshot = await sdk.getDocs(sdk.collection(db, name)); return { docs: snapshot.docs.map(wrap) }; },
    doc(id) {
      const native = sdk.doc(db, `${name}/${id}`);
      return {
        id, native, collection: (child) => collection(`${name}/${id}/${child}`),
        async get() { return wrap(await sdk.getDoc(native)); },
        set: (data, options) => sdk.setDoc(native, data, options), update: (data) => sdk.updateDoc(native, data), delete: () => sdk.deleteDoc(native),
      };
    },
  });
  const wrap = (snapshot) => ({ id: snapshot.id, exists: snapshot.exists(), data: () => snapshot.data() });
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
