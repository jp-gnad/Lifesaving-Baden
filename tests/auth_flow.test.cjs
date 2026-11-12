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
      textContent: "", innerHTML: "button", dataset: {}, disabled: false, hidden: false, style: { setProperty() {} },
      handlers: {}, fields: {}, classList: { toggle() {} },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      querySelector(selector) { return element(`${key}:${selector.startsWith("input[") ? selector : "button"}`); },
      reset() { this.wasReset = true; },
      focus() { this.focused = true; },
    });
    return elements.get(key);
  }
  element('[data-auth-form="login"]').fields = { email: "test@example.test", password: "synthetic-password" };
  const ref = { async get(options) {
    counts.reads += 1;
    if (read) return read(options, counts.reads);
    return { exists: stored !== null, data: () => stored };
  }, async set(data) { counts.writes.push(data); } };
  const db = {
    collection(name) { return { doc: (id) => ({ ...ref, path: `${name}/${id}` }) }; },
    async enablePersistence() {},
    async runTransaction(fn) {
      return fn({
        async get(target) {
          if (target.path && !target.path.startsWith("users/")) return { exists: false, data: () => undefined };
          const data = transactionData === undefined ? stored : transactionData;
          return { exists: data !== null && data !== undefined, data: () => data };
        },
        set(target, data) { if (!target.path || target.path.startsWith("users/")) counts.writes.push(data); },
        update(target, data) { if (!target.path || target.path.startsWith("users/")) counts.writes.push(data); },
        delete() {},
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
  firestore.FieldValue = { serverTimestamp: () => "timestamp", delete: () => "delete-field" };
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
  vm.runInContext(source("assets/js/clubs-core.js"), context);
  vm.runInContext(source("assets/js/clubs-store.js"), context);
  vm.runInContext(source("assets/js/person-link-store.js"), context);
  vm.runInContext(source("assets/js/auth-core.js"), context);
  vm.runInContext(source("assets/js/admin-accounts.js"), context);
  vm.runInContext(source("timer/core.js"), context);
  return { core: window.LifesavingAuth, auth, window, document, context, counts, callbacks, element, prepareUser,
    login() {
      if (!window.LifesavingGoogleHandoff) vm.runInContext(source("assets/js/google-handoff.js"), context);
      vm.runInContext(source("assets/js/login.js"), context);
    },
    submit: (form) => element(`[data-auth-form="${form}"]`).handlers.submit({ preventDefault() {} }),
    async submitPassword() {
      const form = element('[data-auth-form="login"]');
      if (!form.querySelector('input[name="password"]').required) await form.handlers.submit({ preventDefault() {} });
      return form.handlers.submit({ preventDefault() {} });
    },
  };
}

function directGoogleHarness(options = {}) {
  // Most tests exercise the in-memory fallback without navigating a VM.
  // Handoff tests explicitly enable the session-storage path and create a second page.
  const { handoff = false, ...harnessOptions } = options;
  const h = harness({ url: "https://jp-gnad.github.io/Lifesaving-Baden/login.html?returnTo=timer%2F%23%2Fevent%2F42", ...harnessOptions });
  h.window.navigator = { standalone: true };
  h.window.googleSignInClientId = "public-client.apps.googleusercontent.com";
  h.window.firebaseConfig.projectId = "lifesaving-baden";
  if (!handoff) {
    const set = h.window.sessionStorage.setItem;
    h.window.sessionStorage.setItem = (key, value) => {
      if (key === "lifesaving-baden:google-handoff-v1") throw new Error("Handoff storage blocked");
      set(key, value);
    };
  }
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
    if (delay >= 15000) identity.timers.set(id, { callback, delay });
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
    [{ kader: true }, {}, "Sportler"], [{}, { isKaderAthlete: true }, "Sportler"],
    [{ role: "kadersportler" }, {}, "Sportler"], [{}, {}, "Standard"],
  ]) assert.equal(h.core.getAccountRole(data, claims).label, expected);
  assert.equal(h.core.getAccountRole({ role: "admin" }, {}).isAthlete, true);
});

test("unverified email permits a Google session but blocks password sign-in", async () => {
  const h = harness();
  assert.equal(await h.core.hasVerifiedAccess(null), false);
  assert.equal(await h.core.hasVerifiedAccess({ emailVerified: false, providerData: [{ providerId: "password" }] }), false);
  assert.equal(await h.core.hasVerifiedAccess({ emailVerified: true }), true);
  assert.equal(await h.core.hasVerifiedAccess({ providerData: [{ providerId: "google.com" }] }), true);
  const providerData = [{ providerId: "google.com" }, { providerId: "password" }];
  for (const [signInProvider, expected] of [["google.com", true], ["password", false]]) {
    assert.equal(await h.core.hasVerifiedAccess({
      providerData,
      getIdTokenResult: async () => ({ signInProvider }),
    }), expected);
  }
});

test("old return targets cannot override the member home after login", () => {
  for (const value of ["timer/#/event/42", "/club/account-settings.html#konto", "/club/link-request.html?edit=1", "https://attacker.test/", "/club/login.html"]) {
    const h = harness({ url: `https://example.test/club/login.html?returnTo=${encodeURIComponent(value)}` });
    assert.equal(new URL(h.core.getLoginRedirectUrl()).searchParams.has("returnTo"), false);
    h.core.redirectToApp();
    assert.deepEqual(h.counts.redirects, ["https://example.test/club/app.html"]);
  }
});

test("parallel auth events and email submission redirect once without any Firestore access", async () => {
  const gate = deferred();
  let reloads = 0;
  const h = harness({ user: { uid: "u", emailVerified: true, reload: () => { reloads += 1; return gate.promise; } } });
  delete h.window.firebase.firestore;
  h.login();
  h.callbacks.auth(h.auth.currentUser);
  const submitted = h.submitPassword();
  gate.resolve();
  await submitted;
  assert.equal(reloads, 1);
  assert.equal(h.counts.reads, 0);
  assert.deepEqual(h.counts.redirects, ["https://example.test/club/app.html"]);
});

test("an unverified account can complete email verification after returning to the page", async () => {
  const h = harness({ user: { uid: "u", emailVerified: false }, stored: { role: "standard", firstName: "Anna", lastName: "Baden" } });
  h.login();
  await h.submitPassword();
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
  const submitted = h.submitPassword();
  await new Promise(setImmediate);
  h.auth.currentUser = null;
  h.callbacks.auth(null);
  gate.resolve();
  await submitted;
  assert.equal(h.counts.redirects.length, 0);
});

