const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = (name) => fs.readFileSync(path.join(root, name), "utf8");
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const localStore = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

function harness({ url = "https://example.test/club/login.html", user = null, stored = { role: "sportler" }, read, token, transactionData } = {}) {
  const counts = { persistence: 0, reads: 0, tokens: [], writes: [], delays: [], redirects: [], redirectResults: 0, redirectStarts: 0, warnings: [], events: [] };
  const callbacks = {};
  const elements = new Map();
  const storage = new Map();
  function element(key) {
    if (!elements.has(key)) elements.set(key, {
      textContent: "", innerHTML: "button", dataset: {}, disabled: false, hidden: false,
      handlers: {}, fields: {}, classList: { toggle() {} },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      querySelector() { return element(`${key}:button`); },
      reset() { this.wasReset = true; },
    });
    return elements.get(key);
  }
  const ref = { async get(options) {
    counts.reads += 1;
    if (read) return read(options, counts.reads);
    return { exists: stored !== null, data: () => stored };
  }, async set(data) { counts.writes.push(data); } };
  const db = {
    collection() { return { doc: () => ref }; },
    async enablePersistence() {},
    async runTransaction(fn) {
      return fn({
        async get() { return { exists: transactionData !== undefined, data: () => transactionData }; },
        set(_, data) { counts.writes.push(data); },
      });
    },
  };
  const auth = {
    currentUser: user,
    async setPersistence() { counts.persistence += 1; },
    onAuthStateChanged(fn) { callbacks.auth = fn; },
    async signOut() { this.currentUser = null; callbacks.auth?.(null); },
    async signInWithEmailAndPassword() { callbacks.auth?.(this.currentUser); return { user: this.currentUser }; },
    async signInWithPopup() { callbacks.auth?.(this.currentUser); return { user: this.currentUser }; },
    async signInWithRedirect() { counts.redirectStarts += 1; },
    async getRedirectResult() { counts.redirectResults += 1; return { user: null }; },
    async createUserWithEmailAndPassword() { callbacks.auth?.(this.currentUser); return { user: this.currentUser }; },
    async sendPasswordResetEmail(email, options) { counts.reset = { email, options }; },
  };
  function prepareUser(value) {
    value.providerData ??= [{ providerId: "password" }];
    value.reload ??= async () => {};
    value.getIdTokenResult ??= async (force) => { counts.tokens.push(force); return token ? token(force) : { claims: {} }; };
    value.updateProfile ??= async (details) => Object.assign(value, details);
    value.sendEmailVerification ??= async (options) => { counts.verification = options; };
    return value;
  }
  if (user) prepareUser(user);
  const firebaseAuth = () => auth;
  firebaseAuth.Auth = { Persistence: { LOCAL: "local" } };
  firebaseAuth.GoogleAuthProvider = class { setCustomParameters() {} };
  const firestore = () => db;
  firestore.FieldValue = { serverTimestamp: () => "timestamp" };
  const location = new URL(url);
  Object.defineProperty(location, "href", {
    get: () => url,
    set: (value) => counts.redirects.push(value),
  });
  location.replace = (value) => counts.redirects.push(value);
  const timerSegment = location.pathname.indexOf("/timer/");
  const appPath = timerSegment >= 0 ? location.pathname.slice(0, timerSegment + 1) : location.pathname.slice(0, location.pathname.lastIndexOf("/") + 1);
  const document = {
    currentScript: { src: new URL(`${appPath}assets/js/auth-core.js?v=test`, location.origin).href },
    body: { dataset: { page: "login" } }, visibilityState: "visible",
    querySelector: element,
    querySelectorAll: () => [],
    addEventListener(type, fn) { callbacks[type] = fn; },
  };
  const window = {
    location, isFirebaseConfigured: true,
    firebaseConfig: { authDomain: "lifesaving-baden.firebaseapp.com" },
    firebase: { apps: [{}], auth: firebaseAuth, firestore },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    setTimeout(fn, delay) { counts.delays.push(delay); queueMicrotask(fn); },
    addEventListener(type, fn) { callbacks[type] = fn; },
    dispatchEvent(event) { counts.events.push(event); },
  };
  const context = vm.createContext({ window, document, URL, URLSearchParams,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    console: { warn(...args) { counts.warnings.push(args); } }, FormData: class {
    constructor(form) { this.form = form; }
    get(name) { return this.form.fields[name]; }
  } });
  vm.runInContext(source("assets/js/auth-core.js"), context);
  return { core: window.LifesavingAuth, auth, window, document, context, counts, callbacks, element, prepareUser,
    login() { vm.runInContext(source("assets/js/login.js"), context); },
    submit: (form) => element(`[data-auth-form="${form}"]`).handlers.submit({ preventDefault() {} }),
  };
}

function directGoogleHarness(options = {}) {
  const h = harness({ url: "https://jp-gnad.github.io/Lifesaving-Baden/login.html?returnTo=timer%2F%23%2Fevent%2F42", ...options });
  h.window.navigator = { standalone: true };
  h.window.googleSignInClientId = "public-client.apps.googleusercontent.com";
  h.window.localStorage = localStore();
  const identity = { initializations: [], renders: [], scripts: [], timers: new Map(), credentials: [] };
  h.window.google = { accounts: { id: {
    initialize(config) { identity.initializations.push(config); },
    renderButton(host, config) { identity.renders.push({ host, config }); },
  } } };
  h.window.firebase.auth.GoogleAuthProvider.credential = (idToken) => ({ idToken });
  h.auth.signInWithPopup = () => { throw new Error("Firebase popup must not be used by direct Google sign-in"); };
  h.auth.signInWithCredential = async (credential) => {
    identity.credentials.push(credential);
    const user = h.prepareUser({ uid: "existing-admin", providerData: [{ providerId: "google.com" }] });
    h.auth.currentUser = user;
    h.callbacks.auth(user);
    return { user };
  };
  h.document.createElement = () => {
    const script = h.element(`script-${identity.scripts.length}`);
    script.remove = () => { script.removed = true; };
    return script;
  };
  h.document.head = { appendChild(script) { identity.scripts.push(script); } };
  let timerSequence = 0;
  h.window.setTimeout = (callback, delay) => {
    const id = ++timerSequence;
    if (delay === 15000) identity.timers.set(id, { callback, delay });
    else { h.counts.delays.push(delay); queueMicrotask(callback); }
    return id;
  };
  h.window.requestAnimationFrame = (callback) => queueMicrotask(callback);
  h.window.clearTimeout = (id) => identity.timers.delete(id);
  identity.click = () => identity.renders.at(-1).config.click_listener();
  identity.receive = (response) => identity.initializations.at(-1).callback(response);
  return { ...h, identity };
}

