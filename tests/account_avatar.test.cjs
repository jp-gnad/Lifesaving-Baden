const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { create } = require("../assets/js/account-avatar-cache.js");
const imageA = "data:image/png;base64,AAAA";
const imageB = "data:image/png;base64,BBBB";
const user = { uid: "a", photoURL: "https://example.test/a.png", displayName: "Anna Baden" };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), values };
}

test("the next page restores the actual image bytes synchronously and makes no image request for an unchanged photo", async () => {
  const shared = storage(); let requests = 0;
  const loadImage = async () => { requests += 1; return imageA; };
  const first = create({ getStorage: () => shared, loadImage });
  assert.equal(requests, 0, "factory creation has no loading or storage effects");
  await first.sync(user, "AB");
  const next = create({ getStorage: () => shared, loadImage });
  assert.equal(next.restore().image, imageA);
  const result = next.sync(user, "AB");
  assert.equal(next.read().image, imageA, "preview is present before the promise settles");
  await result;
  assert.equal(requests, 1);
  const persisted = [...shared.values.values()].join("");
  assert.doesNotMatch(persisted, /role|token|email|password/i);
});

test("a changed photo keeps the previous image until its replacement finishes, and removal is immediate", async () => {
  const gate = deferred(); let calls = 0;
  const cache = create({ loadImage: () => ++calls === 1 ? Promise.resolve(imageA) : gate.promise });
  await cache.sync(user, "AB");
  const pending = cache.sync({ ...user, photoURL: "https://example.test/new.png" }, "AB");
  assert.equal(cache.read().image, imageA);
  gate.resolve(imageB); await pending;
  assert.equal(cache.read().image, imageB);
  await cache.sync({ ...user, photoURL: null }, "AB");
  assert.equal(cache.read().image, "");
  assert.equal(calls, 2);
});

test("a same-URL refresh runs only when due and keeps the image visible on network failure", async () => {
  let now = 100, calls = 0;
  const cache = create({ now: () => now, refreshMs: 1000,
    loadImage: async () => { calls += 1; if (calls === 2) throw new Error("offline"); return calls === 1 ? imageA : imageB; } });
  await cache.sync(user, "AB"); now = 1099;
  await cache.sync(user, "AB"); assert.equal(calls, 1);
  now = 1100;
  const refresh = cache.sync(user, "AB");
  assert.equal(cache.read().image, imageA);
  await refresh; assert.equal(cache.read().image, imageA);
  await cache.sync(user, "AB"); assert.equal(cache.read().image, imageB);
});

test("simultaneous header/dialog refreshes share one download, and the latest initials survive it", async () => {
  const gate = deferred(); let calls = 0;
  const cache = create({ loadImage: () => { calls += 1; return gate.promise; } });
  const first = cache.sync(user, "AB"), second = cache.sync(user, "AC");
  assert.equal(first, second);
  await Promise.resolve(); assert.equal(calls, 1);
  gate.resolve(imageA); await first;
  assert.equal(cache.read().initials, "AC");
});

test("account switches, signout and URL changes reject late downloads from the old identity", async () => {
  for (const action of ["switch", "signout", "url"]) {
    const gate = deferred(), shared = storage(); let calls = 0;
    const cache = create({ getStorage: () => shared, loadImage: () => ++calls === 1 ? gate.promise : Promise.resolve(imageB) });
    const old = cache.sync(user, "AB"); await Promise.resolve();
    if (action === "switch") {
      const next = cache.sync({ uid: "b", photoURL: "https://example.test/b.png" }, "BB");
      assert.equal(cache.read().image, "", "another account never inherits the old image");
      await next;
    } else if (action === "signout") cache.clear();
    else await cache.sync({ ...user, photoURL: "https://example.test/new.png" }, "AB");
    gate.resolve(imageA); await old;
    if (action === "signout") {
      assert.equal(cache.read(), null); assert.equal(shared.values.size, 0);
    } else {
      assert.equal(cache.read().image, imageB);
      assert.equal(cache.read().uid, action === "switch" ? "b" : "a");
    }
  }
});

test("blocked storage, corrupt entries and unsafe or oversized image data do not break account display", async () => {
  const cache = create({ getStorage() { throw new Error("blocked"); }, loadImage: async () => imageA });
  assert.equal(cache.restore(), null);
  await cache.sync(user, "AB"); assert.equal(cache.read().image, imageA); cache.clear();
  for (const invalid of ["javascript:alert(1)", "data:image/svg+xml;base64,AAAA", "data:image/png;base64," + "A".repeat(350_000)]) {
    const unsafe = create({ loadImage: async () => invalid });
    await unsafe.sync(user, "AB"); assert.equal(unsafe.read().image, "");
  }
  const corrupt = storage(); corrupt.setItem("lifesaving-baden:account-avatar:v1", "{broken");
  assert.equal(create({ getStorage: () => corrupt }).restore(), null);
});