test("Google login opens member home even from a legacy timer link", async () => {
  const h = harness({ url: "https://example.test/club/login.html?returnTo=timer%2F%23%2Fevent%2F42", user: { uid: "u", providerData: [{ providerId: "google.com" }] } });
  h.login();
  await h.element("[data-google-login]").handlers.click();
  assert.deepEqual(h.counts.redirects, ["https://example.test/club/app.html"]);
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

test("a closed popup with no session shows a readable error and allows retrying", async () => {
  const h = harness();
  h.window.navigator = { standalone: true };
  h.auth.signInWithPopup = async () => { throw { code: "auth/popup-closed-by-user", message: "sensitive-details" }; };
  h.login();
  await h.element("[data-google-login]").handlers.click();
  assert.equal(h.counts.redirects.length, 0);
  assert.equal(h.element("[data-google-login]").disabled, false);
  assert.match(h.element('[data-form-message="login"]').textContent, /Google-Fenster/);
  assert.doesNotMatch(h.element('[data-form-message="login"]').textContent, /sensitive-details|auth\//);
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
  assert.match(h.element("[data-form-message=\"login\"]").textContent, /noch nicht angekommen/);
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



test("login failures show a readable message without private SDK data or diagnostic codes", async () => {
  const h = harness({ user: { uid: "private-uid", email: "private@example.test", emailVerified: false } });
  h.window.localStorage = localStore();
  h.auth.signInWithPopup = async () => { throw { code: "auth/network-request-failed", message: "private-access-token" }; };
  h.login();
  await h.element("[data-google-login]").handlers.click();
  const message = h.element('[data-form-message="login"]').textContent;
  assert.match(message, /Verbindung/);
  assert.doesNotMatch(message, /private-uid|private@example\.test|private-access-token|auth\/|Anmeldecode|Loginversion/);
  assert.equal(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), null);
});

test("blocked local storage cleanup does not block authentication", async () => {
  const h = harness({ user: { uid: "u", providerData: [{ providerId: "google.com" }] } });
  Object.defineProperty(h.window, "localStorage", { get() { throw new Error("blocked"); } });
  h.login();
  await h.element("[data-google-login]").handlers.click();
  assert.equal(h.counts.redirects.length, 1);
});

test("retired login traces are removed without touching the Firebase session or pending Google handoff", async () => {
  const h = harness();
  h.window.localStorage = localStore();
  h.window.localStorage.setItem("lifesaving-baden:login-trace-v1", "old support trace");
  h.window.localStorage.setItem("firebase:authUser:public-key:[DEFAULT]", "keep Firebase session");
  h.window.localStorage.setItem("unrelated", "keep unrelated data");
  h.window.sessionStorage.setItem("lifesaving-baden:google-handoff-v1", "keep pending handoff");
  h.login();
  await new Promise(setImmediate);
  assert.equal(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), null);
  assert.equal(h.window.localStorage.getItem("firebase:authUser:public-key:[DEFAULT]"), "keep Firebase session");
  assert.equal(h.window.localStorage.getItem("unrelated"), "keep unrelated data");
  assert.equal(h.window.sessionStorage.getItem("lifesaving-baden:google-handoff-v1"), "keep pending handoff");
});

test("a persistence failure keeps the login usable", async () => {
  const h = harness();
  h.auth.setPersistence = async () => { throw { code: "auth/web-storage-unsupported" }; };
  h.login();
  await new Promise(setImmediate);
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
  assert.deepEqual(h.counts.redirects, ["https://lifesaving-baden.firebaseapp.com/app.html"]);
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
  assert.match(h.element("[data-form-message=\"login\"]").textContent, /Verbindung/);
});

test("a redirect with no session reports the missing result after checking Firebase", async () => {
  const h = harness({ url: "https://lifesaving-baden.firebaseapp.com/login.html" });
  h.window.navigator = { standalone: true };
  h.window.sessionStorage.setItem("lifesaving-baden:google-login-started", String(Date.now()));
  h.login();
  h.callbacks.auth(null);
  await new Promise(setImmediate);
  assert.equal(h.counts.redirectResults, 1);
  assert.match(h.element("[data-form-message=\"login\"]").textContent, /noch nicht angekommen/);
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

test("direct Google sign-in exchanges the credential once, preserves the account and opens member home, and logs no token", async () => {
  const h = directGoogleHarness();
  h.element("[data-google-login]").parentElement = { clientWidth: 342 };
  const privateToken = "private-google-id-token";
  h.login();
  await new Promise(setImmediate);
  assert.equal(h.identity.initializations.length, 1);
  assert.equal(h.identity.initializations[0].client_id, h.window.googleSignInClientId);
  assert.equal(h.identity.initializations[0].auto_select, false);
  assert.equal(h.identity.renders[0].config.theme, "filled_black");
  assert.equal(h.identity.renders[0].config.size, "medium");
  assert.equal(h.identity.renders[0].config.width, 342);
  assert.equal(h.identity.renders[0].host, h.element("[data-google-identity-action]"));
  assert.equal(h.element("[data-google-login]").hidden, true);
  h.identity.click();
  const first = h.identity.receive({ credential: privateToken });
  const duplicate = h.identity.receive({ credential: privateToken });
  await Promise.all([first, duplicate]);
  assert.equal(h.identity.credentials.length, 1);
  assert.equal(h.identity.credentials[0].idToken, privateToken);
  assert.equal(h.auth.currentUser.uid, "existing-admin");
  assert.deepEqual(h.counts.redirects, ["https://jp-gnad.github.io/Lifesaving-Baden/app.html"]);
  assert.equal(h.counts.reads, 0);
  assert.equal(h.counts.writes.length, 0);
  assert.equal(h.counts.redirectStarts, 0);
  assert.equal(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), null);
  assert.equal(h.window.sessionStorage.getItem("lifesaving-baden:google-login-started"), undefined);
});

test("resizing the direct Google control preserves the active provider button and credential callback", async () => {
  const h = directGoogleHarness();
  const parent = { clientWidth: 342 };
  const styles = new Map();
  h.element("[data-google-login]").parentElement = parent;
  h.element("[data-google-identity-action]").style = { setProperty: (name, value) => styles.set(name, value) };
  h.login();
  await new Promise(setImmediate);
  const initialScale = styles.get("--google-button-scale-x");
  h.identity.click();
  parent.clientWidth = 420;
  h.callbacks.resize();
  assert.notEqual(styles.get("--google-button-scale-x"), initialScale);
  assert.equal(h.identity.renders.length, 1);
  assert.equal(h.identity.initializations.length, 1);
  await h.identity.receive({ credential: "synthetic-token" });
  assert.equal(h.identity.credentials.length, 1);
  assert.equal(h.counts.redirects.length, 1);
});

function continuedGooglePage(previous, options = {}) {
  const next = directGoogleHarness({ handoff: true, ...options });
  next.window.sessionStorage = previous.window.sessionStorage;
  next.window.localStorage = previous.window.localStorage;
  return next;
}

test("Google handoff saves a short-lived proof before navigating, then signs in on the new page without another Google popup", async () => {
  const first = directGoogleHarness({ handoff: true });
  first.login();
  await new Promise(setImmediate);
  first.identity.click();
  first.document.visibilityState = "hidden";
  await first.identity.receive({ credential: "private-handoff-token" });
  assert.equal(first.identity.credentials.length, 0);
  assert.deepEqual(first.counts.redirects, [first.window.location.href]);
  const saved = JSON.parse(first.window.sessionStorage.getItem("lifesaving-baden:google-handoff-v1"));
  assert.equal(saved.token, "private-handoff-token");
  assert.equal(saved.attempts, 0);
  const originalTime = saved.createdAt;
  first.callbacks.pagehide();

  const next = continuedGooglePage(first);
  next.login();
  next.callbacks.auth(null);
  await new Promise(setImmediate);
  assert.equal(next.identity.initializations.length, 0);
  assert.equal(next.identity.credentials.length, 1);
  assert.equal(next.identity.credentials[0].idToken, "private-handoff-token");
  assert.equal(next.auth.currentUser.uid, "existing-admin");
  assert.equal(next.counts.reads, 0);
  assert.equal(next.counts.writes.length, 0);
  assert.deepEqual(next.counts.redirects, ["https://jp-gnad.github.io/Lifesaving-Baden/app.html"]);
  assert.equal(next.window.sessionStorage.getItem("lifesaving-baden:google-handoff-v1"), undefined);
  assert.equal(next.window.sessionStorage.getItem("lifesaving-baden:google-login-started"), undefined);
  assert.equal(next.identity.timers.size, 0);
  assert.equal(next.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), null);
  assert.ok(Date.now() - originalTime < 120000);
});

test("an interrupted credential request survives the next automatic navigation but caps attempts across all pages", async () => {
  let previous = directGoogleHarness({ handoff: true });
  previous.login();
  await new Promise(setImmediate);
  previous.identity.click();
  await previous.identity.receive({ credential: "private-recoverable-token" });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const next = continuedGooglePage(previous);
    let calls = 0;
    next.auth.signInWithCredential = async () => {
      calls += 1;
      next.callbacks.pagehide();
      next.document.visibilityState = "hidden";
      throw { code: "auth/network-request-failed" };
    };
    next.login();
    next.callbacks.auth(null);
    await new Promise(setImmediate);
    assert.equal(calls, 1);
    assert.equal(JSON.parse(next.window.sessionStorage.getItem("lifesaving-baden:google-handoff-v1")).attempts, attempt);
    previous = next;
  }
  const last = continuedGooglePage(previous);
  last.login();
  last.callbacks.auth(null);
  await new Promise(setImmediate);
  assert.equal(last.identity.credentials.length, 0);
  assert.equal(last.counts.redirects.length, 0);
  assert.equal(last.window.sessionStorage.getItem("lifesaving-baden:google-handoff-v1"), undefined);
  assert.equal(last.window.sessionStorage.getItem("lifesaving-baden:google-login-started"), undefined);
  assert.match(last.element("[data-form-message=\"login\"]").textContent, /abgelaufen|fortgesetzt/);
  assert.equal(last.element("[data-google-identity]").hidden, false);
});

test("a request interrupted by a page change can complete on the following page with the same account", async () => {
  const first = directGoogleHarness({ handoff: true });
  first.login();
  await new Promise(setImmediate);
  first.identity.click();
  await first.identity.receive({ credential: "recoverable-token" });
  const interrupted = continuedGooglePage(first);
  interrupted.auth.signInWithCredential = async () => {
    interrupted.callbacks.pagehide();
    throw { code: "auth/network-request-failed" };
  };
  interrupted.login();
  await new Promise(setImmediate);
  const next = continuedGooglePage(interrupted);
  next.login();
  next.callbacks.auth(null);
  await new Promise(setImmediate);
  assert.equal(next.auth.currentUser.uid, "existing-admin");
  assert.equal(next.identity.credentials.length, 1);
  assert.equal(next.counts.redirects.length, 1);
  assert.equal(next.window.sessionStorage.getItem("lifesaving-baden:google-handoff-v1"), undefined);
});

test("navigation after a network failure preserves the proof while an old retry timer is suspended", async () => {
  const first = directGoogleHarness({ handoff: true });
  first.login();
  await new Promise(setImmediate);
  first.identity.click();
  await first.identity.receive({ credential: "suspended-retry-token" });
  const interrupted = continuedGooglePage(first);
  const schedule = interrupted.window.setTimeout;
  const retries = [];
  interrupted.window.setTimeout = (callback, delay) => {
    if (delay === 450) { retries.push(callback); return 9999; }
    return schedule(callback, delay);
  };
  let calls = 0;
  interrupted.auth.signInWithCredential = async () => { calls += 1; throw { code: "auth/network-request-failed" }; };
  interrupted.login();
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(retries.length, 1);
  interrupted.callbacks.pagehide();
  interrupted.document.visibilityState = "hidden";
  const next = continuedGooglePage(interrupted);
  next.login();
  next.callbacks.auth(null);
  await new Promise(setImmediate);
  assert.equal(next.counts.redirects.length, 1);
  retries[0]();
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(next.window.sessionStorage.getItem("lifesaving-baden:google-handoff-v1"), undefined);
  assert.equal(interrupted.counts.redirects.length, 0);
});

test("invalid, expired, future-dated, or differently configured handoffs are cleared without a Firebase request", async () => {
  for (const change of [
    { createdAt: Date.now() - 120001 }, { createdAt: Date.now() + 60000 },
    { clientId: "different-client.apps.googleusercontent.com" }, { projectId: "different-project" },
    { attempts: -1 }, { attempts: 4 }, { token: "" }, { token: "x".repeat(16385) },
  ]) {
    const first = directGoogleHarness({ handoff: true });
    first.login();
    await new Promise(setImmediate);
    first.identity.click();
    await first.identity.receive({ credential: "private-expired-token" });
    const key = "lifesaving-baden:google-handoff-v1";
    const saved = JSON.parse(first.window.sessionStorage.getItem(key));
    first.window.sessionStorage.setItem(key, JSON.stringify({ ...saved, ...change }));
    const next = continuedGooglePage(first);
    next.login();
    next.callbacks.auth(null);
    await new Promise(setImmediate);
    assert.equal(next.identity.credentials.length, 0);
    assert.equal(next.counts.redirects.length, 0);
    assert.equal(next.window.sessionStorage.getItem(key), undefined);
  }
});

test("an active page expires its pending Google proof without extending the deadline", async () => {
  const h = directGoogleHarness({ handoff: true });
  h.login();
  await new Promise(setImmediate);
  h.identity.click();
  await h.identity.receive({ credential: "private-expiring-token" });
  const key = "lifesaving-baden:google-handoff-v1";
  const createdAt = JSON.parse(h.window.sessionStorage.getItem(key)).createdAt;
  const timer = [...h.identity.timers.values()][0];
  h.context.handoffTestTime = createdAt + 120001;
  vm.runInContext("Date.now = () => handoffTestTime", h.context);
  timer.callback();
  assert.equal(h.window.sessionStorage.getItem(key), undefined);
  assert.equal(h.identity.timers.size, 0);
  assert.equal(h.identity.credentials.length, 0);
});

test("a permanent handoff error clears the proof and offers Google login again", async () => {
  const first = directGoogleHarness({ handoff: true });
  first.login();
  await new Promise(setImmediate);
  first.identity.click();
  await first.identity.receive({ credential: "private-invalid-token" });
  const next = continuedGooglePage(first);
  let calls = 0;
  next.auth.signInWithCredential = async () => { calls += 1; throw { code: "auth/invalid-credential" }; };
  next.login();
  next.callbacks.auth(null);
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(next.window.sessionStorage.getItem("lifesaving-baden:google-handoff-v1"), undefined);
  assert.equal(next.window.sessionStorage.getItem("lifesaving-baden:google-login-started"), undefined);
  assert.match(next.element("[data-form-message=\"login\"]").textContent, /E-Mail oder Passwort/);
  assert.equal(next.element("[data-google-identity]").hidden, false);
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
    h.document.visibilityState = "visible";
    h.callbacks[returnEvent]();
    await new Promise(setImmediate);
    assert.equal(h.identity.credentials.length, 0);
    assert.equal(frames.length, 1);
    frames.shift()();
    await received;
    assert.equal(h.identity.credentials.length, 1);
    assert.equal(h.counts.redirects.length, 1);
    assert.equal(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), null);
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
  assert.equal(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), null);
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
  const passwordLogin = h.submitPassword();
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
  assert.match(h.element("[data-form-message=\"login\"]").textContent, /Verbindung/);
  assert.equal(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), null);
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
  assert.match(h.element("[data-form-message=\"login\"]").textContent, /keinen Anmeldenachweis/);
  assert.equal(h.element("[data-google-identity]").hidden, false);
});

test("Google client loading is bounded, retryable, and does not lock the email forms", async () => {
  for (const failure of ["error", "timeout", "incomplete-load"]) {
    const h = directGoogleHarness();
    const button = h.element("[data-google-login]");
    const originalFace = '<img alt=""><span>Über Google anmelden</span>';
    button.innerHTML = originalFace;
    const google = h.window.google;
    delete h.window.google;
    h.login();
    await new Promise(setImmediate);
    assert.equal(button.innerHTML, originalFace);
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, true);
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
    assert.match(h.element("[data-form-message=\"login\"]").textContent, /nicht geladen/);
    const retry = h.element("[data-google-login]").handlers.click();
    assert.equal(button.innerHTML, originalFace);
    assert.equal(h.identity.scripts.length, 2);
    h.window.google = google;
    h.identity.scripts[1].handlers.load();
    await retry;
    assert.equal(h.identity.renders.length, 1);
    assert.equal(h.identity.timers.size, 0);
    assert.equal(h.element("[data-google-identity]").hidden, false);
    assert.equal(h.element('[data-form-message="login"]').textContent, "");
  }
});

test("desktop registration waits for a saved name before sending verification", async () => {
  const h = harness({ stored: null });
  let creations = 0;
  h.auth.createUserWithEmailAndPassword = async () => {
    creations++;
    const user = h.prepareUser({ uid: "new", emailVerified: false });
    h.auth.currentUser = user;
    h.callbacks.auth(user);
    return { user };
  };
  h.auth.signInWithEmailAndPassword = async () => { throw { code: "auth/invalid-credential" }; };
  h.login();
  h.element('[data-auth-form="login"]').fields = { email: "test@example.test", password: "synthetic-password" };
  await h.submitPassword();
  assert.equal(h.auth.currentUser, null);
  assert.equal(creations, 0);
  assert.equal(h.counts.verification, undefined);
  assert.equal(h.counts.writes.length, 0);
  const form = h.element('[data-auth-form="login"]');
  form.fields.firstName = "Anna Maria";
  form.fields.lastName = "von Baden";
  await h.submit("login");
  assert.equal(creations, 1);
  assert.equal(h.counts.writes[0].firstName, "Anna Maria");
  assert.equal(h.counts.writes[0].lastName, "von Baden");
  assert.equal(h.counts.writes[0].loginNameCaptured, true);
  assert.equal(h.counts.redirects.length, 0);
  assert.equal(new URL(h.counts.verification.url).searchParams.get("verified"), "1");
  assert.match(h.element('[data-form-message="login"]').textContent, /Konto erstellt/);
});

test("password reset links back to the shared login without a legacy timer target", async () => {
  const h = harness({ url: "https://example.test/club/login.html?returnTo=timer%2F%23%2F" });
  h.login();
  h.element('[data-auth-form="login"]').fields.email = "test@example.test";
  await h.element("[data-reset-password]").handlers.click();
  assert.equal(new URL(h.counts.reset.options.url).searchParams.has("returnTo"), false);
});