test("session persistence and overlapping user reloads run once", async () => {
  const gate = deferred();
  let reloads = 0;
  const h = harness({ user: { uid: "u", reload: () => { reloads += 1; return gate.promise; } } });
  await Promise.all([h.core.ensureLocalAuthPersistence(h.auth), h.core.ensureLocalAuthPersistence(h.auth)]);
  const first = h.core.reloadUser(h.auth.currentUser);
  const second = h.core.reloadUser(h.auth.currentUser);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(h.counts.persistence, 1);
  assert.equal(reloads, 1);
});

test("temporary errors retry at most three times, permanent errors stop immediately", async () => {
  for (const [code, attempts] of [["auth/network-request-failed", 3], ["unavailable", 3], ["permission-denied", 1], ["auth/invalid-credential", 1]]) {
    const h = harness();
    let calls = 0;
    await assert.rejects(h.core.withRetry(async () => { calls += 1; throw { code }; }));
    assert.equal(calls, attempts, code);
    assert.equal(h.counts.delays.length, attempts - 1);
  }
});

test("temporary errors can recover without exhausting retries", async () => {
  const h = harness();
  let calls = 0;
  const value = await h.core.withRetry(async () => { if (++calls < 2) throw { code: "unavailable" }; return "ready"; });
  assert.equal(value, "ready");
  assert.equal(calls, 2);
});

test("shared roles accept claims and stored role aliases consistently", () => {
  const h = harness();
  for (const [data, claims, expected] of [
    [{ role: "ADMIN" }, {}, "Admin"], [{}, { isAdmin: true }, "Admin"],
    [{ role: "organisator" }, {}, "Organisator"], [{}, { isOrganizer: true }, "Organisator"],
    [{ kader: true }, {}, "Kader-Sportler"], [{}, { isKaderAthlete: true }, "Kader-Sportler"],
    [{ role: "kadersportler" }, {}, "Kader-Sportler"], [{}, {}, "Sportler"],
  ]) assert.equal(h.core.getAccountRole(data, claims).label, expected);
  assert.equal(h.core.getAccountRole({ role: "admin" }, {}).hasKaderAccess, true);
});

test("unverified password accounts are blocked while verified and Google accounts can continue", () => {
  const h = harness();
  assert.equal(h.core.hasVerifiedAccess(null), false);
  assert.equal(h.core.hasVerifiedAccess({ emailVerified: false, providerData: [{ providerId: "password" }] }), false);
  assert.equal(h.core.hasVerifiedAccess({ emailVerified: true }), true);
  assert.equal(h.core.hasVerifiedAccess({ providerData: [{ providerId: "google.com" }] }), true);
});

test("return links preserve timer routes under a project path and reject external targets and login loops", () => {
  for (const value of ["timer/#/event/42", "/club/timer/?view=all#/results/42"]) {
    const h = harness({ url: `https://example.test/club/login.html?returnTo=${encodeURIComponent(value)}` });
    h.core.redirectToApp();
    assert.equal(h.counts.redirects[0], new URL(value, "https://example.test/club/login.html").href);
    assert.equal(new URL(h.core.getVerificationRedirectUrl()).searchParams.get("returnTo"), h.counts.redirects[0]);
  }
  for (const value of ["https://attacker.test/", "//attacker.test/", "javascript:alert(1)", "/club/login.html", "/club/timer/login.html"]) {
    const h = harness();
    assert.equal(h.core.getSafeReturnUrl(value).href, "https://example.test/club/app.html");
  }
});

test("parallel auth events and email submission redirect once without any Firestore access", async () => {
  const gate = deferred();
  let reloads = 0;
  const h = harness({ user: { uid: "u", emailVerified: true, reload: () => { reloads += 1; return gate.promise; } } });
  delete h.window.firebase.firestore;
  h.login();
  h.callbacks.auth(h.auth.currentUser);
  const submitted = h.submit("login");
  gate.resolve();
  await submitted;
  assert.equal(reloads, 1);
  assert.equal(h.counts.reads, 0);
  assert.deepEqual(h.counts.redirects, ["https://example.test/club/app.html"]);
});

test("an unverified account can complete email verification after returning to the page", async () => {
  const h = harness({ user: { uid: "u", emailVerified: false } });
  h.login();
  await h.submit("login");
  assert.equal(h.counts.redirects.length, 0);
  assert.match(h.element('[data-form-message="login"]').textContent, /bestätige/);
  h.auth.currentUser.emailVerified = true;
  h.callbacks.visibilitychange();
  await new Promise(setImmediate);
  assert.equal(h.counts.redirects.length, 1);
});

test("logout during an outstanding login reload prevents stale redirection", async () => {
  const gate = deferred();
  const h = harness({ user: { uid: "u", emailVerified: true, reload: () => gate.promise } });
  h.login();
  const submitted = h.submit("login");
  await new Promise(setImmediate);
  h.auth.currentUser = null;
  h.callbacks.auth(null);
  gate.resolve();
  await submitted;
  assert.equal(h.counts.redirects.length, 0);
});

test("Google uses the same login flow and returns to the exact timer event", async () => {
  const h = harness({ url: "https://example.test/club/login.html?returnTo=timer%2F%23%2Fevent%2F42", user: { uid: "u", providerData: [{ providerId: "google.com" }] } });
  h.login();
  await h.element("[data-google-login]").handlers.click();
  assert.deepEqual(h.counts.redirects, ["https://example.test/club/timer/#/event/42"]);
  assert.equal(h.counts.reads, 0);
});

test("Google auth events complete the login even while the popup promise is still pending", async () => {
  const gate = deferred();
  const h = harness();
  const user = h.prepareUser({ uid: "google", providerData: [{ providerId: "google.com" }] });
  h.auth.signInWithPopup = () => gate.promise;
  h.login();
  const clicked = h.element("[data-google-login]").handlers.click();
  await new Promise(setImmediate);
  h.auth.currentUser = user;
  h.callbacks.auth(user);
  await new Promise(setImmediate);
  const redirectsBeforePopupSettled = h.counts.redirects.length;
  gate.resolve({ user });
  await clicked;
  assert.equal(redirectsBeforePopupSettled, 1);
  assert.equal(h.counts.redirects.length, 1);
});

