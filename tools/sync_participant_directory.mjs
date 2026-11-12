import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readServiceAccount } from "./lib/firebase-project.mjs";
import { participantRecords, clubRecords, collectionChanges, writeChanges } from "./lib/participant-directory.mjs";

const [, , inputPath] = process.argv;
if (!inputPath) throw new Error("Usage: node sync_participant_directory.mjs <records.json>");
// Validate the complete source before connecting or planning any deletions.
const participants = participantRecords(JSON.parse(await readFile(inputPath, "utf8")));
initializeApp({ credential: cert(readServiceAccount()) });
const db = getFirestore();
const people = db.collection("timerParticipantDirectory");
const clubs = db.collection("clubDirectory");
const [previousPeople, previousClubs] = await Promise.all([people.get(), clubs.get()]);
const peopleChanges = collectionChanges(participants, previousPeople.docs);
const clubChanges = collectionChanges(clubRecords(participants), previousClubs.docs);
await writeChanges(db, people, peopleChanges);
await writeChanges(db, clubs, clubChanges);
console.log(`Synchronized ${participants.size} participant directory records; ${peopleChanges.length} participant changes, ${clubChanges.length} club changes.`);