test("new email and Google accounts start without a profile name", async () => {
  for (const providerId of ["password", "google.com"]) {
    const user = {
      uid: "new",
      email: "anna.baden@example.test",
      displayName: providerId === "google.com" ? "Anna Baden" : null,
      providerData: [{ providerId }],
    };
    const h = harness({ user, stored: null });
    const [first, second] = await Promise.all([h.core.loadUserContext(user), h.core.loadUserContext(user)]);
    assert.equal(first, second);
    assert.equal(h.counts.reads, 1);
    assert.equal(h.counts.writes.length, 1);
    for (const field of ["firstName", "lastName", "displayName"]) {
      assert.equal(first.userData[field], "");
      assert.equal(h.core.getNameDetailsFromData(first.userData, user)[field], "");
      assert.equal(h.counts.writes[0][field], "");
    }
    assert.equal(first.userData.role, "standard");
    assert.deepEqual(h.counts.tokens, [true]);
  }
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

test("legacy timer login forwards verification flags and drops the old event target", () => {
  const h = harness({ url: "https://example.test/club/timer/login.html?returnTo=%2Fclub%2Ftimer%2F%23%2Fevent%2F42&verified=1" });
  const html = source("timer/login.html");
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  vm.runInContext(inline, h.context);
  h.callbacks.DOMContentLoaded();
  const destination = new URL(h.counts.redirects[0]);
  assert.equal(destination.pathname, "/club/login.html");
  assert.equal(destination.searchParams.has("returnTo"), false);
  assert.equal(destination.searchParams.get("verified"), "1");
});

test("standalone launch reveals its branding together and covers the landing page during the session check", async () => {
  const [startScript, minimumScript] = [...source("index.html").matchAll(/<script>\s*([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]);
  for (const [mode, user] of [
    ["ios", { uid: "member", emailVerified: true }],
    ["standalone-fast", null],
    ["standalone-slow", null],
    ["browser", null],
    ["offline", null],
  ]) {
    const h = harness({ url: "https://example.test/club/", user });
    const classes = new Set();
    const timers = new Map();
    const decoded = deferred();
    const logo = { decode: () => decoded.promise, style: {} };
    const content = { firstElementChild: logo, hidden: true, style: {} };
    const splash = { firstElementChild: content, clientHeight: 800 };
    let firstFrame;
    const replacements = [];
    h.document.body.dataset.page = "landing";
    h.document.referrer = "";
    h.document.querySelector = (selector) => selector === ".app-launch" ? splash : null;
    h.document.documentElement = { classList: {
      add: (name) => classes.add(name),
      contains: (name) => classes.has(name),
      remove: (name) => classes.delete(name),
    } };
    h.window.navigator = { standalone: mode === "ios" };
    h.window.matchMedia = () => ({ matches: mode.startsWith("standalone") || mode === "offline" });
    h.window.requestAnimationFrame = (callback) => { firstFrame = callback; };
    h.window.setTimeout = (callback, delay) => { timers.set(delay, callback); };
    h.window.clearTimeout = (delay) => timers.delete(delay);
    h.window.location.replace = (url) => replacements.push(url);
    if (mode === "offline") delete h.window.firebase;

    vm.runInContext(startScript, h.context);
    assert.equal(classes.has("app-launching"), mode !== "browser");
    vm.runInContext(minimumScript, h.context);
    assert.equal(classes.has("app-launch-minimum"), mode !== "browser");
    assert.equal(timers.has(650), false);
    assert.equal(content.hidden, true);
    assert.equal(firstFrame, undefined);
    if (mode === "offline") timers.get(250)();
    else decoded.resolve();
    await new Promise(setImmediate);
    firstFrame?.();
    if (mode !== "browser") {
      assert.equal(content.hidden, false);
      assert.equal(content.style.top, "364px");
      assert.equal(logo.style.visibility, mode === "offline" ? "hidden" : undefined);
      assert.equal(timers.has(650), true);
    }
    if (mode === "standalone-slow") {
      timers.get(650)();
      assert.equal(classes.has("app-launching"), true);
      assert.equal(classes.has("app-launch-minimum"), false);
    }
    vm.runInContext(source("assets/js/auth.js"), h.context);
    assert.deepEqual(replacements, []);
    await h.callbacks.auth?.(user);

    if (user) {
      assert.deepEqual(replacements, ["https://example.test/club/app.html"]);
      assert.equal(classes.has("app-launching"), true);
    } else {
      assert.deepEqual(replacements, []);
      assert.equal(classes.has("app-launching"), false);
      if (mode === "standalone-fast" || mode === "offline") {
        assert.equal(classes.has("app-launch-minimum"), true);
        timers.get(650)();
      }
      assert.equal(classes.has("app-launch-minimum"), false);
    }
  }
});

test("standalone home links, reloads and history traversals skip the startup screen", () => {
  const startScript = source("index.html").match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  for (const [referrer, type, launches] of [
    ["", "navigate", true],
    ["https://example.test/club/", "navigate", false],
    ["https://example.test/club/login.html", "navigate", false],
    ["https://example.test/club/timer/", "navigate", false],
    ["https://example.test/club-other/", "navigate", true],
    ["", "back_forward", false],
    ["", "reload", false],
  ]) {
    const h = harness({ url: "https://example.test/club/index.html" });
    const classes = new Set();
    h.document.referrer = referrer;
    h.document.documentElement = { classList: {
      add: (name) => classes.add(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    } };
    h.window.navigator = { standalone: true };
    h.window.performance = { getEntriesByType: () => [{ type }] };
    h.window.setTimeout = () => {};
    vm.runInContext(startScript, h.context);
    assert.equal(classes.has("app-launching"), launches, `${type}: ${referrer}`);
    if (launches) {
      classes.add("app-launch-minimum");
      h.callbacks.pagehide();
      assert.equal(classes.size, 0);
    }
  }
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

test("trainer apps open only for trainers and higher and clear data on logout", async () => {
  const apps = [
    { page: "worktime", file: "arbeitszeiten", api: "LifesavingWorktime" },
    { page: "clubs", file: "club-verwaltung", api: "LifesavingClubs" },
  ];
  for (const { page, file, api } of apps) {
    for (const role of ["standard", "athlete", "trainer", "organizer", "admin"]) {
      const user = { uid: `${page}-${role}`, emailVerified: true };
      const h = harness({ url: `https://example.test/club/${file}.html`, user, stored: { role } });
      let starts = 0;
      let stops = 0;
      h.window[api] = { start: () => { starts += 1; }, stop: () => { stops += 1; } };
      h.document.body.dataset.page = page;
      h.document.body.classList = { remove() {} };
      h.document.querySelector = () => null;
      vm.runInContext(source("assets/js/auth.js"), h.context);
      h.callbacks.auth(user);
      await new Promise(setImmediate);
      const allowed = ["trainer", "organizer", "admin"].includes(role);
      assert.equal(starts, allowed ? 1 : 0, role);
      if (!allowed) assert.equal(h.counts.redirects.at(-1), "https://example.test/club/app.html");
      assert.equal(h.counts.warnings.length, 0, role);
      h.auth.currentUser = null;
      h.callbacks.auth(null);
      assert.equal(stops, 2);
      assert.equal(h.counts.redirects.at(-1), "https://example.test/club/login.html");
    }
  }
});

test("Mein Training opens for athletes and higher and requires a verified login", async () => {
  for (const role of ["standard", "athlete", "trainer", "organizer", "admin"]) {
    const user = { uid: `training-${role}`, emailVerified: true };
    const h = harness({ url: "https://example.test/club/mein-training.html", user, stored: { role } });
    const heading = h.element("training-heading");
    let visible = false;
    heading.classList.toggle = (name, hidden) => { if (name === "is-hidden") visible = !hidden; };
    h.document.body.dataset.page = "training";
    h.document.body.classList = { remove() {} };
    h.document.querySelector = () => null;
    h.document.querySelectorAll = (selector) => selector === "[data-athlete-only]" ? [heading] : [];
    vm.runInContext(source("assets/js/auth.js"), h.context);
    h.callbacks.auth(user);
    await new Promise(setImmediate);
    const allowed = role !== "standard";
    assert.equal(visible, allowed, role);
    assert.deepEqual(h.counts.redirects, allowed ? [] : ["https://example.test/club/app.html"], role);
    assert.equal(h.counts.warnings.length, 0, role);
    h.auth.currentUser = null;
    h.callbacks.auth(null);
    assert.equal(h.counts.redirects.at(-1), "https://example.test/club/login.html");
  }
  for (const user of [null, { uid: "unverified-training", emailVerified: false }]) {
    const h = harness({ url: "https://example.test/club/mein-training.html", user, stored: { role: "athlete" } });
    h.document.body.dataset.page = "training";
    h.document.body.classList = { remove() {} };
    h.document.querySelector = () => null;
    vm.runInContext(source("assets/js/auth.js"), h.context);
    h.callbacks.auth(user);
    await new Promise(setImmediate);
    assert.equal(h.counts.redirects.at(-1), `https://example.test/club/login.html${user ? "?needsVerification=1" : ""}`);
  }
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

test("new and legacy profiles enter member home without mandatory setup", async () => {
  for (const stored of [
    null,
    { role: "standard" },
    { role: "standard", accountSetupRequired: true },
    { role: "standard", accountSetupPending: true },
    { role: "admin", accountSetupRequired: true },
  ]) {
    const h = harness({ url: "https://example.test/club/app.html", user: { uid: "new-uid", emailVerified: true }, stored });
    h.document.body.dataset.page = "app";
    h.document.body.classList = { remove() {} };
    h.document.querySelector = () => null;
    vm.runInContext(source("assets/js/auth.js"), h.context);
    h.callbacks.auth(h.auth.currentUser);
    await new Promise(setImmediate);
    assert.deepEqual(h.counts.redirects, []);
    if (stored === null) assert.equal(h.counts.writes[0].accountSetupRequired, false);
  }
});

test("legacy setup markers do not block authenticated timer access", async () => {
  const h = harness({
    url: "https://example.test/club/timer/",
    user: { uid: "new-user", emailVerified: true },
    stored: { role: "standard", accountSetupRequired: true },
  });
  vm.runInContext(source("timer/firestore-api.js"), h.context);
  h.callbacks.auth(h.auth.currentUser);
  await new Promise(setImmediate);
  assert.deepEqual(h.counts.redirects, []);
  assert.equal((await h.window.timerFirestoreApi.getAuthContext()).authenticated, true);
});

test("timer initialization uses the shared Kader role and clears it on logout", async () => {
  const h = harness({ url: "https://example.test/club/timer/", user: { uid: "u", emailVerified: true }, stored: { kader: true } });
  vm.runInContext(source("timer/firestore-api.js"), h.context);
  h.callbacks.auth(h.auth.currentUser);
  const context = await h.window.timerFirestoreApi.getAuthContext();
  assert.equal(context.authenticated, true);
  assert.equal(context.isAthlete, true);
  assert.equal(context.roleLabel, "Sportler");
  assert.deepEqual(h.counts.tokens, [true]);
  assert.equal(h.counts.reads, 1);
  await h.window.timerFirestoreApi.signOut();
  await new Promise(setImmediate);
  const signedOut = await h.window.timerFirestoreApi.getAuthContext();
  assert.equal(signedOut.authenticated, false);
  assert.equal(signedOut.isAthlete, false);
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


function memberFunctions(h) {
  h.document.querySelector = () => null;
  vm.runInContext(source("assets/js/auth.js").replace(/\}\)\(\);\s*$/, "window.memberTest = { updateAccountProfile, updateLinkStatusUi, updateRoleUi, updateAdminAccountCardRole, initSettingsMenu, initSettingsZoomProtection, unlinkOwnPerson, persistProfileDetails, initLinkManagement, updateLinkManagementUi, updateLinkRequestAvailability, submitSettingsLinkRequest, writeUserDocCache, changeAccountPassword, savePasswordEmail, requireDeletableAccount, loadFreshUserContext, createAdminAccountCard, createAdminAccountRoleSelect, setAdminAccountEditMode, saveAdminAccountChanges, decideAdminAccountRequest, countAdminNotifications, initAdminAccountBadge, initAdminStatus, filterAdminAccounts, manageGoogleAccount, unlinkGoogleAccount, unlinkPasswordAccount, deleteCurrentAccount };})();"), h.context);
  return h.window.memberTest;
}

test("deleting an account exits to a clean login without the deletion page as return target", async () => {
  const h = harness({ url: "https://example.test/club/account-settings.html#konto", user: { uid: "old-uid", emailVerified: true } });
  const functions = memberFunctions(h);
  let profileDeleted = false;
  h.window.confirm = () => true;
  h.window.LifesavingPersonLinks.deleteAccount = async (_, uid) => { assert.equal(uid, "old-uid"); profileDeleted = true; };
  h.auth.currentUser.delete = async () => { h.auth.currentUser = null; };
  await functions.deleteCurrentAccount(h.auth, null);
  assert.equal(profileDeleted, true);
  assert.equal(h.auth.currentUser, null);
  assert.deepEqual(h.counts.redirects, ["https://example.test/club/login.html"]);
});

test("the five canonical roles form the expected hierarchy and retain legacy privileges", () => {
  const h = harness();
  const roles = ["standard", "athlete", "trainer", "organizer", "admin"];
  for (const [index, value] of roles.entries()) {
    for (const [data, claims] of [[{ role: value }, {}], [{}, { role: value.toUpperCase() }]]) {
      const role = h.core.getAccountRole(data, claims);
      assert.equal(role.value, value);
      assert.equal(role.isAthlete, index >= 1);
      assert.equal(role.isTrainer, index >= 2);
      assert.equal(role.isOrganizer, index >= 3);
      assert.equal(role.isAdmin, index === 4);
    }
  }
  assert.equal(h.core.getAccountRole({ role: "sportler" }, {}).value, "standard");
  assert.equal(h.core.getAccountRole({ role: "kader-sportler" }, {}).value, "athlete");
  assert.equal(h.core.getAccountRole({ role: "standard", kader: true }, {}).value, "athlete");
  assert.equal(h.core.getAccountRole({ role: "trainer", kader: true }, {}).value, "trainer");
  assert.equal(h.core.getAccountRole({ role: "trainer" }, { organizer: true }).value, "organizer");
});

test("admin profiles synchronize normally without changing their role or admin flags", async () => {
  for (const [marker, claims] of [[{ role: "admin" }, {}], [{ admin: true }, {}], [{ isAdmin: true }, {}], [{ role: "standard" }, { admin: true }]]) {
    const stored = { ...marker, firstName: "Neuer", lastName: "Name" };
    const h = harness({ user: { uid: "admin", displayName: "Alter Name" }, stored, token: async () => ({ claims }) });
    const functions = memberFunctions(h);
    const context = await functions.loadFreshUserContext(h.auth.currentUser);
    assert.equal(h.core.getAccountRole(context.userData, context.claims).isAdmin, true);
    assert.equal(h.auth.currentUser.displayName, "Neuer Name");
    assert.equal(h.counts.writes.length, 1);
    for (const key of ["role", "admin", "isAdmin"]) assert.equal(key in h.counts.writes[0], false);
    await assert.rejects(functions.requireDeletableAccount(h.auth.currentUser), { code: "app/admin-account-protected" });
  }
});

test("an admin claim with no account document does not create or initialize a profile", async () => {
  const h = harness({ user: { uid: "admin" }, stored: null, token: async () => ({ claims: { isAdmin: true } }) });
  const context = await h.core.loadUserContext(h.auth.currentUser);
  assert.equal(h.core.getAccountRole(context.userData, context.claims).isAdmin, true);
  assert.equal(h.counts.writes.length, 0);
});

test("account deletion guard rechecks roles and blocks newly recognized admins", async () => {
  let stored = { role: "trainer" };
  const h = harness({ user: { uid: "u" }, read: async () => ({ exists: true, data: () => stored }) });
  const functions = memberFunctions(h);
  await functions.requireDeletableAccount(h.auth.currentUser);
  stored = { role: "admin" };
  await assert.rejects(functions.requireDeletableAccount(h.auth.currentUser), { code: "app/admin-account-protected" });
});

test("timer permissions match every role threshold and keep management away from trainers", async () => {
  for (const [rank, role] of ["standard", "athlete", "trainer", "organizer", "admin"].entries()) {
    const h = harness({ url: "https://example.test/club/timer/", user: { uid: role, emailVerified: true }, stored: { role } });
    vm.runInContext(source("timer/firestore-api.js").replace(/\}\)\(\);\s*$/, "window.timerPermissionTest = permissionSet;})();"), h.context);
    h.callbacks.auth(h.auth.currentUser);
    const context = await h.window.timerFirestoreApi.getAuthContext();
    assert.equal(context.role, role);
    for (const [level, threshold] of [["everyone", 0], ["authenticated", 0], ["athlete", 1], ["kader", 1], ["trainer", 2], ["organizer", 3], ["locked", 4]]) {
      const permissions = h.window.timerPermissionTest({ timerAccess: level, resultsAccess: level, participantViewAccess: level, participantEditAccess: level, resultEditAccess: level });
      for (const key of ["canUseTimer", "canViewResults", "canViewParticipants", "canEditParticipants", "canEditResults"]) assert.equal(permissions[key], rank >= threshold, `${role} / ${level} / ${key}`);
      assert.equal(permissions.canManageEvent, rank >= 3);
      assert.equal(permissions.canImportParticipants, rank >= 3 && rank >= threshold);
    }
  }
});


test("admin account cards allow person linking while only other roles expose a role selector", () => {
  const h = harness();
  const functions = memberFunctions(h);
  h.document.createElement = (tagName) => ({
    tagName, dataset: {}, children: [], classList: { toggle() {} },
    append(...children) { this.children.push(...children); },
    setAttribute() {},
  });
  const all = (element) => [element, ...element.children.flatMap(all)];
  for (const role of ["admin", "organizer", "trainer", "athlete", "standard"]) {
    const card = functions.createAdminAccountCard({ uid: role, data: { role, personLinkStatus: "requested", personLinkRequest: { status: "requested" } } });
    const nodes = all(card);
    const select = nodes.find((node) => node.tagName === "select");
    if (role === "admin") {
      assert.equal(select, undefined);
    } else {
      assert.deepEqual(select.children.map((option) => option.value), ["organizer", "trainer", "athlete", "standard"]);
    }
    assert.equal(nodes.some((node) => node.tagName === "input"), false);
    assert.equal(nodes.some((node) => "adminAccountLink" in node.dataset), true);
    for (const action of role === "admin" ? ["adminAccountEdit", "adminAccountRequestAction"] : ["adminAccountEdit", "adminAccountSave", "adminAccountRequestAction"]) {
      assert.equal(nodes.some((node) => action in node.dataset), true);
    }
  }
  const issueCard = functions.createAdminAccountCard({ uid: "admin", data: { role: "admin", personLinkIssue: { status: "reported" } } });
  const issueNodes = all(issueCard);
  const issueActions = issueNodes.filter((node) => "adminAccountIssueAction" in node.dataset);
  assert.equal(issueActions.length, 1);
  assert.equal(issueActions[0].dataset.adminAccountIssueAction, "resolve");
  assert.equal(issueActions[0].textContent, "");
  assert.match(issueActions[0].innerHTML, /<svg/);
  assert.equal(issueNodes.filter((node) => node.className === "admin-account-notification").length, 1);
  assert.equal(issueNodes.some((node) => node.className === "admin-account-alert"), false);
});

test("role editing cannot change roles on admin cards or restore manual person IDs", async () => {
  const h = harness({ user: { uid: "admin" } });
  const functions = memberFunctions(h);
  let writes = 0;
  h.window.firebase.firestore = () => ({ collection: () => ({ doc: () => ({ update: async () => { writes += 1; } }) }) });
  const card = { dataset: { targetUid: "admin", accountRoleValue: "admin" }, querySelector: () => ({ value: "standard" }) };
  await functions.saveAdminAccountChanges(h.auth, { closest: () => card });
  assert.equal(writes, 0);
  assert.equal(source("assets/js/auth.js").includes("data-admin-account-link-id"), false);
});

test("rejecting an outdated request cannot overwrite a new person assignment or a withdrawn request", async () => {
  const linked = { personLink: { id: "1234567890abcdef", name: "Anna", birthYear: 1991, gender: "w", organization: "Baden" } };
  for (const [current, expectedWrites] of [[linked, 0], [{}, 0], [{ personLinkStatus: "requested" }, 1]]) {
    const h = harness({ user: { uid: "admin" } });
    const functions = memberFunctions(h);
    const writes = [];
    h.window.firebase.firestore().runTransaction = async (action) => action({
      get: async () => ({ exists: true, data: () => current }), update: (_, payload) => writes.push(payload),
    });
    const button = { dataset: { adminAccountRequestAction: "reject" }, closest: () => ({ dataset: { targetUid: "target" } }) };
    await functions.decideAdminAccountRequest(h.auth, button);
    assert.equal(writes.length, expectedWrites);
    if (writes.length) assert.equal(writes[0].personLinkStatus, "rejected");
  }
});

test("admin settings allow provider management while account deletion remains blocked", async () => {
  for (const [action, expected] of [["manageGoogleAccount", 2], ["unlinkGoogleAccount", 1], ["unlinkPasswordAccount", 1], ["deleteCurrentAccount", 0]]) {
    let mutations = 0;
    const user = { uid: "admin", email: "admin@example.test", emailVerified: true, providerData: [{ providerId: "password" }, { providerId: "google.com" }],
      unlink: async () => { mutations++; }, linkWithPopup: async () => { mutations++; }, delete: async () => { mutations++; } };
    const h = harness({ user, stored: { role: "admin" } });
    h.window.confirm = () => true;
    const functions = memberFunctions(h);
    await functions[action](h.auth, null);
    assert.equal(mutations, expected, action);
    assert.equal(h.counts.writes.length, expected ? 1 : 0, action);
    for (const payload of h.counts.writes) assert.equal("role" in payload, false);
  }
});

test("member home does not load the admin account list", async () => {
  const h = harness({ user: { uid: "admin" } });
  h.document.body.dataset.page = "app";
  const functions = memberFunctions(h);
  let accountReads = 0;
  h.window.firebase.firestore = () => ({ collection() { accountReads++; throw new Error("Unexpected account list read"); } });
  await functions.initAdminStatus(h.auth, { role: "admin" });
  assert.equal(accountReads, 0);
  assert.equal(source("app.html").includes("data-admin-account-list"), false);
  assert.equal(source("admin-accounts.html").includes("data-admin-account-list"), true);
});

test("the profile link badge follows the person link while other profile notices keep their checklist state", () => {
  const h = harness();
  const functions = memberFunctions(h);
  const node = (attributes = []) => ({
    hidden: true, attributes: {}, classList: { toggle() {} },
    hasAttribute: (name) => attributes.includes(name),
    setAttribute(name, value) { this.attributes[name] = value; },
  });
  const green = node();
  const red = node(["data-account-attention"]);
  const manage = node(["data-account-manage-attention"]);
  const profile = node();
  h.document.querySelectorAll = (selector) => ({
    "[data-link-indicator]": [green],
    "[data-account-open]": [profile],
    "[data-account-attention], [data-account-manage-attention]": [red, manage],
  })[selector] || [];
  for (const data of [{ personLink: { id: "1234567890abcdef", name: "Anna", birthYear: 2001, gender: "w", organization: "Baden" } }]) {
    functions.updateLinkStatusUi(data);
    assert.equal(green.hidden, false);
    assert.equal(red.hidden, true);
    assert.equal(manage.hidden, false);
    assert.match(profile.attributes["aria-label"], /Konto verknüpft/);
  }
  for (const data of [{}, { linkedPersonId: "old-id" }, { personId: "old-id", personLinked: true, personLinkStatus: "linked" }]) {
  functions.updateLinkStatusUi(data);
  assert.equal(green.hidden, true);
  }
  assert.equal(red.hidden, false);
  assert.match(profile.attributes["aria-label"], /nicht verknüpft/);
  functions.updateLinkStatusUi(null);
  assert.equal(green.hidden, true);
  assert.equal(red.hidden, true);
  assert.equal(profile.attributes["aria-label"], "Kontoprofil öffnen");
});

test("opening the accounts page with a non-admin account returns to member home", async () => {
  const h = harness({ user: { uid: "trainer", emailVerified: true }, stored: { role: "trainer" }, url: "https://example.test/club/admin-accounts.html" });
  h.document.body.dataset.page = "admin-accounts";
  h.document.body.classList = { remove() {} };
  h.document.querySelector = () => null;
  vm.runInContext(source("assets/js/auth.js"), h.context);
  h.callbacks.auth(h.auth.currentUser);
  await new Promise(setImmediate);
  assert.deepEqual(h.counts.redirects, ["https://example.test/club/app.html"]);
});

test("admin badge uses count-only queries, combines both pending request formats, and adds open issues", async () => {
  const user = { uid: "admin", getIdToken: async () => "synthetic-token" };
  const h = harness({ user });
  const functions = memberFunctions(h);
  h.window.firebaseConfig.projectId = "demo-lifesaving-baden";
  const requests = [];
  h.context.fetch = async (url, options) => {
    requests.push({ url, ...options });
    const count = requests.length === 1 ? "2" : "1";
    return { ok: true, json: async () => [{ result: { aggregateFields: { total: { integerValue: count } } } }] };
  };
  assert.equal(await functions.countAdminNotifications(user), 3);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.url.endsWith("/documents:runAggregationQuery"), true);
    assert.equal(request.headers.Authorization, "Bearer synthetic-token");
    const aggregation = JSON.parse(request.body).structuredAggregationQuery;
    assert.deepEqual(aggregation.aggregations, [{ alias: "total", count: {} }]);
  }
  const pending = JSON.parse(requests[0].body).structuredAggregationQuery.structuredQuery.where.compositeFilter;
  assert.equal(pending.op, "OR");
  assert.deepEqual(pending.filters.map((filter) => filter.fieldFilter.field.fieldPath), ["personLinkStatus", "personLinkRequest.status"]);
  h.context.fetch = async () => ({ ok: false });
  await assert.rejects(functions.countAdminNotifications(user));
});

test("admin badge hides at zero and refreshes after returning to the member page", async () => {
  const h = harness({ user: { uid: "admin", getIdToken: async () => "synthetic-token" } });
  const functions = memberFunctions(h);
  let count = 0;
  const attributes = new Map();
  const app = { setAttribute: (key, value) => attributes.set(key, value), removeAttribute: (key) => attributes.delete(key) };
  const badge = { dataset: {}, hidden: true, closest: () => app };
  h.document.querySelector = (selector) => selector === "[data-admin-notification-count]" ? badge : null;
  h.context.fetch = async () => ({ ok: true, json: async () => [{ result: { aggregateFields: { total: { integerValue: String(count) } } } }] });
  functions.initAdminAccountBadge(h.auth);
  await new Promise(setImmediate);
  assert.equal(badge.hidden, true);
  count = 1;
  await h.callbacks.pageshow();
  assert.equal(badge.textContent, "2");
  assert.equal(badge.hidden, false);
  assert.match(attributes.get("aria-label"), /2 offene/);
  h.context.fetch = async () => ({ ok: false });
  await h.callbacks.pageshow();
  assert.equal(badge.textContent, "2");
  assert.match(app.title, /nicht geladen/);
});

test("admin search combines name, email, branch, person ID and current role without database reads", () => {
  const h = harness();
  const functions = memberFunctions(h);
  const cards = [
    { dataset: { accountSearch: "Anna Müller anna@example.test Baden", linkedPersonId: "p-123", accountRoleValue: "trainer" } },
    { dataset: { accountSearch: "Ben Nord ben@example.test Heidelberg", linkedPersonId: "p-456", accountRoleValue: "standard" } },
  ];
  const input = { value: "" };
  const summary = {};
  h.document.querySelector = (selector) => ({
    "[data-admin-account-list]": { querySelectorAll: () => cards },
    "[data-admin-account-search]": input,
    "[data-admin-account-search-summary]": summary,
  })[selector] || null;
  for (const query of ["muller anna", "anna@example.test", "baden", "p-123", "trainer"]) {
    input.value = query;
    functions.filterAdminAccounts();
    assert.deepEqual(cards.map((card) => card.hidden), [false, true]);
    assert.equal(summary.textContent, "1 von 2 Konten gefunden.");
  }
  input.value = "unbekannt";
  functions.filterAdminAccounts();
  assert.deepEqual(cards.map((card) => card.hidden), [true, true]);
  input.value = "";
  functions.filterAdminAccounts();
  assert.deepEqual(cards.map((card) => card.hidden), [false, false]);
  assert.equal(summary.textContent, "");
});

test("compact account cards separate profile and database identity and expose controls only in the editor", () => {
  const h = harness();
  const functions = memberFunctions(h);
  const all = (node) => [node, ...node.children.flatMap(all)];
  h.document.createElement = (tagName) => ({
    tagName, dataset: {}, children: [], attributes: {}, classList: { toggle() {} },
    append(...children) { this.children.push(...children); },
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key]; }, focus() { this.focused = true; },
    querySelector(selector) {
      const key = selector.match(/^\[data-(.+)\]$/)[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return all(this).find((node) => key in node.dataset);
    },
  });
  for (const role of ["admin", "standard"]) {
    const card = functions.createAdminAccountCard({ uid: role, data: {
      role, firstName: "Anna", lastName: "Kontoname", birthDate: "1991-05-20", email: "password@example.test", googleEmail: "anna@example.test", dlrgBranch: "Baden",
      personLink: { id: "1234567890abcdef", name: "Anna Datenbankname", birthYear: 2001, gender: "w", organization: "Heidelberg" },
    } });
    const summary = card.querySelector("[data-admin-account-edit]");
    const editor = card.querySelector("[data-admin-account-editor]");
    const values = all(summary).map((node) => node.textContent);
    assert.equal(summary.tagName, "button");
    assert.equal(values.includes("password@example.test"), false);
    assert.match(summary.attributes["aria-label"], /anna@example.test/);
    assert.doesNotMatch(summary.attributes["aria-label"], /password@example.test/);
    for (const value of ["Anna Kontoname (91)", "Baden", "anna@example.test", "Anna Datenbankname (01)", "Heidelberg"]) {
      assert.equal(values.includes(value), true, value);
    }
    assert.equal(values.includes("Rolle"), false);
    assert.equal(values.includes("Konto"), false);
    assert.equal(values.includes("Ergebnisdatenbank"), false);
    assert.equal(all(summary).filter((node) => node.tagName === "button").length, 1);
    assert.equal(editor.hidden, true);
    assert.equal(all(editor).some((node) => "adminAccountLink" in node.dataset), true);
    assert.equal(all(editor).some((node) => "adminAccountUnlink" in node.dataset), true);
    functions.setAdminAccountEditMode(card, true);
    assert.equal(editor.hidden, false);
    assert.equal(summary.getAttribute("aria-expanded"), "true");
    assert.notEqual(card.querySelector("[data-admin-account-role]")?.focused, true);
    assert.equal(card.querySelector("[data-admin-account-cancel]"), undefined);
    for (const key of ["adminAccountLink", "adminAccountUnlink", ...(role === "admin" ? [] : ["adminAccountSave"])]) {
      const button = all(editor).find((node) => key in node.dataset);
      assert.equal(button.textContent, "");
      assert.ok(button.attributes["aria-label"]);
      assert.match(button.innerHTML, /<svg/);
    }
    functions.setAdminAccountEditMode(card, false);
    assert.equal(editor.hidden, true);
    assert.equal(summary.getAttribute("aria-expanded"), "false");
  }
});


function settingsNavigationHarness({ mobile = true, hash = "" } = {}) {
  const h = harness({ url: `https://example.test/club/account-settings.html${hash}` });
  const functions = memberFunctions(h);
  const makeNode = (id) => {
    const classes = new Set();
    return { id, handlers: {}, classList: {
      contains: (name) => classes.has(name),
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
    }, addEventListener(type, fn) { this.handlers[type] = fn; }, setAttribute() {},
    getAttribute: () => `#${id}` };
  };
  const items = ["persoenliche-daten", "sicherheit", "datenschutz"].map(makeNode);
  const categories = items.map((item) => makeNode(item.id));
  const back = makeNode("back");
  h.document.body.classList = makeNode("body").classList;
  h.document.querySelectorAll = (selector) => ({ ".settings-menu-item": items, ".settings-category": categories, "[data-settings-mobile-back]": [back] })[selector] || [];
  h.window.matchMedia = () => ({ matches: mobile, addEventListener() {} });
  const history = [];
  const navigate = (_, __, value) => { history.push(value); h.window.location.hash = new URL(value, h.window.location.href).hash; };
  h.window.history = { pushState: navigate, replaceState: navigate };
  functions.initSettingsMenu();
  return { ...h, items, categories, back, history };
}

test("settings prevent zoom gestures while single-finger scrolling remains available", () => {
  const h = harness();
  const functions = memberFunctions(h);
  functions.initSettingsZoomProtection();
  let prevented = 0;
  const event = (details) => ({ preventDefault() { prevented++; }, ...details });
  h.callbacks.gesturestart(event({}));
  h.callbacks.gesturechange(event({}));
  h.callbacks.touchstart(event({ touches: [{}, {}] }));
  h.callbacks.touchmove(event({ touches: [{}, {}] }));
  h.callbacks.wheel(event({ ctrlKey: true }));
  assert.equal(prevented, 5);
  h.callbacks.touchstart(event({ touches: [{}] }));
  h.callbacks.touchmove(event({ touches: [{}] }));
  h.callbacks.wheel(event({ ctrlKey: false }));
  assert.equal(prevented, 5);
});

test("the account unlink action always targets the signed-in user", async () => {
  const h = harness({ user: { uid: "own-account" } });
  const functions = memberFunctions(h);
  h.window.confirm = () => true;
  const calls = [];
  h.window.LifesavingPersonLinks.unlinkOwn = async (_, uid, __, checkSession) => {
    checkSession(); calls.push(uid); return { role: "standard", personLinkStatus: "open" };
  };
  await functions.unlinkOwnPerson(h.auth, null);
  assert.deepEqual(calls, ["own-account"]);
});

test("mobile settings stay in the menu when delayed role updates refresh navigation", () => {
  const h = settingsNavigationHarness();
  assert.equal(h.document.body.classList.contains("settings-mobile-menu-view"), true);
  h.window.refreshSettingsMenu();
  h.window.refreshSettingsMenu();
  assert.equal(h.window.location.hash, "");
  assert.equal(h.history.length, 0);
  assert.equal(h.document.body.classList.contains("settings-mobile-menu-view"), true);
  h.items[1].handlers.click({ preventDefault() {} });
  assert.equal(h.window.location.hash, "#sicherheit");
  assert.equal(h.document.body.classList.contains("settings-mobile-content-view"), true);
  h.window.refreshSettingsMenu();
  assert.equal(h.window.location.hash, "#sicherheit");
  h.back.handlers.click();
  h.window.refreshSettingsMenu();
  assert.equal(h.window.location.hash, "");
  assert.equal(h.document.body.classList.contains("settings-mobile-menu-view"), true);
});

test("settings navigation preserves direct mobile links and the desktop default category", () => {
  const mobile = settingsNavigationHarness({ hash: "#datenschutz" });
  mobile.window.refreshSettingsMenu();
  assert.equal(mobile.window.location.hash, "#datenschutz");
  assert.equal(mobile.categories[2].hidden, false);
  assert.equal(mobile.document.body.classList.contains("settings-mobile-content-view"), true);
  const desktop = settingsNavigationHarness({ mobile: false });
  desktop.window.refreshSettingsMenu();
  assert.equal(desktop.window.location.hash, "#persoenliche-daten");
  assert.equal(desktop.categories[0].hidden, false);
});

test("admins can save personal profile fields without changing their role", async () => {
  const h = harness({ user: { uid: "admin", email: "admin@example.test", displayName: "Alter Name", emailVerified: true }, stored: { role: "admin" } });
  const functions = memberFunctions(h);
  const form = { dataset: {}, elements: Object.fromEntries(Object.entries({ firstName: "Neuer", lastName: "Name", displayName: "Neuer Name", email: "admin@example.test", dlrgBranch: "Baden", birthDate: "2000-01-01", gender: "maennlich" }).map(([key, value]) => [key, { value }])), querySelectorAll: () => [] };
  const saved = await functions.persistProfileDetails(h.auth, form, null);
  assert.equal(saved, true);
  assert.equal(h.auth.currentUser.displayName, "Neuer Name");
  assert.equal(h.counts.writes.length, 1);
  assert.equal(h.counts.writes[0].dlrgBranch, "Baden");
  assert.equal("role" in h.counts.writes[0], false);
});

test("saving other settings keeps a new profile unnamed until the name is entered", async () => {
  const email = "anna.baden@example.test";
  const user = { uid: "u", email, displayName: "Google Name", emailVerified: true, providerData: [{ providerId: "google.com" }] };
  const h = harness({ user, stored: null });
  const functions = memberFunctions(h);
  await functions.loadFreshUserContext(user);
  const form = {
    dataset: {},
    elements: Object.fromEntries(Object.entries({
      firstName: "", lastName: "", displayName: "", email,
      dlrgBranch: "Baden", birthDate: "", gender: ""
    }).map(([key, value]) => [key, { value }])),
    querySelectorAll: () => [],
  };
  assert.equal(await functions.persistProfileDetails(h.auth, form, null), true);
  assert.equal(h.counts.writes.at(-1).dlrgBranch, "Baden");
  assert.equal(h.counts.writes.at(-1).displayName, "");
  form.elements.firstName.value = "Anna";
  form.elements.lastName.value = "Baden";
  assert.equal(await functions.persistProfileDetails(h.auth, form, null), true);
  assert.equal(h.counts.writes.at(-1).displayName, "Anna Baden");
});

test("Google email metadata follows Firebase providers and clears when Google is unlinked", async () => {
  for (const [providerData, saved, expected] of [
    [[{ providerId: "password" }, { providerId: "google.com", email: "google@example.test" }], "", "google@example.test"],
    [[{ providerId: "password" }], "old-google@example.test", ""],
  ]) {
    const user = { uid: "u", email: "password@example.test", emailVerified: true, providerData };
    const h = harness({ user, stored: { role: "standard", googleEmail: saved } });
    const functions = memberFunctions(h);
    await functions.loadFreshUserContext(user);
    assert.equal(h.counts.writes.at(-1).googleEmail, expected);
    assert.equal(h.counts.writes.at(-1).email, "password@example.test");
  }
});

test("password linking uses the entered address and keeps the Google email in the profile", async () => {
  const googleEmail = "google@example.test";
  const passwordEmail = "password@example.test";
  const user = {
    uid: "linked-user", email: googleEmail, emailVerified: true,
    providerData: [{ providerId: "google.com", email: googleEmail }],
  };
  const h = harness({ user });
  const functions = memberFunctions(h);
  const accountEmail = h.element("account-email");
  h.document.querySelectorAll = (selector) => selector === "[data-account-email]" ? [accountEmail] : [];
  const passwordRow = { dataset: {}, querySelector: (selector) => h.element(selector === "strong" ? "password-email-label" : "password-email-value") };
  const googleRow = { dataset: {}, querySelector: (selector) => h.element(selector === "strong" ? "google-email-label" : "google-email-value") };
  const status = new Set();
  const passwordItem = { classList: { toggle(name, on) { if (on) status.add(name); else status.delete(name); } } };
  const summary = h.element("password-summary");
  const help = h.element("password-help");
  h.document.querySelectorAll = (selector) => ({
    "[data-account-email]": [accountEmail],
    "[data-password-provider-summary]": [summary],
  })[selector] || [];
  h.document.querySelector = (selector) => ({
    '[data-sign-in-email="password"]': passwordRow,
    '[data-sign-in-email="google"]': googleRow,
    "[data-password-provider-item]": passwordItem,
    "[data-password-provider-summary]": summary,
    "[data-password-provider-help]": help,
  })[selector] || null;
  functions.updateAccountProfile({ ...user, email: "legacy@example.test" });
  assert.equal(accountEmail.textContent, googleEmail);
  assert.equal(passwordRow.hidden, true);
  assert.equal(h.element("google-email-label").textContent, "E-Mail");
  assert.equal(googleRow.dataset.emailSection, "");
  h.window.firebase.auth.EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
  const actions = [];
  user.linkWithCredential = async ({ email, password }) => {
    actions.push(["link", email, password]);
    user.email = email;
    user.emailVerified = false;
    user.providerData.push({ providerId: "password", email });
  };
  user.sendEmailVerification = async () => { actions.push(["verify", user.email]); };
  const form = {
    elements: { email: { value: passwordEmail }, newPassword: { value: "synthetic-password" }, repeatPassword: { value: "synthetic-password" } },
    querySelector: () => null,
    reset() {},
    dataset: {},
    classList: { toggle() {} },
    setAttribute() {},
  };
  await functions.changeAccountPassword({ preventDefault() {}, currentTarget: form }, h.auth);
  assert.deepEqual(actions, [["link", passwordEmail, "synthetic-password"], ["verify", passwordEmail]]);
  assert.equal(h.counts.writes.at(-1).uid, "linked-user");
  assert.equal(accountEmail.textContent, googleEmail);
  assert.equal(passwordRow.hidden, false);
  assert.equal(h.element("password-email-value").textContent, passwordEmail);
  assert.equal(h.element("password-email-label").textContent, "Passwort-Mail");
  assert.equal(googleRow.dataset.emailSection, "google");
  functions.updateAccountProfile({ ...user, email: googleEmail });
  assert.equal(passwordRow.hidden, true);
  assert.equal(googleRow.hidden, false);
  assert.equal(h.element("google-email-label").textContent, "E-Mail");
  assert.equal(googleRow.dataset.emailSection, "");

  const changedEmail = "new-password@example.test";
  user.emailVerified = true;
  user.verifyBeforeUpdateEmail = async (email) => { actions.push(["change", email]); };
  form.elements.email.value = changedEmail;
  await functions.savePasswordEmail({ preventDefault() {}, currentTarget: form }, h.auth);
  assert.deepEqual(actions.at(-1), ["change", changedEmail]);
  assert.equal(h.counts.writes.at(-1).pendingEmail, changedEmail);
  assert.equal(user.email, passwordEmail);
  assert.equal(summary.textContent, passwordEmail);
  assert.equal(status.has("is-provider-warning"), true);
  assert.equal(status.has("is-provider-active"), false);
  assert.equal(help.hidden, false);
  assert.match(help.textContent, /new-password@example.test/);
  assert.doesNotMatch(help.textContent, /Passwort-Mail:/);
  assert.equal(h.counts.writes.at(-1).pendingEmailFrom, passwordEmail);

  form.elements.email.value = passwordEmail;
  await functions.savePasswordEmail({ preventDefault() {}, currentTarget: form }, h.auth);
  assert.equal(h.counts.writes.at(-1).pendingEmail, "delete-field");
  assert.equal(h.counts.writes.at(-1).pendingEmailFrom, "delete-field");
  assert.equal(status.has("is-provider-active"), true);
  assert.equal(help.hidden, true);

  for (const nextEmail of ["first-change@example.test", "latest-change@example.test"]) {
    form.elements.email.value = nextEmail;
    await functions.savePasswordEmail({ preventDefault() {}, currentTarget: form }, h.auth);
    assert.equal(h.counts.writes.at(-1).pendingEmail, nextEmail);
    assert.equal(h.counts.writes.at(-1).pendingEmailFrom, passwordEmail);
  }
  assert.doesNotMatch(help.textContent, /first-change/);

  h.window.confirm = () => true;
  user.unlink = async () => { user.providerData = user.providerData.filter((provider) => provider.providerId !== "password"); };
  await functions.unlinkPasswordAccount(h.auth, null);
  assert.equal(h.counts.writes.at(-1).pendingEmail, "delete-field");
  assert.equal(h.counts.writes.at(-1).pendingEmailFrom, "delete-field");
  assert.doesNotMatch(help.textContent, /latest-change/);
});

test("profile synchronization clears obsolete email changes and preserves a newer request", async () => {
  const oldEmail = "old@example.test";
  const requestedEmail = "requested@example.test";
  for (const [email, passwordLinked, from, replacement, clears] of [
    [oldEmail, true, oldEmail, null, false],
    [requestedEmail, true, oldEmail, null, true],
    ["other@example.test", true, oldEmail, null, true],
    [oldEmail, false, oldEmail, null, true],
    [oldEmail, true, undefined, null, true],
    [requestedEmail, true, oldEmail, { pendingEmail: "newer@example.test", pendingEmailFrom: requestedEmail }, false],
  ]) {
    const providerData = [{ providerId: "google.com", email: oldEmail }, ...(passwordLinked ? [{ providerId: "password" }] : [])];
    const stored = {
      uid: "u", email: oldEmail, firstName: "", lastName: "", displayName: "",
      emailVerified: true, providerIds: providerData.map(provider => provider.providerId),
      role: "standard", pendingEmail: requestedEmail,
      ...(from ? { pendingEmailFrom: from } : {}),
    };
    const h = harness({
      user: { uid: "u", email, emailVerified: true, providerData },
      stored,
      ...(replacement ? { transactionData: { ...stored, ...replacement } } : {}),
    });
    const functions = memberFunctions(h);
    const { userData } = await functions.loadFreshUserContext(h.auth.currentUser);
    assert.equal(userData.pendingEmail, clears ? undefined : replacement?.pendingEmail || requestedEmail);
    assert.equal(h.counts.writes.at(-1)?.pendingEmail === "delete-field", clears);
    if (clears) assert.equal(userData.pendingEmailFrom, undefined);
  }
});

test("role refreshes preserve profile photos, names and email in cards for every role", () => {
  const h = harness();
  const functions = memberFunctions(h);
  const node = (dataset = {}, children = []) => {
    const classes = new Set();
    return { dataset, children, value: "", classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name),
    }, get textContent() { return this.value + this.children.map((child) => child.textContent).join(""); },
    set textContent(value) { this.value = value; this.children = []; }, removeAttribute() {} };
  };
  const photo = node({ accountPhotoLarge: "" });
  const initials = node({ accountInitialsLarge: "" });
  const name = node({ accountName: "" });
  const email = node({ accountEmail: "" });
  const label = node({ accountRole: "" });
  const card = node({ accountTypeCard: "" }, [node({}, [photo, initials]), node({}, [name, email, label])]);
  const adminCard = node({ adminAccountCard: "" }, [node({}, [node()])]);
  const all = (item) => [item, ...item.children.flatMap(all)];
  const attributeKey = (attribute) => attribute.replace(/^data-/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  h.document.querySelectorAll = (selectors) => [...all(card), ...all(adminCard)].filter((item) => selectors.split(",").some((selector) => {
    const attribute = selector.trim().match(/^\[([^\]]+)\]$/)?.[1];
    return attribute && attributeKey(attribute) in item.dataset;
  }));
  const user = { uid: "u", displayName: "Anna Baden", email: "anna@example.test", photoURL: "https://example.test/photo.jpg" };
  for (const role of ["admin", "organizer", "trainer", "athlete", "standard"]) {
    functions.updateAccountProfile(user);
    functions.updateAdminAccountCardRole(adminCard, role);
    for (let refresh = 0; refresh < 2; refresh++) functions.updateRoleUi(h.core.getAccountRole({ role }, {}));
    assert.equal(card.children.length, 2, role);
    assert.equal(adminCard.children.length, 1, role);
    assert.equal(name.textContent, user.displayName);
    assert.equal(email.textContent, user.email);
    assert.equal(photo.src, user.photoURL);
    assert.equal(photo.classList.contains("is-hidden"), false);
    assert.equal(initials.classList.contains("is-hidden"), true);
    assert.equal(label.textContent, h.core.getAccountRole({ role }, {}).label);
    assert.equal("accountRole" in card.dataset, false);
    assert.equal(adminCard.dataset.accountRoleValue, role);
  }
  functions.updateAccountProfile({ ...user, photoURL: null });
  assert.equal(photo.classList.contains("is-hidden"), true);
  assert.equal(initials.classList.contains("is-hidden"), false);
  assert.equal(initials.textContent, "AB");
});


function mobileEmailHarness(options = {}) {
  const h = harness(options);
  const form = h.element('[data-auth-form="login"]');
  const email = h.element("mobile-email-input");
  const password = h.element("mobile-password-input");
  const firstName = h.element("mobile-first-name-input");
  const lastName = h.element("mobile-last-name-input");
  const button = h.element("mobile-submit");
  const classes = new Set();
  form.classList = { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) };
  email.value = "anna@example.test";
  password.value = "";
  password.focus = () => { password.focused = true; };
  const inputs = { email, password, firstName, lastName };
  form.querySelector = (selector) => inputs[selector.match(/^input\[name="(\w+)"\]$/)?.[1]] || button;
  Object.defineProperties(form.fields, Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, { get: () => input.value }])));
  const mobile = { matches: true, addEventListener(type, fn) { this.changed = fn; } };
  h.window.matchMedia = (query) => query === "(max-width: 700px)" ? mobile : { matches: false };
  return { ...h, form, email, password, firstName, lastName, mobile };
}

