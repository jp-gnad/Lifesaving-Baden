(function (root) {
  "use strict";
  const teamsCore = typeof module === "object" && module.exports ? require("./club-teams-core.js") : root.ClubTeamsCore;
  const fail = (message) => { throw Object.assign(new Error(message), { code: "clubs/event" }); };
  const key = (person) => person.personId || person.id;

  function metadata(name, date) {
    const value = String(name || "").trim();
    const day = String(date || "");
    const parsed = new Date(`${day}T00:00:00Z`);
    if (!value || value.length > 120) fail("Bitte einen Eventnamen mit höchstens 120 Zeichen eingeben.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== day) fail("Bitte ein gültiges Datum wählen.");
    return { name: value, date: day, year: Number(day.slice(0, 4)) };
  }

  function participant(person, year) {
    if (!person.activeYears?.includes(year)) fail("Die Person ist im Eventjahr nicht aktiv.");
    return { rosterId: person.id, name: person.name, birthYear: person.birthYear || null, gender: teamsCore.gender(person.gender),
      createdAtMillis: person.createdAt.toMillis(), individual: true };
  }

  function sameTeam(a, b) {
    return a?.order === b?.order && JSON.stringify(a?.memberIds || null) === JSON.stringify(b?.memberIds || null);
  }

  function change(event, command) {
    const next = { ...event, participants: { ...event.participants }, teams: { ...event.teams }, assignments: { ...event.assignments },
      operation: command.type, changedId: command.id || "", revision: event.revision + 1 };
    const person = event.participants[command.id];
    if (command.type === "metadata") {
      if (command.expectedRevision !== event.revision) fail("Das Event wurde geändert. Bitte erneut öffnen.");
      const values = metadata(command.name, command.date);
      if (values.year !== event.year && Object.keys(event.participants).length) fail("Das Jahr kann nur bei einem leeren Event geändert werden.");
      Object.assign(next, values);
    } else if (command.type === "add") {
      if (person || Object.values(event.participants).some((entry) => entry.rosterId === command.person.id)) fail("Die Person nimmt bereits teil.");
      next.participants[command.id] = participant(command.person, event.year);
    } else if (command.type === "remove") {
      if (!person) fail("Die Person wurde bereits entfernt.");
      if (event.assignments[command.id]) fail("Bitte die Person zuerst aus der Mannschaft entfernen.");
      delete next.participants[command.id];
    } else if (command.type === "individual") {
      if (!person) fail("Die Person wurde entfernt.");
      if (person.individual !== command.expected) fail("Der Einzelstart wurde inzwischen geändert.");
      if (!command.enabled && !event.assignments[command.id]) fail("Nur Personen mit Mannschaft können aus Einzel entfernt werden.");
      next.participants[command.id] = { ...person, individual: Boolean(command.enabled) };
    } else if (command.type === "team") {
      const before = event.teams[command.id];
      if (!sameTeam(before, command.expected)) fail("Die Mannschaft wurde geändert. Bitte erneut öffnen.");
      const ids = command.memberIds;
      if (ids !== null) {
        if (ids.length < 4 || ids.length > 5 || new Set(ids).size !== ids.length) fail("Bitte 4–5 verschiedene Personen auswählen.");
        for (const id of ids) {
          if (!event.participants[id]) fail("Eine Person nimmt nicht mehr am Event teil.");
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
    } else fail("Unbekannte Eventänderung.");
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

  const api = Object.freeze({ key, metadata, participant, sameTeam, change, namedTeams });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubEventsCore = api;
})(typeof window === "object" ? window : globalThis);
