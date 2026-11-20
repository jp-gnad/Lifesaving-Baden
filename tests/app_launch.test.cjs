const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const flush = () => new Promise(setImmediate);
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function element(inert = false) {
  const attributes = new Set(inert ? ["inert"] : []), events = {};
  return { attributes, events, tagName: "DIV", hidden: true, textContent: "", style: {},
    hasAttribute: (name) => attributes.has(name), setAttribute: (name) => attributes.add(name),
    removeAttribute: (name) => attributes.delete(name), addEventListener: (name, cb) => { events[name] = cb; } };
}
function harness({ active = true, loaded = true, fonts = Promise.resolve(), image, logo = Promise.resolve() } = {}) {
  let now = 0, nextTimer = 0, frames = 0;
  const timers = new Map(), events = new Map(), classes = new Set(active ? ["app-launching"] : []);
  const content = element(), status = element(), retry = element(), header = element(), main = element(true);
  const mark = { ...element(), decode: () => logo };
  const splash = { querySelector: (selector) => ({ ".app-launch-content": content, img: mark,
    "[data-launch-status]": status, "[data-launch-retry]": retry })[selector] };
  const root = { classList: { contains: (name) => classes.has(name),
    add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)) } };
  const document = { documentElement: root, querySelector: () => splash, body: { children: [splash, header, main] },
    readyState: loaded ? "complete" : "interactive", fonts: { ready: fonts }, images: image ? [image] : [] };
  const redirects = [], location = new URL("https://example.test/club/app.html?keep=yes#profile");
  location.replace = (url) => redirects.push(url);
  const window = { location, innerHeight: 800,
    setTimeout(cb, delay) { const id = ++nextTimer; timers.set(id, { cb, time: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id), requestAnimationFrame(cb) { frames++; queueMicrotask(cb); },
    addEventListener(name, cb, options) { if (!events.has(name)) events.set(name, []); events.get(name).push({ cb, once: options?.once }); },
    removeEventListener(name, cb) { events.set(name, (events.get(name) || []).filter((entry) => entry.cb !== cb)); } };
  vm.runInNewContext(read("assets/js/app-launch.js"), { window, document, URL, Date: class extends Date { static now() { return now; } } });
  return { api: window.LifesavingAppLaunch, classes, content, status, retry, header, main, mark, redirects, timers,
    get frames() { return frames; },
    emit(name) { for (const entry of [...(events.get(name) || [])]) { entry.cb(); if (entry.once) window.removeEventListener(name, entry.cb); } },
    async tick(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.time <= now) { timers.delete(id); timer.cb(); }
      await flush();
    } };
}

test("member readiness waits for document, fonts, visible images and two painted frames", async () => {
  const fonts = deferred(), image = deferred();
  const h = harness({ loaded: false, fonts: fonts.promise,
    image: { decode: () => image.promise, src: "https://example.test/club/icon.webp", getClientRects: () => [1], getBoundingClientRect: () => ({ top: 100 }) } });
  await flush();
  assert.equal(h.content.hidden, false);
  assert.equal(h.header.attributes.has("inert"), true);
  let done = false;
  const pending = h.api.ready().then((result) => { done = result; });
  await h.tick(1000);
  assert.equal(done, false);
  h.emit("load"); await flush();
  assert.equal(h.frames, 0);
  fonts.resolve(); await flush();
  assert.equal(h.api.active, true);
  image.resolve(); await pending;
  assert.equal(done, true);
  assert.equal(h.frames, 2);
  assert.equal(h.classes.size, 0);
  assert.equal(h.header.attributes.has("inert"), false);
  assert.equal(h.main.attributes.has("inert"), true, "auth retains ownership of the protected main element");
});

test("minimum branding duration never dismisses a splash before readiness, even after the watchdog", async () => {
  const h = harness(); await flush();
  await h.tick(15000);
  assert.equal(h.api.active, true);
  assert.match(h.status.textContent, /weiter warten/);
  assert.equal(h.retry.hidden, false);
  assert.equal(await h.api.ready(), true);
  const fast = harness(); await flush();
  const pending = fast.api.ready(); await flush();
  await fast.tick(649); assert.equal(fast.api.active, true);
  await fast.tick(1); assert.equal(await pending, true);
  assert.equal(fast.api.active, false);
});

test("old account readiness and superseded operations cannot expose the member page", async () => {
  const h = harness(); await flush();
  let current = true;
  const old = h.api.ready(() => current); await flush();
  current = false;
  await h.tick(650); assert.equal(await old, false);
  assert.equal(h.api.active, true);
  const fonts = deferred(), switched = harness({ fonts: fonts.promise }); await flush();
  const stale = switched.api.ready();
  switched.api.hold(); fonts.resolve(); await flush(); await switched.tick(650);
  assert.equal(await stale, false);
  assert.equal(switched.api.active, true);
  assert.equal(await switched.api.ready(), true);
});

test("errors keep the logo and retry preserves repository paths, query parameters and hashes", async () => {
  const h = harness(); await flush();
  h.api.fail();
  assert.equal(h.api.active, true);
  assert.equal(h.status.hidden, false);
  assert.match(h.status.textContent, /erneut/);
  await h.tick(20000);
  assert.match(h.status.textContent, /nicht abgeschlossen/, "a slow-load hint must not replace a known failure");
  h.retry.events.click();
  assert.deepEqual(h.redirects, ["https://example.test/club/app.html?keep=yes&appLaunch=1#profile"]);
  h.emit("pagehide");
  assert.equal(h.api.active, false);
  assert.equal(h.header.attributes.has("inert"), false);
  assert.equal(h.timers.size, 0);
});

test("ordinary navigation skips the splash and never waits for assets", async () => {
  const h = harness({ active: false, loaded: false, fonts: deferred().promise });
  assert.equal(await h.api.ready(), true);
  assert.equal(await h.api.ready(() => false), false);
  assert.equal(h.frames, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.header.attributes.has("inert"), false);
});

test("a slow logo can appear later without holding all branding text indefinitely", async () => {
  const logo = deferred(), h = harness({ logo: logo.promise });
  await h.tick(250);
  assert.equal(h.content.hidden, false);
  assert.equal(h.mark.style.visibility, "hidden");
  logo.resolve(); await flush();
  assert.equal(h.mark.style.visibility, "");
  h.emit("pagehide");
});

test("one-use splash handoff is consumed without changing install identities or other URL state", () => {
  for (const file of ["app.html", "index.html"]) {
    const script = read(file).match(/<script>\s*([\s\S]*?)<\/script>/)[1];
    const location = new URL(`https://example.test/club/${file}?keep=yes&appLaunch=1#profile`);
    const classes = new Set(), changes = [];
    const classList = { add: (name) => classes.add(name), contains: (name) => classes.has(name) };
    const window = { location, navigator: {}, addEventListener() {}, history: {
      state: { existing: true }, replaceState: (...args) => changes.push(args) } };
    vm.runInNewContext(script, { window, URL, document: { documentElement: { classList }, referrer: "" } });
    assert.equal(classes.has("app-launching"), true, file);
    assert.deepEqual(changes, [[window.history.state, "", `https://example.test/club/${file}?keep=yes#profile`]]);
  }
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.id, "./");
});