test("returning to the app recovers a Google session without waiting for the popup result", async () => {
  const gate = deferred();
  const h = harness();
  const user = h.prepareUser({ uid: "google", providerData: [{ providerId: "google.com" }] });
  h.auth.signInWithPopup = () => gate.promise;
  h.login();
  const clicked = h.element("[data-google-login]").handlers.click();
  await new Promise(setImmediate);
  h.auth.currentUser = user;
  h.callbacks.visibilitychange();
  await new Promise(setImmediate);
  const redirectsBeforePopupSettled = h.counts.redirects.length;
  gate.resolve({ user });
  await clicked;
  assert.equal(redirectsBeforePopupSettled, 1);
  assert.equal(h.counts.redirects.length, 1);
});

test("a closed-popup error still completes an already delivered Google session", async () => {
  const h = harness();
  h.auth.signInWithPopup = async () => {
    h.auth.currentUser = h.prepareUser({ uid: "google", providerData: [{ providerId: "google.com" }] });
    throw { code: "auth/popup-closed-by-user" };
  };
  h.login();
  await h.element("[data-google-login]").handlers.click();
  assert.equal(h.counts.redirects.length, 1);
  assert.equal(h.element('[data-form-message="login"]').textContent, "");
  assert.equal(h.element("[data-google-login]").disabled, true);
});

test("a closed popup with no session shows its safe error code and allows retrying", async () => {
  const h = harness();
  h.window.navigator = { standalone: true };
  h.auth.signInWithPopup = async () => { throw { code: "auth/popup-closed-by-user", message: "sensitive-details" }; };
  h.login();
  await h.element("[data-google-login]").handlers.click();
  assert.equal(h.counts.redirects.length, 0);
  assert.equal(h.element("[data-google-login]").disabled, false);
  assert.match(h.element('[data-form-message="login"]').textContent, /Google-Fenster/);
  const details = h.element("[data-login-error-details]");
  assert.equal(details.hidden, false);
  assert.match(details.textContent, /auth\/popup-closed-by-user/);
  assert.match(details.textContent, /Web-App/);
  assert.doesNotMatch(details.textContent, /sensitive-details/);
});

test("the Google popup is opened synchronously from the click after persistence preparation", async () => {
  const h = harness({ user: { uid: "google", providerData: [{ providerId: "google.com" }] } });
  let opened = false;
  h.auth.signInWithPopup = () => { opened = true; return Promise.resolve({ user: h.auth.currentUser }); };
  h.login();
  await new Promise(setImmediate);
  assert.equal(h.element("[data-google-login]").disabled, false);
  const clicked = h.element("[data-google-login]").handlers.click();
  assert.equal(opened, true);
  await clicked;
});

test("a page restart during Google login reports a missing app session without storing account details", async () => {
  const h = harness();
  h.window.sessionStorage.setItem("lifesaving-baden:google-login-started", String(Date.now()));
  h.login();
  h.callbacks.auth(null);
  await new Promise(setImmediate);
  assert.match(h.element("[data-login-error-details]").textContent, /app\/google-session-missing/);
  assert.equal(h.element("[data-google-login]").disabled, false);
  assert.equal(h.window.sessionStorage.getItem("lifesaving-baden:google-login-started"), undefined);
});

test("a page restart restores an existing Google session and redirects once", async () => {
  const h = harness({ user: { uid: "google", providerData: [{ providerId: "google.com" }] } });
  h.window.sessionStorage.setItem("lifesaving-baden:google-login-started", String(Date.now()));
  h.login();
  h.callbacks.auth(h.auth.currentUser);
  h.callbacks.pageshow();
  await new Promise(setImmediate);
  assert.equal(h.counts.redirects.length, 1);
  assert.equal(h.window.sessionStorage.getItem("lifesaving-baden:google-login-started"), undefined);
});

test("Google errors do not erase local storage or sign out a valid account", async () => {
  const h = harness();
  h.window.sessionStorage.setItem("unrelated", "keep");
  let signOuts = 0;
  h.auth.signOut = async () => { signOuts += 1; };
  h.auth.signInWithPopup = async () => { throw { code: "auth/network-request-failed" }; };
  h.login();
  await h.element("[data-google-login]").handlers.click();
  assert.equal(signOuts, 0);
  assert.equal(h.window.sessionStorage.getItem("unrelated"), "keep");
});

test("login help exposes pending Google events without collecting account details or tokens", async () => {
  const gate = deferred();
  const h = harness();
  h.window.firebase.SDK_VERSION = "12.19.0";
  h.window.navigator = { standalone: true };
  h.auth.signInWithPopup = () => gate.promise;
  h.login();
  const clicked = h.element("[data-google-login]").handlers.click();
  h.callbacks.visibilitychange();
  await new Promise(setImmediate);
  h.element("[data-login-diagnostics]").handlers.toggle();
  const output = h.element("[data-login-diagnostics-output]").textContent;
  gate.resolve({ user: null });
  await clicked;
  assert.match(output, /Firebase-Version: 12\.19\.0/);
  assert.match(output, /Modus: Web-App/);
  assert.match(output, /Firebase-Sitzung: keine/);
  assert.match(output, /Google-Anmeldung gestartet/);
  assert.doesNotMatch(output, /Google-Fenster hat ein Ergebnis geliefert/);
});

test("copying login help excludes the account identifier, email, and raw Firebase errors", async () => {
  const h = harness({ user: { uid: "private-uid", email: "private@example.test", emailVerified: false } });
  h.window.localStorage = localStore();
  let copied;
  h.window.navigator = { clipboard: { async writeText(text) { copied = text; } } };
  h.auth.signInWithPopup = async () => { throw { code: "auth/network-request-failed", message: "private-access-token" }; };
  h.login();
  await h.element("[data-google-login]").handlers.click();
  await h.element("[data-login-diagnostics-copy]").handlers.click();
  assert.match(copied, /auth\/network-request-failed/);
  assert.match(copied, /Firebase-Sitzung: vorhanden/);
  assert.doesNotMatch(copied, /private-uid|private@example\.test|private-access-token/);
  assert.doesNotMatch(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), /private-uid|private@example\.test|private-access-token/);
});

