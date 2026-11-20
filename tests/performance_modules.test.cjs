const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const pages = require("../assets/js/collection-pages.js");
const profiles = require("../assets/js/club-profile-feed.js");
const roster = require("../assets/js/club-roster-state.js");
const worktime = require("../assets/js/worktime-store.js");
const pdf = require("../timer/results-pdf.js");
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(setImmediate);

function pageFixture(count = 123) {
  const docs = Array.from({ length: count }, (_, i) => ({ id: String(i).padStart(3, "0"), exists: true, data: () => ({ i }) }));
  const calls = [];
  let respond = (rows) => Promise.resolve({ docs: rows });
  function query(max = Infinity, cursor = null) { return {
    orderBy: () => query(max, cursor), limit: (size) => query(size, cursor), startAfter: (value) => query(max, value),
    get() { calls.push({ max, cursor }); return respond(docs.filter((doc) => !cursor || doc.id > cursor.id).slice(0, max)); },
  }; }
  return { docs, calls, collection: query(), respond(value) { respond = value; } };
}

test("cursor pages share in-flight reads and traverse all 123 records only on explicit request", async () => {
  const h = pageFixture(), gate = deferred();
  h.respond(() => gate.promise);
  const pager = pages.create({ collection: h.collection });
  const first = pager.next();
  assert.equal(pager.next(), first);
  assert.equal(h.calls.length, 1);
  gate.resolve({ docs: h.docs.slice(0, 50) }); await first;
  assert.equal(pager.docs.length, 50);
  assert.equal(pager.hasMore, true);
  h.respond((docs) => Promise.resolve({ docs }));
  await pager.all();
  assert.equal(pager.docs.length, 123);
  assert.deepEqual(h.calls.map((call) => call.max), [50, 50, 50]);
  assert.deepEqual(h.calls.map((call) => call.cursor?.id || null), [null, "049", "099"]);
  await pager.next(); assert.equal(h.calls.length, 3);
});

test("a failed page retains its cursor and a reset rejects stale results without polluting the new list", async () => {
  const h = pageFixture(), pager = pages.create({ collection: h.collection });
  await pager.next();
  h.respond(() => Promise.reject(new Error("offline")));
  await assert.rejects(pager.next(), /offline/);
  assert.equal(pager.docs.length, 50);
  h.respond((docs) => Promise.resolve({ docs }));
  await pager.next(); assert.equal(pager.docs.length, 100);
  const gate = deferred(); h.respond(() => gate.promise);
  const old = pager.next(); pager.reset();
  gate.resolve({ docs: h.docs.slice(100) }); await old;
  assert.equal(pager.docs.length, 0);
  assert.equal(pager.hasMore, true);
});

test("search reuse shares requests, expires, retries failures and checks the current session", async () => {
  let now = 0, current = true, calls = 0;
  const cache = pages.searchCache({ now: () => now, check() { if (!current) throw new Error("account changed"); } });
  const load = async () => ++calls;
  assert.equal(await cache.read("anna", load), 1);
  assert.equal(await cache.read("anna", load), 1);
  now = 30_001; assert.equal(await cache.read("anna", load), 2);
  await assert.rejects(cache.read("ben", async () => { throw new Error("offline"); }));
  assert.equal(await cache.read("ben", load), 3);
  current = false; assert.throws(() => cache.read("anna", load), /account changed/);
});

function profileFixture(isAdmin) {
  const listeners = [], queries = [];
  let current = true, renders = 0;
  const listen = (ids, grouped) => ({ onSnapshot(options, receive) {
    const entry = { ids, grouped, receive, stopped: false }; listeners.push(entry);
    return () => { entry.stopped = true; };
  } });
  const collection = { doc: (id) => listen([id], false), where(field, op, ids) {
    queries.push({ field, op, ids }); return { limit(size) { assert.equal(size, 10); return listen(ids, true); } };
  } };
  const feed = profiles.create({ db: { collection: () => collection }, isAdmin,
    isCurrent: () => current, onChange: () => { renders++; }, onError(error) { throw error; } });
  function emit(listener, name = "Anna", fromCache = false) {
    const docs = listener.ids.map((id) => ({ id, exists: true, data: () => ({ name, role: "trainer" }) }));
    listener.receive(listener.grouped ? { docs, metadata: { fromCache } } : { ...docs[0], metadata: { fromCache } });
  }
  return { feed, listeners, queries, emit, renders: () => renders, leave() { current = false; } };
}

test("admin profiles are grouped in bounded queries and initial snapshots produce only one render", async () => {
  const h = profileFixture(true), ids = Array.from({ length: 21 }, (_, i) => `u${i}`);
  h.feed.sync(ids);
  assert.equal(h.queries.length, 3);
  assert.equal(h.queries.every((query) => query.ids.length <= 10), true);
  h.listeners.forEach((listener) => h.emit(listener)); await tick();
  assert.equal(h.renders(), 1);
  assert.equal(h.feed.values.size, 21);
  h.feed.sync([...ids].reverse()); assert.equal(h.queries.length, 3);
  h.listeners.forEach((listener) => h.emit(listener)); await tick();
  assert.equal(h.renders(), 1, "identical metadata/values must not rebuild the roster");
  h.feed.clear(); h.listeners.forEach((listener) => h.emit(listener, "late")); await tick();
  assert.equal(h.feed.values.size, 0);
  assert.equal(h.renders(), 1);
  assert.equal(h.listeners.every((listener) => listener.stopped), true);
});