test("opening or restoring mobile login focuses the heading without opening the email keyboard", () => {
  const h = mobileEmailHarness();
  h.login();
  const heading = h.element("#auth-title");
  assert.equal(heading.focused, true);
  assert.notEqual(h.email.focused, true);
  heading.focused = false;
  h.callbacks.pageshow({ persisted: false });
  assert.equal(heading.focused, true);
  assert.notEqual(h.email.focused, true);
});

test("iOS zoom gestures are prevented only in the mobile login layout", () => {
  const h = mobileEmailHarness();
  h.login();
  let prevented = 0;
  const gesture = { preventDefault() { prevented++; } };
  h.callbacks.gesturestart(gesture);
  h.callbacks.gesturechange(gesture);
  assert.equal(prevented, 2);
  h.mobile.matches = false;
  h.callbacks.gesturestart(gesture);
  h.callbacks.gesturechange(gesture);
  assert.equal(prevented, 2);
});

test("mobile fields require a deliberate interaction before editing, including after page restoration", async () => {
  const h = mobileEmailHarness();
  h.login();
  assert.equal(h.email.readOnly, true);
  assert.equal(h.password.readOnly, true);
  h.email.handlers.pointerdown();
  assert.equal(h.email.readOnly, false);
  h.callbacks.pagehide();
  h.callbacks.pageshow({ persisted: true });
  assert.equal(h.email.readOnly, true);
  h.email.handlers.click();
  assert.equal(h.email.readOnly, false);
  assert.equal(h.email.focused, true);
  await h.submit("login");
  assert.equal(h.password.readOnly, false);
  assert.equal(h.password.focused, true);
});