test("the diagnostic trace preserves the Google click across a page restart without sharing sessionStorage", async () => {
  const storage = localStore();
  const first = harness();
  first.window.localStorage = storage;
  const gate = deferred();
  first.auth.signInWithPopup = () => gate.promise;
  first.login();
  const clicked = first.element("[data-google-login]").handlers.click();
  await new Promise(setImmediate);
  const before = first.element("[data-login-diagnostics-output]").textContent;
  const second = harness();
  second.window.localStorage = storage;
  second.window.performance = { getEntriesByType: () => [{ type: "reload" }] };
  second.login();
  second.callbacks.auth(null);
  await new Promise(setImmediate);
  const after = second.element("[data-login-diagnostics-output]").textContent;
  gate.resolve({ user: null });
  await clicked;
  assert.match(before, /Lokaler Diagnoseverlauf: gespeichert/);
  assert.match(after, /Google-Anmeldung gestartet/);
  assert.match(after, /Navigationsart: reload/);
  assert.match(after, /Google-Startmarker bei Seitenstart: keiner/);
  const labels = new Set([...after.matchAll(/\[Seite ([a-z0-9]{8})\]/g)].map((match) => match[1]));
  assert.equal(labels.size, 2);
});

test("an isolated storage context cannot inherit the first window's Google trace", async () => {
  const first = harness();
  first.window.localStorage = localStore();
  const gate = deferred();
  first.auth.signInWithPopup = () => gate.promise;
  first.login();
  const clicked = first.element("[data-google-login]").handlers.click();
  const second = harness();
  second.window.localStorage = localStore();
  second.window.opener = {};
  second.login();
  await new Promise(setImmediate);
  const after = second.element("[data-login-diagnostics-output]").textContent;
  gate.resolve({ user: null });
  await clicked;
  assert.doesNotMatch(after, /Google-Anmeldung gestartet/);
  assert.match(after, /Fensteröffner: vorhanden/);
  assert.match(after, /Lokaler Diagnoseverlauf: gespeichert/);
});

test("blocked local trace storage does not block authentication", async () => {
  const h = harness({ user: { uid: "u", providerData: [{ providerId: "google.com" }] } });
  Object.defineProperty(h.window, "localStorage", { get() { throw new Error("blocked"); } });
  h.login();
  await h.element("[data-google-login]").handlers.click();
  assert.equal(h.counts.redirects.length, 1);
  assert.match(h.element("[data-login-diagnostics-output]").textContent, /nur aktuelle Seite/);
});

test("old and unrecognized trace data is discarded, including extra private fields", async () => {
  const h = harness();
  h.window.localStorage = localStore();
  const time = Date.now();
  h.window.localStorage.setItem("lifesaving-baden:login-trace-v1", JSON.stringify({ entries: [
    { id: "google", page: "abcdefgh", seq: 1, time: time - 11 * 60 * 1000 },
    { id: "private-account@example.test", page: "abcdefgh", seq: 2, time },
    { id: "start", page: "abcdefgh", seq: 3, time, message: "private-access-token" },
  ] }));
  h.login();
  await new Promise(setImmediate);
  const output = h.element("[data-login-diagnostics-output]").textContent;
  assert.doesNotMatch(output, /Google-Anmeldung gestartet|private-account|private-access-token/);
  assert.doesNotMatch(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), /private-account|private-access-token/);
});

test("login help identifies a persistence failure while keeping the login usable", async () => {
  const h = harness();
  h.auth.setPersistence = async () => { throw { code: "auth/web-storage-unsupported" }; };
  h.login();
  await new Promise(setImmediate);
  assert.match(h.element("[data-login-diagnostics-output]").textContent, /Sitzungsspeicher: nicht dauerhaft verfügbar/);
  assert.equal(h.element("[data-google-login]").disabled, false);
  assert.equal(await h.core.ensureLocalAuthPersistence(h.auth), false);
});

test("standalone sign-in uses a full redirect only when app and auth helper have the same origin", async () => {
  const h = harness({ url: "https://lifesaving-baden.firebaseapp.com/login.html?returnTo=%2Ftimer%2F%23%2Fevent%2F42" });
  h.window.navigator = { standalone: true };
  h.auth.signInWithPopup = () => { throw new Error("Popup must not be used on the same-origin standalone app"); };
  h.login();
  await new Promise(setImmediate);
  await h.element("[data-google-login]").handlers.click();
  assert.equal(h.counts.redirectStarts, 1);
  assert.equal(h.counts.redirectResults, 1);
  assert.ok(h.window.sessionStorage.getItem("lifesaving-baden:google-login-started"));
  assert.equal(h.element("[data-google-login]").disabled, true);
});

test("a new standalone page consumes the redirect result and returns to its original timer event", async () => {
  const h = harness({ url: "https://lifesaving-baden.firebaseapp.com/login.html?returnTo=%2Ftimer%2F%23%2Fevent%2F42" });
  h.window.navigator = { standalone: true };
  h.window.sessionStorage.setItem("lifesaving-baden:google-login-started", String(Date.now()));
  const user = h.prepareUser({ uid: "same-admin-uid", providerData: [{ providerId: "google.com" }] });
  h.auth.getRedirectResult = async () => {
    h.auth.currentUser = user;
    h.callbacks.auth(user);
    return { user };
  };
  h.login();
  h.callbacks.auth(null);
  h.callbacks.pageshow();
  await new Promise(setImmediate);
  assert.deepEqual(h.counts.redirects, ["https://lifesaving-baden.firebaseapp.com/timer/#/event/42"]);
  assert.equal(h.window.sessionStorage.getItem("lifesaving-baden:google-login-started"), undefined);
  assert.equal(h.counts.writes.length, 0);
});

test("a redirect failure is visible and allows a new attempt without a login loop", async () => {
  const h = harness({ url: "https://lifesaving-baden.firebaseapp.com/login.html" });
  h.window.navigator = { standalone: true };
  h.auth.getRedirectResult = async () => { throw { code: "auth/network-request-failed" }; };
  h.login();
  await new Promise(setImmediate);
  assert.equal(h.counts.redirectStarts, 0);
  assert.equal(h.counts.redirects.length, 0);
  assert.equal(h.element("[data-google-login]").disabled, false);
  assert.match(h.element("[data-login-error-details]").textContent, /auth\/network-request-failed/);
});

