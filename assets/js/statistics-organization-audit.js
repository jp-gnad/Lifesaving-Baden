(function (root) {
  "use strict";

  const german = new Intl.Collator("de", { numeric: true });
  const comparable = value => String(value ?? "").normalize("NFC").toLowerCase().trim()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .replace(/[\s/\p{Dash_Punctuation}]+/gu, " ").trim();

  function ancestry(record, byId) {
    const parents = [];
    const visited = new Set([record.id]);
    let id = record.parentId;
    while (id && !visited.has(id) && parents.length < 4) {
      visited.add(id);
      const parent = byId.get(id);
      if (!parent) break;
      parents.unshift(parent);
      id = parent.parentId;
    }
    const resolved = parents.map(parent => `${parent.type} ${parent.name}`);
    if (id) resolved.unshift(`Unvollständiger Pfad (${id})`);
    return resolved;
  }

  function findCandidates(records, proposed = new Map()) {
    const byId = new Map(records.map(record => [record.id, record]));
    const groups = new Map();
    for (const record of byId.values()) {
      const normalized = comparable(byId.get(proposed.get(record.id))?.name ?? record.name);
      if (!normalized || !record.type || record.aliasOf) continue;
      const key = record.type + "|" + normalized;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    return [...groups.values()].filter(group => group.length > 1).map(group => {
      const entries = group.map(record => ({ ...record, path: ancestry(record, byId) }));
      const sameParent = group.every(record => record.parentId === group[0].parentId);
      const samePath = entries.every(record => comparable(record.path.join(" > ")) === comparable(entries[0].path.join(" > ")));
      const sameParentLabel = group[0].parentId ? "Gleiche übergeordnete Gliederung" : "Auf derselben obersten Ebene";
      return {
        name: [...new Set(group.map(record => record.name))].join(" / "),
        type: group[0].type,
        reason: sameParent ? sameParentLabel
          : samePath ? "Gleiche Hierarchie mit unterschiedlichen IDs" : "Unterschiedliche Hierarchie",
        entries,
      };
    }).sort((a, b) => german.compare(a.name, b.name));
  }

  const levels = ["BV", "LV", "BZ", "OG"];
  const parentTypes = { BV: [], LV: ["BV"], BZ: ["LV"], OG: ["LV", "BZ"] };
  const germanFederationNames = new Set(["ger", "de", "deu", "deutschland"]);
  const lower = name => String(name ?? "").trim().toLowerCase();
  function sameName(source, target) {
    const name = lower(source.name), other = lower(target.name);
    return name === other || (source.type === "BV" && germanFederationNames.has(name) && other === "deutschland") ||
      (source.type === "OG" && other === "bermatingen-markdorf" && /^bermatingen\s*[-/]\s*markdorf$/.test(name));
  }

  async function planAliases(records, identify) {
    const byId = new Map(records.map(record => [record.id, record]));
    const accepted = new Map();
    const roots = new Map();
    const changes = [];
    for (const level of levels) {
      for (const source of byId.values()) {
        if (source.type !== level || !source.name) continue;
        const parent = byId.get(source.parentId);
        if (level === "BV" ? source.parentId != null : !parentTypes[level].includes(parent?.type)) continue;
        const parentId = source.parentId == null ? null : accepted.get(source.parentId);
        const federation = level === "BV" ? source.name : roots.get(source.parentId);
        if (parentId === undefined || !federation) continue;
        let identity;
        try { identity = await identify(level, source.name, parentId, federation); }
        catch { continue; }
        const target = byId.get(identity.id);
        if (!target || target.aliasOf || target.type !== level || target.parentId !== parentId ||
            !sameName(source, target) || lower(target.name) !== lower(identity.name) ||
            (source.active ?? true) !== (target.active ?? true) ||
            (source.successorId ?? null) !== (target.successorId ?? null) ||
            (source.aliasOf && source.aliasOf !== target.id)) continue;
        accepted.set(source.id, target.id);
        roots.set(source.id, federation);
        if (source.id !== target.id && !source.aliasOf) changes.push({ source, target });
      }
    }
    return changes;
  }

  function unchanged(data, expected) {
    return data && ["name", "type", "parentId", "active", "successorId", "aliasOf"]
      .every(key => (data[key] ?? null) === (expected[key] ?? null));
  }

  async function saveAliases(db, changes, requireSession) {
    const collection = db.collection("statsOrganizations");
    const batchSize = 4;
    for (let offset = 0; offset < changes.length; offset += batchSize) {
      requireSession();
      const batch = changes.slice(offset, offset + batchSize);
      await db.runTransaction(async transaction => {
        requireSession();
        const pairs = await Promise.all(batch.map(async ({ source, target }) => {
          const ref = collection.doc(source.id);
          const [old, destination] = await Promise.all([transaction.get(ref), transaction.get(collection.doc(target.id))]);
          if (!unchanged(destination.data(), target) ||
              (!unchanged(old.data(), source) && !unchanged(old.data(), { ...source, aliasOf: target.id }))) {
            throw new Error("Gliederungen wurden seit der Prüfung geändert. Bitte erneut prüfen.");
          }
          return { ref, targetId: target.id, assigned: old.data().aliasOf === target.id };
        }));
        requireSession();
        for (const { ref, targetId, assigned } of pairs) {
          if (!assigned) transaction.update(ref, { aliasOf: targetId });
        }
      });
    }
  }

  const api = Object.freeze({ findCandidates, planAliases, saveAliases });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LifesavingStatisticsOrganizationAudit = api;
})(globalThis);
