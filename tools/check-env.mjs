import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const readNames = (relativePath) => {
  const path = `${root}${relativePath}`;
  const entries = new Map();
  if (!existsSync(path)) return entries;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, name, raw] = match;
    const value = raw.trim().replace(/^(['"])(.*)\1$/, "$2");
    const previous = entries.get(name);
    entries.set(name, {
      count: (previous?.count ?? 0) + 1,
      value,
      populated: Boolean(value) && !/^(?:PASTE_|your[-_]|sk-your|<)/i.test(value),
    });
  }
  return entries;
};

const extension = readNames(".env");
const server = readNames("server/.env");
let issues = 0;
const check = (name, entries, location) => {
  if (entries.get(name)?.populated) {
    console.log(`${location}: ${name} populated (not authenticated)`);
  } else {
    console.log(`${location}: ${name} missing, empty, or placeholder`);
    issues += 1;
  }
};

console.log("Configuration names and presence only; no credential values are printed.");
for (const name of ["VITE_MISTRAL_API_KEY", "VITE_NAPKIN_API_KEY", "VITE_OCR_SPACE_API_KEY"]) {
  check(name, extension, ".env");
}
console.log("Cloud authentication requires deployed Supabase tables and policies as well as credentials.");
for (const name of ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) {
  check(name, extension, ".env");
  if (!extension.has(name) && server.has(name)) {
    console.log(`Move ${name} from server/.env to .env for Vite to load it.`);
  }
}
for (const name of ["MISTRAL_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "DEEPSEEK_API_KEY", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"]) {
  check(name, server, "server/.env");
}
for (const [location, entries] of [[".env", extension], ["server/.env", server]]) {
  for (const [name, entry] of entries) {
    if (entry.count > 1) {
      console.log(`${location}: ${name} appears ${entry.count} times; keep one intended assignment.`);
      issues += 1;
    }
  }
}
const mode = process.env.STORAGE_MODE || server.get("STORAGE_MODE")?.value || "local";
console.log(`Video storage mode: ${mode}`);
if (mode === "local") {
  const media = resolve(root, "server", process.env.MEDIA_DIR || server.get("MEDIA_DIR")?.value || "./media/videos");
  console.log(`Video directory (npm run server): ${media} (${existsSync(media) ? "exists" : "created on first use"})`);
  console.log("Relative MEDIA_DIR resolves against the backend working directory; use an absolute path for other launch commands.");
} else if (mode === "r2") {
  for (const name of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_PUBLIC_URL"]) check(name, server, "server/.env");
} else { console.log("Unsupported STORAGE_MODE"); issues += 1; }
console.log(`Diagram database default: ${resolve(root, "server/data/diagrams.sqlite3")}`);
console.log(`Video metadata database default: ${resolve(root, "server/arxiviz.db")}`);
console.log("Extension visual previews: browser.storage.local / mindease_visuals_cache. Backend files must remain available for later playback.");
console.log(`Configuration issues: ${issues}. Provider connectivity was not tested.`);
process.exitCode = issues ? 1 : 0;
