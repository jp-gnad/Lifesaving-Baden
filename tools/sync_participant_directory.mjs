import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const [, , inputPath] = process.argv;
if (!inputPath) throw new Error("Usage: node sync_participant_directory.mjs <records.json>");
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing.");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
initializeApp({ credential: cert(serviceAccount) });

const records = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(records) || !records.length) throw new Error("Directory JSON must contain a nonempty array.");

const db = getFirestore();
const collection = db.collection("timerParticipantDirectory");
const existing = await collection.get();
const incomingIds = new Set(records.map((record) => record.id));
const operations = [
  ...records.map((record) => ({ type: "set", ref: collection.doc(record.id), data: {
    name: record.name,
    birthYear: record.birthYear,
    gender: record.gender,
    organization: record.organization,
    searchName: record.searchName,
  } })),
  ...existing.docs
    .filter((document) => !incomingIds.has(document.id))
    .map((document) => ({ type: "delete", ref: document.ref })),
];

for (let offset = 0; offset < operations.length; offset += 400) {
  const batch = db.batch();
  for (const operation of operations.slice(offset, offset + 400)) {
    if (operation.type === "delete") batch.delete(operation.ref);
    else batch.set(operation.ref, operation.data);
  }
  await batch.commit();
}

const clubs = db.collection("clubDirectory");
const names = [...new Set(records.map((record) => String(record.organization || "").trim()).filter(Boolean))];
const clubRecords = new Map(names.map((name) => [Buffer.from(name.toLowerCase(), "utf8").toString("hex"), {
  name, searchName: name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]/g, ""),
}]));
const previousClubs = await clubs.get();
const clubWrites = [
  ...[...clubRecords].map(([id, data]) => ({ ref: clubs.doc(id), data })),
  ...previousClubs.docs.filter((doc) => !clubRecords.has(doc.id)).map((doc) => ({ ref: doc.ref, data: null })),
];
for (let offset = 0; offset < clubWrites.length; offset += 400) {
  const batch = db.batch();
  for (const { ref, data } of clubWrites.slice(offset, offset + 400)) {
    if (data) batch.set(ref, data);
    else batch.delete(ref);
  }
  await batch.commit();
}

console.log(`Synchronized ${records.length} participant directory records.`);
