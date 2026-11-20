(function (root) {
  "use strict";
  function create({ byId, node, icon, isCurrent, getPeople, onChange, errorText }) {
    const core = root.ClubEventsCore;
    const store = root.ClubEventsStore;
    const teamCore = root.ClubTeamsCore;
    const dialog = byId("club-event-dialog");
    const teamDialog = byId("club-team-dialog");
    const personDialog = byId("club-event-person-dialog");
    const collator = new Intl.Collator("de", { sensitivity: "base" });
    const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" });
    let context = null;
    let draft = null;
    let teamDraft = null;
    let personDraft = null;
    const genders = new Map();
    const queue = root.ClubEventsQueue.create({
      storage: { get length() { return root.localStorage.length; }, key: (index) => root.localStorage.key(index),
        getItem: (key) => root.localStorage.getItem(key), setItem: (key, value) => root.localStorage.setItem(key, value), removeItem: (key) => root.localStorage.removeItem(key) },
      locks: root.navigator?.locks, isCurrent: (owner) => isCurrent(owner),
      send: (owner, record, check) => store.send(owner.db, record.clubId, record.eventId, record.action, owner.sdk, check),
      onChange: (owner) => {
        if (context?.owner !== owner || !current()) return;
        onChange(owner);
        if (draft?.mode === "participants") renderEditor();
      },
    });

    const current = (value = context) => Boolean(value && value === context && isCurrent(value.owner, value.view));
    const event = () => {
      const data = context && queue.project(context.owner.clubId, context.selected, context.events.get(context.selected));
      return data && { ...data, participants: Object.fromEntries(Object.entries(data.participants).map(([id, person]) => [id, { ...person, teamId: data.assignments[id] || "" }])) };
    };
    const dateLabel = (date) => dateFormat.format(new Date(`${date}T00:00:00Z`));
    const sourcePeople = () => getPeople(context.owner).map((person) => ({ ...person, gender: person.gender || genders.get(core.key(person)) || "",
      rosterGender: context.owner.roster.get(person.id)?.gender }));
    function button(text, action, className = "button button-secondary") {
      const element = node("button", className, text);
      element.type = "button";
      element.addEventListener("click", action);
      return element;
    }
    function error(id, text = "") { byId(id).textContent = text; byId(id).hidden = !text; }
    function busy(dialogElement, enabled) { dialogElement.querySelectorAll("button, input").forEach((control) => { control.disabled = enabled; }); }
    function stop() {
      context?.unsubscribe?.();
      context = null; draft = null; teamDraft = null; personDraft = null;
      dialog.close(); teamDialog.close(); personDialog.close();
      byId("club-event-add").hidden = true;
      byId("club-event-period-switch").hidden = true;
      byId("club-overview").hidden = false;
    }
    function ref(value = context) { return value.owner.db.collection("clubs").doc(value.owner.clubId).collection("events"); }
    function listen(value, cursor = null) {
      value.unsubscribe?.();
      value.error = "";
      if (document.hidden) { value.unsubscribe = null; return; }
      const selected = value.selected;
      const period = value.period;
      const today = value.today = root.StartEligibilityCore.today();
      const token = value.token = {};
      const receive = (snapshot) => {
        if (!current(value) || value.token !== token || snapshot.metadata.fromCache) return;
        value.loaded = true;
        if (selected) {
          if (snapshot.exists) value.events.set(selected, { ...snapshot.data(), id: snapshot.id });
          else {
            value.events.delete(selected); value.selected = "";
            if (queue.project(value.owner.clubId, selected, null)) { value.selected = selected; onChange(value.owner); return; }
            if (draft?.mode !== "create") { draft = null; dialog.close(); }
            teamDraft = null; teamDialog.close();
            personDraft = null; personDialog.close();
            listen(value);
          }
        } else {
          if (value.resetPage) {
            for (const [id, entry] of value.events) if (core.eventPeriod(entry.date, today) === period) value.events.delete(id);
            value.resetPage = false;
          }
          for (const id of value.pageIds || []) value.events.delete(id);
          value.pageIds = snapshot.docs.map((doc) => doc.id);
          for (const doc of snapshot.docs) value.events.set(doc.id, { ...doc.data(), id: doc.id });
          value.cursor = snapshot.docs.at(-1) || null;
          value.more = snapshot.docs.length === 50;
          value.loadedPeriods.add(period);
        }
        onChange(value.owner);
        if (teamDraft && !teamDraft.busy) renderTeamEditor();
        if (draft?.mode === "participants") renderEditor();
        if (personDraft && !event()?.participants[personDraft.id]?.individual) personDialog.close();
      };
      const failed = () => {
        if (!current(value) || value.token !== token) return;
        value.error = "Events konnten nicht geladen werden. Bitte aktualisiere die Seite.";
        onChange(value.owner);
      };
      if (selected) value.unsubscribe = ref(value).doc(selected).onSnapshot({ includeMetadataChanges: true }, receive, failed);
      else {
        if (!cursor) { value.resetPage = true; value.pageIds = []; }
        let query = ref(value).where("date", period === "past" ? "<" : ">=", today).orderBy("date", period === "past" ? "desc" : "asc").limit(50);
        if (cursor) query = query.startAfter(cursor);
        value.unsubscribe = query.onSnapshot({ includeMetadataChanges: true }, receive, failed);
      }
    }
    function openEvent(id) {
      if (!current()) return;
      const selected = id ? queue.project(context.owner.clubId, id, context.events.get(id)) : event();
      if (selected) context.period = core.eventPeriod(selected.date, root.StartEligibilityCore.today());
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
      const gender = teamCore.gender(person.gender);
      if (gender) {
        const mark = node("span", "club-event-gender-mark");
        mark.dataset.gender = gender;
        mark.title = gender === "w" ? "Weiblich" : "Männlich";
        mark.append(node("span", "wt-sr-only", `${mark.title}, `));
        name.append(mark);
      }
      name.append(node("span", "se-person-name", root.ClubsCore.displayName(person)));
      if (id && inactive({ ...person, id })) name.append(node("small", "club-event-inactive", "inaktiv"));
      return name;
    }
    function groupedEntries(entries, year, renderEntry, { teams = false, picker = false } = {}) {
      return core.displayGroups(entries, year).map(({ group, genders }) => {
        const section = node("section", picker ? "club-event-picker-group" : "club-event-ak-group");
        section.dataset.ageGroup = group;
        const header = node("div", "wt-day-header club-event-ak-header");
        header.append(node(picker ? "h3" : "h4", "wt-day-heading", group));
        if (!picker) header.append(node("span", "wt-day-total", genders.reduce((count, entry) => count + entry.entries.length, 0)));
        section.append(header);
        const body = node("div", teams ? "club-event-team-columns" : picker ? "" : "wt-day-card");
        for (const { gender, entries: values } of genders) {
          const block = node("div", "club-event-gender-group");
          block.dataset.gender = gender;
          const label = gender === "w" ? "weiblich" : gender === "m" ? "männlich" : "ohne Geschlecht";
          block.setAttribute("aria-label", label);
          const content = node("div", teams ? "club-team-cards" : "");
          for (const entry of values) {
            const item = renderEntry(entry);
            item.dataset.gender = gender;
            content.append(item);
          }
          block.append(content);
          body.append(block);
        }
        section.append(body);
        return section;
      });
    }
    function perform(command) {
      const value = context;
      const selected = event();
      if (!current(value) || value.busy || !selected) return;
      value.actionError = "";
      try {
        queue.enqueue(value.owner.clubId, selected.id, { type: "mutate", command }, selected);
      } catch (failure) { if (current(value)) value.actionError = errorText(failure); }
      if (current(value)) onChange(value.owner);
    }
    function render(owner) {
      if (!context || context.owner !== owner || context.view !== owner.view) {
        stop();
        genders.clear();
        context = { owner, view: owner.view, period: "planned", today: root.StartEligibilityCore.today(), events: new Map(), loaded: false,
          selected: "", loadedPeriods: new Set(), pageIds: [], busy: false };
        listen(context);
      }
      const value = context;
      const today = root.StartEligibilityCore.today();
      if (value.today !== today) {
        value.today = today;
        if (!value.selected) listen(value);
      }
      queue.start(owner);
      const list = byId("se-list");
      const focused = list.contains(document.activeElement) ? document.activeElement.id : "";
      byId("club-event-add").hidden = Boolean(value.selected);
      byId("club-event-add").disabled = !value.loaded || Boolean(value.error);
      byId("club-event-period-switch").hidden = Boolean(value.selected);
      byId("club-event-period-planned").checked = value.period === "planned";
      byId("club-event-period-past").checked = value.period === "past";
      byId("club-overview").hidden = Boolean(value.selected);
      list.setAttribute("aria-busy", String(!value.loaded));
      list.replaceChildren();
      if (value.error || !value.loaded) { list.append(node("p", "wt-empty", value.error || "Events werden geladen …")); return; }
      const selected = event();
      if (!selected) {
        const events = [...new Set([...value.events.keys(), ...queue.ids(owner.clubId)])]
          .map((id) => queue.project(owner.clubId, id, value.events.get(id))).filter((entry) => entry && core.eventPeriod(entry.date, today) === value.period)
          .sort((a, b) => (value.period === "past" ? -1 : 1) * a.date.localeCompare(b.date) || collator.compare(a.name, b.name));
        const cards = node("div", "wt-day-card");
        for (const entry of events) {
          const row = button("", () => openEvent(entry.id), "se-person club-event-row");
          row.id = `club-event-${entry.id}`;
          const details = node("span", "se-person-details");
          details.append(node("strong", "se-person-name", entry.name), node("span", "se-meta", `${dateLabel(entry.date)} · ${Object.keys(entry.participants).length} Personen`));
          row.append(details, icon("next"));
          cards.append(row);
        }
        list.append(events.length ? cards : node("p", "wt-empty", value.period === "past" ? "Keine vergangenen Events." : "Keine geplanten Events."));
        if (value.more) list.append(button("Weitere Events", () => { value.pageIds = []; listen(value, value.cursor); }, "button button-secondary club-event-more"));
      } else {
        const header = node("div", "club-event-heading");
        const back = button("Zurück", () => openEvent(""), "club-event-back");
        const title = node("div", "club-event-title");
        title.append(node("h2", "", selected.name), node("p", "se-meta", dateLabel(selected.date)));
        const edit = button("", () => openEditor("metadata"), "club-event-edit");
        edit.setAttribute("aria-label", "Event bearbeiten");
        edit.title = "Event bearbeiten";
        edit.append(icon("edit"));
        header.append(back, title, edit);
        list.append(header);
        const toolbar = node("div", "club-event-toolbar");
        toolbar.append(button("+ Einzel", () => openEditor("participants")), button("+ Mannschaft", () => openTeam(), "button se-primary"));
        list.append(toolbar);
        const teams = core.namedTeams(selected).map((team) => ({ ...team, members: team.memberIds.map((id) => selected.participants[id]) }));
        if (teams.length) {
          const section = node("section", "club-event-list-section");
          section.setAttribute("aria-label", "Mannschaften");
          const title = node("div", "wt-day-header club-event-section");
          title.append(node("h3", "wt-day-heading", "Mannschaften"), node("span", "wt-day-total", teams.length));
          section.append(title);
          section.append(...groupedEntries(teams, selected.year, (team) => {
            const card = button("", () => openTeam(team.id), "club-team-card");
            card.id = `club-team-${team.id}`;
            card.setAttribute("aria-label", `${team.name} bearbeiten`);
            const members = team.memberIds.map((id) => ({ ...selected.participants[id], id }));
            const genderOrder = { w: 0, m: 1, "": 2 };
            members.sort((a, b) => genderOrder[teamCore.gender(a.gender)] - genderOrder[teamCore.gender(b.gender)] || collator.compare(a.name, b.name));
            for (const person of members) card.append(personName(person, person.id));
            return card;
          }, { teams: true }));
          list.append(section);
        }
        for (const [individual, label] of [[true, "Einzel"], [false, "Ohne Start"]]) {
          const people = Object.entries(selected.participants).filter(([, person]) => individual ? person.individual : !person.individual && !person.teamId)
            .sort(([, a], [, b]) => collator.compare(a.name, b.name));
          if (!people.length) continue;
          const heading = node("div", "wt-day-header club-event-section");
          heading.append(node("h3", "wt-day-heading", label), node("span", "wt-day-total", people.length));
          const section = node("section", "club-event-list-section");
          section.setAttribute("aria-label", label);
          section.append(heading);
          section.append(...groupedEntries(people.map(([id, person]) => ({ ...person, id })), selected.year, (person) => {
            const id = person.id;
            const row = node("div", "club-event-person");
            row.append(personName(person, id));
            const toggle = button(individual ? "…" : "+ Einzel", individual ? () => openPerson(id)
              : () => perform({ type: "individual", id, expected: person.individual, enabled: true }), "club-event-single-toggle");
            toggle.id = `club-event-single-${id}`;
            toggle.setAttribute("aria-label", `${person.name} ${individual ? "Menü öffnen" : "als Einzelstarter hinzufügen"}`);
            if (individual) toggle.setAttribute("aria-haspopup", "dialog");
            toggle.title = toggle.getAttribute("aria-label");
            toggle.disabled = value.busy;
            row.append(toggle);
            return row;
          }));
          list.append(section);
        }
        if (!Object.keys(selected.participants).length) list.append(node("p", "wt-empty", "Noch keine Teilnehmer."));
        if (value.actionError) list.append(node("p", "wt-form-error", value.actionError));
        list.querySelectorAll("button").forEach((control) => { if (value.busy) control.disabled = true; });
      }
      const status = queue.status(owner.clubId, value.selected);
      if (status.count || status.error) {
        const notice = node("div", "club-event-sync");
        notice.setAttribute("role", "status");
        notice.append(node("span", "se-meta", status.error || "Wird gespeichert …"));
        if (status.error) {
          notice.append(button("Erneut versuchen", () => { try { queue.retry(owner.clubId); } catch (failure) { value.actionError = errorText(failure); onChange(owner); } }, "club-event-back"));
          if (value.selected && !status.sending) notice.append(button("Verwerfen", () => {
            queue.discard(owner.clubId, value.selected);
            if (!event()) openEvent(""); else onChange(owner);
          }, "club-event-back"));
        }
        list.append(notice);
      }
      if (focused) byId(focused)?.focus({ preventScroll: true });
    }

    function openEditor(mode = "create") {
      if (!current()) return;
      const selected = mode === "create" ? null : event();
      draft = { context, mode, step: mode === "participants" ? 2 : 0, busy: false, id: selected?.id || ref().doc().id,
        expectedRevision: selected?.revision };
      dialog.dataset.mode = mode;
      byId("club-event-name").value = selected?.name || "";
      byId("club-event-date").value = selected?.date || "";
      const currentYear = root.StartEligibilityCore.seasonYear(root.StartEligibilityCore.today());
      const fixedYear = mode === "metadata" && (Object.keys(selected.participants).length || selected.year < currentYear || selected.year > currentYear + 1) ? selected.year : null;
      byId("club-event-date").min = `${fixedYear || currentYear}-01-01`;
      byId("club-event-date").max = `${fixedYear || currentYear + 1}-12-31`;
      byId("club-event-search").value = "";
      error("club-event-error");
      busy(dialog, false);
      renderEditor();
      dialog.showModal();
      byId("club-event-choices").scrollTop = 0;
    }
    function renderEditor() {
      if (!draft || !current(draft.context)) return;
      const metadata = draft.mode === "metadata";
      byId("club-event-title").textContent = metadata ? "Event bearbeiten" : draft.mode === "participants" ? "Einzelschwimmer" : ["Eventname", "Datum"][draft.step];
      byId("club-event-step").textContent = draft.mode === "create" ? `${draft.step + 1}/2` : "";
      byId("club-event-name-field").hidden = !metadata && draft.step !== 0;
      byId("club-event-date-field").hidden = !metadata && draft.step !== 1;
      byId("club-event-name").required = metadata || draft.step === 0;
      byId("club-event-date").required = metadata || draft.step === 1;
      byId("club-event-picker").hidden = metadata || draft.step !== 2;
      byId("club-event-previous").hidden = draft.mode !== "create" || draft.step === 0;
      byId("club-event-delete").hidden = !metadata;
      byId("club-event-actions").hidden = draft.mode === "participants";
      byId("club-event-next").textContent = draft.mode === "create" && draft.step === 0 ? "Weiter" : draft.mode === "create" ? "Erstellen" : "Speichern";
      if (draft.step === 2 && !metadata) {
        const selected = event();
        if (!selected || selected.id !== draft.id) { dialog.close(); return; }
        const year = selected.year;
        const existing = selected.participants;
        const choices = new Map();
        for (const person of sourcePeople().filter((person) => !person.pending && person.activeYears.includes(year))) {
          const id = Object.entries(existing).find(([entryId, entry]) => entryId === core.key(person) || entry.rosterId === person.id)?.[0] || core.key(person);
          if (!existing[id]?.individual) choices.set(id, { person: existing[id] || person, source: person });
        }
        const query = root.StartEligibilityCore.normalizeSearch(byId("club-event-search").value);
        const entries = [...choices].filter(([, { person }]) => root.StartEligibilityCore.normalizeSearch(person.name).includes(query))
          .map(([id, { person, source }]) => ({ ...person, id, source }));
        const rows = groupedEntries(entries, year, (person) => {
            const row = button("", () => addSingle(person.id, person.source), "se-candidate club-event-choice");
            row.setAttribute("aria-label", `${person.name} hinzufügen`);
            row.append(personName(person), icon("add"));
            return row;
          }, { picker: true });
        byId("club-event-choices").replaceChildren(...rows);
        if (!rows.length) byId("club-event-choices").append(node("p", "wt-empty", query ? "Keine Personen gefunden." : "Keine weiteren Personen."));
      }
      byId("club-event-next").disabled = draft.busy;
    }
    function submitEvent() {
      const editing = draft;
      if (!editing || editing.mode === "participants" || editing.busy || !current(editing.context)) return;
      if (!byId("club-event-form").reportValidity()) return;
      if (editing.mode === "create" && editing.step === 0) {
        editing.step += 1; error("club-event-error"); renderEditor(); return;
      }
      const value = context;
      error("club-event-error");
      try {
        const original = editing.mode === "create" ? null : event();
        const action = editing.mode === "create" ? { type: "create", name: byId("club-event-name").value, date: byId("club-event-date").value, additions: [] }
          : { type: "mutate", expectedMetadata: { name: original.name, date: original.date },
            command: { type: "metadata", name: byId("club-event-name").value, date: byId("club-event-date").value, expectedRevision: editing.expectedRevision } };
        queue.enqueue(value.owner.clubId, editing.id, action, original);
        if (!current(value) || draft !== editing) return;
        draft = null; dialog.close();
        openEvent(editing.id);
      } catch (failure) { if (current(value) && draft === editing) error("club-event-error", errorText(failure)); }
      finally { if (current(value) && draft === editing) { editing.busy = false; busy(dialog, false); renderEditor(); } }
    }
    function addSingle(id, source) {
      if (!draft || draft.mode !== "participants" || !current(draft.context)) return;
      const selected = event();
      if (!selected || selected.id !== draft.id || selected.participants[id]?.individual) return;
      error("club-event-error");
      try {
        const person = selected.participants[id];
        const additions = person ? [] : [core.snapshotPerson({ ...(context.owner.roster.get(source.id) || source), id: source.id,
          gender: source.gender, rosterGender: source.rosterGender, individual: true })];
        queue.enqueue(context.owner.clubId, selected.id, { type: "singles", additions, removals: [],
          toggles: person ? [{ type: "individual", id, expected: false, enabled: true }] : [] }, selected);
      } catch (failure) { error("club-event-error", errorText(failure)); }
    }
    function openPerson(id) {
      const selected = event();
      if (!current() || !selected?.participants[id]?.individual) return;
      personDraft = { context, eventId: selected.id, id };
      byId("club-event-person-title").textContent = selected.participants[id].name;
      error("club-event-person-error");
      personDialog.showModal();
    }
    function removeSingle() {
      const editing = personDraft;
      if (!editing || !current(editing.context)) return;
      const selected = event();
      if (selected?.id !== editing.eventId || !selected.participants[editing.id]?.individual) { personDialog.close(); return; }
      try {
        const assigned = Boolean(selected.assignments[editing.id]);
        queue.enqueue(context.owner.clubId, selected.id, { type: "singles", additions: [], removals: assigned ? [] : [editing.id],
          toggles: assigned ? [{ type: "individual", id: editing.id, expected: true, enabled: false }] : [] }, selected);
        personDialog.close();
      } catch (failure) { error("club-event-person-error", errorText(failure)); }
    }
    function deleteEvent() {
      const editing = draft;
      if (!editing || editing.busy || !root.confirm("Event löschen?")) return;
      const value = context;
      try {
        queue.enqueue(value.owner.clubId, editing.id, { type: "delete", expectedRevision: editing.expectedRevision }, event());
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
      byId("club-team-picker-body").scrollTop = 0;
      const editing = teamDraft;
      for (const person of sourcePeople().filter((person) => !person.pending && person.activeYears.includes(event().year) && !person.gender && person.personId && !genders.has(core.key(person)))) {
        genders.set(core.key(person), "");
        context.owner.db.collection("timerParticipantDirectory").doc(person.personId).get({ source: "server" }).then((snapshot) => {
          if (!current(editing.context)) return;
          genders.set(core.key(person), teamCore.gender(snapshot.data()?.gender));
          if (teamDraft === editing) renderTeamEditor();
        }).catch(() => { if (current(editing.context) && teamDraft === editing) error("club-team-error", "Personendaten konnten nicht geladen werden. Bitte erneut öffnen."); });
      }
    }
    function renderTeamEditor() {
      if (!teamDraft || !current(teamDraft.context) || event()?.id !== teamDraft.eventId) return;
      const selected = event();
      const editing = teamDraft;
      const choices = new Map(Object.entries(selected.participants));
      for (const person of sourcePeople().filter((person) => !person.pending && person.activeYears.includes(selected.year))) {
        const id = Object.entries(selected.participants).find(([entryId, entry]) => entryId === core.key(person) || entry.rosterId === person.id)?.[0] || core.key(person);
        if (!choices.has(id)) choices.set(id, person);
      }
      const activeIds = new Set(sourcePeople().filter((person) => !person.pending && person.activeYears.includes(selected.year)).map((person) =>
        Object.entries(selected.participants).find(([entryId, entry]) => entryId === core.key(person) || entry.rosterId === person.id)?.[0] || core.key(person)));
      const members = [...editing.selected].map((id) => choices.get(id)).filter(Boolean);
      byId("club-team-title").textContent = editing.expected ? "Mannschaft" : "Mannschaft hinzufügen";
      const row = (id, person, remove) => {
        const entry = button("", () => { if (remove) editing.selected.delete(id); else editing.selected.add(id); error("club-team-error"); renderTeamEditor(); }, "se-candidate club-team-person");
        entry.setAttribute("aria-label", `${person.name} ${remove ? "entfernen" : "hinzufügen"}`);
        entry.append(personName(person, id), icon(remove ? "minus" : "add"));
        entry.disabled = editing.busy || !remove && members.length >= 5;
        return entry;
      };
      byId("club-team-selected").replaceChildren(...[...editing.selected].filter((id) => choices.has(id)).map((id) => row(id, choices.get(id), true)));
      const query = root.StartEligibilityCore.normalizeSearch(byId("club-team-search").value);
      const candidates = [...choices].filter(([id, person]) => activeIds.has(id) && !editing.selected.has(id) && (!person.teamId || person.teamId === editing.id)
        && teamCore.classification([person], selected.year) && root.StartEligibilityCore.normalizeSearch(person.name).includes(query))
        .sort(([, a], [, b]) => collator.compare(a.name, b.name));
      const sections = groupedEntries(candidates.map(([id, person]) => ({ ...person, id })), selected.year,
        (person) => row(person.id, person, false), { picker: true });
      byId("club-team-candidates").replaceChildren(...sections);
      if (!candidates.length) byId("club-team-candidates").append(node("p", "wt-empty", "Keine weiteren Personen."));
      const changed = !core.sameTeam(selected.teams[editing.id], editing.expected);
      if (changed && !editing.busy) error("club-team-error", "Die Mannschaft wurde geändert. Bitte erneut öffnen.");
      byId("club-team-save").disabled = editing.busy || changed || members.length < 4 || members.length > 5 || members.length !== editing.selected.size || !teamCore.classification(members, selected.year);
      byId("club-team-delete").hidden = !editing.expected;
    }
    function submitTeam(remove = false) {
      const editing = teamDraft;
      if (!editing || editing.busy || !current(editing.context) || remove && !root.confirm("Mannschaft löschen?")) return;
      const value = context;
      error("club-team-error");
      try {
        const selected = event();
        const everyone = sourcePeople();
        const additions = remove ? [] : [...editing.selected].filter((id) => !selected.participants[id]).map((id) => {
          const person = everyone.find((entry) => core.key(entry) === id);
          if (!person) throw Object.assign(new Error("Eine Person wurde entfernt. Bitte erneut auswählen."), { code: "clubs/event" });
          return core.snapshotPerson({ ...(value.owner.roster.get(person.id) || person), id: person.id, gender: person.gender, rosterGender: person.rosterGender, individual: false });
        });
        queue.enqueue(value.owner.clubId, editing.eventId,
          { type: "team", additions, command: { type: "team", id: editing.id, memberIds: remove ? null : [...editing.selected], expected: editing.expected } }, selected);
        if (!current(value) || teamDraft !== editing) return;
        teamDraft = null; teamDialog.close(); onChange(value.owner);
      } catch (failure) { if (current(value)) error("club-team-error", errorText(failure)); }
      finally { if (current(value) && teamDraft === editing) { editing.busy = false; busy(teamDialog, false); renderTeamEditor(); } }
    }

    byId("club-event-add").addEventListener("click", () => openEditor());
    byId("club-event-period-switch").addEventListener("change", () => {
      if (!current() || context.selected) return;
      context.period = byId("club-event-period-past").checked ? "past" : "planned";
      context.loaded = context.loadedPeriods.has(context.period);
      context.more = false;
      listen(context);
      onChange(context.owner);
    });
    byId("club-event-form").addEventListener("submit", (e) => { e.preventDefault(); submitEvent(); });
    byId("club-event-previous").addEventListener("click", () => { draft.step -= 1; renderEditor(); });
    byId("club-event-delete").addEventListener("click", deleteEvent);
    byId("club-event-search").addEventListener("input", renderEditor);
    byId("club-event-close").addEventListener("click", () => { if (!draft?.busy) dialog.close(); });
    dialog.addEventListener("cancel", (e) => { if (draft?.busy) e.preventDefault(); });
    dialog.addEventListener("close", () => { draft = null; });
    byId("club-event-person-remove").addEventListener("click", removeSingle);
    byId("club-event-person-close").addEventListener("click", () => personDialog.close());
    personDialog.addEventListener("close", () => { personDraft = null; });
    byId("club-team-form").addEventListener("submit", (e) => { e.preventDefault(); if (!byId("club-team-save").disabled) submitTeam(); });
    byId("club-team-delete").addEventListener("click", () => submitTeam(true));
    byId("club-team-search").addEventListener("input", renderTeamEditor);
    byId("club-team-close").addEventListener("click", () => { if (!teamDraft?.busy) teamDialog.close(); });
    teamDialog.addEventListener("cancel", (e) => { if (teamDraft?.busy) e.preventDefault(); });
    teamDialog.addEventListener("close", () => { teamDraft = null; });
    document.addEventListener("visibilitychange", () => {
      if (!current()) return;
      if (document.hidden) { context.unsubscribe?.(); context.unsubscribe = null; context.token = {}; }
      else { queue.resume(); listen(context); }
    });
    root.addEventListener("online", () => queue.retry());
    root.addEventListener("focus", () => queue.resume());
    root.addEventListener("storage", () => queue.resume());
    return Object.freeze({ render, stop });
  }
  root.ClubEvents = Object.freeze({ create });
})(window);
