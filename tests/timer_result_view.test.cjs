const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../timer/app.js"), "utf8");
const code = source.slice(source.indexOf("async function renderViewer("), source.indexOf('\ndocument.addEventListener("click",', source.indexOf("async function renderRoute(")));

function fixture({ deferredEvent = null } = {}) {
  const nodes = new Map(), requests = [], feeds = [], pdfs = [], toasts = [];
  const event = { name: "Test", can_view_results: true, can_edit_results: true, results_access: "everyone" };
  let rows = [];
  const classList = { add() {}, remove() {}, toggle() {} };
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, {
      innerHTML: "", textContent: "", value: "", dataset: {}, handlers: {}, classList,
      addEventListener(type, callback) { this.handlers[type] = callback; },
      setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, focus() {}, close() { this.closed = true; },
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
      querySelector: (selector) => node(`${key} ${selector}`),
      querySelectorAll(selector) {
        if (selector === ".edit-result") return [...this.innerHTML.matchAll(/class="[^"]*edit-result" data-id="([^"]+)"/g)].map((match) => {
          const button = node(`edit-${match[1]}`); button.dataset.id = match[1]; return button;
        });
        if ([".result-edit-segment", ".result-edit-frequency"].includes(selector)) {
          const markup = node("#result-edit-fields .result-edit-laps").innerHTML;
          const pattern = new RegExp(`class="${selector.slice(1)}"[^>]*value="([^"]*)"`, "g");
          return [...markup.matchAll(pattern)].map((match, index) => {
            const input = node(`${selector}-${index}`);
            if (!input.initialized) { input.value = match[1]; input.initialized = true; }
            return input;
          });
        }
        if (selector === ".result-participant-select") return [{ value: "p" }];
        return [];
      },
    });
    return nodes.get(key);
  }
  const context = vm.createContext({
    ...require("../timer/core.js"), routeVersion: 0, activeResultView: null, routeCleanup: null, cooldownTimer: null, refreshTimer: null, animationFrame: null,
    timeInput: require("../timer/time-input.js").create(require("../timer/core.js")),
    app: node("app"), document: { querySelector: node, querySelectorAll: () => [], body: { classList } },
    window: { timerFirestoreApi: {
      clearParticipantCache() {},
      watchResults(id, receive, fail) {
        const feed = { receive, fail, stopped: false, next: () => true, previous: () => true, refresh() {}, stop() { this.stopped = true; } };
        feeds.push(feed); return feed;
      },
    }, TimerResultFeed: require("../timer/result-feed.js") },
    async api(url, options) {
      requests.push({ url, options });
      if (url.endsWith("?participants=0")) return deferredEvent ? deferredEvent : { event, participants: [] };
      if (options) return { ok: true };
      if (url === "/events/e") return { event, participants: [{ id: "p", name: "Person" }] };
      const cursor = new URL(url, "https://example.test").searchParams.get("cursor");
      const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0;
      const results = rows.slice(start, start + 50);
      return { results, hasMore: results.length === 50, nextCursor: results.at(-1)?.id };
    },
    async saveInBackground(id, url, method, payload) {
      return context.api(url, { method, body: JSON.stringify(payload) });
    },
    route: () => ({ page: "viewer", id: "e", discipline: "normal", gender: "male" }),
    setDocumentTitle() {}, safeExternalUrl: () => "", loadEventPdfImage: async () => null,
    compareParticipantsByOrganization: () => 0, birthYearText: () => "05", personAvatar: () => "", icon: () => "",
    bindDialogClose() {}, showDialog(dialog) { dialog.open = true; }, showToast: (message) => toasts.push(message),
    createResultsPdf(...args) { pdfs.push(args); return {}; }, openPdf() {}, confirm: () => true,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, cancelAnimationFrame() {},
    setReviewInteractionLock() {}, setTimerInteractionLock() {}, renderError(error) { throw error; }, renderHome() {},
  });
  vm.runInContext(code, context);
  return { context, event, requests, feeds, pdfs, toasts, node,
    rows(value) { rows = value; },
    receive(results, metadata = {}) { feeds.at(-1).receive({ event, results, hasMore: false, pageIndex: 0, ...metadata }); },
  };
}
const row = (id, overrides = {}) => ({ id, discipline: "normal", gender: "male", participant_id: "p", participant_name: "Person", birth_year: 5,
  age_group: "Offen", organization: "Baden", segments: [100], total_centiseconds: 100, official_centiseconds: null, created_at: "2026-11-12", ...overrides });

