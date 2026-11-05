const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../assets/js/worktime-core.js");

const input = (overrides = {}) => ({ date: "2026-10-31", start: "18:00", end: "20:30", title: "Training", description: "", category: "training", ...overrides });
const now = new Date("2026-11-05T15:00:00Z");
function entry(overrides) {
  const record = core.prepare(input(overrides), now);
  return { ...record, date: core.key(record.day) };
}

test("completed work uses Berlin time independently of the device timezone", () => {
  const record = core.prepare(input({ title: " Training ", description: " Details " }), now);
  assert.equal(record.startedAt.toISOString(), "2026-10-31T17:00:00.000Z");
  assert.equal(record.endedAt.toISOString(), "2026-10-31T19:30:00.000Z");
  assert.equal(record.durationMinutes, 150);
  assert.equal(record.title, "Training");
  assert.equal(record.description, "Details");
  assert.equal(core.today(new Date("2026-10-31T23:30:00Z")), "2026-11-01");
  assert.equal(core.prepare(input({ date: "2026-07-01" }), now).startedAt.toISOString(), "2026-07-01T16:00:00.000Z");
});

test("overnight entries split at midnight across day, week and month boundaries", () => {
  const records = [entry({ date: "2026-08-31", start: "22:00", end: "01:00" }), entry({ date: "2026-11-01", start: "22:00", end: "01:00" })];
  assert.equal(records[0].durationMinutes, 180);
  assert.equal(core.summarize(records, "month", "2026-08-01").total, 120);
  assert.equal(core.summarize(records, "month", "2026-09-01").total, 60);
  assert.equal(core.summarize(records, "week", "2026-11-01").total, 120);
  assert.equal(core.summarize(records, "week", "2026-11-02").total, 60);
  const daily = core.summarize(records, "day", "2026-08-31");
  assert.equal(daily.buckets.reduce((sum, bucket) => sum + bucket.minutes, 0), 120);
  assert.equal(daily.buckets[22].minutes, 60);
  assert.equal(daily.buckets[23].minutes, 60);
  assert.equal(daily.buckets[0].minutes, 0);
  const nextDay = core.summarize(records, "day", "2026-09-01");
  assert.equal(nextDay.total, 60);
  assert.equal(nextDay.buckets[0].minutes, 60);
  assert.equal(nextDay.entries.length, 1);
});

test("DST duration uses elapsed minutes and rejects nonexistent Berlin times", () => {
  assert.equal(core.prepare(input({ date: "2026-03-29", start: "01:00", end: "04:00" }), now).durationMinutes, 120);
  assert.equal(core.prepare(input({ date: "2026-10-25", start: "01:00", end: "04:00" }), now).durationMinutes, 240);
  assert.throws(() => core.prepare(input({ date: "2026-03-29", start: "02:30", end: "04:00" }), now), /Zeitumstellung/);
  assert.equal(core.prepare(input({ date: "2026-10-25", start: "02:30", end: "03:30" }), now).durationMinutes, 120);
});

test("future dates and overnight tasks can be recorded", () => {
  for (const overrides of [{ date: "2026-12-01" }, { date: "2026-11-05", start: "15:00", end: "18:00" }, { date: "2026-11-05", start: "22:00", end: "01:00" }]) {
    assert.doesNotThrow(() => core.prepare(input(overrides), now));
  }
  assert.doesNotThrow(() => core.prepare(input({ date: "2026-11-05", start: "14:00", end: "16:00" }), now));
});

test("new categories, organization selection and compact monthly totals are supported", () => {
  for (const category of ["education", "other"]) {
    const record = core.prepare(input({ category, organization: "1", organizationName: " Ettlingen " }));
    assert.equal(record.organization, 1);
    assert.equal(record.organizationName, "Ettlingen");
  }
  assert.throws(() => core.prepare(input({ organization: "3", organizationName: "OG" })), /Gliederungen/);
  assert.throws(() => core.prepare(input({ organization: "0", organizationName: " " })), /Gliederungen/);
  const summary = core.summarize([entry({}), entry({ date: "2026-10-02" })], "month", "2026-10-01");
  const compact = core.compactBuckets(summary);
  assert.equal(compact.length, 5);
  assert.equal(compact[0].label, "1–7");
  assert.equal(compact[4].label, "29–31");
  assert.equal(compact.reduce((sum, bucket) => sum + bucket.minutes, 0), summary.total);
});

test("overlap checks include overnight boundaries but allow adjacent intervals", () => {
  const overnight = entry({ start: "22:00", end: "01:00" });
  assert.equal(core.overlaps(overnight, entry({ date: "2026-11-01", start: "00:30", end: "02:00" })), true);
  assert.equal(core.overlaps(overnight, entry({ date: "2026-11-01", start: "01:00", end: "02:00" })), false);
  assert.equal(core.recordEndDate(overnight), "2026-11-01");
  assert.equal(core.recordEndDate(entry({})), "2026-10-31");
});

