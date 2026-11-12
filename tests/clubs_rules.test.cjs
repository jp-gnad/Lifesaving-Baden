const { before, after, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../assets/js/clubs-core.js");
const store = require("../assets/js/clubs-store.js");
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
