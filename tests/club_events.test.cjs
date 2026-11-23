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
  assert.throws(() => core.metadata(" ", "2026-01-01"), /Terminnamen/);
  assert.throws(() => core.participant({ ...person("p"), activeYears: [2027] }, 2026), /nicht aktiv/);
  assert.equal(core.participant({ ...person("p"), activeYears: [2027] }, 2027).individual, true);
});

test("training series skip BW school breaks, public holidays and extra dates without shifting the weekday", () => {
  const action = { type: "create-training", category: "training", name: "Training", startTime: "18:00", endTime: "19:00",
    date: "2026-12-23", plannedOn: "2026-11-23", repeatUntil: "2027-01-27", repeatDays: 7, skipSchoolFree: true,
    excludedDays: core.excludedSchoolDays("20.01.2027\n20.01.2027") };
  assert.deepEqual(core.occurrences("first", action), [{ id: "first", date: "2027-01-13" }, { id: "first-2", date: "2027-01-27" }]);
  const spring = { ...action, date: "2027-03-25", repeatUntil: "2027-04-15" };
  assert.deepEqual(core.occurrences("easter", spring).map(({ date }) => date), ["2027-04-08", "2027-04-15"]);
  const autumn = { ...action, date: "2027-11-01", repeatUntil: "2027-11-15" };
  assert.deepEqual(core.occurrences("autumn", autumn).map(({ date }) => date), ["2027-11-08", "2027-11-15"]);
  assert.throws(() => core.occurrences("empty", { ...action, repeatUntil: "2027-01-06" }), /ausgeschlossenen/);
  assert.throws(() => core.excludedSchoolDays("31.02.2027"), /TT.MM.JJJJ/);
});

test("training series can span at most one calendar year from the planning date", () => {
  const action = { type: "create-training", category: "training", name: "Training", startTime: "18:00", endTime: "19:00",
    date: "2026-11-23", plannedOn: "2026-11-23", repeatUntil: "2027-11-23", repeatDays: 7 };
  assert.equal(core.occurrences("series", action).length, 53);
  assert.throws(() => core.occurrences("series", { ...action, repeatUntil: "2027-11-24" }), /ein Jahr/);
  assert.throws(() => core.occurrences("series", { ...action, date: "2026-11-22" }), /ab heute/);
  assert.throws(() => core.occurrences("series", { ...action, plannedOn: "2030-08-01", date: "2030-08-05",
    repeatUntil: "2030-09-30", skipSchoolFree: true }), /keine vollständigen/);
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
  assert.throws(() => core.change(event, { type: "metadata", expectedRevision: event.revision, name: "Next", date: "2027-01-01" }), /Termin ohne Teilnehmer/);
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

test("an event is created without participants and a team can draw directly from active club people", () => {
  let event = core.replay(null, { type: "create", name: "Test", date: "2026-05-01", additions: [] });
  assert.deepEqual(event.participants, {});
  const additions = Array.from({ length: 5 }, (_, i) => core.snapshotPerson({ ...person(`new${i}`), individual: false }));
  event = core.replay(event, { type: "team", additions, command: { type: "team", id: "one", memberIds: additions.map((p) => p.id), expected: null } });
  assert.equal(Object.keys(event.participants).length, 5);
  assert.equal(Object.values(event.participants).every((p) => p.individual === false), true);
  assert.equal(Object.values(event.assignments).every((team) => team === "one"), true);
  event = core.replay(event, { type: "singles", additions: [], removals: [], toggles: [{ type: "individual", id: "new0", enabled: true, expected: false }] });
  assert.equal(event.participants.new0.individual, true);
  assert.equal(event.assignments.new0, "one");
});

test("a large selection uses bounded groups and no redundant person reads for cached identities", async () => {
  let data = null;
  let transactions = 0;
  let personReads = 0;
  const reference = (path) => ({ id: path.split("/").at(-1), path, collection: (name) => collection(`${path}/${name}`),
    async get() { personReads++; throw new Error("Unexpected person read"); } });
  const collection = (path) => ({ doc: (id) => reference(`${path}/${id}`) });
  const db = { collection, async runTransaction(action) {
    transactions++;
    return action({ get: async () => ({ exists: Boolean(data), data: () => data }), set: (_ref, value) => { data = value; } });
  } };
  const selected = Array.from({ length: 20 }, (_, index) => ({ ...person(`p${index}`), rosterGender: "w" }));
  const result = await store.create(db, "club", "event", "Test", "2026-05-01", selected, { FieldValue: { serverTimestamp: () => 0 } });
  assert.equal(Object.keys(result.participants).length, 20);
  assert.equal(transactions, 1 + Math.ceil(20 / core.participantBatchSize));
  assert.equal(personReads, 0);
});

test("event lists group by event-year age, female before male, then German alphabetical order", () => {
  const entries = [person("Zoe", 14), person("Adam", 14, "m"), person("anna", 14), person("Jung", 12),
    person("Änne", 14), person("Offen", 22), person("Unbekannt", 14, ""), { ...person("Kein Jahrgang"), birthYear: null }];
  const groups = core.displayGroups(entries, year);
  assert.deepEqual(groups.map((entry) => entry.group), ["AK 12", "AK 13/14", "Offen", "Ohne Jahrgang"]);
  const middle = groups.find((entry) => entry.group === "AK 13/14");
  assert.deepEqual(middle.genders.map((entry) => entry.gender), ["w", "m", ""]);
  assert.deepEqual(middle.genders[0].entries.map((entry) => entry.name), ["anna", "Änne", "Zoe"]);
  assert.equal(core.displayGroups([entries[0]], year + 1)[0].group, "AK 15/16");
  assert.equal(entries[0].name, "Zoe");
});

test("team presentation uses the oldest member and any male and preserves natural team numbering", () => {
  const entries = [
    { id: "mixed", name: "Mannschaft", members: [person("Frau", 18), person("Mann", 12, "m")] },
    { id: "ten", name: "AK 17/18 weiblich · 10", members: [person("A", 18)] },
    { id: "two", name: "AK 17/18 weiblich · 2", members: [person("B", 17)] },
  ];
  const [group] = core.displayGroups(entries, year);
  assert.equal(group.group, "AK 17/18");
  assert.deepEqual(group.genders.map((entry) => entry.gender), ["w", "m"]);
  assert.deepEqual(group.genders[0].entries.map((entry) => entry.id), ["two", "ten"]);
  assert.equal(group.genders[1].entries[0].id, "mixed");
});

test("club event periods include today in planned events and classify previous years by date", () => {
  assert.equal(core.eventPeriod("2026-11-19", "2026-11-19"), "planned");
  assert.equal(core.eventPeriod("2026-11-18", "2026-11-19"), "past");
  assert.equal(core.eventPeriod("2025-12-31", "2026-11-19"), "past");
  assert.equal(core.eventPeriod("2027-01-01", "2026-11-19"), "planned");
  assert.equal(core.eventPeriod("2026-12-31", "2027-01-01"), "past");
  assert.equal(core.eventPeriod("2026-11-19", "2026-11-20"), "past");
});
