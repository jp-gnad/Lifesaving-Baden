(function (root) {
  "use strict";

  function create(dependencies) {
    const {
      app, api, saveInBackground, validateParticipant, eventCan, compareParticipantsByOrganization, personAvatar, birthYearText, escapeHtml, icon, setDocumentTitle, showToast, bindDialogClose, openDialog, normalizedIdentity, getRouteVersion, setRouteCleanup, refresh
    } = dependencies;

    async function renderPeople(id, viewData = null) {
      const version = getRouteVersion();
      const isCurrent = () => version === getRouteVersion();
      const { event, participants } = viewData || await api(`/events/${id}?prepareImport=1`);
      if (!isCurrent()) return;
      if (!eventCan(event, "can_view_participants")) {
        setDocumentTitle(`Personen – ${event.name}`);
        app.innerHTML = `<a class="back" href="#/event/${id}" data-history-back>${icon("arrow-left")} ${escapeHtml(event.name)}</a><div class="empty"><strong>Kein Zugriff auf Personen</strong><p>Die Event-Einstellungen erlauben diese Ansicht für dein Konto nicht.</p></div>`;
        return;
      }
      const canEditPeople = eventCan(event, "can_edit_participants");
      const importedIdentities = new Set(participants.map((person) => window.TimerParticipantStore.identity(person)));
      const showSaved = async (participant, removedId = participant?.id) => {
        if (!isCurrent()) return;
        const index = participants.findIndex((person) => person.id === removedId);
        if (index >= 0) participants.splice(index, 1);
        if (participant) participants.push(participant);
        await renderPeople(id, { event, participants });
      };
      participants.sort(compareParticipantsByOrganization);
      const personCardContent = (person) => `<div class="person-card-content">${personAvatar(person)}<div class="person-card-copy"><div class="person-head"><strong>${escapeHtml(person.name)} (${birthYearText(person.birth_year)})</strong></div>
        <div class="person-details"><span>${escapeHtml(person.organization)} - ${escapeHtml(person.age_group)} - ${person.gender === "male" ? "m" : "w"}</span></div></div></div>`;
      const personCardMarkup = (person) => canEditPeople ? `<button class="person-card person-card-button edit-person" type="button" data-id="${escapeHtml(person.id)}" aria-label="${escapeHtml(person.name)} bearbeiten">
        ${personCardContent(person)}</button>` : `<div class="person-card">${personCardContent(person)}</div>`;
      const peopleByAgeGroup = [...participants.reduce((groups, person) => {
        const ageGroup = person.age_group || "Ohne Altersklasse";
        if (!groups.has(ageGroup)) groups.set(ageGroup, []);
        groups.get(ageGroup).push(person);
        return groups;
      }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right, "de", { numeric: true, sensitivity: "base" }));
      setDocumentTitle(`Personen – ${event.name}`);
      app.innerHTML = `
        <a class="back" href="#/event/${id}" data-history-back>${icon("arrow-left")} ${escapeHtml(event.name)}</a>
        <div class="page-head people-page-head"><h1>Personen</h1><div class="people-page-actions">
          <button class="button secondary icon-button" id="refresh-people" type="button" aria-label="Personenliste aktualisieren" title="Personenliste aktualisieren">${icon("refresh")}</button>
          ${canEditPeople ? `<button class="button secondary" id="new-person">${icon("user-plus")} Neu</button>` : ""}
          ${eventCan(event, "can_import_participants") ? `<button class="button secondary" id="import-person">${icon("import")} Importieren</button>` : ""}
        </div></div>
        <section class="people-list-section" aria-label="Personenliste">
          ${participants.length ? `<div class="person-groups">${peopleByAgeGroup.map(([ageGroup, people], groupIndex) => `<section class="person-age-group" aria-labelledby="age-group-${groupIndex}"><h2 id="age-group-${groupIndex}">${escapeHtml(ageGroup)}</h2><div class="person-list">${people.map(personCardMarkup).join("")}</div></section>`).join("")}</div>` : `<div class="empty">Noch keine Personen.</div>`}
        </section>
        <dialog id="person-dialog"><form class="dialog-body" id="person-form">
          <h2 id="person-dialog-title">Person hinzufügen</h2><div class="form-grid">
            <div class="field full"><label for="person-name">Name</label><input id="person-name" name="name" maxlength="120" autocomplete="name" required></div>
            <div class="field"><label for="birth-year">Jahrgang (JJ)</label><input id="birth-year" name="birthYear" type="number" min="0" max="99" inputmode="numeric" placeholder="08" required></div>
            <div class="field"><label for="age-group">Altersklasse</label><input id="age-group" name="ageGroup" maxlength="40" required placeholder="z. B. AK 15/16"></div>
            <div class="field"><label for="gender">Geschlecht</label><select id="gender" name="gender" required><option value="female">Weiblich</option><option value="male">Männlich</option></select></div>
            <div class="field"><label for="organization">Gliederung</label><input id="organization" name="organization" maxlength="120" required placeholder="Verein / Ortsgruppe"></div>
          </div><p class="form-error" id="person-error" role="alert"></p>
          <div class="form-actions"><button type="button" class="button secondary" data-close>Abbrechen</button><button class="button">Person speichern</button></div>
          <div class="dialog-delete-row"><button type="button" class="button danger small" id="delete-person-dialog" hidden>${icon("trash")} Person löschen</button></div>
        </form></dialog>
        <dialog id="person-import-dialog" class="participant-import-dialog"><div class="dialog-body participant-import-body">
          <div class="dialog-title-row"><h2>Person importieren</h2><button type="button" class="button secondary icon-button" data-close aria-label="Schließen">${icon("x")}</button></div>
          <div class="participant-search-control">
            <label class="sr-only" for="import-person-search">Person suchen</label>
            <input id="import-person-search" type="search" inputmode="search" autocomplete="off" placeholder="Name suchen …" ${event.event_date ? "" : "disabled"}>
            <button type="button" class="participant-search-clear" id="clear-import-search" aria-label="Suche löschen" hidden>${icon("x")}</button>
          </div>
          <p class="import-search-note" id="import-search-note">${event.event_date ? "Mindestens 3 Buchstaben eingeben." : "Für den Import zuerst beim Event ein Datum eintragen."}</p>
          <div class="participant-picker-list participant-import-list" id="person-import-results" aria-live="polite"></div>
        </div></dialog>`;

      const dialog = document.querySelector("#person-dialog");
      const personForm = document.querySelector("#person-form");
      const personDialogTitle = document.querySelector("#person-dialog-title");
      const deletePersonButton = document.querySelector("#delete-person-dialog");
      const importDialog = document.querySelector("#person-import-dialog");
      const importSearch = document.querySelector("#import-person-search");
      const clearImportSearch = document.querySelector("#clear-import-search");
      const importSearchNote = document.querySelector("#import-search-note");
      const importResults = document.querySelector("#person-import-results");
      let importSearchTimer = null;
      let importRequest = 0;
      let importing = false;
      let importCandidates = [];
      document.querySelector("#refresh-people").addEventListener("click", () => refresh());
      setRouteCleanup(() => {
        clearTimeout(importSearchTimer);
        importRequest += 1;
        importDialog.close();
        dialog.close();
      });
      bindDialogClose(dialog);
      bindDialogClose(importDialog);
      importDialog.addEventListener("close", () => {
        clearTimeout(importSearchTimer);
        importRequest += 1;
      });
      document.querySelector("#new-person")?.addEventListener("click", () => {
        personForm.reset();
        personForm.dataset.editId = "";
        personDialogTitle.textContent = "Person hinzufügen";
        deletePersonButton.hidden = true;
        document.querySelector("#person-error").textContent = "";
        openDialog("#person-dialog");
      });
      document.querySelector("#import-person")?.addEventListener("click", () => {
        clearTimeout(importSearchTimer);
        importRequest += 1;
        importSearch.value = "";
        clearImportSearch.hidden = true;
        importResults.innerHTML = "";
        importSearchNote.textContent = event.event_date
          ? "Mindestens 3 Buchstaben eingeben."
          : "Für den Import zuerst beim Event ein Datum eintragen.";
        openDialog("#person-import-dialog", { focusField: false });
      });
      const loadImportCandidates = async () => {
        const searchValue = importSearch.value.trim();
        const searchLength = normalizedIdentity(searchValue).length;
        clearImportSearch.hidden = !searchValue;
        importRequest += 1;
        const requestId = importRequest;
        if (searchLength < 3) {
          importSearchNote.textContent = "Mindestens 3 Buchstaben eingeben.";
          importResults.innerHTML = "";
          return;
        }
        importSearchNote.textContent = "Suche …";
        importResults.innerHTML = "";
        try {
          const { candidates, directoryReady } = await api(`/events/${id}/participants/import?q=${encodeURIComponent(searchValue)}`);
          if (!isCurrent() || requestId !== importRequest || !importDialog.open) return;
          importCandidates = candidates;
          candidates.forEach((candidate) => {
            candidate.alreadyImported = importedIdentities.has(window.TimerParticipantStore.identity(candidate));
          });
          importSearchNote.textContent = candidates.length
            ? `${candidates.length} Treffer`
            : (directoryReady ? "Keine Person gefunden." : "Die geschützte Importliste ist noch nicht eingerichtet.");
          importResults.innerHTML = candidates.map((candidate) => `<button type="button" class="participant-picker-option import-person-option" data-id="${escapeHtml(candidate.id)}" ${candidate.alreadyImported ? "disabled" : ""}>
            <span class="participant-picker-main">${personAvatar({ name: candidate.name, gender: candidate.gender, organization: candidate.organization })}<span class="participant-picker-copy">
              <strong>${escapeHtml(candidate.name)} (${birthYearText(candidate.birthYear)})</strong>
              <small>${escapeHtml(candidate.organization)} · ${escapeHtml(candidate.ageGroup)} · ${candidate.gender === "female" ? "w" : "m"}${candidate.alreadyImported ? " · Bereits vorhanden" : ""}</small>
            </span></span>${candidate.alreadyImported ? icon("check") : icon("import")}
          </button>`).join("");
        } catch (err) {
          if (!isCurrent() || requestId !== importRequest || !importDialog.open) return;
          importSearchNote.textContent = err.message;
        }
      };
      importSearch.addEventListener("input", () => {
        clearTimeout(importSearchTimer);
        importRequest += 1;
        clearImportSearch.hidden = !importSearch.value;
        importSearchTimer = setTimeout(loadImportCandidates, 220);
      });
      clearImportSearch.addEventListener("click", () => {
        clearTimeout(importSearchTimer);
        importRequest += 1;
        importSearch.value = "";
        clearImportSearch.hidden = true;
        importSearchNote.textContent = "Mindestens 3 Buchstaben eingeben.";
        importResults.innerHTML = "";
        importSearch.focus();
      });
      importResults.addEventListener("click", async (clickEvent) => {
        const button = clickEvent.target.closest(".import-person-option");
        if (!button || button.disabled || importing) return;
        const candidate = importCandidates.find((person) => person.id === button.dataset.id);
        if (!candidate) return;
        try {
          importing = true;
          button.disabled = true;
          const queued = await saveInBackground(id, `/events/${encodeURIComponent(id)}/participants/import`, "POST", { candidateId: button.dataset.id, previewParticipant: candidate });
          if (!isCurrent()) return;
          importDialog.close();
          showToast("Import lokal vorgemerkt. Übertragung läuft im Hintergrund.");
          await showSaved({ id: queued.clientSubmissionId, name: candidate.name, birth_year: Number(candidate.birthYear) % 100,
            age_group: candidate.ageGroup, gender: candidate.gender, organization: candidate.organization });
        } catch (err) {
          if (!isCurrent()) return;
          importing = false;
          button.disabled = false;
          importSearchNote.textContent = err.message;
        }
      });
      document.querySelectorAll(".edit-person").forEach((button) => button.addEventListener("click", () => {
        const person = participants.find((item) => item.id === button.dataset.id);
        if (!person) return;
        personForm.dataset.editId = person.id;
        personDialogTitle.textContent = "Person bearbeiten";
        deletePersonButton.hidden = false;
        personForm.elements.name.value = person.name;
        personForm.elements.birthYear.value = person.birth_year;
        personForm.elements.ageGroup.value = person.age_group;
        personForm.elements.gender.value = person.gender;
        personForm.elements.organization.value = person.organization;
        document.querySelector("#person-error").textContent = "";
        openDialog("#person-dialog", { focusField: false });
      }));
      personForm.addEventListener("submit", async (submitEvent) => {
        submitEvent.preventDefault();
        const button = submitEvent.submitter;
        try {
          button.disabled = true;
          const values = Object.fromEntries(new FormData(submitEvent.currentTarget));
          validateParticipant(values);
          const editId = submitEvent.currentTarget.dataset.editId;
          const queued = await saveInBackground(id, `/events/${encodeURIComponent(id)}/participants${editId ? `/${encodeURIComponent(editId)}` : ""}`, editId ? "PATCH" : "POST", values);
          if (!isCurrent()) return;
          dialog.close();
          showToast("Person lokal vorgemerkt. Übertragung läuft im Hintergrund.");
          await showSaved({ id: editId || queued.clientSubmissionId, name: values.name.trim(), birth_year: Number(values.birthYear),
            age_group: values.ageGroup.trim(), gender: values.gender, organization: values.organization.trim() });
        } catch (err) {
          if (!isCurrent()) return;
          document.querySelector("#person-error").textContent = err.message;
          button.disabled = false;
        }
      });
      deletePersonButton.addEventListener("click", async () => {
        const person = participants.find((item) => item.id === personForm.dataset.editId);
        if (!person) return;
        const warning = Number(person.result_count) > 0 ? " Dabei werden auch alle Ergebnisse dieser Person gelöscht." : "";
        if (!confirm(`${person.name} wirklich löschen?${warning}`)) return;
        try {
          deletePersonButton.disabled = true;
          await saveInBackground(id, `/events/${encodeURIComponent(id)}/participants/${encodeURIComponent(person.id)}`, "DELETE");
          if (!isCurrent()) return;
          dialog.close();
          showToast("Löschen lokal vorgemerkt. Übertragung läuft im Hintergrund.");
          await showSaved(null, person.id);
        } catch (err) { if (isCurrent()) { showToast(err.message); deletePersonButton.disabled = false; } }
      });
    }


    return Object.freeze({ render: renderPeople });
  }

  root.TimerPeopleView = Object.freeze({ create });
})(window);
