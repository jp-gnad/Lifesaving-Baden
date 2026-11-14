const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../timer/participant-updates.js");
const { create: queue } = require("../timer/save-queue.js");
const fs = require("node:fs"), vm = require("node:vm");
const tick = () => new Promise(setImmediate);
const record = (overrides = {}) => ({ accountId: "u", eventId: "e", clientSubmissionId: "person", createdAt: "2026-11-14T00:00:00Z",
  operation: { path: "/events/e/participants", method: "POST" }, payload: { name: "Neue Person", birthYear: 2005, ageGroup: "Offen", gender: "female", organization: "Baden" }, ...overrides });

test("local participant changes survive queue completion and stale lists, with canonical import data and no duplicates", () => {
  const updates = create({ getAccountId: () => "u" });
  const change = record(); updates.remember(change);
  assert.equal(updates.apply("e", [])[0].name, "Neue Person");
  const canonical = { id: "person", name: "Neue Person", age_group: "AK 20", birth_year: 5, gender: "female", organization: "Baden" };
  updates.remember(change, { participant: canonical });
  assert.equal(updates.apply("e", [], [change])[0].age_group, "AK 20");
  assert.equal(updates.apply("e", [canonical]).length, 1);
  assert.deepEqual(updates.apply("other", []), []);
  const imported = record({ clientSubmissionId: "import", operation: { path: "/events/e/participants/import", method: "POST" }, payload: { previewParticipant: change.payload } });
  updates.remember(imported);
  assert.equal(updates.apply("e", []).length, 2);
});

test("newer local edits and deletions win over older pending records and confirmations", () => {
  const updates = create({ getAccountId: () => "u" });
  const old = record(); updates.remember(old);
  const edit = record({ createdAt: "2026-11-14T00:01:00Z", operation: { path: "/events/e/participants/person", method: "PATCH" }, payload: { ...old.payload, name: "Geändert" } });
  updates.remember(edit);
  updates.remember(old, { participant: { id: "person", name: "Alt" } });
  assert.equal(updates.apply("e", [], [old])[0].name, "Geändert");
  updates.remember(record({ createdAt: "2026-11-14T00:02:00Z", operation: { path: "/events/e/participants/person", method: "DELETE" }, payload: {} }));
  assert.deepEqual(updates.apply("e", [{ id: "person", name: "Alt" }], [edit]), []);
});

test("participant changes are account scoped and role invalidation clears the session journal", () => {
  let account = "u";
  const updates = create({ getAccountId: () => account });
  updates.remember(record());
  account = "other";
  assert.deepEqual(updates.apply("e", []), []);
  updates.remember(record(), { participant: { id: "person", name: "Verspätet" } });
  assert.deepEqual(updates.apply("e", []), []);
  updates.remember(record({ accountId: "other" }));
  assert.equal(updates.apply("e", []).length, 1);
  updates.clear(); assert.deepEqual(updates.apply("e", []), []);
});

test("People background creation reaches the timer projection after a fast upload removes the queue entry", async () => {
  const updates = create({ getAccountId: () => "u" });
  const records = new Map();
  const saveQueue = queue({
    store: { async putPendingResult(value) { records.set(value.clientSubmissionId, value); }, async getPendingResults() { return [...records.values()]; }, async deletePendingResult(id) { records.delete(id); } },
    getAccountId: () => "u", online: () => true, newId: () => "person",
    request: async () => ({ participant: { id: "person", name: "Neue Person", age_group: "Offen", birth_year: 5, gender: "female", organization: "Baden" } }),
    completed: (change, response) => updates.remember(change, response),
  });
  const context = vm.createContext({ saveQueue, participantUpdates: updates });
  const source = fs.readFileSync(require.resolve("../timer/app.js"), "utf8");
  vm.runInContext(source.slice(source.indexOf("async function saveInBackground("), source.indexOf("function bindDialogClose(")), context);
  await context.saveInBackground("e", "/events/e/participants", "POST", record().payload);
  await saveQueue.sync(); await tick();
  assert.equal(records.size, 0);
  assert.equal(updates.apply("e", [])[0].name, "Neue Person");
});
