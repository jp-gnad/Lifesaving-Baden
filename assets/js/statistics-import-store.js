(function (root) {
  "use strict";

  const order = ["statsDisciplines", "statsOrganizations", "statsAthletes", "statsCompetitions", "statsResults"];
  const blockSize = 25;
  function equal(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
  }

  function isOrganizationExpansion(item, before, fields, lvNames) {
    if (item.collection !== "statsOrganizations" || fields.length !== 1 || fields[0] !== "name" ||
        typeof before.name !== "string") return false;
    const code = before.name.toUpperCase();
    return item.data.type === "LV" && Object.hasOwn(lvNames, code) && lvNames[code] === item.data.name ||
      item.data.type === "BV" && code === "GER" && item.data.name === "Deutschland";
  }

  function planItem(item, ref, snapshot, lvNames) {
    const before = snapshot.exists ? snapshot.data() : null;
    let data = item.data;
    if (item.collection === "statsCompetitions" && before?.phaseCount > (data.phaseCount ?? 0)) {
      data = { ...data, phaseCount: before.phaseCount };
    }
    const fields = Object.keys(data).filter(key => {
      const old = before?.[key];
      return !equal(key === "rankingStatus" ? old ?? null : old, data[key]);
    });
    if (before && fields.length &&
        ["statsOrganizations", "statsAthletes"].includes(item.collection) &&
        !isOrganizationExpansion(item, before, fields, lvNames)) {
      throw new Error(`Zeile ${item.row}: abweichende Stammdaten bei vorhandener ID. Schreibweise und Identität prüfen.`);
    }
    if (before && item.collection === "statsResults" &&
        fields.some(key => ["athleteId", "competitionId", "round"].includes(key))) {
      throw new Error(`Zeile ${item.row}: Sportler, Wettkampf und Wettkampfphase des vorhandenen Ergebnisses prüfen.`);
    }
    return { ...item, data, ref, before, fields, action: !before ? "new" : fields.length ? "update" : "same" };
  }

  async function compare(db, records, lvNames, requireSession) {
    const ordered = [...records].sort((a, b) => order.indexOf(a.collection) - order.indexOf(b.collection));
    const plan = [];
    for (let offset = 0; offset < ordered.length; offset += blockSize) {
      requireSession();
      const group = ordered.slice(offset, offset + blockSize);
      const refs = group.map(item => db.collection(item.collection).doc(item.id));
      const snapshots = await Promise.all(refs.map(ref => ref.get({ source: "server" })));
      requireSession();
      for (let i = 0; i < group.length; i++) plan.push(planItem(group[i], refs[i], snapshots[i], lvNames));
    }
    return plan;
  }

  async function apply(db, plan, requireSession, onProgress) {
    const changes = plan.filter(item => item.action !== "same");
    for (let offset = 0; offset < changes.length; offset += blockSize) {
      requireSession();
      const group = changes.slice(offset, offset + blockSize);
      await db.runTransaction(async transaction => {
        requireSession();
        const snapshots = await Promise.all(group.map(item => transaction.get(item.ref)));
        requireSession();
        for (const [index, item] of group.entries()) {
          if (!equal(snapshots[index].exists ? snapshots[index].data() : null, item.before)) {
            throw new Error("Die Daten haben sich seit der Vorschau geändert. Bitte die Vorschau neu erstellen.");
          }
        }
        for (const item of group) {
          if (item.action === "new") {
            const defaults = item.collection === "statsOrganizations" ? { active: true, successorId: null } : {};
            transaction.set(item.ref, { ...defaults, ...item.data });
          } else {
            transaction.update(item.ref, Object.fromEntries(item.fields.map(key => [key, item.data[key]])));
          }
        }
      });
      requireSession();
      onProgress(offset + group.length, changes.length);
    }
  }

  const api = Object.freeze({ compare, apply });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LifesavingStatisticsStore = api;
})(globalThis);
