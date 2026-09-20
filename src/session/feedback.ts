import browser from "webextension-polyfill";
import { deleteCloudFeedback, syncFeedback } from "@/utils/supabase";

export interface SessionFeedback {
  sessionId: string;
  helpfulness: "yes" | "partly" | "no";
  confidence: "low" | "medium" | "high";
  preferredFormat: "text" | "visual" | "audio" | "unchanged";
  comment: string;
  updatedAt: number;
}

const keyFor = (sessionId: string) => `mindease_feedback_${sessionId}`;

export function isSessionFeedback(value: unknown): value is SessionFeedback {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.sessionId === "string" && entry.sessionId.length > 0 && entry.sessionId.length <= 200
    && ["yes", "partly", "no"].includes(entry.helpfulness as string)
    && ["low", "medium", "high"].includes(entry.confidence as string)
    && ["text", "visual", "audio", "unchanged"].includes(entry.preferredFormat as string)
    && typeof entry.comment === "string" && entry.comment.length <= 2000
    && typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt);
}

export async function loadFeedback(sessionId: string): Promise<SessionFeedback | null> {
  const result = await browser.storage.local.get(keyFor(sessionId));
  const entry = result[keyFor(sessionId)];
  return isSessionFeedback(entry) && entry.sessionId === sessionId ? entry : null;
}

export async function saveFeedback(entry: SessionFeedback): Promise<void> {
  if (!isSessionFeedback(entry)) throw new Error("Invalid session feedback.");
  await browser.storage.local.set({ [keyFor(entry.sessionId)]: entry });
  await syncFeedback(entry).catch(() => {});
}

export async function deleteFeedback(sessionId: string): Promise<void> {
  await browser.storage.local.remove(keyFor(sessionId));
  await deleteCloudFeedback(sessionId).catch(() => {});
}
