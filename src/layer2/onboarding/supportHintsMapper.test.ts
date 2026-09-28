import { afterEach, describe, expect, it, vi } from "vitest";
import { mapSupportNeeds } from "./supportHintsMapper";

vi.mock("@/utils/apiKeyManager", () => ({ getApiKey: vi.fn().mockResolvedValue(null) }));

afterEach(() => vi.unstubAllGlobals());

describe("self-described learner support", () => {
  it("uses only actionable allowlisted hints from an AI response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      content: JSON.stringify({ shortSections: true, readAloud: true, diagnosis: "ADHD", largerText: "yes" }),
    }) }));
    expect(await mapSupportNeeds("I need short sections and narration")).toEqual({ shortSections: true, readAloud: true });
  });

  it("does not fabricate needs when the AI provider is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await mapSupportNeeds("Please use larger text")).toBeUndefined();
  });
});
