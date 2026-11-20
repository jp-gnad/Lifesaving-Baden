const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../assets/js/member-view-cache.js");
function storage() {
  const items = new Map();
  return { get length() { return items.size; }, key: (index) => [...items.keys()][index],
    getItem: (key) => items.get(key) || null, setItem: (key, value) => items.set(key, value), removeItem: (key) => items.delete(key) };
}

test("member snapshots survive navigation, isolate accounts and retain only display fields", () => {
  const saved = storage(), options = { getStorage: () => saved, now: () => 1000 };
  const first = create(options);
  first.write("a", { firstName: "Anna", lastName: "Baden", birthDate: "2001-02-03", pendingEmail: "private@example.test",
    arbitrary: "secret", role: "standard", personLinkRequest: { status: "requested", identityHint: "private" } }, "admin");
  const nextPage = create(options), snapshot = nextPage.read("a");
  assert.equal(snapshot.role, "admin", "the checked effective role can originate from claims");
  assert.equal(snapshot.profile.firstName, "Anna");
  assert.deepEqual(snapshot.profile.personLinkRequest, { status: "requested" });
  assert.equal("pendingEmail" in snapshot.profile, false);
  assert.equal("role" in snapshot.profile, false);
  assert.equal("arbitrary" in snapshot.profile, false);
  assert.equal(nextPage.read("b"), null);
  snapshot.role = "standard"; snapshot.profile.firstName = "Changed";
  assert.equal(nextPage.read("a").role, "admin");
  assert.equal(nextPage.read("a").profile.firstName, "Anna");
});

test("profile edits update the preview without extending a role's checked lifetime", () => {
  let time = 1000;
  const cache = create({ now: () => time });
  cache.write("a", { firstName: "Anna" }, "trainer");
  time += 20 * 60_000;
  cache.updateProfile("a", { firstName: "Neuer Name", role: "admin" });
  assert.equal(cache.read("a").role, "trainer");
  assert.equal(cache.read("a").profile.firstName, "Neuer Name");
  time += 10 * 60_000;
  assert.equal(cache.read("a"), null);
  assert.equal(cache.updateProfile("a", { firstName: "Late edit" }), null);
});

test("malformed, expired, future-dated and foreign snapshots cannot populate a dashboard", () => {
  for (const patch of [{ uid: "b" }, { version: 0 }, { checkedAt: 2001 }, { checkedAt: -1800000 },
    { role: "unknown" }, { profile: null }, { profile: [] }]) {
    const saved = storage();
    saved.setItem("lifesaving-baden:member-view:a", JSON.stringify({ version: 1, uid: "a", checkedAt: 1000, role: "admin", profile: {}, ...patch }));
    assert.equal(create({ getStorage: () => saved, now: () => 2000 }).read("a"), null);
  }
  const saved = storage(); saved.setItem("lifesaving-baden:member-view:a", "{");
  assert.equal(create({ getStorage: () => saved }).read("a"), null);
});

test("blocked storage and failed writes keep the in-memory preview usable", () => {
  const blocked = create({ getStorage() { throw new Error("blocked"); } });
  blocked.write("a", { displayName: "Anna" }, "admin");
  assert.equal(blocked.read("a").profile.displayName, "Anna");
  const saved = storage();
  create({ getStorage: () => saved }).write("a", { displayName: "Old" }, "admin");
  saved.setItem = () => { throw new Error("quota"); };
  const cache = create({ getStorage: () => saved });
  cache.write("a", { displayName: "New" }, "standard");
  assert.equal(cache.read("a").role, "standard");
  assert.equal(cache.read("a").profile.displayName, "New");
  blocked.clearAll(); assert.equal(blocked.read("a"), null);
});

test("logout removes all presentation snapshots without touching unrelated storage", () => {
  const saved = storage(), options = { getStorage: () => saved };
  const oldPage = create(options);
  oldPage.write("a", {}, "admin"); oldPage.write("b", {}, "trainer");
  saved.setItem("pending-results", "keep");
  create(options).clearAll();
  assert.equal(create(options).read("a"), null);
  assert.equal(create(options).read("b"), null);
  assert.equal(saved.getItem("pending-results"), "keep");
});
