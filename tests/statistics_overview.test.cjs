const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../assets/js/statistics-overview-core.js");

test("overview groups age classes and genders and separates placements by phase and classification", () => {
  const row = (ageGroup, gender, round, classification, info) => ({ ageGroup, gender, round, classification, ...info });
  const rows = [
    row("13/14", "w", 1, "3Kampf", { athleteId: "a", place: 1 }),
    row("13/14", "w", 3, "3Kampf", { athleteId: "a", rankingStatus: "AK" }),
    row("13/14", "w", 3, "Einzelkampf", { athleteId: "c", place: 2 }),
    row("13/14", "m", 2, "3Kampf", { athleteId: "d", place: 1 }),
    row("12", "w", 1, "3Kampf", { athleteId: "b", place: 1 }),
  ];
  const data = core.groups(rows);
  assert.deepEqual(data.ages.map(age => age.label), ["AK 12", "AK 13/14"]);
  assert.deepEqual(data.ages[1].genders.map(group => group.label), ["Weiblich", "Männlich"]);
  assert.deepEqual(core.tables(data.ages[1].genders[0].rows, data.phaseCount).map(group => group.label),
    ["Finale · 3Kampf", "Finale · Einzelkampf", "Vorlauf · 3Kampf"]);
  assert.equal(core.placing(rows[0].place, data.overall.get("a")), "AK");
  assert.equal(core.placing(rows[3].place, data.overall.get("d")), 1);
});

test("overview displays ranking, penalty, start rights and historical time data independently", () => {
  const result = { ogId: "og", bzId: "bz", lvId: "lv", bvId: "bv" };
  for (const type of ["og", "bz", "lv", "bv"]) {
    assert.equal(core.organizationId({ ...result, startRight: type.toUpperCase() }), type);
  }
  assert.equal(core.organizationId({ ...result, startRight: "" }), "og");
  assert.equal(core.birthYearText(2005), "05");
  assert.equal(core.birthYearText(null), "—");
  assert.equal(core.timeText(54860), "0:54,86");
  assert.equal(core.timeText(59999), "1:00,00");
  assert.equal(core.timeText(null), "—");
  assert.equal(core.placing(null, "AK"), "AK");
  assert.equal(core.penalties({ status: "DQ", penaltyPoints: 50 }, String), "disq. · 50 P.");
  assert.equal(core.penalties({ status: "DNS" }, String), "n.a.");
  assert.equal(core.penalties({ status: "PASS" }, String), "bestanden");
});
