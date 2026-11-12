const test = require("node:test");
const assert = require("node:assert/strict");
const { create, readAll } = require("../timer/result-feed.js");

function fixture(hidden = false) {
  const events = [], pages = [], values = [], errors = [], handlers = new Map();
  const visibility = {
    visibilityState: hidden ? "hidden" : "visible",
    addEventListener: (name, callback) => handlers.set(name, callback),
    removeEventListener: (name) => handlers.delete(name),
  };
  const listen = (list, cursor, receive, fail) => {
    const entry = { cursor, receive, fail, stopped: false };
    list.push(entry);
    return () => { entry.stopped = true; };
  };
  const feed = create({
    listenEvent: (receive, fail) => listen(events, null, receive, fail),
    listenPage: (cursor, receive, fail) => listen(pages, cursor, receive, fail),
    canView: (event) => event?.allowed,
    onValue: (value) => values.push(value), onError: (error) => errors.push(error), visibility,
  });
  return { feed, events, pages, values, errors, handlers,
    visible(state) { visibility.visibilityState = state; handlers.get("visibilitychange")?.(); },
    event(event = { allowed: true }) { events.at(-1).receive(event); },
    page(results = [{ id: "a" }], hasMore = true) { pages.at(-1).receive({ results, hasMore, nextCursor: results.at(-1)?.id || null }); },
  };
}

test("only one result page is live, and metadata changes reuse that subscription", () => {
  const h = fixture();
  assert.equal(h.pages.length, 0);
  h.event();
  h.page();
  h.event({ allowed: true, name: "Renamed" });
  assert.equal(h.events.length, 1);
  assert.equal(h.pages.length, 1);
  assert.equal(h.pages[0].stopped, false);
  assert.equal(h.values.at(-1).event.name, "Renamed");
  assert.deepEqual(h.values.at(-1).results, [{ id: "a" }]);
});

test("paging uses the unsorted query cursor, ignores late callbacks and supports empty final pages", () => {
  const h = fixture();
  h.event();
  h.pages[0].receive({ results: [{ id: "z" }, { id: "a" }], hasMore: true, nextCursor: "z" });
  assert.equal(h.feed.next(), true);
  assert.equal(h.pages[0].stopped, true);
  assert.equal(h.pages[1].cursor, "z");
  assert.equal(h.feed.next(), false, "no overlapping page transitions");
  h.page([], false);
  const count = h.values.length;
  h.pages[0].receive({ results: [{ id: "stale" }] });
  h.pages[0].fail(new Error("stale"));
  assert.equal(h.values.length, count);
  assert.equal(h.errors.length, 0);
  assert.equal(h.values.at(-1).pageIndex, 1);
  assert.equal(h.feed.next(), false);
  assert.equal(h.feed.previous(), true);
  assert.equal(h.pages[2].cursor, null);
});

test("hidden tabs stop both listeners and resume on the same page; cleanup is final", () => {
  const h = fixture(true);
  assert.equal(h.events.length, 0);
  h.visible("visible"); h.event(); h.page(); h.feed.next(); h.page([{ id: "b" }]);
  h.visible("hidden");
  assert.ok(h.events.every((listener) => listener.stopped));
  assert.ok(h.pages.every((listener) => listener.stopped));
  const count = h.values.length;
  h.event(); h.page([{ id: "stale" }]);
  assert.equal(h.values.length, count);
  assert.equal(h.feed.next(), false);
  h.feed.refresh();
  assert.equal(h.pages.length, 2);
  h.visible("visible"); h.event(); h.page([{ id: "updated" }]);
  assert.equal(h.pages.at(-1).cursor, "a");
  assert.equal(h.values.at(-1).pageIndex, 1);
  h.feed.stop();
  h.event(); h.page([{ id: "stale" }]);
  assert.equal(h.values.at(-1).results[0].id, "updated");
  assert.equal(h.feed.next(), false);
  assert.equal(h.feed.previous(), false);
  assert.equal(h.handlers.size, 0);
});

test("revoked access empties the view and stops reads; recovery creates one fresh page", () => {
  const h = fixture(); h.event(); h.page();
  h.event({ allowed: false });
  assert.equal(h.pages[0].stopped, true);
  assert.deepEqual(h.values.at(-1).results, []);
  assert.equal(h.feed.next(), false);
  h.event(); h.page([{ id: "new" }], false);
  assert.equal(h.pages.length, 2);
  h.events[0].fail(new Error("Event deleted"));
  assert.equal(h.pages[1].stopped, true);
  assert.equal(h.errors[0].message, "Event deleted");
});

test("full export traverses all pages without truncating, duplicates or infinite cursor loops", async () => {
  const ids = Array.from({ length: 123 }, (_, i) => ({ id: String(i).padStart(3, "0") }));
  let calls = 0;
  const all = await readAll(async (cursor) => {
    calls += 1;
    const start = cursor == null ? 0 : ids.findIndex((item) => item.id === cursor) + 1;
    const results = ids.slice(start, start + 50);
    return { results, hasMore: results.length === 50, nextCursor: results.at(-1)?.id };
  });
  assert.deepEqual(all, ids);
  assert.equal(calls, 3);
  let iteration = 0;
  assert.equal((await readAll(async () => ++iteration === 1
    ? { results: [{ id: "a" }], hasMore: true, nextCursor: "a" }
    : { results: [{ id: "a" }, { id: "b" }], hasMore: false })).length, 2);
  await assert.rejects(readAll(async () => ({ results: [], hasMore: true, nextCursor: "loop" })), /geladen/);
  await assert.rejects(readAll(async () => { throw new Error("offline"); }), /offline/);
  let checked = 0;
  await assert.rejects(readAll(async () => ({ results: [], hasMore: false }), () => {
    if (++checked === 2) throw new Error("view closed");
  }), /view closed/);
});
