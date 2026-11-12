import { readServiceAccount } from "./lib/firebase-project.mjs";
// One-time cleanup after deploying the person-selection linking flow.
// Preview: node tools/reset_legacy_person_links.mjs
// Apply:   node tools/reset_legacy_person_links.mjs --apply
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

if (process.argv.slice(2).some((arg) => arg !== "--apply")) throw new Error("Only --apply is supported.");
const serviceAccount = readServiceAccount();
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const apply = process.argv.includes("--apply");
const legacyKeys = ["linkedPersonId", "personId", "personLinked", "personLinkDecision", "personLinkIssue"];
const legacy = (data) => !data.personLink && (legacyKeys.some((key) => key in data) || data.personLinkStatus === "linked");
let count = 0;
const accounts = await db.collection("users").get();
for (const snapshot of accounts.docs) {
  if (!legacy(snapshot.data())) continue;
  if (!apply) { count += 1; continue; }
  const changed = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(snapshot.ref);
    if (!current.exists || !legacy(current.data())) return false;
    const data = current.data();
    transaction.update(snapshot.ref, {
      ...Object.fromEntries(legacyKeys.map((key) => [key, FieldValue.delete()])),
      personLinkStatus: data.personLinkRequest?.status === "requested" ? "requested" : "open",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (changed) count += 1;
}
console.log(`${apply ? "Reset" : "Would reset"} ${count} legacy links. Profiles and pending requests are preserved.`);