test("desktop fields stay editable and mobile fields support physical keyboards", () => {
  const desktop = mobileEmailHarness();
  desktop.mobile.matches = false;
  desktop.login();
  assert.equal(desktop.email.readOnly, false);
  assert.equal(desktop.password.readOnly, false);
  const mobile = mobileEmailHarness();
  mobile.login();
  mobile.email.handlers.keydown({ key: "Tab" });
  assert.equal(mobile.email.readOnly, true);
  mobile.email.handlers.keydown({ key: "a" });
  assert.equal(mobile.email.readOnly, false);
});

test("mobile email entry reveals the required password only after continuing and resets when the address changes", async () => {
  let requests = 0;
  const h = mobileEmailHarness();
  h.auth.signInWithEmailAndPassword = async () => { requests++; };
  h.login();
  assert.equal(h.form.classList.contains("is-email-step"), true);
  assert.equal(h.password.required, false);
  assert.equal(h.email.placeholder, "Deine E-Mail");
  await h.submit("login");
  assert.equal(requests, 0);
  assert.equal(h.form.classList.contains("is-email-step"), false);
  assert.equal(h.password.required, true);
  assert.equal(h.password.focused, true);
  h.password.value = "test-password";
  h.email.value = "andere@example.test";
  h.email.handlers.input();
  assert.equal(h.password.value, "");
  assert.equal(h.password.required, false);
  assert.equal(h.form.classList.contains("is-email-step"), true);
  h.mobile.matches = false;
  h.mobile.changed();
  assert.equal(h.password.required, false);
  assert.equal(h.form.classList.contains("is-email-step"), true);
  assert.equal(h.email.placeholder, "Deine E-Mail");
  assert.equal(h.email.readOnly, false);
});

