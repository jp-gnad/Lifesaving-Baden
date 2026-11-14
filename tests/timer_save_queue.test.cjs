const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../timer/save-queue.js");
const { create: cache } = require("../timer/event-cache.js");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(setImmediate);

function fixture(initial = []) {
  const records = new Map(initial.map((record) => [record.clientSubmissionId, record]));
  const requests = [], failures = [];
  let account = "a", connected = true, sequence = 0, upload = async () => ({ ok: true });
  let commit = async (record) => { records.set(record.clientSubmissionId, structuredClone(record)); };
  const store = {
    getPendingResults: async () => [...records.values()].map((record) => structuredClone(record)),
    putPendingResult: (record) => commit(record),
    deletePendingResult: async (id) => records.delete(id),
  };
  const options = { store, getAccountId: async () => account, online: () => connected,
    newId: () => `submission-${++sequence}`,
    request: async (path, options) => { requests.push({ path, options }); return upload(path, options); },
    failed: (record, error) => failures.push({ record, error }),
  };
  const queue = create(options);
  return { queue, options, requests, records, failures,
    online(value) { connected = value; }, account(value) { account = value; },
    upload(fn) { upload = fn; }, commit(fn) { commit = fn; },
  };
}

test("saving waits for the local commit, returns while the server is still waiting, and allows the next save", async () => {
  const h = fixture(), local = deferred(), server = deferred();
  h.commit(async (record) => { await local.promise; h.records.set(record.clientSubmissionId, structuredClone(record)); });
  h.upload(() => server.promise);
  let saved = false;
  const first = h.queue.enqueue("e", { segments: [100] }).then((value) => { saved = true; return value; });
  await tick();
  assert.equal(saved, false);
  assert.equal(h.requests.length, 0);
  local.resolve();
  const firstResult = await first;
  assert.equal(saved, true);
  await tick();
  assert.equal(h.requests.length, 1);
  const second = await h.queue.enqueue("e", { segments: [200] });
  assert.equal(h.records.size, 2, "the next result is safe while the first server request hangs");
  server.resolve({ id: firstResult.clientSubmissionId });
  await h.queue.sync();
  await second.completion;
  assert.equal(h.requests.length, 2, "results appended during a running sync are drained too");
  assert.equal(h.records.size, 0);
  assert.equal(h.requests[0].options.background, true);
});

test("offline results survive restart and reuse their submission IDs", async () => {
  const h = fixture(); h.online(false);
  const saved = await h.queue.enqueue("e", { segments: [123] });
  await tick();
  assert.equal(h.requests.length, 0);
  h.online(true);
  await create(h.options).sync();
  assert.equal(JSON.parse(h.requests[0].options.body).clientSubmissionId, saved.clientSubmissionId);
  assert.equal(h.records.size, 0);
});

test("a rejected local commit never reports a save or uploads it", async () => {
  const h = fixture(); h.commit(async () => { throw new Error("Quota"); });
  await assert.rejects(h.queue.enqueue("e", { segments: [100] }), /Quota/);
  assert.equal(h.requests.length, 0);
  assert.equal(h.records.size, 0);
});

test("network failures retain queued data and retry with the same ID", async () => {
  const h = fixture();
  h.upload(async () => { throw Object.assign(new Error("offline"), { status: 503 }); });
  const saved = await h.queue.enqueue("e", { segments: [100] });
  await h.queue.sync();
  assert.equal(h.records.get(saved.clientSubmissionId).blocked, false);
  assert.equal(h.records.get(saved.clientSubmissionId).attempts, 1);
  h.upload(async () => ({ ok: true }));
  await h.queue.sync();
  assert.equal(h.records.size, 0);
  assert.equal(JSON.parse(h.requests[0].options.body).clientSubmissionId, JSON.parse(h.requests[1].options.body).clientSubmissionId);
});

test("permanent errors preserve data, stop dependent writes and allow other events to sync", async () => {
  const h = fixture(); h.online(false);
  const first = await h.queue.enqueue("e", { segments: [100] });
  await h.queue.enqueue("e", { segments: [200] }, { path: `/events/e/results/${first.clientSubmissionId}`, method: "PATCH" });
  await h.queue.enqueue("other", { segments: [300] });
  h.online(true);
  h.upload(async (path) => { if (path.includes("/e/")) throw Object.assign(new Error("permission"), { status: 403 }); return {}; });
  await h.queue.sync();
  assert.equal(h.records.size, 2);
  assert.equal(h.records.get(first.clientSubmissionId).blocked, true);
  assert.equal(h.failures.length, 1);
  h.upload(async () => ({}));
  await h.queue.sync({ includeBlocked: true });
  assert.equal(h.records.size, 0);
});

test("account changes neither replay another account's writes nor publish its late completion", async () => {
  const h = fixture(), server = deferred(); h.upload(() => server.promise);
  const saved = await h.queue.enqueue("e", { segments: [100] });
  await tick();
  let completed = false; saved.completion.then(() => { completed = true; });
  h.account("b"); server.resolve({}); await h.queue.sync();
  assert.equal(completed, false);
  assert.equal(h.records.size, 1);
  assert.deepEqual(await h.queue.list(), []);
  await h.queue.sync();
  assert.equal(h.requests.length, 1);
  h.account("a"); await h.queue.sync();
  assert.equal(h.records.size, 0);
});

