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

test("unmarked results keep legacy compatibility and can clear a ranking marker", async () => {
  const { compareStatistics, applyStatistics } = await import("../tools/lib/statistics-store.mjs");
  const db = memoryStore();
  const legacy = result(1, 570);
  await applyStatistics(db, await compareStatistics(db, [legacy]), noop);
  const record = { ...legacy, data: { ...legacy.data, rankingStatus: null } };
  const write = async () => applyStatistics(db, await compareStatistics(db, [record]), noop);
  assert.equal(await write(), 0);
  record.data.rankingStatus = "AK";
  assert.equal(await write(), 1);
  record.data.rankingStatus = null;
  assert.equal(await write(), 1);
  assert.equal(await write(), 0);
});

test("partial corrections preserve the full competition phase count", async () => {
  const { compareStatistics, applyStatistics } = await import("../tools/lib/statistics-store.mjs");
  const db = memoryStore();
  const event = { collection: "statsCompetitions", id: "W" + "a".repeat(32), data: { name: "Wettkampf" } };
  const plan = () => compareStatistics(db, [event]);
  await applyStatistics(db, await plan(), noop);
  event.data.phaseCount = 3;
  assert.equal(await applyStatistics(db, await plan(), noop), 1);

  event.data = { ...event.data, phaseCount: 1, city: "Baden" };
  const correction = await plan();
  assert.equal(correction[0].data.phaseCount, 3);
  assert.deepEqual(correction[0].fields, ["city"]);
  assert.equal(await applyStatistics(db, correction, noop), 1);
  assert.equal(await applyStatistics(db, await plan(), noop), 0);
});

test("existing BV and LV codes expand once on their original documents", async () => {
  const { compareStatistics, applyStatistics } = await import("../tools/lib/statistics-store.mjs");
  const db = memoryStore();
  const bv = { collection: "statsOrganizations", id: "C" + "b".repeat(32),
    data: { type: "BV", name: "GER", parentId: null } };
  const lv = { collection: "statsOrganizations", id: "C" + "a".repeat(32),
    data: { type: "LV", name: "WÜ", parentId: bv.id } };
  const write = async () => applyStatistics(db, await compareStatistics(db, [bv, lv]), noop);
  await write();
  lv.data.name = "Württemberg";
  bv.data.name = "Deutschland";
  assert.equal(await write(), 2);
  assert.equal(await write(), 0);
  assert.equal(db.docs.size, 2);
  assert.equal(db.docs.get(`statsOrganizations/${lv.id}`).data.parentId, bv.id);
  lv.data.name = "Baden";
  await assert.rejects(write(), /Stammdaten/);
});

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
