const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const store = require("../timer/participant-store.js");

function view() {
  const source = fs.readFileSync(path.join(__dirname, "../timer/app.js"), "utf8");
  const code = source.slice(source.indexOf("async function renderPeople("), source.indexOf("async function renderTimer("));
  const nodes = new Map();
  const timers = new Map();
  const requests = [];
  const event = { name: "Test", event_date: "2026-11-12", can_view_participants: true, can_edit_participants: true, can_import_participants: true };
  const existing = { id: "old", name: "Anna Müller", birth_year: 5, gender: "female", organization: "Baden", age_group: "Offen" };
  const added = { id: "new", name: "Nora Neu", birth_year: 7, gender: "female", organization: "Baden", age_group: "17/18" };
  const candidates = [existing, added].map((person) => ({ id: person.id, name: person.name, birthYear: 2000 + person.birth_year, gender: person.gender, organization: person.organization }));
  let html = "";
  let sequence = 0;
  function node(selector) {
    if (!nodes.has(selector)) {
      const handlers = {};
      const entry = { handlers, value: "", dataset: {}, hidden: false, disabled: false, open: false, innerHTML: "", textContent: "",
        addEventListener(type, fn) { handlers[type] = fn; },
        close() { this.open = false; handlers.close?.(); },
      };
      nodes.set(selector, entry);
    }
    return nodes.get(selector);
  }
  const context = vm.createContext({
    routeVersion: 1, routeCleanup: null,
    window: { TimerParticipantStore: store },
    document: { querySelector: node, querySelectorAll: () => [] },
    app: { set innerHTML(value) { html = value; nodes.clear(); } },
    async api(url, options) {
      requests.push({ url, options });
      if (!options && url === "/events/e?prepareImport=1") return { event, participants: [{ ...existing }] };
      if (!options && url.startsWith("/events/e/participants/import?q=")) return { candidates: candidates.map((row) => ({ ...row })), directoryReady: true };
      if (options?.method === "POST") return { id: added.id, participant: added };
      throw new Error(`Unexpected request: ${url}`);
    },
    eventCan: (event, field) => event[field],
    normalizedIdentity: (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]/g, ""),
    compareParticipantsByOrganization: () => 0, personAvatar: () => "", birthYearText: String, escapeHtml: String, icon: () => "",
    bindDialogClose() {}, setDocumentTitle() {}, showToast() {},
    openDialog(selector) { node(selector).open = true; },
    setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(code, context);
  return { context, requests, node, html: () => html, render: () => context.renderPeople("e"), async search(value) {
    node("#import-person-search").value = value;
    node("#import-person-search").handlers.input();
    const callbacks = [...timers.values()]; timers.clear();
    for (const callback of callbacks) await callback();
  } };
}

test("the people view checks existing/manual identities locally and renders an import without another event or roster request", async () => {
  const h = view();
  await h.render();
  h.node("#import-person").handlers.click();
  await h.search("anna");
  assert.match(h.node("#person-import-results").innerHTML, /data-id="old" disabled/);
  assert.match(h.node("#person-import-results").innerHTML, /data-id="new" >/);
  const button = { dataset: { id: "new" }, disabled: false };
  await h.node("#person-import-results").handlers.click({ target: { closest: () => button } });
  assert.match(h.html(), /Nora Neu/);
  assert.equal(h.requests.filter((request) => request.url === "/events/e?prepareImport=1").length, 1);
  assert.equal(h.requests.length, 3, "one initial load, one search, one import");
  h.node("#import-person").handlers.click();
  await h.search("nora");
  assert.match(h.node("#person-import-results").innerHTML, /data-id="new" disabled/);
});

test("leaving the route cancels pending searches and closes the dialogs", async () => {
  const h = view();
  await h.render();
  h.node("#import-person").handlers.click();
  h.node("#import-person-search").value = "anna";
  h.node("#import-person-search").handlers.input();
  h.context.routeVersion += 1;
  h.context.routeCleanup();
  assert.equal(h.node("#person-import-dialog").open, false);
  assert.equal(h.requests.length, 1);
});
