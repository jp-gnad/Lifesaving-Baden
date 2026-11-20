// Test-only transport: the unmodified production entrypoints still initialize
// auth, roles, profile forms and each feature. No real Firebase SDK is loaded.
(function () {
  "use strict";
  const launchOptions = new URLSearchParams(window.parent.location.search);
  if (launchOptions.get("launch") === "1") document.documentElement.classList.add("app-launching");
  const uid = "bootstrap-admin", records = new Map(), listeners = new Set();
  const stamp = (value = new Date()) => ({ toDate: () => new Date(value), toMillis: () => +new Date(value) });
  const now = stamp(), year = new Date().getFullYear();
  const profile = { firstName: "Anna", lastName: "Baden", displayName: "Anna Baden", email: "anna@example.test", role: "admin", dlrgBranch: "Baden", birthDate: "2001-02-03", gender: "weiblich" };
  if (launchOptions.get("cached") === "1") {
    // Seed only this fixture's account, to exercise pre-network menu counts.
    window.sessionStorage.setItem(`lifesaving-baden:user-doc:${uid}`, JSON.stringify({ uid, cachedAt: Date.now(),
      data: { ...profile, birthDate: "", gender: "" } }));
  } else {
    window.sessionStorage.removeItem(`lifesaving-baden:user-doc:${uid}`);
  }
  records.set(`users/${uid}`, profile);
  records.set(`clubProfiles/${uid}`, { role: "admin", name: "Anna Baden", personId: "", birthYear: 2001, gender: "w", organization: "Baden" });
  records.set("clubs/testclub", { name: "DLRG Testclub", status: "active", responsibilityVersion: 2, needsResponsible: false, managerIds: [uid], createdAt: now, updatedAt: now });
  records.set(`clubs/testclub/people/account_${uid}`, { accountUid: uid, personId: "", name: "Anna Baden", birthYear: 2001, gender: "w", organization: "Baden", activeYears: [year, year + 1], createdAt: now, updatedAt: now,
    swimSilver: null, swimGold: null, rescueBronze: null, rescueSilver: null, rescueGold: null, combinedExercise: null, healthDeclaration: null });
  records.set(`clubAccounts/${uid}`, { clubIds: ["testclub"] });
  records.set(`users/${uid}/worktimeSettings/preferences`, { organizations: ["Baden", "Testclub", ""] });
  records.set("clubDirectory/testclub", { name: "DLRG Testclub" });
  const publish = () => queueMicrotask(() => listeners.forEach((listener) => listener()));
  const valueOf = (value) => value?.toMillis ? value.toMillis() : value;
  const snapshot = (path) => ({ id: path.split("/").pop(), exists: records.has(path), data: () => records.get(path), ref: doc(path), metadata: { fromCache: false } });
  function listen(read, options, receive) {
    const callback = typeof options === "function" ? options : receive;
    const listener = () => callback(read());
    listeners.add(listener); queueMicrotask(listener);
    return () => listeners.delete(listener);
  }
  function save(path, data, merge) {
    const next = merge ? { ...records.get(path) } : {};
    for (const [key, value] of Object.entries(data)) {
      if (value === deletion) delete next[key]; else next[key] = value;
    }
    records.set(path, next);
  }
  function doc(path) { return {
    path, id: path.split("/").pop(), collection: (name) => collection(`${path}/${name}`),
    get: async () => {
      if (path === `users/${uid}`) {
        await new Promise((resolve) => setTimeout(resolve, Number(launchOptions.get("delay")) || 0));
        if (launchOptions.get("fail") === "1") throw Object.assign(new Error("Lokaler Testfehler"), { code: "permission-denied" });
      }
      return snapshot(path);
    },
    set: async (data, options) => { save(path, data, options?.merge); publish(); },
    onSnapshot: (options, receive) => listen(() => snapshot(path), options, receive),
  }; }
  function collection(path, filters = [], limit = Infinity, cursor = null, sort = "__name__", direction = "asc") {
    const compare = (left, right) => {
      const a = valueOf(sort === "__name__" ? left.id : left.data()[sort]), b = valueOf(sort === "__name__" ? right.id : right.data()[sort]);
      return (a < b ? -1 : a > b ? 1 : left.id.localeCompare(right.id)) * (direction === "desc" ? -1 : 1);
    };
    const read = () => ({ metadata: { fromCache: false }, docs: [...records.keys()]
      .filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
      .filter((key) => filters.every(([field, op, value]) => {
        const actual = field === "__name__" ? key.split("/").pop() : records.get(key)[field], a = valueOf(actual), b = valueOf(value);
        return op === "array-contains" ? actual.includes(value) : op === "in" ? value.includes(actual)
          : op === ">=" ? a >= b : op === ">" ? a > b : op === "<" ? a < b : op === "<=" ? a <= b : a === b;
      })).map(snapshot).sort(compare).filter((entry) => !cursor || compare(entry, cursor) > 0).slice(0, limit) });
    return { doc: (id = `new-${Date.now()}`) => doc(`${path}/${id}`),
      get: async () => read(), onSnapshot: (options, receive) => listen(read, options, receive),
      where: (field, op, value) => collection(path, [...filters, [field, op, value]], limit, cursor, sort, direction),
      limit: (size) => collection(path, filters, size, cursor, sort, direction),
      orderBy: (field, order = "asc") => collection(path, filters, limit, cursor, field, order),
      startAfter: (value) => collection(path, filters, limit, value, sort, direction),
    };
  }
  const db = { collection, async runTransaction(action) {
    const writes = [];
    const result = await action({ get: async (ref) => snapshot(ref.path),
      set: (ref, data, options) => writes.push(() => save(ref.path, data, options?.merge)),
      update: (ref, data) => writes.push(() => save(ref.path, data, true)), delete: (ref) => writes.push(() => records.delete(ref.path)),
    });
    writes.forEach((write) => write()); publish(); return result;
  } };
  const user = { uid, email: profile.email, displayName: profile.displayName, emailVerified: true, providerData: [{ providerId: "password" }],
    reload: async () => {}, getIdTokenResult: async () => ({ claims: {} }), getIdToken: async () => "local-test-token",
    updateProfile: async (data) => Object.assign(user, data),
  };
  const auth = { currentUser: user, setPersistence: async () => {}, onAuthStateChanged(receive) { queueMicrotask(() => receive(user)); return () => {}; } };
  const firebaseAuth = () => auth;
  firebaseAuth.Auth = { Persistence: { LOCAL: "local" } };
  const deletion = Symbol("delete");
  const firestore = () => db;
  firestore.FieldValue = { serverTimestamp: () => stamp(), delete: () => deletion };
  firestore.Timestamp = { fromDate: stamp };
  firestore.FieldPath = { documentId: () => "__name__" };
  window.firebase = { apps: [{}], auth: firebaseAuth, firestore };
  window.firebaseConfig = { projectId: "demo-member-bootstrap" };
  window.isFirebaseConfigured = true;
  // srcdoc has an inherited origin but cannot replace its URL with an HTTP
  // path. Preserve the application's hash routing inside this test document.
  for (const method of ["replaceState", "pushState"]) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (state, title, url) => original(state, title,
      url == null ? undefined : `${window.location.href.split("#")[0]}${new URL(url, document.baseURI).hash}`);
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(input, document.baseURI);
    if (url.origin === window.parent.location.origin) return originalFetch(input, options);
    if (url.hostname === "firestore.googleapis.com" && url.pathname.endsWith(":runAggregationQuery")) {
      return Promise.resolve(new Response(JSON.stringify([{ result: { aggregateFields: { total: { integerValue: "0" } } } }]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.reject(new Error("Externe Zugriffe sind in dieser lokalen Fixture gesperrt."));
  };
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || link.getAttribute("href").startsWith("#")) return;
    event.preventDefault();
  }, true);
})();
