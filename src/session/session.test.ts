import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { STORAGE_KEYS } from "@/types";
import { SessionManager } from "./SessionManager";

describe("workspace lifecycle", () => {
  let manager: SessionManager;
  let storage: Record<string, unknown>;
  const minute = 60_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T10:00:00Z"));
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
    manager = new SessionManager();
  });

  afterEach(async () => {
    await manager.reset();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps a failed archive retryable across worker restart without losing source chunks", async () => {
    await manager.registerTab(1, "https://example.org/lesson", "website", "Lesson");
    const sessionId = manager.getSessionId();
    const chunks = [{ id: "block-1", text: "Energy is conserved." }];
    storage[STORAGE_KEYS.SESSION_CHUNKS] = chunks;
    manager.onLayer3EndSession = async () => { throw new Error("Storage full"); };
    await expect(manager.endSession()).rejects.toThrow("Storage full");
    expect(storage[STORAGE_KEYS.SESSION_CHUNKS]).toEqual(chunks);
    const restored = new SessionManager();
    await restored.init();
    expect(restored.getSessionId()).toBe(sessionId);
    let archived: unknown;
    restored.onLayer3EndSession = async (source) => { archived = source; };
    await restored.endSession();
    expect(archived).toEqual(chunks);
    expect(storage[STORAGE_KEYS.SESSION_CHUNKS]).toBeUndefined();
    expect(restored.getSessionId()).toBeNull();
    await restored.reset();
  });

  it("excludes ongoing passive and suspended time from focus", async () => {
    await manager.registerTab(1, "https://example.org/lesson", "website", "Lesson");
    await vi.advanceTimersByTimeAsync(10 * minute);
    expect(manager.getState()).toBe("passive");
    expect(manager.getFocusSummary()).toMatchObject({
      totalTimeMs: 10 * minute,
      focusedTimeMs: 5 * minute,
      passiveTimeMs: 5 * minute,
    });
    await vi.advanceTimersByTimeAsync(30 * minute);
    expect(manager.getState()).toBe("suspended");
    expect(manager.getFocusSummary()).toMatchObject({
      focusedTimeMs: 5 * minute,
      passiveTimeMs: 30 * minute,
      suspendedTimeMs: 5 * minute,
    });
    manager.onActivity();
    await vi.advanceTimersByTimeAsync(minute);
    expect(manager.getFocusSummary().focusedTimeMs).toBe(6 * minute);
  });

  it("restores remaining idle time instead of restarting the inactivity window", async () => {
    const now = Date.now();
    storage[STORAGE_KEYS.WORKSPACE] = {
      sessionId: "s",
      userId: "guest",
      state: "active",
      tabs: [
        {
          tabId: 1,
          url: "",
          title: "",
          sourceType: "website",
          joinedAt: now - 4 * minute,
          lastActiveAt: now - 4 * minute,
          highlights: [],
        },
      ],
      startTime: now - 4 * minute,
      endTime: null,
      lastActivityAt: now - 4 * minute,
      enteredPassiveAt: null,
      enteredSuspendedAt: null,
      totalActiveDurationMs: 0,
      totalPassiveDurationMs: 0,
      totalSuspendedDurationMs: 0,
      interruptionCount: 0,
      longestDistractionMs: 0,
      distractionStart: null,
      stateTransitions: [],
    };
    const reloaded = new SessionManager();
    await reloaded.init();
    await vi.advanceTimersByTimeAsync(minute);
    expect(reloaded.getState()).toBe("passive");
    await vi.advanceTimersByTimeAsync(30 * minute);
    expect(reloaded.getState()).toBe("suspended");
    await reloaded.reset();
  });

  it("accounts for state transitions missed while the worker slept", async () => {
    const now = Date.now();
    storage[STORAGE_KEYS.WORKSPACE] = {
      sessionId: "s",
      userId: "guest",
      state: "active",
      tabs: [
        {
          tabId: 1,
          url: "",
          title: "",
          sourceType: "website",
          joinedAt: now - 40 * minute,
          lastActiveAt: now - 40 * minute,
          highlights: [],
        },
      ],
      startTime: now - 40 * minute,
      endTime: null,
      lastActivityAt: now - 40 * minute,
      enteredPassiveAt: null,
      enteredSuspendedAt: null,
      totalActiveDurationMs: 0,
      totalPassiveDurationMs: 0,
      totalSuspendedDurationMs: 0,
      interruptionCount: 0,
      longestDistractionMs: 0,
      distractionStart: null,
      stateTransitions: [],
    };
    manager = new SessionManager();
    await manager.init();
    expect(manager.getState()).toBe("suspended");
    expect(manager.getFocusSummary()).toMatchObject({
      focusedTimeMs: 5 * minute,
      passiveTimeMs: 30 * minute,
      suspendedTimeMs: 5 * minute,
    });
  });

  it("finalizes once and makes concurrent callers wait for finalization", async () => {
    await manager.registerTab(1, "https://example.org/lesson", "website", "Lesson");
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    manager.onLayer3EndSession = vi.fn(() => pending);
    manager.onLayer2EndSession = vi.fn(async () => null);
    const first = manager.endSession();
    const second = manager.endSession();
    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);
    expect(manager.onLayer3EndSession).toHaveBeenCalledOnce();
    expect(manager.onLayer2EndSession).toHaveBeenCalledOnce();
    expect(manager.getSessionId()).toBeNull();
  });


  it("preserves closed resources and their notes for the final review", async () => {
    await manager.registerTab(1, "https://example.org/lesson", "website", "Lesson");
    manager.recordHighlight(1, "The source claim.");
    await manager.registerTab(2, "https://example.org/other", "website", "Other");
    await manager.removeTab(1);
    expect(manager.getHighlights().map((note) => note.text)).toEqual(["The source claim."]);
    manager.onLayer3EndSession = vi.fn(async () => {});
    await manager.removeTab(2);
    expect(manager.onLayer3EndSession).toHaveBeenCalledWith(
      [],
      [expect.objectContaining({ text: "The source claim." })],
      [
        expect.objectContaining({ title: "Lesson" }),
        expect.objectContaining({ title: "Other" }),
      ],
      expect.any(Object),
    );
  });

  it("archives source text even without a synthesis callback", async () => {
    await manager.registerTab(1, "https://example.org/lesson", "website", "Lesson");
    const sessionId = manager.getSessionId();
    storage[STORAGE_KEYS.SESSION_CHUNKS] = [{ id: "source", originalText: "Source text." }];
    await manager.endSession();
    expect(storage.latestReviewChunks).toEqual({
      sessionId,
      chunks: [{ id: "source", originalText: "Source text." }],
    });
    expect(storage).not.toHaveProperty(STORAGE_KEYS.SESSION_CHUNKS);
  });
});