test("mobile existing-account sign-in preserves the account and opens member home without registering", async () => {
  const h = mobileEmailHarness({ url: "https://example.test/club/login.html?returnTo=timer%2F%23%2Fevent%2F42", user: { uid: "existing-admin", emailVerified: true } });
  let registrations = 0;
  const credentials = [];
  h.auth.createUserWithEmailAndPassword = async () => { registrations++; };
  h.auth.signInWithEmailAndPassword = async (...values) => { credentials.push(values); h.callbacks.auth(h.auth.currentUser); return { user: h.auth.currentUser }; };
  h.login();
  await h.submit("login");
  h.password.value = "existing-password";
  await h.submit("login");
  assert.deepEqual(credentials, [["anna@example.test", "existing-password"]]);
  assert.equal(registrations, 0);
  assert.equal(h.auth.currentUser.uid, "existing-admin");
  assert.deepEqual(h.counts.redirects, ["https://example.test/club/app.html"]);
  assert.equal(h.counts.writes.length, 0);
});

test("mobile new accounts wait for email verification and continue to member home", async () => {
  const h = mobileEmailHarness({ url: "https://example.test/club/login.html?returnTo=timer%2F%23%2Fevent%2F42" });
  const verification = deferred();
  let verificationSettings;
  h.auth.signInWithEmailAndPassword = async () => { throw { code: "auth/invalid-credential" }; };
  const user = h.prepareUser({ uid: "new", emailVerified: false, sendEmailVerification: async (settings) => { verificationSettings = settings; await verification.promise; } });
  h.auth.createUserWithEmailAndPassword = async () => { h.auth.currentUser = user; h.callbacks.auth(user); return { user }; };
  h.login();
  await h.submit("login");
  h.password.value = "new-password";
  await h.submit("login");
  assert.equal(h.counts.verification, undefined);
  assert.equal(h.form.querySelector('button[type="submit"]').textContent, "Bestätigungsmail senden");
  assert.equal(h.element('[data-form-message="login"]').textContent, "");
  h.firstName.value = "Anna";
  h.lastName.value = "Baden";
  const submitted = h.submit("login");
  await new Promise(setImmediate);
  assert.equal(h.counts.redirects.length, 0);
  assert.equal(new URL(verificationSettings.url).searchParams.has("returnTo"), false);
  verification.resolve();
  await submitted;
  assert.equal(h.counts.redirects.length, 0);
  assert.match(h.element('[data-form-message="login"]').textContent, /Konto erstellt.*bestätige/);
  assert.equal(h.password.value, "");
  assert.equal(h.counts.writes.at(-1).displayName, "Anna Baden");
  user.emailVerified = true;
  h.callbacks.visibilitychange();
  await new Promise(setImmediate);
  assert.deepEqual(h.counts.redirects, ["https://example.test/club/app.html"]);
});

