/* ── Types ───────────────────────────────────────────────────────── */

export type NapkinStyle =
  | "colorful" | "casual" | "hand-drawn" | "formal" | "monochrome";

export type NapkinFormat = "svg" | "png";

export type NapkinVisualQuery =
  | "flowchart" | "mindmap" | "timeline" | "venn";

export type NapkinOrientation =
  | "auto" | "horizontal" | "vertical" | "square";

export type NapkinSortStrategy =
  | "relevance" | "random";

export interface NapkinOptions {
  style?: NapkinStyle;
  format?: NapkinFormat;
  visualQuery?: NapkinVisualQuery;
  orientation?: NapkinOrientation;
  sortStrategy?: NapkinSortStrategy;
  styleId?: string;
  contextBefore?: string;
  contextAfter?: string;
}

interface NapkinCreateResponse {
  request_id: string;
}

interface NapkinFileInfo {
  file_id: string;
  url: string;
  format: NapkinFormat;
}

interface NapkinStatusResponse {
  status: "pending" | "processing" | "completed" | "failed";
  generated_files: NapkinFileInfo[];
  error?: { message: string; code: string };
}

export interface NapkinResult {
  concept: string;
  format: NapkinFormat;
  dataUrl: string;
  width: number;
  height: number;
  fileId: string;
}

/* ── Config ─────────────────────────────────────────────────────── */

const NAPKIN_API_BASE = import.meta.env.DEV
  ? "http://localhost:3001"
  : "https://api.napkin.ai/v1";

const NAPKIN_API_KEY = import.meta.env.VITE_NAPKIN_API_KEY as string | undefined;

/* ── Auth headers ───────────────────────────────────────────────── */

function authHeaders(): Record<string, string> {
  if (!NAPKIN_API_KEY) {
    throw new Error("[NapkinClient] VITE_NAPKIN_API_KEY is not set");
  }
  return {
    Authorization: `Bearer ${NAPKIN_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/* ── Step 1: Create visual request ──────────────────────────────── */

async function createVisualRequest(
  text: string,
  options: NapkinOptions = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    content: text,
    style: options.style ?? "formal",
    format: options.format ?? "svg",
  };

  if (options.visualQuery) body.visual_query = options.visualQuery;
  if (options.orientation) body.orientation = options.orientation;
  if (options.sortStrategy) body.sort_strategy = options.sortStrategy;
  if (options.styleId) body.style_id = options.styleId;
  if (options.contextBefore) body.context_before = options.contextBefore;
  if (options.contextAfter) body.context_after = options.contextAfter;

  const res = await fetch(`${NAPKIN_API_BASE}/visual/request`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`[NapkinClient] Create visual failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as NapkinCreateResponse;
  return data.request_id;
}

/* ── Step 2: Poll status ────────────────────────────────────────── */

async function pollStatus(
  requestId: string,
  maxRetries = 30,
  intervalMs = 2000,
): Promise<NapkinStatusResponse> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(`${NAPKIN_API_BASE}/visual/${requestId}/status`, {
      headers: authHeaders(),
    });

    if (!res.ok) {
      throw new Error(`[NapkinClient] Status poll failed (${res.status})`);
    }

    const data = (await res.json()) as NapkinStatusResponse;

    switch (data.status) {
      case "completed":
        return data;
      case "failed":
        throw new Error(
          `[NapkinClient] Visual generation failed: ${data.error?.message ?? "Unknown error"}`,
        );
      case "pending":
      case "processing":
        await sleep(intervalMs * Math.min(2 ** i, 8));
        continue;
    }
  }

  throw new Error("[NapkinClient] Polling timed out");
}

/* ── Step 3: Download file ──────────────────────────────────────── */

async function downloadFile(fileUrl: string): Promise<Blob> {
  const res = await fetch(fileUrl, {
    headers: {
      Authorization: `Bearer ${NAPKIN_API_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`[NapkinClient] Download failed (${res.status})`);
  }

  return res.blob();
}

/* ── Public API ─────────────────────────────────────────────────── */

export async function generateNapkinVisual(
  concept: string,
  options: NapkinOptions = {},
): Promise<NapkinResult> {
  const text = `Explain the concept: ${concept}`;

  const requestId = await createVisualRequest(text, options);
  const status = await pollStatus(requestId);

  if (!status.generated_files?.length) {
    throw new Error(`[NapkinClient] No files generated for concept: ${concept}`);
  }

  const file = status.generated_files[0];
  const blob = await downloadFile(file.url);
  const dataUrl = await blobToDataURL(blob);

  return {
    concept,
    format: file.format,
    dataUrl,
    width: 800,
    height: 600,
    fileId: file.file_id,
  };
}

export async function generateNapkinVisuals(
  concepts: string[],
  options: NapkinOptions = {},
): Promise<NapkinResult[]> {
  const results = await Promise.allSettled(
    concepts.map((concept) => generateNapkinVisual(concept, options)),
  );

  const visuals: NapkinResult[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      visuals.push(r.value);
    } else {
      console.warn("[NapkinClient] Skipped concept:", r.reason?.message || r.reason);
    }
  }

  return visuals;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
