(function (root) {
  "use strict";

  const german = new Intl.Collator("de", { numeric: true });
  const genders = { w: "Weiblich", m: "Männlich", d: "Divers" };
  const startFields = { OG: "ogId", BZ: "bzId", LV: "lvId", BV: "bvId" };
  const rankingLabels = { AK: "AK", EXCLUDED: "ausg." };
  const disciplineStatus = { DQ: "disq.", DNS: "n.a.", PASS: "bestanden", FAIL: "nicht bestanden" };

  function groups(results) {
    const ages = new Map();
    const overall = new Map();
    let phaseCount = 0;
    for (const result of results) {
      if (!ages.has(result.ageGroup)) ages.set(result.ageGroup, new Map());
      const age = ages.get(result.ageGroup);
      if (!age.has(result.gender)) age.set(result.gender, []);
      age.get(result.gender).push(result);
      phaseCount = Math.max(phaseCount, result.round || 0);
      if (result.rankingStatus === "EXCLUDED" || (result.rankingStatus === "AK" && !overall.has(result.athleteId))) {
        overall.set(result.athleteId, result.rankingStatus);
      }
    }
    const ageGroups = [...ages].sort(([a], [b]) => german.compare(a || "Ohne Altersklasse", b || "Ohne Altersklasse"))
      .map(([age, gendersInAge]) => ({
        label: /^\d/.test(age) ? `AK ${age}` : age || "Ohne Altersklasse",
        genders: [...gendersInAge].sort(([a], [b]) => german.compare(genders[b] || "", genders[a] || ""))
          .map(([gender, rows]) => ({ label: genders[gender] || "Ohne Angabe", rows })),
      }));
    return { ages: ageGroups, overall, phaseCount };
  }

  function phaseLabel(round, count) {
    if (round == null) return "Direktes Finale";
    if (count < 2) return "Einzelner Durchgang";
    if (round === count) return "Finale";
    return round === 1 ? "Vorlauf" : "Zwischenlauf";
  }

  function tables(rows, phaseCount) {
    const partitions = new Map();
    for (const row of rows) {
      const key = JSON.stringify([row.round, row.classification]);
      if (!partitions.has(key)) partitions.set(key, { round: row.round, classification: row.classification, rows: [] });
      partitions.get(key).rows.push(row);
    }
    return [...partitions.values()].sort((a, b) =>
      (b.round ?? 4) - (a.round ?? 4) || german.compare(a.classification || "", b.classification || ""))
      .map(group => ({
        ...group,
        label: [phaseLabel(group.round, phaseCount), group.classification].filter(Boolean).join(" · "),
      }));
  }

  function organizationId(result) {
    const key = startFields[String(result.startRight ?? "").trim().toUpperCase()] || "ogId";
    return result[key];
  }

  function name(athlete) {
    if (!athlete) return "Unbekannte Person";
    return `${athlete.lastName}, ${athlete.firstName}${athlete.discriminator ? ` (${athlete.discriminator})` : ""}`;
  }

  function sortRows(rows, overall, athletes) {
    const rank = row => !overall.has(row.athleteId) && Number.isFinite(row.place) ? row.place : Infinity;
    return [...rows].sort((a, b) => rank(a) - rank(b) ||
      Number(overall.has(a.athleteId)) - Number(overall.has(b.athleteId)) ||
      german.compare(name(athletes.get(a.athleteId)), name(athletes.get(b.athleteId))));
  }

  function timeText(timeMs) {
    if (!Number.isFinite(timeMs) || timeMs < 0) return "—";
    const cs = Math.round(timeMs / 10);
    return `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")},${String(cs % 100).padStart(2, "0")}`;
  }

  function birthYearText(year) {
    return Number.isInteger(year) ? String(year % 100).padStart(2, "0") : "—";
  }

  function placing(place, rankingStatus) {
    return rankingLabels[rankingStatus] ?? place ?? "—";
  }

  function penalties(entry, pointsText) {
    const parts = [disciplineStatus[entry.status]];
    if (Number.isFinite(entry.penaltyPoints) && entry.penaltyPoints !== 0) parts.push(`${pointsText(entry.penaltyPoints)} P.`);
    return parts.filter(Boolean).join(" · ") || "—";
  }

  const api = Object.freeze({ groups, tables, organizationId, sortRows, name, timeText, birthYearText, placing, penalties });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LifesavingStatisticsOverviewCore = api;
})(globalThis);