function element() {
  const classes = new Set(); let source = "", assignments = 0;
  return { textContent: "", hidden: false,
    classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) },
    getAttribute: (name) => name === "src" ? source : null,
    removeAttribute(name) { if (name === "src") source = ""; },
    set src(value) { source = value; assignments += 1; }, get src() { return source; }, get assignments() { return assignments; } };
}
function page(shared, authUser, browser = {}) {
  const small = element(), large = element(), initials = element(), largeInitials = element(), body = element(), preview = element();
  const selectors = { "[data-account-photo-small]": [small], "[data-account-photo-large]": [large],
    "[data-account-initials-small]": [initials], "[data-account-initials-large]": [largeInitials], "[data-account-avatar-preview]": [preview] };
  const auth = { currentUser: authUser }, events = {};
  const window = { LifesavingAccountAvatarCache: { create }, sessionStorage: shared, setTimeout, clearTimeout,
    firebase: { apps: [{}], auth: () => auth }, addEventListener(name, fn) { events[name] = fn; } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../assets/js/account-avatar.js"), "utf8"), {
    window, document: { body, querySelectorAll: (selector) => selectors[selector] || [] },
    ...browser,
  });
  return { api: window.LifesavingAccountAvatar, small, large, initials, largeInitials, body, preview, auth, events };
}

test("every page paints the cached header and dialog before Firebase, without reassigning an unchanged image", async () => {
  const shared = storage();
  await create({ getStorage: () => shared, loadImage: async () => imageA }).sync(user, "AB");
  const next = page(shared, user);
  assert.equal(next.small.src, imageA); assert.equal(next.large.src, imageA);
  assert.equal(next.body.classList.contains("account-avatar-ready"), true);
  assert.equal(next.initials.hidden, true); assert.equal(next.small.hidden, false);
  await next.api.setUser(user, "AB"); next.api.render(); next.api.render();
  assert.equal(next.small.assignments, 1); assert.equal(next.large.assignments, 1);
  next.auth.currentUser = null; await next.api.setUser(null);
  assert.equal(next.small.src, ""); assert.equal(next.small.hidden, true);
  assert.equal(next.initials.hidden, false); assert.equal(next.preview.hidden, true);
});

test("stale page callbacks cannot restore an earlier account and history restoration reconciles signout", async () => {
  const shared = storage();
  await create({ getStorage: () => shared, loadImage: async () => imageA }).sync(user, "AB");
  const next = page(shared, user);
  next.auth.currentUser = { uid: "b", photoURL: null, displayName: "Bob Baden" };
  await next.api.setUser(next.auth.currentUser);
  await next.api.setUser(user, "AB");
  assert.equal(next.api.snapshot().uid, "b"); assert.equal(next.small.src, "");
  next.auth.currentUser = null; next.events.pageshow({ persisted: true });
  assert.equal(next.api.snapshot(), null);
});

test("the browser loader saves decoded image bytes, then the next page renders them without fetching", async () => {
  const shared = storage(), decoded = deferred(); let requests = 0;
  const browser = {
    AbortController,
    async fetch(url, options) {
      requests += 1; assert.equal(url, user.photoURL);
      assert.equal(options.credentials, "omit");
      return { ok: true, async blob() { return { type: "image/png", size: 3 }; } };
    },
    FileReader: class { readAsDataURL() { this.result = imageA; queueMicrotask(() => this.onload()); } },
    Image: class { set src(value) { queueMicrotask(() => this.onload()); } decode() { return decoded.promise; } },
  };
  const first = page(shared, user, browser);
  const pending = first.api.setUser(user, "AB");
  await new Promise(setImmediate);
  assert.equal(first.small.hidden, true, "an undecoded image does not replace the initials");
  decoded.resolve(); await pending;
  assert.equal(first.small.src, imageA);
  const second = page(shared, user, browser);
  assert.equal(second.small.src, imageA);
  await second.api.setUser(user, "AB");
  assert.equal(requests, 1);
});

test("the timer keeps the same header and avatar elements through account-context refreshes", () => {
  let headerWrites = 0, dialogWrites = 0;
  const trigger = { setAttribute(name, value) { this[name] = value; } }, attention = {};
  const control = { dataset: {}, set innerHTML(value) { headerWrites += 1; },
    querySelector: (selector) => selector === "[data-timer-account-open]" ? trigger : attention };
  const fields = new Map();
  const dialog = { querySelector(selector) {
    if (!fields.has(selector)) fields.set(selector, { classList: { toggle() {} }, set innerHTML(value) { dialogWrites += 1; } });
    return fields.get(selector);
  } };
  const context = { currentTimerAuth: {}, timerAccountControl: control, timerAccountDialog: dialog, timerFooterPortalLink: null,
    window: { LifesavingAccountAvatar: { snapshot: () => ({ uid: user.uid, image: imageA }), setUser() {}, render() {} } },
    document: { querySelector: () => null }, escapeHtml: (text) => text, personInitials: () => "AB" };
  const code = fs.readFileSync(require.resolve("../timer/app.js"), "utf8");
  vm.createContext(context);
  vm.runInContext(code.slice(code.indexOf("function timerAccountName("), code.indexOf("async function refreshTimerAccount(")), context);
  const auth = { user, authenticated: true, accountName: "Anna Baden", role: "admin" };
  context.renderTimerAccount(auth);
  context.renderTimerAccount({ ...auth, accountName: "Anna Neu", accountNeedsAttention: true });
  assert.equal(headerWrites, 1); assert.equal(dialogWrites, 0);
  assert.match(trigger["aria-label"], /Anna Neu/); assert.equal(attention.hidden, false);
});