test("trainers retain document-only reads and late responses cannot update another account", async () => {
  const h = profileFixture(false);
  h.feed.sync(["a", "b"]);
  assert.equal(h.queries.length, 0);
  h.listeners.forEach((listener) => h.emit(listener)); await tick();
  assert.equal(h.renders(), 1);
  h.leave(); h.emit(h.listeners[0], "late"); await tick();
  assert.equal(h.feed.values.get("a").name, "Anna");
});

test("optimistic changes survive stale snapshots, confirm against matching server data and roll back failures", () => {
  const state = roster.create(), original = new Map([["p", { id: "p", name: "Anna", activeYears: [] }]]);
  const token = state.begin("p", { activeYears: [2026] });
  assert.deepEqual(state.project(original).get("p").activeYears, [2026]);
  assert.throws(() => state.begin("p", null), /noch gespeichert/);
  state.confirm(token); state.receive(original);
  assert.equal(state.has("p"), true);
  const confirmed = new Map([["p", { id: "p", name: "Anna", activeYears: [2026] }]]);
  state.receive(confirmed); assert.equal(state.has("p"), false);
  const removal = state.begin("p", null);
  assert.equal(state.project(confirmed).has("p"), false);
  state.rollback(removal); assert.equal(state.project(confirmed).has("p"), true);
  const importToken = state.begin("draft", { name: "New" }, true);
  state.confirm(importToken, "account_actual"); state.receive(new Map());
  assert.equal(state.project(new Map()).has("account_actual"), true);
  state.receive(new Map([["account_actual", { name: "Actual" }]]));
  assert.equal(state.has("account_actual"), false);
  const abandoned = state.begin("p", null); state.clear(); state.confirm(abandoned);
  assert.equal(state.project(original).has("p"), true);
});

function worktimeFixture() {
  const records = new Map(), reads = [];
  let failure = null;
  const snapshot = (path) => ({ id: path.split("/").pop(), exists: records.has(path), data: () => records.get(path) });
  function collection(path) { return { doc: (id) => ({ path: `${path}/${id}`, collection: (name) => collection(`${path}/${id}/${name}`), get: async () => snapshot(`${path}/${id}`) }),
    get: async () => { reads.push(path); return { docs: [...records.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1).map(snapshot) }; } };
  }
  const db = { collection, async runTransaction(action) {
    const writes = [];
    await action({ get: async (ref) => snapshot(ref.path), set: (ref, value) => writes.push(() => records.set(ref.path, value)), delete: (ref) => writes.push(() => records.delete(ref.path)) });
    if (failure) { const error = failure; failure = null; throw error; }
    writes.forEach((write) => write());
  } };
  const sdk = { FieldValue: { serverTimestamp: () => new Date() }, Timestamp: { fromDate: (date) => date } };
  const record = (start = 10, end = 11) => ({ startedAt: new Date(`2026-11-01T${start}:00:00Z`), endedAt: new Date(`2026-11-01T${end}:00:00Z`), endDay: new Date("2026-11-01") });
  return { db, sdk, records, reads, record, fail() { failure = new Error("offline"); } };
}

test("worktime reconciles legacy entries once per session while later saves still reject reserved overlaps", async () => {
  const h = worktimeFixture();
  const save = (id, record) => worktime.commit(h.db, "u", id, record, h.sdk);
  await save("a", h.record());
  await save("b", h.record(11, 12));
  await assert.rejects(save("overlap", h.record()), { code: "worktime/overlap" });
  assert.equal(h.reads.length, 1);
  assert.equal(h.records.has("users/u/worktimeEntries/overlap"), false);
  worktime.clearSession(h.db, "u");
  await save("c", h.record(12, 13)); assert.equal(h.reads.length, 2);
});

test("a failed worktime initialization is retryable and simultaneous first saves cannot bypass reservations", async () => {
  const h = worktimeFixture(); h.fail();
  await assert.rejects(worktime.commit(h.db, "u", "failed", h.record(), h.sdk), /offline/);
  const outcomes = await Promise.allSettled(["a", "b"].map((id) => worktime.commit(h.db, "u", id, h.record(), h.sdk)));
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(h.reads.length, 2, "only a failed initialization should trigger another history read");
});

test("a hanging optional PDF image is aborted and a later export may retry", async () => {
  let calls = 0, aborts = 0;
  const exporter = pdf.create({ eventIconUrls: () => ["https://example.test/picture"], timeoutMs: 15,
    fetchImage(url, options) { calls++; return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => { aborts++; reject(new Error("aborted")); })); } });
  const pending = exporter.loadEventPdfImage({});
  assert.equal(exporter.loadEventPdfImage({}), pending);
  assert.equal(await pending, null);
  assert.equal(calls, 1); assert.equal(aborts, 1);
  assert.equal(await exporter.loadEventPdfImage({}), null);
  assert.equal(calls, 2);
});

test("lazy modules share their script load, preserve repository subpaths and retry after failure", async () => {
  const scripts = [], window = {};
  const context = { window, URL, setTimeout, clearTimeout,
    document: { currentScript: { src: "https://example.test/repo/timer/lazy-assets.js?v=test" }, head: { append(script) { scripts.push(script); } }, createElement: () => ({ remove() {} }) } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../timer/lazy-assets.js"), "utf8"), context);
  const first = window.TimerLazyAssets.load("pdf");
  assert.equal(window.TimerLazyAssets.load("pdf"), first);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0].src, /^https:\/\/example.test\/repo\/timer\/results-pdf.js\?/);
  scripts[0].onerror(); await assert.rejects(first, /erneut versuchen/);
  const next = window.TimerLazyAssets.load("pdf"); assert.equal(scripts.length, 2);
  window.TimerResultsPdf = {}; scripts[1].onload(); await next;
  await window.TimerLazyAssets.load("pdf"); assert.equal(scripts.length, 2);
});
