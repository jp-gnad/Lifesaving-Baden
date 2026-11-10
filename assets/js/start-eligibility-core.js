(function (root) {
  "use strict";

  const groups = ["AK 12", "AK 13/14", "AK 15/16", "AK 17/18", "Offen"];
  const labels = Object.freeze({
    swimSilver: "Schwimmabzeichen Silber",
    swimGold: "Schwimmabzeichen Gold",
    rescueBronze: "Rettungsschwimmabzeichen Bronze",
    rescueSilver: "Rettungsschwimmabzeichen Silber",
    rescueGold: "Rettungsschwimmabzeichen Gold",
    combinedExercise: "Kombi-Übung (Silber oder Gold)",
    healthDeclaration: "Selbsterklärung zum Gesundheitszustand",
  });
  const dateKeys = Object.keys(labels);
  const berlinDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

  function today(now = new Date()) {
    return berlinDate.format(now);
  }

  function dateKey(date) {
    return date.toISOString().slice(0, 10);
  }

  function asDate(value) {
    return new Date(`${value}T00:00:00Z`);
  }

  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && value >= "1900-01-01"
      && Number.isFinite(asDate(value).getTime()) && dateKey(asDate(value)) === value;
  }

  function addMonths(value, months) {
    const date = asDate(value);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return dateKey(date);
  }

  function ageGroup(age) {
    if (age <= 12) return groups[0];
    if (age <= 14) return groups[1];
    if (age <= 16) return groups[2];
    if (age <= 18) return groups[3];
    return groups[4];
  }

  function latest(...dates) {
    return dates.reduce((best, date) => date > best ? date : best, "");
  }

  function checkExam(dates, age, day) {
    const rescueDate = latest(dates.rescueSilver, dates.rescueGold);
    if (age >= 16 && age < 50) {
      const badgeYear = rescueDate ? addMonths(rescueDate, 12) : "";
      const badgeThreeYears = rescueDate ? addMonths(rescueDate, 36) : "";
      const exerciseYear = dates.combinedExercise ? addMonths(dates.combinedExercise, 12) : "";
      const alternate = exerciseYear < badgeThreeYears ? exerciseYear : badgeThreeYears;
      const until = latest(badgeYear, alternate);
      if (until >= day) return { until, name: alternate > badgeYear && alternate < badgeThreeYears ? "Kombi-Übung" : "RS Silber/Gold" };
      if (badgeThreeYears < day) return { name: "RS Silber/Gold", reason: rescueDate ? "abgelaufen" : "fehlt" };
      return { name: "Kombi-Übung", reason: exerciseYear ? "abgelaufen" : "fehlt" };
    }

    // Higher qualifications also meet the undated minimum in § 4 (2).
    const rescue = latest(rescueDate, dates.rescueBronze);
    if (age >= 13) return rescue ? {} : { name: "RS Bronze", reason: "fehlt" };
    const gold = latest(rescue, dates.swimGold);
    if (age >= 10) return gold ? {} : { name: "Schwimmabzeichen Gold", reason: "fehlt" };
    return latest(gold, dates.swimSilver) ? {} : { name: "Schwimmabzeichen Silber", reason: "fehlt" };
  }

  function evaluate(person, day = today()) {
    const year = Number(day.slice(0, 4));
    const age = year - person.birthYear;
    const yearEnd = `${year}-12-31`;
    const dates = Object.fromEntries(dateKeys.map((key) => [key, validDate(person[key]) && person[key] <= day ? person[key] : ""]));
    const exam = checkExam(dates, age, day);
    const healthUntil = dates.healthDeclaration ? addMonths(dates.healthDeclaration, 24) : "";
    const issues = [];

    if (healthUntil < day) {
      issues.push({ kind: "health", stage: 3, name: "Selbsterklärung", reason: healthUntil ? "abgelaufen" : "fehlt" });
    } else if (healthUntil < yearEnd) {
      issues.push({ kind: "health", stage: 2, name: "Selbsterklärung", until: healthUntil });
    }
    if (exam.reason) {
      issues.push({ kind: "exam", stage: 3, ...exam });
    } else if (exam.until && exam.until < yearEnd) {
      issues.push({ kind: "exam", stage: 2, name: exam.name, until: exam.until });
    }

    issues.sort((a, b) => b.stage - a.stage);
    return { group: ageGroup(age), stage: issues[0]?.stage || 1, issues };
  }

  function normalizeSearch(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "");
  }

  const api = Object.freeze({ groups: Object.freeze(groups), labels, dateKeys: Object.freeze(dateKeys), today, asDate, dateKey, validDate, evaluate, normalizeSearch });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StartEligibilityCore = api;
})(typeof window === "undefined" ? globalThis : window);
