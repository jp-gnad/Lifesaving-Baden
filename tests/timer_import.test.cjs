const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const store = require("../timer/participant-store.js");

function memoryDb(records) {
  const data = new Map(Object.entries(records));
  const reads = new Map();
  const queries = [];
  const listeners = [];
  const listen = (path, filters, receive, fail) => {
    const entry = { path, filters, receive, fail, stopped: false };
    listeners.push(entry);
    return () => { entry.stopped = true; };
  };
  const count = (key) => reads.set(key, (reads.get(key) || 0) + 1);
  const snapshot = (ref) => ({ id: ref.id, ref, exists: data.has(ref.path), data: () => ({ ...data.get(ref.path) }) });
  const doc = (name) => ({
    path: name, id: name.split("/").at(-1), collection: (child) => collection(`${name}/${child}`),
    async get() { count(name); return snapshot(this); },
    async set(value) { data.set(name, value); },
    async update(value) { data.set(name, { ...data.get(name), ...value }); },
    async delete() { data.delete(name); },
    onSnapshot(receive, fail) { return listen(name, null, receive, fail); },
  });
  const collection = (name, filters = {}) => ({
    doc: (id) => doc(`${name}/${id}`),
    orderBy: (order) => collection(name, { ...filters, order }),
    startAfter: (after) => collection(name, { ...filters, after }),
    startAt: (start) => collection(name, { ...filters, start }),
    endAt: (end) => collection(name, { ...filters, end }),
    limit: (limit) => collection(name, { ...filters, limit }),
    async get() {
      count(name);
      queries.push({ path: name, ...filters });
      const docs = [...data.keys()].filter((key) => key.startsWith(`${name}/`) && key.slice(name.length + 1).indexOf("/") < 0)
        .map((key) => snapshot(doc(key)))
        .filter((item) => (!filters.start || item.data().searchName >= filters.start) && (!filters.end || item.data().searchName <= filters.end))
        .filter((item) => !filters.after || item.id > filters.after)
        .sort((left, right) => {
          const key = (item) => filters.order === "__name__" ? item.id : String(item.data()[filters.order] || "");
          return key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0;
        })
        .slice(0, filters.limit ?? Infinity);
      return { docs, empty: !docs.length, metadata: { fromCache: false } };
    },
    onSnapshot(receive, fail) { return listen(name, filters, receive, fail); },
  });
  const batch = () => {
    const writes = [];
    const api = {
      set(ref, value) { writes.push(() => data.set(ref.path, value)); return api; },
      update(ref, value) { writes.push(() => data.set(ref.path, { ...data.get(ref.path), ...value })); return api; },
      delete(ref) { writes.push(() => data.delete(ref.path)); return api; },
      async commit() { writes.forEach((write) => write()); },
    };
    return api;
  };
  let tail = Promise.resolve();
  const db = { collection, batch, enablePersistence: async () => {}, runTransaction(action) {
    const run = tail.then(async () => {
      const writes = batch();
      const value = await action({ get: (ref) => ref.get(), set: writes.set, update: writes.update, delete: writes.delete });
      await writes.commit();
      return value;
    });
    tail = run.catch(() => {});
    return run;
  } };
  return { db, data, reads, queries, listeners };
}

const person = (name, input = {}) => ({ name, birthYear: 5, gender: "female", organization: "Baden", ageGroup: "Offen", createdAt: "2026-01-01", updatedAt: "2026-01-01", ...input });
const event = (input = {}) => ({ name: "Test", eventDate: "2026-11-12", participantIndexVersion: 1, participantEditAccess: "organizer", participantViewAccess: "organizer", ...input });
const sdk = { serverTimestamp: () => "2026-11-12T12:00:00.000Z" };

async function adapter(records) {
  const h = memoryDb(records);
  let callback;
  let clock = 1_000_000;
  class TestDate extends Date { static now() { return clock; } }
  const auth = { currentUser: { uid: "organizer" }, onAuthStateChanged(fn) { callback = fn; }, async signOut() { auth.currentUser = null; callback(null); } };
  const firestore = () => h.db;
  firestore.FieldValue = sdk;
  firestore.FieldPath = { documentId: () => "__name__" };
  const window = {
    location: { origin: "https://example.test" }, TimerParticipantStore: store, TimerCore: require("../timer/core.js"), TimerResultFeed: require("../timer/result-feed.js"),
    firebase: { auth: () => auth, firestore }, isFirebaseConfigured: true,
    LifesavingPersonLinks: { linkedPerson: () => null },
    LifesavingAuth: {
      initFirebase: () => auth, ensureLocalAuthPersistence: async () => {}, loadUserContext: async () => ({ userData: {}, claims: {} }),
      hasVerifiedAccess: async (user) => Boolean(user), getAccountRole: () => ({ isOrganizer: true, role: "organizer" }),
      getNameDetailsFromData: () => ({ displayName: "Test" }), requiresAccountSetup: () => false,
    },
    dispatchEvent() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../timer/firestore-api.js"), "utf8"), {
    window, document: { addEventListener() {} }, URL, crypto: require("node:crypto").webcrypto,
    CustomEvent: class {}, console, Date: TestDate,
  });
  callback(auth.currentUser);
  await window.timerFirestoreApi.getAuthContext();
  return { ...h, api: window.timerFirestoreApi, auth, tick(ms) { clock += ms; } };
}

