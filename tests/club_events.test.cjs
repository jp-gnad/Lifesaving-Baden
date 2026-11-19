const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../assets/js/club-events-core.js");
const store = require("../assets/js/club-events-store.js");
const year = 2026;
const person = (id, age = 14, gender = "w") => ({ id, personId: id, name: id, birthYear: year - age, gender, activeYears: [year, year + 1], createdAt: { toMillis: () => 123 } });
const empty = () => ({ name: "Wettkampf", date: "2026-05-01", year, participants: {}, teams: {}, assignments: {}, revision: 0 });
function fixture() {
  let event = empty();
  for (let i = 0; i < 10; i++) event = core.change(event, { type: "add", id: `p${i}`, person: person(`p${i}`, i === 0 ? 18 : 14, i === 1 ? "m" : "w") });
  return event;
}
const addTeam = (event, id = "one", memberIds = ["p0", "p1", "p2", "p3"]) => core.change(event, { type: "team", id, memberIds, expected: null });

test("event dates are actual calendar dates and participant selection uses the event year", () => {
  assert.deepEqual(core.metadata(" Test ", "2028-02-29"), { name: "Test", date: "2028-02-29", year: 2028 });
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "20-01-01", ""]) assert.throws(() => core.metadata("Test", date), /Datum/);
  assert.throws(() => core.metadata(" ", "2026-01-01"), /Eventnamen/);
  assert.throws(() => core.participant({ ...person("p"), activeYears: [2027] }, 2026), /nicht aktiv/);
  assert.equal(core.participant({ ...person("p"), activeYears: [2027] }, 2027).individual, true);
});

test("every new participant starts individually and retains that flag when assigned to a team", () => {
  const before = fixture();
  const event = addTeam(before);
  assert.equal(Object.values(event.participants).every((p) => p.individual), true);
  assert.equal(event.assignments.p0, "one");
  assert.deepEqual(before.assignments, {});
  assert.equal(core.namedTeams(event)[0].name, "AK 17/18 männlich · 1");
  assert.equal(core.namedTeams({ ...event, year: 2027 })[0].name, "Offen männlich · 1");
});

test("only assigned participants can stop individual entry; removing a team never restores it", () => {
  let event = fixture();
  assert.throws(() => core.change(event, { type: "individual", id: "p0", enabled: false, expected: true }), /Mannschaft/);
  event = addTeam(event);
  event = core.change(event, { type: "individual", id: "p0", enabled: false, expected: true });
  assert.throws(() => core.change(event, { type: "remove", id: "p0" }), /zuerst/);
  event = core.change(event, { type: "team", id: "one", memberIds: null, expected: event.teams.one });
  assert.equal(event.participants.p0.individual, false);
  assert.equal(event.assignments.p0, undefined);
  event = core.change(event, { type: "individual", id: "p0", enabled: true, expected: false });
  assert.equal(event.participants.p0.individual, true);
});

test("swaps release the previous member without changing individual flags and reject duplicate claims", () => {
  let event = addTeam(fixture());
  const original = event.teams.one;
  event = core.change(event, { type: "individual", id: "p0", expected: true, enabled: false });
  event = core.change(event, { type: "team", id: "one", expected: original, memberIds: ["p2", "p3", "p4", "p5", "p6"] });
  assert.equal(event.participants.p0.individual, false);
  assert.equal(event.assignments.p0, undefined);
  assert.equal(core.namedTeams(event)[0].name, "AK 13/14 weiblich · 1");
  assert.throws(() => addTeam(event, "two", ["p6", "p7", "p8", "p9"]), /bereits/);
  for (const ids of [["p7", "p8", "p9"], ["p0", "p1", "p2", "p3", "p4", "p5"], ["p7", "p7", "p8", "p9"]]) assert.throws(() => addTeam(event, "invalid", ids), /4–5/);
  assert.throws(() => core.change(event, { type: "team", id: "one", expected: original, memberIds: ["p0", "p1", "p7", "p8"] }), /geändert/);
});

test("metadata cannot silently change the year of a populated event, and old participant snapshots remain usable", () => {
  const event = fixture();
  assert.throws(() => core.change(event, { type: "metadata", expectedRevision: event.revision, name: "Next", date: "2027-01-01" }), /leeren Event/);
  assert.throws(() => core.change(event, { type: "metadata", expectedRevision: 0, name: "Changed", date: "2026-01-01" }), /geändert/);
  assert.equal(core.change(empty(), { type: "metadata", expectedRevision: 0, name: "Next", date: "2027-01-01" }).year, 2027);
  assert.equal(addTeam(event).assignments.p0, "one"); // no live activity state is required to retain existing entries
});

test("event mutations check the account after reads and never write under a stale session", async () => {
  let writes = 0;
  const ref = { collection: () => ref, doc: () => ref };
  const db = { collection: () => ref, runTransaction: (action) => action({ get: async () => ({ exists: true, data: fixture }), set: () => { writes++; } }) };
  await assert.rejects(store.mutate(db, "club", "event", { type: "team", id: "one", memberIds: ["p0", "p1", "p2", "p3"], expected: null }, {}, () => { throw new Error("session changed"); }), /session changed/);
  assert.equal(writes, 0);
});
