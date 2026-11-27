const { test } = require("node:test");
const assert = require("node:assert/strict");

function memoryStore() {
  const docs = new Map();
  const reads = [];
  let version = 0;
  return {
    docs, reads,
    collection: name => ({ doc: id => ({ path: name + "/" + id }) }),
    async getAll(...refs) {
      reads.push(refs.map(ref => ref.path));
      return refs.map(ref => {
        const saved = docs.get(ref.path);
        return { exists: Boolean(saved), updateTime: saved?.version, data: () => saved?.data };
      });
    },
    batch() {
      const requests = [];
      return {
        create: (ref, data) => requests.push({ ref, data }),
        update: (ref, data, condition) => requests.push({ ref, data, condition }),
        async commit() {
          for (const { ref, condition } of requests) {
            assert.equal(docs.get(ref.path)?.version, condition?.lastUpdateTime, "Versionskonflikt");
          }
          for (const { ref, data } of requests) {
            docs.set(ref.path, { data: structuredClone({ ...docs.get(ref.path)?.data, ...data }), version: ++version });
          }
        },
      };
    },
  };
}

const result = (n, points) => ({ collection: "statsResults", id: "R" + String(n).padStart(32, "0"),
  data: { disciplines: { D001: { points } } } });
const noop = async () => {};

test("a partial archive import resumes and repeated input costs zero writes", async () => {
  const { compareStatistics, applyStatistics } = await import("../tools/lib/statistics-store.mjs");
  const db = memoryStore();
  const records = Array.from({ length: 235 }, (_, i) => result(i, i));
  const preview = await compareStatistics(db, records);
  assert.deepEqual(db.reads.map(r => r.length), [200, 35]);
  assert.equal(db.docs.size, 0);
  await assert.rejects(applyStatistics(db, preview, () => { throw Error("unterbrochen"); }), /unterbrochen/);
  assert.equal(db.docs.size, 200);
  assert.equal(await applyStatistics(db, await compareStatistics(db, records), noop), 35);
  assert.equal(await applyStatistics(db, await compareStatistics(db, records), noop), 0);
  assert.equal(db.docs.size, 235);
});

test("preview binds updates to their version and a partial correction preserves other rows", async () => {
  const { compareStatistics, applyStatistics } = await import("../tools/lib/statistics-store.mjs");
  const db = memoryStore();
  const write = async rows => applyStatistics(db, await compareStatistics(db, rows), noop);
  const other = result(2, 2);
  await write([result(1, 1), other]);
  const stale = await compareStatistics(db, [result(1, 9)]);
  await write([result(1, 11)]);
  await assert.rejects(applyStatistics(db, stale, noop), /Versionskonflikt/);
  assert.equal(await write([result(1, 9)]), 1);
  assert.equal(await write([other]), 0);
  const org = { collection: "statsOrganizations", id: "C" + "a".repeat(32), data: { name: "Historisch" } };
  await write([org]);
  const record = db.docs.get(org.collection + "/" + org.id);
  record.data.successorId = "Nachfolger";
  record.data.active = false;
  assert.equal(await write([org]), 0);
  assert.equal(record.data.successorId, "Nachfolger");
  await assert.rejects(write([{ ...org, collection: "clubs" }]), /Ungültiges/);
  await assert.rejects(write([{ ...org, data: { name: "Andere Person oder Organisation" } }]), /Stammdaten/);
});