test("a redirect with no session reports the missing result after checking Firebase", async () => {
  const h = harness({ url: "https://lifesaving-baden.firebaseapp.com/login.html" });
  h.window.navigator = { standalone: true };
  h.window.sessionStorage.setItem("lifesaving-baden:google-login-started", String(Date.now()));
  h.login();
  h.callbacks.auth(null);
  await new Promise(setImmediate);
  assert.equal(h.counts.redirectResults, 1);
  assert.match(h.element("[data-login-error-details]").textContent, /app\/google-session-missing/);
  assert.equal(h.element("[data-google-login]").disabled, false);
});

test("cross-origin standalone installations keep the working popup path", async () => {
  const h = harness({ user: { uid: "google", providerData: [{ providerId: "google.com" }] } });
  h.window.navigator = { standalone: true };
  h.login();
  await h.element("[data-google-login]").handlers.click();
  assert.equal(h.counts.redirectStarts, 0);
  assert.equal(h.counts.redirectResults, 0);
  assert.equal(h.counts.redirects.length, 1);
});

test("direct Google sign-in exchanges the credential once, preserves the account and exact timer return, and logs no token", async () => {
  const h = directGoogleHarness();
  const privateToken = "private-google-id-token";
  h.login();
  await new Promise(setImmediate);
  assert.equal(h.identity.initializations.length, 1);
  assert.equal(h.identity.initializations[0].client_id, h.window.googleSignInClientId);
  assert.equal(h.identity.initializations[0].auto_select, false);
  assert.equal(h.identity.renders[0].config.theme, "filled_black");
  assert.equal(h.element("[data-google-login]").hidden, true);
  h.identity.click();
  const first = h.identity.receive({ credential: privateToken });
  const duplicate = h.identity.receive({ credential: privateToken });
  await Promise.all([first, duplicate]);
  assert.equal(h.identity.credentials.length, 1);
  assert.equal(h.identity.credentials[0].idToken, privateToken);
  assert.equal(h.auth.currentUser.uid, "existing-admin");
  assert.deepEqual(h.counts.redirects, ["https://jp-gnad.github.io/Lifesaving-Baden/timer/#/event/42"]);
  assert.equal(h.counts.reads, 0);
  assert.equal(h.counts.writes.length, 0);
  assert.equal(h.counts.redirectStarts, 0);
  const output = h.element("[data-login-diagnostics-output]").textContent;
  assert.match(output, /Google-Verfahren: Google direkt → Firebase/);
  assert.match(output, /Google-Anmeldenachweis empfangen/);
  assert.match(output, /Firebase hat die Google-Anmeldung übernommen/);
  assert.doesNotMatch(output, /private-google-id-token|existing-admin/);
  assert.doesNotMatch(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), /private-google-id-token|existing-admin/);
  assert.equal(h.window.sessionStorage.getItem("lifesaving-baden:google-login-started"), undefined);
});

test("direct sign-in is selected under a renamed GitHub project but not in Safari or the same-origin Firebase app", async () => {
  const renamed = directGoogleHarness({ url: "https://jp-gnad.github.io/Lifesaving-Test/login.html" });
  renamed.login();
  await new Promise(setImmediate);
  assert.equal(renamed.identity.initializations.length, 1);
  for (const url of ["https://jp-gnad.github.io/Lifesaving-Baden/login.html", "https://lifesaving-baden.firebaseapp.com/login.html"]) {
    const h = directGoogleHarness({ url });
    if (url.includes("github.io")) {
      h.window.navigator.standalone = false;
      let popups = 0;
      h.auth.signInWithPopup = async () => { popups += 1; return { user: null }; };
      h.login();
      await h.element("[data-google-login]").handlers.click();
      assert.equal(popups, 1);
    } else {
      h.login();
      await new Promise(setImmediate);
      await h.element("[data-google-login]").handlers.click();
      assert.equal(h.counts.redirectStarts, 1);
    }
    assert.equal(h.identity.initializations.length, 0);
    assert.equal(h.identity.scripts.length, 0);
  }
});

test("the direct Google button waits for persistence before it accepts credentials", async () => {
  const h = directGoogleHarness();
  const ready = deferred();
  h.auth.setPersistence = () => ready.promise;
  h.login();
  await new Promise(setImmediate);
  assert.equal(h.identity.renders.length, 0);
  assert.equal(h.element("[data-google-login]").disabled, true);
  ready.resolve();
  await new Promise(setImmediate);
  assert.equal(h.identity.renders.length, 1);
  h.identity.click();
  await h.identity.receive({ credential: "synthetic-token" });
  assert.equal(h.counts.redirects.length, 1);
});

test("a Google credential received in the background waits for visibility and the next frame before contacting Firebase", async () => {
  for (const returnEvent of ["visibilitychange", "pageshow"]) {
    const h = directGoogleHarness();
    const frames = [];
    h.window.requestAnimationFrame = (callback) => frames.push(callback);
    h.login();
    await new Promise(setImmediate);
    h.identity.click();
    h.document.visibilityState = "hidden";
    h.callbacks.visibilitychange();
    const received = h.identity.receive({ credential: "background-private-token" });
    await new Promise(setImmediate);
    assert.equal(h.identity.credentials.length, 0);
    assert.equal(frames.length, 0);
    assert.match(h.element("[data-login-diagnostics-output]").textContent, /App beim Google-Nachweis: ausgeblendet/);
    assert.match(h.element("[data-login-diagnostics-output]").textContent, /wartet auf die sichtbare App/);
    h.document.visibilityState = "visible";
    h.callbacks[returnEvent]();
    await new Promise(setImmediate);
    assert.equal(h.identity.credentials.length, 0);
    assert.equal(frames.length, 1);
    frames.shift()();
    await received;
    assert.equal(h.identity.credentials.length, 1);
    assert.equal(h.counts.redirects.length, 1);
    assert.doesNotMatch(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), /background-private-token/);
  }
});

test("the app becoming hidden again before the next frame postpones credential exchange", async () => {
  const h = directGoogleHarness();
  const frames = [];
  h.window.requestAnimationFrame = (callback) => frames.push(callback);
  h.login();
  await new Promise(setImmediate);
  h.identity.click();
  const received = h.identity.receive({ credential: "synthetic-token" });
  await new Promise(setImmediate);
  h.document.visibilityState = "hidden";
  frames.shift()();
  await new Promise(setImmediate);
  assert.equal(h.identity.credentials.length, 0);
  h.document.visibilityState = "visible";
  h.callbacks.visibilitychange();
  await new Promise(setImmediate);
  frames.shift()();
  await received;
  assert.equal(h.identity.credentials.length, 1);
});

