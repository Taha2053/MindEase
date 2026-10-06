import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchRelatedResources } from "./premiumClient";
import { findRelatedResources } from "./resourceRecommendations";

vi.mock("./premiumClient", () => ({ searchRelatedResources: vi.fn() }));
beforeEach(() => { vi.mocked(searchRelatedResources).mockResolvedValue([]); });
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


  it("excludes source URL even when only the fragment differs", async () => {
    vi.mocked(searchRelatedResources).mockResolvedValue([
      { title: "Same page", url: "https://example.com/source#section2", description: "Fragment variant", reason: "Related" },
      { title: "Different page", url: "https://other.edu/lesson", description: "New", reason: "Related" },
    ]);
    vi.stubGlobal("fetch", vi.fn());
    const results = await findRelatedResources(["Topic"], "text", "https://example.com/source#section1");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Different page");
  });

  it("deduplicates URLs that differ only by trailing slash or fragment", async () => {
    vi.mocked(searchRelatedResources).mockResolvedValue([
      { title: "Page A", url: "https://edu.example/lesson", description: "First", reason: "Related" },
      { title: "Page A dup", url: "https://edu.example/lesson/", description: "Trailing slash", reason: "Related" },
      { title: "Page A frag", url: "https://edu.example/lesson#intro", description: "Fragment", reason: "Related" },
      { title: "Page B", url: "https://edu.example/other", description: "Unique", reason: "Related" },
    ]);
    vi.stubGlobal("fetch", vi.fn());
    const results = await findRelatedResources(["Topic"], "text", "https://source.test");
    const urls = results.map(r => r.url);
    expect(urls.filter(u => u.includes("edu.example/lesson"))).toHaveLength(1);
    expect(results.some(r => r.title === "Page B")).toBe(true);
  });

  it("filters short and overlength topics", async () => {
    vi.mocked(searchRelatedResources).mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn());
    const results = await findRelatedResources(["ab", "x".repeat(91)], "text", "");
    expect(results).toEqual([]);
    expect(searchRelatedResources).not.toHaveBeenCalled();
  });

  it("falls back to Wikibooks/Wikiversity when search backend is unavailable", async () => {
    vi.mocked(searchRelatedResources).mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.includes("prop=pageimages")
        ? { query: { pages: {} } }
        : { query: { search: [
          { title: "Photosynthesis basics", snippet: "How plants make food" },
        ] } },
    })));
    const results = await findRelatedResources(["Photosynthesis"], "text", "");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.url.startsWith("https://en.wiki"))).toBe(true);
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

  it("rejects fallback hits that match only generic words rather than the source topic", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ query: { search: [
        { title: "Introduction to gardening", snippet: "How to start" },
        { title: "Quantum mechanics", snippet: "Wave functions in quantum mechanics" },
      ] } }),
    })));
    const results = await findRelatedResources(["Introduction to quantum mechanics"], "text", "");
    expect(results.map(result => result.title)).toEqual(["Quantum mechanics", "Quantum mechanics"]);
  });

});
