const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate, today, validDate, normalizeSearch } = require("../assets/js/start-eligibility-core.js");

const day = "2026-06-01";
const healthDeclaration = "2025-05-01";
const check = (age, dates = {}, when = day) => evaluate({ birthYear: Number(when.slice(0, 4)) - age, healthDeclaration, ...dates }, when);

test("an unlinked club account without a birth year cannot appear eligible", () => {
  const result = evaluate({ birthYear: null, healthDeclaration, rescueBronze: "2025-01-01" }, day);
  assert.equal(result.stage, 3);
  assert.equal(result.group, "Ohne Jahrgang");
  assert.equal(result.issues[0].name, "Jahrgang");
});

test("competition age changes with the calendar year and drives requirements within each age group", () => {
  const child = { birthYear: 2016, healthDeclaration, swimSilver: "2024-09-01" };
  assert.equal(evaluate(child, "2025-12-31").stage, 1);
  assert.equal(evaluate(child, "2026-01-01").issues[0].name, "Schwimmabzeichen Gold");
  assert.equal(check(12, { swimGold: "2024-06-01" }).group, "AK 12");
  assert.equal(check(13, { swimGold: "2024-06-01" }).issues[0].name, "RS Bronze");
  assert.equal(check(14).group, "AK 13/14");
  assert.equal(check(15, { rescueBronze: "2024-06-01" }).stage, 1);
  assert.equal(check(16, { rescueBronze: "2024-06-01" }).issues[0].name, "RS Silber");
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
  assert.equal(check(22, { rescueGold: "2023-10-01", combinedExercise: "2026-05-01" }).issues[0].name, "RS Silber");
  assert.equal(check(22, { rescueSilver: "2024-10-01", combinedExercise: "2025-11-01" }).issues[0].name, "Kombi-Übung");
  assert.equal(check(22, { rescueGold: "2024-10-01", combinedExercise: "2026-05-01" }).stage, 1);
  assert.equal(check(22, { rescueSilver: "2023-05-01", combinedExercise: "2026-05-01" }).issues[0].reason, "abgelaufen");
});

test("renewal advice prioritizes the combined exercise when the badge covers the season", () => {
  const freshBadge = { rescueSilver: "2025-09-01" };
  const warning = check(22, freshBadge).issues[0];
  assert.equal(warning.stage, 2);
  assert.equal(warning.name, "Kombi-Übung");
  assert.equal(warning.until, "2026-09-01");
  assert.equal(check(22, { ...freshBadge, combinedExercise: "2024-01-01" }).issues[0].name, "Kombi-Übung");
  assert.equal(check(22, { ...freshBadge, combinedExercise: "2026-06-01" }).stage, 1);

  const finalBadgeYear = { rescueSilver: "2023-09-01", combinedExercise: "2026-06-01" };
  assert.equal(check(22, finalBadgeYear).issues[0].name, "RS Silber");
  assert.equal(check(22, finalBadgeYear).issues[0].until, "2026-09-01");
  assert.equal(check(22, finalBadgeYear, "2026-09-02").issues[0].reason, "abgelaufen");
  assert.equal(check(22, { combinedExercise: "2026-06-01" }).issues[0].name, "RS Silber");

  const person = { birthYear: 2000, healthDeclaration: "2026-06-01", rescueSilver: "2026-06-01" };
  const nextSeason = evaluate(person, day, true).issues.find((issue) => issue.kind === "exam");
  assert.equal(nextSeason.name, "Kombi-Übung");
  assert.equal(nextSeason.until, "2027-06-01");
});

test("season planning recommends the badge directly when both renewals would fall in the same season", () => {
  const person = { birthYear: 2000, healthDeclaration: "2026-06-01", rescueSilver: "2024-06-15" };
  const exam = (dates, nextSeason = true) => evaluate({ ...person, ...dates }, "2026-11-11", nextSeason)
    .issues.find((issue) => issue.kind === "exam");

  // The existing exercise expires in February, then the badge in June.
  assert.deepEqual(exam({ combinedExercise: "2026-02-01" }),
    { kind: "exam", stage: 2, name: "RS Silber", until: "2027-02-01" });
  // Without a valid exercise at season start, renewing the badge solves both gaps.
  assert.deepEqual(exam({ combinedExercise: "2025-06-15" }),
    { kind: "exam", stage: 3, name: "RS Silber", reason: "erneuern" });
  assert.equal(exam({ combinedExercise: "2025-06-15" }, false).name, "Kombi-Übung");

  // The current season also uses its year end when choosing the renewal.
  assert.equal(exam({ rescueSilver: "2023-12-01", combinedExercise: "2025-11-20" }, false).name, "RS Silber");
  // A badge valid through December 31 can cover the season with one exercise.
  assert.equal(exam({ rescueSilver: "2024-12-31", combinedExercise: "2026-02-01" }).name, "Kombi-Übung");
  assert.equal(exam({ rescueSilver: "2024-12-30", combinedExercise: "2026-02-01" }).name, "RS Silber");
  assert.equal(exam({ rescueSilver: "2024-01-01", combinedExercise: "2026-02-01" }).until, "2027-01-01");
  // A newer Gold qualification is an equally valid basis for the combined exercise.
  assert.equal(exam({ rescueGold: "2025-01-01", combinedExercise: "2026-02-01" }).name, "Kombi-Übung");

  const renewed = { rescueSilver: "2027-02-01", healthDeclaration: "2026-06-01" };
  assert.equal(evaluate({ ...person, ...renewed }, "2027-02-01").stage, 1);
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

test("next season uses January 1, the new competition age and evidence recorded by today", () => {
  const child = { birthYear: 2014, swimGold: "2024-09-01", healthDeclaration };
  assert.equal(evaluate(child, day).group, "AK 12");
  const preview = evaluate(child, day, true);
  assert.equal(preview.group, "AK 13/14");
  assert.equal(preview.stage, 3);
  assert.equal(preview.issues[0].name, "RS Bronze");

  const adult = { birthYear: 2000, rescueSilver: day, healthDeclaration };
  assert.equal(evaluate(adult, day).stage, 1);
  assert.equal(evaluate(adult, day, true).stage, 2);
  assert.equal(evaluate({ ...adult, healthDeclaration: "2024-12-31" }, day, true).stage, 3);
  assert.equal(evaluate({ ...adult, rescueSilver: "2027-01-01" }, day, true).issues[0].reason, "fehlt");

  const senior = { birthYear: 1977, rescueBronze: "2024-01-01", healthDeclaration: "2026-01-01" };
  assert.equal(evaluate(senior, day).stage, 3);
  assert.equal(evaluate(senior, day, true).stage, 1);
});
