const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../training/core.js");

function harness() {
  let authChanged;
  let profileChanged;
  let role = "kader-sportler";
  const subscriptions = new Map();
  const batches = [];
  const doc = () => ({ metadata: { fromCache: false }, data: () => ({ role, displayName: "Anna" }) });
  const query = (collection) => ({
    where() { return this; },
    onSnapshot(options, onData) { subscriptions.set(collection, onData); return () => subscriptions.delete(collection); },
    doc(id = "new-entry") { return collection === "users" ? {
      async get() { return doc(); },
      onSnapshot(callback) { profileChanged = callback; return () => {}; }
    } : { id, collection }; }
  });
  const db = { collection: query, batch() {
    const operations = [];
    const batch = { set: (ref, data) => operations.push({ ref, data }),
      update: (ref, data) => operations.push({ ref, data }),
      async commit() { batches.push(operations); } };
    return batch;
  } };
  const auth = { currentUser: null, async setPersistence() {}, onIdTokenChanged(callback) { authChanged = callback; } };
  const firebaseAuth = () => auth;
  firebaseAuth.Auth = { Persistence: { LOCAL: "local" } };
  const firestore = () => db;
  firestore.Timestamp = { fromDate: (date) => ({ toDate: () => date }) };
  firestore.FieldValue = { serverTimestamp: () => "SERVER_TIMESTAMP" };
  const window = { TrainingCore: core, isFirebaseConfigured: true, firebaseConfig: {},
    firebase: { apps: [{}], auth: firebaseAuth, firestore } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../training/firestore-api.js"), "utf8"), { window, console, Date, Map });
  const user = { uid: "anna", displayName: "Anna", async getIdTokenResult() { return { claims: { email_verified: true } }; } };
  return { store: window.TrainingStore, batches,
    async signIn() { auth.currentUser = user; await authChanged(user); },
    async refresh() { await authChanged(user); },
    setRole(next) { role = next; profileChanged(doc()); },
    emit(collection, entries) {
      subscriptions.get(collection)({ metadata: { fromCache: false, hasPendingWrites: false },
        docs: entries.map((entry) => ({ id: entry.id, data: () => entry })) });
    }
  };
}

test("ready athletes can save without waiting for rankings/history to load", async () => {
  const app = harness();
  await app.store.start(() => {});
  await app.signIn();
  await app.store.saveEntry({ date: core.today(), meters: 2500, motivation: 7, text: "" });
  assert.equal(app.batches.length, 1);
  assert.equal(app.batches[0].length, 3);
});

test("token refresh preserves the ready UI, while a revoked role denies further saves", async () => {
  const app = harness();
  const identities = [];
  await app.store.start((identity) => identities.push(identity));
  await app.signIn();
  identities.length = 0;
  await app.refresh();
  assert.equal(identities.some(({ loading }) => loading), false, "A routine token refresh must not reset a draft.");
  assert.equal(identities.at(-1).allowed, true);
  app.setRole("sportler");
  assert.equal(identities.at(-1).allowed, false);
  await assert.rejects(app.store.saveEntry({ date: core.today(), meters: 2500, motivation: 7 }));
});

test("realtime updates wait for matching distances, motivation and private notes", async () => {
  const app = harness();
  await app.store.start(() => {});
  await app.signIn();
  const snapshots = [];
  app.store.watchYear("2026", (entries) => snapshots.push(entries), (error) => { throw error; });
  const timestamp = (seconds) => ({ seconds, isEqual(other) { return other?.seconds === seconds; } });
  const common = { id: "entry", uid: "anna", date: "2026-10-10", updatedAt: timestamp(1) };
  app.emit("trainingEntries", [{ ...common, meters: 3000, athleteName: "Anna" }]);
  app.emit("trainingMetrics", [{ ...common, motivation: 8 }]);
  assert.equal(snapshots.length, 0);
  app.emit("trainingNotes", [{ ...common, text: "Alte Notiz" }]);
  assert.equal(snapshots.length, 1);
  const updated = { ...common, updatedAt: timestamp(2) };
  app.emit("trainingEntries", [{ ...updated, meters: 4000, athleteName: "Anna" }]);
  app.emit("trainingMetrics", [{ ...updated, motivation: 9 }]);
  assert.equal(snapshots.length, 1, "Do not mix a corrected training with an older private note.");
  app.emit("trainingNotes", [{ ...updated, text: "Neue Notiz" }]);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[1][0].meters, 4000);
  assert.equal(snapshots[1][0].text, "Neue Notiz");
});
