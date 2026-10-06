/* ============================================================
   layer1/premiumClient.ts - MindEase Premium Video Animation Client
   Connects the MindEase browser extension to the MindEase Premium
   Service (FastAPI + Python 3.13 Manim pipeline).
   Enables automated 3Blue1Brown-style video explanation generation
   for Wikipedia, PDFs, research papers, and web articles.
   ============================================================ */

import browser from "webextension-polyfill";
import { getApiKey } from "@/utils/apiKeyManager";
import { getSession } from "@/utils/supabase";
import {
  STORAGE_KEYS,
  type ProcessDocumentPayload,
  type PremiumJobResponse,
  type PremiumJobStatus,
  type SessionFolderSummary,
} from "@/types";
import { recordSessionFolder } from "@/utils/sessionStorageManager";

async function getServerBaseUrl(): Promise<string> {
  const url = await getApiKey("premiumServer");
  return (url || "http://localhost:8000").replace(/\/+$/, "");
}

async function premiumHeaders(accept: string): Promise<Record<string, string>> {
  const session = await getSession();
  return {
    "Content-Type": "application/json",
    Accept: accept,
    ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
  };
}
/** Search the wider web through the backend; Tavily credentials never enter the extension bundle. */
export async function searchRelatedResources(input: {
  topics: string[];
  preference: "visual" | "text";
  sourceUrl: string;
}): Promise<Array<{ title: string; url: string; description: string; reason: string }>> {
  const baseUrl = await getServerBaseUrl();
  const response = await fetch(`${baseUrl}/api/resources/related`, {
    method: "POST",
    headers: await premiumHeaders("application/json"),
    body: JSON.stringify({
      topics: input.topics,
      preference: input.preference,
      source_url: input.sourceUrl,
    }),
  });
  if (!response.ok) throw new Error(`Web search is unavailable (${response.status})`);
  const data = await response.json() as { resources?: Array<{ title: string; url: string; description: string; reason: string }> };
  return data.resources ?? [];
}


export async function createAdaptationPlan(input: {
  title: string;
  sourceType: "website" | "pdf" | "video" | "lecture";
  sourceBlocks: Array<{ id: string; text: string; position: number }>;
  learnerProfile: object;
}): Promise<Record<string, unknown>> {
  const baseUrl = await getServerBaseUrl();
  const response = await fetch(`${baseUrl}/api/plan/adaptation`, {
    method: "POST",
    headers: await premiumHeaders("application/json"),
    body: JSON.stringify({
      title: input.title,
      source_type: input.sourceType,
      source_blocks: input.sourceBlocks,
      learner_profile: input.learnerProfile,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof error?.detail === "string"
      ? error.detail
      : `DeepSeek planning is unavailable (${response.status}). Please try again.`);
  }
  const result = await response.json() as { plan?: Record<string, unknown> };
  if (!result.plan) throw new Error("DeepSeek returned no adaptation plan.");
  return result.plan;
}

/** Direct fetch to the premium speech endpoint (call from background or extension pages where Origin is allowed). */
export async function synthesizePremiumSpeechDirect(text: string, language?: string): Promise<Blob> {
  const baseUrl = await getServerBaseUrl();
  const res = await fetch(`${baseUrl}/api/speech`, {
    method: "POST",
    headers: await premiumHeaders("audio/mpeg"),
    body: JSON.stringify({ text, language }),
  });
  if (!res.ok) {
    throw new Error(`Premium speech is unavailable (${res.status})`);
  }
  return res.blob();
}

/** Request premium narration without exposing Azure credentials to the extension.
 *  Content scripts run with the page's Origin (e.g. wikipedia.org) which the
 *  backend CORS policy rejects → 400 Disallowed CORS origin on OPTIONS.
 *  To avoid that, page-context callers proxy through the background service
 *  worker whose Origin is chrome-extension://… (matched by EXTENSION_ORIGIN_REGEX).
 */
export async function synthesizePremiumSpeech(text: string, language?: string): Promise<Blob> {
  const isPageContext =
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    (globalThis.location?.protocol === "http:" || globalThis.location?.protocol === "https:");

  if (isPageContext) {
    try {
      const runtime = (browser as unknown as { runtime?: { id?: string; sendMessage?: (msg: unknown) => Promise<unknown> } })?.runtime;
      if (!runtime?.id || !runtime?.sendMessage) {
        throw new Error("Premium speech is unavailable (extension runtime not ready)");
      }
      const raw = await browser.runtime.sendMessage({
        type: "PREMIUM_SPEECH",
        payload: { text, language },
      } as unknown as never);
      const response = raw as { audioBase64?: string; contentType?: string; error?: string } | null | undefined;
      if (response?.error) throw new Error(response.error);
      if (response?.audioBase64) {
        const binary = atob(response.audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: response.contentType || "audio/mpeg" });
      }
      throw new Error("Premium speech is unavailable (empty proxy response)");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("Premium speech") || msg.includes("unavailable") || msg.includes("Speech") || msg.includes("proxy")) {
        throw err;
      }
      throw new Error(`Premium speech is unavailable (proxy failed: ${msg})`);
    }
  }
  return synthesizePremiumSpeechDirect(text, language);
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
    headers: await premiumHeaders("application/json"),
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
    headers: await premiumHeaders("application/json"),
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
    headers: await premiumHeaders("application/json"),
  });

  if (!res.ok) {
    throw new Error(`[PremiumClient] Status check failed (${res.status})`);
  }

  return (await res.json()) as PremiumJobStatus;
}

