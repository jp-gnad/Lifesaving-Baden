(function (root) {
  "use strict";
  const groups = ["AK 12", "AK 13/14", "AK 15/16", "AK 17/18", "Offen"];
  const fail = (message) => { throw Object.assign(new Error(message), { code: "clubs/team" }); };
  const key = (person) => person.personId || person.id;
  const gender = (value) => ["m", "male", "maennlich"].includes(value) ? "m" : ["w", "female", "weiblich"].includes(value) ? "w" : "";
  function sameTeam(first, second) {
    const revision = (team) => team ? [team.order, team.members.map((person) => [person.id, person.rosterId, person.name, person.birthYear, person.gender, person.createdAtMillis])] : null;
    return JSON.stringify(revision(first)) === JSON.stringify(revision(second));
  }

  function classification(members, year) {
    if (!members.length || members.some((person) => !person.birthYear || !gender(person.gender))) return null;
    const age = Math.max(...members.map((person) => year - person.birthYear));
    const group = groups[age <= 12 ? 0 : age <= 14 ? 1 : age <= 16 ? 2 : age <= 18 ? 3 : 4];
    return `${group} ${members.some((person) => gender(person.gender) === "m") ? "männlich" : "weiblich"}`;
  }

  function memberKey(person, season) {
    // An unlinked responsible account can acquire a directory identity later.
    // Its existing reservation continues to represent the same person.
    return season.assignments?.[person.id] ? person.id : key(person);
  }

  function change(season, id, members, year, expected) {
    const teams = { ...season.teams };
    const assignments = { ...season.assignments };
    const previous = teams[id];
    if (!sameTeam(previous, expected)) fail("Die Mannschaft wurde geändert. Bitte erneut öffnen.");
    if (members !== null) {
      if (members.length < 4 || members.length > 5) fail("Bitte 4–5 Personen auswählen.");
      if (!classification(members, year)) fail("Jahrgang oder Geschlecht fehlt.");
      const ids = members.map((person) => memberKey(person, season));
      if (new Set(ids).size !== ids.length) fail("Eine Person wurde mehrfach ausgewählt.");
      for (const person of members) {
        if (!person.activeYears?.includes(year)) fail("Eine Person ist für dieses Jahr nicht aktiv.");
        for (const alias of [key(person), person.id]) {
          if (assignments[alias] && assignments[alias] !== id) fail("Eine Person gehört bereits zu einer anderen Mannschaft.");
        }
      }
    } else if (!previous) fail("Die Mannschaft wurde bereits gelöscht.");
    for (const member of previous?.members || []) delete assignments[member.id];
    if (members === null) delete teams[id];
    else {
      teams[id] = {
        order: previous?.order ?? Math.max(0, ...Object.values(teams).map((team) => team.order)) + 1,
        members: members.map((person) => ({
          id: memberKey(person, season), rosterId: person.id, name: person.name,
          birthYear: person.birthYear, gender: gender(person.gender), createdAtMillis: person.createdAt?.toMillis() ?? 0,
        })),
      };
      for (const member of teams[id].members) assignments[member.id] = id;
    }
    return { teams, assignments, changedTeamId: id, year };
  }

  function namedTeams(season, year) {
    const counts = new Map();
    return Object.entries(season.teams || {}).sort(([a, first], [b, second]) => first.order - second.order || a.localeCompare(b)).map(([id, team]) => {
      const label = classification(team.members, year) || "Mannschaft";
      const number = (counts.get(label) || 0) + 1;
      counts.set(label, number);
      return { ...team, id, name: `${label} · ${number}` };
    });
  }

  const api = Object.freeze({ groups: Object.freeze(groups), key, gender, sameTeam, classification, memberKey, change, namedTeams });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubTeamsCore = api;
})(typeof window === "object" ? window : globalThis);
