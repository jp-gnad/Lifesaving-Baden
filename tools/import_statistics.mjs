// Local worker for import_statistics.py. No module in this file is loaded by Pages.
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { projectId, readServiceAccount } from "./lib/firebase-project.mjs";
import { compareStatistics, applyStatistics } from "./lib/statistics-store.mjs";

function connect(emulator) {
  if (emulator) {
    process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
      throw new Error("Der Emulator muss lokal laufen.");
    }
    return initializeApp({ projectId: "demo-lifesaving-baden" });
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Für Emulatorzugriff --emulator angeben.");
  return initializeApp({ projectId, credential: cert(readServiceAccount()) });
}

function preview(plan) {
  const competition = plan.find(item => item.collection === "statsCompetitions");
  const phases = {
    1: "1 = einziger Durchgang, keine separate Finalphase",
    2: "1 = Vorlauf, 2 = Finale",
    3: "1 = Vorlauf, 2 = Zwischenlauf, 3 = Finale",
  };
  const phaseDescription = phases[competition.data.phaseCount];
  if (phaseDescription) console.log(`Wettkampfphasen: ${phaseDescription}`);
  const summary = {};
  for (const item of plan) {
    const counts = summary[item.collection] ??= { neu: 0, aktualisieren: 0, unverändert: 0 };
    counts[item.action]++;
    if (item.action === "aktualisieren") {
      console.log(`Zeile ${item.row ?? "Katalog"} · ${item.id} · ${item.fields.join(", ")}`);
      for (const field of item.fields) {
        console.log(`  ${field}: ${JSON.stringify(item.before[field])} → ${JSON.stringify(item.data[field])}`);
      }
    } else if (item.action === "neu" && ["statsOrganizations", "statsAthletes"].includes(item.collection)) {
      const data = item.data;
      const suffix = data.discriminator ? ` (${data.discriminator})` : "";
      const label = item.collection === "statsOrganizations"
        ? `${data.type} ${data.name} (übergeordnet: ${data.parentId ?? "–"})`
        : `${data.lastName}, ${data.firstName}${suffix} · ${data.birthYear} · ${data.gender}`;
      console.log(`Zeile ${item.row} · neu · ${label} · ${item.id}`);
    }
  }
  console.table(summary);
  const writes = plan.filter(item => item.action !== "unverändert").length;
  console.log(`Abgleich: ${plan.length} Dokumente gelesen. Geplante Schreibvorgänge: ${writes}.`);
  return writes;
}

async function run() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file || flags.some(f => !["--emulator", "--apply"].includes(f))) {
    throw new Error("Aufruf über python tools/import_statistics.py.");
  }
  const bytes = await readFile(file);
  const records = JSON.parse(bytes);
  const event = records.find(item => item.collection === "statsCompetitions")?.data;
  if (!event?.name) throw new Error("Wettkampf fehlt.");
  const app = connect(flags.includes("--emulator"));
  try {
    const target = app.options.projectId;
    console.log(`Datenbank: ${target} · Wettkampf: ${event.name} · ${event.date}`);
    const db = getFirestore(app);
    const plan = await compareStatistics(db, records);
    const writes = preview(plan);
    if (!writes || !flags.includes("--apply")) return;
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    let confirmed;
    try {
      confirmed = await prompt.question(`Zum Import von ${writes} Dokumenten in ${target} IMPORT eingeben: `);
    } finally {
      prompt.close();
    }
    if (confirmed !== "IMPORT") {
      console.log("Import abgebrochen. 0 Schreibvorgänge.");
      return;
    }
    const dir = path.join(homedir(), ".lifesaving-baden", "importprotokolle");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const log = path.join(dir, randomUUID() + ".jsonl");
    const record = entry => appendFile(log, JSON.stringify({ time: new Date().toISOString(), ...entry }) + "\n",
      { mode: 0o600 });
    console.log(`Importprotokoll: ${log}`);
    await record({ state: "start", target, competitionId: plan.find(x => x.collection === "statsCompetitions").id,
      sha256: createHash("sha256").update(bytes).digest("hex"), writes });
    try {
      const done = await applyStatistics(db, plan, committed => record({ state: "batch", committed }));
      await record({ state: "complete", committed: done });
      console.log(`Abgeschlossen. ${done} Dokumente geschrieben.`);
    } catch (error) {
      await record({ state: "interrupted" });
      throw error;
    }
  } finally {
    await deleteApp(app);
  }
}

run().catch(error => {
  console.error("Import beendet.", error.message);
  process.exitCode = 1;
});
