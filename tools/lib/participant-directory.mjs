export function participantRecords(records) {
  if (!Array.isArray(records) || !records.length) throw new Error("Directory JSON must contain a nonempty array.");
  const result = new Map();
  for (const record of records) {
    if (!record || typeof record.id !== "string" || !/^[a-f0-9]{16}$/.test(record.id)
      || typeof record.name !== "string" || !record.name.trim()
      || !Number.isInteger(record.birthYear) || record.birthYear < 1900 || record.birthYear > 9999
      || !["m", "w"].includes(record.gender) || typeof record.organization !== "string"
      || typeof record.searchName !== "string" || !/^[a-z0-9]*$/.test(record.searchName)) {
      throw new Error("Invalid participant directory record; refusing synchronization.");
    }
    if (result.has(record.id)) throw new Error("Duplicate participant ID; refusing synchronization.");
    result.set(record.id, {
      name: record.name, birthYear: record.birthYear, gender: record.gender,
      organization: record.organization, searchName: record.searchName,
    });
  }
  return result;
}

export function clubRecords(participants) {
  const names = [...new Set([...participants.values()].map((record) => record.organization.trim()).filter(Boolean))];
  return new Map(names.map((name) => [Buffer.from(name.toLowerCase(), "utf8").toString("hex"), {
    name, searchName: name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]/g, ""),
  }]));
}

export function collectionChanges(incoming, existing) {
  const previous = new Map(existing.map((document) => [document.id, document.data()]));
  const changes = [];
  for (const [id, data] of incoming) {
    const before = previous.get(id);
    if (!before || Object.keys(before).length !== Object.keys(data).length
      || Object.entries(data).some(([key, value]) => before[key] !== value)) changes.push({ id, data });
  }
  for (const id of previous.keys()) if (!incoming.has(id)) changes.push({ id, data: null });
  return changes;
}

export async function writeChanges(db, collection, changes) {
  for (let offset = 0; offset < changes.length; offset += 400) {
    const batch = db.batch();
    for (const { id, data } of changes.slice(offset, offset + 400)) {
      if (data) batch.set(collection.doc(id), data);
      else batch.delete(collection.doc(id));
    }
    await batch.commit();
  }
}
