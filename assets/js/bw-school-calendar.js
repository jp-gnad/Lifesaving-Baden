(function (root) {
  "use strict";

  // Kultusministerium Baden-Württemberg, Ferientermine 2026/27 bis 2029/30
  // https://km.baden-wuerttemberg.de/de/service/ferien
  const holidays = [
    ["2026-07-30", "2026-09-12"], ["2026-10-26", "2026-10-30"], ["2026-12-23", "2027-01-09"],
    ["2027-03-30", "2027-04-03"], ["2027-05-18", "2027-05-29"], ["2027-07-29", "2027-09-11"],
    ["2027-11-02", "2027-11-06"], ["2027-12-23", "2028-01-08"], ["2028-04-18", "2028-04-22"],
    ["2028-06-06", "2028-06-17"], ["2028-07-27", "2028-09-09"], ["2028-10-30", "2028-11-03"],
    ["2028-12-23", "2029-01-05"], ["2029-03-26", "2029-04-07"], ["2029-05-22", "2029-06-01"],
    ["2029-07-26", "2029-09-08"], ["2029-10-29", "2029-11-02"], ["2029-12-22", "2030-01-05"],
    ["2030-04-15", "2030-04-26"], ["2030-06-11", "2030-06-21"], ["2030-07-25", "2030-09-07"],
  ];

  // Feiertagsgesetz BW, einschließlich der landesweit schulfreien Tage.
  // https://im.baden-wuerttemberg.de/de/service/feiertage
  const fixedDays = new Set(["01-01", "01-06", "05-01", "10-03", "10-31", "11-01", "12-25", "12-26"]);
  const easterOffsets = [-3, -2, 1, 39, 50, 60];

  function easterSunday(year) {
    // Gregorian Meeus/Jones/Butcher algorithm.
    const cycle = year % 19;
    const century = Math.floor(year / 100);
    const withinCentury = year % 100;
    const fourthCentury = Math.floor(century / 4);
    const correction = Math.floor((century - Math.floor((century + 8) / 25) + 1) / 3);
    const moon = (19 * cycle + century - fourthCentury - correction + 15) % 30;
    const weekday = (32 + 2 * (century % 4) + 2 * Math.floor(withinCentury / 4) - moon - withinCentury % 4) % 7;
    const correctionWeeks = Math.floor((cycle + 11 * moon + 22 * weekday) / 451);
    const position = moon + weekday - 7 * correctionWeeks + 114;
    return Date.UTC(year, Math.floor(position / 31) - 1, position % 31 + 1);
  }

  function isSchoolFree(date) {
    if (fixedDays.has(date.slice(5)) || holidays.some(([first, last]) => first <= date && date <= last)) return true;
    const easter = easterSunday(Number(date.slice(0, 4)));
    const offset = (Date.parse(`${date}T00:00:00Z`) - easter) / 86400000;
    return easterOffsets.includes(offset);
  }

  const api = Object.freeze({
    covers: (from, through) => from >= holidays[0][0] && through <= holidays.at(-1)[1],
    isSchoolFree,
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BwSchoolCalendar = api;
})(typeof window === "object" ? window : globalThis);
