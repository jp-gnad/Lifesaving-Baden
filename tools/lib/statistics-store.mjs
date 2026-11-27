import { isDeepStrictEqual } from "node:util";

// Keep operational collections and arbitrary user-supplied paths outside this writer.
const kinds = new Map([
  ["statsDisciplines", /^D\d{3}$/],
  ["statsOrganizations", /^C[a-f0-9]{32}$/],
  ["statsAthletes", /^A[a-f0-9]{32}$/],
  ["statsCompetitions", /^W[a-f0-9]{32}$/],
  ["statsResults", /^R[a-f0-9]{32}$/],
]);
const order = [...kinds.keys()];

export async function compareStatistics(db, records) {
  const seen = new Set();
  const items = records.map(({ collection, id, data, row }) => {
    if (!kinds.get(collection)?.test(id) || !data || typeof data !== "object") {
      throw new Error("Ungültiges Archivdokument.");
    }
    const ref = db.collection(collection).doc(id);
    if (seen.has(ref.path)) throw new Error("Doppelte Dokument-ID in der Vorschau.");
    seen.add(ref.path);
    return { collection, id, data, row, ref };
  }).sort((a, b) => order.indexOf(a.collection) - order.indexOf(b.collection));
  for (let offset = 0; offset < items.length; offset += 200) {
    const group = items.slice(offset, offset + 200);
    const snapshots = await db.getAll(...group.map(item => item.ref));
    for (const [i, doc] of snapshots.entries()) {
      const item = group[i];
      item.before = doc.data() ?? {};
      item.version = doc.updateTime;
      item.fields = Object.keys(item.data).filter(key => !isDeepStrictEqual(item.before[key], item.data[key]));
      item.action = !doc.exists ? "neu" : item.fields.length ? "aktualisieren" : "unverändert";
      if (doc.exists && item.fields.length && ["statsAthletes", "statsOrganizations"].includes(item.collection)) {
        throw new Error(`Zeile ${item.row}: abweichende Stammdaten bei vorhandener ID ${item.id}. Schreibweise und Identität prüfen.`);
      }
      if (doc.exists && item.collection === "statsResults" &&
          item.fields.some(key => ["athleteId", "competitionId", "round"].includes(key))) {
        throw new Error(`Zeile ${item.row}: Sportler-, Wettkampf- oder Laufidentität des vorhandenen Ergebnisses prüfen.`);
      }
    }
  }
  return items;
}

export async function applyStatistics(db, plan, onCommit, chunkSize = 200) {
  const changes = plan.filter(item => item.action !== "unverändert");
  let done = 0;
  while (done < changes.length) {
    const group = changes.slice(done, done + chunkSize);
    const batch = db.batch();
    for (const item of group) {
      if (item.action === "neu") {
        const defaults = item.collection === "statsOrganizations" ? { active: true, successorId: null } : {};
        batch.create(item.ref, { ...defaults, ...item.data });
      } else {
        const update = Object.fromEntries(item.fields.map(key => [key, item.data[key]]));
        batch.update(item.ref, update, { lastUpdateTime: item.version });
      }
    }
    await batch.commit();
    done += group.length;
    await onCommit(done, changes.length);
  }
  return done;
}
