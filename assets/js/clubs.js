(function () {
  "use strict";
  const core = window.ClubsCore;
  const eligibility = window.StartEligibilityCore;
  const store = window.ClubsStore;
  const byId = (id) => document.getElementById(id);
  const adminPage = document.body.dataset.page === "gliederungen";
  const content = byId("se-content");
  const list = byId("se-list");
  const collator = new Intl.Collator("de", { sensitivity: "base" });
  const formatDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const roles = { athlete: "Sportler", trainer: "Trainer", organizer: "Organisator", admin: "Admin" };
  const ranks = { standard: 1, athlete: 2, trainer: 3, organizer: 4, admin: 5 };
  const statusNames = { 1: "Bis Jahresende", 2: "Läuft ab", 3: "Offen" };
  const paths = {
    add: "M12 5v14M5 12h14", next: "m9 6 6 6-6 6", remove: "M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5",
    1: "M5 12l4 4L19 6", 2: "M12 7v5l3 2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z", 3: "M12 6v7m0 4h.01",
    health: "M20 5a5 5 0 0 0-8 1 5 5 0 1 0-8 6l8 8 8-8a5 5 0 0 0 0-7Z", exam: "M6 3h12v18H6zM9 8h6m-6 4h6m-6 4h4",
  };
  let session;
  let tab = "people";
  let searchTimer;
  let searchSequence = 0;
  let selectedPerson;
  let selectedManager = "";
  let selectedName = "";

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", paths[name] || paths.exam);
    svg.append(path);
    return svg;
  }

  function active(owner, view = owner?.view) {
    return Boolean(owner && session === owner && owner.auth.currentUser?.uid === owner.uid && owner.view === view);
  }

  function requireCurrent(owner, view = owner.view) {
    if (!active(owner, view)) throw new Error("Die Ansicht hat sich geändert.");
  }

  function message(text = "") {
    byId("club-message").textContent = text;
    byId("club-message").hidden = !text;
  }

  function errorText(error) {
    if (error.code?.startsWith("clubs/")) return error.message;
    if (error.code === "permission-denied") return "Die Aktion ist für dieses Konto nicht erlaubt. Bitte aktualisiere die Ansicht.";
    return "Die Änderung konnte nicht gespeichert werden. Bitte erneut versuchen.";
  }

  function clearView(owner) {
    owner.view += 1;
    owner.rosterStop?.();
    owner.profileStops.forEach((stop) => stop());
    owner.linkStops.forEach((stop) => stop());
    owner.profileStops.clear();
    owner.linkStops.clear();
    owner.personAccounts.clear();
    owner.activityPending.clear();
    owner.profiles.clear();
    owner.roster.clear();
    owner.loaded = false;
    selectedPerson = null;
    window.StartEligibilityEditor?.close();
    byId("club-person-dialog")?.close();
    byId("se-import-dialog")?.close();
    resetSearch();
  }

  function stop() {
    const owner = session;
    session = null;
    owner?.stops.forEach((stop) => stop());
    if (owner) clearView(owner);
    window.clearInterval(owner?.clock);
    content.hidden = true;
    list.replaceChildren(node("p", "wt-empty", "Clubs werden geladen …"));
    list.setAttribute("aria-busy", "true");
    if (!adminPage) {
      byId("club-choice").replaceChildren();
      byId("club-choice").disabled = true;
      byId("se-import-open").disabled = true;
      byId("se-summary").hidden = true;
      byId("se-season-switch").disabled = true;
      byId("se-season-current").checked = true;
      byId("club-person-title").textContent = "";
    } else byId("club-create-open").disabled = true;
    document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  }

  function start(auth, user, role) {
    stop();
    const owner = {
      auth, uid: user.uid, role, db: window.firebase.firestore(), sdk: window.firebase.firestore,
      stops: [], clubs: new Map(), view: 0, profileStops: new Map(), linkStops: new Map(),
      profiles: new Map(), personAccounts: new Map(), activityPending: new Map(),
      roster: new Map(), loaded: false, clubId: "", day: eligibility.today(),
    };
    session = owner;
    content.hidden = false;
    message();
    if (adminPage) startAdmin(owner).catch((error) => { if (active(owner)) message(errorText(error)); });
    else startClubs(owner);
  }

  function startClubs(owner) {
    const query = owner.role.isAdmin ? owner.db.collection("clubs")
      : owner.db.collection("clubs").where("managerIds", "array-contains", owner.uid).where("status", "==", "active");
    owner.stops.push(query.onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
      if (!active(owner) || snapshot.metadata.fromCache) return;
      owner.clubs = new Map(snapshot.docs.filter((doc) => doc.data().status === "active").map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
      const choice = byId("club-choice");
      const clubs = [...owner.clubs.values()].sort((a, b) => collator.compare(a.name, b.name));
      choice.replaceChildren(...clubs.map((club) => { const option = node("option", "", club.name); option.value = club.id; return option; }));
      choice.disabled = !clubs.length;
      const requested = new URLSearchParams(window.location.search).get("club");
      const id = owner.clubs.has(owner.clubId) ? owner.clubId : owner.clubs.has(requested) ? requested : clubs[0]?.id || "";
      choice.value = id;
      if (id !== owner.clubId || !owner.loaded) selectClub(owner, id);
      else render(owner);
    }, () => {
      if (!active(owner)) return;
      clearView(owner);
      list.replaceChildren(node("p", "wt-empty", "Clubs sind für dieses Konto nicht verfügbar. Bitte aktualisiere die Seite."));
      byId("se-import-open").disabled = true;
      byId("club-choice").disabled = true;
    }));
    owner.clock = window.setInterval(refreshDay, 30_000);
  }

  function selectClub(owner, id) {
    clearView(owner);
    owner.clubId = id;
    message();
    byId("se-import-open").disabled = !id;
    byId("se-season-switch").disabled = !id;
    byId("se-summary").hidden = true;
    byId("club-leave").hidden = !id || !owner.clubs.get(id).managerIds.includes(owner.uid);
    document.querySelectorAll("[data-club-tab]").forEach((button) => { button.disabled = !id; });
    if (!id) {
      list.replaceChildren(node("p", "wt-empty", "Noch keiner Gliederung zugeordnet."));
      list.setAttribute("aria-busy", "false");
      return;
    }
    list.replaceChildren(node("p", "wt-empty", "Personen werden geladen …"));
    const view = owner.view;
    owner.rosterStop = owner.db.collection("clubs").doc(id).collection("people").onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
      if (!active(owner, view) || snapshot.metadata.fromCache) return;
      owner.roster = new Map(snapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
      owner.loaded = true;
      reconcile(owner, view);
    }, () => {
      if (!active(owner, view)) return;
      clearView(owner);
      list.replaceChildren(node("p", "wt-empty", "Personen konnten nicht geladen werden. Bitte aktualisiere die Seite."));
    });
  }

  function peopleFor(owner) {
    return [...owner.roster.values()].map((person) => {
      const uid = person.accountUid || owner.personAccounts.get(person.personId);
      const profile = uid ? owner.profiles.get(uid) : null;
      const identity = person.accountUid && profile ? { ...person, ...profile }
        : profile?.personId === person.personId ? { ...person, role: profile.role } : person;
      const subjectId = identity.id;
      const dates = Object.fromEntries(eligibility.dateKeys.map((key) => [key, person[key] ? eligibility.dateKey(person[key].toDate()) : ""]));
      return { ...identity, ...dates, subjectId };
    });
  }

  function reconcile(owner, view) {
    const personIds = new Set([...owner.roster.values()].filter((person) => !person.accountUid).map((person) => person.personId));
    for (const id of personIds) {
      if (owner.linkStops.has(id)) continue;
      owner.linkStops.set(id, owner.db.collection("personAccountLinks").doc(id).onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
        if (!active(owner, view) || snapshot.metadata.fromCache) return;
        owner.personAccounts.set(id, snapshot.exists ? snapshot.data().uid : "");
        reconcile(owner, view);
      }, () => { if (active(owner, view)) message("Kontozuordnungen konnten nicht aktualisiert werden."); }));
    }
    for (const [id, unsubscribe] of owner.linkStops) {
      if (!personIds.has(id)) { unsubscribe(); owner.linkStops.delete(id); owner.personAccounts.delete(id); }
    }
    const accountIds = new Set();
    for (const person of owner.roster.values()) {
      const uid = person.accountUid || owner.personAccounts.get(person.personId);
      if (!uid) continue;
      accountIds.add(uid);
      if (owner.profileStops.has(uid)) continue;
      owner.profileStops.set(uid, owner.db.collection("clubProfiles").doc(uid).onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
        if (!active(owner, view) || snapshot.metadata.fromCache) return;
        owner.profiles.set(uid, snapshot.exists ? snapshot.data() : null);
        reconcile(owner, view);
      }, () => { if (active(owner, view)) message("Kontorollen konnten nicht aktualisiert werden."); }));
    }
    for (const [uid, unsubscribe] of owner.profileStops) {
      if (!accountIds.has(uid)) { unsubscribe(); owner.profileStops.delete(uid); owner.profiles.delete(uid); }
    }
    render(owner);
  }

  function render(owner = session) {
    if (!active(owner) || adminPage) return;
    const day = eligibility.today();
    owner.day = day;
    byId("se-year-current").textContent = eligibility.seasonYear(day);
    byId("se-year-next").textContent = eligibility.seasonYear(day, true);
    document.querySelectorAll("[data-club-tab]").forEach((button) => {
      if (button.dataset.clubTab === tab) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    byId("se-import-open").hidden = tab !== "people";
    byId("se-summary").hidden = tab !== "eligibility";
    if (!owner.loaded) return;
    const nextSeason = byId("se-season-next").checked;
    const year = eligibility.seasonYear(day, nextSeason);
    const everyone = peopleFor(owner);
    const people = tab === "people" ? everyone : everyone.filter((person) => person.activeYears.includes(year));
    const groups = new Map([...eligibility.groups, "Ohne Jahrgang"].map((group) => [group, []]));
    const totals = { 1: 0, 2: 0, 3: 0 };
    for (const person of people) {
      const state = eligibility.evaluate(person, day, nextSeason);
      totals[state.stage] += 1;
      groups.get(state.group).push({ person, state });
    }
    for (const stage of [3, 2, 1]) byId(`se-total-${stage}`).textContent = totals[stage];
    byId("se-summary").hidden = tab !== "eligibility" || !people.length;
    const focused = list.contains(document.activeElement) ? document.activeElement.id : "";
    const sections = [];
    for (const [group, entries] of groups) {
      if (!entries.length) continue;
      entries.sort((a, b) => (tab === "eligibility" ? b.state.stage - a.state.stage : 0) || collator.compare(a.person.name, b.person.name));
      const section = node("section", "wt-day-group");
      const heading = node("div", "wt-day-header");
      heading.append(node("h2", "wt-day-heading", group), node("span", "wt-day-total", entries.length));
      const card = node("div", "wt-day-card");
      card.append(...entries.map(({ person, state }) => personRow(owner, person, state)));
      section.append(heading, card);
      sections.push(section);
    }
    list.replaceChildren(...sections);
    if (!people.length) list.append(node("p", "wt-empty", tab === "people" ? "Noch keine Personen importiert." : `Keine aktiven Personen für ${year}.`));
    list.setAttribute("aria-busy", "false");
    if (focused) byId(focused)?.focus({ preventScroll: true });
    if (selectedPerson && byId("club-person-dialog").open) {
      const current = everyone.find((person) => person.id === selectedPerson.id);
      if (current && current.createdAt.toMillis() === selectedPerson.createdAt.toMillis()) {
        selectedPerson = current;
        updatePersonPermissions(owner, current);
      }
      else byId("club-person-dialog").close();
    }
  }

  function personRow(owner, person, state) {
    const row = node(tab === "eligibility" ? "button" : "div", "se-person club-person");
    row.id = `club-person-${person.id}`;
    if (tab === "eligibility") row.type = "button";
    row.dataset.role = roles[person.role] ? person.role : "";
    const details = node("span", "se-person-details");
    details.append(node("strong", "se-person-name", core.displayName(person)));
    if (roles[row.dataset.role]) details.append(node("span", "club-role", roles[row.dataset.role]));
    if (tab === "eligibility") {
      row.dataset.stage = state.stage;
      const status = node("span", "se-person-status");
      status.append(icon(state.stage), node("span", "wt-sr-only", statusNames[state.stage]));
      row.append(status);
      const issues = node("span", "se-issues");
      for (const issue of state.issues) {
        const chip = node("span", "se-issue");
        chip.dataset.stage = issue.stage;
        chip.append(icon(issue.kind), node("span", "", `${issue.name} ${issue.until ? `bis ${formatDate.format(eligibility.asDate(issue.until))}` : issue.reason}`));
        issues.append(chip);
      }
      details.append(issues);
      const view = owner.view;
      row.addEventListener("click", () => window.StartEligibilityEditor.open({
        person, subjectId: person.subjectId, clubId: owner.clubId, db: owner.db, nextSeason: byId("se-season-next").checked,
        isCurrent: () => active(owner, view), requireCurrent: () => requireCurrent(owner, view),
      }));
    } else if (tab === "people") {
      row.classList.add("club-person-roster");
      const open = node("button", "club-person-open");
      open.id = `club-person-open-${person.id}`;
      open.type = "button";
      open.setAttribute("aria-label", `${core.displayName(person)} verwalten`);
      open.append(details, icon("next"));
      open.addEventListener("click", () => openPerson(owner, person));
      const activity = node("span", "club-year-badges");
      const current = eligibility.seasonYear(eligibility.today());
      for (const activeYear of [current, current + 1]) {
        const key = `${person.id}/${activeYear}`;
        const pending = owner.activityPending.get(key);
        const enabled = pending === undefined ? person.activeYears.includes(activeYear) : pending;
        const badge = node("button", "", `(${String(activeYear).slice(-2)})`);
        badge.id = `club-year-${person.id}-${activeYear}`;
        badge.type = "button";
        badge.setAttribute("aria-disabled", String(pending !== undefined));
        badge.setAttribute("aria-pressed", String(enabled));
        badge.setAttribute("aria-label", `${core.displayName(person)}, ${activeYear} ${enabled ? "aktiv" : "inaktiv"}`);
        badge.addEventListener("click", () => toggleActivity(owner, person, activeYear));
        activity.append(badge);
      }
      row.append(open, activity);
      return row;
    }
    row.append(details);
    if (tab !== "team") row.append(icon("next"));
    return row;
  }

  async function toggleActivity(owner, person, year) {
    const view = owner.view;
    const key = `${person.id}/${year}`;
    if (!active(owner, view) || owner.activityPending.has(key)) return;
    const current = owner.roster.get(person.id);
    if (!current || current.createdAt.toMillis() !== person.createdAt.toMillis()) return;
    const enabled = !current.activeYears.includes(year);
    owner.activityPending.set(key, enabled);
    render(owner);
    try {
      await store.setActive(owner.db, owner.clubId, person.id, year, enabled, owner.sdk, () => requireCurrent(owner, view), person.createdAt);
    } catch (error) {
      if (active(owner, view)) message(errorText(error));
    } finally {
      if (active(owner, view)) { owner.activityPending.delete(key); render(owner); }
    }
  }

  function openPerson(owner, person) {
    selectedPerson = person;
    byId("club-person-title").textContent = core.displayName(person);
    byId("club-person-error").hidden = true;
    updatePersonPermissions(owner, person);
    byId("club-person-dialog").showModal();
  }

  function updatePersonPermissions(owner, person) {
    byId("club-person-meta").textContent = roles[person.role] || "";
    byId("club-person-meta").dataset.role = person.role || "";
    const club = owner.clubs.get(owner.clubId);
    const manager = club.managerIds.includes(person.accountUid);
    const last = manager && club.managerIds.length === 1;
    const higher = !owner.role.isAdmin && person.accountUid && person.accountUid !== owner.uid
      && (!ranks[person.role] || ranks[person.role] > ranks[owner.role.value]);
    byId("club-person-remove").disabled = last || higher;
    byId("club-person-remove").textContent = person.accountUid === owner.uid ? "Club verlassen" : "Entfernen";
    const lastMessage = "Mindestens ein Verantwortlicher bleibt im Club.";
    if (last || byId("club-person-error").textContent === lastMessage) {
      byId("club-person-error").textContent = last ? lastMessage : "";
      byId("club-person-error").hidden = !last;
    }
  }

  async function removeSelected(owner, person) {
    const clubId = owner.clubId;
    const view = owner.view;
    if (!window.confirm(`${core.displayName(person)} aus ${owner.clubs.get(clubId).name} entfernen? Die Nachweise in diesem Club werden gelöscht.`)) return;
    try {
      await store.removePerson(owner.db, clubId, person.id, owner.sdk, () => requireCurrent(owner, view));
      if (active(owner, view)) byId("club-person-dialog").close();
    } catch (error) { if (active(owner, view)) message(errorText(error)); }
  }

  function resetSearch() {
    window.clearTimeout(searchTimer);
    searchSequence += 1;
    if (!byId("se-search")) return;
    byId("se-search").value = "";
    byId("se-search").disabled = false;
    byId("se-search-results").replaceChildren();
    byId("se-search-note").textContent = "Mindestens 3 Buchstaben eingeben.";
  }

  async function searchPeople(owner, prefix, sequence, view) {
    try {
      const matches = await owner.db.collection("timerParticipantDirectory").orderBy("searchName").startAt(prefix).endAt(`${prefix}\uf8ff`).limit(10).get({ source: "server" });
      if (!active(owner, view) || sequence !== searchSequence || !byId("se-import-dialog").open) return;
      const existing = new Set(peopleFor(owner).map((person) => person.personId));
      byId("se-search-note").textContent = matches.empty ? "Keine Person gefunden." : "";
      byId("se-search-results").replaceChildren(...matches.docs.map((doc) => {
        const person = { id: doc.id, ...doc.data() };
        const button = node("button", "se-candidate");
        button.type = "button";
        button.disabled = existing.has(person.id);
        const details = node("span", "se-person-details");
        details.append(node("strong", "se-person-name", core.displayName(person)), node("span", "se-meta", `${person.organization}${button.disabled ? " · Bereits im Club" : ""}`));
        button.append(details, icon(button.disabled ? 1 : "add"));
        button.addEventListener("click", async () => {
          byId("se-search").disabled = true;
          byId("se-search-results").querySelectorAll("button").forEach((result) => { result.disabled = true; });
          try {
            await store.importPerson(owner.db, owner.clubId, person.id, owner.sdk, () => requireCurrent(owner, view));
            if (active(owner, view)) byId("se-import-dialog").close();
          } catch (error) {
            if (!active(owner, view)) return;
            byId("se-search-note").textContent = errorText(error);
            byId("se-search").disabled = false;
            button.disabled = false;
          }
        });
        return button;
      }));
    } catch (error) { if (active(owner, view) && sequence === searchSequence) byId("se-search-note").textContent = "Suche fehlgeschlagen. Bitte erneut suchen."; }
  }

  async function startAdmin(owner) {
    const [accounts, profiles, directory] = await Promise.all([
      owner.db.collection("users").get({ source: "server" }), owner.db.collection("clubProfiles").get({ source: "server" }),
      owner.db.collection("clubDirectory").get({ source: "server" }),
    ]);
    requireCurrent(owner);
    const accountProfiles = accounts.docs.map((doc) => ({ uid: doc.id, ...core.profile(doc.data()), email: doc.data().email || "" }));
    owner.accounts = accountProfiles.filter((account) => ranks[account.role] >= 3);
    const existing = new Map(profiles.docs.map((doc) => [doc.id, doc.data()]));
    const updates = accountProfiles.filter((account) => account.personId || ranks[account.role] >= 3)
      .filter((account) => { const { uid, email, ...data } = account; return Object.keys(data).some((key) => existing.get(uid)?.[key] !== data[key]); });
    for (let offset = 0; offset < updates.length; offset += 8) {
      requireCurrent(owner);
      const batch = owner.db.batch();
      for (const account of updates.slice(offset, offset + 8)) { const { uid, email, ...data } = account; batch.set(owner.db.collection("clubProfiles").doc(uid), data); }
      await batch.commit();
    }
    owner.directory = directory.docs.map((doc) => doc.data().name);
    if (!owner.directory.length) {
      const people = await owner.db.collection("timerParticipantDirectory").get({ source: "server" });
      owner.directory = [...new Set(people.docs.map((doc) => doc.data().organization).filter(Boolean))];
    }
    requireCurrent(owner);
    byId("club-create-open").disabled = false;
    owner.stops.push(owner.db.collection("clubProfiles").onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
      if (!active(owner) || snapshot.metadata.fromCache) return;
      owner.profiles = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
      renderAdmin(owner);
    }));
    owner.stops.push(owner.db.collection("clubs").onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
      if (!active(owner) || snapshot.metadata.fromCache) return;
      owner.clubs = new Map(snapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
      renderAdmin(owner);
    }, () => { if (active(owner)) message("Gliederungen konnten nicht geladen werden."); }));
  }

  function renderAdmin(owner) {
    if (!active(owner)) return;
    const cards = [...owner.clubs.values()].sort((a, b) => collator.compare(a.name, b.name)).map((club) => {
      const card = node("article", "club-admin-card");
      const title = node("a", "club-admin-title", club.name);
      title.href = `club-verwaltung.html?club=${encodeURIComponent(club.id)}`;
      const names = node("div", "club-manager-names");
      for (const uid of club.managerIds) {
        const profile = owner.profiles.get(uid);
        const manager = node("span", "club-manager-name", profile ? core.displayName(profile) : "Verantwortlicher");
        manager.dataset.role = profile?.role || "trainer";
        names.append(manager);
      }
      const body = node("div", "club-admin-body");
      body.append(title, names);
      const remove = node("button", "wt-icon-button", club.status === "deleting" ? "↻" : undefined);
      remove.type = "button";
      remove.setAttribute("aria-label", club.status === "deleting" ? `${club.name}: Löschen fortsetzen` : `${club.name} löschen`);
      if (club.status !== "deleting") remove.append(icon("remove"));
      remove.disabled = owner.deleting === club.id;
      remove.addEventListener("click", async () => {
        if (!window.confirm(`${club.name} mit seinen Personen und Nachweisen löschen?`)) return;
        owner.deleting = club.id;
        renderAdmin(owner);
        try { await store.deleteClub(owner.db, club.id, owner.sdk, () => requireCurrent(owner)); }
        catch (error) { if (active(owner)) message(errorText(error)); }
        finally { owner.deleting = ""; if (active(owner)) renderAdmin(owner); }
      });
      card.append(body, remove);
      return card;
    });
    list.replaceChildren(...cards);
    if (!cards.length) list.append(node("p", "wt-empty", "Noch keine Gliederungen erstellt."));
    list.setAttribute("aria-busy", "false");
  }

  function createState() {
    const manual = byId("club-create-form").elements.namedItem("club-source").value === "new";
    byId("club-create-submit").disabled = !selectedManager || !(manual ? byId("club-name").value.trim() : selectedName);
  }

  function refreshDay() {
    if (active(session) && !adminPage && session.day !== eligibility.today()) {
      byId("club-person-dialog").close();
      window.StartEligibilityEditor.close();
      render(session);
    }
  }

  document.querySelectorAll("[data-club-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  if (adminPage) {
    byId("club-create-open").addEventListener("click", () => {
      byId("club-create-form").reset(); selectedName = ""; selectedManager = "";
      byId("club-name-results").replaceChildren(); byId("club-manager-results").replaceChildren();
      byId("club-create-error").hidden = true;
      createState(); byId("club-create-dialog").showModal();
    });
    byId("club-name").addEventListener("input", () => {
      selectedName = "";
      const manual = byId("club-create-form").elements.namedItem("club-source").value === "new";
      const query = eligibility.normalizeSearch(byId("club-name").value);
      byId("club-name-results").replaceChildren(...(manual || query.length < 2 ? [] : session.directory.filter((name) => eligibility.normalizeSearch(name).includes(query)).slice(0, 12)).map((name) => {
        const button = node("button", "se-candidate", name); button.type = "button";
        button.disabled = session.clubs.has(core.clubId(name));
        button.addEventListener("click", () => { selectedName = name; byId("club-name").value = name; byId("club-name-results").replaceChildren(); createState(); });
        return button;
      }));
      createState();
    });
    byId("club-create-form").querySelectorAll('[name="club-source"]').forEach((input) => input.addEventListener("change", () => {
      selectedName = ""; byId("club-name").value = ""; byId("club-name-results").replaceChildren(); createState();
    }));
    byId("club-manager-search").addEventListener("input", () => {
      selectedManager = "";
      const query = eligibility.normalizeSearch(byId("club-manager-search").value);
      byId("club-manager-results").replaceChildren(...(query.length < 2 ? [] : session.accounts.filter((account) => eligibility.normalizeSearch(`${account.name} ${account.email}`).includes(query)).slice(0, 12)).map((account) => {
        const button = node("button", "se-candidate", `${core.displayName(account)} · ${roles[account.role]}`); button.type = "button";
        button.addEventListener("click", () => { selectedManager = account.uid; byId("club-manager-search").value = core.displayName(account); byId("club-manager-results").replaceChildren(); createState(); });
        return button;
      }));
      createState();
    });
    byId("club-create-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const owner = session;
      if (!active(owner) || !selectedManager || byId("club-create-submit").disabled) return;
      const name = byId("club-create-form").elements.namedItem("club-source").value === "new" ? byId("club-name").value : selectedName;
      const controls = [...byId("club-create-form").querySelectorAll("input, button")];
      controls.forEach((control) => { control.disabled = true; });
      try {
        await store.createClub(owner.db, name, selectedManager, owner.sdk, () => requireCurrent(owner));
        if (active(owner)) byId("club-create-dialog").close();
      } catch (error) {
        if (active(owner)) { byId("club-create-error").textContent = errorText(error); byId("club-create-error").hidden = false; }
      } finally { controls.forEach((control) => { control.disabled = false; }); createState(); }
    });
  } else {
    byId("club-choice").addEventListener("change", () => { if (active(session)) selectClub(session, byId("club-choice").value); });
    document.querySelectorAll("[data-club-tab]").forEach((button) => button.addEventListener("click", () => { tab = button.dataset.clubTab; render(); }));
    byId("se-season-switch").addEventListener("change", () => render());
    byId("se-import-open").addEventListener("click", () => { resetSearch(); byId("se-import-dialog").showModal(); byId("se-search").focus(); });
    byId("se-import-dialog").querySelector("[data-se-close]").addEventListener("click", () => byId("se-import-dialog").close());
    byId("se-import-dialog").addEventListener("close", resetSearch);
    byId("se-search").addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      const sequence = ++searchSequence;
      const owner = session;
      const prefix = eligibility.normalizeSearch(byId("se-search").value);
      byId("se-search-results").replaceChildren();
      byId("se-search-note").textContent = prefix.length < 3 ? "Mindestens 3 Buchstaben eingeben." : "Suche …";
      if (prefix.length >= 3 && active(owner)) {
        const view = owner.view;
        searchTimer = window.setTimeout(() => { if (active(owner, view)) searchPeople(owner, prefix, sequence, view); }, 220);
      }
    });
    byId("club-person-remove").addEventListener("click", () => { if (active(session) && selectedPerson) removeSelected(session, selectedPerson); });
    byId("club-leave").addEventListener("click", () => {
      if (!active(session)) return;
      const person = peopleFor(session).find((person) => person.accountUid === session.uid);
      if (person) removeSelected(session, person);
    });
    window.addEventListener("focus", refreshDay);
    document.addEventListener("visibilitychange", refreshDay);
  }
  if (adminPage) window.LifesavingClubsAdmin = Object.freeze({ start, stop });
  else window.LifesavingClubs = Object.freeze({ start, stop });
})();
