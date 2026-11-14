const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml } = require("../timer/core.js");
const { renderGroups } = require("../timer/participant-picker.js").create({ escapeHtml });
const option = (person) => `<button data-person-id="${escapeHtml(person.id)}"${person.disabled ? " disabled" : ""}>${escapeHtml(person.name || person.id)}</button>`;
const headings = (html) => [...html.matchAll(/class="participant-picker-age-heading"[^>]*>(.*?)<\/h3>/g)].map((match) => match[1]);

test("age groups sort numerically, retain the supplied order inside each class and place missing classes last", () => {
  const people = Object.freeze([
    { id: "open", age_group: "Offen" }, { id: "first", age_group: "AK 17/18", disabled: true },
    { id: "young", age_group: "AK 9/10" }, { id: "missing", age_group: "  " },
    { id: "second", age_group: "AK 17/18" }, { id: "middle", age_group: "AK 11/12" },
  ].map(Object.freeze));
  const html = renderGroups(people, option);
  assert.deepEqual(headings(html), ["AK 9/10", "AK 11/12", "AK 17/18", "Offen", "Ohne Altersklasse"]);
  assert.ok(html.indexOf('data-person-id="first" disabled') < html.indexOf('data-person-id="second"'));
  assert.equal((html.match(/data-person-id=/g) || []).length, people.length);
  assert.equal(people[0].id, "open");
});

test("import candidates and existing participants share groups, and filtering yields no empty headings", () => {
  const people = [{ id: "import", ageGroup: "15/16" }, { id: "existing", age_group: "15/16" }, { id: "other", age_group: "Offen" }];
  assert.deepEqual(headings(renderGroups(people, option)), ["15/16", "Offen"]);
  assert.deepEqual(headings(renderGroups(people.filter((person) => person.id === "existing"), option)), ["15/16"]);
  assert.equal(renderGroups([], option), "");
});

test("untrusted age labels cannot inject markup or attributes into group headings", () => {
  const label = '"><img src=x onerror="alert(1)">';
  const html = renderGroups([{ id: "p", age_group: label }], option);
  assert.ok(html.includes(`aria-label="${escapeHtml(label)}"`));
  assert.ok(html.includes(`aria-hidden="true">${escapeHtml(label)}</h3>`));
  assert.ok(!html.includes("<img"));
});
