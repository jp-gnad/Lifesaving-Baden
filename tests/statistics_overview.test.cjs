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
  const sections = core.resultSections(data.ages[1].genders[0].rows, data.phaseCount);
  assert.deepEqual(sections.map(section => section.label), ["Vorlauf", "Finale"]);
  assert.deepEqual(sections[1].tables.map(table => table.classification), ["3Kampf", "Einzelkampf"]);
  assert.equal(core.placing(rows[0].place, data.overall.get("a")), "AK");
  assert.equal(core.placing(rows[3].place, data.overall.get("d")), 1);
});

test("overview offers the four preliminary and final layouts with one section per individual discipline", () => {
  const heat = { round: 1, disciplines: { D002: { place: 1 }, D003: { status: "DNS" } } };
  const final = { round: 2, disciplines: { D002: { place: 2 }, D004: { status: "DQ" } } };
  const sections = (first, last) => core.resultSections([
    { ...final, classification: last }, { ...heat, classification: first },
  ], 2);
  const outline = groups => groups.map(group => [group.disciplineId ?? group.label, group.tables.map(table => table.label)]);

  assert.deepEqual(outline(sections("3-Kampf", "Mehrkampf")), [["Vorlauf", ["Vorlauf"]], ["Finale", ["Finale"]]]);
  assert.deepEqual(outline(sections("3-Kampf", "Einzelkampf")),
    [["Vorlauf", ["Vorlauf"]], ["D002", ["Finale"]], ["D004", ["Finale"]]]);
  assert.deepEqual(outline(sections(" Einzelkampf ", "Mehrkampf")),
    [["D002", ["Vorlauf"]], ["D003", ["Vorlauf"]], ["Finale", ["Finale"]]]);
  const individual = sections("Einzelkampf", "EINZELKAMPF");
  assert.deepEqual(outline(individual), [["D002", ["Vorlauf", "Finale"]], ["D003", ["Vorlauf"]], ["D004", ["Finale"]]]);
  assert.deepEqual(individual[0].tables.map(table => table.rows.map(row => row.disciplines.D002.place)), [[1], [2]]);
});

test("overview preserves combined scoring, missing phases in an age group and single-round results", () => {
  const row = (round, classification, disciplines = {}) => ({ round, classification, disciplines });
  const combined = row(2, "Einzel-/Mehrkampf", { D001: { place: 1 } });
  const final = row(3, "Einzelkampf", { D001: { place: 2 } });
  const phases = core.resultSections([combined, final], 3);
  assert.equal(phases[0].label, "Zwischenlauf");
  assert.deepEqual(phases[0].tables[0].rows, [combined]);
  assert.deepEqual(phases[1].tables.map(table => table.label), ["Zwischenlauf", "Finale"]);
  assert.deepEqual(phases[1].tables.map(table => table.rows), [[combined], [final]]);

  const single = core.resultSections([row(1, "3Kampf")], 1);
  assert.equal(single.length, 1);
  assert.equal(single[0].tables[0].label, "Einzelner Durchgang");
  const legacy = core.resultSections([row(null, "Historische Wertung")], 0);
  assert.equal(legacy[0].label, "Direktes Finale");
  assert.equal(legacy[0].tables[0].classification, "Historische Wertung");
  assert.equal(core.resultSections([row(1, "Mehrkampf")], 2)[0].label, "Vorlauf");
});

test("individual results sort by discipline placement while preserving overall and discipline statuses", () => {
  const first = { athleteId: "a", place: 2, disciplines: { D002: { place: 1 } } };
  const second = { athleteId: "b", place: 1, disciplines: { D002: { place: 2 } } };
  const ak = { athleteId: "c", disciplines: { D002: { rankingStatus: "AK", status: "DQ" } } };
  const excluded = { athleteId: "d", disciplines: { D002: { place: 1 } } };
  const rows = [excluded, ak, second, first];
  const athletes = new Map(rows.map(({ athleteId }) => [athleteId, { lastName: athleteId }]));
  const overall = new Map([["d", "EXCLUDED"]]);
  assert.deepEqual(core.sortRows(rows, overall, athletes, "D002"), [first, second, ak, excluded]);
  assert.deepEqual(core.sortRows(rows, overall, athletes), [second, first, ak, excluded]);
  assert.equal(core.placing(ak.disciplines.D002.place, ak.disciplines.D002.rankingStatus), "AK");
  assert.equal(core.penalties(ak.disciplines.D002, String), "disq.");
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
