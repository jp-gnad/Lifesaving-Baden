import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const failures = [];
const read = (name) => readFileSync(resolve(root, name), "utf8");
const files = (directory) => readdirSync(resolve(root, directory), { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
const htmlFiles = readdirSync(root).filter((name) => name.endsWith(".html"))
  .concat(files("timer").filter((name) => name.endsWith(".html")), ["firebase-hosting/404.html"]);
const sourceFiles = [...files("assets/js"), ...files("timer"), ...files("tools")]
  .filter((name) => [".js", ".mjs"].includes(extname(name)));

function checkLocal(owner, value) {
  if (!value || value.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return;
  const url = new URL(value, `https://project.invalid/${owner}`);
  const target = resolve(root, `.${decodeURIComponent(url.pathname)}`);
  if (!existsSync(target) || (statSync(target).isDirectory() && !existsSync(resolve(target, "index.html")))) {
    failures.push(`${owner}: missing local file ${value}`);
  }
}

// Ordered dependencies are explicit because this site runs directly from HTML,
// without a bundler that could otherwise detect missing modules/imports.
const dependencies = {
  "assets/js/auth.js": ["assets/js/auth-core.js", "assets/js/admin-accounts.js"],
  "assets/js/clubs.js": ["assets/js/clubs-core.js", "assets/js/clubs-store.js", "assets/js/start-eligibility-core.js"],
  "assets/js/worktime.js": ["assets/js/worktime-core.js", "assets/js/worktime-store.js"],
  "timer/firestore-api.js": ["assets/js/auth-core.js", "timer/core.js", "timer/participant-store.js", "timer/result-feed.js"],
  "timer/app.js": ["timer/core.js", "timer/control-input.js", "timer/offline-store.js", "timer/results-pdf.js", "timer/views/people.js", "timer/firestore-api.js"],
};

for (const name of sourceFiles) {
  try {
    if (name.endsWith(".mjs")) {
      const result = spawnSync(process.execPath, ["--check", resolve(root, name)], { encoding: "utf8" });
      if (result.status !== 0) failures.push(`${name}: ${result.stderr || result.error}`);
    } else new Script(read(name), { filename: name });
  } catch (error) { failures.push(`${name}: ${error.message}`); }
}

for (const name of htmlFiles) {
  const html = read(name).replace(/<!--[\s\S]*?-->/g, "");
  for (const [, tag] of html.matchAll(/<(?:script|link|img|a|source|iframe)\b([^>]*?)>/gi)) {
    for (const [, value] of tag.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) checkLocal(name, value);
  }
  const scripts = [];
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (src) {
      const url = new URL(src, `https://project.invalid/${name}`);
      if (url.hostname === "project.invalid") scripts.push(url.pathname.slice(1));
    } else if (!/\btype\s*=\s*["'](?:application\/ld\+json|application\/json)["']/i.test(attributes)) {
      try { new Script(body, { filename: `${name}:inline` }); }
      catch (error) { failures.push(`${name}: invalid inline script: ${error.message}`); }
    }
  }
  scripts.forEach((script, index) => {
    for (const dependency of dependencies[script] || []) {
      if (!scripts.slice(0, index).includes(dependency)) failures.push(`${name}: ${dependency} must load before ${script}`);
    }
  });
}

for (const name of files("assets/css").concat(["timer/styles.css"])) {
  for (const [, value] of read(name).matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) checkLocal(name, value);
}
for (const name of ["manifest.webmanifest", "timer/manifest.webmanifest"]) {
  const manifest = JSON.parse(read(name));
  for (const icon of manifest.icons || []) checkLocal(name, icon.src);
  checkLocal(name, manifest.start_url);
}

const worker = read("timer/sw.js");
const shell = worker.match(/const relativeAppShell = \[([\s\S]*?)\];/)?.[1] || "";
const shellPaths = [...shell.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
shellPaths.forEach((value) => checkLocal("timer/sw.js", value));
for (const [, src] of read("timer/index.html").matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
  if (/^https?:/.test(src)) continue;
  if (!shellPaths.includes(src)) failures.push(`timer/sw.js: precache must include the current script URL ${src}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log(`Project checks passed: ${sourceFiles.length} JavaScript files, ${htmlFiles.length} HTML pages, local assets, dependencies and offline shell.`);
