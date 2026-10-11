const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../training/core.js");

const now = new Date("2026-10-11T12:00:00Z");
const input = { date: "2026-10-10", meters: "3000", motivation: "7", text: "  Gute Einheit.  " };

test("entry validation accepts past dates, whole meters and optional private text", () => {
  assert.deepEqual(core.validateEntry(input, now), { date: "2026-10-10", meters: 3000, motivation: 7, text: "Gute Einheit." });
  assert.equal(core.validateEntry({ ...input, text: "" }, now).text, "");
  assert.equal(core.validateEntry({ ...input, date: "2024-02-29" }, now).date, "2024-02-29");
});

test("invalid dates, future training, fractional or excessive meters and motivation are rejected", () => {
  for (const date of ["2026-02-29", "2026-04-31", "2026-10-12", "1999-12-31", "", "garbage"]) {
    assert.throws(() => core.validateEntry({ ...input, date }, now));
  }
  for (const meters of [0, -1, 1.5, 100001, Infinity, "", "abc"]) {
    assert.throws(() => core.validateEntry({ ...input, meters }, now));
  }
  for (const motivation of [0, 11, 3.5, "", NaN]) {
    assert.throws(() => core.validateEntry({ ...input, motivation }, now));
  }
  assert.throws(() => core.validateEntry({ ...input, text: "x".repeat(5001) }, now));
});

test("training dates use the Berlin calendar across midnight and DST", () => {
  assert.equal(core.today(new Date("2026-07-10T22:30:00Z")), "2026-07-11");
  assert.equal(core.today(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
  assert.equal(core.today(new Date("2026-03-29T00:30:00Z")), "2026-03-29");
});

test("ordinary athletes have no access; Kader, organizers and admins do", () => {
  assert.equal(core.roleFor({ role: "sportler" }).hasAccess, false);
  for (const role of ["kader-sportler", "kadersportler", "kader", "organisator", "organizer", "admin"]) {
    assert.equal(core.roleFor({ role }).hasAccess, true, role);
    assert.equal(core.roleFor({}, { role }).hasAccess, true, role);
  }
  assert.equal(core.roleFor({ kader: true }).hasAccess, true);
  assert.equal(core.roleFor({}, { isKaderAthlete: true }).hasAccess, true);
  assert.equal(core.roleFor({ role: "kader" }).isOrganizer, false);
  assert.equal(core.roleFor({ role: "admin" }).isOrganizer, true);
});

const entries = [
  { uid: "a", athleteName: "Anna", date: "2026-10-01", meters: 3000, motivation: 8 },
  { uid: "a", athleteName: "Anna", date: "2026-10-01", meters: 2000, motivation: 6 },
  { uid: "b", athleteName: "Ben", date: "2026-09-30", meters: 5000, motivation: 5 },
  { uid: "c", athleteName: "Clara", date: "2026-10-02", meters: 1000, motivation: 9 },
  { uid: "d", athleteName: "Deniz", date: "2025-10-02", meters: 9000, motivation: 9 }
];

test("monthly/yearly rankings sum by account identity, handle ties and calendar boundaries", () => {
  const yearly = core.ranking(core.inPeriod(entries, "2026"));
  assert.deepEqual(yearly.map(({ uid, meters, rank }) => ({ uid, meters, rank })), [
    { uid: "a", meters: 5000, rank: 1 }, { uid: "b", meters: 5000, rank: 1 }, { uid: "c", meters: 1000, rank: 3 }
  ]);
  assert.deepEqual(core.ranking(core.inPeriod(entries, "2026-10")).map(({ uid }) => uid), ["a", "c"]);
  assert.equal(core.ranking([...entries, { ...entries[0], athleteName: "Anna Neu", date: "2026-10-10", meters: 100 }])
    .find(({ uid }) => uid === "a").name, "Anna Neu");
});

test("summaries count multiple sessions on one day correctly and do not invent motivation", () => {
  const sum = core.summary(entries.filter(({ uid }) => uid === "a"));
  assert.deepEqual(sum, { meters: 5000, count: 2, averageMeters: 2500, motivation: 7, days: 1 });
  assert.equal(core.summary([{ ...entries[0], motivation: undefined }]).motivation, null);
  assert.deepEqual(core.summary([]), { meters: 0, count: 0, averageMeters: 0, motivation: null, days: 0 });
});

test("changing date/meters and deleting entries recalculates rankings and the twelve month chart", () => {
  const corrected = entries.filter(({ uid }) => uid !== "d").map((entry, index) => index === 0 ? { ...entry, date: "2026-09-01", meters: 6000 } : entry);
  assert.equal(core.ranking(core.inPeriod(corrected, "2026-10"))[0].meters, 2000);
  const months = core.monthly(corrected, "2026");
  assert.equal(months.length, 12);
  assert.equal(months[8].meters, 11000);
  assert.equal(months[9].meters, 3000);
  const deleted = corrected.filter(({ uid }) => uid !== "a");
  assert.equal(core.ranking(deleted)[0].uid, "b");
});
