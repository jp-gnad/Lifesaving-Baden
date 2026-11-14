(function (root) {
  "use strict";

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[char]);
  }

  const disciplines = {
    normal: { name: "Benutzerdefiniert", laps: 20, flexible: true, group: "normal" },
    rescue50: { name: "50 m Retten", laps: 2, group: "individual", lapLabels: ["25 m Kraul", "25 m Puppe"] },
    rescue100: { name: "100 m Retten", laps: 3, group: "individual", lapLabels: ["50 m Flossen", "10 m Aufnahme", "40 m Puppe Flossen"] },
    lifesaver100: { name: "100 m Lifesaver", laps: 3, group: "individual", lapLabels: ["50 m Gurtretter Flossen", "10 m Einklinken", "40 m Ziehen"] },
    medley100: { name: "100 m Kombi", laps: 3, group: "individual", lapLabels: ["50 m Kraul", "17,5 m Tauchen", "32,5 m Puppe"] },
    superLifesaver200: { name: "200 m Super Lifesaver", laps: 7, group: "individual", lapLabels: ["50 m Kraul", "25 m Kraul", "25 m Puppe", "5 m Einklinken", "45 m Flossen Gurt", "10 m Einklinken", "40 m Ziehen"] },
    obstacle100: { name: "100 m Hindernis", laps: 4, group: "individual", additional: true, lapLabels: ["Runde 1 (25 m)", "Runde 2 (50 m)", "Runde 3 (75 m)", "Runde 4 (100 m)"] },
    obstacle200: { name: "200 m Hindernis", laps: 4, group: "individual", lapLabels: ["Runde 1 (50 m)", "Runde 2 (100 m)", "Runde 3 (150 m)", "Runde 4 (200 m)"] },
    manikinRelay4x25: { name: "4 × 25 m Puppenstaffel", laps: 4, group: "team", team: true, lapLabels: ["Position 1", "Position 2", "Position 3", "Position 4"] },
    rescueTubeRelay4x50: { name: "4 × 50 m Gurtretterstaffel", laps: 4, group: "team", team: true, lapLabels: ["50 m Kraul", "50 m Flossen", "50 m Gurt", "50 m Ziehen"] },
    rescueRelay4x50: { name: "4 × 50 m Rettungsstaffel", laps: 4, group: "team", team: true, lapLabels: ["50 m Kraul", "50 m Flossen", "50 m Puppe", "50 m Puppe Flossen"] },
    obstacleRelay4x50: { name: "4 × 50 m Hindernisstaffel", laps: 4, group: "team", team: true, lapLabels: ["Position 1", "Position 2", "Position 3", "Position 4"] },
    mixedRelay4x50: { name: "4 × 50 m Mixed Staffel", laps: 4, group: "team", team: true, mixed: true, lapLabels: ["50 m Kraul", "50 m Flossen", "50 m Puppe", "50 m Puppe Flossen"] },
    lineThrow: { name: "LineThrow", laps: 2, group: "team", team: true, lapLabels: ["12,5 m Treffen", "12,5 m Ziehen"] },
  };

  const disciplineGroups = [
    { id: "normal", name: "Benutzerdefiniert" },
    { id: "individual", name: "Einzel" },
    { id: "team", name: "Mannschaft" },
  ];

  const obstacle100LongCourse = Object.freeze({ ...disciplines.obstacle100, laps: 2,
    lapLabels: Object.freeze(["Runde 1 (50 m)", "Runde 2 (100 m)"]),
  });

  function disciplineForEvent(disciplineId, event = {}) {
    if (disciplineId !== "obstacle100") return disciplines[disciplineId];
    const configured = event?.pool_length ?? event?.poolLength ?? "25";
    const length = configured === "custom" ? (event?.custom_pool_length ?? event?.customPoolLength) : configured;
    return Number(length) === 50 ? obstacle100LongCourse : disciplines.obstacle100;
  }

  function disciplinesForEvent(event) {
    return Object.freeze({ ...disciplines, obstacle100: disciplineForEvent("obstacle100", event) });
  }

  function disciplineForResult(result, event = {}) {
    if (result?.discipline === "obstacle100") {
      // Persisted lap coverage identifies the original course, even after the
      // event's pool length changes or several laps have been glued together.
      const groups = result.lap_groups || result.lapGroups;
      const lastGroup = Array.isArray(groups) ? groups.at(-1) : null;
      const laps = Array.isArray(lastGroup) ? lastGroup : lastGroup?.laps;
      const count = Array.isArray(laps) ? laps.at(-1) : result.segments?.length;
      if (count === 2 || count === 4) return disciplineForEvent("obstacle100", { poolLength: count === 2 ? "50" : "25" });
    }
    return disciplineForEvent(result?.discipline, event);
  }

  function enabledDisciplinesForEvent(event) {
    try {
      const selected = JSON.parse(event?.enabled_disciplines_json || "[]");
      const valid = selected.filter((discipline) => discipline in disciplines);
      return valid.length ? valid : Object.keys(disciplines);
    } catch {
      return Object.keys(disciplines);
    }
  }

  function eventCan(event, permission) {
    return event?.[permission] === true;
  }

  function accessLabel(value) {
    if (value === "everyone") return "Jeder";
    if (value === "authenticated") return "Standard und höher";
    if (value === "athlete") return "Sportler und höher";
    if (value === "trainer") return "Trainer und höher";
    if (value === "organizer") return "Organisatoren";
    return "Gesperrt";
  }


  function dateText(value) {
    if (!value) return "Kein Datum";
    return new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(new Date(`${value}T12:00:00`));
  }

  function isPastEvent(event, now = new Date()) {
    const value = event?.event_date;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const eventDay = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(eventDay) || new Date(eventDay).toISOString().slice(0, 10) !== value) return false;
    // Compare local calendar dates, so daylight-saving changes do not shift the cutoff.
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return today - eventDay >= 4 * 24 * 60 * 60 * 1000;
  }

  function formatTime(centiseconds) {
    const safe = Math.max(0, Math.floor(Number(centiseconds) || 0));
    const minutes = Math.floor(safe / 6000);
    const seconds = Math.floor((safe % 6000) / 100);
    const hundredths = safe % 100;
    return `${minutes}:${String(seconds).padStart(2, "0")},${String(hundredths).padStart(2, "0")}`;
  }

  function formatReviewTime(centiseconds) {
    const safe = Math.max(0, Math.floor(Number(centiseconds) || 0));
    return `${Math.floor(safe / 100)},${String(safe % 100).padStart(2, "0")}`;
  }

  function parseTime(value) {
    const text = String(value).trim();
    const formatted = text.match(/^(\d{1,3}):([0-5]\d)[,.](\d{2})$/);
    if (formatted) {
      return Number(formatted[1]) * 6000 + Number(formatted[2]) * 100 + Number(formatted[3]);
    }

    // Mobile number keyboards often do not offer a colon. In the compact form,
    // the last two digits before the comma are seconds: 123,45 -> 1:23,45.
    const compact = text.match(/^(\d{1,5})[,.](\d{2})$/);
    if (!compact) return null;
    const digits = compact[1];
    const minutes = digits.length > 2 ? Number(digits.slice(0, -2)) : 0;
    const seconds = Number(digits.length > 2 ? digits.slice(-2) : digits);
    if (seconds > 59) return null;
    return minutes * 6000 + seconds * 100 + Number(compact[2]);
  }

  function parseReviewTime(value) {
    const match = String(value).trim().match(/^(\d{1,7})[,.](\d{2})$/);
    if (!match) return null;
    return Number(match[1]) * 100 + Number(match[2]);
  }

  function disciplineLapLabel(disciplineId, lapNumber, context = {}) {
    const item = context?.discipline === disciplineId ? disciplineForResult(context) : disciplineForEvent(disciplineId, context);
    return item?.lapLabels?.[lapNumber - 1] || `Runde ${lapNumber}`;
  }

  function disciplineLapGroupLabel(disciplineId, laps, context = {}) {
    const safeLaps = Array.isArray(laps) && laps.length ? laps : [];
    if (!safeLaps.length) return "Runde";
    return safeLaps.map((lap) => disciplineLapLabel(disciplineId, lap, context)).join(" + ");
  }

  function resultLapGroups(result) {
    const stored = Array.isArray(result.lap_groups) ? result.lap_groups : [];
    if (stored.length === result.segments.length && stored.every((group) => Array.isArray(group) && group.length)) return stored;
    return result.segments.map((_, index) => [index + 1]);
  }

  function customDisciplineName(value = "") {
    return String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
  }

  function timekeeperSnapshot(context = {}) {
    const uid = context.user?.uid || "";
    const name = uid ? context.accountName || context.user.displayName || "" : "";
    const initials = String(name).trim().split(/[\s\p{Pd}]+/u).filter(Boolean).map((part) => {
      const letter = part.match(/\p{L}/u)?.[0] || "";
      return part === part.toLocaleLowerCase("de-DE") ? letter.toLocaleLowerCase("de-DE") : letter.toLocaleUpperCase("de-DE");
    }).join("").slice(0, 40);
    return { uid, initials: initials || "Unbekannt" };
  }

  function resultTimekeeperLabel(result) {
    return String(result?.timekeeper_initials || result?.timekeeper?.initials || "").trim() || "Unbekannt";
  }

  function customDisciplineKey(name, lapCount) {
    const normalized = customDisciplineName(name).toLocaleLowerCase("de-DE");
    return `${lapCount}-${encodeURIComponent(normalized).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`;
  }

  function resultLapCount(result) {
    const groups = result.lap_groups || result.lapGroups;
    if (!Array.isArray(groups) || !groups.length) return result.segments?.length || 0;
    const last = groups.at(-1);
    const laps = Array.isArray(last) ? last : last?.laps;
    return Array.isArray(laps) && laps.length ? laps.at(-1) : 0;
  }

  function resultDisciplineName(result) {
    return result?.discipline === "normal" && (result.custom_discipline_name || result.customDisciplineName)
      || disciplines[result?.discipline]?.name || "Benutzerdefiniert";
  }


  for (const discipline of Object.values(disciplines)) {
    if (discipline.lapLabels) Object.freeze(discipline.lapLabels);
    Object.freeze(discipline);
  }
  Object.freeze(disciplines);
  disciplineGroups.forEach(Object.freeze);
  Object.freeze(disciplineGroups);

  const api = Object.freeze({
    escapeHtml,
    disciplines, disciplineGroups, disciplinesForEvent, disciplineForEvent, disciplineForResult, enabledDisciplinesForEvent, eventCan, accessLabel, dateText, isPastEvent, formatTime, formatReviewTime, parseTime, parseReviewTime, disciplineLapLabel, disciplineLapGroupLabel, resultLapGroups,
    formatCumulativeReviewTime: formatTime, customDisciplineName, customDisciplineKey, resultLapCount, resultDisciplineName, timekeeperSnapshot, resultTimekeeperLabel,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TimerCore = api;
})(typeof window === "undefined" ? globalThis : window);
