const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

process.env.TZ = "Europe/Berlin";
const source = fs.readFileSync(path.join(__dirname, "../timer/app.js"), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const code = section("async function renderHome()", "async function renderEvent(");

function overview(events, time, isOrganizer = false) {
  let clock = new Date(time).getTime();
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      innerHTML: "", textContent: "", attributes: {}, handlers: {}, dataset: {}, scrollTop: 0,
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(type, fn) { this.handlers[type] = fn; },
      click() { this.handlers.click?.(); }, focus() { this.focused = true; },
    });
    return nodes.get(id);
  }
  const tabs = ["current", "past"].map((tab) => {
    const button = node(`events-${tab}-tab`);
    button.dataset.eventTab = tab;
    return button;
  });
  const listeners = new Map();
  const document = {
    visibilityState: "visible",
    querySelector: node,
    querySelectorAll: () => tabs,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
  };
  const timers = new Map();
  let sequence = 0;
  let reads = 0;
  const context = vm.createContext({
    ...require("../timer/core.js"), Date: ClockDate, document, app: node("app"), eventListTab: "current", routeCleanup: null,
    window: { timerFirestoreApi: { async getAuthContext() { return { isOrganizer }; } } },
    async api(url, options) {
      assert.equal(url, "/events");
      assert.equal(options, undefined, "The tabs must never write event data");
      reads += 1;
      return { events: [...events] };
    },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setDocumentTitle() {}, bindDialogClose() {}, bindKeyboardStableEventDialog() {},
    icon: () => "", eventIconMarkup: () => '<span class="event-icon event-list-icon"></span>',
  });
  vm.runInContext(code, context);
  return { context, tabs, timers, node, document, listeners, reads: () => reads,
    setTime: (time) => { clock = new Date(time).getTime(); },
    render: () => context.renderHome(), list: () => node("#event-list").innerHTML,
  };
}

test("events become past exactly at local midnight four calendar days after their date", () => {
  const h = overview([], "2026-01-01T12:00:00");
  for (const [eventDate, before, cutoff] of [
    ["2026-01-01", "2026-01-04T23:59:59", "2026-01-05T00:00:00"],
    ["2026-01-30", "2026-02-02T23:59:59", "2026-02-03T00:00:00"],
    ["2026-12-29", "2027-01-01T23:59:59", "2027-01-02T00:00:00"],
    ["2028-02-27", "2028-03-01T23:59:59", "2028-03-02T00:00:00"],
    ["2026-03-28", "2026-03-31T23:59:59", "2026-04-01T00:00:00"],
    ["2026-10-24", "2026-10-27T23:59:59", "2026-10-28T00:00:00"],
  ]) {
    assert.equal(h.context.isPastEvent({ event_date: eventDate }, new Date(before)), false, eventDate);
    assert.equal(h.context.isPastEvent({ event_date: eventDate }, new Date(cutoff)), true, eventDate);
  }
  for (const event_date of ["", undefined, "not-a-date", "2026-02-30", "2026-13-01", "2027-01-01"]) {
    assert.equal(h.context.isPastEvent({ event_date }, new Date("2026-01-05T12:00:00")), false);
  }
});

test("event IDs are encoded in navigation and event names remain escaped", async () => {
  const id = 'event" onclick="alert(1)';
  const h = overview([{ id, name: '<img src=x onerror="alert(1)">', event_date: "2026-11-12" }], "2026-11-12T12:00:00");
  await h.render();
  assert.ok(h.list().includes(`href="#/event/${encodeURIComponent(id)}"`));
  assert.ok(!h.list().includes('<img src=x'));
});

test("tabs filter and order current/past events without loading or writing data on each switch", async () => {
  const events = [
    { id: "later", name: "Later", event_date: "2026-01-10" },
    { id: "older", name: "Older", event_date: "2025-12-25" },
    { id: "recent", name: "Recent", event_date: "2026-01-02" },
    { id: "past", name: "Past", event_date: "2026-01-01" },
    { id: "next", name: "Next", event_date: "2026-01-08" },
    { id: "undated", name: "Undated", event_date: "" },
  ];
  const h = overview(events, "2026-01-05T12:00:00", true);
  await h.render();
  assert.match(h.node("app").innerHTML, /Aktuell[\s\S]*Vergangene/);
  assert.match(h.node("app").innerHTML, /id="new-event"/);
  for (const id of ["next", "later", "recent", "undated"]) assert.ok(h.list().includes(`#/event/${id}`));
  for (const id of ["past", "older"]) assert.ok(!h.list().includes(`#/event/${id}`));
  assert.ok(h.list().indexOf("#/event/next") < h.list().indexOf("#/event/later"));
  h.node("#event-list").scrollTop = 200;
  h.tabs[1].click();
  assert.equal(h.node("#event-list").scrollTop, 0);
  assert.match(h.list(), /#\/event\/past/);
  assert.match(h.list(), /#\/event\/older/);
  assert.doesNotMatch(h.list(), /#\/event\/(recent|undated|later|next)/);
  assert.ok(h.list().indexOf("#/event/past") < h.list().indexOf("#/event/older"));
  assert.equal(h.tabs[1].attributes["aria-selected"], "true");
  assert.equal(h.node("#event-list").attributes["aria-labelledby"], "events-past-tab");
  assert.equal(h.reads(), 1);
  h.tabs[1].handlers.keydown({ key: "Home", preventDefault() {} });
  assert.equal(h.tabs[0].attributes["aria-selected"], "true");
  assert.equal(h.tabs[0].focused, true);
  assert.equal(h.tabs[1].tabIndex, -1);
});

test("events are reclassified at midnight and on returning to the app, with cleanup when leaving the view", async () => {
  for (const trigger of ["midnight", "resume"]) {
    const h = overview([{ id: "race", name: "Race", event_date: "2026-01-01" }], "2026-01-04T23:59:59");
    await h.render();
    assert.match(h.list(), /#\/event\/race/);
    assert.equal([...h.timers.values()][0].delay, 1050);
    h.setTime("2026-01-05T00:00:01");
    if (trigger === "midnight") [...h.timers.values()][0].fn();
    else h.listeners.get("visibilitychange")();
    assert.match(h.list(), /Keine aktuellen Events vorhanden/);
    h.tabs[1].click();
    assert.match(h.list(), /#\/event\/race/);
    assert.equal(h.reads(), 1);
    assert.equal(h.timers.size, 1);
    h.context.routeCleanup();
    assert.equal(h.timers.size, 0);
    assert.equal(h.listeners.size, 0);
  }
});

test("empty tabs explain their own state and undated events remain current", async () => {
  const empty = overview([], "2026-01-05T12:00:00", true);
  await empty.render();
  assert.match(empty.list(), /Noch kein Event vorhanden.*Lege das erste Event an/);
  const h = overview([{ id: "undated", name: "Undated" }], "2026-01-05T12:00:00");
  await h.render();
  assert.doesNotMatch(h.node("app").innerHTML, /id="new-event"/);
  assert.match(h.list(), /#\/event\/undated/);
  h.tabs[1].click();
  assert.match(h.list(), /Noch keine vergangenen Events vorhanden/);
});
