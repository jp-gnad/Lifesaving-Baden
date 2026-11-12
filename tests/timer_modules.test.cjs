const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../timer/core.js");
const { create: offlineStore } = require("../timer/offline-store.js");
const { create: pdfExport } = require("../timer/results-pdf.js");

test("timer time parsing keeps compact mobile input, strict seconds and centisecond precision", () => {
  for (const [input, expected] of [["1:23,45", 8345], ["123.45", 8345], ["59,99", 5999], ["0:00,01", 1]]) {
    assert.equal(core.parseTime(input), expected);
    assert.equal(core.parseTime(core.formatTime(expected)), expected);
  }
  for (const input of ["1:60,00", "160,00", "12", "1:2,34", "-1,00", "<script>"]) assert.equal(core.parseTime(input), null);
  assert.equal(core.parseReviewTime("123,45"), 12345);
  assert.equal(core.formatReviewTime(12345), "123,45");
  assert.equal(core.formatCumulativeReviewTime(8345), core.formatTime(8345));
});

test("UI and adapter share immutable discipline definitions and preserve old lap-group results", () => {
  assert.equal(Object.keys(core.disciplines).length, 13);
  assert.equal(core.disciplines.mixedRelay4x50.mixed, true);
  assert.equal(core.disciplines.normal.flexible, true);
  assert.ok(Object.isFrozen(core.disciplines.superLifesaver200.lapLabels));
  assert.deepEqual(core.enabledDisciplinesForEvent({ enabled_disciplines_json: '["rescue50", "unknown"]' }), ["rescue50"]);
  assert.deepEqual(core.enabledDisciplinesForEvent({ enabled_disciplines_json: 'broken' }), Object.keys(core.disciplines));
  assert.deepEqual(core.resultLapGroups({ segments: [10, 20] }), [[1], [2]]);
  assert.deepEqual(core.resultLapGroups({ segments: [10], lap_groups: [[1, 2]] }), [[1, 2]]);
});

test("extracted PDF export preserves pages, escaped user text and byte-accurate object offsets", async () => {
  const pdf = pdfExport({ eventIconUrls: () => [] });
  const rows = Array.from({ length: 45 }, (_, index) => [`Müller (${index})`, "1:23,45"]);
  const blob = pdf.createResultsPdf("Test (Baden)", "Wettkampf", ["Name", "Zeit"], rows);
  assert.equal(blob.type, "application/pdf");
  const text = await blob.text();
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /\/Count 3\b/);
  assert.ok(text.includes("Test \\(Baden\\)"));
  assert.ok(text.includes("Mueller \\(0\\)"));
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(xref, xref + 4), "xref");
  const entries = text.slice(xref).split("\n");
  const count = Number(entries[1].split(" ")[1]);
  for (let id = 1; id < count; id++) {
    const offset = Number(entries[id + 2].slice(0, 10));
    assert.ok(text.slice(offset).startsWith(`${id} 0 obj\n`));
  }
  assert.equal(await pdf.loadEventPdfImage({}), null);
});

function emitter(initial = {}) {
  const handlers = new Map();
  return Object.assign(initial, {
    addEventListener(name, callback) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(callback); },
    emit(name) { for (const callback of handlers.get(name) || []) callback(); },
  });
}

function databaseHarness() {
  const opens = [];
  const transactions = [];
  const schemas = [];
  const database = emitter({
    objectStoreNames: { contains: () => false }, close() {},
    createObjectStore(name, options) { schemas.push({ name, options }); },
    transaction(name, mode) {
      const request = emitter({ result: { clientSubmissionId: "saved" } });
      const transaction = emitter({ request, name, mode, abort() { this.emit("abort"); },
        objectStore() { return { put: () => request, get: () => request, getAll: () => request, delete: () => request }; },
      });
      transactions.push(transaction);
      return transaction;
    },
  });
  const provider = { open(name, version) {
    const request = emitter({ result: database });
    opens.push({ name, version, request });
    queueMicrotask(() => { request.emit("upgradeneeded"); request.emit("success"); });
    return request;
  } };
  return { provider, opens, transactions, schemas };
}

test("offline writes resolve after transaction commit and retain the installed timer's storage names", async () => {
  const h = databaseHarness();
  const store = offlineStore(h.provider);
  let settled = false;
  const pending = store.putPendingResult({ clientSubmissionId: "saved" }).then((value) => { settled = true; return value; });
  await new Promise(setImmediate);
  const tx = h.transactions[0];
  tx.request.emit("success");
  await new Promise(setImmediate);
  assert.equal(settled, false, "a successful IDB request alone is not a committed transaction");
  tx.emit("complete");
  assert.equal((await pending).clientSubmissionId, "saved");
  assert.equal(h.opens[0].name, "lifesaving-timer-offline");
  assert.equal(h.opens[0].version, 1);
  assert.deepEqual(h.schemas, [{ name: "pendingResults", options: { keyPath: "clientSubmissionId" } }]);
});

test("an offline transaction aborted after request success is reported as failure", async () => {
  const h = databaseHarness();
  const pending = offlineStore(h.provider).putPendingResult({ clientSubmissionId: "saved" });
  const rejection = assert.rejects(pending, /Quota/);
  await new Promise(setImmediate);
  const tx = h.transactions[0];
  tx.request.emit("success");
  tx.error = new Error("Quota");
  tx.emit("abort");
  await rejection;
  await assert.rejects(offlineStore(null).getPendingResults(), /nicht verfügbar/);
});
