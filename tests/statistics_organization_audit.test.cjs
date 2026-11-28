const { test } = require("node:test");
const assert = require("node:assert/strict");
const { findCandidates } = require("../assets/js/statistics-organization-audit.js");

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