test("normalization preserves accent, punctuation, gender and two-digit year matching", () => {
  assert.equal(store.identity(person("JÖRG Straßé", { birthYear: 2005 })), store.identity(person("jorg strasse")));
  assert.equal(store.identity(person("Ame\u0301lie D'Ávila")), "ameliedavila|5|female");
  assert.notEqual(store.identity(person("Anna")), store.identity(person("Anna", { gender: "male" })));
});

test("200 existing participants are read once; searches, imports, edits and deletes never scan the roster again", async () => {
  const records = { "timerEvents/e": event(), "timerParticipantDirectory/new": { name: "Neue Person", birthYear: 2007, gender: "w", organization: "Baden", searchName: "neueperson" } };
  for (let i = 0; i < 200; i++) {
    const row = person(`Person ${i}`);
    records[`timerEvents/e/participants/p${i}`] = row;
    records[`timerEvents/e/participantIdentities/${store.identity(row)}`] = { participantIds: [`p${i}`], changedParticipantId: `p${i}` };
  }
  const h = await adapter(records);
  assert.equal((await h.api.request("/events/e?prepareImport=1")).participants.length, 200);
  for (let i = 0; i < 10; i++) await h.api.request(`/events/e/participants/import?q=person${i}`);
  await h.api.request("/events/e/participants/import?q=neue");
  await h.api.request("/events/e/participants/import?q=neue");
  assert.equal(h.reads.get("timerParticipantDirectory"), 12, "ten searches, one existence query, one cached search");
  const saved = await h.api.request("/events/e/participants/import", { method: "POST", body: { candidateId: "new" } });
  assert.equal(saved.participant.name, "Neue Person");
  assert.equal((await h.api.request("/events/e")).participants.length, 201);
  await assert.rejects(h.api.request("/events/e/participants/import", { method: "POST", body: { candidateId: "new" } }), { status: 409 });
  const edited = await h.api.request(`/events/e/participants/${saved.id}`, { method: "PATCH", body: person("Neuer Name", { birthYear: 7 }) });
  assert.equal(edited.participant.name, "Neuer Name");
  await h.api.request(`/events/e/participants/${saved.id}`, { method: "DELETE" });
  assert.equal((await h.api.request("/events/e")).participants.length, 200);
  assert.equal(h.reads.get("timerEvents/e/participants"), 1);
  h.api.clearParticipantCache();
  await h.api.request("/events/e");
  assert.equal(h.reads.get("timerEvents/e/participants"), 2, "explicit refresh gets other devices' changes");
});

test("the search cache expires and is cleared with the participant view", async () => {
  const h = await adapter({ "timerEvents/e": event(), "timerParticipantDirectory/p": { name: "Anna", searchName: "anna", birthYear: 2005, gender: "w" } });
  const search = () => h.api.request("/events/e/participants/import?q=anna");
  await Promise.all([search(), search()]);
  assert.equal(h.reads.get("timerParticipantDirectory"), 1);
  h.tick(30_001);
  await search();
  assert.equal(h.reads.get("timerParticipantDirectory"), 2);
  h.api.clearParticipantCache();
  await search();
  assert.equal(h.reads.get("timerParticipantDirectory"), 3);
});

test("encoded document IDs resolve correctly and encoded path separators are rejected", async () => {
  const id = 'event"?with-special-characters';
  const h = await adapter({ [`timerEvents/${id}`]: event() });
  assert.equal((await h.api.request(`/events/${encodeURIComponent(id)}`)).event.id, id);
  for (const path of ["/events/e%2Fother", "/events/e%5Cother", "/events/%00", "/events/%ZZ"]) {
    await assert.rejects(h.api.request(path), { status: 400 });
  }
});