test("a transient Google credential failure retries only after the app is visible and redirects once", async () => {
  const h = directGoogleHarness();
  const exchange = h.auth.signInWithCredential;
  let calls = 0;
  const credentials = [];
  h.auth.signInWithCredential = async (credential) => {
    calls += 1;
    credentials.push(credential);
    if (calls === 1) {
      h.document.visibilityState = "hidden";
      h.callbacks.visibilitychange();
      throw { code: "auth/network-request-failed", customData: { message: "TypeError: private-network-details" } };
    }
    return exchange(credential);
  };
  h.login();
  await new Promise(setImmediate);
  h.identity.click();
  const received = h.identity.receive({ credential: "synthetic-token" });
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(h.counts.redirects.length, 0);
  h.document.visibilityState = "visible";
  h.callbacks.visibilitychange();
  await received;
  assert.equal(calls, 2);
  assert.equal(credentials[0], credentials[1]);
  assert.deepEqual(h.counts.delays, [450]);
  assert.equal(h.counts.redirects.length, 1);
  assert.match(h.element("[data-login-diagnostics-output]").textContent, /nach Verbindungsfehler erneut versucht/);
  assert.match(h.element("[data-login-diagnostics-output]").textContent, /Browser-Fehlertyp: TypeError/);
  assert.doesNotMatch(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), /private-network-details/);
});

test("credential retries stop after three network failures and never repeat a permanent or internal error", async () => {
  for (const code of ["auth/network-request-failed", "auth/invalid-credential", "auth/unauthorized-domain", "auth/too-many-requests", "auth/internal-error"]) {
    const h = directGoogleHarness();
    let calls = 0;
    h.auth.signInWithCredential = async () => { calls += 1; throw { code }; };
    h.login();
    await new Promise(setImmediate);
    h.identity.click();
    await h.identity.receive({ credential: "synthetic-token" });
    assert.equal(calls, code === "auth/network-request-failed" ? 3 : 1, code);
    assert.equal(h.counts.delays.length, calls - 1);
    assert.equal(h.counts.redirects.length, 0);
    assert.equal(h.element("[data-google-identity]").hidden, false);
    assert.equal(h.window.sessionStorage.getItem("lifesaving-baden:google-login-started"), undefined);
  }
});

test("the complete background handoff and bounded retries remain diagnosable after another page starts", async () => {
  const first = directGoogleHarness();
  first.auth.signInWithCredential = async () => {
    throw { code: "auth/network-request-failed", customData: { message: "TypeError: private-token-in-url" } };
  };
  first.login();
  await new Promise(setImmediate);
  first.callbacks.pageshow();
  first.identity.click();
  first.document.visibilityState = "hidden";
  first.callbacks.visibilitychange();
  const received = first.identity.receive({ credential: "private-id-token" });
  await new Promise(setImmediate);
  first.document.visibilityState = "visible";
  first.callbacks.visibilitychange();
  await received;
  first.callbacks.pagehide();
  first.document.visibilityState = "hidden";
  first.callbacks.visibilitychange();
  const next = directGoogleHarness();
  next.window.localStorage = first.window.localStorage;
  next.login();
  next.callbacks.pageshow();
  next.callbacks.auth(null);
  await new Promise(setImmediate);
  const output = next.element("[data-login-diagnostics-output]").textContent;
  assert.match(output, /App beim Google-Nachweis: ausgeblendet/);
  assert.match(output, /wartet auf die sichtbare App/);
  assert.equal((output.match(/Firebase-Anmeldung mit Google-Nachweis gestartet/g) || []).length, 3);
  assert.equal((output.match(/nach Verbindungsfehler erneut versucht/g) || []).length, 2);
  assert.doesNotMatch(output, /private-token-in-url|private-id-token/);
  const entries = JSON.parse(next.window.localStorage.getItem("lifesaving-baden:login-trace-v1")).entries;
  assert.ok(entries.length <= 40);
});

test("a session completed while waiting for foreground is not replaced by a late Google credential", async () => {
  const h = directGoogleHarness();
  h.login();
  await new Promise(setImmediate);
  h.identity.click();
  h.document.visibilityState = "hidden";
  const received = h.identity.receive({ credential: "late-google-token" });
  await new Promise(setImmediate);
  h.auth.currentUser = h.prepareUser({ uid: "already-authenticated", emailVerified: true });
  h.callbacks.auth(h.auth.currentUser);
  await new Promise(setImmediate);
  assert.equal(h.counts.redirects.length, 1);
  h.document.visibilityState = "visible";
  h.callbacks.pageshow();
  await received;
  assert.equal(h.identity.credentials.length, 0);
  assert.equal(h.counts.redirects.length, 1);
});

test("a cancelled direct Google window allows retrying and does not lock password login or accept a late credential", async () => {
  const h = directGoogleHarness();
  h.login();
  await new Promise(setImmediate);
  h.identity.click();
  h.identity.click();
  assert.equal(h.element("[data-google-identity]").hidden, false);
  const passwordGate = deferred();
  h.auth.signInWithEmailAndPassword = () => passwordGate.promise;
  const passwordLogin = h.submit("login");
  await h.identity.receive({ credential: "late-token" });
  assert.equal(h.identity.credentials.length, 0);
  const user = h.prepareUser({ uid: "password-user", emailVerified: true });
  h.auth.currentUser = user;
  passwordGate.resolve({ user });
  await passwordLogin;
  assert.equal(h.counts.redirects.length, 1);
  await h.identity.receive({ credential: "later-token" });
  assert.equal(h.identity.credentials.length, 0);
});

test("a failed Firebase credential exchange offers another direct attempt and strips private error details", async () => {
  const h = directGoogleHarness();
  const exchange = h.auth.signInWithCredential;
  h.auth.signInWithCredential = async () => {
    throw { code: "auth/network-request-failed", message: "private-error-token", customData: { credential: "private-id-token" } };
  };
  h.login();
  await new Promise(setImmediate);
  h.identity.click();
  await h.identity.receive({ credential: "private-id-token" });
  assert.equal(h.counts.redirects.length, 0);
  assert.equal(h.element("[data-google-identity]").hidden, false);
  assert.equal(h.element("[data-google-login]").hidden, true);
  assert.match(h.element("[data-login-error-details]").textContent, /auth\/network-request-failed/);
  assert.doesNotMatch(h.element("[data-login-diagnostics-output]").textContent, /private-error-token|private-id-token/);
  assert.doesNotMatch(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), /private-error-token|private-id-token/);
  assert.equal(h.window.sessionStorage.getItem("lifesaving-baden:google-login-started"), undefined);
  h.auth.signInWithCredential = exchange;
  h.identity.click();
  await h.identity.receive({ credential: "retry-token" });
  assert.equal(h.counts.redirects.length, 1);
});

