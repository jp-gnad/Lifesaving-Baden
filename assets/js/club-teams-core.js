(function (root) {
  "use strict";
  const groups = ["AK 12", "AK 13/14", "AK 15/16", "AK 17/18", "Offen"];
  const gender = (value) => ["m", "male", "maennlich"].includes(value) ? "m" : ["w", "female", "weiblich"].includes(value) ? "w" : "";

  function classification(members, year) {
    if (!members.length || members.some((person) => !person.birthYear || !gender(person.gender))) return null;
    const age = Math.max(...members.map((person) => year - person.birthYear));
    const group = groups[age <= 12 ? 0 : age <= 14 ? 1 : age <= 16 ? 2 : age <= 18 ? 3 : 4];
    return `${group} ${members.some((person) => gender(person.gender) === "m") ? "männlich" : "weiblich"}`;
  }

  const api = Object.freeze({ groups: Object.freeze(groups), gender, classification });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubTeamsCore = api;
})(typeof window === "object" ? window : globalThis);
