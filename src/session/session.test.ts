// ============================================================
// session/session.test.ts - Unit tests for Workspace SessionManager
// ============================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionManager } from "./SessionManager";

describe("SessionManager - Workspace Lifecycle", () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager();
  });

  it("starts in ended state and transitions to active upon tab registration", async () => {
    expect(sm.getState()).toBe("ended");

    await sm.registerTab(1, "https://example.com/lecture", "website", "Intro to AI");

    expect(sm.getState()).toBe("active");
    expect(sm.getSessionId()).not.toBeNull();
    expect(sm.getTabs()).toHaveLength(1);
    expect(sm.getTabs()[0].title).toBe("Intro to AI");
  });

  it("records highlights per tab", async () => {
    await sm.registerTab(1, "https://example.com/lecture", "website", "Intro to AI");

    sm.recordHighlight(1, "Key takeaway: neural networks are function approximators.");

    const highlights = sm.getHighlights();
    expect(highlights).toHaveLength(1);
    expect(highlights[0].text).toContain("neural networks");
    expect(highlights[0].resourceTitle).toBe("Intro to AI");
  });

  it("computes focus metrics accurately", async () => {
    await sm.registerTab(1, "https://example.com/math", "website", "Linear Algebra");

    const focus = sm.getFocusSummary();
    expect(focus.interruptionCount).toBe(0);
    expect(focus.totalTimeMs).toBeGreaterThanOrEqual(0);
    expect(focus.focusedTimeMs).toBeGreaterThanOrEqual(0);
  });
});