test("corrected settings supersede rejected settings and can unblock pending results", async () => {
  const h = fixture();
  h.upload(async () => { throw Object.assign(new Error("permission"), { status: 403 }); });
  await h.queue.enqueue("e", { segments: [100] }); await h.queue.sync();
  await h.queue.enqueue("e", { name: "older", timerAccess: "locked" }, { path: "/events/e", method: "PATCH" });
  await h.queue.sync();
  let enabled = false;
  h.upload(async (path, options) => {
    if (options.method === "PATCH") { assert.equal(JSON.parse(options.body).name, "latest"); enabled = true; return {}; }
    if (!enabled) throw Object.assign(new Error("permission"), { status: 403 });
    return {};
  });
  await h.queue.enqueue("e", { name: "latest", timerAccess: "everyone" }, { path: "/events/e", method: "PATCH" });
  await h.queue.sync();
  assert.equal(enabled, true);
  await h.queue.sync({ includeBlocked: true });
  assert.equal(h.records.size, 0);
});

test("a rejected participant creation only blocks results assigned to that participant", async () => {
  const h = fixture(); h.online(false);
  const person = await h.queue.enqueue("e", { name: "Duplicate" }, { path: "/events/e/participants", method: "POST" });
  await h.queue.enqueue("e", { participantId: person.clientSubmissionId, segments: [100] });
  await h.queue.enqueue("e", { participantId: "existing-person", segments: [200] });
  h.upload(async (path) => {
    if (path.endsWith("/participants")) throw Object.assign(new Error("duplicate"), { status: 409 });
    return {};
  });
  h.online(true); await h.queue.sync();
  assert.equal(h.records.size, 2);
  assert.equal(h.requests.length, 2);
  assert.equal(JSON.parse(h.requests[1].options.body).participantId, "existing-person");
});

test("the Event home renders cached metadata without fetching a participant list", async () => {
  const fs = require("node:fs"), vm = require("node:vm");
  let reads = 0;
  const events = cache({ load: () => { reads++; return new Promise(() => {}); } });
  events.remember({ id: "e", name: "Test", can_use_timer: true, can_view_results: true, can_view_participants: true });
  const app = { innerHTML: "" };
  const context = vm.createContext({ ...require("../timer/core.js"), app, routeVersion: 1, eventCache: events,
    setDocumentTitle() {}, eventIconMarkup: () => "", icon: () => "",
    document: { querySelector: () => ({ addEventListener() {} }) },
    api() { throw new Error("No roster read belongs in Event home navigation"); },
  });
  const source = fs.readFileSync(require.resolve("../timer/app.js"), "utf8");
  vm.runInContext(source.slice(source.indexOf("async function renderEvent(id)"), source.indexOf("async function renderEventSettings(")), context);
  await context.renderEvent("e");
  assert.match(app.innerHTML, /href="#\/timer\/e"/);
  assert.match(app.innerHTML, /href="#\/people\/e"/);
  assert.equal(reads, 0);
});

test("legacy records are retained, edits keep their commands, and replayed deletes accept already absent rows", async () => {
  const h = fixture([{ clientSubmissionId: "legacy-result", eventId: "e", payload: { clientSubmissionId: "legacy-result", segments: [100] }, createdAt: "2020-01-01" }]);
  h.online(false);
  const patch = await h.queue.enqueue("e", { note: "neu" }, { path: "/events/e/results/r", method: "PATCH" });
  await h.queue.enqueue("e", {}, { path: "/events/e/results/r", method: "DELETE" });
  h.upload(async (path, options) => { if (options.method === "DELETE") throw Object.assign(new Error("absent"), { status: 404 }); return {}; });
  h.online(true); await h.queue.sync();
  assert.deepEqual(h.requests.map((request) => request.options.method), ["POST", "PATCH", "DELETE"]);
  assert.equal(JSON.parse(h.requests[1].options.body).clientMutationId, patch.clientSubmissionId);
  assert.equal(h.records.size, 0);
});

test("event metadata renders from memory while stale metadata refreshes in the background", async () => {
  let now = 0, reads = 0;
  const server = deferred();
  const events = cache({ now: () => now, maxAge: 100, load: () => { reads++; return server.promise; } });
  events.remember({ id: "e", name: "bekannt" });
  now = 200;
  assert.equal((await events.read("e")).name, "bekannt");
  assert.equal((await events.read("e")).name, "bekannt");
  assert.equal(reads, 1, "one refresh is shared without delaying navigation");
  server.resolve({ id: "e", name: "aktuell" }); await tick();
  assert.equal((await events.read("e")).name, "aktuell");
});

test("event caches are bounded, clear on session changes and ignore late old-account reads", async () => {
  const server = deferred(); let reads = 0;
  const events = cache({ limit: 2, load: () => { reads++; return server.promise; } });
  events.remember({ id: "a" }); events.remember({ id: "b" }); events.remember({ id: "c" });
  const pending = events.read("a"); await tick();
  assert.equal(reads, 1);
  events.clear(); events.remember({ id: "a", name: "new account" });
  server.resolve({ id: "a", name: "old account" }); await pending;
  assert.equal((await events.read("a")).name, "new account");
});