test("an existing address with an incorrect mobile password is never replaced or sent a verification email", async () => {
  const h = mobileEmailHarness();
  let registrations = 0;
  h.auth.signInWithEmailAndPassword = async () => { throw { code: "auth/invalid-credential" }; };
  h.auth.createUserWithEmailAndPassword = async () => { registrations++; throw { code: "auth/email-already-in-use" }; };
  h.login();
  await h.submit("login");
  h.password.value = "wrong-password";
  await h.submit("login");
  assert.equal(registrations, 0);
  h.firstName.value = "Anna";
  h.lastName.value = "Baden";
  await h.submit("login");
  assert.equal(registrations, 1);
  assert.equal(h.auth.currentUser, null);
  assert.match(h.element('[data-form-message="login"]').textContent, /E-Mail oder Passwort stimmt nicht/);
  assert.equal(h.counts.verification, undefined);
  assert.equal(h.counts.redirects.length, 0);
  assert.equal(h.counts.writes.length, 0);
});

test("mobile transient and known-account errors never attempt account creation; desktop wrong passwords stay rejected", async () => {
  for (const code of ["auth/network-request-failed", "auth/too-many-requests", "auth/user-disabled", "auth/wrong-password"]) {
    const h = mobileEmailHarness();
    let registrations = 0;
    h.auth.signInWithEmailAndPassword = async () => { throw { code }; };
    h.auth.createUserWithEmailAndPassword = async () => { registrations++; };
    h.login();
    await h.submit("login");
    h.password.value = "test-password";
    await h.submit("login");
    assert.equal(registrations, 0, code);
    assert.equal(h.counts.redirects.length, 0);
  }
  const desktop = harness();
  desktop.auth.signInWithEmailAndPassword = async () => { throw { code: "auth/invalid-credential" }; };
  desktop.auth.createUserWithEmailAndPassword = async () => { throw { code: "auth/email-already-in-use" }; };
  desktop.login();
  await desktop.submitPassword();
  desktop.element('[data-auth-form="login"]').fields.firstName = "Anna";
  desktop.element('[data-auth-form="login"]').fields.lastName = "Baden";
  await desktop.submit("login");
  assert.match(desktop.element('[data-form-message="login"]').textContent, /E-Mail oder Passwort stimmt nicht/);
});


test("a mobile verification mail failure keeps the new account unverified and offers sending the mail again", async () => {
  const h = mobileEmailHarness({ read: async () => ({ exists: true, data: () => h.counts.writes.at(-1) || {} }) });
  h.auth.signInWithEmailAndPassword = async () => { throw { code: "auth/user-not-found" }; };
  let sends = 0;
  const user = h.prepareUser({ uid: "new", emailVerified: false, sendEmailVerification: async () => {
    sends++;
    if (sends === 1) throw { code: "auth/network-request-failed" };
  } });
  h.auth.createUserWithEmailAndPassword = async () => { h.auth.currentUser = user; h.callbacks.auth(user); return { user }; };
  h.login();
  await h.submit("login");
  h.password.value = "new-password";
  await h.submit("login");
  assert.equal(sends, 0);
  h.firstName.value = "Anna";
  h.lastName.value = "Baden";
  await h.submit("login");
  assert.equal(h.auth.currentUser.uid, "new");
  assert.equal(h.counts.redirects.length, 0);
  assert.match(h.element('[data-form-message="login"]').textContent, /Verbindung/);
  await h.element("[data-resend-verification]").handlers.click();
  assert.equal(sends, 2);
  assert.equal(h.counts.redirects.length, 0);
  assert.match(h.element('[data-form-message="login"]').textContent, /erneut gesendet/);
});


test("desktop password entry stays hidden until the email has been submitted", async () => {
  const h = mobileEmailHarness();
  h.mobile.matches = false;
  let requests = 0;
  h.auth.signInWithEmailAndPassword = async () => { requests++; };
  h.login();
  assert.equal(h.form.classList.contains("is-email-step"), true);
  assert.equal(h.password.required, false);
  await h.submit("login");
  assert.equal(requests, 0);
  assert.equal(h.form.classList.contains("is-email-step"), false);
  assert.equal(h.password.required, true);
  assert.equal(h.password.focused, true);
});


test("the email submit button is disabled for blank input and stays disabled when cleared during a request", async () => {
  const h = mobileEmailHarness();
  h.email.value = "";
  const button = h.form.querySelector('button[type="submit"]');
  const gate = deferred();
  let requests = 0;
  h.auth.signInWithEmailAndPassword = () => { requests++; return gate.promise; };
  h.login();
  assert.equal(button.disabled, true);
  await h.submit("login");
  assert.equal(h.form.classList.contains("is-email-step"), true);
  assert.equal(requests, 0);
  h.email.value = "   ";
  h.email.handlers.input();
  assert.equal(button.disabled, true);
  h.email.value = "anna@example.test";
  h.email.handlers.input();
  assert.equal(button.disabled, false);
  await h.submit("login");
  h.password.value = "synthetic-password";
  const pending = h.submit("login");
  assert.equal(button.disabled, true);
  h.email.value = "";
  h.email.handlers.input();
  gate.resolve({ user: null });
  await pending;
  assert.equal(requests, 1);
  assert.equal(button.disabled, true);
  h.email.value = "anna@example.test";
  h.email.handlers.change();
  assert.equal(button.disabled, false);
});


test("returning from the password step preserves the email and clears the password without an auth request", async () => {
  const h = mobileEmailHarness();
  let requests = 0;
  h.auth.signInWithEmailAndPassword = async () => { requests++; };
  h.login();
  await h.submit("login");
  const summary = h.element("[data-login-email-summary]");
  assert.equal(summary.hidden, false);
  assert.equal(summary.textContent, "anna@example.test");
  assert.equal(h.element("[data-login-divider-copy]").hidden, true);
  assert.equal(h.element("[data-change-email]").hidden, false);
  h.password.value = "synthetic-password";
  h.element("[data-change-email]").handlers.click();
  assert.equal(h.form.classList.contains("is-email-step"), true);
  assert.equal(h.email.value, "anna@example.test");
  assert.equal(h.element("#auth-title").focused, true);
  assert.notEqual(h.email.focused, true);
  assert.equal(h.password.value, "");
  assert.equal(h.password.required, false);
  assert.equal(summary.hidden, true);
  assert.equal(summary.textContent, "");
  assert.equal(h.element("[data-login-divider-copy]").hidden, false);
  assert.equal(h.element("[data-change-email]").hidden, true);
  assert.equal(requests, 0);
});

test("restored registrations require both names and block resending until the transaction commits", async () => {
  const user = { uid: "unfinished", email: "anna@example.test", emailVerified: false };
  const h = mobileEmailHarness({ user, stored: null });
  h.login();
  h.callbacks.auth(h.auth.currentUser);
  await new Promise(setImmediate);
  assert.equal(h.form.classList.contains("is-name-step"), true);
  assert.equal(h.password.required, false);
  assert.equal(h.password.disabled, true);
  assert.equal(h.firstName.required, true);
  assert.equal(h.lastName.required, true);
  await h.element("[data-resend-verification]").handlers.click();
  assert.equal(h.counts.verification, undefined);
  const beforeNames = h.counts.writes.length;
  h.firstName.value = "Anna";
  h.lastName.value = "   ";
  await h.submit("login");
  assert.equal(h.counts.writes.length, beforeNames);
  assert.equal(h.counts.verification, undefined);
  h.lastName.value = " von Baden ";
  const commit = deferred();
  const db = h.window.firebase.firestore();
  const transaction = db.runTransaction;
  db.runTransaction = async (operation) => { const value = await transaction(operation); await commit.promise; return value; };
  const saving = h.submit("login");
  await new Promise(setImmediate);
  assert.equal(h.counts.verification, undefined);
  assert.equal(h.form.querySelector('button[type="submit"]').disabled, true);
  commit.resolve();
  await saving;
  assert.equal(h.counts.writes.at(-1).lastName, "von Baden");
  assert.equal(h.counts.writes.at(-1).accountSetupRequired, false);
  assert.ok(h.counts.verification);
});

test("a failed name save retains the entries for retry and never sends verification", async () => {
  const h = mobileEmailHarness({ user: { uid: "unfinished", emailVerified: false }, stored: { role: "standard" } });
  h.login();
  h.callbacks.auth(h.auth.currentUser);
  await new Promise(setImmediate);
  h.firstName.value = " Anna  Maria ";
  h.lastName.value = "Baden";
  const db = h.window.firebase.firestore();
  const transaction = db.runTransaction;
  db.runTransaction = async () => { throw { code: "permission-denied" }; };
  await h.submit("login");
  assert.equal(h.form.classList.contains("is-name-step"), true);
  assert.equal(h.firstName.value, " Anna  Maria ");
  assert.equal(h.counts.verification, undefined);
  db.runTransaction = transaction;
  await h.submit("login");
  assert.equal(h.counts.writes.at(-1).firstName, "Anna Maria");
  assert.ok(h.counts.verification);
});

test("leaving an unfinished name step signs out and a restored account resumes it", async () => {
  const h = mobileEmailHarness({ user: { uid: "unfinished", email: "anna@example.test", emailVerified: false }, stored: null });
  h.login();
  const user = h.auth.currentUser;
  h.callbacks.auth(user);
  await new Promise(setImmediate);
  h.firstName.value = "Anna";
  await h.element("[data-change-email]").handlers.click();
  assert.equal(h.auth.currentUser, null);
  assert.equal(h.form.classList.contains("is-email-step"), true);
  assert.equal(h.firstName.value, "");
  assert.equal(h.firstName.required, false);
  assert.equal(h.counts.verification, undefined);
  h.auth.currentUser = user;
  h.callbacks.auth(user);
  await new Promise(setImmediate);
  assert.equal(h.form.classList.contains("is-name-step"), true);
});

test("a new session during a name transaction prevents stale writes and verification", async () => {
  const h = mobileEmailHarness({ user: { uid: "unfinished", emailVerified: false }, stored: {} });
  h.login();
  h.callbacks.auth(h.auth.currentUser);
  await new Promise(setImmediate);
  h.firstName.value = "Anna";
  h.lastName.value = "Baden";
  const read = deferred();
  const db = h.window.firebase.firestore();
  db.runTransaction = (operation) => operation({
    get: () => read.promise,
    set: () => assert.fail("stale write"), update: () => assert.fail("stale write"),
  });
  const saving = h.submit("login");
  h.auth.currentUser = h.prepareUser({ uid: "other", emailVerified: false });
  read.resolve({ exists: true, data: () => ({ role: "standard" }) });
  await saving;
  assert.equal(h.counts.verification, undefined);
  assert.equal(h.counts.redirects.length, 0);
});

test("Google names preserve compound given names and surnames before redirecting", async () => {
  for (const mode of ["popup", "direct", "redirect"]) {
    const h = mode === "direct" ? directGoogleHarness({ stored: null }) : harness({ stored: null });
    const user = h.prepareUser({ uid: "google", emailVerified: true, providerData: [{ providerId: "google.com" }] });
    const result = { user, additionalUserInfo: { profile: { given_name: "Anna Maria", family_name: "von Baden", gender: "female", birthday: "2000-01-01" } } };
    const commit = deferred();
    const db = h.window.firebase.firestore();
    const transaction = db.runTransaction;
    db.runTransaction = async (operation) => { const value = await transaction(operation); await commit.promise; return value; };
    const signIn = async () => { h.auth.currentUser = user; h.callbacks.auth(user); return result; };
    if (mode === "redirect") {
      h.window.navigator = { standalone: true };
      h.window.firebaseConfig.authDomain = "example.test";
      h.auth.getRedirectResult = signIn;
    } else if (mode === "direct") h.auth.signInWithCredential = signIn;
    else h.auth.signInWithPopup = signIn;
    h.login();
    let completing;
    if (mode === "direct") {
      await new Promise(setImmediate);
      h.identity.click();
      completing = h.identity.receive({ credential: "synthetic-token" });
    } else if (mode === "popup") completing = h.element("[data-google-login]").handlers.click();
    await new Promise(setImmediate);
    assert.equal(h.counts.redirects.length, 0, mode);
    assert.equal(h.counts.writes.at(-1).firstName, "Anna Maria");
    assert.equal(h.counts.writes.at(-1).lastName, "von Baden");
    assert.equal(h.counts.writes.at(-1).gender, undefined);
    assert.equal(h.counts.writes.at(-1).birthDate, undefined);
    commit.resolve();
    await completing;
    await new Promise(setImmediate);
    assert.equal(h.counts.redirects.length, 1, mode);
  }
});

