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

  function findCandidates(records) {
    const byId = new Map(records.map(record => [record.id, record]));
    const groups = new Map();
    for (const record of byId.values()) {
      const normalized = comparable(record.name);
      if (!normalized || !record.type) continue;
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

  const api = Object.freeze({ findCandidates });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LifesavingStatisticsOrganizationAudit = api;
})(globalThis);