test("results initialize from the live page only and local hash filters reuse the view", async () => {
  const h = fixture();
  await h.context.renderViewer("e");
  assert.deepEqual(h.requests.map((request) => request.url), ["/events/e?participants=0"]);
  assert.equal(h.feeds.length, 1);
  h.receive([row("a")], { hasMore: true });
  await h.context.renderRoute({ type: "hashchange" });
  assert.match(h.node("#results").innerHTML, /Person/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.feeds.length, 1);
  assert.equal(h.feeds[0].stopped, false);
  h.context.route = () => ({ page: "home" });
  await h.context.renderRoute({ type: "hashchange" });
  assert.equal(h.feeds[0].stopped, true);
  assert.equal(h.context.activeResultView, null);
});

test("PDF loads every page and sorts the complete selected group; failure produces no partial PDF", async () => {
  const h = fixture();
  await h.context.renderViewer("e", "normal", "male");
  const rows = Array.from({ length: 123 }, (_, index) => row(String(index).padStart(3, "0"), {
    total_centiseconds: 500 - index, participant_name: `Person ${index}`,
  }));
  h.rows(rows); h.receive(rows.slice(0, 50), { hasMore: true });
  await h.node("#create-results-pdf").handlers.click({ currentTarget: h.node("#create-results-pdf") });
  assert.equal(h.pdfs.length, 1);
  assert.equal(h.pdfs[0][3].length, 123);
  assert.match(h.pdfs[0][3][0][0], /Person 122/);
  assert.equal(h.requests.filter((request) => request.url.includes("/results")).length, 3);
  assert.equal(h.feeds.length, 1);
  const original = h.context.api;
  h.context.api = async (url, options) => {
    if (url.includes("cursor=")) throw new Error("offline");
    return original(url, options);
  };
  await h.node("#create-results-pdf").handlers.click({ currentTarget: h.node("#create-results-pdf") });
  assert.equal(h.pdfs.length, 1);
  assert.match(h.toasts.at(-1), /offline/);
});

test("editing loads participants lazily and deleting a result relies on the existing live page", async () => {
  const h = fixture();
  await h.context.renderViewer("e", "normal", "male");
  h.receive([row("a")]);
  h.node("edit-a").handlers.click();
  await new Promise(setImmediate);
  assert.equal(h.toasts.length, 0);
  assert.equal(h.node("#result-edit-dialog").open, true);
  assert.equal(h.requests.filter((request) => request.url === "/events/e").length, 1);
  await h.node("#delete-result-dialog").handlers.click();
  assert.equal(h.requests.at(-1).options.method, "DELETE");
  assert.equal(h.requests.filter((request) => request.url === "/events/e/results").length, 0);
  h.receive([]);
  assert.match(h.node("#results").innerHTML, /Noch keine Ergebnisse/);
});

test("saved-result editors format both time fields while typing and save their minute values correctly", async () => {
  const h = fixture();
  await h.context.renderViewer("e", "normal", "male");
  h.receive([row("a", { segments: [8345], total_centiseconds: 8345 })]);
  h.node("edit-a").handlers.click();
  await new Promise(setImmediate);
  const segment = h.node(".result-edit-segment-0");
  assert.equal(segment.value, "1:23,45", "existing section times use the same notation as typed times");
  const official = h.node("#result-edit-fields #result-edit-official");
  for (const [input, digits, expected] of [[segment, "12345", "1:23,45"], [official, "123456", "12:34,56"]]) {
    input.value = digits;
    input.setSelectionRange(digits.length, digits.length);
    input.handlers.input({});
    assert.equal(input.value, expected);
  }
  await h.node("#result-edit-form").handlers.submit({ preventDefault() {}, submitter: {} });
  const saved = h.requests.find((request) => request.options?.method === "PATCH");
  const payload = JSON.parse(saved.options.body);
  assert.deepEqual(payload.segments, [8345]);
  assert.equal(payload.officialTime, 75456);
  assert.equal(h.node("#result-edit-dialog").closed, true);
});

test("leaving while the event loads cannot start a stale view or background subscription", async () => {
  let resolveEvent;
  const h = fixture({ deferredEvent: new Promise((resolve) => { resolveEvent = resolve; }) });
  const pending = h.context.renderViewer("e");
  h.context.routeVersion += 1;
  h.node("app").innerHTML = "New route";
  resolveEvent({ event: h.event, participants: [] });
  await pending;
  assert.equal(h.node("app").innerHTML, "New route");
  assert.equal(h.feeds.length, 0);
});

test("an abandoned route cannot replace the new page with a late request error", async () => {
  let rejectEvent;
  const h = fixture({ deferredEvent: new Promise((resolve, reject) => { rejectEvent = reject; }) });
  const pending = h.context.renderRoute();
  h.context.route = () => ({ page: "home" });
  h.context.renderHome = () => { h.node("app").innerHTML = "Home"; };
  await h.context.renderRoute();
  rejectEvent(new Error("old session"));
  await pending;
  assert.equal(h.node("app").innerHTML, "Home");
  assert.equal(h.feeds.length, 0);
});
