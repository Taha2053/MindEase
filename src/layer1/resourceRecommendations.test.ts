import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchRelatedResources } from "./premiumClient";
import { findRelatedResources } from "./resourceRecommendations";

vi.mock("./premiumClient", () => ({ searchRelatedResources: vi.fn() }));
beforeEach(() => vi.mocked(searchRelatedResources).mockResolvedValue([]));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("related resources", () => {
  it("returns broad web results without calling the public fallback when Tavily responds", async () => {
    vi.mocked(searchRelatedResources).mockResolvedValue([
      { title: "Botany lesson", url: "https://university.edu/botany", description: "Plant science", reason: "Educational search result" },
      { title: "Unsafe link", url: "javascript:alert(1)", description: "", reason: "" },
    ]);
    const publicFetch = vi.fn();
    vi.stubGlobal("fetch", publicFetch);
    const results = await findRelatedResources(["Photosynthesis"], "text", "https://example.com/source");
    expect(results).toEqual([{ title: "Botany lesson", url: "https://university.edu/botany", description: "Plant science", reason: "Educational search result" }]);
    expect(searchRelatedResources).toHaveBeenCalledWith({
      topics: ["Photosynthesis"], preference: "text", sourceUrl: "https://example.com/source",
    });
    expect(publicFetch).not.toHaveBeenCalled();
  });
  it("prioritizes verified illustrated pages for visual learners without inventing links", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.includes("prop=pageimages")
        ? { query: { pages: { "1": { title: "Photosynthesis/Illustrated", thumbnail: { source: "https://example.org/image.jpg" } } } } }
        : { query: { search: [
          { title: "Photosynthesis/Text", snippet: "Text" },
          { title: "Photosynthesis/Illustrated", snippet: "Illustrated" },
        ] } },
    })));
    const results = await findRelatedResources(["Photosynthesis"], "visual", "https://example.com/lesson");
    expect(results[0].title).toBe("Photosynthesis/Illustrated");
    expect(results[0].url).toBe("https://en.wikibooks.org/wiki/Photosynthesis%2FIllustrated");
    expect(results[0].reason).toContain("indexed illustration");
    expect(results.some(result => result.title === "Photosynthesis/Text")).toBe(true);
  });
});
