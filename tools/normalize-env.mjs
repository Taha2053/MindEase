// Explicit local maintenance command. Never prints configuration values.
import { readFileSync, writeFileSync, copyFileSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const paths = [".env", "server/.env"];
const files = paths.map(path => readFileSync(`${root}${path}`, "utf8").split(/\r?\n/));
const nameOf = line => line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/)?.[1];
const publicNames = new Set(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
for (const name of publicNames) {
  const existing = files[0].some(line => nameOf(line) === name);
  const matches = files[1].filter(line => nameOf(line) === name);
  if (!existing && matches.length) files[0].push(matches.at(-1));
  files[1] = files[1].filter(line => nameOf(line) !== name);
}
const normalized = files.map(lines => {
  const last = new Map();
  lines.forEach((line, index) => { const name = nameOf(line); if (name) last.set(name, index); });
  return lines.filter((line, index) => !nameOf(line) || last.get(nameOf(line)) === index).join("\n");
});
// Back up both inputs before changing either. .local backups are Git-ignored.
const stamp = Date.now();
paths.forEach(path => copyFileSync(`${root}${path}`, `${root}${path}.${stamp}.backup.local`, constants.COPYFILE_EXCL));
paths.forEach((path, index) => writeFileSync(`${root}${path}`, normalized[index], { mode: 0o600 }));
console.log("Normalized both environment files. Preserved last assignments and created ignored .backup.local copies. No values printed.");