/**
 * Retrieve completed document/paper visualizations and video URLs.
 */
export interface SavedVideoEntry {
  id: string;
  concept: string;
  video_url: string;
  title: string;
  savedAt: number;
  sessionId?: string | null;
  section_id?: string;
  ownerAccountId?: string | null;
}

export interface FetchDocumentVideosOptions {
  sessionId?: string | null;
  ownerAccountId?: string | null;
}

/** Ground required output video URL safety on valid HTTP/HTTPS/blob schemes. */
export function isValidVideoUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "blob:";
  } catch {
    return false;
  }
}

export async function fetchDocumentVideos(
  docId: string,
  options?: FetchDocumentVideosOptions,
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

  // Capture auth owner at request start if not already captured before submission
  const reqAuth = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
  const capturedOwnerId = options?.ownerAccountId !== undefined
    ? options.ownerAccountId
    : (reqAuth[STORAGE_KEYS.AUTH_SESSION] as { user?: { id?: string } } | undefined)?.user?.id ?? null;

  // Determine target workspace sessionId
  let targetSessionId = options?.sessionId;
  if (targetSessionId === undefined) {
    const ws = await browser.storage.local.get(STORAGE_KEYS.WORKSPACE);
    targetSessionId = (ws[STORAGE_KEYS.WORKSPACE] as { sessionId?: string } | undefined)?.sessionId ?? null;
  }

  try {
    const res = await fetch(`${baseUrl}/api/paper/${encodeURIComponent(docId)}`, {
      headers: await premiumHeaders("application/json"),
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
      .map((v) => {
        const rawUrl = v.video_url!;
        const resolved = rawUrl.startsWith("http://") || rawUrl.startsWith("https://") || rawUrl.startsWith("blob:")
          ? rawUrl
          : `${baseUrl}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
        return {
          id: v.id,
          concept: v.concept,
          video_url: resolved,
          section_id: v.section_id,
        };
      })
      .filter((v) => isValidVideoUrl(v.video_url));

    if (validVideos.length) {
      const persistLocked = async () => {
        // Prevent async cancelled prior-account fetch writing into different account:
        // compare raw AUTH_SESSION before storage writes
        const currentAuth = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
        const currentOwnerId = (currentAuth[STORAGE_KEYS.AUTH_SESSION] as { user?: { id?: string } } | undefined)?.user?.id ?? null;
        if (currentOwnerId !== capturedOwnerId) {
          return;
        }

        const saved = await browser.storage.local.get("mindease_saved_videos");
        const rawList = (saved.mindease_saved_videos ?? []) as Array<SavedVideoEntry>;
        const entries = new Map<string, SavedVideoEntry>(rawList.map(video => [video.id, video]));

        for (const video of validVideos) {
          const existing = entries.get(video.id);
          const stableSavedAt = (existing && typeof existing.savedAt === "number")
            ? existing.savedAt
            : Date.now();
          const assignedSessionId = existing?.sessionId ?? targetSessionId ?? undefined;

          entries.set(video.id, {
            ...existing,
            ...video,
            title: data.title || existing?.title || "Video explanation",
            savedAt: stableSavedAt,
            ...(assignedSessionId ? { sessionId: assignedSessionId } : {}),
            ...(capturedOwnerId !== null ? { ownerAccountId: capturedOwnerId } : {}),
          });
        }
        await browser.storage.local.set({ mindease_saved_videos: [...entries.values()] });

        // Append late videos to matching SESSION_FOLDERS (sessionId/owner id) via recordSessionFolder
        if (targetSessionId) {
          try {
            const storedFolders = await browser.storage.local.get(STORAGE_KEYS.SESSION_FOLDERS);
            const folders = (storedFolders[STORAGE_KEYS.SESSION_FOLDERS] as SessionFolderSummary[] | undefined);
            const folder = folders?.find(item => item.sessionId === targetSessionId && (item.ownerAccountId ?? null) === capturedOwnerId);
            if (folder) {
              const mergedVideos = new Map((folder.videos || []).map(item => [item.id, item]));
              validVideos.forEach((v, idx) => {
                mergedVideos.set(v.id, {
                  id: v.id,
                  concept: v.concept || `Scene ${idx + 1}`,
                  filename: `videos/${v.id}.mp4`,
                  videoUrl: v.video_url,
                });
              });
              await recordSessionFolder({
                ...folder,
                videos: [...mergedVideos.values()],
                savedAt: Date.now(),
              });
            }
          } catch (folderErr) {
            console.warn("[PremiumClient] Failed to append late videos to session folder:", folderErr);
          }
        }
      };

      if (typeof navigator !== "undefined" && navigator.locks?.request) {
        await navigator.locks.request("mindease-media-library", persistLocked);
      } else {
        await persistLocked();
      }
    }
    return {
      title: data.title,
      videos: validVideos,
    };
  } catch (err) {
    console.warn("[PremiumClient] Failed to fetch document videos:", err);
    return null;
  }
}

export async function extractRemoteSource(url: string, sourceType: string): Promise<string> {
  const response = await fetch(`${await getServerBaseUrl()}/api/source/extract`, {
    method: "POST", headers: await premiumHeaders("application/json"),
    body: JSON.stringify({ url, source_type: sourceType }),
  });
  if (!response.ok) throw new Error("The document could not be retrieved. Check its URL and the MindEase server.");
  const result = await response.json() as { text: string };
  return result.text;
}
