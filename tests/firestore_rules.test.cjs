const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
  throw new Error("Rules tests require a local emulator.");
}
const enabled = Boolean(host);
let env;
let sdk;
let initializeTestEnvironment;
let assertSucceeds;
let assertFails;
before(async () => {
  if (!enabled) return;
  ({ initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing"));
  sdk = require("firebase/firestore");
  sdk.setLogLevel("silent");
  env = await initializeTestEnvironment({
    projectId: "demo-lifesaving-baden",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8") },
  });
});
after(async () => { await env?.cleanup(); });

const timestampFields = () => ({ createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() });
const participant = () => ({ name: "Testperson", birthYear: 5, ageGroup: "Offen", gender: "male", organization: "Baden", ...timestampFields() });
const result = () => ({
  discipline: "normal", participantId: "p", participantIds: ["p"],
  participant: { id: "p", name: "Testperson", birthYear: 5, ageGroup: "Offen", gender: "male", organization: "Baden" },
  teamMembers: [], segments: [100], frequencies: [0], lapGroups: [{ laps: [100] }],
  totalCentiseconds: 100, officialCentiseconds: null, submissionKey: null, note: "", ...timestampFields(),
});
const event = (level) => ({
  name: "Testevent", location: "Baden", poolLength: "25", enabledDisciplines: ["normal"], resultUrl: "",
  timerAccess: level, resultsAccess: level, participantViewAccess: level, participantEditAccess: level, resultEditAccess: level,
  ...timestampFields(),
});
const dbFor = (uid, claims = {}) => uid
  ? env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore()
  : env.unauthenticatedContext().firestore();
async function seed(records) {
  await env.withSecurityRulesDisabled(async (context) => {
    for (const [name, data] of Object.entries(records)) await sdk.setDoc(sdk.doc(context.firestore(), name), data);
  });
}

const worktimeCore = require("../assets/js/worktime-core.js");
const worktimeStore = require("../assets/js/worktime-store.js");
function worktime(input = {}) {
  const data = worktimeCore.prepare({ date: "2099-01-01", start: "22:00", end: "01:00", title: "Training", description: "", category: "training", ...input });
  return { ...data, day: sdk.Timestamp.fromDate(data.day), endDay: sdk.Timestamp.fromDate(data.endDay), startedAt: sdk.Timestamp.fromDate(data.startedAt), endedAt: sdk.Timestamp.fromDate(data.endedAt) };
}
function compatDb(db) {
  const query = (name, filters = []) => ({
    where(field, operator, value) { return query(name, [...filters, sdk.where(field, operator, value)]); },
    get() { return sdk.getDocs(sdk.query(sdk.collection(db, name), ...filters)); },
  });
  const collection = (name) => ({ ...query(name), doc(id) {
    const ref = sdk.doc(db, `${name}/${id}`);
    return { id, native: ref, async get() { const snapshot = await sdk.getDoc(ref); return { exists: snapshot.exists(), data: () => snapshot.data() }; }, collection: (child) => collection(`${name}/${id}/${child}`) };
  } });
  return { collection, runTransaction: (action) => sdk.runTransaction(db, (transaction) => action({
    async get(ref) { const snapshot = await transaction.get(ref.native); return { exists: snapshot.exists(), data: () => snapshot.data() }; },
    set: (ref, data) => transaction.set(ref.native, data),
    delete: (ref) => transaction.delete(ref.native),
    update: (ref, data) => transaction.update(ref.native, data),
  })) };
}
const commitWorktime = (db, uid, id, data) => worktimeStore.commit(compatDb(db), uid, id, data, { Timestamp: sdk.Timestamp, FieldValue: { serverTimestamp: () => sdk.serverTimestamp() } });

test("worktime is owner-only for trainers and higher, including against other admins", { skip: !enabled }, async () => {
  await env.clearFirestore();
  for (const role of ["standard", "athlete", "trainer", "organizer", "admin"]) {
    await seed({ [`users/time-${role}`]: { role } });
    if (["trainer", "organizer", "admin"].includes(role)) await assertSucceeds(commitWorktime(dbFor(`time-${role}`), `time-${role}`, "existing", worktime()));
  }
  for (const role of ["standard", "athlete", "trainer", "organizer", "admin"]) {
    const uid = `time-${role}`;
    const db = dbFor(uid);
    const own = sdk.doc(db, `users/${uid}/worktimeEntries/existing`);
    const check = ["trainer", "organizer", "admin"].includes(role) ? assertSucceeds : assertFails;
    await check(sdk.getDoc(own));
    await check(sdk.getDocs(sdk.collection(db, `users/${uid}/worktimeEntries`)));
    await check(commitWorktime(db, uid, "new", worktime({ date: "2099-01-03" })));
    await check(commitWorktime(db, uid, "existing", worktime({ title: "Bearbeitet" })));
    for (const other of ["trainer", "organizer", "admin"].filter((other) => other !== role)) {
      const ref = sdk.doc(db, `users/time-${other}/worktimeEntries/existing`);
      await assertFails(sdk.getDoc(ref));
      await assertFails(sdk.getDocs(sdk.collection(db, `users/time-${other}/worktimeEntries`)));
      await assertFails(commitWorktime(db, `time-${other}`, "injected", worktime()));
      await assertFails(sdk.updateDoc(ref, { title: "Unzulässig", updatedAt: sdk.serverTimestamp() }));
      await assertFails(sdk.deleteDoc(ref));
      await assertFails(sdk.getDocs(sdk.collection(db, `users/time-${other}/worktimeDays`)));
      await assertFails(sdk.getDoc(sdk.doc(db, `users/time-${other}/worktimeSettings/preferences`)));
    }
    // Release reservations but keep a record for subsequent foreign-access checks.
    await check(commitWorktime(db, uid, "new", null));
  }
  const guest = dbFor(null);
  await assertFails(sdk.getDoc(sdk.doc(guest, "users/time-trainer/worktimeEntries/existing")));
  await assertFails(commitWorktime(guest, "time-trainer", "guest", worktime()));
  const unverified = dbFor("time-trainer", { email_verified: false });
  await assertFails(sdk.getDocs(sdk.collection(unverified, "users/time-trainer/worktimeEntries")));
  await assertFails(commitWorktime(unverified, "time-trainer", "unverified", worktime()));
});

test("worktime validates future intervals, organization settings and immutable creation time", { skip: !enabled }, async () => {
  await env.clearFirestore();
  await seed({ "users/clock-trainer": { role: "trainer" } });
  const db = dbFor("clock-trainer");
  const ref = sdk.doc(db, "users/clock-trainer/worktimeEntries/task");
  await assertSucceeds(commitWorktime(db, "clock-trainer", "task", worktime()));
  const original = (await sdk.getDoc(ref)).data();
  await assertSucceeds(commitWorktime(db, "clock-trainer", "task", worktime({ category: "education", organization: 1, organizationName: "Ettlingen" })));
  await assertSucceeds(commitWorktime(db, "clock-trainer", "task", worktime({ category: "publicRelations" })));
  assert.equal((await sdk.getDoc(ref)).data().category, "publicRelations");
  assert.equal((await sdk.getDoc(ref)).data().createdAt.toMillis(), original.createdAt.toMillis());
  for (const overrides of [
    { title: " " }, { title: "x".repeat(121) }, { description: "x".repeat(2001) }, { category: "invalid" },
    { startMinute: -1 }, { endMinute: 1440 }, { durationMinutes: 0 }, { durationMinutes: 200 },
    { startMinute: 60, endMinute: 60 }, { day: "2099-01-01" }, { startedAt: "yesterday" },
    { day: sdk.Timestamp.fromDate(new Date("2099-01-01T00:01:00Z")) }, { ownerUid: "other" },
    { organization: 3 }, { organization: 0, organizationName: " " },
  ]) await assert.rejects(commitWorktime(db, "clock-trainer", "invalid", { ...worktime({ date: "2099-01-03" }), ...overrides }));
  await assertFails(sdk.updateDoc(ref, { createdAt: sdk.Timestamp.fromMillis(0), updatedAt: sdk.serverTimestamp() }));
  await assertFails(sdk.updateDoc(ref, { updatedAt: sdk.Timestamp.fromMillis(0) }));
  await assertFails(sdk.updateDoc(ref, { title: sdk.deleteField(), updatedAt: sdk.serverTimestamp() }));
  const preferences = sdk.doc(db, "users/clock-trainer/worktimeSettings/preferences");
  await assertSucceeds(sdk.setDoc(preferences, { organizations: ["LV Baden", "Ettlingen", "Privat"] }));
  for (const organizations of [["a", "b", "c", "d"], ["a"], ["a", "b", 42], ["a".repeat(81), "", ""]]) await assertFails(sdk.setDoc(preferences, { organizations }));
  await assertSucceeds(sdk.getDocs(sdk.query(sdk.collection(db, "users/clock-trainer/worktimeEntries"), sdk.where("day", ">=", original.day), sdk.orderBy("day", "desc"))));
  await seed({ "users/clock-trainer": { role: "athlete" } });
  await assertFails(sdk.getDoc(ref));
  await assertFails(commitWorktime(db, "clock-trainer", "task", worktime()));
  await assertFails(commitWorktime(db, "clock-trainer", "task", null));
  const claimDb = dbFor("claim-clock", { role: "trainer" });
  await assertSucceeds(commitWorktime(claimDb, "claim-clock", "task", worktime()));
});

test("worktime prevents overlap across midnight and month boundaries, permits adjacency and releases edits", { skip: !enabled }, async () => {
  await env.clearFirestore();
  await seed({ "users/overlap": { role: "trainer" } });
  const db = dbFor("overlap");
  const save = (id, data) => commitWorktime(db, "overlap", id, data);
  const first = worktime({ date: "2099-01-31" });
  await assertSucceeds(save("first", first));
  await assert.rejects(save("conflict", worktime({ date: "2099-02-01", start: "00:30", end: "02:00" })), { code: "worktime/overlap" });
  await assert.rejects(save("conflict", worktime({ date: "2099-01-31", start: "21:00", end: "23:00" })), { code: "worktime/overlap" });
  await assertSucceeds(save("adjacent", worktime({ date: "2099-02-01", start: "01:00", end: "02:00" })));
  await assert.rejects(save("first", worktime({ date: "2099-02-01", start: "01:30", end: "03:00" })), { code: "worktime/overlap" });
  await assertSucceeds(save("first", worktime({ date: "2099-02-02", start: "10:00", end: "11:00" })));
  await assertSucceeds(save("reuse", first));
  await assertSucceeds(save("reuse", null));
  await assertSucceeds(save("replacement", first));
});

test("worktime rules reject direct writes and forged reservations even if client overlap checks are skipped", { skip: !enabled }, async () => {
  await env.clearFirestore();
  await seed({ "users/forgery": { role: "trainer" } });
  const db = dbFor("forgery");
  const first = worktime({ start: "10:00", end: "12:00" });
  await assertSucceeds(commitWorktime(db, "forgery", "first", first));
  const conflict = worktime({ start: "11:00", end: "13:00" });
  const ref = sdk.doc(db, "users/forgery/worktimeEntries/conflict");
  await assertFails(sdk.setDoc(ref, { ...conflict, ...timestampFields() }));
  const lockRef = sdk.doc(db, "users/forgery/worktimeSchedule/intervals");
  const existing = (await sdk.getDoc(lockRef)).data().entries;
  const interval = { id: "conflict", start: conflict.startedAt, end: conflict.endedAt };
  for (const entries of [[...existing, interval], [interval]]) {
    const batch = sdk.writeBatch(db);
    batch.set(ref, { ...conflict, ...timestampFields() });
    batch.set(lockRef, { entries, entryId: "conflict", position: entries.length - 1, updatedAt: sdk.serverTimestamp() });
    await assertFails(batch.commit());
  }
  await assertFails(sdk.deleteDoc(sdk.doc(db, "users/forgery/worktimeEntries/first")));
});

test("worktime concurrent overlapping submissions allow only one task", { skip: !enabled }, async () => {
  await env.clearFirestore();
  await seed({ "users/race": { role: "trainer" } });
  const db = dbFor("race");
  const outcomes = await Promise.allSettled([
    commitWorktime(db, "race", "a", worktime({ start: "10:00", end: "12:00" })),
    commitWorktime(dbFor("race"), "race", "b", worktime({ start: "11:00", end: "13:00" })),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal((await sdk.getDocs(sdk.collection(db, "users/race/worktimeEntries"))).size, 1);
});

test("worktime detects existing V1 entries before creating an overlapping task", { skip: !enabled }, async () => {
  await env.clearFirestore();
  const legacy = { ...worktime({ date: "2099-01-31" }), ...timestampFields() };
  delete legacy.organization;
  delete legacy.organizationName;
  await seed({ "users/legacy-time": { role: "trainer" }, "users/legacy-time/worktimeEntries/old": legacy });
  const db = dbFor("legacy-time");
  await assert.rejects(commitWorktime(db, "legacy-time", "new", worktime({ date: "2099-02-01", start: "00:30", end: "02:00" })), { code: "worktime/overlap" });
  await assertSucceeds(commitWorktime(db, "legacy-time", "old", worktime({ date: "2099-01-31", organization: 0, organizationName: "Baden" })));
});

test("worktime protects middle days of multi-day intervals and releases the full range on edit and delete", { skip: !enabled }, async () => {
  await env.clearFirestore();
  await seed({ "users/multiday": { role: "trainer" } });
  const db = dbFor("multiday");
  const save = (id, input) => commitWorktime(db, "multiday", id, input === null ? null : worktime(input));
  await assertSucceeds(save("long", { startDate: "2099-01-30", endDate: "2099-02-04", start: "09:00", end: "09:00" }));
  await assert.rejects(save("middle", { date: "2099-02-02", start: "10:00", end: "12:00" }), { code: "worktime/overlap" });
  await assertSucceeds(save("adjacent", { date: "2099-02-04", start: "09:00", end: "10:00" }));
  const middle = worktime({ date: "2099-02-02", start: "10:00", end: "12:00" });
  const lock = sdk.doc(db, "users/multiday/worktimeSchedule/intervals");
  const forged = sdk.writeBatch(db);
  const entries = (await sdk.getDoc(lock)).data().entries;
  entries.splice(1, 0, { id: "middle", start: middle.startedAt, end: middle.endedAt });
  forged.set(sdk.doc(db, "users/multiday/worktimeEntries/middle"), { ...middle, ...timestampFields() });
  forged.set(lock, { entries, entryId: "middle", position: 1, updatedAt: sdk.serverTimestamp() });
  await assertFails(forged.commit());
  await assertSucceeds(save("long", { startDate: "2099-01-30", endDate: "2099-01-31", start: "09:00", end: "09:00" }));
  await assertSucceeds(save("middle", { date: "2099-02-02", start: "10:00", end: "12:00" }));
  await assertSucceeds(save("long", null));
  await assertSucceeds(save("reused", { date: "2099-01-30", start: "10:00", end: "12:00" }));
});

test("worktime upgrades older entries without overwriting titles, creation dates or organization", { skip: !enabled }, async () => {
  await env.clearFirestore();
  const old = { ...worktime({ date: "2099-01-31", title: "Bestehende Aufgabe", organization: 2, organizationName: "Privat" }), ...timestampFields() };
  delete old.endDay;
  await seed({ "users/upgrade": { role: "trainer" }, "users/upgrade/worktimeEntries/old": old });
  const db = dbFor("upgrade");
  const ref = sdk.doc(db, "users/upgrade/worktimeEntries/old");
  const createdAt = (await sdk.getDoc(ref)).data().createdAt;
  await assertSucceeds(commitWorktime(db, "upgrade", "new", worktime({ startDate: "2099-02-03", endDate: "2099-02-06", start: "09:00", end: "09:00" })));
  const upgraded = (await sdk.getDoc(ref)).data();
  assert.equal(upgraded.title, "Bestehende Aufgabe");
  assert.equal(upgraded.organizationName, "Privat");
  assert.equal(upgraded.createdAt.toMillis(), createdAt.toMillis());
  assert.equal(upgraded.endDay.toDate().toISOString(), "2099-02-01T00:00:00.000Z");
});

test("all roles and legacy roles enforce the same event thresholds for reads and writes", { skip: !enabled }, async (t) => {
  await env.clearFirestore();
  const levels = { everyone: 0, authenticated: 1, athlete: 2, kader: 2, trainer: 3, organizer: 4, locked: 5 };
  for (const level of Object.keys(levels)) {
    await seed({ [`timerEvents/${level}`]: event(level), [`timerEvents/${level}/participants/p`]: participant(), [`timerEvents/${level}/results/r`]: result() });
  }
  const cases = [
    [null, null, 0], ["standard", { role: "standard" }, 1], ["old-standard", { role: "sportler" }, 1],
    ["athlete", { role: "athlete" }, 2], ["old-athlete", { role: "kader-sportler" }, 2],
    ["old-flag", { isKaderAthlete: true }, 2], ["trainer", { role: "trainer" }, 3],
    ["claim-trainer", { role: "standard" }, 3, { role: "trainer" }],
    ["claim-athlete", { role: "standard" }, 2, { isKaderAthlete: true }],
    ["organizer", { role: "organizer" }, 4], ["alias", { role: " Organisator " }, 4], ["admin", { role: "ADMIN" }, 5],
  ];
  for (const [uid, data, rank, claims] of cases) {
    if (uid) await seed({ [`users/${uid}`]: data });
    await t.test(uid || "guest", async () => {
      const db = dbFor(uid, claims);
      for (const [level, threshold] of Object.entries(levels)) {
        const check = rank >= threshold ? assertSucceeds : assertFails;
        await check(sdk.getDoc(sdk.doc(db, `timerEvents/${level}/participants/p`)));
        await check(sdk.getDocs(sdk.collection(db, `timerEvents/${level}/results`)));
        await check(sdk.setDoc(sdk.doc(db, `timerEvents/${level}/participants/new-${uid || "guest"}`), participant()));
        await check(sdk.setDoc(sdk.doc(db, `timerEvents/${level}/results/new-${uid || "guest"}`), result()));
        await check(sdk.updateDoc(sdk.doc(db, `timerEvents/${level}/participants/p`), { name: "Geändert", updatedAt: sdk.serverTimestamp() }));
        await check(sdk.updateDoc(sdk.doc(db, `timerEvents/${level}/results/r`), { note: "Geändert", updatedAt: sdk.serverTimestamp() }));
      }
    });
  }
});

test("event administration and unrestricted directory reads stay exclusive to organizers and admins", { skip: !enabled }, async () => {
  await env.clearFirestore();
  await seed({ "timerParticipantDirectory/p": { name: "Testperson" } });
  for (const role of ["standard", "athlete", "trainer", "organizer", "admin"]) {
    await seed({ [`users/${role}`]: { role }, [`timerEvents/${role}`]: event("trainer") });
    const db = dbFor(role);
    const check = ["organizer", "admin"].includes(role) ? assertSucceeds : assertFails;
    await check(sdk.setDoc(sdk.doc(db, `timerEvents/new-${role}`), event("trainer")));
    await check(sdk.updateDoc(sdk.doc(db, `timerEvents/${role}`), { timerAccess: "athlete", updatedAt: sdk.serverTimestamp() }));
    await check(sdk.deleteDoc(sdk.doc(db, `timerEvents/${role}`)));
    await check(sdk.getDocs(sdk.collection(db, "timerParticipantDirectory")));
  }
});

test("start eligibility is private to its verified owner and only imports directory identities", { skip: !enabled }, async () => {
  await env.clearFirestore();
  const candidate = { name: "Testperson", birthYear: 2010, organization: "Baden" };
  const entry = () => ({ ...candidate, swimSilver: null, swimGold: null, rescueBronze: null, rescueSilver: null,
    rescueGold: null, combinedExercise: null, healthDeclaration: null, ...timestampFields() });
  await seed({ "timerParticipantDirectory/p": { ...candidate, searchName: "testperson" } });
  const roles = ["standard", "athlete", "trainer", "organizer", "admin"];
  const allowed = ["trainer", "organizer", "admin"];
  for (const role of roles) await seed({ [`users/${role}`]: { role } });
  for (const role of roles) {
    const db = dbFor(role);
    const directory = sdk.collection(db, "timerParticipantDirectory");
    const search = sdk.query(directory, sdk.orderBy("searchName"), sdk.startAt("tes"), sdk.endAt("tes\uf8ff"), sdk.limit(10));
    const own = sdk.doc(db, `users/${role}/startEligibility/p`);
    const check = allowed.includes(role) ? assertSucceeds : assertFails;
    await check(sdk.getDocs(search));
    await check(sdk.setDoc(own, entry()));
    await check(sdk.getDocs(sdk.collection(db, `users/${role}/startEligibility`)));
    await check(sdk.updateDoc(own, { healthDeclaration: sdk.Timestamp.fromDate(new Date("2025-01-01T00:00:00Z")), updatedAt: sdk.serverTimestamp() }));
    await assertFails(sdk.setDoc(sdk.doc(db, `users/${role}/startEligibility/manual`), entry()));
    await assertFails(sdk.updateDoc(own, { birthYear: 2011, updatedAt: sdk.serverTimestamp() }));
    await assertFails(sdk.updateDoc(own, { healthDeclaration: "2025-01-01", updatedAt: sdk.serverTimestamp() }));
    await assertFails(sdk.updateDoc(own, { healthDeclaration: sdk.Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")), updatedAt: sdk.serverTimestamp() }));
    await assertFails(sdk.setDoc(sdk.doc(db, "timerParticipantDirectory/manual"), candidate));
  }
  for (const role of allowed) {
    const db = dbFor(role);
    for (const other of allowed.filter((item) => item !== role)) {
      const otherEntry = sdk.doc(db, `users/${other}/startEligibility/p`);
      await assertFails(sdk.getDoc(otherEntry));
      await assertFails(sdk.getDocs(sdk.collection(db, `users/${other}/startEligibility`)));
      await assertFails(sdk.updateDoc(otherEntry, { healthDeclaration: null, updatedAt: sdk.serverTimestamp() }));
      await assertFails(sdk.deleteDoc(otherEntry));
    }
    const own = sdk.doc(db, `users/${role}/startEligibility/p`);
    await assertSucceeds(sdk.deleteDoc(own));
    await assertFails(sdk.setDoc(own, { ...entry(), name: "Erfundene Person" }));
  }
  const trainer = dbFor("trainer");
  await assertFails(sdk.getDoc(sdk.doc(trainer, "timerParticipantDirectory/p")));
  await assertFails(sdk.getDocs(sdk.query(sdk.collection(trainer, "timerParticipantDirectory"), sdk.limit(11))));
  const unverified = dbFor("trainer", { email_verified: false });
  await assertFails(sdk.getDocs(sdk.query(sdk.collection(unverified, "timerParticipantDirectory"), sdk.limit(10))));
  await assertFails(sdk.getDocs(sdk.collection(unverified, "users/trainer/startEligibility")));
});

test("admins can edit their own profile but nobody can demote or delete admin accounts", { skip: !enabled }, async () => {
  await env.clearFirestore();
  await seed({ "users/admin": { role: "admin" }, "users/other": { role: "admin" } });
  for (const marker of [{ role: "admin" }, { role: " ADMIN " }, { admin: true }, { isAdmin: true }]) {
    await seed({ "users/admin": marker });
    for (const uid of ["admin", "other"]) {
      const ref = sdk.doc(dbFor(uid), "users/admin");
      const profileCheck = uid === "admin" ? assertSucceeds : assertFails;
      await profileCheck(sdk.updateDoc(ref, { displayName: `Geändert ${uid}`, privateProfile: true, birthDate: "2000-01-01" }));
      await assertFails(sdk.updateDoc(ref, { role: "standard", admin: false, isAdmin: false }));
      await assertFails(sdk.deleteDoc(ref));
    }
  }
  await seed({ "users/claim-admin": { role: "standard" } });
  const claimAdmin = sdk.doc(dbFor("claim-admin", { admin: true }), "users/claim-admin");
  await assertSucceeds(sdk.updateDoc(claimAdmin, { displayName: "Geändert" }));
  await assertFails(sdk.updateDoc(claimAdmin, { role: "trainer" }));
  await assertFails(sdk.deleteDoc(claimAdmin));
  assert.equal((await sdk.getDoc(sdk.doc(dbFor("other"), "users/admin"))).data().isAdmin, true);
});

test("only admins can assign non-admin roles; legacy athlete flags can be removed on demotion", { skip: !enabled }, async () => {
  await env.clearFirestore();
  await seed({ "users/admin": { role: "admin" }, "users/user": { role: "sportler" } });
  const owner = sdk.doc(dbFor("user"), "users/user");
  await assertSucceeds(sdk.updateDoc(owner, { displayName: "Eigener Name" }));
  for (const role of ["athlete", "trainer", "organizer", "admin"]) await assertFails(sdk.updateDoc(owner, { role }));
  const target = sdk.doc(dbFor("admin"), "users/user");
  for (const role of ["trainer", "athlete", "organizer", "standard"]) await assertSucceeds(sdk.updateDoc(target, { role }));
  await assertFails(sdk.updateDoc(target, { role: "admin" }));
  await assertFails(sdk.updateDoc(target, { admin: true }));
  await assertFails(sdk.updateDoc(target, { isAdmin: true }));
  await seed({ "users/user": { role: "kader-sportler", kader: true, isKaderAthlete: true }, "timerEvents/athlete": event("athlete"), "timerEvents/athlete/participants/p": participant() });
  await assertSucceeds(sdk.updateDoc(target, { role: "standard", kader: sdk.deleteField(), isKaderAthlete: sdk.deleteField() }));
  await assertFails(sdk.getDoc(sdk.doc(dbFor("user"), "timerEvents/athlete/participants/p")));
  for (const role of ["standard", "sportler"]) await assertSucceeds(sdk.setDoc(sdk.doc(dbFor(`new-${role}`), `users/new-${role}`), { role }));
  for (const role of ["athlete", "trainer", "organizer", "admin"]) await assertFails(sdk.setDoc(sdk.doc(dbFor(`new-${role}`), `users/new-${role}`), { role }));
});

const personLinks = require("../assets/js/person-link-store.js");
const personId = "1234567890abcdef";
const secondPersonId = "abcdef1234567890";
const directoryPerson = { name: "Anna Altbestand", birthYear: 1991, gender: "w", organization: "Baden", searchName: "annaaltbestand" };
const commitLink = (db, uid, id, actor = "admin") => personLinks.commit(compatDb(db), uid, id,
  { uid: actor, email: `${actor}@example.test` }, { serverTimestamp: sdk.serverTimestamp, delete: sdk.deleteField });

async function seedLinks() {
  await env.clearFirestore();
  await seed({ "users/admin": { role: "admin" }, "users/other-admin": { role: "admin" },
    "users/one": { role: "standard", displayName: "Eigener Name" }, "users/two": { role: "trainer" },
    [`timerParticipantDirectory/${personId}`]: directoryPerson,
    [`timerParticipantDirectory/${secondPersonId}`]: { ...directoryPerson, name: "Ben Zweiter" },
  });
}

test("only admins can assign existing people, including to themselves and other admins", { skip: !enabled }, async () => {
  await seedLinks();
  for (const uid of ["admin", "other-admin", "one", "two"]) {
    await assertSucceeds(commitLink(dbFor("admin"), uid, personId));
    const profile = (await sdk.getDoc(sdk.doc(dbFor(uid), `users/${uid}`))).data();
    assert.equal(profile.personLink.name, directoryPerson.name);
    assert.equal(profile.role, uid.includes("admin") ? "admin" : uid === "one" ? "standard" : "trainer");
    if (uid === "one") assert.equal(profile.displayName, "Eigener Name");
    assert.equal("linkedPersonId" in profile, false);
    await assertSucceeds(commitLink(dbFor("admin"), uid, null));
  }
  for (const [uid, role] of [["one", "standard"], ["two", "trainer"], ["organizer", "organizer"]]) {
    await seed({ [`users/${uid}`]: { role } });
    await assertFails(commitLink(dbFor(uid), uid, personId, uid));
    await assertFails(sdk.updateDoc(sdk.doc(dbFor(uid), `users/${uid}`), { personLink: { id: personId, ...directoryPerson } }));
  }
  await assert.rejects(commitLink(dbFor("admin"), "one", "0000000000000000"), { code: "person-link/person-missing" });
});

test("person reservations prevent duplicates and concurrent admins can only link one account", { skip: !enabled }, async () => {
  await seedLinks();
  const outcomes = await Promise.allSettled([
    commitLink(dbFor("admin"), "one", personId), commitLink(dbFor("other-admin"), "two", personId, "other-admin"),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const db = dbFor("admin");
  const reservation = (await sdk.getDoc(sdk.doc(db, `personAccountLinks/${personId}`))).data();
  const other = reservation.uid === "one" ? "two" : "one";
  await assert.rejects(commitLink(db, other, personId), { code: "person-link/already-linked" });
  // Bypassing the client must not bypass uniqueness or source verification.
  const batch = sdk.writeBatch(db);
  batch.update(sdk.doc(db, `users/${other}`), { personLink: { id: personId, ...directoryPerson }, personLinkStatus: "linked" });
  batch.set(sdk.doc(db, `personAccountLinks/${personId}`), { uid: other });
  await assertFails(batch.commit());
  await assertFails(sdk.updateDoc(sdk.doc(db, `users/${other}`), { personLink: { id: secondPersonId, ...directoryPerson }, personLinkStatus: "linked" }));
});

test("changing, unlinking and deleting release reservations while users can only edit their own profile", { skip: !enabled }, async () => {
  await seedLinks();
  const db = dbFor("admin");
  await assertSucceeds(commitLink(db, "one", personId));
  const owner = dbFor("one");
  const ref = sdk.doc(owner, "users/one");
  await assertSucceeds(sdk.updateDoc(ref, { displayName: "Neuer Kontoname" }));
  assert.equal((await sdk.getDoc(ref)).data().personLink.name, directoryPerson.name);
  await assertFails(sdk.updateDoc(ref, { personLink: sdk.deleteField(), personLinkStatus: "open" }));
  await assertFails(sdk.deleteDoc(sdk.doc(owner, `personAccountLinks/${personId}`)));
  await assertFails(sdk.deleteDoc(ref));
  await assertSucceeds(commitLink(db, "one", secondPersonId));
  await assertSucceeds(commitLink(db, "two", personId));
  await assertSucceeds(commitLink(db, "two", null));
  await assertSucceeds(commitLink(db, "two", personId));
  await assertSucceeds(personLinks.deleteAccount(compatDb(owner), "one"));
  await assertSucceeds(commitLink(db, "two", secondPersonId));
});

test("every role may report an issue and atomically unlink its own person without gaining link rights", { skip: !enabled }, async () => {
  for (const role of ["standard", "athlete", "trainer", "organizer", "admin"]) {
    await seedLinks();
    await seed({ "users/one": { role, displayName: "Eigener Name" } });
    const adminDb = dbFor("admin");
    await assertSucceeds(commitLink(adminDb, "one", personId));
    const owner = dbFor("one");
    const ref = sdk.doc(owner, "users/one");
    await assertSucceeds(sdk.updateDoc(ref, { personLinkIssue: {
      status: "reported", message: "Falsche Person", accountUid: "one", reportedAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(),
    } }));
    // Removing only one side of the link is forbidden, even with a valid timestamp.
    await assertFails(sdk.updateDoc(ref, { personLink: sdk.deleteField(), personLinkStatus: "open", updatedAt: sdk.serverTimestamp() }));
    await assertFails(sdk.deleteDoc(sdk.doc(owner, `personAccountLinks/${personId}`)));
    const fieldValue = { serverTimestamp: sdk.serverTimestamp, delete: sdk.deleteField };
    const result = await assertSucceeds(personLinks.unlinkOwn(compatDb(owner), "one", fieldValue));
    assert.equal(result.personLink, undefined);
    const data = (await sdk.getDoc(ref)).data();
    assert.equal(data.personLinkStatus, "open");
    assert.equal(data.personLink, undefined);
    assert.equal(data.personLinkIssue, undefined);
    assert.equal(data.role, role);
    assert.equal(data.displayName, "Eigener Name");
    assert.equal((await sdk.getDoc(sdk.doc(adminDb, `personAccountLinks/${personId}`))).exists(), false);
    await assertSucceeds(commitLink(adminDb, "two", personId));
    if (role !== "admin") {
      await assertFails(personLinks.unlinkOwn(compatDb(owner), "two", fieldValue));
      await assertFails(commitLink(owner, "one", secondPersonId, "one"));
    }
  }
});

test("rules reject forged links at account creation, legacy manual IDs and altered source identities", { skip: !enabled }, async () => {
  await seedLinks();
  for (const fields of [{ linkedPersonId: personId }, { personId }, { personLinked: true },
    { personLinkStatus: "linked" }, { personLink: { id: personId } }]) {
    await assertFails(sdk.setDoc(sdk.doc(dbFor("new"), "users/new"), { role: "standard", ...fields }));
  }
  const db = dbFor("admin");
  await assertFails(sdk.updateDoc(sdk.doc(db, "users/one"), { linkedPersonId: personId, personLinked: true }));
  const batch = sdk.writeBatch(db);
  batch.update(sdk.doc(db, "users/one"), { personLink: { id: personId, name: "Gefälscht", birthYear: 1991, gender: "w", organization: "Baden" }, personLinkStatus: "linked" });
  batch.set(sdk.doc(db, `personAccountLinks/${personId}`), { uid: "one" });
  await assertFails(batch.commit());
  await seed({ "users/one": { role: "standard", linkedPersonId: "legacy", personLinked: true, personLinkStatus: "linked" } });
  await assertSucceeds(commitLink(db, "one", personId));
  await assertFails(sdk.updateDoc(sdk.doc(dbFor("admin"), "users/other-admin"), { role: "standard" }));
});

test("notification aggregations count open requests and issues without returning account documents and stay admin-only", { skip: !enabled }, async () => {
  await env.clearFirestore();
  await seed({
    "users/admin": { role: "admin" }, "users/trainer": { role: "trainer" },
    "users/current": { personLinkStatus: "requested", personLinkRequest: { status: "requested" }, personLinkIssue: { status: "reported" } },
    "users/legacy": { personLinkRequest: { status: "requested" } },
    "users/status-only": { personLinkStatus: "requested" },
    "users/issue": { personLinkIssue: { status: "reported" } },
    "users/closed": { personLinkStatus: "linked", personLinkIssue: { status: "resolved" } },
  });
  const code = fs.readFileSync(path.join(__dirname, "../assets/js/auth.js"), "utf8");
  const countCode = code.slice(code.indexOf("  async function countAdminNotifications"), code.indexOf("  function initAdminAccountBadge"));
  const countNotifications = new Function("window", "fetch", `${countCode}; return countAdminNotifications;`)(
    { firebaseConfig: { projectId: "demo-lifesaving-baden" } },
    (url, options) => fetch(url.replace("https://firestore.googleapis.com", `http://${host}`), options)
  );
  const { createMockUserToken } = require("@firebase/util");
  const user = (uid) => ({ getIdToken: async () => createMockUserToken({ sub: uid, email_verified: true }, "demo-lifesaving-baden") });
  assert.equal(await countNotifications(user("admin")), 5);
  await assert.rejects(countNotifications(user("trainer")));
});
