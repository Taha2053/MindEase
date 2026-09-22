import { getApiKey } from "@/utils/apiKeyManager";
import { getSession } from "@/utils/supabase";

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
  learnerProfile?: object;
  style?: NapkinStyle;
  format?: NapkinFormat;
  visualQuery?: NapkinVisualQuery;
  orientation?: NapkinOrientation;
  sortStrategy?: NapkinSortStrategy;
  styleId?: string;
  contextBefore?: string;
  contextAfter?: string;
}

export interface NapkinResult {
  concept: string;
  format: NapkinFormat;
  dataUrl: string;
  width: number;
  height: number;
  fileId: string;
}


export async function generateNapkinVisualFromContent(
  content: string, label: string, options: NapkinOptions = {},
): Promise<NapkinResult> {
  const base = ((await getApiKey("premiumServer")) || "http://localhost:8000").replace(/\/+$/, "");
  const session = await getSession();
  const headers = { "Content-Type": "application/json", ...(session ? { Authorization: "Bearer " + session.accessToken } : {}) };
  const response = await fetch(base + "/api/visuals/napkin/jobs", {
    method: "POST", headers,
    body: JSON.stringify({ content, label, learner_profile: options.learnerProfile ?? {} }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === "string" ? error.detail : "Diagram generation could not start.");
  }
  const { job_id: jobId } = await response.json() as { job_id: string };
  const deadline = Date.now() + 620000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const statusResponse = await fetch(`${base}/api/visuals/napkin/jobs/${encodeURIComponent(jobId)}`, { headers, signal: AbortSignal.timeout(20000) });
    const status = await statusResponse.json() as { status?: string; result?: NapkinResult; error?: string; detail?: string };
    if (!statusResponse.ok) throw new Error(status.detail || "Could not retrieve diagram status.");
    if (status.status === "failed") throw new Error(status.error || "Diagram generation failed.");
    if (status.status === "completed" && status.result) return status.result;
  }
  throw new Error("Diagram generation took too long. Try again.");
}

export async function generateNapkinVisuals(concepts: string[], options: NapkinOptions = {}): Promise<NapkinResult[]> {
  return Promise.all(concepts.map(concept => generateNapkinVisualFromContent(concept, concept, options)));
}
