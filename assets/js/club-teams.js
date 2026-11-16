(function (root) {
  "use strict";
  function create({ byId, node, icon, isCurrent, getPeople, onChange, errorText }) {
    const core = root.ClubTeamsCore;
    const store = root.ClubTeamsStore;
    const dialog = byId("club-team-dialog");
    const collator = new Intl.Collator("de", { sensitivity: "base" });
    let context = null;
    let editor = null;
    let generation = 0;
    let identityOwner = null;
    let identityView = -1;
    const identities = new Map();
    const pendingIdentities = new Set();

    function current(value = context) {
      return Boolean(value && context === value && isCurrent(value.owner, value.view));
    }

    function stop() {
      generation += 1;
      pendingIdentities.clear();
      context?.unsubscribe?.();
      context = null;
      editor = null;
      dialog.close();
      byId("club-team-add").hidden = true;
    }

    function people() {
      return getPeople(context.owner).map((person) => ({ ...person, rosterGender: context.owner.roster.get(person.id)?.gender,
        gender: core.gender(person.gender || identities.get(person.personId || person.id)) }));
    }

    function problem(text) {
      byId("club-team-error").textContent = text;
      byId("club-team-error").hidden = !text;
    }

    function available(person) {
      return person.activeYears?.includes(context.year) && person.birthYear && person.gender;
    }

    function findPerson(member, everyone) {
      return everyone.find((person) => core.key(person) === member.id || person.id === member.id || person.id === member.rosterId);
    }

    function row(person, action, selected = false) {
      const button = node("button", "se-candidate club-team-person");
      button.type = "button";
      const details = node("span", "se-person-details");
      details.append(node("strong", "se-person-name", root.ClubsCore.displayName(person)));
      const meta = node("span", "se-meta", `${person.birthYear ? core.classification([{ ...person, gender: person.gender || "w" }], context.year)?.replace(/ (weiblich|männlich)$/, "") : "Jahrgang fehlt"}${person.gender ? ` · ${person.gender}` : " · Geschlecht fehlt"}`);
      details.append(meta);
      button.append(details, icon(selected ? "minus" : "add"));
      button.setAttribute("aria-label", `${person.name} ${selected ? "entfernen" : "hinzufügen"}`);
      button.addEventListener("click", action);
      return button;
    }

    function renderEditor() {
      if (!editor || !current(editor.context)) return;
      const everyone = people();
      const selected = [...editor.selected].map(([id, fallback]) => everyone.find((person) => person.id === id) || fallback);
      byId("club-team-title").textContent = core.classification(selected, context.year) || "Mannschaft hinzufügen";
      byId("club-team-meta").textContent = `${context.year} · ${selected.length}/5`;
      byId("club-team-selected").replaceChildren(...selected.map((person) => {
        const button = row(person, () => { editor.selected.delete(person.id); problem(""); renderEditor(); }, true);
        if (!everyone.some((entry) => entry.id === person.id) || !available(person)) button.classList.add("club-team-unavailable");
        return button;
      }));
      const query = root.StartEligibilityCore.normalizeSearch(byId("club-team-search").value);
      const candidates = everyone.filter((person) => available(person) && !editor.selected.has(person.id)
        && ![core.key(person), person.id].some((alias) => context.season.assignments?.[alias] && context.season.assignments[alias] !== editor.id)
        && root.StartEligibilityCore.normalizeSearch(person.name).includes(query)).sort((a, b) => collator.compare(a.name, b.name));
      const sections = [];
      for (const group of core.groups) {
        const entries = candidates.filter((person) => core.classification([person], context.year).startsWith(`${group} `));
        if (!entries.length) continue;
        const section = node("section", "club-team-picker-group");
        section.append(node("h3", "wt-day-heading", group));
        for (const person of entries) {
          const button = row(person, () => { editor.selected.set(person.id, person); problem(""); renderEditor(); });
          button.disabled = selected.length >= 5;
          section.append(button);
        }
        sections.push(section);
      }
      byId("club-team-candidates").replaceChildren(...sections);
      if (!candidates.length) byId("club-team-candidates").append(node("p", "wt-empty", "Keine weiteren Personen."));
      const changed = !core.sameTeam(context.season.teams?.[editor.id], editor.expected);
      if (changed) problem("Die Mannschaft wurde geändert. Bitte erneut öffnen.");
      byId("club-team-save").disabled = editor.busy || changed || selected.length < 4 || selected.length > 5
        || !core.classification(selected, context.year) || selected.some((person) => !available(person) || !everyone.some((entry) => entry.id === person.id));
      byId("club-team-delete").hidden = !editor.expected;
      if (editor.busy) dialog.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
    }

    function open(id = "") {
      if (!current() || !context.loaded) return;
      const team = context.season.teams?.[id];
      const everyone = people();
      editor = { context, id: id || context.owner.db.collection("clubs").doc(context.owner.clubId).collection("teamIds").doc().id,
        expected: team ? JSON.parse(JSON.stringify(team)) : null, selected: new Map(), busy: false };
      for (const member of team?.members || []) {
        const person = findPerson(member, everyone) || { ...member, id: member.rosterId, activeYears: [] };
        editor.selected.set(person.id, person);
      }
      byId("club-team-search").value = "";
      dialog.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
      problem("");
      renderEditor();
      dialog.showModal();
    }

    async function submit(remove = false) {
      const draft = editor;
      if (!draft || draft.busy || !current(draft.context)) return;
      if (remove && !root.confirm("Mannschaft löschen?")) return;
      const value = context;
      draft.busy = true;
      problem("");
      renderEditor();
      const everyone = people();
      const selected = remove ? null : [...draft.selected.keys()].map((id) => everyone.find((person) => person.id === id));
      try {
        if (selected?.some((person) => !person)) throw Object.assign(new Error("Eine Person wurde entfernt. Bitte erneut öffnen."), { code: "clubs/team" });
        const season = await store.save(value.owner.db, value.owner.clubId, value.year, draft.id, selected, draft.expected,
          value.owner.sdk, () => { if (!current(value)) throw new Error("Die Ansicht hat sich geändert."); });
        if (!current(value) || editor !== draft) return;
        value.season = season;
        editor = null;
        dialog.close();
        onChange(value.owner);
      } catch (error) {
        if (current(value) && editor === draft) problem(errorText(error));
      } finally {
        if (current(value) && editor === draft) {
          draft.busy = false;
          dialog.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
          renderEditor();
        }
      }
    }

    async function loadIdentities(value) {
      const missing = getPeople(value.owner).filter((person) => person.activeYears.includes(value.year) && !core.gender(person.gender)
        && person.personId && !identities.has(person.personId) && !pendingIdentities.has(person.personId));
      if (!missing.length) return;
      // Reuse this view's identity cache when changing years or searching locally.
      const token = generation;
      await Promise.all(missing.map(async (person) => {
        pendingIdentities.add(person.personId);
        try {
          const snapshot = await value.owner.db.collection("timerParticipantDirectory").doc(person.personId).get({ source: "server" });
          if (!isCurrent(value.owner, value.view) || token !== generation) return;
          identities.set(person.personId, core.gender(snapshot.data()?.gender));
        } catch {
          if (current(value)) { value.identityError = true; identities.set(person.personId, ""); }
        } finally { if (token === generation) pendingIdentities.delete(person.personId); }
      }));
      if (current(value)) { onChange(value.owner); renderEditor(); }
    }

    function render(owner, year) {
      if (!context || context.owner !== owner || context.view !== owner.view || context.year !== year) {
        stop();
        if (identityOwner !== owner || identityView !== owner.view) {
          identities.clear(); identityOwner = owner; identityView = owner.view;
        }
        const value = { owner, view: owner.view, year, loaded: false, season: {} };
        context = value;
        value.unsubscribe = owner.db.collection("clubs").doc(owner.clubId).collection("teamSeasons").doc(String(year))
          .onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
            if (!current(value) || snapshot.metadata.fromCache) return;
            value.loaded = true;
            value.season = snapshot.data() || {};
            onChange(owner);
            renderEditor();
          }, () => {
            if (!current(value)) return;
            value.error = true;
            onChange(owner);
          });
      }
      const value = context;
      byId("club-team-add").hidden = false;
      byId("club-team-add").disabled = !value.loaded || value.error;
      loadIdentities(value);
      const list = byId("se-list");
      const focused = list.contains(document.activeElement) ? document.activeElement.id : "";
      if (!value.loaded || value.error) {
        list.replaceChildren(node("p", "wt-empty", value.error ? "Mannschaften konnten nicht geladen werden. Bitte aktualisiere die Seite." : "Mannschaften werden geladen …"));
        list.setAttribute("aria-busy", String(!value.error));
        return;
      }
      const everyone = people();
      const sections = [];
      const teams = core.namedTeams(value.season, year);
      if (teams.length) {
        const section = node("section", "wt-day-group");
        const heading = node("div", "wt-day-header");
        heading.append(node("h2", "wt-day-heading", "Mannschaften"), node("span", "wt-day-total", teams.length));
        section.append(heading);
        const cards = node("div", "club-team-cards");
        for (const team of teams) {
          const button = node("button", "club-team-card");
          button.id = `club-team-${team.id}`;
          button.type = "button";
          const header = node("span", "club-team-card-heading");
          header.append(node("strong", "", team.name), icon("next"));
          button.append(header);
          for (const member of team.members) {
            const person = findPerson(member, everyone);
            const entry = node("span", "club-team-member", root.ClubsCore.displayName(person || member));
            if (!person || !person.activeYears.includes(year)) {
              entry.classList.add("club-team-unavailable");
              entry.append(node("span", "se-meta", person ? " · inaktiv" : " · entfernt"));
            }
            button.append(entry);
          }
          button.addEventListener("click", () => open(team.id));
          cards.append(button);
        }
        section.append(cards);
        sections.push(section);
      }
      const free = everyone.filter((person) => person.activeYears.includes(year)
        && ![core.key(person), person.id].some((alias) => value.season.assignments?.[alias]));
      if (free.length) {
        const section = node("section", "wt-day-group");
        const heading = node("div", "wt-day-header");
        heading.append(node("h2", "wt-day-heading", "Ohne Mannschaft"), node("span", "wt-day-total", free.length));
        section.append(heading);
        for (const group of [...core.groups, "Ohne Jahrgang"]) {
          const entries = free.filter((person) => (person.birthYear
            ? core.classification([{ ...person, gender: person.gender || "w" }], year)?.replace(/ (weiblich|männlich)$/, "") : "Ohne Jahrgang") === group);
          if (!entries.length) continue;
          const card = node("div", "wt-day-card club-team-free");
          card.append(node("h3", "wt-day-heading", group));
          entries.sort((a, b) => collator.compare(a.name, b.name));
          for (const person of entries) {
            const item = node("div", "club-team-free-person");
            item.append(node("span", "se-person-name", root.ClubsCore.displayName(person)), node("span", "se-meta", person.gender || "Geschlecht fehlt"));
            card.append(item);
          }
          section.append(card);
        }
        sections.push(section);
      }
      if (!sections.length) sections.push(node("p", "wt-empty", `Keine aktiven Personen für ${year}.`));
      if (value.identityError) sections.push(node("p", "wt-form-error", "Personendaten konnten nicht vollständig geladen werden. Bitte aktualisiere die Seite."));
      list.replaceChildren(...sections);
      list.setAttribute("aria-busy", "false");
      if (focused) byId(focused)?.focus({ preventScroll: true });
    }

    byId("club-team-add").addEventListener("click", () => open());
    byId("club-team-search").addEventListener("input", renderEditor);
    byId("club-team-form").addEventListener("submit", (event) => { event.preventDefault(); if (!byId("club-team-save").disabled) submit(); });
    byId("club-team-delete").addEventListener("click", () => submit(true));
    byId("club-team-close").addEventListener("click", () => { if (!editor?.busy) dialog.close(); });
    dialog.addEventListener("cancel", (event) => { if (editor?.busy) event.preventDefault(); });
    dialog.addEventListener("close", () => { editor = null; });
    return Object.freeze({ render, stop });
  }
  root.ClubTeams = Object.freeze({ create });
})(window);