test("invalid dates, times, category and oversized text are rejected", () => {
  for (const overrides of [
    { date: "2026-02-30" }, { date: "1999-01-01" }, { date: "" },
    { start: "24:00" }, { start: "9:00" }, { end: "" }, { start: "18:00", end: "18:00" },
    { category: "admin" }, { category: "__proto__" }, { title: "   " }, { title: "x".repeat(121) }, { description: "x".repeat(2001) },
  ]) assert.throws(() => core.prepare(input(overrides), now), JSON.stringify(overrides));
});

test("period navigation handles Monday boundaries, leap days and year changes", () => {
  assert.deepEqual(core.period("week", "2026-11-01"), { start: "2026-10-26", end: "2026-11-02" });
  assert.deepEqual(core.period("week", "2026-11-02"), { start: "2026-11-02", end: "2026-11-09" });
  assert.deepEqual(core.period("month", "2028-02-29"), { start: "2028-02-01", end: "2028-03-01" });
  assert.equal(core.move("month", "2026-01-31", 1), "2026-02-01");
  assert.equal(core.move("month", "2026-12-31", 1), "2027-01-01");
  assert.equal(core.move("week", "2026-12-31", 1), "2027-01-07");
});

test("statistics combine categories and active days without counting out-of-period entries", () => {
  const records = [entry({}), entry({ category: "athleteCare", start: "09:00", end: "10:00" }), entry({ date: "2026-10-30", category: "organization", end: "19:00" }), entry({ date: "2026-09-30" })];
  const summary = core.summarize(records, "month", "2026-10-01");
  assert.equal(summary.total, 270);
  assert.equal(summary.days, 2);
  assert.equal(summary.entries.length, 3);
  assert.equal(summary.byCategory.training, 150);
  assert.equal(summary.byCategory.athleteCare, 60);
  assert.equal(summary.byCategory.organization, 60);
  assert.equal(summary.byCategory.competition, 0);
  assert.equal(summary.buckets.length, 31);
  assert.equal(summary.buckets.reduce((sum, bucket) => sum + bucket.minutes, 0), summary.total);
  assert.equal(core.duration(270), "4 Std. 30 Min.");
  assert.equal(core.duration(0), "0 Std.");
});

test("explicit date ranges distribute elapsed time across all calendar days", () => {
  const record = entry({ startDate: "2026-10-30", endDate: "2026-11-02", start: "09:00", end: "09:00" });
  assert.equal(record.durationMinutes, 72 * 60);
  assert.equal(core.recordEndDate(record), "2026-11-02");
  assert.equal(core.summarize([record], "month", "2026-10-01").total, 39 * 60);
  assert.equal(core.summarize([record], "month", "2026-11-01").total, 33 * 60);
  const daily = core.summarize([record], "day", "2026-10-30");
  assert.equal(daily.buckets.reduce((sum, bucket) => sum + bucket.minutes, 0), 15 * 60);
  const wholeDay = core.summarize([record], "day", "2026-10-31");
  assert.equal(wholeDay.total, 24 * 60);
  assert.equal(wholeDay.buckets.every((bucket) => bucket.minutes === 60), true);
  assert.equal(core.summarize([record], "day", "2026-11-02").total, 9 * 60);
  assert.throws(() => core.prepare(input({ startDate: "2026-11-02", endDate: "2026-11-01" })), /nach Von/);
  assert.throws(() => core.prepare(input({ startDate: "2026-11-02", endDate: "2026-11-02", start: "12:00", end: "11:00" })), /nach Von/);
  assert.equal(core.prepare(input({ startDate: "2026-10-24", endDate: "2026-10-26", start: "12:00", end: "12:00" })).durationMinutes, 49 * 60);
});

test("multi-day statistics preserve category and organization shares in mobile bins", () => {
  const records = [entry({ startDate: "2026-11-07", endDate: "2026-11-09", start: "20:00", end: "04:00", category: "competition", organization: 1, organizationName: "Ettlingen" })];
  const summary = core.summarize(records, "month", "2026-11-01");
  assert.equal(summary.total, 32 * 60);
  assert.equal(summary.days, 3);
  assert.equal(summary.entries.length, 1);
  assert.deepEqual(summary.buckets.filter((bucket) => bucket.minutes).map((bucket) => bucket.minutes), [240, 1440, 240]);
  const compact = core.compactBuckets(summary);
  assert.equal(compact[0].minutes, 240);
  assert.equal(compact[1].minutes, 1680);
  for (const buckets of [summary.buckets, compact]) {
    assert.equal(buckets.reduce((sum, bucket) => sum + bucket.byCategory.competition, 0), summary.total);
    assert.equal(buckets.reduce((sum, bucket) => sum + bucket.byOrganization[1], 0), summary.total);
  }
  assert.equal(core.summarize(records, "week", "2026-11-08").total, 28 * 60);
  assert.equal(core.summarize(records, "week", "2026-11-09").total, 4 * 60);
});

