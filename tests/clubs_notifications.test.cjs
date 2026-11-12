const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

function harness() {
  const windowEvents = new Map();
  const documentEvents = new Map();
  const attributes = new Map();
  const app = { setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
  const badge = { hidden: true, textContent: "", closest: () => app };
  const document = { visibilityState: "visible", querySelector: () => badge,
    addEventListener: (key, fn) => documentEvents.set(key, fn), removeEventListener: key => documentEvents.delete(key) };
  const auth = { currentUser: { uid: "admin" } };
  const reads = [];
  const listeners = [];
  let stopped = 0;
  const window = { document, addEventListener: (key, fn) => windowEvents.set(key, fn), removeEventListener: key => windowEvents.delete(key),
    firebase: { firestore: () => ({ collection(name) { reads.push(name); return { where(...filter) { reads.push(filter); return {
      onSnapshot(options, next, error) { listeners.push({ next, error }); return () => { stopped++; }; }
    }; } }; } }) } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../assets/js/clubs-notifications.js"), "utf8"), { window });
  const controller = window.LifesavingClubNotifications.create({ isCurrentUser: user => user.uid === auth.currentUser?.uid });
  return { controller, auth, badge, app, attributes, reads, listeners, document, windowEvents, documentEvents, stopped: () => stopped };
}

test("club badges listen only to unresolved alerts, update live, and hide at zero", () => {
  const h = harness();
  h.controller.start(h.auth);
  assert.equal(h.reads[0], "clubs");
  assert.equal(JSON.stringify(h.reads[1]), JSON.stringify(["needsResponsible", "==", true]));
  h.listeners[0].next({ size: 2, metadata: { fromCache: true } });
  assert.equal(h.badge.hidden, true);
  h.listeners[0].next({ size: 2, metadata: { fromCache: false } });
  assert.equal(h.badge.textContent, "2");
  assert.equal(h.badge.hidden, false);
  assert.match(h.attributes.get("aria-label"), /2 ohne Verantwortlichen/);
  h.listeners[0].next({ size: 0, metadata: { fromCache: false } });
  assert.equal(h.badge.hidden, true);
  h.controller.start(h.auth);
  assert.equal(h.listeners.length, 1);
});

test("hidden pages stop listening and stale account callbacks cannot display previous counts", () => {
  const h = harness();
  h.controller.start(h.auth);
  h.document.visibilityState = "hidden";
  h.documentEvents.get("visibilitychange")();
  assert.equal(h.stopped(), 1);
  h.document.visibilityState = "visible";
  h.documentEvents.get("visibilitychange")();
  assert.equal(h.listeners.length, 2);
  h.listeners[0].next({ size: 99, metadata: { fromCache: false } });
  h.listeners[0].error();
  h.windowEvents.get("focus")();
  assert.equal(h.badge.hidden, true);
  assert.equal(h.listeners.length, 2);
  h.controller.stop();
  h.listeners[1].next({ size: 8, metadata: { fromCache: false } });
  assert.equal(h.badge.hidden, true);
  assert.equal(h.windowEvents.size, 0);
  assert.equal(h.documentEvents.size, 0);
  h.auth.currentUser = { uid: "another" };
  h.controller.start(h.auth);
  h.auth.currentUser = { uid: "changed" };
  h.listeners[2].next({ size: 5, metadata: { fromCache: false } });
  assert.equal(h.badge.hidden, true);
});
