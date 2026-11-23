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
    competition: "M8 4h8v6a4 4 0 0 1-8 0V4ZM8 6H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 2v6m-4 0h8",
    training: "M6 8h3v8H6zM15 8h3v8h-3zM9 12h6M3 10v4m18-4v4",
    organization: "M9 5H6a1 1 0 0 0-1 1v14h14V6a1 1 0 0 0-1-1h-3m-6-2h6v4H9zm-1 9h8m-8 4h6",
    edit: "m16 3 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14l-1 7Z",
    people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m14-10a4 4 0 0 1 4 4v4M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 0a4 4 0 0 1 0 8",
    add: "M12 5v14M5 12h14", minus: "M5 12h14", next: "m9 6 6 6-6 6", remove: "M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5",
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
  let responsibleClub = "";
  const eventView = adminPage ? null : window.ClubEvents.create({ byId, node, icon, isCurrent: active, getPeople: peopleFor, onChange: render, errorText });

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function managerIdentity(profile) {
    const name = node("span", "club-manager-name", profile ? core.displayName(profile) : "Unbekannt");
    if (profile?.role) name.dataset.role = profile.role;
    return name;
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
    eventView?.stop();
    owner.view += 1;
    owner.rosterStop?.();
    owner.rosterStop = null;
    owner.profileFeed?.clear();
    owner.profileFeed = null;
    owner.searchCache?.clear();
    owner.rowCache?.clear();
    owner.groupCache?.clear();
    owner.rosterState.clear();
    owner.profiles.clear();
    owner.roster.clear();
    owner.loaded = false;
    selectedPerson = null;
    window.StartEligibilityEditor?.close();
    byId("club-person-dialog")?.close();
    byId("club-local-person-dialog")?.close();
    byId("se-import-dialog")?.close();
    resetSearch();
  }

  function stop() {
    const owner = session;
    session = null;
    owner?.stops.forEach((stop) => stop());
    if (owner) {
      cancelClubLoad(owner);
      clearView(owner);
    }
    window.clearInterval(owner?.clock);
    content.hidden = true;
    list.replaceChildren();
    list.setAttribute("aria-busy", "true");
    if (!adminPage) {
      tab = "people";
      byId("club-loading").hidden = true;
      updateClubNavigation();
      byId("club-tabs").hidden = true;
      byId("club-overview").hidden = true;
      byId("club-person-actions").hidden = true;
      byId("se-summary").hidden = true;
      byId("club-people-view").value = "overview";
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
      stops: [], clubs: new Map(), view: 0, profileFeed: null, rowCache: new Map(), groupCache: new Map(), accounts: [], directory: [],
      profiles: new Map(),
      rosterState: window.ClubRosterState.create(), roster: new Map(), loaded: false, clubId: "", day: eligibility.today(),
    };
    session = owner;
    owner.searchCache = window.CollectionPages.searchCache({ check: () => requireCurrent(owner) });
    message();
    if (adminPage) {
      content.hidden = false;
      startAdmin(owner).catch((error) => { if (active(owner)) message(errorText(error)); });
    } else {
      byId("club-loading").hidden = false;
      startClubs(owner);
    }
  }

  function startClubs(owner) {
    const query = owner.role.isAdmin ? owner.db.collection("clubs")
      : owner.db.collection("clubs").where("managerIds", "array-contains", owner.uid)
        .where("responsibilityVersion", "==", 2).where("status", "==", "active");
    owner.stops.push(query.onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
      if (!active(owner) || snapshot.metadata.fromCache) return;
      const clubs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((club) => club.status === "active").sort((a, b) => collator.compare(a.name, b.name));
      owner.clubs = new Map(clubs.map((club) => [club.id, club]));
      if (owner.pendingClub && !owner.clubs.has(owner.pendingClub.id)) cancelClubLoad(owner);
      if (owner.clubId && !owner.clubs.has(owner.clubId)) hideClubView(owner);
      if (owner.clubId) {
        updateClubNavigation(owner);
        render(owner);
      } else if (owner.pendingClub) {
        byId("club-loading").hidden = false;
      } else {
        const requested = new URLSearchParams(window.location.search).get("club");
        const id = owner.clubs.has(requested) ? requested : clubs[0]?.id;
        if (id) selectClub(owner, id);
        else showClubEmpty(owner, "Noch keiner Gliederung zugeordnet.");
      }
    }, () => {
      if (!active(owner)) return;
      cancelClubLoad(owner);
      owner.clubs.clear();
      hideClubView(owner);
      showClubEmpty(owner, "Clubs sind für dieses Konto nicht verfügbar. Bitte aktualisiere die Seite.");
    }));
    owner.clock = window.setInterval(refreshDay, 30_000);
  }

  function updateClubNavigation(owner) {
    const current = owner?.clubs.get(owner.clubId);
    const hasChoices = (owner?.clubs.size || 0) > 1;
    const pending = owner?.pendingClub?.id;
    byId("club-title").textContent = current?.name || "Club-Verwaltung";
    byId("club-switch-name").textContent = current?.name || "Club-Verwaltung";
    byId("club-switch").hidden = !hasChoices;
    byId("club-switch").setAttribute("aria-busy", String(Boolean(pending)));
    byId("club-sidebar").hidden = !hasChoices;
    const dialog = byId("club-switch-dialog");
    if (!hasChoices && dialog.open) dialog.close();
    for (const menu of [byId("club-sidebar"), byId("club-switch-list")]) {
      const existing = new Map(Array.from(menu.children, (button) => [button.dataset.clubId, button]));
      const buttons = hasChoices ? Array.from(owner.clubs.values(), (club) => {
        let button = existing.get(club.id);
        if (!button) {
          button = node("button", "club-choice-item");
          button.type = "button";
          button.dataset.clubId = club.id;
          button.addEventListener("click", () => {
            if (!active(owner) || !owner.clubs.has(club.id)) return;
            if (dialog.open) dialog.close();
            selectClub(owner, club.id);
          });
        }
        if (button.textContent !== club.name) button.textContent = club.name;
        if (club.id === current?.id) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
        if (club.id === pending) button.setAttribute("aria-busy", "true");
        else button.removeAttribute("aria-busy");
        return button;
      }) : [];
      syncChildren(menu, buttons);
    }
  }

  function cancelClubLoad(owner) {
    const pending = owner.pendingClub;
    owner.pendingClub = null;
    pending?.stop?.();
  }

  function hideClubView(owner) {
    clearView(owner);
    owner.clubId = "";
    content.hidden = true;
    list.replaceChildren();
    updateClubNavigation(owner);
  }

  function showClubEmpty(owner, text) {
    message();
    updateClubNavigation(owner);
    byId("club-tabs").hidden = true;
    byId("club-person-actions").hidden = true;
    byId("club-overview").hidden = true;
    byId("club-loading").hidden = true;
    list.replaceChildren(node("p", "wt-empty", text));
    list.setAttribute("aria-busy", "false");
    content.hidden = false;
  }

  function selectClub(owner, id) {
    if (owner.pendingClub?.id === id) return;
    cancelClubLoad(owner);
    message();
    if (id === owner.clubId) { updateClubNavigation(owner); return; }
    const request = { id, stop: null };
    owner.pendingClub = request;
    updateClubNavigation(owner);
    byId("club-loading").hidden = Boolean(owner.clubId);
    if (!owner.clubId) content.hidden = true;
    let view;
    request.stop = owner.db.collection("clubs").doc(id).collection("people").onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
      if (!active(owner) || snapshot.metadata.fromCache || !owner.clubs.has(id)) return;
      const entering = owner.pendingClub === request;
      if (entering) {
        // Keep this listener as the live roster once its first server snapshot arrives.
        owner.pendingClub = null;
        clearView(owner);
        owner.clubId = id;
        owner.rosterStop = request.stop;
        view = owner.view;
        tab = "people";
        updateClubNavigation(owner);
        byId("club-tabs").hidden = false;
      } else if (view === undefined || !active(owner, view)) return;
      owner.roster = new Map(snapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
      owner.rosterState.receive(owner.roster);
      owner.loaded = true;
      profilesFor(owner, [...owner.roster.values()].map((person) => person.accountUid).filter(Boolean));
      if (entering) {
        render(owner);
        byId("club-loading").hidden = true;
        content.hidden = false;
      } else scheduleRender(owner);
    }, () => {
      if (!active(owner)) return;
      if (owner.pendingClub === request) {
        cancelClubLoad(owner);
        if (owner.clubId) {
          updateClubNavigation(owner);
          message("Der Club konnte nicht geladen werden. Bitte versuche es erneut.");
          return;
        }
      } else {
        if (view === undefined || !active(owner, view)) return;
        hideClubView(owner);
        if (owner.pendingClub) { byId("club-loading").hidden = false; return; }
      }
      showClubEmpty(owner, "Der Club konnte nicht geladen werden. Bitte aktualisiere die Seite.");
    });
  }

  function peopleFor(owner) {
    return [...owner.rosterState.project(owner.roster).values()].map((person) => {
      const uid = person.accountUid;
      const profile = uid ? owner.profiles.get(uid) : null;
      const responsible = owner.clubs.get(owner.clubId)?.managerIds.includes(uid);
      const identity = { ...person, ...(profile || {}), role: responsible ? profile?.role : "" };
      const subjectId = identity.id;
      const dates = Object.fromEntries(eligibility.dateKeys.map((key) => [key, person[key] ? eligibility.dateKey(person[key].toDate()) : ""]));
      return { ...identity, ...dates, subjectId };
    });
  }

  function profilesFor(owner, ids) {
    if (!owner.profileFeed) {
      const view = owner.view;
      owner.profileFeed = window.ClubProfileFeed.create({ db: owner.db, isAdmin: owner.role.isAdmin,
        documentId: owner.sdk.FieldPath.documentId(), isCurrent: () => active(owner, view),
        onChange: () => scheduleRender(owner), onError: () => message("Kontorollen konnten nicht aktualisiert werden.") });
      owner.profiles = owner.profileFeed.values;
    }
    owner.profileFeed.sync(ids);
  }

  function scheduleRender(owner) {
    if (owner.renderScheduled) return;
    owner.renderScheduled = true;
    const view = owner.view;
    Promise.resolve().then(() => {
      owner.renderScheduled = false;
      if (!active(owner, view)) return;
      if (adminPage) renderAdmin(owner); else render(owner);
    });
  }

  function syncChildren(parent, children) {
    const keep = new Set(children);
    for (const child of Array.from(parent.children)) if (!keep.has(child)) child.remove();
    children.forEach((child, index) => { if (parent.children[index] !== child) parent.insertBefore(child, parent.children[index] || null); });
  }
  const signature = (value) => JSON.stringify(value, (key, item) => typeof item?.toMillis === "function" ? item.toMillis() : item);

  function render(owner = session) {
    if (!active(owner) || adminPage || !owner.clubId) return;
    const day = eligibility.today();
    owner.day = day;
    byId("se-year-current").textContent = eligibility.seasonYear(day);
    byId("se-year-next").textContent = eligibility.seasonYear(day, true);
    document.querySelectorAll("[data-club-tab]").forEach((button) => {
      if (button.dataset.clubTab === tab) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const peopleTab = tab === "people";
    const eligibilityView = peopleTab && byId("club-people-view").value === "eligibility";
    byId("club-person-actions").hidden = !owner.loaded || !peopleTab || eligibilityView;
    byId("se-summary").hidden = true;
    byId("club-people-view").hidden = !peopleTab;
    byId("se-season-switch").hidden = !peopleTab;
    byId("se-season-switch").disabled = !owner.loaded;
    if (tab !== "events") eventView.stop();
    byId("club-overview").hidden = !owner.loaded;
    if (!owner.loaded) return;
    if (tab === "events") { eventView.render(owner); return; }
    const nextSeason = byId("se-season-next").checked;
    const year = eligibility.seasonYear(day, nextSeason);
    const everyone = peopleFor(owner);
    const people = eligibilityView ? everyone.filter((person) => person.activeYears.includes(year)) : everyone;
    const groups = new Map([...eligibility.groups, "Ohne Jahrgang"].map((group) => [group, []]));
    const totals = { 1: 0, 2: 0, 3: 0 };
    for (const person of people) {
      const state = eligibility.evaluate(person, day, nextSeason);
      totals[state.stage] += 1;
      groups.get(state.group).push({ person, state });
    }
    for (const stage of [3, 2, 1]) byId(`se-total-${stage}`).textContent = totals[stage];
    byId("se-summary").hidden = !eligibilityView || !people.length;
    const focused = list.contains(document.activeElement) ? document.activeElement.id : "";
    const sections = [];
    for (const [group, entries] of groups) {
      if (!entries.length) continue;
      entries.sort((a, b) => (eligibilityView ? b.state.stage - a.state.stage : 0) || collator.compare(a.person.name, b.person.name));
      let section = owner.groupCache.get(group);
      if (!section) {
        section = node("section", "wt-day-group");
        const heading = node("div", "wt-day-header");
        heading.append(node("h2", "wt-day-heading", group), node("span", "wt-day-total"));
        section.append(heading, node("div", "wt-day-card"));
        owner.groupCache.set(group, section);
      }
      section.querySelector(".wt-day-total").textContent = entries.length;
      const rows = entries.map(({ person, state }) => {
        const key = signature({ person, state, eligibilityView, year });
        let cached = owner.rowCache.get(person.id);
        if (cached?.key !== key) { cached = { key, row: personRow(owner, person, state, eligibilityView, year) }; owner.rowCache.set(person.id, cached); }
        return cached.row;
      });
      syncChildren(section.querySelector(".wt-day-card"), rows);
      sections.push(section);
    }
    const present = new Set(everyone.map((person) => person.id));
    for (const id of owner.rowCache.keys()) if (!present.has(id)) owner.rowCache.delete(id);
    syncChildren(list, sections);
    if (!people.length) list.append(node("p", "wt-empty", eligibilityView ? `Keine aktiven Personen für ${year}.` : "Noch keine Personen importiert."));
    list.setAttribute("aria-busy", "false");
    if (focused) byId(focused)?.focus({ preventScroll: true });
    if (selectedPerson && byId("club-person-dialog").open) {
      const current = everyone.find((person) => person.id === selectedPerson.id);
      if (current && current.createdAt.toMillis() === selectedPerson.createdAt.toMillis()) {
        selectedPerson = current;
        updatePersonMenu(owner, current);
      }
      else byId("club-person-dialog").close();
    }
  }

  function personRow(owner, person, state, eligibilityView, year) {
    const row = node("button", "se-person club-person");
    row.id = `${eligibilityView ? "club-person" : "club-person-open"}-${person.id}`;
    row.classList.toggle("is-pending", Boolean(person.pending));
    row.setAttribute("aria-busy", String(Boolean(person.pending)));
    row.type = "button";
    const details = node("span", "se-person-details");
    details.append(node("strong", "se-person-name", core.displayName(person)));
    if (core.isLocalPerson(person)) {
      row.classList.add("is-local");
      details.append(node("span", "wt-sr-only", "Lokal erstellt"));
    }
    const ownEntry = !eligibilityView && person.accountUid === owner.uid;
    const manager = owner.clubs.get(owner.clubId)?.managerIds.includes(person.accountUid);
    const roleLabel = manager ? "Team Manager" : ownEntry ? "Du" : "";
    if (roleLabel) details.append(node("span", "club-role", roleLabel));
    if (eligibilityView) {
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
      row.addEventListener("click", () => { if (person.pending) return; window.StartEligibilityEditor.open({
        person, subjectId: person.subjectId, clubId: owner.clubId, db: owner.db, nextSeason: byId("se-season-next").checked,
        isCurrent: () => active(owner, view), requireCurrent: () => requireCurrent(owner, view),
        onPending: (changes) => optimisticDates(owner, person.id, changes, view),
      }); });
    } else {
      row.classList.add("club-person-roster");
      row.addEventListener("click", () => openPerson(owner, person));
    }
    row.append(details);
    if (!eligibilityView) {
      const enabled = person.activeYears.includes(year);
      const status = node("span", "club-person-activity", enabled ? "Aktiv" : "Inaktiv");
      status.classList.toggle("is-active", enabled);
      row.append(status);
    }
    row.append(icon("next"));
    return row;
  }

  async function toggleActivity(owner, person, year) {
    const view = owner.view;
    if (!active(owner, view) || owner.rosterState.has(person.id)) return;
    const current = owner.roster.get(person.id);
    if (!current || current.createdAt.toMillis() !== person.createdAt.toMillis()) return;
    const enabled = !current.activeYears.includes(year);
    const token = owner.rosterState.begin(person.id, { activeYears: core.activeYears(current.activeYears, year, enabled) });
    const errorElement = byId("club-person-years-error");
    errorElement.hidden = true;
    render(owner);
    try {
      await store.setActive(owner.db, owner.clubId, person.id, year, enabled, owner.sdk, () => requireCurrent(owner, view), person.createdAt);
      if (active(owner, view)) { owner.rosterState.confirm(token); owner.rosterState.receive(owner.roster); }
    } catch (error) {
      owner.rosterState.rollback(token);
      if (active(owner, view)) {
        if (selectedPerson?.id === person.id && byId("club-person-dialog").open) {
          errorElement.textContent = errorText(error);
          errorElement.hidden = false;
        } else message(errorText(error));
      }
    } finally {
      if (active(owner, view)) render(owner);
    }
  }

  function openPerson(owner, person) {
    if (person.pending) return;
    selectedPerson = person;
    byId("club-person-title").textContent = core.displayName(person);
    byId("club-person-error").hidden = true;
    byId("club-person-years-error").hidden = true;
    updatePersonMenu(owner, person);
    byId("club-person-dialog").showModal();
  }

  function updatePersonMenu(owner, person) {
    const currentYear = eligibility.seasonYear(owner.day);
    const pending = owner.rosterState.has(person.id);
    byId("club-person-years").setAttribute("aria-busy", String(pending));
    for (const [id, year] of [["club-person-year-current", currentYear], ["club-person-year-next", currentYear + 1]]) {
      const button = byId(id);
      button.textContent = year;
      button.dataset.year = year;
      button.setAttribute("aria-disabled", String(pending));
      button.setAttribute("aria-pressed", String(person.activeYears.includes(year)));
    }
    const club = owner.clubs.get(owner.clubId);
    const manager = club.managerIds.includes(person.accountUid);
    byId("club-person-meta").textContent = manager ? "Team Manager" : core.isLocalPerson(person) ? "Lokal erstellt" : "";
    const last = manager && club.managerIds.length === 1;
    const protectedManager = manager && !owner.role.isAdmin && person.accountUid !== owner.uid;
    byId("club-person-remove").disabled = last || protectedManager;
    byId("club-person-remove").textContent = person.accountUid === owner.uid ? "Club verlassen" : "Entfernen";
    const lastMessage = "Mindestens ein Team Manager bleibt im Club.";
    if (last || byId("club-person-error").textContent === lastMessage) {
      byId("club-person-error").textContent = last ? lastMessage : "";
      byId("club-person-error").hidden = !last;
    }
  }

  function optimisticDates(owner, id, changes, view) {
    const token = owner.rosterState.begin(id, changes);
    render(owner);
    return {
      confirm() { if (active(owner, view)) { owner.rosterState.confirm(token); owner.rosterState.receive(owner.roster); render(owner); } },
      rollback(error) { owner.rosterState.rollback(token); if (active(owner, view)) { render(owner); message(errorText(error)); } },
    };
  }

  async function removeSelected(owner, person) {
    const clubId = owner.clubId;
    const view = owner.view;
    if (owner.rosterState.has(person.id)) return;
    if (!window.confirm(`${core.displayName(person)} aus ${owner.clubs.get(clubId).name} entfernen? Die Nachweise in diesem Club werden gelöscht.`)) return;
    const token = owner.rosterState.begin(person.id, null);
    byId("club-person-dialog").close();
    render(owner);
    try {
      await store.removePerson(owner.db, clubId, person.id, owner.sdk, () => requireCurrent(owner, view));
      if (active(owner, view)) { owner.rosterState.confirm(token); owner.rosterState.receive(owner.roster); render(owner); }
    } catch (error) {
      owner.rosterState.rollback(token);
      if (active(owner, view)) { render(owner); message(errorText(error)); }
    }
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

  function bindLocalPersonDialog() {
    const dialog = byId("club-local-person-dialog");
    const form = byId("club-local-person-form");
    const error = byId("club-local-person-error");
    const save = byId("club-local-person-save");
    const controls = form.querySelectorAll("input, select, button");
    function setBusy(busy) {
      controls.forEach((control) => { control.disabled = busy; });
      form.setAttribute("aria-busy", String(busy));
      save.textContent = busy ? "Speichert …" : "Speichern";
    }
    byId("club-local-person-open").addEventListener("click", () => {
      if (!active(session) || !session.loaded) return;
      form.reset();
      form.elements.birthYear.max = eligibility.seasonYear(eligibility.today());
      error.hidden = true;
      setBusy(false);
      dialog.showModal();
    });
    dialog.addEventListener("cancel", (event) => { if (save.disabled) event.preventDefault(); });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const owner = session;
      if (!active(owner) || !dialog.open || save.disabled) return;
      const { view, clubId } = owner;
      const details = { name: form.elements.name.value, birthYear: form.elements.birthYear.valueAsNumber, gender: form.elements.gender.value };
      setBusy(true);
      error.hidden = true;
      try {
        await store.createLocalPerson(owner.db, clubId, details, owner.sdk, () => requireCurrent(owner, view));
        if (active(owner, view)) dialog.close();
      } catch (failure) {
        if (active(owner, view)) {
          error.textContent = errorText(failure);
          error.hidden = false;
        }
      } finally {
        if (active(owner, view)) setBusy(false);
      }
    });
  }

  async function searchPeople(owner, prefix, sequence, view) {
    try {
      const matches = await owner.searchCache.read(prefix, () => owner.db.collection("timerParticipantDirectory").orderBy("searchName").startAt(prefix).endAt(`${prefix}\uf8ff`).limit(10).get({ source: "server" }));
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
          const now = Date.now();
          const createdAt = { toMillis: () => now, toDate: () => new Date(now) };
          const token = owner.rosterState.begin(person.id, { ...person, personId: person.id, accountUid: "", activeYears: [], ...core.proofDates(person), createdAt }, true);
          byId("se-import-dialog").close();
          render(owner);
          try {
            const id = await store.importPerson(owner.db, owner.clubId, person.id, owner.sdk, () => requireCurrent(owner, view));
            if (active(owner, view)) { owner.rosterState.confirm(token, id); owner.rosterState.receive(owner.roster); render(owner); }
          } catch (error) {
            owner.rosterState.rollback(token);
            if (active(owner, view)) { render(owner); message(errorText(error)); }
          }
        });
        return button;
      }));
    } catch (error) { if (active(owner, view) && sequence === searchSequence) byId("se-search-note").textContent = "Suche fehlgeschlagen. Bitte erneut suchen."; }
  }

  async function startAdmin(owner) {
    owner.pageCursors = [null]; owner.pageIndex = 0; owner.pageGeneration = 0;
    owner.stops.push(() => { owner.adminStop?.(); owner.profileFeed?.clear(); });
    byId("club-create-open").disabled = false;
    watchAdminPage(owner, 0);
  }

  function watchAdminPage(owner, index) {
    owner.adminStop?.();
    const version = ++owner.pageGeneration;
    owner.pageLoading = true;
    byId("club-admin-previous").disabled = true; byId("club-admin-next").disabled = true;
    let query = owner.db.collection("clubs").orderBy(owner.sdk.FieldPath.documentId()).limit(50);
    if (owner.pageCursors[index]) query = query.startAfter(owner.pageCursors[index]);
    list.setAttribute("aria-busy", "true");
    owner.adminStop = query.onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
      if (!active(owner) || owner.pageGeneration !== version || snapshot.metadata.fromCache) return;
      owner.pageLoading = false;
      owner.pageIndex = index;
      owner.clubs = new Map(snapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
      owner.pageNext = snapshot.docs.length === 50 ? snapshot.docs.at(-1) : null;
      profilesFor(owner, [...owner.clubs.values()].flatMap((club) => club.managerIds));
      owner.migrating ||= new Set();
      for (const club of owner.clubs.values()) if (club.responsibilityVersion !== 2 && club.status === "active" && !owner.migrating.has(club.id)) {
        owner.migrating.add(club.id);
        store.migrateResponsibilities(owner.db, club.id, owner.sdk, () => requireCurrent(owner))
          .catch((error) => { if (active(owner)) message(errorText(error)); })
          .finally(() => owner.migrating.delete(club.id));
      }
      scheduleRender(owner);
    }, () => { if (active(owner) && owner.pageGeneration === version) { owner.pageLoading = false; renderAdmin(owner); list.setAttribute("aria-busy", "false"); message("Gliederungen konnten nicht geladen werden. Bitte erneut versuchen."); } });
  }

  async function prepareAdminChoices(owner, directory = false) {
    const load = async (name) => {
      const pages = window.CollectionPages.create({ collection: owner.db.collection(name), documentId: owner.sdk.FieldPath.documentId(), check: () => requireCurrent(owner) });
      await pages.all(); return pages.docs;
    };
    if (!owner.accountsPromise || Date.now() - (owner.accountsAt || 0) > 30_000 && !owner.choicesLoading) {
      owner.choicesLoading = true;
      owner.accountsPromise = load("users").then((docs) => {
        requireCurrent(owner);
        owner.accounts = docs.map((doc) => ({ uid: doc.id, ...core.profile(doc.data()), email: doc.data().email || "" }))
          .filter((account) => ["trainer", "organizer", "admin"].includes(account.role));
        owner.accountsAt = Date.now();
      }).catch((error) => { owner.accountsPromise = null; throw error; }).finally(() => { owner.choicesLoading = false; });
    }
    if (directory && !owner.directoryPromise) owner.directoryPromise = load("clubDirectory").then((docs) => {
      owner.directory = docs.map((doc) => doc.data().name);
    }).catch((error) => { owner.directoryPromise = null; throw error; });
    await Promise.all([owner.accountsPromise, directory ? owner.directoryPromise : null]);
    requireCurrent(owner);
  }

  function renderAdmin(owner) {
    if (!active(owner)) return;
    owner.adminCards ||= new Map();
    const cards = [...owner.clubs.values()].sort((a, b) => collator.compare(a.name, b.name)).map((club) => {
      const key = signature({ club, profiles: club.managerIds.map((uid) => owner.profiles.get(uid)), deleting: owner.deleting === club.id });
      const previous = owner.adminCards.get(club.id);
      if (previous?.key === key) return previous.card;
      const card = node("article", "club-admin-card");
      if (club.status === "active" && club.managerIds.length === 0) {
        const badge = node("span", "club-notification", "1");
        badge.setAttribute("role", "status");
        badge.setAttribute("aria-label", "1 Meldung: Kein Team Manager");
        card.append(badge);
      }
      const title = node("a", "club-admin-title", club.name);
      title.href = `club-verwaltung.html?club=${encodeURIComponent(club.id)}`;
      const names = node("div", "club-manager-names");
      if (!club.managerIds.length && club.status === "active") names.append(node("span", "club-no-responsible", "Kein Team Manager"));
      for (const uid of club.managerIds) {
        const profile = owner.profiles.get(uid);
        names.append(managerIdentity(profile));
      }
      const body = node("div", "club-admin-body");
      body.append(title, names);
      const manage = node("button", "wt-icon-button");
      manage.type = "button";
      manage.setAttribute("aria-label", `${club.name}: Team Manager verwalten`);
      manage.append(icon("people"));
      manage.disabled = club.status !== "active" || owner.deleting === club.id;
      manage.addEventListener("click", async () => {
        responsibleClub = club.id;
        byId("club-responsible-search").value = "";
        byId("club-responsible-results").replaceChildren();
        byId("club-responsible-error").hidden = true;
        renderResponsible(owner);
        byId("club-responsible-dialog").showModal();
        byId("club-responsible-search").disabled = true;
        try { await prepareAdminChoices(owner); }
        catch (error) { if (active(owner)) message(errorText(error)); }
        finally { if (active(owner)) byId("club-responsible-search").disabled = false; }
      });
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
      const actions = node("div", "club-admin-actions");
      actions.append(manage, remove);
      card.append(body, actions);
      owner.adminCards.set(club.id, { key, card });
      return card;
    });
    for (const id of owner.adminCards.keys()) if (!owner.clubs.has(id)) owner.adminCards.delete(id);
    syncChildren(list, cards);
    const pager = byId("club-admin-pages");
    if (pager) {
      pager.hidden = !owner.pageIndex && !owner.pageNext;
      byId("club-admin-previous").disabled = owner.pageLoading || !owner.pageIndex;
      byId("club-admin-next").disabled = owner.pageLoading || !owner.pageNext;
      byId("club-admin-page").textContent = `Seite ${owner.pageIndex + 1}`;
    }
    if (!cards.length) list.append(node("p", "wt-empty", "Noch keine Gliederungen erstellt."));
    list.setAttribute("aria-busy", "false");
    if (byId("club-responsible-dialog").open) renderResponsible(owner);
  }

  function renderResponsible(owner) {
    const club = owner.clubs.get(responsibleClub);
    if (!club || club.status !== "active") { byId("club-responsible-dialog").close(); return; }
    byId("club-responsible-title").textContent = club.name;
    byId("club-responsible-note").hidden = club.responsibilityVersion === 2;
    byId("club-responsible-members").replaceChildren(...club.managerIds.map((uid) => {
      const profile = owner.profiles.get(uid);
      const row = node("div", "club-responsible-row");
      const name = managerIdentity(profile);
      const remove = node("button", "wt-icon-button");
      remove.type = "button"; remove.append(icon("remove"));
      remove.setAttribute("aria-label", `${profile ? core.displayName(profile) : "Team Manager"}: Zuordnung entfernen`);
      remove.disabled = club.managerIds.length === 1 || Boolean(owner.responsibleBusy);
      remove.addEventListener("click", () => changeResponsible(owner, () => store.removePerson(owner.db, club.id, store.managerKey(uid), owner.sdk, () => requireCurrent(owner), true)));
      row.append(name, remove);
      return row;
    }));
  }

  async function changeResponsible(owner, change) {
    if (!active(owner) || owner.responsibleBusy) return;
    owner.responsibleBusy = true;
    byId("club-responsible-search").disabled = true;
    byId("club-responsible-results").querySelectorAll("button").forEach((button) => { button.disabled = true; });
    byId("club-responsible-error").hidden = true;
    renderResponsible(owner);
    try {
      await change();
      if (active(owner)) {
        byId("club-responsible-search").value = "";
        byId("club-responsible-results").replaceChildren();
      }
    } catch (error) {
      if (active(owner)) { byId("club-responsible-error").textContent = errorText(error); byId("club-responsible-error").hidden = false; }
    } finally {
      owner.responsibleBusy = false;
      if (active(owner)) { byId("club-responsible-search").disabled = false; renderResponsible(owner); }
    }
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
    byId("club-admin-previous")?.addEventListener("click", () => { if (active(session) && !session.pageLoading && session.pageIndex) watchAdminPage(session, session.pageIndex - 1); });
    byId("club-admin-next")?.addEventListener("click", () => {
      if (!active(session) || session.pageLoading || !session.pageNext) return;
      session.pageCursors[session.pageIndex + 1] = session.pageNext;
      watchAdminPage(session, session.pageIndex + 1);
    });
    byId("club-responsible-search").addEventListener("input", () => {
      const owner = session;
      if (!active(owner) || owner.responsibleBusy) return;
      const club = owner.clubs.get(responsibleClub);
      const query = eligibility.normalizeSearch(byId("club-responsible-search").value);
      const matches = query.length < 2 ? [] : owner.accounts.filter((account) => eligibility.normalizeSearch(`${account.name} ${account.email}`).includes(query)).slice(0, 12);
      byId("club-responsible-results").replaceChildren(...matches.map((account) => {
        const button = node("button", "se-candidate", `${core.displayName(account)} · ${roles[account.role]}`);
        button.type = "button";
        button.disabled = club.responsibilityVersion === 2 && club.managerIds.includes(account.uid);
        button.addEventListener("click", () => changeResponsible(owner, async () => {
          await store.assignResponsible(owner.db, club.id, account.uid, owner.sdk, () => requireCurrent(owner));
          if (club.responsibilityVersion !== 2) await store.migrateResponsibilities(owner.db, club.id, owner.sdk, () => requireCurrent(owner), account.uid);
        }));
        return button;
      }));
    });
    byId("club-create-open").addEventListener("click", async () => {
      byId("club-create-form").reset(); selectedName = ""; selectedManager = "";
      byId("club-name-results").replaceChildren(); byId("club-manager-results").replaceChildren();
      byId("club-create-error").hidden = true;
      createState(); byId("club-create-dialog").showModal();
      byId("club-manager-search").disabled = true; byId("club-name").disabled = true;
      const owner = session;
      try { await prepareAdminChoices(owner, true); }
      catch (error) { if (active(owner)) { byId("club-create-error").textContent = errorText(error); byId("club-create-error").hidden = false; } }
      finally { if (active(owner)) { byId("club-manager-search").disabled = false; byId("club-name").disabled = false; } }
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
    bindLocalPersonDialog();
    byId("club-switch").addEventListener("click", () => {
      if (!active(session) || session.clubs.size < 2) return;
      byId("club-switch-dialog").showModal();
      byId("club-switch-list").querySelector('[aria-current="true"]')?.focus();
    });
    byId("club-switch-close").addEventListener("click", () => byId("club-switch-dialog").close());
    document.querySelectorAll("[data-club-tab]").forEach((button) => button.addEventListener("click", () => { tab = button.dataset.clubTab; render(); }));
    byId("club-people-view").addEventListener("change", () => render());
    byId("se-season-switch").addEventListener("change", () => render());
    byId("club-person-years").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-year]");
      if (button && active(session) && selectedPerson) toggleActivity(session, selectedPerson, Number(button.dataset.year));
    });
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
    window.addEventListener("focus", refreshDay);
    document.addEventListener("visibilitychange", refreshDay);
  }
  if (adminPage) window.LifesavingClubsAdmin = Object.freeze({ start, stop });
  else window.LifesavingClubs = Object.freeze({ start, stop });
})();
