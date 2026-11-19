const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../assets/js/club-events-core.js");
const { create } = require("../assets/js/club-events-queue.js");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function memory() {
  const values = new Map();
  return { get length() { return values.size; }, key: (index) => [...values.keys()][index],
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
const people = Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, personId: `p${index}`, name: `Person ${index}`, birthYear: 2012, gender: "w", rosterGender: "w", activeYears: [2026], createdAtMillis: 123 }));
const action = { type: "create", name: "Event", date: "2026-06-20", additions: people };
function harness(storage = memory(), send) {
  const owner = { uid: "one", active: true };
  const calls = [];
  let sequence = 0;
  const queue = create({ storage, isCurrent: (account) => account.active,
    makeId: () => `job-${++sequence}`, send: async (account, record, check) => { calls.push(record); return send?.(account, record, check); } });
  queue.start(owner);
  return { queue, owner, calls, storage };
}

test("all selected participants and a dependent team appear synchronously while the server is suspended", async () => {
  const held = deferred();
  const h = harness(undefined, () => held.promise);
  const start = h.queue.enqueue("club", "event", action, null);
  h.queue.enqueue("club", "event", { type: "mutate", command: { type: "team", id: "team", memberIds: ["p0", "p1", "p2", "p3"], expected: null } }, start);
  assert.equal(Object.keys(h.queue.project("club", "event", null).participants).length, 20);
  assert.equal(h.queue.project("club", "event", null).assignments.p0, "team");
  assert.equal(h.storage.length, 2, "Both actions must be durable before any server acknowledgement");
  await tick();
  assert.equal(h.calls.length, 1, "Dependent team writes wait for the participants in the background");
  h.owner.active = false;
  held.resolve(start);
  await h.queue.flush();
  assert.equal(h.storage.length, 2, "A session change must retain pending changes");
});

test("confirmed writes never disappear when an older listener response arrives", async () => {
  let server = null;
  const h = harness(undefined, async (_account, record) => server = core.replay(server, record.action));
  h.queue.enqueue("club", "event", action, null);
  await h.queue.flush();
  assert.equal(h.storage.length, 0);
  assert.equal(Object.keys(h.queue.project("club", "event", null).participants).length, 20);
  assert.equal(h.queue.project("club", "event", server).revision, server.revision);
});

test("reload restores every pending participant and account changes never expose another account's queue", async () => {
  const held = deferred();
  const h = harness(undefined, () => held.promise);
  h.queue.enqueue("club", "event", action, null);
  await tick();
  h.owner.active = false;
  held.resolve(null);
  await h.queue.flush();
  const next = harness(h.storage, () => new Promise(() => {}));
  assert.equal(Object.keys(next.queue.project("club", "event", null).participants).length, 20);
  next.queue.start({ uid: "other", active: true });
  assert.equal(next.queue.project("club", "event", null), null);
  assert.equal(h.storage.length, 1);
});

test("failed events retain changes for retry without blocking unrelated events", async () => {
  let fail = true;
  const h = harness(undefined, async (_account, record) => {
    if (record.eventId === "bad" && fail) throw Object.assign(new Error("offline"), { code: "unavailable" });
    return core.replay(null, record.action);
  });
  h.queue.enqueue("club", "bad", action, null);
  h.queue.enqueue("club", "good", action, null);
  await h.queue.flush();
  assert.equal(h.queue.status("club", "bad").count, 1);
  assert.ok(h.queue.status("club", "bad").error);
  assert.equal(h.queue.status("club", "good").count, 0);
  fail = false;
  await h.queue.retry("club");
  assert.equal(h.storage.length, 0);
});

test("storage failures do not acknowledge a save or start a network request", async () => {
  const storage = memory();
  const h = harness(storage);
  storage.setItem = () => { throw new Error("quota"); };
  assert.throws(() => h.queue.enqueue("club", "event", action, null), /lokal gespeichert/);
  await h.queue.flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.queue.project("club", "event", null), null);
});

test("retry after a lost acknowledgement preserves later individual flags and deletion leaves no stale event", async () => {
  const base = core.replay(null, action);
  const state = core.change(base, { type: "team", id: "one", memberIds: ["p0", "p1", "p2", "p3"], expected: null });
  const later = core.change(state, { type: "individual", id: "p0", expected: true, enabled: false });
  assert.equal(core.replay(later, action).participants.p0.individual, false);
  let server = later;
  const h = harness(undefined, async (_account, record) => server = core.replay(server, record.action));
  h.queue.enqueue("club", "event", { type: "delete", expectedRevision: later.revision }, later);
  assert.equal(h.queue.project("club", "event", later), null);
  await h.queue.flush();
  assert.equal(h.queue.project("club", "event", later), null);
});

test("unchanged selections create no pending record and cannot be mistaken for a deletion", () => {
  const held = harness();
  const base = core.replay(null, action);
  const result = held.queue.enqueue("club", "event", { type: "participants", additions: [], removals: [] }, base);
  assert.equal(result, base);
  assert.equal(held.storage.length, 0);
  assert.equal(held.queue.project("club", "event", base).name, "Event");
});

test("focus recovery does not redraw unchanged controls and online retry covers other clubs", async () => {
  let redraws = 0;
  const storage = memory();
  const owner = { uid: "user", active: true };
  let fail = true;
  let id = 0;
  const queue = create({ storage, makeId: () => String(++id), isCurrent: (value) => value.active,
    onChange: () => { redraws++; }, send: async (_owner, record) => {
      if (fail) throw Object.assign(new Error("offline"), { code: "unavailable" });
      return core.replay(null, record.action);
    } });
  queue.start(owner);
  await queue.resume();
  assert.equal(redraws, 0);
  queue.enqueue("first", "event", action, null);
  queue.enqueue("other", "event", action, null);
  await queue.flush();
  assert.equal(storage.length, 2);
  fail = false;
  await queue.retry();
  assert.equal(storage.length, 0);
});
