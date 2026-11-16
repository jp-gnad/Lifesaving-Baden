const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../assets/js/club-teams-core.js");
const year = 2026;
const person = (id, age = 14, gender = "w") => ({ id, personId: id, name: id, birthYear: year - age, gender, activeYears: [year, year + 1] });
const four = [person("a"), person("b"), person("c"), person("d")];

test("highest age group and any male independently determine the team class", () => {
  assert.equal(core.classification([person("oldest", 18), person("boy", 15, "m")], year), "AK 17/18 männlich");
  for (const [age, group] of [[12, "AK 12"], [13, "AK 13/14"], [14, "AK 13/14"], [15, "AK 15/16"], [16, "AK 15/16"], [17, "AK 17/18"], [18, "AK 17/18"], [19, "Offen"]]) {
    assert.equal(core.classification([person("a", age)], year), `${group} weiblich`);
  }
  assert.equal(core.classification([person("a", 14)], year + 1), "AK 15/16 weiblich");
  assert.equal(core.classification([{ ...person("a"), birthYear: null }], year), null);
  assert.equal(core.classification([{ ...person("a"), gender: "" }], year), null);
});

test("creating, swapping and deleting atomically release and reserve people without mutating input", () => {
  const empty = { teams: {}, assignments: {} };
  const first = core.change(empty, "one", four, year, null);
  assert.deepEqual(empty, { teams: {}, assignments: {} });
  assert.deepEqual(Object.keys(first.assignments), ["a", "b", "c", "d"]);
  const swapped = core.change(first, "one", [...four.slice(1), person("e", 19, "m")], year, first.teams.one);
  assert.equal(swapped.assignments.a, undefined);
  assert.equal(core.namedTeams(swapped, year)[0].name, "Offen männlich · 1");
  const deleted = core.change(swapped, "one", null, year, swapped.teams.one);
  assert.deepEqual(deleted.teams, {});
  assert.deepEqual(deleted.assignments, {});
  assert.equal(first.assignments.a, "one");
});

test("teams require four or five distinct active people and reject concurrent edits and double assignments", () => {
  for (const members of [four.slice(1), [...four, person("e"), person("f")], [...four.slice(1), four[1]], [...four.slice(1), { ...four[0], activeYears: [] }]]) {
    assert.throws(() => core.change({}, "one", members, year, null), { code: "clubs/team" });
  }
  const first = core.change({}, "one", [...four, person("e")], year, null);
  assert.throws(() => core.change(first, "two", four, year, null), /bereits/);
  assert.throws(() => core.change(first, "one", four, year, null), /geändert/);
  assert.throws(() => core.change({}, "one", null, year, first.teams.one), /geändert/);
  const independentYear = core.change({}, "two", four, year + 1, null);
  assert.equal(independentYear.assignments.a, "two");
});

test("numbering is per classification and deterministic when multiple teams share an age group", () => {
  let season = core.change({}, "first", four, year, null);
  season = core.change(season, "second", four.map((p) => ({ ...p, id: `${p.id}2`, personId: `${p.id}2` })), year, null);
  season = core.change(season, "third", four.map((p) => ({ ...p, id: `${p.id}3`, personId: `${p.id}3`, gender: "m" })), year, null);
  assert.deepEqual(core.namedTeams(season, year).map((team) => team.name), ["AK 13/14 weiblich · 1", "AK 13/14 weiblich · 2", "AK 13/14 männlich · 1"]);
});

test("directory identities survive representation as a responsible account", () => {
  const season = core.change({}, "one", four, year, null);
  const linked = { ...four[0], id: "account_owner" };
  assert.throws(() => core.change(season, "two", [linked, person("e"), person("f"), person("g")], year, null), /bereits/);
  const next = core.change(season, "one", [linked, ...four.slice(1)], year, season.teams.one);
  assert.equal(next.assignments.a, "one");
  assert.equal(next.teams.one.members[0].rosterId, "account_owner");
});
