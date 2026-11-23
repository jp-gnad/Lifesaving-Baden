(function (root) {
  "use strict";
  const teamsCore = typeof module === "object" && module.exports ? require("./club-teams-core.js") : root.ClubTeamsCore;
  const calendar = typeof module === "object" && module.exports ? require("./bw-school-calendar.js") : root.BwSchoolCalendar;
  const dates = typeof module === "object" && module.exports ? require("./start-eligibility-core.js") : root.StartEligibilityCore;
  const fail = (message) => { throw Object.assign(new Error(message), { code: "clubs/event" }); };
  const key = (person) => person.personId || person.id;
  const participantBatchSize = 3;
  const eventPeriod = (date, today) => date < today ? "past" : "planned";
  const categoryOf = (event) => event?.category || "competition";
  const isCompetition = (event) => categoryOf(event) === "competition";
  const isCreate = (action) => action.type === "create" || action.type === "create-training";
  const recurringTraining = (event) => event?.category === "training" && [7, 14].includes(event.repeatDays);
  function seriesId(event) {
    if (!recurringTraining(event)) return "";
    // Series creation has always used a Firestore auto-ID with numbered suffixes.
    return /^([a-zA-Z0-9]{20})(?:-(?:[2-9]|[1-4][0-9]|5[0-3]))?$/.exec(event.id)?.[1] || "";
  }

  function excludedSchoolDays(text) {
    return [...new Set(String(text || "").split(/[\s,;]+/).filter(Boolean).map((entry) => {
      const date = entry.replace(/^(\d{2})\.(\d{2})\.(\d{4})$/, "$3-$2-$1");
      if (!dates.validDate(date)) fail("Bitte zusätzliche schulfreie Tage im Format TT.MM.JJJJ eingeben.");
      return date;
    }))];
  }

  function metadata(name, date, details = {}) {
    const value = String(name || "").trim();
    const day = String(date || "");
    const parsed = new Date(`${day}T00:00:00Z`);
    if (!value || value.length > 120) fail("Bitte einen Terminnamen mit höchstens 120 Zeichen eingeben.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== day) fail("Bitte ein gültiges Datum wählen.");
    const values = { name: value, date: day, year: Number(day.slice(0, 4)) };
    const category = categoryOf(details);
    if (category === "competition") return values;
    if (!["training", "organization"].includes(category)) fail("Bitte eine Terminart wählen.");
    const { startTime, endTime, repeatDays = 0 } = details;
    const clock = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
    if (typeof startTime !== "string" || typeof endTime !== "string" || !clock.test(startTime) || !clock.test(endTime) || startTime >= endTime) {
      fail("Bitte eine gültige Start- und Endzeit wählen. Die Endzeit muss nach der Startzeit liegen.");
    }
    if (!(category === "training" ? [0, 7, 14] : [0]).includes(repeatDays)) fail("Ungültige Wiederholung.");
    return { ...values, category, startTime, endTime, repeatDays };
  }

  function sameMetadata(first, second) {
    return first.name === second.name && first.date === second.date && categoryOf(first) === categoryOf(second)
      && first.startTime === second.startTime && first.endTime === second.endTime && (first.repeatDays || 0) === (second.repeatDays || 0);
  }

  function seriesEdits(selected, fields, entries, today) {
    const values = metadata(fields.name, fields.date, { ...selected, ...fields });
    const offset = dates.asDate(values.date) - dates.asDate(selected.date);
    const cutoff = selected.date > today ? selected.date : today;
    const rootId = seriesId(selected);
    const edits = {};
    if (!rootId) return edits;
    for (const entry of entries) {
      if (seriesId(entry) !== rootId || entry.id !== selected.id && entry.date < cutoff) continue;
      const date = dates.dateKey(new Date(+dates.asDate(entry.date) + offset));
      if (entry.id !== selected.id && date < today) fail("Die Verschiebung würde einen Folgetermin in die Vergangenheit legen.");
      const expectedMetadata = metadata(entry.name, entry.date, entry);
      const command = { type: "metadata", date };
      for (const field of ["name", "startTime", "endTime"]) command[field] = values[field] !== selected[field] ? values[field] : entry[field];
      const edit = { type: "mutate", expectedMetadata, command };
      if (replay(entry, edit) !== entry) edits[entry.id] = edit;
    }
    return edits;
  }

  function occurrences(id, action) {
    const values = metadata(action.name, action.date, action);
    if (!values.repeatDays) return [{ id, date: values.date }];
    const end = metadata(values.name, action.repeatUntil).date;
    if (action.type === "create-training") {
      if (!dates.validDate(action.plannedOn) || values.date < action.plannedOn || end > dates.addMonths(action.plannedOn, 12)) {
        fail("Trainingsserien können ab heute bis höchstens ein Jahr im Voraus geplant werden.");
      }
    }
    const skip = action.skipSchoolFree === true;
    if (skip && !calendar.covers(values.date, end)) fail("Für diesen Zeitraum liegen keine vollständigen BW-Ferientermine vor.");
    const excluded = new Set(action.excludedDays || []);
    const day = new Date(`${values.date}T00:00:00Z`);
    const result = [];
    let candidateCount = 0;
    const limit = action.type === "create-training" ? 53 : 52;
    while (dates.dateKey(day) <= end && candidateCount <= limit) {
      const date = dates.dateKey(day);
      candidateCount += 1;
      if (!skip || (!calendar.isSchoolFree(date) && !excluded.has(date))) {
        result.push({ id: result.length ? `${id}-${result.length + 1}` : id, date });
      }
      day.setUTCDate(day.getUTCDate() + values.repeatDays);
    }
    if (candidateCount < 2 || candidateCount > limit) fail("Bitte ein Enddatum für mindestens zwei Termine innerhalb des Planungszeitraums wählen.");
    if (!result.length) fail("Alle Termine der Serie liegen auf ausgeschlossenen Tagen.");
    return result;
  }

  function participant(person, year, competition = true) {
    if (competition && !person.activeYears?.includes(year)) fail("Die Person ist im Jahr des Termins nicht aktiv.");
    // Rules Timestamp.toMillis() drops submillisecond precision, unlike the browser SDK.
    const createdAtMillis = Math.floor(person.createdAtMillis ?? person.createdAt.toMillis());
    return { rosterId: person.id, name: person.name, birthYear: person.birthYear || null, gender: teamsCore.gender(person.gender),
      createdAtMillis, individual: !competition || person.individual !== false };
  }

  function sameTeam(a, b) {
    return a?.order === b?.order && JSON.stringify(a?.memberIds || null) === JSON.stringify(b?.memberIds || null);
  }

  function change(event, command) {
    const next = { ...event, participants: { ...event.participants }, teams: { ...event.teams }, assignments: { ...event.assignments },
      operation: command.type, changedId: command.id || "", revision: event.revision + 1 };
    const person = event.participants[command.id];
    if (command.type === "metadata") {
      if (command.expectedRevision !== event.revision) fail("Der Termin wurde geändert. Bitte erneut öffnen.");
      const values = metadata(command.name, command.date, { ...event, startTime: command.startTime, endTime: command.endTime });
      if (values.year !== event.year && !recurringTraining(event) && Object.keys(event.participants).length) {
        fail("Das Jahr kann nur bei einem Termin ohne Teilnehmer geändert werden.");
      }
      Object.assign(next, values);
    } else if (command.type === "participants") {
      const changes = command.changes;
      if (!changes.length || changes.length > participantBatchSize || new Set(changes.map((entry) => entry.id)).size !== changes.length) fail("Ungültige Personenauswahl.");
      let state = event;
      for (const entry of changes) state = change(state, { type: entry.person ? "add" : "remove", ...entry });
      next.participants = state.participants;
      next.changedIds = changes.map((entry) => entry.id);
    } else if (command.type === "add") {
      if (person || Object.values(event.participants).some((entry) => entry.rosterId === command.person.id)) fail("Die Person nimmt bereits teil.");
      next.participants[command.id] = participant(command.person, event.year, isCompetition(event));
    } else if (command.type === "remove") {
      if (!person) fail("Die Person wurde bereits entfernt.");
      if (event.assignments[command.id]) fail("Bitte die Person zuerst aus der Mannschaft entfernen.");
      delete next.participants[command.id];
    } else if (command.type === "rosterRemoval") {
      if (!person) fail("Die Person wurde bereits entfernt.");
      const teamId = event.assignments[command.id];
      const team = event.teams[teamId];
      if (team) {
        const memberIds = team.memberIds.filter((id) => id !== command.id);
        if (memberIds.length >= 4) next.teams[teamId] = { ...team, memberIds };
        else {
          delete next.teams[teamId];
          for (const id of memberIds) delete next.assignments[id];
        }
      }
      delete next.assignments[command.id];
      delete next.participants[command.id];
    } else if (command.type === "individual") {
      if (!isCompetition(event)) fail("Einzelstarts gibt es nur bei Wettkämpfen.");
      if (!person) fail("Die Person wurde entfernt.");
      if (person.individual !== command.expected) fail("Der Einzelstart wurde inzwischen geändert.");
      if (!command.enabled && !event.assignments[command.id]) fail("Nur Personen mit Mannschaft können aus Einzel entfernt werden.");
      next.participants[command.id] = { ...person, individual: Boolean(command.enabled) };
    } else if (command.type === "team") {
      if (!isCompetition(event)) fail("Mannschaften gibt es nur bei Wettkämpfen.");
      const before = event.teams[command.id];
      if (!sameTeam(before, command.expected)) fail("Die Mannschaft wurde geändert. Bitte erneut öffnen.");
      const ids = command.memberIds;
      if (ids !== null) {
        if (ids.length < 4 || ids.length > 5 || new Set(ids).size !== ids.length) fail("Bitte 4–5 verschiedene Personen auswählen.");
        for (const id of ids) {
          if (!event.participants[id]) fail("Eine Person nimmt nicht mehr am Termin teil.");
          if (event.assignments[id] && event.assignments[id] !== command.id) fail("Eine Person gehört bereits zu einer anderen Mannschaft.");
        }
        if (!teamsCore.classification(ids.map((id) => event.participants[id]), event.year)) fail("Jahrgang oder Geschlecht fehlt.");
      } else if (!before) fail("Die Mannschaft wurde bereits gelöscht.");
      for (const id of before?.memberIds || []) delete next.assignments[id];
      if (ids === null) delete next.teams[command.id];
      else {
        next.teams[command.id] = { order: before?.order ?? Math.max(0, ...Object.values(event.teams).map((team) => team.order)) + 1, memberIds: [...ids] };
        for (const id of ids) next.assignments[id] = command.id;
      }
    } else fail("Unbekannte Änderung am Termin.");
    return next;
  }

  function namedTeams(event) {
    const counts = new Map();
    return Object.entries(event.teams).sort(([a, first], [b, second]) => first.order - second.order || a.localeCompare(b)).map(([id, team]) => {
      const label = teamsCore.classification(team.memberIds.map((member) => event.participants[member]), event.year) || "Mannschaft";
      const number = (counts.get(label) || 0) + 1;
      counts.set(label, number);
      return { ...team, id, name: `${label} · ${number}` };
    });
  }

  function displayGroups(entries, year) {
    const groups = [...teamsCore.groups, "Ohne Jahrgang"];
    const genderOrder = ["w", "m", ""];
    const collator = new Intl.Collator("de", { sensitivity: "base", numeric: true });
    const buckets = new Map(groups.map((group) => [group, new Map(genderOrder.map((gender) => [gender, []]))]));
    for (const entry of entries) {
      const members = entry.members || [entry];
      // Gender may be missing on old snapshots without hiding a known age group.
      const label = teamsCore.classification(members.map((person) => ({ ...person, gender: teamsCore.gender(person.gender) || "w" })), year);
      const group = label?.replace(/ (weiblich|männlich)$/, "") || "Ohne Jahrgang";
      const gender = members.some((person) => teamsCore.gender(person.gender) === "m") ? "m"
        : members.length && members.every((person) => teamsCore.gender(person.gender) === "w") ? "w" : "";
      buckets.get(group).get(gender).push(entry);
    }
    return [...buckets].map(([group, genders]) => ({ group, genders: [...genders].filter(([, values]) => values.length)
      .map(([gender, values]) => ({ gender, entries: [...values].sort((a, b) => collator.compare(a.name || "", b.name || "") || String(a.id || "").localeCompare(String(b.id || ""))) })) }))
      .filter((group) => group.genders.length);
  }

  function snapshotPerson(person) {
    return { id: person.id, personId: person.personId || "", name: person.name, birthYear: person.birthYear || null,
      gender: person.gender || "", rosterGender: person.rosterGender ?? person.gender ?? "", activeYears: [...(person.activeYears || [])],
      createdAtMillis: person.createdAtMillis ?? person.createdAt.toMillis(), individual: person.individual !== false };
  }

  function selectionChanges(event, additions, removals) {
    const rosterIds = new Set(Object.values(event.participants).map((entry) => entry.rosterId));
    return [...removals.filter((id) => event.participants[id]).map((id) => ({ id })),
      ...additions.filter((person) => !event.participants[key(person)] && !rosterIds.has(person.id))
        .map((person) => ({ id: key(person), person }))];
  }

  function replay(event, action) {
    if (action.type === "delete") return null;
    if (action.type === "create-training") {
      if (event) return event;
      const values = metadata(action.name, action.date, action);
      const participants = Object.fromEntries(action.additions.map((person) => [key(person), participant(person, values.year, false)]));
      return { ...values, participants, teams: {}, assignments: {}, revision: 0 };
    }
    let state = event;
    if (isCreate(action) && !state) {
      state = { ...metadata(action.name, action.date, action), participants: {}, teams: {}, assignments: {}, revision: 0 };
    }
    if (!state) fail("Der Termin wurde gelöscht.");
    if (isCreate(action) || ["participants", "singles", "team"].includes(action.type)) {
      const changes = selectionChanges(state, action.additions, action.removals || []);
      for (let index = 0; index < changes.length; index += participantBatchSize) state = change(state, { type: "participants", changes: changes.slice(index, index + participantBatchSize) });
      if (action.type === "team") return replay(state, { type: "mutate", command: action.command });
      for (const command of action.toggles || []) state = replay(state, { type: "mutate", command });
      return state;
    }
    const command = { ...action.command };
    // Replays after a lost acknowledgement must preserve later start flags.
    if (command.type === "individual" && state.participants[command.id]?.individual === command.enabled) return state;
    if (command.type === "team" && (command.memberIds === null ? !state.teams[command.id]
      : JSON.stringify(state.teams[command.id]?.memberIds) === JSON.stringify(command.memberIds))) return state;
    if (command.type === "metadata") {
      const values = metadata(command.name, command.date, { ...state, startTime: command.startTime, endTime: command.endTime });
      if (sameMetadata(state, values)) return state;
      if (action.expectedMetadata && !sameMetadata(state, action.expectedMetadata)) fail("Der Termin wurde geändert. Bitte erneut öffnen.");
      command.expectedRevision = state.revision;
    }
    return change(state, command);
  }

  const api = Object.freeze({ key, metadata, sameMetadata, categoryOf, isCompetition, isCreate, recurringTraining, seriesId, seriesEdits,
    excludedSchoolDays, occurrences, participant, sameTeam, change, namedTeams,
    displayGroups, snapshotPerson, selectionChanges, replay, participantBatchSize, eventPeriod });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubEventsCore = api;
})(typeof window === "object" ? window : globalThis);
