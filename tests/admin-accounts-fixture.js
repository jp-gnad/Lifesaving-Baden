// Loaded only by the local account browser fixtures. No network writes or Firebase SDK.
(async function () {
  const settingsPreview = document.body.dataset.previewPage === "settings";
  const people = [
    { id: "1234567890abcdef", name: "Anna Archiv", birthYear: 1991, gender: "w", organization: "Baden", searchName: "annaarchiv" },
    { id: "abcdef1234567890", name: "Anna Zweite", birthYear: 2001, gender: "w", organization: "Heidelberg", searchName: "annazweite" },
    { id: "1122334455667788", name: "Ben Beispiel", birthYear: 1998, gender: "m", organization: "Ettlingen", searchName: "benbeispiel" },
  ];
  const { id, searchName, ...identity } = people[1];
  const records = new Map([
    ["users/admin", { role: "admin", email: "admin@example.test", firstName: "Martin", lastName: "Admin", birthDate: "1978-01-03", dlrgBranch: "Baden" }],
    ["users/member", { role: "standard", email: "mitglied@example.test", firstName: "Anna", lastName: "Eigenname", birthDate: "1991-05-20", dlrgBranch: "Baden", personLinkStatus: "requested",
      personLinkRequest: { status: "requested", firstName: "Anna", lastName: "Archiv", birthDate: "1991-05-20", dlrgBranch: "Baden", identityHint: "Teilnahme 2010" } }],
    ["users/linked", { role: "trainer", email: "anderes-konto@example.test", googleEmail: "bea.google@example.test", firstName: "Bea", lastName: "Kontoname", birthDate: "2001-02-14", dlrgBranch: "Ettlingen", personLink: { id, ...identity }, personLinkStatus: "linked", personLinkIssue: { status: "reported", message: "Die Verknüpfung gehört nicht zu meiner Person." } }],
    [`personAccountLinks/${id}`, { uid: "linked" }],
    ...people.map((person) => { const { id, ...data } = person; return [`timerParticipantDirectory/${id}`, data]; }),
  ]);
  const snapshot = (path) => ({ id: path.split("/").at(-1), exists: records.has(path), data: () => records.get(path) });
  const ref = (path) => ({ path, get: async () => snapshot(path), update: async (data) => update(path, data) });
  function update(path, data) {
    const result = structuredClone(records.get(path) || {});
    for (const [field, value] of Object.entries(data)) {
      const keys = field.split(".");
      const key = keys.pop();
      let parent = result;
      for (const part of keys) parent = parent[part] ||= {};
      if (value === "delete-field") delete parent[key];
      else parent[key] = value;
    }
    records.set(path, result);
  }
  const collection = (name, prefix = "", maximum = Infinity) => ({
    doc: (id) => ref(`${name}/${id}`),
    orderBy: () => collection(name, prefix, maximum),
    startAt: (value) => collection(name, value, maximum),
    endAt: () => collection(name, prefix, maximum),
    limit: (value) => collection(name, prefix, value),
    get: async () => {
      const docs = [...records.keys()].filter((path) => path.startsWith(`${name}/`) && path.split("/").length === 2
        && (!prefix || records.get(path).searchName.startsWith(prefix))).slice(0, maximum).map(snapshot);
      return { docs, size: docs.length };
    },
  });
  const db = { collection, runTransaction: async (action) => {
    const writes = [];
    const result = await action({ get: async (ref) => snapshot(ref.path),
      set: (ref, data) => writes.push(() => records.set(ref.path, data)),
      update: (ref, data) => writes.push(() => update(ref.path, data)),
      delete: (ref) => writes.push(() => records.delete(ref.path)),
    });
    writes.forEach((write) => write());
    return result;
  } };
  if (settingsPreview) {
    delete records.get("users/linked").personLinkIssue;
    // The isolated test page confirms in-memory unlinking without a blocking native dialog.
    window.confirm = () => true;
  }
  const auth = { currentUser: settingsPreview
    ? { uid: "linked", email: "bea.google@example.test", displayName: "Bea Kontoname", providerData: [] }
    : { uid: "admin", email: "admin@example.test" } };
  const firestore = () => db;
  firestore.FieldValue = { delete: () => "delete-field", serverTimestamp: () => new Date() };
  window.firebase = { apps: [{}], auth: () => auth, firestore };
  document.body.dataset.page = "admin-preview";
  const response = await fetch("assets/js/auth.js");
  const script = document.createElement("script");
  window.fixtureProfile = records.get(auth.currentUser.uid === "linked" ? "users/linked" : "users/admin");
  const initialize = settingsPreview
    ? "initSettingsZoomProtection(); writeUserDocCache(window.firebase.auth().currentUser.uid, window.fixtureProfile); window.adminPreviewReady = initLinkManagement(window.firebase.auth(), window.fixtureProfile);"
    : "window.adminPreviewReady = initAdminAccounts(window.firebase.auth(), { isAdmin: true });";
  script.textContent = (await response.text()).replace(/\}\)\(\);\s*$/, `${initialize}})();`);
  document.body.append(script);
  document.body.classList.remove("auth-context-loading");
  if (!settingsPreview) document.querySelector("[data-admin-accounts]").classList.remove("is-hidden");
  await window.adminPreviewReady;
  document.body.dataset.page = settingsPreview ? "settings" : "admin-accounts";
  if (settingsPreview) {
    document.body.classList.add("settings-mobile-content-view");
    const links = document.querySelector("#verknuepfungen");
    links.hidden = false;
    links.setAttribute("aria-hidden", "false");
    links.classList.remove("is-hidden");
    document.querySelector("[data-link-management-details]").open = true;
  }
})();
