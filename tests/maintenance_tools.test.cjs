const test = require("node:test");
const assert = require("node:assert/strict");

test("maintenance credentials reject other projects and never echo malformed secret JSON", async () => {
  const { readServiceAccount } = await import("../tools/lib/firebase-project.mjs");
  assert.throws(() => readServiceAccount({}), /missing/);
  assert.throws(() => readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"other"}' }), /Unexpected Firebase project/);
  const secret = "SYNTHETIC-PRIVATE-KEY";
  assert.throws(() => readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: secret }), (error) => !error.message.includes(secret));
  assert.equal(readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"lifesaving-baden"}' }).project_id, "lifesaving-baden");
});

test("directory sync validates its entire input before planning changes and writes only changed documents", async () => {
  const { participantRecords, collectionChanges, clubRecords, writeChanges } = await import("../tools/lib/participant-directory.mjs");
  const record = { id: "1234567890abcdef", name: "Anna Baden", birthYear: 2005, gender: "w", organization: "Baden", searchName: "annabaden" };
  const records = participantRecords([record]);
  const data = records.get(record.id);
  assert.throws(() => participantRecords([]), /nonempty/);
  assert.throws(() => participantRecords([record, record]), /Duplicate/);
  assert.throws(() => participantRecords([record, { ...record, id: "bad/id" }]), /Invalid/);
  assert.deepEqual(collectionChanges(records, [{ id: record.id, data: () => data }]), []);
  assert.equal(collectionChanges(records, [{ id: record.id, data: () => ({ ...data, organization: "Alt" }) }]).length, 1);
  assert.deepEqual(collectionChanges(records, [{ id: "obsolete", data: () => data }]).map((entry) => entry.id), [record.id, "obsolete"]);
  assert.equal([...clubRecords(records).values()][0].name, "Baden");
  let batches = 0;
  const operations = [];
  const db = { batch() { batches++; return { set: (ref, data) => operations.push([ref, data]), delete: (ref) => operations.push([ref, null]), commit: async () => {} }; } };
  await writeChanges(db, { doc: (id) => id }, []);
  assert.equal(batches, 0);
  await writeChanges(db, { doc: (id) => id }, [{ id: record.id, data }, { id: "obsolete", data: null }]);
  assert.equal(batches, 1);
  assert.equal(operations.length, 2);
});
