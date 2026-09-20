import { expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { handleBehaviorSignal } from "./index";
import { RLAgent } from "./rlAgent";
import * as profiles from "./profileManager";

it("records an interaction without changing the profile or running the learning policy", async () => {
  const profile = await profiles.createProfile({
    formatPreference: "text", attentionSpan: "medium", readingPace: "moderate",
    needsConceptAnchor: false, secondLanguageLearner: false,
    infoDensity: "detailed", learningApproach: "theory-first",
  });
  const original = structuredClone(profile);
  vi.spyOn(profiles, "getProfile").mockResolvedValue(profile);
  vi.spyOn(profiles, "getSessionStats").mockResolvedValue(profiles.freshSessionStats());
  const saveStats = vi.spyOn(profiles, "saveSessionStats").mockResolvedValue(undefined);
  const policy = vi.spyOn(RLAgent.prototype, "processSignal");
  const update = vi.spyOn(profiles, "updateProfile");
  const send = vi.fn().mockResolvedValue(undefined);
  const originalSend = browser.runtime.sendMessage;
  browser.runtime.sendMessage = send;
  try {
    await handleBehaviorSignal("highlight", "https://example.org/course", "block-1");
    expect(policy).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(profile).toEqual(original);
    expect(saveStats).toHaveBeenCalledWith(expect.objectContaining({ totalHighlights: 1 }));
  } finally {
    browser.runtime.sendMessage = originalSend;
    vi.restoreAllMocks();
  }
});