test("midnight endpoints are exclusive and adjacent entries do not inflate days", () => {
  const records = [
    entry({ startDate: "2026-12-31", endDate: "2027-01-01", start: "22:00", end: "00:00" }),
    entry({ startDate: "2027-01-01", endDate: "2027-01-02", start: "00:00", end: "00:00", category: "education" }),
  ];
  const january = core.summarize(records, "month", "2027-01-01");
  assert.equal(january.total, 1440);
  assert.equal(january.days, 1);
  assert.equal(january.entries.length, 1);
  assert.equal(january.byCategory.training, 0);
  assert.equal(january.byCategory.education, 1440);
  const after = core.summarize(records, "day", "2027-01-02");
  assert.equal(after.total, 0);
  assert.equal(after.days, 0);
  assert.equal(after.entries.length, 0);
});

test("calendar-day totals respect 23- and 25-hour Berlin daylight-saving days", () => {
  for (const [date, nextDate, hours, twoOClock] of [
    ["2026-03-29", "2026-03-30", 23, 0],
    ["2026-10-25", "2026-10-26", 25, 120],
  ]) {
    const record = entry({ startDate: core.shift(date, -1), endDate: nextDate, start: "12:00", end: "12:00", organization: 2, organizationName: "Privat" });
    const daily = core.summarize([record], "day", date);
    assert.equal(daily.total, hours * 60);
    assert.equal(daily.byCategory.training, hours * 60);
    assert.equal(daily.byOrganization[2], hours * 60);
    assert.equal(daily.buckets[2].minutes, twoOClock);
    const monthly = core.summarize([record], "month", date);
    assert.equal(monthly.buckets.find((bucket) => bucket.key === date).minutes, hours * 60);
    assert.equal(monthly.total, record.durationMinutes);
  }
});

test("stacked organization totals survive compact charts and include unassigned entries", () => {
  const records = [
    entry({ start: "08:00", end: "13:00", organization: 0, organizationName: "Baden" }),
    entry({ start: "13:00", end: "19:00", organization: 1, organizationName: "Ettlingen" }),
    entry({ start: "19:00", end: "20:00" }),
  ];
  for (const mode of ["day", "week", "month"]) {
    const summary = core.summarize(records, mode, "2026-10-31");
    assert.equal(summary.byOrganization[0], 300);
    assert.equal(summary.byOrganization[1], 360);
    assert.equal(summary.byOrganization[-1], 60);
    for (const slot of [-1, 0, 1, 2]) assert.equal(summary.buckets.reduce((sum, bucket) => sum + bucket.byOrganization[slot], 0), summary.byOrganization[slot]);
    if (mode === "month") assert.equal(core.compactBuckets(summary).reduce((sum, bucket) => sum + bucket.byOrganization[1], 0), 360);
  }
});

test("category stacks preserve totals across organizations, periods and compact monthly bins", () => {
  const records = [
    entry({ start: "08:00", end: "13:00", organization: 0, organizationName: "Baden" }),
    entry({ start: "13:00", end: "14:00", organization: 1, organizationName: "Ettlingen" }),
    entry({ start: "14:00", end: "20:00", category: "competition", organization: 1, organizationName: "Ettlingen" }),
    entry({ start: "20:00", end: "20:30", category: "other" }),
    entry({ date: "2026-10-02", category: "education", start: "09:00", end: "11:00" }),
    entry({ date: "2026-09-30", category: "athleteCare" }),
  ];
  for (const mode of ["day", "week", "month"]) {
    const summary = core.summarize(records, mode, "2026-10-31");
    assert.equal(summary.byCategory.training, 360);
    assert.equal(summary.byCategory.competition, 360);
    assert.equal(summary.byCategory.other, 30);
    assert.equal(summary.byCategory.education, mode === "month" ? 120 : 0);
    assert.equal(summary.byCategory.athleteCare, 0);
    for (const buckets of [summary.buckets, ...(mode === "month" ? [core.compactBuckets(summary)] : [])]) {
      for (const category of Object.keys(core.categories)) {
        assert.equal(buckets.reduce((sum, bucket) => sum + bucket.byCategory[category], 0), summary.byCategory[category]);
      }
      for (const bucket of buckets) {
        assert.equal(Object.values(bucket.byCategory).reduce((sum, minutes) => sum + minutes, 0), bucket.minutes);
        assert.equal(Object.values(bucket.byOrganization).reduce((sum, minutes) => sum + minutes, 0), bucket.minutes);
      }
    }
  }
  const empty = core.summarize([], "month", "2026-11-01");
  assert.equal(core.compactBuckets(empty).every((bucket) => Object.values(bucket.byCategory).every((minutes) => minutes === 0)), true);
});
