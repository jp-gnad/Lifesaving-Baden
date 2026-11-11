(function () {
  "use strict";

  const core = window.StartEligibilityCore;
  const byId = (id) => document.getElementById(id);
  const content = byId("se-content");
  const list = byId("se-list");
  const summary = byId("se-summary");
  const seasonSwitch = byId("se-season-switch");
  const currentSeason = byId("se-season-current");
  const nextSeason = byId("se-season-next");
  const importButton = byId("se-import-open");
  const importDialog = byId("se-import-dialog");
  const search = byId("se-search");
  const searchNote = byId("se-search-note");
  const results = byId("se-search-results");
  const editor = byId("se-editor");
  const form = byId("se-form");
  const editorError = byId("se-editor-error");
  const primaryDates = byId("se-primary-dates");
  const extraDetails = byId("se-other-dates");
  const extraDates = byId("se-extra-dates");
  const stageNames = { 1: "Bis Jahresende", 2: "Läuft ab", 3: "Offen" };
  const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const nameOrder = new Intl.Collator("de", { sensitivity: "base" });
  let session;
  let editing;
  let searchTimer;
  let searchSequence = 0;

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function icon(pathData, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (className) svg.setAttribute("class", className);
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", pathData);
    svg.append(path);
    return svg;
  }

  function active(owner) {
    return Boolean(owner && owner === session && owner.auth.currentUser?.uid === owner.uid);
  }

  function nameWithYear({ name, birthYear }) {
    return `${name} (${String(birthYear).slice(-2)})`;
  }

  function rowFor(person, state) {
    const button = node("button", "se-person");
    button.id = `se-person-${person.id}`;
    button.type = "button";
    button.dataset.stage = state.stage;
    button.addEventListener("click", () => openEditor(person));

    const statusIcon = state.stage === 1 ? "M5 12l4 4L19 6" : state.stage === 2 ? "M12 7v5l3 2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" : "M12 6v7m0 4h.01";
    const status = node("span", "se-person-status");
    status.append(icon(statusIcon), node("span", "wt-sr-only", stageNames[state.stage]));

    const details = node("span", "se-person-details");
    details.append(node("strong", "se-person-name", nameWithYear(person)));
    if (state.issues.length) {
      const issues = node("span", "se-issues");
      for (const issue of state.issues) {
        const chip = node("span", "se-issue");
        chip.dataset.stage = issue.stage;
        const issueIcon = issue.kind === "health" ? "M20 5a5 5 0 0 0-8 1 5 5 0 1 0-8 6l8 8 8-8a5 5 0 0 0 0-7Z" : "M6 3h12v18H6zM9 8h6m-6 4h6m-6 4h4";
        const detail = issue.until ? `bis ${dateFormat.format(core.asDate(issue.until))}` : issue.reason;
        chip.append(icon(issueIcon), node("span", "", `${issue.name} ${detail}`));
        issues.append(chip);
      }
      details.append(issues);
    }
    button.append(status, details, icon("m9 6 6 6-6 6", "se-chevron"));
    return button;
  }

  function render() {
    const day = core.today();
    byId("se-year-current").textContent = core.seasonYear(day);
    byId("se-year-next").textContent = core.seasonYear(day, true);
    if (!active(session) || !session.loaded) return;
    session.day = day;
    const groups = new Map(core.groups.map((group) => [group, []]));
    const totals = { 1: 0, 2: 0, 3: 0 };
    for (const person of session.people.values()) {
      const state = core.evaluate(person, day, nextSeason.checked);
      groups.get(state.group).push({ person, state });
      totals[state.stage] += 1;
    }
    for (const stage of [3, 2, 1]) byId(`se-total-${stage}`).textContent = totals[stage];
    summary.hidden = !session.people.size;

    const focused = list.contains(document.activeElement) ? document.activeElement.id : "";
    const fragment = document.createDocumentFragment();
    for (const [group, people] of groups) {
      if (!people.length) continue;
      people.sort((a, b) => b.state.stage - a.state.stage || nameOrder.compare(a.person.name, b.person.name) || a.person.birthYear - b.person.birthYear);
      const section = node("section", "wt-day-group");
      const header = node("div", "wt-day-header");
      header.append(node("h2", "wt-day-heading", group), node("span", "wt-day-total", people.length));
      const card = node("div", "wt-day-card");
      card.append(...people.map(({ person, state }) => rowFor(person, state)));
      section.append(header, card);
      fragment.append(section);
    }
    if (!session.people.size) fragment.append(node("p", "wt-empty", "Noch keine Personen importiert."));
    list.replaceChildren(fragment);
    list.setAttribute("aria-busy", "false");
    if (focused) (byId(focused) || importButton).focus({ preventScroll: true });
  }

  function readPerson(doc) {
    const { name, organization, birthYear, ...data } = doc.data();
    const dates = Object.fromEntries(core.dateKeys.map((key) => [key, data[key] ? core.dateKey(data[key].toDate()) : ""]));
    return { id: doc.id, name, organization, birthYear, ...dates };
  }

  function start(auth, user) {
    stop();
    const db = window.firebase.firestore();
    const collection = db.collection("users").doc(user.uid).collection("startEligibility");
    const owner = { auth, uid: user.uid, db, collection, people: new Map(), loaded: false };
    session = owner;
    content.hidden = false;
    render();
    owner.unsubscribe = collection.onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
      if (!active(owner) || snapshot.metadata.fromCache) return;
      owner.people = new Map(snapshot.docs.map((doc) => [doc.id, readPerson(doc)]));
      owner.loaded = true;
      seasonSwitch.disabled = false;
      importButton.disabled = false;
      render();
    }, () => {
      if (!active(owner)) return;
      stop();
      content.hidden = false;
      list.setAttribute("aria-busy", "false");
      const error = node("p", "wt-empty", "Liste konnte nicht geladen werden. Bitte lade die Seite neu.");
      error.setAttribute("role", "alert");
      list.replaceChildren(error);
    });
    owner.clock = window.setInterval(refreshDay, 30_000);
  }

  function stop() {
    session?.unsubscribe?.();
    window.clearInterval(session?.clock);
    session = null;
    content.hidden = true;
    summary.hidden = true;
    seasonSwitch.disabled = true;
    currentSeason.checked = true;
    importButton.disabled = true;
    importDialog.close();
    editor.close();
    resetSearch();
    setEditorBusy(false);
    resetEditor();
    list.setAttribute("aria-busy", "true");
    const loading = node("p", "wt-empty", "Personen werden geladen …");
    loading.setAttribute("role", "status");
    list.replaceChildren(loading);
  }

  function refreshDay() {
    if (session?.loaded && session.day !== core.today()) render();
  }

  function setSearchBusy(busy) {
    search.disabled = busy;
    importDialog.querySelector("[data-se-close]").disabled = busy;
    results.querySelectorAll("button").forEach((button) => { button.disabled = busy || button.dataset.imported === "true"; });
  }

  function resetSearch() {
    window.clearTimeout(searchTimer);
    searchSequence += 1;
    search.value = "";
    searchNote.textContent = "Mindestens 3 Buchstaben eingeben.";
    results.replaceChildren();
    setSearchBusy(false);
  }

  async function searchDirectory(owner, prefix, sequence) {
    try {
      const matches = await owner.db.collection("timerParticipantDirectory").orderBy("searchName")
        .startAt(prefix).endAt(`${prefix}\uf8ff`).limit(10).get({ source: "server" });
      if (!active(owner) || sequence !== searchSequence || !importDialog.open) return;
      const candidates = matches.docs.map((doc) => {
        const { name, birthYear, organization } = doc.data();
        return { id: doc.id, name, birthYear, organization };
      }).filter(({ name, birthYear, organization }) => typeof name === "string" && name
        && Number.isInteger(birthYear) && birthYear >= 1900 && birthYear <= Number(core.today().slice(0, 4)) && typeof organization === "string");
      searchNote.textContent = candidates.length ? "" : "Keine Person gefunden.";
      results.replaceChildren(...candidates.map((candidate) => {
        const button = node("button", "se-candidate");
        button.type = "button";
        button.disabled = owner.people.has(candidate.id);
        button.dataset.imported = button.disabled;
        const details = node("span", "se-person-details");
        const meta = [candidate.organization, button.disabled ? "Bereits importiert" : ""].filter(Boolean).join(" · ");
        details.append(node("strong", "se-person-name", nameWithYear(candidate)));
        if (meta) details.append(node("span", "se-meta", meta));
        button.append(details, icon(button.disabled ? "m5 12 4 4L19 6" : "M12 5v14M5 12h14"));
        button.addEventListener("click", () => importPerson(owner, candidate, button));
        return button;
      }));
    } catch (error) {
      if (active(owner) && sequence === searchSequence && importDialog.open) searchNote.textContent = "Suche fehlgeschlagen. Bitte erneut suchen.";
    }
  }

  async function importPerson(owner, candidate, button) {
    if (!active(owner) || search.disabled) return;
    setSearchBusy(true);
    searchNote.textContent = "Person wird importiert …";
    const { id, ...identity } = candidate;
    const ref = owner.collection.doc(id);
    const dates = Object.fromEntries(core.dateKeys.map((key) => [key, null]));
    try {
      const person = await owner.db.runTransaction(async (transaction) => {
        const doc = await transaction.get(ref);
        if (!active(owner)) throw new Error("Konto gewechselt.");
        if (doc.exists) return readPerson(doc);
        const timestamp = window.firebase.firestore.FieldValue.serverTimestamp();
        transaction.set(ref, { ...identity, ...dates, createdAt: timestamp, updatedAt: timestamp });
        return candidate;
      });
      if (!active(owner)) return;
      importDialog.close();
      openEditor(person);
    } catch (error) {
      if (!active(owner)) return;
      searchNote.textContent = "Import fehlgeschlagen. Bitte versuche es erneut.";
      setSearchBusy(false);
      button.focus();
    }
  }

  function dateField(key, value, day) {
    const field = node("div", "wt-field");
    const label = node("label", "", core.labels[key]);
    const controls = node("div", "se-date-control");
    const input = node("input");
    input.id = `se-date-${key}`;
    input.type = "date";
    input.name = key;
    input.min = "1900-01-01";
    input.max = day;
    input.value = value || "";
    label.htmlFor = input.id;
    const clear = node("button", "wt-icon-button se-clear-date", "×");
    clear.type = "button";
    clear.setAttribute("aria-label", `${core.labels[key]}: Datum löschen`);
    clear.hidden = !input.value;
    input.addEventListener("input", () => { clear.hidden = !input.value; });
    clear.addEventListener("click", () => {
      input.value = "";
      clear.hidden = true;
      input.focus();
    });
    controls.append(input, clear);
    field.append(label, controls);
    return field;
  }

  function openEditor(person) {
    if (!active(session)) return;
    editing = person;
    const day = core.today();
    const { age, group } = core.evaluate(person, day, nextSeason.checked);
    const exams = age >= 16 && age < 50 ? ["combinedExercise", "rescueSilver"]
      : [age >= 13 ? "rescueBronze" : age >= 10 ? "swimGold" : "swimSilver"];
    const keys = ["healthDeclaration", ...exams];
    byId("se-editor-title").textContent = nameWithYear(person);
    byId("se-editor-meta").textContent = [group, nextSeason.checked && core.seasonYear(day, true), person.organization].filter(Boolean).join(" · ");
    primaryDates.replaceChildren(...keys.map((key) => dateField(key, person[key], day)));
    const remaining = core.dateKeys.filter((key) => !keys.includes(key) && key !== "combinedExercise");
    extraDates.replaceChildren(...remaining.map((key) => dateField(key, person[key], day)));
    extraDetails.open = remaining.some((key) => core.validDate(person[key]));
    setDeleteMode(false);
    setEditorBusy(false);
    editor.showModal();
  }

  function resetEditor() {
    editing = null;
    extraDetails.open = false;
    byId("se-editor-title").textContent = "";
    byId("se-editor-meta").textContent = "";
    primaryDates.replaceChildren();
    extraDates.replaceChildren();
  }

  function setDeleteMode(removing) {
    byId("se-delete-confirm").hidden = !removing;
    byId("se-editor-actions").hidden = removing;
    byId("se-form-fields").hidden = removing;
    editorError.hidden = true;
  }

  function setEditorBusy(busy) {
    form.querySelectorAll("button, input").forEach((element) => { element.disabled = busy; });
  }

  async function changeEntry(action) {
    const owner = session;
    if (!active(owner) || !editing || byId("se-save").disabled) return;
    editorError.hidden = true;
    setEditorBusy(true);
    try {
      await action(owner.collection.doc(editing.id));
      if (active(owner)) editor.close();
    } catch (error) {
      if (!active(owner)) return;
      editorError.textContent = error.code === "not-found" ? "Die Person wurde inzwischen entfernt." : "Änderung fehlgeschlagen. Bitte versuche es erneut.";
      editorError.hidden = false;
    } finally {
      if (active(owner)) setEditorBusy(false);
    }
  }

  seasonSwitch.addEventListener("change", render);
  importButton.addEventListener("click", () => {
    resetSearch();
    importDialog.showModal();
    search.focus();
  });
  importDialog.addEventListener("close", () => { if (!importDialog.open) resetSearch(); });
  importDialog.addEventListener("cancel", (event) => { if (search.disabled) event.preventDefault(); });
  search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    const sequence = ++searchSequence;
    const prefix = core.normalizeSearch(search.value);
    results.replaceChildren();
    searchNote.textContent = prefix.length < 3 ? "Mindestens 3 Buchstaben eingeben." : "Suche …";
    if (prefix.length >= 3) {
      const owner = session;
      searchTimer = window.setTimeout(() => { if (active(owner)) searchDirectory(owner, prefix, sequence); }, 220);
    }
  });
  document.querySelectorAll("[data-se-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

  editor.addEventListener("cancel", (event) => { if (byId("se-save").disabled) event.preventDefault(); });
  editor.addEventListener("close", () => {
    if (editor.open || !editing) return;
    if (active(session)) (byId(`se-person-${editing.id}`) || importButton).focus({ preventScroll: true });
    resetEditor();
  });
  byId("se-remove").addEventListener("click", () => { setDeleteMode(true); byId("se-delete-cancel").focus(); });
  byId("se-delete-cancel").addEventListener("click", () => { setDeleteMode(false); byId("se-remove").focus(); });
  byId("se-delete").addEventListener("click", () => changeEntry((ref) => ref.delete()));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!editing || !byId("se-delete-confirm").hidden) return;
    const today = core.today();
    const changes = {};
    const timestamp = window.firebase.firestore.Timestamp;
    for (const [key, value] of new FormData(form)) {
      if (value && (!core.validDate(value) || value > today)) {
        editorError.textContent = "Bitte prüfe das Datum.";
        editorError.hidden = false;
        form.elements.namedItem(key).focus();
        return;
      }
      if (value !== (editing[key] || "")) changes[key] = value ? timestamp.fromDate(core.asDate(value)) : null;
    }
    if (!Object.keys(changes).length) { editor.close(); return; }
    changes.updatedAt = window.firebase.firestore.FieldValue.serverTimestamp();
    changeEntry((ref) => ref.update(changes));
  });

  window.addEventListener("focus", refreshDay);
  document.addEventListener("visibilitychange", refreshDay);
  window.LifesavingStartEligibility = Object.freeze({ start, stop });
})();
