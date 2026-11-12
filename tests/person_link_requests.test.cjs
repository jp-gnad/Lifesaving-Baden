const test = require("node:test");
const assert = require("node:assert/strict");
const links = require("../assets/js/person-link-store.js");

const profile = () => ({ role: "trainer", firstName: "Anna Maria", lastName: "von Baden", displayName: "Eigener Name",
  email: "anna@example.test", gender: "weiblich", birthDate: "1991-05-20", dlrgBranch: "Baden" });
const fields = { serverTimestamp: () => "server-time" };
function store(data = profile(), beforeRead = async () => {}) {
  let saved = data;
  const writes = [];
  const ref = {};
  return {
    writes, get data() { return saved; },
    db: { collection: () => ({ doc: () => ref }), runTransaction: run => run({
      async get() { await beforeRead(); return { exists: saved !== null, data: () => saved }; },
      update(target, value) { assert.equal(target, ref); writes.push(value); saved = { ...saved, ...value }; },
    }) },
  };
}
const request = (state, hint = "", check) => links.request(state.db, "u", { uid: "u", email: "login@example.test" }, hint, fields, check);

test("link request readiness requires every saved identity field and a valid birth date", () => {
  assert.deepEqual(links.requestDetails(profile()).missing, []);
  for (const key of ["firstName", "lastName", "gender", "birthDate", "dlrgBranch"]) {
    assert.equal(links.requestDetails({ ...profile(), [key]: " " }).missing.length, 1, key);
  }
  for (const birthDate of ["1991-02-29", "2000-02-30", "01.01.2000", "1899-01-01", "2999-01-01"]) {
    assert.deepEqual(links.requestDetails({ ...profile(), birthDate }).missing, ["Geburtsdatum"]);
  }
  assert.equal(links.requestDetails({ ...profile(), birthDate: "2000-02-29" }).missing.length, 0);
});

test("requests snapshot the current profile and optional hint without changing its name or role", async () => {
  const state = store();
  const data = await request(state, "  Früher in Heidelberg  ");
  assert.equal(state.writes.length, 1);
  assert.equal(data.personLinkRequest.firstName, "Anna Maria");
  assert.equal(data.personLinkRequest.lastName, "von Baden");
  assert.equal(data.personLinkRequest.identityHint, "Früher in Heidelberg");
  assert.equal(data.personLinkRequest.identityConfirmed, true);
  assert.equal(data.personLinkRequest.accountEmail, "login@example.test");
  assert.equal(data.personLinkRequest.accountUid, "u");
  assert.equal(data.personLinkRequest.status, "requested");
  assert.equal(data.personLinkStatus, "requested");
  assert.equal(data.displayName, "Eigener Name");
  assert.equal(data.role, "trainer");
  assert.equal(state.writes[0].firstName, undefined);
  assert.equal(state.writes[0].role, undefined);
});

test("incomplete profiles and hints over 200 characters cannot submit", async () => {
  for (const key of ["firstName", "lastName", "gender", "birthDate", "dlrgBranch"]) {
    const state = store({ ...profile(), [key]: "" });
    await assert.rejects(request(state), { code: "person-link/profile-incomplete" });
    assert.equal(state.writes.length, 0);
  }
  const state = store();
  await assert.rejects(request(state, "x".repeat(201)), { code: "person-link/hint-too-long" });
  assert.equal(state.writes.length, 0);
  await request(state, "x".repeat(200));
  assert.equal(state.writes.length, 1);
});

test("updating a pending request uses current saved data and preserves its original request time", async () => {
  const state = store({ ...profile(), personLinkRequest: { status: "requested", firstName: "Alter", requestedAt: "original-time", identityHint: "Alter Hinweis" } });
  const data = await request(state, "Neuer Hinweis");
  assert.equal(data.personLinkRequest.firstName, "Anna Maria");
  assert.equal(data.personLinkRequest.requestedAt, "original-time");
  assert.equal(data.personLinkRequest.identityHint, "Neuer Hinweis");
});

test("missing or already linked accounts cannot be replaced by a request", async () => {
  const missing = store(null);
  await assert.rejects(request(missing), { code: "person-link/account-missing" });
  const linked = store({ ...profile(), personLink: { id: "1234567890abcdef", name: "Anna Archiv", birthYear: 1991, gender: "w", organization: "Baden" } });
  await assert.rejects(request(linked), { code: "person-link/account-already-linked" });
  assert.equal(missing.writes.length + linked.writes.length, 0);
});

test("a session change during the transaction prevents every write", async () => {
  let active = true;
  const state = store(profile(), async () => { active = false; });
  await assert.rejects(request(state, "Hinweis", () => {
    if (!active) throw Object.assign(new Error("session changed"), { code: "auth/user-mismatch" });
  }), { code: "auth/user-mismatch" });
  assert.equal(state.writes.length, 0);
});
