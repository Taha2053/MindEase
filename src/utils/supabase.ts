import { persistLocalProfile, switchAccountData } from "./localDatabase";
import browser from "webextension-polyfill";
import { STORAGE_KEYS, type FullCognitiveProfile, type SessionHistoryEntry } from "@/types";
import type { SessionFeedback } from "@/session/feedback";
import { syncSessionFolders } from "./sessionStorageManager";
import { DELETED_SESSION_IDS_KEY } from "./userData";
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
  return session;
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  return navigator.locks.request("mindease-auth", async () => {
    const session = await requestSession("token?grant_type=password", { email, password });
    await switchAccountData(session.user.id);
    await browser.storage.local.set({ [STORAGE_KEYS.AUTH_SESSION]: session });
    return session;
  });
}
export async function signUp(email: string, password: string): Promise<AuthSession | null> {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/signup`, { method: "POST", headers: authHeaders(key), body: JSON.stringify({ email, password }) });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(result.msg || "Account creation failed."));
  if (!result.access_token) return null;
  const session = parseSession(result);
  await navigator.locks.request("mindease-auth", async () => {
    await switchAccountData(session.user.id);
    await browser.storage.local.set({ [STORAGE_KEYS.AUTH_SESSION]: session });
  });
  return session;
}

export async function getSession(): Promise<AuthSession | null> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
  const session = stored[STORAGE_KEYS.AUTH_SESSION] as AuthSession | undefined;
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session;
  // Serialize refreshes across extension pages and the service worker.
  return navigator.locks.request("mindease-auth", async () => {
    const latest = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
    const current = latest[STORAGE_KEYS.AUTH_SESSION] as AuthSession | undefined;
    if (!current) return null;
    if (current.expiresAt > Date.now() + 60_000) return current;
    const refreshed = await requestSession("token?grant_type=refresh_token", { refresh_token: current.refreshToken });
    await browser.storage.local.set({ [STORAGE_KEYS.AUTH_SESSION]: refreshed });
    return refreshed;
  });
}

export async function signOut(): Promise<void> {
  await navigator.locks.request("mindease-auth", async () => {
    const stored = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
    const token = (stored[STORAGE_KEYS.AUTH_SESSION] as AuthSession | undefined)?.accessToken;
    await switchAccountData(null);
    await browser.storage.local.remove(STORAGE_KEYS.AUTH_SESSION);
    const destination = await browser.storage.local.get(STORAGE_KEYS.STORAGE_DESTINATION);
    await browser.storage.local.set({
      [STORAGE_KEYS.SYNC_PREFERENCES]: { profile: false, history: false },
      [STORAGE_KEYS.STORAGE_DESTINATION]: { ...(destination[STORAGE_KEYS.STORAGE_DESTINATION] as object ?? {}), destination: "local", updatedAt: Date.now() },
    });
    if (token) {
      const { url, key } = config();
      await fetch(`${url}/auth/v1/logout`, { method: "POST", headers: authHeaders(key, token) }).catch(() => {});
    }
  });
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

  if (preferences.profile) {
    const response = await fetch(`${url}/rest/v1/learning_profiles?user_id=eq.${encodeURIComponent(session.user.id)}&select=profile`, {
      headers: authHeaders(key, session.accessToken),
    });
    if (!response.ok) throw new Error(`Cloud retrieval failed (${response.status}). Local data was not changed.`);
    const rows = await response.json() as Record<string, unknown>[];
    if (rows[0]?.profile !== undefined) {
      restored[STORAGE_KEYS.PROFILE] = rows[0].profile;
    }
  }

  if (preferences.history) {
    const response = await fetch(`${url}/rest/v1/session_history?user_id=eq.${encodeURIComponent(session.user.id)}&select=sessions,deleted_ids`, {
      headers: authHeaders(key, session.accessToken),
    });
    if (!response.ok) throw new Error(`Cloud retrieval failed (${response.status}). Local data was not changed.`);
    const rows = await response.json() as Record<string, unknown>[];
    const row = rows[0];
    if (row && (row.sessions !== undefined || row.deleted_ids !== undefined)) {
      if (row.sessions !== undefined && !Array.isArray(row.sessions)) {
        throw new Error("Invalid cloud session history.");
      }
      const cloudSessions = (Array.isArray(row.sessions) ? row.sessions : []) as SessionHistoryEntry[];
      const cloudDeleted = (Array.isArray(row.deleted_ids) ? row.deleted_ids : []) as string[];

      const local = await browser.storage.local.get([STORAGE_KEYS.SESSION_HISTORY, DELETED_SESSION_IDS_KEY]);
      const localSessions = ((local[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[]) ?? []);
      const localDeleted = ((local[DELETED_SESSION_IDS_KEY] as string[]) ?? []);

      const allDeleted = new Set<string>([...cloudDeleted, ...localDeleted]);
      const merged = new Map<string, SessionHistoryEntry>();
      for (const item of cloudSessions) {
        if (item && typeof item.sessionId === "string" && !allDeleted.has(item.sessionId)) {
          merged.set(item.sessionId, item);
        }
      }
      for (const item of localSessions) {
        if (item && typeof item.sessionId === "string" && !allDeleted.has(item.sessionId)) {
          merged.set(item.sessionId, item);
        }
      }

      restored[STORAGE_KEYS.SESSION_HISTORY] = [...merged.values()]
        .sort((a, b) => b.endTime - a.endTime)
        .slice(0, 100);
      restored[DELETED_SESSION_IDS_KEY] = Array.from(allDeleted);
    }
  }

  await navigator.locks.request("mindease-auth", async () => {
    const authStored = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
    const currentSession = authStored[STORAGE_KEYS.AUTH_SESSION] as AuthSession | undefined;
    if (currentSession?.user?.id !== session.user.id) {
      throw new Error("Account changed during restore. Retry for the current account.");
    }
    if (Object.keys(restored).length) {
      if (restored[STORAGE_KEYS.SESSION_HISTORY] !== undefined) {
        await navigator.locks.request("mindease-session-history", async () => {
          await browser.storage.local.set(restored);
        });
      } else {
        await browser.storage.local.set(restored);
      }
    }
  });
}
export async function saveSyncPreferences(preferences: SyncPreferences): Promise<void> {
  // Restore existing account data before the first upload from a new installation.
  const previous = await loadSyncPreferences();
  await restoreCloudData({ profile: preferences.profile && !previous.profile, history: preferences.history && !previous.history });
  await browser.storage.local.set({ [STORAGE_KEYS.SYNC_PREFERENCES]: preferences });
  await syncNow();
}

async function upsert(table: string, body: { user_id: string } & Record<string, unknown>): Promise<void> {
  const session = await getSession();
  if (!session || session.user.id !== body.user_id) throw new Error("Account changed during synchronization. Retry for the current account.");
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${table}?on_conflict=user_id`, {
    method: "POST", headers: { ...authHeaders(key, session.accessToken), Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Cloud synchronization failed (${response.status}).`);
}

async function syncHistoryRpc(session: AuthSession): Promise<void> {
  const snapshot = await navigator.locks.request("mindease-session-history", async () => {
    const stored = await browser.storage.local.get([STORAGE_KEYS.SESSION_HISTORY, DELETED_SESSION_IDS_KEY]);
    const sessions = (stored[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[] | undefined) ?? [];
    const deletedIds = (stored[DELETED_SESSION_IDS_KEY] as string[] | undefined) ?? [];
    return { sessions, deletedIds };
  });

  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/rpc/sync_session_history`, {
    method: "POST",
    headers: authHeaders(key, session.accessToken),
    body: JSON.stringify({
      p_sessions: snapshot.sessions,
      p_deleted_ids: snapshot.deletedIds,
    }),
  });

  if (!response.ok) {
    throw new Error(`Cloud synchronization failed (${response.status}).`);
  }

  const serverSessions = (await response.json()) as SessionHistoryEntry[];
  if (!Array.isArray(serverSessions)) {
    throw new Error("Invalid response from cloud history synchronization.");
  }

  await navigator.locks.request("mindease-auth", async () => {
    const authStored = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
    const currentSession = authStored[STORAGE_KEYS.AUTH_SESSION] as AuthSession | undefined;
    if (currentSession?.user?.id !== session.user.id) {
      return;
    }

    await navigator.locks.request("mindease-session-history", async () => {
      const currentStored = await browser.storage.local.get([
        STORAGE_KEYS.SESSION_HISTORY,
        DELETED_SESSION_IDS_KEY,
      ]);
      const currentSessions = (currentStored[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[] | undefined) ?? [];
      const currentDeleted = new Set<string>((currentStored[DELETED_SESSION_IDS_KEY] as string[] | undefined) ?? []);

      const snapshotMap = new Map<string, SessionHistoryEntry>(
        snapshot.sessions.map(s => [s.sessionId, s])
      );
      const currentMap = new Map<string, SessionHistoryEntry>(
        currentSessions.map(s => [s.sessionId, s])
      );

      const resultMap = new Map<string, SessionHistoryEntry>();

      for (const remote of serverSessions) {
        if (!remote || typeof remote.sessionId !== "string") continue;
        if (currentDeleted.has(remote.sessionId)) continue;

        const currentLocal = currentMap.get(remote.sessionId);
        const snapshotLocal = snapshotMap.get(remote.sessionId);

        if (currentLocal) {
          const isLocallyEdited = !snapshotLocal || JSON.stringify(currentLocal) !== JSON.stringify(snapshotLocal);
          if (isLocallyEdited) {
            resultMap.set(currentLocal.sessionId, currentLocal);
          } else {
            resultMap.set(remote.sessionId, remote);
          }
        } else {
          if (snapshotLocal) {
            // Deleted locally during in-flight request
          } else {
            resultMap.set(remote.sessionId, remote);
          }
        }
      }

      for (const currentLocal of currentMap.values()) {
        if (!resultMap.has(currentLocal.sessionId) && !currentDeleted.has(currentLocal.sessionId)) {
          resultMap.set(currentLocal.sessionId, currentLocal);
        }
      }

      const nextHistory = Array.from(resultMap.values())
        .sort((a, b) => b.endTime - a.endTime)
        .slice(0, 100);

      await browser.storage.local.set({
        [STORAGE_KEYS.SESSION_HISTORY]: nextHistory,
      });
    });
  });
}

export async function syncNow(): Promise<void> {
  await persistLocalProfile();
  const session = await getSession();
  if (!session) return;
  const preferences = await loadSyncPreferences();
  if (preferences.profile) {
    const local = await browser.storage.local.get(STORAGE_KEYS.PROFILE);
    if (local[STORAGE_KEYS.PROFILE]) {
      await upsert("learning_profiles", { user_id: session.user.id, profile: local[STORAGE_KEYS.PROFILE] as FullCognitiveProfile, updated_at: new Date().toISOString() });
    }
  }
  if (preferences.history) {
    await syncHistoryRpc(session);
  }
  await syncSessionFolders();
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
  const response = await fetch(`${url}/rest/v1/session_feedback?user_id=eq.${encodeURIComponent(session.user.id)}&session_id=eq.${encodeURIComponent(sessionId)}`, {
    method: "DELETE", headers: authHeaders(key, session.accessToken),
  });
  if (!response.ok) throw new Error(`Cloud feedback deletion failed (${response.status}).`);
}

export async function deleteCloudData(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const { url, key } = config();
  for (const table of ["learning_profiles", "session_history", "session_feedback", "session_folders", "media_assets"]) {
    const response = await fetch(`${url}/rest/v1/${table}?user_id=eq.${encodeURIComponent(session.user.id)}`, {
      method: "DELETE", headers: authHeaders(key, session.accessToken),
    });
    if (!response.ok) throw new Error(`Cloud deletion failed (${response.status}).`);
  }
}