test("a missing Google credential is rejected before calling Firebase and the button remains usable", async () => {
  const h = directGoogleHarness();
  h.login();
  await new Promise(setImmediate);
  // A credential without a button click is not allowed to replace the current account.
  await h.identity.receive({ credential: "unsolicited-token" });
  assert.equal(h.identity.credentials.length, 0);
  h.identity.click();
  await h.identity.receive({});
  assert.equal(h.identity.credentials.length, 0);
  assert.match(h.element("[data-login-error-details]").textContent, /app\/google-credential-missing/);
  assert.equal(h.element("[data-google-identity]").hidden, false);
});

test("Google client loading is bounded, retryable, and does not lock the email forms", async () => {
  for (const failure of ["error", "timeout", "incomplete-load"]) {
    const h = directGoogleHarness();
    const google = h.window.google;
    delete h.window.google;
    h.login();
    await new Promise(setImmediate);
    const concurrent = h.element("[data-google-login]").handlers.click();
    assert.equal(h.identity.scripts.length, 1);
    assert.equal(h.identity.scripts[0].src, "https://accounts.google.com/gsi/client?hl=de");
    if (failure === "timeout") {
      const timer = [...h.identity.timers.values()][0];
      assert.equal(timer.delay, 15000);
      timer.callback();
    } else h.identity.scripts[0].handlers[failure === "error" ? "error" : "load"]();
    await concurrent;
    assert.equal(h.identity.scripts[0].removed, true);
    assert.equal(h.identity.timers.size, 0);
    assert.equal(h.element("[data-google-login]").disabled, false);
    assert.match(h.element("[data-login-error-details]").textContent, /app\/google-library-unavailable/);
    const retry = h.element("[data-google-login]").handlers.click();
    assert.equal(h.identity.scripts.length, 2);
    h.window.google = google;
    h.identity.scripts[1].handlers.load();
    await retry;
    assert.equal(h.identity.renders.length, 1);
    assert.equal(h.identity.timers.size, 0);
    assert.equal(h.element("[data-google-identity]").hidden, false);
    assert.equal(h.element("[data-login-error-details]").hidden, true);
  }
});

test("registration preserves first/last names for deferred initialization without a database SDK", async () => {
  const h = harness({ user: { uid: "new", emailVerified: false } });
  delete h.window.firebase.firestore;
  h.login();
  h.element('[data-auth-form="register"]').fields = { firstName: "Anna Maria", lastName: "von Baden", email: "test@example.test", password: "synthetic-password" };
  await h.submit("register");
  assert.equal(h.auth.currentUser.displayName, "Anna Maria von Baden");
  assert.equal(h.counts.reads, 0);
  assert.equal(h.counts.redirects.length, 0);
  assert.equal(new URL(h.counts.verification.url).searchParams.get("verified"), "1");
  assert.match(h.element('[data-form-message="login"]').textContent, /Konto erstellt/);
});

test("password reset keeps the timer return target", async () => {
  const h = harness({ url: "https://example.test/club/login.html?returnTo=timer%2F%23%2F" });
  h.login();
  h.element('[data-auth-form="login"]').fields.email = "test@example.test";
  await h.element("[data-reset-password]").handlers.click();
  assert.equal(new URL(h.counts.reset.options.url).searchParams.get("returnTo"), "https://example.test/club/timer/#/");
});

test("new account documents preserve registration names and start with the sportler role", async () => {
  const h = harness({ user: { uid: "new", displayName: "Anna Maria von Baden" }, stored: null });
  h.core.rememberRegistrationName("new", { firstName: "Anna Maria", lastName: "von Baden", displayName: "Anna Maria von Baden" });
  const [first, second] = await Promise.all([h.core.loadUserContext(h.auth.currentUser), h.core.loadUserContext(h.auth.currentUser)]);
  assert.equal(first, second);
  assert.equal(h.counts.reads, 1);
  assert.equal(h.counts.writes.length, 1);
  assert.equal(first.userData.firstName, "Anna Maria");
  assert.equal(first.userData.lastName, "von Baden");
  assert.equal(first.userData.role, "sportler");
  assert.deepEqual(h.counts.tokens, [true]);
});

test("account creation never overwrites an existing role from another tab", async () => {
  const h = harness({ user: { uid: "u" }, stored: null, transactionData: { role: "admin" } });
  const context = await h.core.loadUserContext(h.auth.currentUser);
  assert.equal(context.userData.role, "admin");
  assert.equal(h.counts.writes.length, 0);
});

test("an unavailable server can fall back to an existing cached profile after bounded retries", async () => {
  const h = harness({ user: { uid: "u" }, read: (options) => {
    if (options?.source === "server") throw { code: "unavailable" };
    return { exists: true, data: () => ({ role: "kader" }) };
  } });
  const context = await h.core.loadUserContext(h.auth.currentUser);
  assert.equal(context.userData.role, "kader");
  assert.equal(h.counts.delays.length, 2);
  assert.equal(h.counts.reads, 4);
  assert.equal(h.counts.writes.length, 0);
});

test("permanent context failures do not retry or write profiles", async () => {
  const h = harness({ user: { uid: "u" }, read: () => { throw { code: "permission-denied" }; } });
  await assert.rejects(h.core.loadUserContext(h.auth.currentUser));
  assert.equal(h.counts.reads, 1);
  assert.equal(h.counts.writes.length, 0);
  assert.equal(h.counts.delays.length, 0);
});

test("an account switch during context loading rejects stale data", async () => {
  const gate = deferred();
  const h = harness({ user: { uid: "old" }, read: () => gate.promise });
  const pending = h.core.loadUserContext(h.auth.currentUser);
  h.auth.currentUser = h.prepareUser({ uid: "new" });
  gate.resolve({ exists: true, data: () => ({ role: "admin" }) });
  await assert.rejects(pending, { code: "auth/user-mismatch" });
  assert.equal(h.counts.writes.length, 0);
});

