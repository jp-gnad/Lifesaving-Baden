const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../assets/js/club-teams-core.js");
const year = 2026;
const person = (id, age = 14, gender = "w") => ({ id, personId: id, name: id, birthYear: year - age, gender, activeYears: [year, year + 1] });

test("highest age group and any male independently determine the team class", () => {
  assert.equal(core.classification([person("oldest", 18), person("boy", 15, "m")], year), "AK 17/18 männlich");
  for (const [age, group] of [[12, "AK 12"], [13, "AK 13/14"], [14, "AK 13/14"], [15, "AK 15/16"], [16, "AK 15/16"], [17, "AK 17/18"], [18, "AK 17/18"], [19, "Offen"]]) {
    assert.equal(core.classification([person("a", age)], year), `${group} weiblich`);
  }
  assert.equal(core.classification([person("a", 14)], year + 1), "AK 15/16 weiblich");
  assert.equal(core.classification([{ ...person("a"), birthYear: null }], year), null);
  assert.equal(core.classification([{ ...person("a"), gender: "" }], year), null);
});
