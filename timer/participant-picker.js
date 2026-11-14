(function (root) {
  "use strict";

  function create({ escapeHtml }) {
    function renderGroups(people, renderOption) {
      const groups = new Map();
      for (const person of people) {
        const label = String(person.age_group || person.ageGroup || "").trim() || "Ohne Altersklasse";
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(person);
      }
      return [...groups].sort(([left], [right]) => {
        if (left === "Ohne Altersklasse") return 1;
        if (right === "Ohne Altersklasse") return -1;
        return left.localeCompare(right, "de", { numeric: true, sensitivity: "base" });
      }).map(([label, entries]) => `<div class="participant-picker-age-group" role="group" aria-label="${escapeHtml(label)}"><h3 class="participant-picker-age-heading" aria-hidden="true">${escapeHtml(label)}</h3>${entries.map(renderOption).join("")}</div>`).join("");
    }

    return Object.freeze({ renderGroups });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { create };
  else root.TimerParticipantPicker = Object.freeze({ create });
})(typeof window === "undefined" ? globalThis : window);
