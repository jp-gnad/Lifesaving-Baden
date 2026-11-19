(function (root) {
  "use strict";
  function create({ byId, node, icon, isCurrent, getPeople, onChange, errorText }) {
    const core = root.ClubEventsCore;
    const store = root.ClubEventsStore;
    const teamCore = root.ClubTeamsCore;
    const dialog = byId("club-event-dialog");
    const teamDialog = byId("club-team-dialog");
    const collator = new Intl.Collator("de", { sensitivity: "base" });
    const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" });
    let context = null;
    let draft = null;
    let teamDraft = null;

    const current = (value = context) => Boolean(value && value === context && isCurrent(value.owner, value.view));
    const event = () => {
      const data = context?.events.get(context.selected);
      return data && { ...data, participants: Object.fromEntries(Object.entries(data.participants).map(([id, person]) => [id, { ...person, teamId: data.assignments[id] || "" }])) };
    };
    const dateLabel = (date) => dateFormat.format(new Date(`${date}T00:00:00Z`));
    const sourcePeople = () => getPeople(context.owner).map((person) => ({ ...person, rosterGender: context.owner.roster.get(person.id)?.gender }));
    function button(text, action, className = "button button-secondary") {
      const element = node("button", className, text);
      element.type = "button";
      element.addEventListener("click", action);
      return element;
    }
    function error(id, text = "") { byId(id).textContent = text; byId(id).hidden = !text; }
    function requireCurrent(value) { if (!current(value)) throw Object.assign(new Error("Die Ansicht hat sich geändert."), { code: "clubs/event" }); }
    function busy(dialogElement, enabled) { dialogElement.querySelectorAll("button, input").forEach((control) => { control.disabled = enabled; }); }
    function stop() {
      context?.unsubscribe?.();
      context = null; draft = null; teamDraft = null;
      dialog.close(); teamDialog.close();
      byId("club-event-add").hidden = true;
    }
    function ref(value = context) { return value.owner.db.collection("clubs").doc(value.owner.clubId).collection("events"); }
    function listen(value, cursor = null) {
      value.unsubscribe?.();
      value.error = "";
      if (document.hidden) { value.unsubscribe = null; return; }
      const selected = value.selected;
      const token = value.token = {};
      const receive = (snapshot) => {
        if (!current(value) || value.token !== token || snapshot.metadata.fromCache) return;
        value.loaded = true;
        if (selected) {
          if (snapshot.exists) value.events.set(selected, { ...snapshot.data(), id: snapshot.id });
          else {
            value.events.delete(selected); value.selected = "";
            if (draft?.mode !== "create") { draft = null; dialog.close(); }
            teamDraft = null; teamDialog.close();
            listen(value);
          }
        } else {
          for (const id of value.pageIds || []) value.events.delete(id);
          value.pageIds = snapshot.docs.map((doc) => doc.id);
          for (const doc of snapshot.docs) value.events.set(doc.id, { ...doc.data(), id: doc.id });
          value.cursor = snapshot.docs.at(-1) || null;
          value.more = snapshot.docs.length === 50;
        }
        onChange(value.owner);
        if (teamDraft && !teamDraft.busy) renderTeamEditor();
      };
      const failed = () => {
        if (!current(value) || value.token !== token) return;
        value.error = "Events konnten nicht geladen werden. Bitte aktualisiere die Seite.";
        onChange(value.owner);
      };
      if (selected) value.unsubscribe = ref(value).doc(selected).onSnapshot({ includeMetadataChanges: true }, receive, failed);
      else {
        let query = ref(value).where("year", "==", value.year).orderBy(value.owner.sdk.FieldPath.documentId()).limit(50);
        if (cursor) query = query.startAfter(cursor);
        value.unsubscribe = query.onSnapshot({ includeMetadataChanges: true }, receive, failed);
      }
    }
    function openEvent(id) {
      if (!current()) return;
      context.selected = id;
      listen(context);
      onChange(context.owner);
    }
    function inactive(member) {
      const person = sourcePeople().find((person) => core.key(person) === member.id || person.id === member.rosterId || person.id === member.id);
      return !person || !person.activeYears.includes(event().year);
    }
    function personName(person, id = "") {
      const name = node("span", "se-person-details");
      name.append(node("span", "se-person-name", root.ClubsCore.displayName(person)));
      if (id && inactive({ ...person, id })) name.append(node("small", "club-event-inactive", "inaktiv"));
      return name;
    }
    async function perform(command) {
      const value = context;
      const selected = event();
      if (!current(value) || value.busy || !selected) return;
      value.busy = true; value.actionError = "";
      onChange(value.owner);
      try {
        const result = await store.mutate(value.owner.db, value.owner.clubId, selected.id, command, value.owner.sdk, () => requireCurrent(value));
        if (current(value)) value.events.set(result.id, result);
      } catch (failure) { if (current(value)) value.actionError = errorText(failure); }
      finally { if (current(value)) { value.busy = false; onChange(value.owner); } }
    }
    function render(owner, year) {
      if (!context || context.owner !== owner || context.view !== owner.view || context.year !== year) {
        const saved = context?.owner === owner && context.view === owner.view && event()?.year === year ? event() : null;
        stop();
        context = { owner, view: owner.view, year, events: new Map(saved ? [[saved.id, saved]] : []), loaded: false, selected: saved?.id || "", pageIds: [], busy: false };
        listen(context);
      }
      const value = context;
      const list = byId("se-list");
      const focused = list.contains(document.activeElement) ? document.activeElement.id : "";
      byId("club-event-add").hidden = Boolean(value.selected);
      byId("club-event-add").disabled = !value.loaded || Boolean(value.error);
      list.setAttribute("aria-busy", String(!value.loaded));
      list.replaceChildren();
      if (value.error || !value.loaded) { list.append(node("p", "wt-empty", value.error || "Events werden geladen …")); return; }
      const selected = event();
      if (!selected) {
        const events = [...value.events.values()].sort((a, b) => a.date.localeCompare(b.date) || collator.compare(a.name, b.name));
        const cards = node("div", "wt-day-card");
        for (const entry of events) {
          const row = button("", () => openEvent(entry.id), "se-person club-event-row");
          row.id = `club-event-${entry.id}`;
          const details = node("span", "se-person-details");
          details.append(node("strong", "se-person-name", entry.name), node("span", "se-meta", `${dateLabel(entry.date)} · ${Object.keys(entry.participants).length} Personen`));
          row.append(details, icon("next"));
          cards.append(row);
        }
        list.append(events.length ? cards : node("p", "wt-empty", `Noch keine Events für ${year}.`));
        if (value.more) list.append(button("Weitere Events", () => { value.pageIds = []; listen(value, value.cursor); }, "button button-secondary club-event-more"));
      } else {
        const header = node("div", "club-event-heading");
        const back = button("Zurück", () => openEvent(""), "club-event-back");
        const title = node("div", "club-event-title");
        title.append(node("h2", "", selected.name), node("p", "se-meta", dateLabel(selected.date)));
        header.append(back, title, button("Bearbeiten", () => openEditor("metadata"), "button button-secondary club-event-edit"));
        list.append(header);
        const toolbar = node("div", "club-event-toolbar");
        toolbar.append(button("Teilnehmer", () => openEditor("participants")), button("Mannschaft hinzufügen", () => openTeam(), "button se-primary"));
        list.append(toolbar);
        const teams = core.namedTeams(selected);
        if (teams.length) {
          list.append(node("h3", "wt-day-heading club-event-section", "Mannschaften"));
          const cards = node("div", "club-team-cards");
          for (const team of teams) {
            const card = button("", () => openTeam(team.id), "club-team-card");
            card.id = `club-team-${team.id}`;
            const heading = node("span", "club-team-card-heading");
            heading.append(node("strong", "", team.name), icon("next"));
            card.append(heading);
            for (const id of team.memberIds) card.append(personName(selected.participants[id], id));
            cards.append(card);
          }
          list.append(cards);
        }
        for (const [individual, label] of [[true, "Einzel"], [false, "Ohne Start"]]) {
          const people = Object.entries(selected.participants).filter(([, person]) => individual ? person.individual : !person.individual && !person.teamId)
            .sort(([, a], [, b]) => collator.compare(a.name, b.name));
          if (!people.length) continue;
          const heading = node("div", "wt-day-header club-event-section");
          heading.append(node("h3", "wt-day-heading", label), node("span", "wt-day-total", people.length));
          list.append(heading);
          const card = node("div", "wt-day-card");
          for (const [id, person] of people) {
            const row = node("div", "club-event-person");
            row.append(personName(person, id));
            const toggle = button(individual ? "−" : "+ Einzel", () => perform({ type: "individual", id, expected: person.individual, enabled: !person.individual }), "club-event-single-toggle");
            toggle.id = `club-event-single-${id}`;
            toggle.setAttribute("aria-label", `${person.name} ${individual ? "aus Einzel entfernen" : "als Einzelstarter hinzufügen"}`);
            toggle.title = individual && !person.teamId ? "Zuerst einer Mannschaft zuordnen" : toggle.getAttribute("aria-label");
            toggle.disabled = value.busy || individual && !person.teamId;
            row.append(toggle);
            card.append(row);
          }
          list.append(card);
        }
        if (!Object.keys(selected.participants).length) list.append(node("p", "wt-empty", "Noch keine Teilnehmer."));
        if (value.actionError) list.append(node("p", "wt-form-error", value.actionError));
        list.querySelectorAll("button").forEach((control) => { if (value.busy) control.disabled = true; });
      }
      if (focused) byId(focused)?.focus({ preventScroll: true });
    }

    function openEditor(mode = "create") {
      if (!current()) return;
      const selected = mode === "create" ? null : event();
      draft = { context, mode, step: mode === "participants" ? 2 : 0, busy: false, id: selected?.id || ref().doc().id,
        expectedRevision: selected?.revision, selected: new Map(Object.entries(selected?.participants || {}).map(([id, person]) => [id, person])) };
      byId("club-event-name").value = selected?.name || "";
      byId("club-event-date").value = selected?.date || "";
      const currentYear = root.StartEligibilityCore.seasonYear(root.StartEligibilityCore.today());
      const fixedYear = mode === "metadata" && Object.keys(selected.participants).length ? selected.year : null;
      byId("club-event-date").min = `${fixedYear || currentYear}-01-01`;
      byId("club-event-date").max = `${fixedYear || currentYear + 1}-12-31`;
      byId("club-event-search").value = "";
      error("club-event-error");
      busy(dialog, false);
      renderEditor();
      dialog.showModal();
    }
    function renderEditor() {
      if (!draft || !current(draft.context)) return;
      const metadata = draft.mode === "metadata";
      byId("club-event-title").textContent = metadata ? "Event bearbeiten" : draft.mode === "participants" ? "Teilnehmer" : ["Eventname", "Datum", "Teilnehmer"][draft.step];
      byId("club-event-step").textContent = draft.mode === "create" ? `${draft.step + 1}/3` : "";
      byId("club-event-name-field").hidden = !metadata && draft.step !== 0;
      byId("club-event-date-field").hidden = !metadata && draft.step !== 1;
      byId("club-event-name").required = metadata || draft.step === 0;
      byId("club-event-date").required = metadata || draft.step === 1;
      byId("club-event-picker").hidden = metadata || draft.step !== 2;
      byId("club-event-previous").hidden = draft.mode !== "create" || draft.step === 0;
      byId("club-event-delete").hidden = !metadata;
      byId("club-event-next").textContent = draft.mode === "create" && draft.step < 2 ? "Weiter" : draft.mode === "create" ? "Erstellen" : "Speichern";
      if (draft.step === 2 && !metadata) {
        const year = Number(byId("club-event-date").value.slice(0, 4));
        if (draft.mode === "create" && draft.selectionYear && draft.selectionYear !== year) draft.selected.clear();
        draft.selectionYear = year;
        const existing = draft.mode === "participants" ? event().participants : {};
        const choices = new Map(Object.entries(existing));
        for (const person of sourcePeople().filter((person) => person.activeYears.includes(year))) {
          const id = core.key(person);
          if (!choices.has(id) && !Object.values(existing).some((entry) => entry.rosterId === person.id)) choices.set(id, person);
        }
        const query = root.StartEligibilityCore.normalizeSearch(byId("club-event-search").value);
        const rows = [...choices].filter(([, person]) => root.StartEligibilityCore.normalizeSearch(person.name).includes(query))
          .sort(([, a], [, b]) => collator.compare(a.name, b.name)).map(([id, person]) => {
            const row = node("label", "club-event-choice");
            const input = node("input"); input.type = "checkbox"; input.checked = draft.selected.has(id);
            input.disabled = draft.busy || Boolean(existing[id]?.teamId);
            if (existing[id]?.teamId) row.title = "Zuerst aus der Mannschaft entfernen";
            input.addEventListener("change", () => { if (input.checked) draft.selected.set(id, person); else draft.selected.delete(id); renderEditor(); });
            row.append(input, personName(person, existing[id] ? id : ""));
            return row;
          });
        byId("club-event-choices").replaceChildren(...rows);
        if (!rows.length) byId("club-event-choices").append(node("p", "wt-empty", `Keine aktiven Personen für ${year}.`));
        byId("club-event-count").textContent = `${draft.selected.size} ausgewählt`;
      }
      byId("club-event-next").disabled = draft.busy || draft.mode === "create" && draft.step === 2 && !draft.selected.size;
    }
    async function submitEvent() {
      const editing = draft;
      if (!editing || editing.busy || !current(editing.context)) return;
      if (!byId("club-event-form").reportValidity()) return;
      if (editing.mode === "create" && editing.step < 2) {
        if (editing.step === 1) {
          try { core.metadata(byId("club-event-name").value, byId("club-event-date").value); }
          catch (failure) { error("club-event-error", errorText(failure)); return; }
        }
        editing.step += 1; error("club-event-error"); renderEditor(); return;
      }
      const value = context;
      editing.busy = true; busy(dialog, true); error("club-event-error");
      try {
        let result;
        const check = () => requireCurrent(value);
        if (editing.mode === "create") result = await store.create(value.owner.db, value.owner.clubId, editing.id, byId("club-event-name").value,
          byId("club-event-date").value, [...editing.selected.values()], value.owner.sdk, check);
        else if (editing.mode === "metadata") result = await store.mutate(value.owner.db, value.owner.clubId, editing.id,
          { type: "metadata", name: byId("club-event-name").value, date: byId("club-event-date").value, expectedRevision: editing.expectedRevision }, value.owner.sdk, check);
        else {
          const original = event();
          for (const id of Object.keys(original.participants)) {
            check();
            if (!editing.selected.has(id)) result = await store.mutate(value.owner.db, value.owner.clubId, editing.id, { type: "remove", id }, value.owner.sdk, check);
          }
          for (const [id, person] of editing.selected) {
            check();
            if (!original.participants[id]) result = await store.addPerson(value.owner.db, value.owner.clubId, editing.id, person, value.owner.sdk, check);
          }
        }
        if (!current(value) || draft !== editing) return;
        if (result) value.events.set(result.id, result);
        draft = null; dialog.close();
        if (result && result.year !== value.year) {
          value.selected = editing.id;
          const currentYear = root.StartEligibilityCore.seasonYear(root.StartEligibilityCore.today());
          byId("se-season-current").checked = result.year === currentYear;
          byId("se-season-next").checked = result.year !== currentYear;
          onChange(value.owner);
        } else openEvent(editing.id);
      } catch (failure) { if (current(value) && draft === editing) error("club-event-error", errorText(failure)); }
      finally { if (current(value) && draft === editing) { editing.busy = false; busy(dialog, false); renderEditor(); } }
    }
    async function deleteEvent() {
      const editing = draft;
      if (!editing || editing.busy || !root.confirm("Event löschen?")) return;
      const value = context;
      editing.busy = true; busy(dialog, true);
      try {
        await store.remove(value.owner.db, value.owner.clubId, editing.id, editing.expectedRevision, () => requireCurrent(value));
        if (!current(value)) return;
        value.events.delete(editing.id); draft = null; dialog.close(); openEvent("");
      } catch (failure) { if (current(value)) error("club-event-error", errorText(failure)); }
      finally { if (current(value) && draft === editing) { editing.busy = false; busy(dialog, false); renderEditor(); } }
    }
    function openTeam(id = "") {
      if (!current() || !event()) return;
      const team = event().teams[id];
      teamDraft = { context, eventId: event().id, id: id || ref().doc().id, expected: team ? { ...team, memberIds: [...team.memberIds] } : null,
        selected: new Set(team?.memberIds || []), busy: false };
      byId("club-team-search").value = ""; error("club-team-error"); busy(teamDialog, false);
      renderTeamEditor(); teamDialog.showModal();
    }
    function renderTeamEditor() {
      if (!teamDraft || !current(teamDraft.context) || event()?.id !== teamDraft.eventId) return;
      const selected = event();
      const editing = teamDraft;
      const members = [...editing.selected].map((id) => selected.participants[id]).filter(Boolean);
      byId("club-team-title").textContent = teamCore.classification(members, selected.year) || "Mannschaft hinzufügen";
      byId("club-team-meta").textContent = `${members.length}/5`;
      const row = (id, person, remove) => {
        const entry = button("", () => { if (remove) editing.selected.delete(id); else editing.selected.add(id); error("club-team-error"); renderTeamEditor(); }, "se-candidate club-team-person");
        entry.setAttribute("aria-label", `${person.name} ${remove ? "entfernen" : "hinzufügen"}`);
        entry.append(personName(person, id), icon(remove ? "minus" : "add"));
        entry.disabled = editing.busy || !remove && members.length >= 5;
        return entry;
      };
      byId("club-team-selected").replaceChildren(...[...editing.selected].filter((id) => selected.participants[id]).map((id) => row(id, selected.participants[id], true)));
      const query = root.StartEligibilityCore.normalizeSearch(byId("club-team-search").value);
      const candidates = Object.entries(selected.participants).filter(([id, person]) => !editing.selected.has(id) && (!person.teamId || person.teamId === editing.id)
        && teamCore.classification([person], selected.year) && root.StartEligibilityCore.normalizeSearch(person.name).includes(query))
        .sort(([, a], [, b]) => collator.compare(a.name, b.name));
      const sections = [];
      for (const group of teamCore.groups) {
        const entries = candidates.filter(([, person]) => teamCore.classification([person], selected.year).startsWith(`${group} `));
        if (!entries.length) continue;
        const section = node("section", "club-team-picker-group"); section.append(node("h3", "wt-day-heading", group));
        section.append(...entries.map(([id, person]) => row(id, person, false))); sections.push(section);
      }
      byId("club-team-candidates").replaceChildren(...sections);
      if (!candidates.length) byId("club-team-candidates").append(node("p", "wt-empty", "Keine weiteren Personen."));
      const changed = !core.sameTeam(selected.teams[editing.id], editing.expected);
      if (changed && !editing.busy) error("club-team-error", "Die Mannschaft wurde geändert. Bitte erneut öffnen.");
      byId("club-team-save").disabled = editing.busy || changed || members.length < 4 || members.length > 5 || members.length !== editing.selected.size;
      byId("club-team-delete").hidden = !editing.expected;
    }
    async function submitTeam(remove = false) {
      const editing = teamDraft;
      if (!editing || editing.busy || !current(editing.context) || remove && !root.confirm("Mannschaft löschen?")) return;
      const value = context;
      editing.busy = true; busy(teamDialog, true); error("club-team-error");
      try {
        const result = await store.mutate(value.owner.db, value.owner.clubId, editing.eventId,
          { type: "team", id: editing.id, memberIds: remove ? null : [...editing.selected], expected: editing.expected }, value.owner.sdk, () => requireCurrent(value));
        if (!current(value) || teamDraft !== editing) return;
        value.events.set(result.id, result); teamDraft = null; teamDialog.close(); onChange(value.owner);
      } catch (failure) { if (current(value)) error("club-team-error", errorText(failure)); }
      finally { if (current(value) && teamDraft === editing) { editing.busy = false; busy(teamDialog, false); renderTeamEditor(); } }
    }

    byId("club-event-add").addEventListener("click", () => openEditor());
    byId("club-event-form").addEventListener("submit", (e) => { e.preventDefault(); submitEvent(); });
    byId("club-event-previous").addEventListener("click", () => { draft.step -= 1; renderEditor(); });
    byId("club-event-delete").addEventListener("click", deleteEvent);
    byId("club-event-search").addEventListener("input", renderEditor);
    byId("club-event-close").addEventListener("click", () => { if (!draft?.busy) dialog.close(); });
    dialog.addEventListener("cancel", (e) => { if (draft?.busy) e.preventDefault(); });
    dialog.addEventListener("close", () => { draft = null; });
    byId("club-team-form").addEventListener("submit", (e) => { e.preventDefault(); if (!byId("club-team-save").disabled) submitTeam(); });
    byId("club-team-delete").addEventListener("click", () => submitTeam(true));
    byId("club-team-search").addEventListener("input", renderTeamEditor);
    byId("club-team-close").addEventListener("click", () => { if (!teamDraft?.busy) teamDialog.close(); });
    teamDialog.addEventListener("cancel", (e) => { if (teamDraft?.busy) e.preventDefault(); });
    teamDialog.addEventListener("close", () => { teamDraft = null; });
    document.addEventListener("visibilitychange", () => {
      if (!current()) return;
      if (document.hidden) { context.unsubscribe?.(); context.unsubscribe = null; context.token = {}; }
      else listen(context);
    });
    return Object.freeze({ render, stop });
  }
  root.ClubEvents = Object.freeze({ create });
})(window);
