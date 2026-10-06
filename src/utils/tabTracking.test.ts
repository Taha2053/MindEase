import { afterEach, describe, expect, it, vi } from "vitest";
import browser, { type Tabs } from "webextension-polyfill";
import { STORAGE_KEYS } from "@/types";
import {
  getTabTrackingState,
  classifyTabByMetadata,
  updateTabCategoryGuarded,
  pruneExcludedTabs,
  mapConcurrent,
} from "./tabTracking";

afterEach(() => vi.restoreAllMocks());

describe("tracking eligibility", () => {
  it.each([
    ["learning", undefined, true],
    ["distraction", undefined, false],
    [undefined, undefined, true],
    ["learning", true, false],
    ["distraction", false, true],
    [undefined, false, true],
  ])("applies the explicit override before category %s (%s)", async (category, override, included) => {
    vi.spyOn(browser.storage.local, "get").mockResolvedValue({
      [STORAGE_KEYS.EXTENSION_ACTIVE]: true,
      [STORAGE_KEYS.WORKSPACE]: { state: "active", tabs: [{ tabId: 7, category }] },
      [STORAGE_KEYS.EXCLUDED_TABS]: override === undefined ? {} : { 7: override },
    });
    expect(await getTabTrackingState(7)).toEqual({ active: true, included, overridden: override !== undefined });
  });

  it.each([false, true])("never revives ended sessions even with explicit inclusion (flag=%s)", async activeFlag => {
    vi.spyOn(browser.storage.local, "get").mockResolvedValue({
      [STORAGE_KEYS.EXTENSION_ACTIVE]: activeFlag,
      [STORAGE_KEYS.WORKSPACE]: { state: "ended", tabs: [{ tabId: 7, category: "learning" }] },
      [STORAGE_KEYS.EXCLUDED_TABS]: { 7: false },
    });
    expect((await getTabTrackingState(7)).included).toBe(false);
  });
});

describe("classifyTabByMetadata", () => {
  it("treats Classroom and Google Sheets as learning heuristic without LLM call", async () => {
    const mockLlm = vi.fn();
    const classroomRes = await classifyTabByMetadata(
      "https://classroom.google.com/c/123",
      "Classroom",
      false,
      mockLlm,
    );
    expect(classroomRes).toEqual({ category: "learning", method: "heuristic" });
    expect(mockLlm).not.toHaveBeenCalled();

    const sheetsRes = await classifyTabByMetadata(
      "https://docs.google.com/spreadsheets/d/abc",
      "Spreadsheet",
      false,
      mockLlm,
    );
    expect(sheetsRes).toEqual({ category: "learning", method: "heuristic" });
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it("marks restricted / private URLs as unavailable without LLM call", async () => {
    const mockLlm = vi.fn();
    const res = await classifyTabByMetadata("chrome://settings", "Settings", false, mockLlm);
    expect(res).toEqual({ category: "unknown", method: "unavailable" });
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it("calls LLM fallback for general sites and translates educational/entertainment to learning/distraction", async () => {
    const mockLlm = vi.fn().mockResolvedValueOnce("educational").mockResolvedValueOnce("entertainment");
    const ed = await classifyTabByMetadata("https://example.com/physics", "Physics 101", false, mockLlm);
    expect(ed).toEqual({ category: "learning", method: "llm" });

    const ent = await classifyTabByMetadata("https://example.com/games", "Arcade", false, mockLlm);
    expect(ent).toEqual({ category: "distraction", method: "llm" });
  });
});

describe("updateTabCategoryGuarded", () => {
  it("guards against stale URL", async () => {
    vi.spyOn(browser.tabs, "get").mockResolvedValue({ id: 10, url: "https://navigated.com" } as unknown as Tabs.Tab);
    const mockMgr = {
      updateTabCategory: vi.fn(),
      getSessionId: vi.fn().mockReturnValue("session-1"),
    };
    const updated = await updateTabCategoryGuarded(10, "https://old.com", "learning", mockMgr, "session-1");
    expect(updated).toBe(false);
    expect(mockMgr.updateTabCategory).not.toHaveBeenCalled();
  });

  it("guards against stale session ID", async () => {
    vi.spyOn(browser.tabs, "get").mockResolvedValue({ id: 10, url: "https://same.com" } as unknown as Tabs.Tab);
    const mockMgr = {
      updateTabCategory: vi.fn(),
      getSessionId: vi.fn().mockReturnValue("session-2"),
    };
    const updated = await updateTabCategoryGuarded(10, "https://same.com", "learning", mockMgr, "session-1");
    expect(updated).toBe(false);
    expect(mockMgr.updateTabCategory).not.toHaveBeenCalled();
  });

  it("applies update when URL and session match", async () => {
    vi.spyOn(browser.tabs, "get").mockResolvedValue({ id: 10, url: "https://same.com" } as unknown as Tabs.Tab);
    const mockMgr = {
      updateTabCategory: vi.fn().mockResolvedValue(undefined),
      getSessionId: vi.fn().mockReturnValue("session-1"),
    };
    const updated = await updateTabCategoryGuarded(10, "https://same.com", "learning", mockMgr, "session-1");
    expect(updated).toBe(true);
    expect(mockMgr.updateTabCategory).toHaveBeenCalledWith(10, "learning");
  });
});

describe("pruneExcludedTabs", () => {
  it("keeps only overrides for currently open tabs", async () => {
    vi.spyOn(browser.storage.local, "get").mockResolvedValue({
      [STORAGE_KEYS.EXCLUDED_TABS]: { 1: true, 2: false, 3: true },
    });
    vi.spyOn(browser.tabs, "query").mockResolvedValue([
      { id: 1 },
      { id: 3 },
    ] as unknown as Tabs.Tab[]);

    const pruned = await pruneExcludedTabs();
    expect(pruned).toEqual({ 1: true, 3: true });
  });
});

describe("mapConcurrent", () => {
  it("executes tasks with bounded concurrency", async () => {
    let active = 0;
    let maxSeen = 0;
    const items = [1, 2, 3, 4, 5];
    const results = await mapConcurrent(items, 2, async num => {
      active++;
      maxSeen = Math.max(maxSeen, active);
      await Promise.resolve();
      active--;
      return num * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxSeen).toBeLessThanOrEqual(2);
  });
});
