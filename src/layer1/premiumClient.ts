/* ============================================================
   layer1/premiumClient.ts - MindEase Premium Video Animation Client
   Connects the MindEase browser extension to the MindEase Premium
   Service (FastAPI + Python 3.13 Manim pipeline).
   Enables automated 3Blue1Brown-style video explanation generation
   for Wikipedia, PDFs, research papers, and web articles.
   ============================================================ */

import { getApiKey } from "@/utils/apiKeyManager";
import type {
  ProcessDocumentPayload,
  PremiumJobResponse,
  PremiumJobStatus,
} from "@/types";

async function getServerBaseUrl(): Promise<string> {
  const url = await getApiKey("premiumServer");
  return (url || "http://localhost:8000").replace(/\/+$/, "");
}

/**
 * Submit an arbitrary document, Wikipedia page, PDF, or MindEase DOM sections
 * for multi-agent Manim video generation.
 */
export async function submitDocumentForAnimation(
  payload: ProcessDocumentPayload,
): Promise<PremiumJobResponse> {
  const baseUrl = await getServerBaseUrl();
  const res = await fetch(`${baseUrl}/api/process/document`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    throw new Error(`[PremiumClient] Process request failed (${res.status}): ${errorText}`);
  }

  return (await res.json()) as PremiumJobResponse;
}

/**
 * Submit an arXiv paper by ID.
 */
export async function submitArxivPaperForAnimation(
  arxivId: string,
): Promise<PremiumJobResponse> {
  const baseUrl = await getServerBaseUrl();
  const res = await fetch(`${baseUrl}/api/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ arxiv_id: arxivId }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    throw new Error(`[PremiumClient] arXiv process request failed (${res.status}): ${errorText}`);
  }

  return (await res.json()) as PremiumJobResponse;
}

/**
 * Poll job status until complete or failed.
 */
export async function pollJobStatus(jobId: string): Promise<PremiumJobStatus> {
  const baseUrl = await getServerBaseUrl();
  const res = await fetch(`${baseUrl}/api/status/${encodeURIComponent(jobId)}`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`[PremiumClient] Status check failed (${res.status})`);
  }

  return (await res.json()) as PremiumJobStatus;
}

/**
 * Retrieve completed document/paper visualizations and video URLs.
 */
export async function fetchDocumentVideos(
  docId: string,
): Promise<{
  title: string;
  videos: Array<{
    id: string;
    concept: string;
    video_url: string;
    section_id?: string;
  }>;
} | null> {
  const baseUrl = await getServerBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/api/paper/${encodeURIComponent(docId)}`, {
      headers: { Accept: "application/json" },
    });

    if (res.status === 404) return null;
    if (!res.ok) return null;

    const data = (await res.json()) as {
      title: string;
      visualizations?: Array<{
        id: string;
        concept: string;
        video_url?: string;
        section_id?: string;
        status?: string;
      }>;
    };

    const validVideos = (data.visualizations || [])
      .filter((v) => v.video_url && v.status === "complete")
      .map((v) => ({
        id: v.id,
        concept: v.concept,
        video_url: v.video_url!.startsWith("http") ? v.video_url! : `${baseUrl}${v.video_url}`,
        section_id: v.section_id,
      }));

    return {
      title: data.title,
      videos: validVideos,
    };
  } catch (err) {
    console.warn("[PremiumClient] Failed to fetch document videos:", err);
    return null;
  }
}
