import { readServiceAccount } from "./lib/firebase-project.mjs";
// Existing accounts: preview with no flags; write with --apply.
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

if (process.argv.slice(2).some((arg) => arg !== "--apply")) throw new Error("Only --apply is supported.");
const serviceAccount = readServiceAccount();
initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth();
const db = getFirestore();
const apply = process.argv.includes("--apply");
let pageToken;
let count = 0;
do {
  const page = await auth.listUsers(1000, pageToken);
  for (const user of page.users) {
    const googleEmail = user.providerData.find((provider) => provider.providerId === "google.com")?.email || "";
    const ref = db.collection("users").doc(user.uid);
    const changed = await db.runTransaction(async (transaction) => {
      const profile = await transaction.get(ref);
      if (!profile.exists || (profile.data().googleEmail || "") === googleEmail) return false;
      if (apply) transaction.update(ref, { googleEmail, updatedAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (changed) count += 1;
  }
  pageToken = page.pageToken;
} while (pageToken);
console.log(`${apply ? "Updated" : "Would update"} Google email metadata on ${count} existing profiles.`);
