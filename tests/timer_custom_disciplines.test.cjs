const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../timer/core.js");
const { create } = require("../timer/custom-discipline-picker.js");
const tick = () => new Promise(setImmediate);
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function fixture({ pages = async () => ({ customDisciplines: [] }), local = [] } = {}) {
  const nodes = new Map(), requests = [];
  const node = (key) => {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: "", value: "", textContent: "", hidden: false, disabled: false, handlers: {},
      addEventListener(type, handler) { this.handlers[type] = handler; }, querySelector: node,
    });
    return nodes.get(key);
  };
  let current = true;
  const picker = create({ ...core, api: async (url) => { requests.push(url); return pages(url); },
    localOptions: async (eventId, count) => local.filter((item) => item.eventId === eventId && item.lapCount === count),
  }).mount(node("root"), { eventId: "event-one", prefix: "test", lapCount: 4, isCurrent: () => current });
  return { picker, node, requests, leave() { current = false; } };
}

test("custom discipline identity includes the lap count and normalizes repeated names without changing stored result identity", () => {
  assert.equal(core.customDisciplineKey(" 100m   Brust ", 4), core.customDisciplineKey("100m BRUST", 4));
  assert.notEqual(core.customDisciplineKey("100m Brust", 4), core.customDisciplineKey("100m Brust", 2));
  assert.equal(core.resultLapCount({ segments: [123], lapGroups: [{ laps: [1, 2, 3, 4] }] }), 4);
  assert.equal(core.resultDisciplineName({ discipline: "normal", custom_discipline_name: "100m Brust" }), "100m Brust");
  assert.equal(core.resultDisciplineName({ discipline: "rescue50", custom_discipline_name: "ignored" }), "50 m Retten");
});

test("picker reuses only same-event, same-lap names, including locally queued names while the server waits", async () => {
  const server = deferred();
  const h = fixture({ pages: () => server.promise, local: [
    { id: "four", name: "100m Brust", lapCount: 4, eventId: "event-one" },
    { id: "two", name: "Falsche Rundenzahl", lapCount: 2, eventId: "event-one" },
    { id: "foreign", name: "Anderes Event", lapCount: 4, eventId: "event-two" },
  ] });
  await tick();
  const choice = h.node("[data-custom-choice]");
  assert.ok(choice.innerHTML.includes("100m Brust"));
  assert.ok(!choice.innerHTML.includes("Falsche Rundenzahl"));
  assert.ok(!choice.innerHTML.includes("Anderes Event"));
  choice.value = "four"; choice.handlers.change();
  assert.equal(h.picker.read().customDisciplineName, "100m Brust");
  assert.equal(h.picker.read().customLapCount, 4);
  h.node("[data-custom-name]").value = "Neuer Name";
  h.node("[data-custom-name]").handlers.input();
  assert.equal(h.picker.read().customDisciplineId, "");
  server.resolve({ customDisciplines: [{ id: "remote", name: "Servername", lapCount: 4 }, { id: "wrong", name: "Nicht passend", lapCount: 2 }] });
  await tick();
  assert.equal(h.picker.read().customDisciplineName, "Neuer Name", "late options never replace typed text");
  assert.ok(!choice.innerHTML.includes("Nicht passend"));
  assert.match(h.requests[0], /events\/event-one\/custom-disciplines\?laps=4$/);
});

test("changing the lap count clears the old selection and ignores late responses from the previous count", async () => {
  const old = deferred();
  const h = fixture({ pages: (url) => url.endsWith("laps=4") ? old.promise : Promise.resolve({ customDisciplines: [{ id: "two", name: "Zwei Runden", lapCount: 2 }] }) });
  await tick();
  h.node("[data-custom-name]").value = "Alter Name";
  h.picker.update(2); await tick();
  assert.equal(h.picker.read().customDisciplineName, "");
  old.resolve({ customDisciplines: [{ id: "four", name: "Vier Runden", lapCount: 4 }] }); await tick();
  assert.ok(!h.node("[data-custom-choice]").innerHTML.includes("Vier Runden"));
  assert.ok(h.node("[data-custom-choice]").innerHTML.includes("Zwei Runden"));
  h.picker.destroy();
});

test("name options escape untrusted labels and load more only on an explicit click", async () => {
  const h = fixture({ pages: (url) => Promise.resolve(url.includes("cursor=") ? { customDisciplines: [{ id: "last", name: "Letzter Name", lapCount: 4 }] }
    : { customDisciplines: [{ id: "first", name: '"><img src=x>', lapCount: 4 }], hasMore: true, nextCursor: "first" }) });
  await tick();
  assert.ok(!h.node("[data-custom-choice]").innerHTML.includes("<img"));
  assert.equal(h.requests.length, 1);
  h.node("[data-custom-more]").handlers.click(); await tick();
  assert.equal(h.requests.length, 2);
  assert.ok(h.node("[data-custom-choice]").innerHTML.includes("Letzter Name"));
});
