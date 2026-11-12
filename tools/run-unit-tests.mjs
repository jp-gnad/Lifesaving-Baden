import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const tests = readdirSync(new URL("../tests/", import.meta.url))
  .filter((name) => name.endsWith(".test.cjs") && !name.endsWith("_rules.test.cjs"))
  .sort().map((name) => `tests/${name}`);
// Rule tests are a separate, explicit command; they must not look successful
// merely because every test silently skipped without a running local emulator.
const result = spawnSync(process.execPath, ["--test", ...tests], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
