import { persistLocalProfile } from "./localDatabase";
import browser from "webextension-polyfill";
import { STORAGE_KEYS, type FullCognitiveProfile, type SessionHistoryEntry } from "@/types";
import type { SessionFeedback } from "@/session/feedback";

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email?: string };
}

export interface SyncPreferences { profile: boolean; history: boolean }

const config = () => {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, "");
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) throw new Error("Supabase is not configured in this build.");
  return { url, key };
};

const authHeaders = (key: string, token?: string) => ({
  apikey: key,
  "Content-Type": "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

function parseSession(value: unknown): AuthSession {
  const data = value as Record<string, unknown>;
  const user = data.user as Record<string, unknown> | undefined;
  if (!data.access_token || !data.refresh_token || !user?.id) throw new Error("Supabase returned an invalid session.");
  return {
    accessToken: String(data.access_token), refreshToken: String(data.refresh_token),
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    user: { id: String(user.id), email: typeof user.email === "string" ? user.email : undefined },
  };
}

async function requestSession(path: string, body: object): Promise<AuthSession> {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/${path}`, { method: "POST", headers: authHeaders(key), body: JSON.stringify(body) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { msg?: string; error_description?: string };
    throw new Error(result.msg || result.error_description || `Authentication failed (${response.status}).`);
  }
  const session = parseSession(await response.json());
  await browser.storage.local.set({ [STORAGE_KEYS.AUTH_SESSION]: session });
  return session;
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const session = await requestSession("token?grant_type=password", { email, password });
  // A newly selected account must not inherit another account's upload consent.
  await browser.storage.local.set({ [STORAGE_KEYS.SYNC_PREFERENCES]: { profile: false, history: false } });
  return session;
}
export async function signUp(email: string, password: string): Promise<AuthSession | null> {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/signup`, { method: "POST", headers: authHeaders(key), body: JSON.stringify({ email, password }) });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(result.msg || "Account creation failed."));
  if (!result.access_token) return null;
  const session = parseSession(result);
  await browser.storage.local.set({ [STORAGE_KEYS.AUTH_SESSION]: session });
  return session;
}

export async function getSession(): Promise<AuthSession | null> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
  const session = stored[STORAGE_KEYS.AUTH_SESSION] as AuthSession | undefined;
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session;
  // Serialize refreshes across extension pages and the service worker.
  return navigator.locks.request("mindease-auth-refresh", async () => {
    const latest = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
    const current = latest[STORAGE_KEYS.AUTH_SESSION] as AuthSession | undefined;
    if (!current) return null;
    if (current.expiresAt > Date.now() + 60_000) return current;
    return requestSession("token?grant_type=refresh_token", { refresh_token: current.refreshToken });
  });
}

export async function signOut(): Promise<void> {
  const session = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
  const token = (session[STORAGE_KEYS.AUTH_SESSION] as AuthSession | undefined)?.accessToken;
  if (token) {
    const { url, key } = config();
    await fetch(`${url}/auth/v1/logout`, { method: "POST", headers: authHeaders(key, token) }).catch(() => {});
  }
  await browser.storage.local.remove(STORAGE_KEYS.AUTH_SESSION);
}

export async function loadSyncPreferences(): Promise<SyncPreferences> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SYNC_PREFERENCES);
  return { profile: false, history: false, ...(result[STORAGE_KEYS.SYNC_PREFERENCES] as Partial<SyncPreferences> | undefined) };
}

export async function restoreCloudData(preferences: SyncPreferences): Promise<void> {
  const session = await getSession();
  if (!session) throw new Error("Sign in before restoring cloud data.");
  const { url, key } = config();
  const restored: Record<string, unknown> = {};
  for (const [enabled, table, column, storageKey] of [
    [preferences.profile, "learning_profiles", "profile", STORAGE_KEYS.PROFILE],
    [preferences.history, "session_history", "sessions", STORAGE_KEYS.SESSION_HISTORY],
  ] as const) {
    if (!enabled) continue;
    const response = await fetch(`${url}/rest/v1/${table}?user_id=eq.${encodeURIComponent(session.user.id)}&select=${column}`, { headers: authHeaders(key, session.accessToken) });
    if (!response.ok) throw new Error(`Cloud retrieval failed (${response.status}). Local data was not changed.`);
    const rows = await response.json() as Record<string, unknown>[];
    if (rows[0]?.[column] !== undefined) restored[storageKey] = rows[0][column];
  }
  if (Object.keys(restored).length) await browser.storage.local.set(restored);
}
export async function saveSyncPreferences(preferences: SyncPreferences): Promise<void> {
  // Restore existing account data before the first upload from a new installation.
  const previous = await loadSyncPreferences();
  await restoreCloudData({ profile: preferences.profile && !previous.profile, history: preferences.history && !previous.history });
  await browser.storage.local.set({ [STORAGE_KEYS.SYNC_PREFERENCES]: preferences });
  await syncNow();
}

async function upsert(table: string, body: object): Promise<void> {
  const session = await getSession();
  if (!session) throw new Error("Sign in before enabling synchronization.");
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${table}?on_conflict=user_id`, {
    method: "POST", headers: { ...authHeaders(key, session.accessToken), Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Cloud synchronization failed (${response.status}).`);
}

export async function syncNow(): Promise<void> {
  await persistLocalProfile();
  const session = await getSession();
  if (!session) return;
  const preferences = await loadSyncPreferences();
  const local = await browser.storage.local.get([STORAGE_KEYS.PROFILE, STORAGE_KEYS.SESSION_HISTORY]);
  if (preferences.profile && local[STORAGE_KEYS.PROFILE]) {
    await upsert("learning_profiles", { user_id: session.user.id, profile: local[STORAGE_KEYS.PROFILE] as FullCognitiveProfile, updated_at: new Date().toISOString() });
  }
  if (preferences.history) {
    await upsert("session_history", { user_id: session.user.id, sessions: (local[STORAGE_KEYS.SESSION_HISTORY] ?? []) as SessionHistoryEntry[], updated_at: new Date().toISOString() });
  }
}

export async function syncFeedback(entry: SessionFeedback): Promise<void> {
  const session = await getSession();
  const preferences = await loadSyncPreferences();
  if (!session || !preferences.history) return;
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/session_feedback?on_conflict=user_id,session_id`, {
    method: "POST",
    headers: { ...authHeaders(key, session.accessToken), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: session.user.id, session_id: entry.sessionId, feedback: entry, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Feedback synchronization failed (${response.status}).`);
}

export async function deleteCloudFeedback(sessionId: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const { url, key } = config();
  await fetch(`${url}/rest/v1/session_feedback?user_id=eq.${encodeURIComponent(session.user.id)}&session_id=eq.${encodeURIComponent(sessionId)}`, {
    method: "DELETE", headers: authHeaders(key, session.accessToken),
  });
}

export async function deleteCloudData(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const { url, key } = config();
  for (const table of ["learning_profiles", "session_history", "session_feedback"]) {
    const response = await fetch(`${url}/rest/v1/${table}?user_id=eq.${encodeURIComponent(session.user.id)}`, {
      method: "DELETE", headers: authHeaders(key, session.accessToken),
    });
    if (!response.ok) throw new Error(`Cloud deletion failed (${response.status}).`);
  }
}
