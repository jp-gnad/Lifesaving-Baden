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
  const submitted = h.submitPassword();
  gate.resolve();
  await submitted;
  assert.equal(reloads, 1);
  assert.equal(h.counts.reads, 0);
  assert.deepEqual(h.counts.redirects, ["https://example.test/club/app.html"]);
});

test("an unverified account can complete email verification after returning to the page", async () => {
  const h = harness({ user: { uid: "u", emailVerified: false } });
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
  assert.equal(h.window.localStorage.getItem("lifesaving-baden:login-trace-v1"), null);
  assert.equal(h.window.sessionStorage.getItem("lifesaving-baden:google-login-started"), undefined);
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
  assert.deepEqual(next.counts.redirects, ["https://jp-gnad.github.io/Lifesaving-Baden/timer/#/event/42"]);
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
    assert.match(h.element("[data-form-message=\"login\"]").textContent, /nicht geladen/);
    const retry = h.element("[data-google-login]").handlers.click();
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

test("desktop registration uses the shared login form and sends verification without a database SDK", async () => {
  const h = harness({ user: { uid: "new", emailVerified: false } });
  delete h.window.firebase.firestore;
  h.auth.signInWithEmailAndPassword = async () => { throw { code: "auth/invalid-credential" }; };
  h.login();
  h.element('[data-auth-form="login"]').fields = { email: "test@example.test", password: "synthetic-password" };
  await h.submitPassword();
  assert.equal(h.auth.currentUser.uid, "new");
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

test("new account documents preserve registration names and start with the standard role", async () => {
  const h = harness({ user: { uid: "new", displayName: "Anna Maria von Baden" }, stored: null });
  h.core.rememberRegistrationName("new", { firstName: "Anna Maria", lastName: "von Baden", displayName: "Anna Maria von Baden" });
  const [first, second] = await Promise.all([h.core.loadUserContext(h.auth.currentUser), h.core.loadUserContext(h.auth.currentUser)]);
  assert.equal(first, second);
  assert.equal(h.counts.reads, 1);
  assert.equal(h.counts.writes.length, 1);
  assert.equal(first.userData.firstName, "Anna Maria");
  assert.equal(first.userData.lastName, "von Baden");
  assert.equal(first.userData.role, "standard");
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
  vm.runInContext(source("assets/js/auth.js").replace(/\}\)\(\);\s*$/, "window.memberTest = { updateAccountProfile, updateRoleUi, updateAdminAccountCardRole, initSettingsMenu, persistProfileDetails, requireDeletableAccount, loadFreshUserContext, createAdminAccountCard, createAdminAccountRoleSelect, saveAdminAccountChanges, manageGoogleAccount, unlinkGoogleAccount, unlinkPasswordAccount, deleteCurrentAccount };})();"), h.context);
  return h.window.memberTest;
}

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


test("admin account cards expose no editors or request actions while other roles keep their controls", () => {
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
      assert.equal(nodes.some((node) => node.tagName === "input"), false);
      for (const action of ["adminAccountEdit", "adminAccountSave", "adminAccountRequestAction", "adminAccountIssueAction"]) {
        assert.equal(nodes.some((node) => action in node.dataset), false);
      }
    } else {
      assert.deepEqual(select.children.map((option) => option.value), ["organizer", "trainer", "athlete", "standard"]);
      assert.equal(nodes.some((node) => "adminAccountEdit" in node.dataset), true);
    }
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
  const button = h.element("mobile-submit");
  const classes = new Set();
  form.classList = { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) };
  email.value = "anna@example.test";
  password.value = "";
  password.focus = () => { password.focused = true; };
  form.querySelector = (selector) => selector === 'input[name="email"]' ? email : selector === 'input[name="password"]' ? password : button;
  Object.defineProperties(form.fields, { email: { get: () => email.value }, password: { get: () => password.value } });
  const mobile = { matches: true, addEventListener(type, fn) { this.changed = fn; } };
  h.window.matchMedia = (query) => query === "(max-width: 600px), (min-width: 1200px)" ? mobile : { matches: false };
  return { ...h, form, email, password, mobile };
}

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
  assert.equal(h.email.placeholder, "");
});

test("mobile existing-account sign-in preserves the account and exact return route without registering", async () => {
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
  assert.deepEqual(h.counts.redirects, ["https://example.test/club/timer/#/event/42"]);
  assert.equal(h.counts.writes.length, 0);
});

test("mobile new accounts wait for email verification and preserve the original return route", async () => {
  const h = mobileEmailHarness({ url: "https://example.test/club/login.html?returnTo=timer%2F%23%2Fevent%2F42" });
  const verification = deferred();
  let verificationSettings;
  h.auth.signInWithEmailAndPassword = async () => { throw { code: "auth/invalid-credential" }; };
  const user = h.prepareUser({ uid: "new", emailVerified: false, sendEmailVerification: async (settings) => { verificationSettings = settings; await verification.promise; } });
  h.auth.createUserWithEmailAndPassword = async () => { h.auth.currentUser = user; h.callbacks.auth(user); return { user }; };
  h.login();
  await h.submit("login");
  h.password.value = "new-password";
  const submitted = h.submit("login");
  await new Promise(setImmediate);
  assert.equal(h.counts.redirects.length, 0);
  assert.equal(new URL(verificationSettings.url).searchParams.get("returnTo"), "https://example.test/club/timer/#/event/42");
  verification.resolve();
  await submitted;
  assert.equal(h.counts.redirects.length, 0);
  assert.match(h.element('[data-form-message="login"]').textContent, /Konto erstellt.*bestätige/);
  assert.equal(h.password.value, "");
  assert.equal(h.counts.writes.length, 0);
  user.emailVerified = true;
  h.callbacks.visibilitychange();
  await new Promise(setImmediate);
  assert.deepEqual(h.counts.redirects, ["https://example.test/club/timer/#/event/42"]);
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
  assert.match(desktop.element('[data-form-message="login"]').textContent, /E-Mail oder Passwort stimmt nicht/);
});


test("a mobile verification mail failure keeps the new account unverified and offers sending the mail again", async () => {
  const h = mobileEmailHarness();
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
