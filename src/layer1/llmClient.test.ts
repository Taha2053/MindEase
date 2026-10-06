import { afterEach, describe, expect, it, vi } from "vitest";
import { batchClassifyTabTitles } from "./llmClient";
vi.mock("@/utils/apiKeyManager", () => ({ getApiKey: vi.fn(async () => "") }));
vi.mock("@/utils/supabase", () => ({ getSession: vi.fn(async () => null) }));
afterEach(() => vi.unstubAllGlobals());
const tabs = [{ tabId: 1, title: "Lecture", url: "https://example.org/lecture" }, { tabId: 2, title: "Comedy", url: "https://example.org/comedy" }];
describe("tab classification response validation", () => {
  it("leaves provider failures unclassified", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect([...await batchClassifyTabTitles(tabs)]).toEqual([]);
  });
  it("accepts only requested IDs with valid categories and leaves missing tabs unclassified", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: JSON.stringify({ tabs: [null, { id: 1, category: "learning" }, { id: 2, category: "uncertain" }, { id: 99, category: "distraction" }] }) }), { status: 200 })));
    expect([...await batchClassifyTabTitles(tabs)]).toEqual([[1, "learning"]]);
  });
  it("does not turn malformed model responses into learning", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: "not json" }), { status: 200 })));
    expect([...await batchClassifyTabTitles(tabs)]).toEqual([]);
  });
});
