const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate, today, validDate, normalizeSearch } = require("../assets/js/start-eligibility-core.js");

const day = "2026-06-01";
const healthDeclaration = "2025-05-01";
const check = (age, dates = {}, when = day) => evaluate({ birthYear: Number(when.slice(0, 4)) - age, healthDeclaration, ...dates }, when);

test("competition age changes with the calendar year and drives requirements within each age group", () => {
  const child = { birthYear: 2016, healthDeclaration, swimSilver: "2024-09-01" };
  assert.equal(evaluate(child, "2025-12-31").stage, 1);
  assert.equal(evaluate(child, "2026-01-01").issues[0].name, "Schwimmabzeichen Gold");
  assert.equal(check(12, { swimGold: "2024-06-01" }).group, "AK 12");
  assert.equal(check(13, { swimGold: "2024-06-01" }).issues[0].name, "RS Bronze");
  assert.equal(check(14).group, "AK 13/14");
  assert.equal(check(15, { rescueBronze: "2024-06-01" }).stage, 1);
  assert.equal(check(16, { rescueBronze: "2024-06-01" }).issues[0].name, "RS Silber/Gold");
  assert.equal(check(16).group, "AK 15/16");
  assert.equal(check(18).group, "AK 17/18");
  assert.equal(check(19).group, "Offen");
  assert.equal(check(49, { rescueBronze: "2024-06-01" }).stage, 3);
  assert.equal(check(50, { rescueSilver: "2014-06-01" }).stage, 1);
});

test("the longer valid rescue route determines status and the reason for renewal", () => {
  assert.equal(check(16, { rescueSilver: "2025-12-31" }).stage, 1);
  assert.equal(check(16, { rescueSilver: "2025-06-01" }).stage, 2);
  assert.deepEqual(check(16, { rescueSilver: "2025-06-01" }, "2026-06-02").issues[0],
    { kind: "exam", stage: 3, name: "Kombi-Übung", reason: "fehlt" });
  assert.equal(check(22, { rescueGold: "2023-10-01", combinedExercise: "2026-05-01" }).issues[0].name, "RS Silber/Gold");
  assert.equal(check(22, { rescueSilver: "2024-10-01", combinedExercise: "2025-11-01" }).issues[0].name, "Kombi-Übung");
  assert.equal(check(22, { rescueGold: "2024-10-01", combinedExercise: "2026-05-01" }).stage, 1);
  assert.equal(check(22, { rescueSilver: "2023-05-01", combinedExercise: "2026-05-01" }).issues[0].reason, "abgelaufen");
});

test("health lasts 24 calendar months, including a clamped leap day and its final day", () => {
  const dates = { swimGold: "2024-01-01", healthDeclaration: "2024-02-29" };
  assert.equal(check(12, dates, "2026-02-28").stage, 2);
  assert.equal(check(12, dates, "2026-02-28").issues[0].until, "2026-02-28");
  assert.equal(check(12, dates, "2026-03-01").stage, 3);
  assert.equal(check(12, { ...dates, healthDeclaration: "2024-12-31" }).stage, 1);
  assert.equal(check(12, { ...dates, healthDeclaration: "2026-06-02" }).issues[0].reason, "fehlt");
  assert.deepEqual(check(16, { healthDeclaration: "2024-07-01" }).issues.map(({ stage }) => stage), [3, 2]);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(today(new Date("2025-12-31T23:00:00Z")), "2026-01-01");
  assert.equal(normalizeSearch("  Céline Groß  "), "celinegross");
});