test("legacy timer login redirects to the shared login with its original event and flags", () => {
  const h = harness({ url: "https://example.test/club/timer/login.html?returnTo=%2Fclub%2Ftimer%2F%23%2Fevent%2F42&verified=1" });
  const html = source("timer/login.html");
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  vm.runInContext(inline, h.context);
  h.callbacks.DOMContentLoaded();
  const destination = new URL(h.counts.redirects[0]);
  assert.equal(destination.pathname, "/club/login.html");
  assert.equal(destination.searchParams.get("returnTo"), "https://example.test/club/timer/#/event/42");
  assert.equal(destination.searchParams.get("verified"), "1");
});

test("the member page initializes an existing account with one document read and one token request", async () => {
  const user = { uid: "u", email: "test@example.test", displayName: "Anna Baden", emailVerified: true };
  const stored = { uid: "u", email: user.email, displayName: user.displayName, firstName: "Anna", lastName: "Baden", emailVerified: true, providerIds: ["password"], role: "sportler" };
  const h = harness({ url: "https://example.test/club/app.html", user, stored });
  h.document.body.dataset.page = "app";
  h.document.body.classList = { remove() {} };
  const error = h.element("[data-auth-error]");
  error.hidden = true;
  h.document.querySelector = (selector) => selector === "[data-auth-error]" ? error : null;
  vm.runInContext(source("assets/js/auth.js"), h.context);
  h.callbacks.auth(user);
  await new Promise(setImmediate);
  assert.equal(error.hidden, true, error.textContent);
  assert.equal(h.counts.warnings.length, 0);
  assert.equal(h.counts.reads, 1);
  assert.deepEqual(h.counts.tokens, [true]);
  assert.equal(h.counts.writes.length, 0);
});

test("member initialization reports a permanent database error once", async () => {
  const h = harness({ url: "https://example.test/club/app.html", user: { uid: "u", emailVerified: true }, read: () => { throw { code: "permission-denied" }; } });
  h.document.body.dataset.page = "app";
  h.document.body.classList = { remove() {} };
  const error = h.element("[data-auth-error]");
  error.hidden = true;
  h.document.querySelector = (selector) => selector === "[data-auth-error]" ? error : null;
  vm.runInContext(source("assets/js/auth.js"), h.context);
  h.callbacks.auth(h.auth.currentUser);
  await new Promise(setImmediate);
  assert.equal(h.counts.reads, 1);
  assert.equal(h.counts.delays.length, 0);
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /Firestore-Regeln/);
});

test("timer initialization uses the shared Kader role and clears it on logout", async () => {
  const h = harness({ url: "https://example.test/club/timer/", user: { uid: "u", emailVerified: true }, stored: { kader: true } });
  vm.runInContext(source("timer/firestore-api.js"), h.context);
  h.callbacks.auth(h.auth.currentUser);
  const context = await h.window.timerFirestoreApi.getAuthContext();
  assert.equal(context.authenticated, true);
  assert.equal(context.isKaderAthlete, true);
  assert.equal(context.roleLabel, "Kader-Sportler");
  assert.deepEqual(h.counts.tokens, [true]);
  assert.equal(h.counts.reads, 1);
  await h.window.timerFirestoreApi.signOut();
  await new Promise(setImmediate);
  const signedOut = await h.window.timerFirestoreApi.getAuthContext();
  assert.equal(signedOut.authenticated, false);
  assert.equal(signedOut.isKaderAthlete, false);
});

test("timer permanent errors are visible and do not schedule another attempt", async () => {
  const h = harness({ url: "https://example.test/club/timer/", user: { uid: "u", emailVerified: true }, read: () => { throw { code: "permission-denied" }; } });
  vm.runInContext(source("timer/firestore-api.js"), h.context);
  h.callbacks.auth(h.auth.currentUser);
  const context = await h.window.timerFirestoreApi.getAuthContext();
  assert.match(context.authError, /Rechte/);
  assert.equal(context.isAdmin, false);
  assert.equal(h.counts.reads, 1);
  assert.equal(h.counts.delays.length, 0);
});

test("the installed timer's navigation scope includes the shared login and original start page", () => {
  const manifest = JSON.parse(source("timer/manifest.webmanifest"));
  const base = "https://example.test/club/timer/manifest.webmanifest";
  const scope = new URL(manifest.scope, base).href;
  assert.ok(new URL(manifest.start_url, base).href.startsWith(scope));
  assert.ok(new URL("../login.html", base).href.startsWith(scope));
});

test("the timer service worker refreshes auth scripts before using cached copies", async () => {
  const callbacks = {};
  let networkRequests = 0;
  let cacheWrites = 0;
  const fresh = { ok: true, clone() { return this; } };
  const cache = { async put() { cacheWrites += 1; }, async match() { throw new Error("Unexpected cache-first auth load"); } };
  const context = vm.createContext({
    URL,
    self: { location: new URL("https://example.test/club/timer/sw.js"), addEventListener(type, fn) { callbacks[type] = fn; } },
    caches: { async open() { return cache; }, async match() { throw new Error("Unexpected global cached auth script"); } },
    async fetch() { networkRequests += 1; return fresh; },
  });
  vm.runInContext(source("timer/sw.js"), context);
  let response;
  callbacks.fetch({ request: { method: "GET", mode: "cors", url: "https://example.test/club/assets/js/auth-core.js?v=latest" }, respondWith(value) { response = value; } });
  assert.equal(await response, fresh);
  assert.equal(networkRequests, 1);
  assert.equal(cacheWrites, 1);
});

test("the timer service worker retains its auth script fallback when offline", async () => {
  const callbacks = {};
  const cached = { ok: true };
  const cache = { async match() { return cached; } };
  const context = vm.createContext({
    URL,
    self: { location: new URL("https://example.test/club/timer/sw.js"), addEventListener(type, fn) { callbacks[type] = fn; } },
    caches: { async open() { return cache; } },
    async fetch() { throw new Error("offline"); },
  });
  vm.runInContext(source("timer/sw.js"), context);
  let response;
  callbacks.fetch({ request: { method: "GET", mode: "cors", url: "https://example.test/club/assets/js/auth-core.js?v=latest" }, respondWith(value) { response = value; } });
  assert.equal(await response, cached);
});
