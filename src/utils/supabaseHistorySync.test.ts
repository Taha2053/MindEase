import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import browser from "webextension-polyfill";
import { STORAGE_KEYS, type SessionHistoryEntry } from "@/types";
import { DELETED_SESSION_IDS_KEY } from "./userData";
import { restoreCloudData, syncNow } from "./supabase";
import { deleteSessionEntry, saveSessionHistory, updateSessionName } from "@/session/sessionHistory";

describe("atomic session history sync and tombstones", () => {
  let storage: Record<string, unknown>;

  beforeEach(() => {
    storage = {};
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-key");

    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("navigator", { locks: { request: async (_name: string, action: () => unknown) => action() } });

    vi.spyOn(browser.storage.local, "get").mockImplementation(async (keys) => {
      if (keys === null) return structuredClone(storage);
      if (typeof keys === "string") return { [keys]: structuredClone(storage[keys]) };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map(k => [k, structuredClone(storage[k])]));
      }
      return structuredClone(storage);
    });

    vi.spyOn(browser.storage.local, "set").mockImplementation(async (values) => {
      Object.assign(storage, structuredClone(values));
    });

    vi.spyOn(browser.storage.local, "remove").mockImplementation(async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete storage[k];
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("retains local sessions when syncNow encounters an HTTP error (no local loss)", async () => {
    const existingSession: SessionHistoryEntry = {
      sessionId: "session_local_1",
      name: "Local Session",
      endTime: 1000,
      durationMs: 60000,
      conceptCount: 2,
      focusScore: 85,
      resourceCount: 1,
    };

    storage[STORAGE_KEYS.AUTH_SESSION] = {
      accessToken: "token_123",
      refreshToken: "ref_123",
      expiresAt: Date.now() + 3600000,
      user: { id: "user_test_1" },
    };
    storage[STORAGE_KEYS.SYNC_PREFERENCES] = { profile: false, history: true };
    storage[STORAGE_KEYS.SESSION_HISTORY] = [existingSession];
    storage[DELETED_SESSION_IDS_KEY] = [];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    }));

    await expect(syncNow()).rejects.toThrow("Cloud synchronization failed (500)");

    // Verify local session history was not lost or wiped
    expect(storage[STORAGE_KEYS.SESSION_HISTORY]).toEqual([existingSession]);
  });

  it("rejects cloud restore when account changes during restoration", async () => {
    storage[STORAGE_KEYS.AUTH_SESSION] = {
      accessToken: "token_123",
      refreshToken: "ref_123",
      expiresAt: Date.now() + 3600000,
      user: { id: "user_original" },
    };

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/session_history")) {
        // Simulate account switch while fetch is in-flight
        storage[STORAGE_KEYS.AUTH_SESSION] = {
          accessToken: "token_456",
          refreshToken: "ref_456",
          expiresAt: Date.now() + 3600000,
          user: { id: "user_switched" },
        };
        return {
          ok: true,
          status: 200,
          json: async () => [{
            sessions: [{ sessionId: "s_from_original", name: "Original", endTime: 100 }],
            deleted_ids: [],
          }],
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    }));

    await expect(restoreCloudData({ profile: false, history: true })).rejects.toThrow(
      "Account changed during restore. Retry for the current account."
    );

    // Stored history should not be populated with user_original's data
    expect(storage[STORAGE_KEYS.SESSION_HISTORY]).toBeUndefined();
  });

  it("prevents deleted sessions from being resurrected during restoreCloudData", async () => {
    storage[STORAGE_KEYS.AUTH_SESSION] = {
      accessToken: "token_123",
      refreshToken: "ref_123",
      expiresAt: Date.now() + 3600000,
      user: { id: "user_test_1" },
    };
    storage[DELETED_SESSION_IDS_KEY] = ["session_tombstone_1"];
    storage[STORAGE_KEYS.SESSION_HISTORY] = [];

    const cloudSessionDeleted: SessionHistoryEntry = {
      sessionId: "session_tombstone_1",
      name: "Deleted In Past",
      endTime: 1000,
      durationMs: 60000,
      conceptCount: 1,
      focusScore: 90,
      resourceCount: 1,
    };
    const cloudSessionActive: SessionHistoryEntry = {
      sessionId: "session_active_2",
      name: "Active Cloud Session",
      endTime: 2000,
      durationMs: 60000,
      conceptCount: 2,
      focusScore: 80,
      resourceCount: 1,
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{
        sessions: [cloudSessionDeleted, cloudSessionActive],
        deleted_ids: ["cloud_tombstone_3"],
      }],
    }));

    await restoreCloudData({ profile: false, history: true });

    const restoredHistory = storage[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[];
    expect(restoredHistory).toHaveLength(1);
    expect(restoredHistory[0].sessionId).toBe("session_active_2");

    const deletedIds = storage[DELETED_SESSION_IDS_KEY] as string[];
    expect(deletedIds).toContain("session_tombstone_1");
    expect(deletedIds).toContain("cloud_tombstone_3");
  });

  it("records tombstone atomically when deleteSessionEntry is called", async () => {
    const sessionToKeep: SessionHistoryEntry = {
      sessionId: "session_keep",
      name: "Keep",
      endTime: 1000,
      durationMs: 60000,
      conceptCount: 1,
      focusScore: 90,
      resourceCount: 1,
    };
    const sessionToDelete: SessionHistoryEntry = {
      sessionId: "session_del",
      name: "Delete",
      endTime: 2000,
      durationMs: 60000,
      conceptCount: 1,
      focusScore: 90,
      resourceCount: 1,
    };

    storage[STORAGE_KEYS.SESSION_HISTORY] = [sessionToDelete, sessionToKeep];
    storage[DELETED_SESSION_IDS_KEY] = ["session_old_del"];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));

    await deleteSessionEntry("session_del");

    const history = storage[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[];
    expect(history.map(s => s.sessionId)).toEqual(["session_keep"]);

    const deletedIds = storage[DELETED_SESSION_IDS_KEY] as string[];
    expect(deletedIds).toEqual(expect.arrayContaining(["session_old_del", "session_del"]));
  });

  it("retains customName on idempotent saveSessionHistory retry", async () => {
    await saveSessionHistory("session_retry_1", 10000, 30000, [{ label: "Physics", sources: [], occurrences: 1, engagementScore: 0.8 }], 95, []);

    // User renames session
    await updateSessionName("session_retry_1", "My Custom Physics Name");
    let history = storage[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[];
    expect(history[0].customName).toBe("My Custom Physics Name");

    // Retry saving the same session
    await saveSessionHistory("session_retry_1", 10000, 30000, [{ label: "Physics", sources: [], occurrences: 1, engagementScore: 0.8 }], 95, []);

    history = storage[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[];
    expect(history[0].customName).toBe("My Custom Physics Name");
  });

  it("preserves newer local edits arriving during in-flight syncNow request without overwriting", async () => {
    const initialSession: SessionHistoryEntry = {
      sessionId: "session_edited",
      name: "Original Name",
      endTime: 1000,
      durationMs: 60000,
      conceptCount: 1,
      focusScore: 90,
      resourceCount: 1,
    };

    storage[STORAGE_KEYS.AUTH_SESSION] = {
      accessToken: "token_123",
      refreshToken: "ref_123",
      expiresAt: Date.now() + 3600000,
      user: { id: "user_test_1" },
    };
    storage[STORAGE_KEYS.SYNC_PREFERENCES] = { profile: false, history: true };
    storage[STORAGE_KEYS.SESSION_HISTORY] = [initialSession];
    storage[DELETED_SESSION_IDS_KEY] = [];

    // When RPC is in-flight, simulate local edit
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/rpc/sync_session_history")) {
        const currentList = storage[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[];
        currentList[0] = { ...currentList[0], customName: "Renamed Locally While Syncing" };
        return {
          ok: true,
          status: 200,
          json: async () => [{
            sessionId: "session_edited",
            name: "Server Stale Name",
            endTime: 1000,
            durationMs: 60000,
            conceptCount: 1,
            focusScore: 90,
            resourceCount: 1,
          }],
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    }));

    await syncNow();

    const finalHistory = storage[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[];
    expect(finalHistory).toHaveLength(1);
    expect(finalHistory[0].customName).toBe("Renamed Locally While Syncing");
  });

  it("does not resurrect local session deleted during in-flight syncNow request", async () => {
    const sessionToCancel: SessionHistoryEntry = {
      sessionId: "session_canceled",
      name: "To Be Deleted In Flight",
      endTime: 1000,
      durationMs: 60000,
      conceptCount: 1,
      focusScore: 90,
      resourceCount: 1,
    };

    storage[STORAGE_KEYS.AUTH_SESSION] = {
      accessToken: "token_123",
      refreshToken: "ref_123",
      expiresAt: Date.now() + 3600000,
      user: { id: "user_test_1" },
    };
    storage[STORAGE_KEYS.SYNC_PREFERENCES] = { profile: false, history: true };
    storage[STORAGE_KEYS.SESSION_HISTORY] = [sessionToCancel];
    storage[DELETED_SESSION_IDS_KEY] = [];

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/rpc/sync_session_history")) {
        // Locally delete the session while request is in flight
        storage[STORAGE_KEYS.SESSION_HISTORY] = [];
        storage[DELETED_SESSION_IDS_KEY] = ["session_canceled"];
        return {
          ok: true,
          status: 200,
          json: async () => [sessionToCancel],
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    }));

    await syncNow();

    const finalHistory = storage[STORAGE_KEYS.SESSION_HISTORY] as SessionHistoryEntry[];
    expect(finalHistory).toEqual([]);
    expect(storage[DELETED_SESSION_IDS_KEY]).toContain("session_canceled");
  });
});