test("Google seeds only an empty profile and never replaces a saved name or role", async () => {
  for (const stored of [null, { role: "trainer", firstName: "Eigener", lastName: "Name", displayName: "Eigener Name" }]) {
    const h = harness({ user: { uid: "google", providerData: [{ providerId: "google.com" }] }, stored });
    const saved = await h.core.saveAccountName(h.auth.currentUser, { firstName: "Google", lastName: "Name" }, { onlyIfMissing: true });
    assert.equal(saved.role, stored?.role || "standard");
    assert.equal(saved.firstName, stored?.firstName || "Google");
    assert.equal(h.counts.writes.length, stored ? 0 : 1);
  }
});

test("a missing Google surname remains incomplete instead of guessing from the full name", async () => {
  const h = harness({ user: { uid: "google", displayName: "Anna Maria von Baden", providerData: [{ providerId: "google.com" }] }, stored: null });
  const saved = await h.core.saveAccountName(h.auth.currentUser, { firstName: "Anna Maria" }, { onlyIfMissing: true });
  assert.equal(saved.firstName, "Anna Maria");
  assert.equal(saved.lastName, "");
  assert.equal(saved.loginNameCaptured, false);
  assert.equal(saved.accountSetupRequired, false);
});

test("Google profile capture preserves claim-only admin login without creating a standard account", async () => {
  const h = harness({ user: { uid: "admin", emailVerified: true, providerData: [{ providerId: "google.com" }] }, stored: null, token: async () => ({ claims: { admin: true } }) });
  h.auth.signInWithPopup = async () => ({ user: h.auth.currentUser, additionalUserInfo: { profile: { given_name: "Anna", family_name: "Baden" } } });
  h.login();
  await h.element("[data-google-login]").handlers.click();
  assert.equal(h.counts.writes.length, 0);
  assert.equal(h.counts.redirects.length, 1);
});

test("a failed Google name transaction blocks redirect and can be retried", async () => {
  const h = harness({ user: { uid: "google", emailVerified: true, providerData: [{ providerId: "google.com" }] }, stored: null });
  h.auth.signInWithPopup = async () => {
    h.callbacks.auth(h.auth.currentUser);
    return { user: h.auth.currentUser, additionalUserInfo: { profile: { given_name: "Anna", family_name: "Baden" } } };
  };
  const db = h.window.firebase.firestore();
  const transaction = db.runTransaction;
  db.runTransaction = async () => { throw { code: "permission-denied" }; };
  h.login();
  await h.element("[data-google-login]").handlers.click();
  assert.equal(h.counts.redirects.length, 0);
  db.runTransaction = transaction;
  await h.element("[data-google-login]").handlers.click();
  assert.equal(h.counts.writes.at(-1).displayName, "Anna Baden");
  assert.equal(h.counts.redirects.length, 1);
});

test("reloading before submitting a name leaves the email free for a different password", async () => {
  const accounts = new Map();
  const created = [];
  function page() {
    const h = mobileEmailHarness({ stored: null });
    h.window.localStorage = localStore();
    for (const storage of [h.window.localStorage, h.window.sessionStorage]) {
      const set = storage.setItem.bind(storage);
      storage.setItem = (key, value) => {
        assert.equal(String(value).includes("first-draft-password"), false);
        assert.equal(String(value).includes("second-draft-password"), false);
        set(key, value);
      };
    }
    h.auth.signInWithEmailAndPassword = async (email, password) => {
      const account = accounts.get(email);
      if (!account || account.password !== password) throw { code: "auth/invalid-credential" };
      h.auth.currentUser = h.prepareUser(account.user);
      return { user: h.auth.currentUser };
    };
    h.auth.createUserWithEmailAndPassword = async (email, password) => {
      if (accounts.has(email)) throw { code: "auth/email-already-in-use" };
      const user = h.prepareUser({ uid: "new-draft", email, emailVerified: false });
      accounts.set(email, { user, password });
      created.push({ email, password });
      h.auth.currentUser = user;
      h.callbacks.auth(user);
      return { user };
    };
    h.login();
    return h;
  }
  const first = page();
  await first.submit("login");
  first.password.value = "first-draft-password";
  await first.submit("login");
  assert.equal(first.form.classList.contains("is-name-step"), true);
  assert.equal(first.auth.currentUser, null);
  assert.equal(accounts.size, 0);
  assert.equal(first.counts.writes.length, 0);
  assert.equal(first.counts.verification, undefined);
  first.callbacks.pagehide();
  assert.equal(first.form.classList.contains("is-name-step"), false);
  const second = page();
  await second.submit("login");
  second.password.value = "second-draft-password";
  await second.submit("login");
  assert.equal(accounts.size, 0);
  second.firstName.value = "Anna";
  second.lastName.value = "Baden";
  await second.submit("login");
  assert.deepEqual(created, [{ email: "anna@example.test", password: "second-draft-password" }]);
  assert.equal(second.counts.writes.at(-1).displayName, "Anna Baden");
  assert.ok(second.counts.verification);
});

test("incomplete or abandoned name drafts never create an account", async () => {
  const h = mobileEmailHarness();
  let creations = 0;
  h.auth.signInWithEmailAndPassword = async () => { throw { code: "auth/invalid-credential" }; };
  h.auth.createUserWithEmailAndPassword = async () => { creations++; };
  h.login();
  await h.submit("login");
  h.password.value = "draft-password";
  await h.submit("login");
  h.firstName.value = "Anna";
  h.lastName.value = "   ";
  await h.submit("login");
  assert.equal(creations, 0);
  assert.equal(h.counts.writes.length, 0);
  await h.element("[data-change-email]").handlers.click();
  assert.equal(h.form.classList.contains("is-email-step"), true);
  assert.equal(h.firstName.value, "");
  assert.equal(h.password.value, "");
  await h.submit("login");
  assert.equal(creations, 0);
});

test("a failed profile save after final account creation retries without creating another account", async () => {
  const h = mobileEmailHarness({ stored: null });
  let creations = 0;
  h.auth.signInWithEmailAndPassword = async () => { throw { code: "auth/invalid-credential" }; };
  h.auth.createUserWithEmailAndPassword = async () => {
    creations++;
    const user = h.prepareUser({ uid: "saved-draft", email: "anna@example.test", emailVerified: false });
    h.auth.currentUser = user;
    h.callbacks.auth(user);
    return { user };
  };
  h.login();
  await h.submit("login");
  h.password.value = "draft-password";
  await h.submit("login");
  h.firstName.value = "Anna";
  h.lastName.value = "Baden";
  const db = h.window.firebase.firestore();
  const transaction = db.runTransaction;
  db.runTransaction = async () => { throw { code: "permission-denied" }; };
  await h.submit("login");
  assert.equal(creations, 1);
  assert.equal(h.counts.verification, undefined);
  assert.equal(h.form.classList.contains("is-name-step"), true);
  db.runTransaction = transaction;
  await h.submit("login");
  assert.equal(creations, 1);
  assert.ok(h.counts.verification);
});

test("existing unverified accounts cannot be overwritten using a different password", async () => {
  const h = mobileEmailHarness();
  const existing = { uid: "already-created", email: "anna@example.test", emailVerified: false, password: "original-password" };
  h.auth.signInWithEmailAndPassword = async (email, password) => {
    if (email !== existing.email || password !== existing.password) throw { code: "auth/invalid-credential" };
    h.auth.currentUser = h.prepareUser({ uid: existing.uid, email, emailVerified: existing.emailVerified });
    return { user: h.auth.currentUser };
  };
  h.auth.createUserWithEmailAndPassword = async email => {
    assert.equal(email, existing.email);
    throw { code: "auth/email-already-in-use" };
  };
  h.login();
  await h.submit("login");
  h.password.value = "different-password";
  await h.submit("login");
  h.firstName.value = "Anna";
  h.lastName.value = "Baden";
  await h.submit("login");
  assert.equal(existing.password, "original-password");
  assert.equal(h.auth.currentUser, null);
  assert.equal(h.counts.writes.length, 0);
  assert.equal(h.counts.verification, undefined);
  assert.equal(h.password.required, true);
  assert.equal(h.form.classList.contains("is-name-step"), false);
  assert.match(h.element('[data-form-message="login"]').textContent, /E-Mail oder Passwort stimmt nicht/);
  h.password.value = existing.password;
  await h.submit("login");
  assert.equal(h.auth.currentUser.uid, existing.uid);
  assert.equal(h.counts.verification, undefined);
});

test("a session change before the final registration request discards the draft", async () => {
  const h = mobileEmailHarness();
  h.auth.signInWithEmailAndPassword = async () => { throw { code: "auth/invalid-credential" }; };
  let creations = 0;
  h.auth.createUserWithEmailAndPassword = async () => { creations++; };
  h.login();
  await h.submit("login");
  h.password.value = "draft-password";
  await h.submit("login");
  h.firstName.value = "Anna";
  h.lastName.value = "Baden";
  const saving = h.submit("login");
  h.auth.currentUser = h.prepareUser({ uid: "other", emailVerified: true });
  await saving;
  assert.equal(creations, 0);
  assert.equal(h.counts.verification, undefined);
  assert.equal(h.form.classList.contains("is-name-step"), false);
});

function settingsLinkHarness(data) {
  const h = harness({ user: { uid: "u", email: "anna@example.test", emailVerified: true }, stored: data });
  const functions = memberFunctions(h);
  const control = () => ({
    dataset: {}, hidden: false, disabled: false, value: "", textContent: "", innerHTML: "button", handlers: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, addEventListener(type, fn) { this.handlers[type] = fn; },
  });
  const root = control(), form = control(), button = control(), hint = control(), requirements = control(), message = control();
  form.elements = { identityHint: hint };
  root.querySelectorAll = () => [button, hint];
  const controls = {
    "[data-link-management]": root, "[data-link-apply-form]": form,
    "[data-link-apply]": button, "[data-link-apply-requirements]": requirements,
    "[data-link-management-message]": message,
  };
  h.document.querySelector = selector => controls[selector] || null;
  functions.writeUserDocCache("u", data);
  return { ...h, functions, root, form, button, hint, requirements, message };
}
const readyLinkProfile = () => ({ firstName: "Anna", lastName: "Baden", gender: "weiblich", birthDate: "2000-01-01", dlrgBranch: "Baden", role: "standard" });

test("settings enable link requests only after required personal data has been saved", async () => {
  const data = { ...readyLinkProfile(), birthDate: "" };
  const h = settingsLinkHarness(data);
  await h.functions.initLinkManagement(h.auth, data);
  assert.equal(h.button.disabled, true);
  assert.match(h.requirements.textContent, /Geburtsdatum/);
  assert.equal(h.counts.writes.length, 0);
  h.hint.value = "Früher in Heidelberg";
  h.hint.handlers.input();
  h.functions.writeUserDocCache("u", readyLinkProfile());
  h.functions.updateLinkManagementUi(readyLinkProfile());
  assert.equal(h.button.disabled, false);
  assert.equal(h.hint.value, "Früher in Heidelberg");
  assert.equal(h.counts.reads, 0);
});

test("one settings click submits the saved profile with its optional hint and stays in settings", async () => {
  const h = settingsLinkHarness(readyLinkProfile());
  await h.functions.initLinkManagement(h.auth, readyLinkProfile());
  assert.equal(h.counts.writes.length, 0);
  h.hint.value = " Früher in Heidelberg ";
  h.hint.handlers.input();
  await h.form.handlers.submit({ preventDefault() {} });
  const request = h.counts.writes.at(-1).personLinkRequest;
  assert.equal(request.firstName, "Anna");
  assert.equal(request.birthDate, "2000-01-01");
  assert.equal(request.identityHint, "Früher in Heidelberg");
  assert.equal(request.identityConfirmed, true);
  assert.equal(h.button.textContent, "Anfrage aktualisieren");
  assert.equal(h.button.disabled, false);
  assert.equal(h.counts.redirects.length, 0);
});

test("a rejected settings request retains the unsent hint and respects fresh database validation", async () => {
  const h = settingsLinkHarness({ ...readyLinkProfile(), gender: "" });
  await h.functions.initLinkManagement(h.auth, readyLinkProfile());
  h.hint.value = "Mein Hinweis";
  h.hint.handlers.input();
  await h.form.handlers.submit({ preventDefault() {} });
  assert.equal(h.counts.writes.length, 0);
  assert.equal(h.hint.value, "Mein Hinweis");
  assert.match(h.message.textContent, /Persönliche Daten/);
});

test("the retired link-request URL forwards to settings beneath a repository subpath", () => {
  const h = harness({ url: "https://example.test/club/link-request.html?edit=1" });
  const code = source("link-request.html").match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(code, h.context);
  assert.deepEqual(h.counts.redirects, ["https://example.test/club/account-settings.html#verknuepfungen"]);
  assert.equal(h.core.requiresAccountSetup({ accountSetupRequired: true }), false);
});

test("a session change during a settings request neither writes nor updates the new session's message", async () => {
  const h = settingsLinkHarness(readyLinkProfile());
  await h.functions.initLinkManagement(h.auth, readyLinkProfile());
  const read = deferred();
  const db = h.window.firebase.firestore();
  db.runTransaction = operation => operation({
    get: () => read.promise,
    update: () => assert.fail("stale request write"),
  });
  const submitting = h.form.handlers.submit({ preventDefault() {} });
  h.auth.currentUser = h.prepareUser({ uid: "new-session", emailVerified: true });
  h.message.textContent = "Neue Sitzung";
  read.resolve({ exists: true, data: () => readyLinkProfile() });
  await submitting;
  assert.equal(h.message.textContent, "Neue Sitzung");
  assert.equal(h.counts.writes.length, 0);
});
