(function (root) {
  "use strict";

  const german = new Intl.Collator("de", { numeric: true });
  const genders = { w: "Weiblich", m: "Männlich", d: "Divers" };
  const startFields = { OG: "ogId", BZ: "bzId", LV: "lvId", BV: "bvId" };
  const rankingLabels = { AK: "AK", EXCLUDED: "ausg." };
  const disciplineStatus = { DQ: "disq.", DNS: "n.a.", PASS: "bestanden", FAIL: "nicht bestanden" };
  const combinedClassifications = new Set(["einzelmehrkampf", "einzelkampfmehrkampf", "einzelundmehrkampf", "einzelkampfundmehrkampf"]);

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

  function resultSections(rows, phaseCount, compareDisciplines = (a, b) => german.compare(a, b)) {
    const phases = new Map();
    for (const row of rows) {
      const round = row.round ?? null;
      if (!phases.has(round)) phases.set(round, { totals: new Map(), disciplines: new Map() });
      const phase = phases.get(round);
      const classification = row.classification ?? "";
      const kind = classification.toLowerCase().replace(/[^a-z0-9]/g, "");
      const single = kind === "einzelkampf";
      const combined = combinedClassifications.has(kind);
      const ids = Object.keys(row.disciplines ?? {});
      if (!single || !ids.length) {
        if (!phase.totals.has(classification)) phase.totals.set(classification, []);
        phase.totals.get(classification).push(row);
      }
      if (single || combined) {
        for (const id of ids) {
          if (!phase.disciplines.has(id)) phase.disciplines.set(id, []);
          phase.disciplines.get(id).push(row);
        }
      }
    }

    const sections = [], byDiscipline = new Map();
    const rounds = [...phases.keys()].sort((a, b) => (a ?? 4) - (b ?? 4));
    for (const round of rounds) {
      const phase = phases.get(round);
      const label = phaseLabel(round, phaseCount);
      if (phase.totals.size) {
        const tables = [...phase.totals].sort(([a], [b]) => german.compare(a, b))
          .map(([classification, rows]) => ({ classification, rows, label }));
        sections.push({ label: phaseCount < 2 && round !== null ? "Wertung" : label, tables });
      }
      for (const id of [...phase.disciplines.keys()].sort(compareDisciplines)) {
        if (!byDiscipline.has(id)) {
          const section = { disciplineId: id, tables: [] };
          byDiscipline.set(id, section);
          sections.push(section);
        }
        byDiscipline.get(id).tables.push({ disciplineId: id, rows: phase.disciplines.get(id), label });
      }
    }
    return sections;
  }

  function organizationId(result) {
    const key = startFields[String(result.startRight ?? "").trim().toUpperCase()] || "ogId";
    return result[key];
  }

  function name(athlete) {
    if (!athlete) return "Unbekannte Person";
    return `${athlete.lastName}, ${athlete.firstName}${athlete.discriminator ? ` (${athlete.discriminator})` : ""}`;
  }

  function sortRows(rows, overall, athletes, disciplineId) {
    const ranked = rows.map(row => {
      const entry = disciplineId ? row.disciplines?.[disciplineId] : row;
      const unranked = overall.has(row.athleteId) || Boolean(entry?.rankingStatus);
      return { row, unranked, place: !unranked && Number.isFinite(entry?.place) ? entry.place : Infinity };
    });
    return ranked.sort((a, b) => a.place - b.place || Number(a.unranked) - Number(b.unranked) ||
      german.compare(name(athletes.get(a.row.athleteId)), name(athletes.get(b.row.athleteId))))
      .map(({ row }) => row);
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

  const api = Object.freeze({ groups, resultSections, organizationId, sortRows, name, timeText, birthYearText, placing, penalties });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LifesavingStatisticsOverviewCore = api;
})(globalThis);
