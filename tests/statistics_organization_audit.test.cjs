const { test } = require("node:test");
const assert = require("node:assert/strict");
const { findCandidates, planAliases } = require("../assets/js/statistics-organization-audit.js");
const { organizationKeys } = require("../assets/js/statistics-excel-core.js");
const lvNames = require("../tools/lib/dlrg-landesverbaende.json");

test("the organization audit distinguishes spelling variants, separate levels and duplicate parent IDs", () => {
  const org = (id, name, type, parentId = null) => ({ id, name, type, parentId });
  const organizations = [
    org("country", "Deutschland", "BV"),
    org("baden-short", "Baden", "LV", "country"),
    org("baden-long", "Baden", "LV", "country"),
    org("wue", "Württemberg", "LV", "country"),
    org("bz", "Bodensee-Konstanz", "BZ", "baden-short"),
    org("bz-duplicate", "Bodensee-Konstanz", "BZ", "baden-long"),
    org("org-dash", "Bermatingen-Markdorf", "OG", "bz"),
    org("org-slash", "Bermatingen/Markdorf", "OG", "bz"),
    org("altona-bz", "Altona", "BZ", "baden-short"),
    org("altona-og", "Altona", "OG", "altona-bz"),
    org("alt-og", "Althengstett", "OG", "wue"),
    org("alt-og-baden", "Althengstett", "OG", "bz"),
  ];
  const groups = findCandidates(organizations);
  assert.deepEqual(groups.map(group => group.name), [
    "Althengstett", "Baden", "Bermatingen-Markdorf / Bermatingen/Markdorf", "Bodensee-Konstanz",
  ]);
  assert.equal(groups[0].reason, "Unterschiedliche Hierarchie");
  assert.equal(groups[1].type, "LV");
  assert.equal(groups[2].reason, "Gleiche übergeordnete Gliederung");
  assert.deepEqual(groups[2].entries[0].path, ["BV Deutschland", "LV Baden", "BZ Bodensee-Konstanz"]);
  assert.equal(groups[3].reason, "Gleiche Hierarchie mit unterschiedlichen IDs");
});

test("only existing common IDs with equivalent hierarchy are proposed, even down a duplicated tree", async () => {
  const identify = organizationKeys(lvNames);
  const org = (id, name, type, parentId = null) => ({ id, name, type, parentId, active: true, successorId: null });
  const bv = await identify("BV", "Deutschland", null, "Deutschland");
  const lv = await identify("LV", "Baden", bv.id, "Deutschland");
  const bz = await identify("BZ", "Bodenseekreis", lv.id, "Deutschland");
  const og = await identify("OG", "Bermatingen-Markdorf", bz.id, "Deutschland");
  const records = [org(bv.id, bv.name, "BV"), org(lv.id, lv.name, "LV", bv.id),
    org(bz.id, bz.name, "BZ", lv.id), org(og.id, og.name, "OG", bz.id),
    org("old-bv", "Deutschland", "BV"), org("old-lv", "Baden", "LV", "old-bv"),
    org("old-bz", "Bodenseekreis", "BZ", "old-lv"), org("old-og", "Bermatingen/Markdorf", "OG", "old-bz"),
    org("direct-og", "Bermatingen-Markdorf", "OG", "old-lv"),
    { ...org("fused-og", "Bermatingen-Markdorf", "OG", "old-bz"), active: false, successorId: "next" },
  ];
  const plan = await planAliases(records, identify);
  assert.deepEqual(plan.map(({ source, target }) => [source.id, target.id]),
    [["old-bv", bv.id], ["old-lv", lv.id], ["old-bz", bz.id], ["old-og", og.id]]);
  for (const { source, target } of plan) source.aliasOf = target.id;
  assert.deepEqual(await planAliases(records, identify), []);
  assert.equal(findCandidates(records)[0].entries.length, 3);
});
