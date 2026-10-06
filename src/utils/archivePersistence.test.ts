import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import browser from "webextension-polyfill";
import { STORAGE_KEYS, type SessionFolderSummary } from "@/types";
import {
  storedAuth,
  getSessionFolders,
  recordSessionFolder,
  syncSessionFolders,
  deleteSessionFolder,
  saveStorageConfig,
} from "./sessionStorageManager";
import { getSession, type AuthSession } from "@/utils/supabase";
import { persistLocalProfile } from "@/utils/localDatabase";

vi.mock("@/utils/supabase", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/utils/localDatabase", () => ({
  persistLocalProfile: vi.fn().mockResolvedValue(undefined),
}));

type LockManagerMock = {
  request: (name: string, callback: () => Promise<unknown>) => Promise<unknown>;
};

function createSampleFolder(overrides: Partial<SessionFolderSummary> = {}): SessionFolderSummary {
  return {
    sessionId: "session-1",
    sessionNumber: 1,
    dateStr: "2026-10-05",
    folderName: "2026-10-05_Session-01",
    title: "Thermodynamics",
    durationMs: 120000,
    conceptCount: 3,
    focusScore: 92,
    destination: "local",
    savedAt: 1000,
    videos: [],
    visuals: [],
    history: {
      topic: "Physics",
      concepts: ["Entropy", "Enthalpy"],
      timeSpentMinutes: 2,
      notesCount: 1,
      summaryText: "Summary of session",
    },
    ...overrides,
  };
}

