import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const [, , inputPath] = process.argv;
if (!inputPath) throw new Error("Usage: node sync_participant_directory.mjs <records.json>");
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing.");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
initializeApp({ credential: cert(serviceAccount) });

const records = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(records)) throw new Error("Directory JSON must contain an array.");

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

console.log(`Synchronized ${records.length} participant directory records.`);
