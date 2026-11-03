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

test("event administration and directory import stay exclusive to organizers and admins", { skip: !enabled }, async () => {
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

test("admins can manage person links on admin accounts without changing protected account data", { skip: !enabled }, async () => {
  await env.clearFirestore();
  await seed({ "users/admin": { role: "admin" }, "users/trainer": { role: "trainer" } });
  for (const marker of [{ role: "admin" }, { role: " ADMIN " }, { admin: true }, { isAdmin: true }]) {
    await seed({ "users/target-admin": marker });
    for (const uid of ["admin", "target-admin"]) {
      const ref = sdk.doc(dbFor(uid), "users/target-admin");
      await assertSucceeds(sdk.updateDoc(ref, {
        linkedPersonId: "person-123", personLinkStatus: "linked", personLinked: true,
        personLinkRequest: sdk.deleteField(), personLinkIdentityHint: sdk.deleteField(),
        personLinkDecision: { status: "linked", personId: "person-123", decidedByUid: uid },
        updatedAt: sdk.serverTimestamp(),
      }));
      await assertSucceeds(sdk.updateDoc(ref, {
        "personLinkIssue.status": "resolved", "personLinkIssue.decidedByUid": uid,
        updatedAt: sdk.serverTimestamp(),
      }));
      const forbiddenChanges = [{ role: "standard" }, { admin: false }, { isAdmin: false }, { organizer: true }, { kader: true }];
      if ("role" in marker) forbiddenChanges.push({ role: sdk.deleteField() });
      for (const forbidden of forbiddenChanges) {
        await assertFails(sdk.updateDoc(ref, { linkedPersonId: "person-456", ...forbidden }));
      }
      await assertFails(sdk.deleteDoc(ref));
      await assertSucceeds(sdk.updateDoc(ref, {
        linkedPersonId: sdk.deleteField(), personId: sdk.deleteField(), personLinkStatus: "open", personLinked: false,
      }));
    }
    const trainer = sdk.doc(dbFor("trainer"), "users/target-admin");
    await assertFails(sdk.updateDoc(trainer, { linkedPersonId: "person-123", personLinked: true }));
    const otherAdmin = sdk.doc(dbFor("admin"), "users/target-admin");
    await assertFails(sdk.updateDoc(otherAdmin, { linkedPersonId: "person-123", displayName: "Unzulässig" }));
  }
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