describe("archive persistence & synchronization", () => {
  let storage: Record<string, unknown>;

  function getStoredFolders(): SessionFolderSummary[] {
    const raw = storage[STORAGE_KEYS.SESSION_FOLDERS];
    return Array.isArray(raw) ? (raw as SessionFolderSummary[]) : [];
  }

  beforeEach(() => {
    storage = {};

    vi.spyOn(browser.storage.local, "get").mockImplementation(async (keys) => {
      if (typeof keys === "string") return { [keys]: structuredClone(storage[keys]) };
      const names = Array.isArray(keys) ? keys : Object.keys(storage);
      return Object.fromEntries(names.map((key) => [key, structuredClone(storage[key])]));
    });

    vi.spyOn(browser.storage.local, "set").mockImplementation(async (values) => {
      Object.assign(storage, structuredClone(values));
    });

    vi.spyOn(browser.storage.local, "remove").mockImplementation(async (keys) => {
      const names = typeof keys === "string" ? [keys] : keys;
      for (const key of names) delete storage[key];
    });

    const mockLocks: LockManagerMock = {
      request: vi.fn(async (_name: string, callback: () => Promise<unknown>) => callback()),
    };
    Object.defineProperty(globalThis, "navigator", {
      value: { locks: mockLocks },
      configurable: true,
      writable: true,
    });

    import.meta.env.VITE_SUPABASE_URL = "https://example.supabase.co";
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("identifies storedAuth without refresh when session token is expired", async () => {
    const expiredAuth: AuthSession = {
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 100_000, // expired in the past
      user: { id: "user-offline", email: "learner@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = expiredAuth;

    const auth = await storedAuth();
    expect(auth).not.toBeNull();
    expect(auth?.user.id).toBe("user-offline");
  });

  it("assigns newly recorded archive to offline expired account, not to guest", async () => {
    const expiredAuth: AuthSession = {
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 100_000,
      user: { id: "user-offline", email: "learner@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = expiredAuth;
    vi.mocked(getSession).mockRejectedValue(new Error("Network offline: failed to refresh token"));

    const folder = createSampleFolder({ sessionId: "offline-s1", destination: "local" });
    await recordSessionFolder(folder);

    const savedList = getStoredFolders();
    expect(savedList).toHaveLength(1);
    expect(savedList[0].ownerAccountId).toBe("user-offline");
    expect(savedList[0].syncState).toBe("local");
    expect(vi.mocked(persistLocalProfile)).toHaveBeenCalled();
  });

  it("returns offline account archives when offline and token is expired without hiding them", async () => {
    const expiredAuth: AuthSession = {
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 100_000,
      user: { id: "user-offline", email: "learner@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = expiredAuth;
    storage[STORAGE_KEYS.SESSION_FOLDERS] = [
      createSampleFolder({ sessionId: "s1", ownerAccountId: "user-offline", title: "Offline User Lesson" }),
      createSampleFolder({ sessionId: "s2", ownerAccountId: "other-user", title: "Other User Lesson" }),
      createSampleFolder({ sessionId: "s3", ownerAccountId: null, title: "Guest Lesson" }),
    ];

    vi.mocked(getSession).mockRejectedValue(new Error("Network offline: getSession failed"));

    const folders = await getSessionFolders();
    expect(folders).toHaveLength(2);
    expect(folders.map((f) => f.sessionId)).toEqual(["s1", "s3"]);
    expect(folders.some((f) => f.sessionId === "s2")).toBe(false);
  });

  it("retains local archives when cloud archive fetch fails", async () => {
    const activeAuth: AuthSession = {
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 300_000,
      user: { id: "user-active", email: "learner@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = activeAuth;
    storage[STORAGE_KEYS.SESSION_FOLDERS] = [
      createSampleFolder({ sessionId: "local-1", ownerAccountId: "user-active", title: "Local Lesson" }),
    ];

    vi.mocked(getSession).mockResolvedValue(activeAuth);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Cloud fetch failed (500 Internal Error)")));

    const folders = await getSessionFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0].sessionId).toBe("local-1");
    // Local storage is not emptied or corrupted
    expect(getStoredFolders()).toHaveLength(1);
  });

  it("caches downloaded cloud folders without overwriting newer or pending local folders", async () => {
    const activeAuth: AuthSession = {
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 300_000,
      user: { id: "user-1", email: "learner@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = activeAuth;

    // Existing local storage has:
    // 1. A pending folder with savedAt 1500
    // 2. A newer local folder with savedAt 2500
    // 3. Another account's folder
    storage[STORAGE_KEYS.SESSION_FOLDERS] = [
      createSampleFolder({
        sessionId: "pending-folder",
        ownerAccountId: "user-1",
        savedAt: 1500,
        syncState: "pending",
        title: "Local Pending Version",
      }),
      createSampleFolder({
        sessionId: "newer-local",
        ownerAccountId: "user-1",
        savedAt: 2500,
        syncState: "synced",
        title: "Newer Local Version",
      }),
      createSampleFolder({
        sessionId: "other-user-folder",
        ownerAccountId: "user-2",
        savedAt: 500,
        title: "Other User Data",
      }),
    ];

    vi.mocked(getSession).mockResolvedValue(activeAuth);

    // Remote returns an older version of pending-folder, an older version of newer-local, and a brand new cloud folder
    const remoteCloudFolder = createSampleFolder({
      sessionId: "remote-only",
      ownerAccountId: "user-1",
      savedAt: 1800,
      title: "Remote Only Lesson",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            summary: createSampleFolder({
              sessionId: "pending-folder",
              savedAt: 2000,
              title: "Remote Older/Conflicting Pending",
            }),
          },
          {
            summary: createSampleFolder({
              sessionId: "newer-local",
              savedAt: 2000,
              title: "Remote Stale Version",
            }),
          },
          {
            summary: remoteCloudFolder,
          },
        ],
      })
    );

    const result = await getSessionFolders();

    // Check in-memory result
    const pendingResult = result.find((f) => f.sessionId === "pending-folder");
    expect(pendingResult?.title).toBe("Local Pending Version"); // Preserved local pending

    const newerResult = result.find((f) => f.sessionId === "newer-local");
    expect(newerResult?.title).toBe("Newer Local Version"); // Preserved newer local

    const remoteResult = result.find((f) => f.sessionId === "remote-only");
    expect(remoteResult?.title).toBe("Remote Only Lesson"); // Added downloaded

    // Check cached storage: other-user-folder was preserved untouched
    const cached = getStoredFolders();
    expect(cached.some((f) => f.sessionId === "other-user-folder")).toBe(true);
    expect(cached.find((f) => f.sessionId === "pending-folder")?.title).toBe("Local Pending Version");
    expect(cached.find((f) => f.sessionId === "newer-local")?.title).toBe("Newer Local Version");
    expect(cached.find((f) => f.sessionId === "remote-only")?.title).toBe("Remote Only Lesson");
  });

  it("avoids redundant storage set calls when reading unchanged archives", async () => {
    const activeAuth: AuthSession = {
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 300_000,
      user: { id: "user-1", email: "learner@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = activeAuth;

    const existingFolder = createSampleFolder({
      sessionId: "cached-folder",
      ownerAccountId: "user-1",
      savedAt: 1000,
      syncState: "synced",
    });
    storage[STORAGE_KEYS.SESSION_FOLDERS] = [existingFolder];

    vi.mocked(getSession).mockResolvedValue(activeAuth);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ summary: existingFolder }],
      })
    );

    const setSpy = vi.spyOn(browser.storage.local, "set");
    setSpy.mockClear();

    await getSessionFolders();

    // Because remote data had same savedAt and was already cached, no browser.storage.local.set should occur
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("returns empty array if raw stored account changes while getSessionFolders is in flight", async () => {
    const activeAuth: AuthSession = {
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 300_000,
      user: { id: "user-1", email: "u1@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = activeAuth;
    storage[STORAGE_KEYS.SESSION_FOLDERS] = [
      createSampleFolder({ sessionId: "u1-folder", ownerAccountId: "user-1" }),
    ];

    vi.mocked(getSession).mockImplementation(async () => {
      // Simulate account logout / switch happening concurrently during fetch
      delete storage[STORAGE_KEYS.AUTH_SESSION];
      return null;
    });

    const result = await getSessionFolders();
    expect(result).toEqual([]);
  });

  it("preserves local folder durability and marks error with retry description on sync auth failure", async () => {
    const activeAuth: AuthSession = {
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 300_000,
      user: { id: "user-sync", email: "learner@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = activeAuth;

    // getSession fails when trying to sync
    vi.mocked(getSession).mockRejectedValue(new Error("Supabase auth refresh offline timeout"));

    const folder = createSampleFolder({
      sessionId: "supabase-folder-1",
      destination: "supabase",
      ownerAccountId: "user-sync",
    });

    // recordSessionFolder must NOT throw even though sync auth fails
    await expect(recordSessionFolder(folder)).resolves.toBeUndefined();

    const saved = getStoredFolders()[0];
    expect(saved.sessionId).toBe("supabase-folder-1");
    expect(saved.ownerAccountId).toBe("user-sync");
    expect(saved.syncState).toBe("error");
    expect(saved.syncError).toContain("retry sync");
  });

  it("does not upload other accounts or local guest data during syncSessionFolders", async () => {
    const activeAuth: AuthSession = {
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 300_000,
      user: { id: "user-1", email: "learner@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = activeAuth;
    vi.mocked(getSession).mockResolvedValue(activeAuth);

    storage[STORAGE_KEYS.SESSION_FOLDERS] = [
      createSampleFolder({ sessionId: "user-1-folder", destination: "supabase", ownerAccountId: "user-1", syncState: "pending" }),
      createSampleFolder({ sessionId: "user-2-folder", destination: "supabase", ownerAccountId: "user-2", syncState: "pending" }),
      createSampleFolder({ sessionId: "guest-folder", destination: "supabase", ownerAccountId: null, syncState: "pending" }),
    ];

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await syncSessionFolders();

    // fetch was called exactly once, ONLY for user-1's folder
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.user_id).toBe("user-1");
    expect(body.session_id).toBe("user-1-folder");

    // Check that user-2 and guest folders were not changed to synced
    const list = getStoredFolders();
    expect(list.find((f) => f.sessionId === "user-1-folder")?.syncState).toBe("synced");
    expect(list.find((f) => f.sessionId === "user-2-folder")?.syncState).toBe("pending");
    expect(list.find((f) => f.sessionId === "guest-folder")?.syncState).toBe("pending");
  });

  it("enforces cross-account visibility boundaries in getSessionFolders", async () => {
    storage[STORAGE_KEYS.SESSION_FOLDERS] = [
      createSampleFolder({ sessionId: "f-user1", ownerAccountId: "user-1", title: "User 1 Item" }),
      createSampleFolder({ sessionId: "f-user2", ownerAccountId: "user-2", title: "User 2 Item" }),
      createSampleFolder({ sessionId: "f-guest", ownerAccountId: null, title: "Guest Item" }),
    ];

    // As user-1:
    const user1Session: AuthSession = {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 10000,
      user: { id: "user-1", email: "u1@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = user1Session;
    vi.mocked(getSession).mockResolvedValue(user1Session);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));

    const u1Visible = await getSessionFolders();
    expect(u1Visible.map((f) => f.sessionId)).toEqual(["f-user1", "f-guest"]);

    // As user-2:
    const user2Session: AuthSession = {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 10000,
      user: { id: "user-2", email: "u2@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = user2Session;
    vi.mocked(getSession).mockResolvedValue(user2Session);

    const u2Visible = await getSessionFolders();
    expect(u2Visible.map((f) => f.sessionId)).toEqual(["f-user2", "f-guest"]);

    // As guest (no auth session):
    delete storage[STORAGE_KEYS.AUTH_SESSION];
    vi.mocked(getSession).mockResolvedValue(null);

    const guestVisible = await getSessionFolders();
    expect(guestVisible.map((f) => f.sessionId)).toEqual(["f-guest"]);
  });

  it("deletes local-only folder without making any remote fetch call", async () => {
    const userAuth: AuthSession = {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 10000,
      user: { id: "user-1", email: "u1@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = userAuth;
    storage[STORAGE_KEYS.SESSION_FOLDERS] = [
      createSampleFolder({ sessionId: "local-folder", destination: "local", ownerAccountId: "user-1" }),
    ];

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await deleteSessionFolder("local-folder");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getStoredFolders()).toEqual([]);
  });

  it("preserves local archive when required remote delete fails", async () => {
    const auth: AuthSession = {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 10000,
      user: { id: "user-1", email: "u1@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = auth;
    vi.mocked(getSession).mockResolvedValue(auth);

    storage[STORAGE_KEYS.SESSION_FOLDERS] = [
      createSampleFolder({ sessionId: "remote-folder", destination: "supabase", ownerAccountId: "user-1" }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      })
    );

    // Should throw and NOT remove local folder
    await expect(deleteSessionFolder("remote-folder")).rejects.toThrow("Cloud archive deletion failed (500)");

    const remaining = getStoredFolders();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sessionId).toBe("remote-folder");
  });

  it("does not delete another account's folder with the same sessionId", async () => {
    const auth: AuthSession = {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 10000,
      user: { id: "user-1", email: "u1@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = auth;
    storage[STORAGE_KEYS.SESSION_FOLDERS] = [
      createSampleFolder({ sessionId: "shared-id", destination: "local", ownerAccountId: "user-2" }),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await deleteSessionFolder("shared-id");

    const remaining = getStoredFolders();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].ownerAccountId).toBe("user-2");
  });

  it("merges unique visuals and videos by id when recording late completions", async () => {
    const auth: AuthSession = {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 10000,
      user: { id: "user-1", email: "u1@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = auth;

    const initial = createSampleFolder({
      sessionId: "session-media",
      ownerAccountId: "user-1",
      savedAt: 1000,
      visuals: [
        { id: "vis-1", concept: "Kinematics", filename: "vis1.png", dataUrl: "data:image/png;1" },
      ],
      videos: [
        { id: "vid-1", concept: "Kinematics", filename: "vid1.mp4", videoUrl: "blob:vid1" },
      ],
    });
    await recordSessionFolder(initial);

    // Late completion brings new visual and updated duration, but video array might be empty or incoming
    const lateVisual = createSampleFolder({
      sessionId: "session-media",
      ownerAccountId: "user-1",
      savedAt: 2000,
      durationMs: 150000,
      visuals: [
        { id: "vis-2", concept: "Dynamics", filename: "vis2.png", dataUrl: "data:image/png;2" },
      ],
      videos: [], // simulate diagram generation that doesn't touch videos
    });
    await recordSessionFolder(lateVisual);

    // Late video completion
    const lateVideo = createSampleFolder({
      sessionId: "session-media",
      ownerAccountId: "user-1",
      savedAt: 3000,
      visuals: [], // simulate video completion that doesn't touch visuals
      videos: [
        { id: "vid-2", concept: "Dynamics", filename: "vid2.mp4", videoUrl: "blob:vid2" },
      ],
    });
    await recordSessionFolder(lateVideo);

    const finalFolder = getStoredFolders()[0];
    expect(finalFolder.visuals.map((v) => v.id).sort()).toEqual(["vis-1", "vis-2"]);
    expect(finalFolder.videos.map((v) => v.id).sort()).toEqual(["vid-1", "vid-2"]);
    expect(finalFolder.savedAt).toBe(3000);
  });

  it("saveStorageConfig preserves supabase choice when offline with stored auth", async () => {
    const offlineAuth: AuthSession = {
      accessToken: "expired-tok",
      refreshToken: "ref",
      expiresAt: Date.now() - 100_000,
      user: { id: "user-offline", email: "u@example.com" },
    };
    storage[STORAGE_KEYS.AUTH_SESSION] = offlineAuth;

    const config = await saveStorageConfig({ destination: "supabase" });
    expect(config.destination).toBe("supabase");

    // But if no storedAuth exists, falls back to local
    delete storage[STORAGE_KEYS.AUTH_SESSION];
    const guestConfig = await saveStorageConfig({ destination: "supabase" });
    expect(guestConfig.destination).toBe("local");
  });
});
