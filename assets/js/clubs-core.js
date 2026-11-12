(function (root) {
  "use strict";
  const dateKeys = Object.freeze(["swimSilver", "swimGold", "rescueBronze", "rescueSilver", "rescueGold", "combinedExercise", "healthDeclaration"]);

  function proofDates(...records) {
    return Object.fromEntries(dateKeys.map((key) => [key, records.reduce((latest, record) => {
      const value = record?.[key];
      return value && (!latest || value.toMillis() > latest.toMillis()) ? value : latest;
    }, null)]));
  }

  function clubName(value) {
    const name = String(value || "").trim();
    if (!name || name.length > 120) throw new Error("Bitte einen Namen mit höchstens 120 Zeichen eingeben.");
    return name;
  }

  function clubId(value) {
    return Array.from(new TextEncoder().encode(clubName(value).toLowerCase()), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function profile(data, role) {
    const aliases = { organisator: "organizer", "kader-sportler": "athlete", kadersportler: "athlete", kader: "athlete", sportler: "standard" };
    const stored = String(data.role || "standard").trim().toLowerCase();
    const rank = role || (root.LifesavingAuth ? root.LifesavingAuth.getAccountRole(data, {}).value
      : data.admin === true || data.isAdmin === true ? "admin" : aliases[stored] || stored);
    const person = data.personLink;
    const birthYear = person?.birthYear || (/^\d{4}-\d{2}-\d{2}$/.test(data.birthDate || "") ? Number(data.birthDate.slice(0, 4)) : null);
    return {
      role: rank, personId: person?.id || "", name: person?.name ?? (data.displayName || data.email || "Mitglied"),
      birthYear, organization: person?.organization ?? (data.dlrgBranch || ""),
    };
  }

  function displayName(person) {
    return person.birthYear ? `${person.name} (${String(person.birthYear).slice(-2)})` : person.name;
  }

  function activeYears(years, year, enabled) {
    return [...new Set([...(years || []).filter((value) => value !== year), ...(enabled ? [year] : [])])].sort((a, b) => a - b);
  }

  const api = Object.freeze({ clubName, clubId, profile, displayName, activeYears, dateKeys, proofDates });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubsCore = api;
})(typeof window === "object" ? window : globalThis);
