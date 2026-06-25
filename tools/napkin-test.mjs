import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually
const envRaw = readFileSync(resolve(__dirname, "../.env"), "utf-8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const TOKEN = env["VITE_NAPKIN_API_KEY"];
if (!TOKEN) {
  console.error("VITE_NAPKIN_API_KEY not found in .env");
  process.exit(1);
}

const BASE = "https://api.napkin.ai/v1";
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

async function test() {
  console.log("1. Creating visual request...");
  const createRes = await fetch(`${BASE}/visual`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      content:
        "Photosynthesis: Plants convert sunlight, water, and CO2 into glucose and oxygen. Sunlight is absorbed by chlorophyll in chloroplasts. Water is split releasing oxygen. CO2 is fixed into sugars via the Calvin cycle.",
      visual_query: "flowchart",
      orientation: "horizontal",
      sort_strategy: "relevance",
      style: "formal",
      format: "svg",
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.error(`Create failed (${createRes.status}):`, err);
    process.exit(1);
  }

  const { id } = await createRes.json();
  console.log(`  Request ID: ${id}`);

  console.log("2. Polling...");
  let status = "pending";
  let files = [];

  while (status === "pending" || status === "processing") {
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(`${BASE}/visual/${id}/status`, { headers: HEADERS });
    const data = await pollRes.json();
    status = data.status;
    console.log(`  Status: ${status}`);
    if (status === "completed") {
      files = data.generated_files ?? [];
    } else if (status === "failed") {
      console.error("  Error:", data.error?.message ?? "unknown");
      process.exit(1);
    }
  }

  if (files.length === 0) {
    console.error("No files generated");
    process.exit(1);
  }

  console.log(`  Generated ${files.length} visual(s):`);

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    console.log(`  [${i}] visual_id=${f.visual_id} ${f.width}x${f.height} query=${f.visual_query}`);

    console.log(`  Downloading...`);
    const dlRes = await fetch(f.url, { headers: HEADERS });
    const buf = Buffer.from(await dlRes.arrayBuffer());
    const outPath = resolve(__dirname, `napkin-test-output.${i}.svg`);
    writeFileSync(outPath, buf);
    console.log(`  Saved -> ${outPath} (${(buf.length / 1024).toFixed(1)} KB)`);
  }

  console.log("Done!");
}

test().catch((e) => {
  console.error("Unhandled:", e);
  process.exit(1);
});
