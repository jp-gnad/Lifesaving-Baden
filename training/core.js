(function (root) {
  "use strict";

  const MIN_DATE = "2000-01-01";
  const MAX_METERS = 100000;
  const MAX_TEXT = 5000;
  const number = new Intl.NumberFormat("de-DE");
  const decimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

  function today(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(now);
    const get = (type) => parts.find((part) => part.type === type).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  function dateKey(value) {
    if (typeof value === "string") return value;
    const date = typeof value?.toDate === "function" ? value.toDate() : value;
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "";
  }

  function validateEntry(input, now = new Date()) {
    const date = String(input.date || "");
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime())
      || parsed.toISOString().slice(0, 10) !== date || date < MIN_DATE || date > today(now)) {
      throw new Error("Bitte wähle ein gültiges Trainingsdatum bis einschließlich heute.");
    }
    const meters = Number(input.meters);
    if (!Number.isInteger(meters) || meters < 1 || meters > MAX_METERS) {
      throw new Error("Bitte gib eine ganze Meterzahl zwischen 1 und 100.000 ein.");
    }
    const motivation = Number(input.motivation);
    if (!Number.isInteger(motivation) || motivation < 1 || motivation > 10) {
      throw new Error("Bitte wähle deine Motivation zwischen 1 und 10.");
    }
    const text = String(input.text || "").trim();
    if (text.length > MAX_TEXT) throw new Error("Dein Tagebuchtext darf höchstens 5.000 Zeichen enthalten.");
    return { date, meters, motivation, text };
  }

  function roleFor(data = {}, claims = {}) {
    const roles = [data.role, claims.role].map((role) => String(role || "").trim().toLowerCase());
    const isAdmin = roles.includes("admin") || data.admin === true || data.isAdmin === true
      || claims.admin === true || claims.isAdmin === true;
    const isOrganizer = isAdmin || roles.some((role) => ["organizer", "organisator"].includes(role))
      || claims.organizer === true || claims.isOrganizer === true;
    const isKader = roles.some((role) => ["kader-sportler", "kadersportler", "kader"].includes(role))
      || data.kader === true || data.isKaderAthlete === true || claims.kader === true || claims.isKaderAthlete === true;
    return { isAdmin, isOrganizer, hasAccess: isOrganizer || isKader,
      label: isAdmin ? "Admin" : isOrganizer ? "Organisator" : isKader ? "Kader-Sportler" : "Sportler" };
  }

  function inPeriod(entries, period) {
    return entries.filter((entry) => dateKey(entry.date).startsWith(period));
  }

  function summary(entries) {
    const motivations = entries.map((entry) => entry.motivation).filter(Number.isFinite);
    const meters = entries.reduce((sum, entry) => sum + entry.meters, 0);
    return { meters, count: entries.length, averageMeters: entries.length ? meters / entries.length : 0,
      motivation: motivations.length ? motivations.reduce((sum, value) => sum + value, 0) / motivations.length : null,
      days: new Set(entries.map((entry) => dateKey(entry.date))).size };
  }

  function ranking(entries) {
    const athletes = new Map();
    [...entries].sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date))).forEach((entry) => {
      const athlete = athletes.get(entry.uid) || { uid: entry.uid, name: entry.athleteName, meters: 0, count: 0 };
      athlete.name = entry.athleteName;
      athlete.meters += entry.meters;
      athlete.count += 1;
      athletes.set(entry.uid, athlete);
    });
    const sorted = [...athletes.values()].sort((a, b) => b.meters - a.meters || a.name.localeCompare(b.name, "de"));
    let rank = 0;
    return sorted.map((athlete, index) => {
      if (!index || athlete.meters !== sorted[index - 1].meters) rank = index + 1;
      return { ...athlete, rank };
    });
  }

  function monthly(entries, year) {
    return Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, "0")}`;
      return { month, ...summary(inPeriod(entries, month)) };
    });
  }

  const api = { MIN_DATE, MAX_METERS, MAX_TEXT, today, dateKey, validateEntry, roleFor,
    inPeriod, summary, ranking, monthly, formatMeters: (meters) => `${number.format(meters)} m`,
    formatNumber: (value) => number.format(value), formatDecimal: (value) => decimal.format(value) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrainingCore = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