test("100 individual imports keep the number of full participant queries constant", async () => {
  const records = { "timerEvents/e": event() };
  for (let i = 0; i < 100; i++) records[`timerParticipantDirectory/p${i}`] = {
    name: `Import Person ${i}`, birthYear: 2005, gender: "w", organization: "Baden", searchName: `importperson${i}`,
  };
  const h = await adapter(records);
  await h.api.request("/events/e?prepareImport=1");
  for (let i = 0; i < 100; i++) await h.api.request("/events/e/participants/import", { method: "POST", body: { candidateId: `p${i}` } });
  assert.equal((await h.api.request("/events/e")).participants.length, 100);
  assert.equal(h.reads.get("timerEvents/e/participants"), 1);
  const individualChecks = [...h.reads].filter(([key]) => /^timerEvents\/e\/(participants|participantIdentities)\//.test(key))
    .reduce((sum, [, count]) => sum + count, 0);
  assert.equal(individualChecks, 200, "one target and one identity read per successful transaction; rule reads are additional");
});

test("legacy manual participants and pre-existing duplicates migrate without changing participant IDs", async () => {
  const row = person("Anna Müller");
  const h = memoryDb({ "timerEvents/e": event({ participantIndexVersion: 0 }), "timerEvents/e/participants/a": row, "timerEvents/e/participants/b": row });
  const eventRef = h.db.collection("timerEvents").doc("e");
  const roster = await eventRef.collection("participants").get();
  await store.migrate(h.db, eventRef, roster, sdk);
  assert.equal(h.data.get(eventRef.path).participantIndexVersion, 1);
  assert.deepEqual(h.data.get(`${eventRef.path}/participantIdentities/${store.identity(row)}`).participantIds, ["a", "b"]);
  await assert.rejects(store.commit(h.db, eventRef, "c", row, sdk, undefined, true), { status: 409 });
  await store.commit(h.db, eventRef, "a", null, sdk);
  await assert.rejects(store.commit(h.db, eventRef, "c", row, sdk, undefined, true), { status: 409 });
  await store.commit(h.db, eventRef, "b", null, sdk);
  await store.commit(h.db, eventRef, "c", row, sdk, undefined, true);
  assert.ok(h.data.has(`${eventRef.path}/participants/c`));
});

test("two imports of the same identity admit one participant; different identities succeed", async () => {
  const h = memoryDb({ "timerEvents/e": event() });
  const ref = h.db.collection("timerEvents").doc("e");
  const outcomes = await Promise.allSettled(["a", "b"].map((id) => store.commit(h.db, ref, id, person("Anna"), sdk, undefined, true)));
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((outcome) => outcome.status === "rejected").reason.status, 409);
  await store.commit(h.db, ref, "c", person("Bea"), sdk, undefined, true);
  await assert.rejects(store.commit(h.db, ref, "c", person("Anna"), sdk), { status: 409 });
  assert.equal(h.data.get(`${ref.path}/participants/c`).name, "Bea");
});

module.exports = { memoryDb, person, event, sdk };

test("event and result pages retain legacy documents, stay bounded and traverse every ID", async () => {
  const records = { "timerEvents/e": event({ resultsAccess: "everyone" }) };
  for (let i = 122; i >= 0; i--) {
    const id = String(i).padStart(3, "0");
    records[`timerEvents/event-${id}`] = event();
    records[`timerEvents/e/results/${id}`] = {
      discipline: "normal", participant: { name: `Person ${id}`, gender: "male" },
      segments: [123 - i], totalCentiseconds: 123 - i,
    };
  }
  const h = await adapter(records);
  for (const [url, key, expected] of [["/events", "events", 124], ["/events/e/results", "results", 123]]) {
    const found = new Set();
    let cursor = null, requests = 0;
    do {
      const page = await h.api.request(url + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""));
      requests++;
      assert.ok(page[key].length <= 50);
      for (const row of page[key]) {
        assert.equal(found.has(row.id), false);
        found.add(row.id);
      }
      if (key === "results" && page.results.length) {
        assert.equal(page.nextCursor, requests === 1 ? "049" : requests === 2 ? "099" : "122", "cursor follows document order rather than displayed time order");
        assert.ok(page.results[0].total_centiseconds <= page.results.at(-1).total_centiseconds);
      }
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    } while (requests < 10);
    assert.equal(found.size, expected);
    assert.equal(requests, 3);
  }
  assert.ok(h.queries.every((query) => query.limit === 50));
  await assert.rejects(h.api.request("/events?cursor=bad%2Fid"), { status: 400 });
});

test("result view avoids the participant scan until editing, and event deletion removes every result page", async () => {
  const records = { "timerEvents/e": event({ resultsAccess: "everyone" }), "timerEvents/e/participants/p": person("Anna") };
  for (let i = 0; i < 101; i++) records[`timerEvents/e/results/${String(i).padStart(3, "0")}`] = {};
  const h = await adapter(records);
  const view = await h.api.request("/events/e?participants=0");
  assert.equal(view.participants.length, 0);
  assert.equal(h.reads.has("timerEvents/e/participants"), false);
  assert.equal((await h.api.request("/events/e")).participants.length, 1);
  assert.equal(h.reads.get("timerEvents/e/participants"), 1);
  await h.api.request("/events/e", { method: "DELETE" });
  assert.equal([...h.data.keys()].some((key) => key.startsWith("timerEvents/e")), false);
  assert.equal(h.queries.filter((query) => query.path.endsWith("/results")).length, 3);
  assert.ok(h.queries.filter((query) => query.path.endsWith("/results")).every((query) => query.limit === 50));
});
