import { searchRelatedResources } from "./premiumClient";

export interface RelatedResource {
  title: string;
  url: string;
  description: string;
  reason: string;
}

const projectHosts = ["en.wikibooks.org", "en.wikiversity.org"] as const;

function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

/** Prefer real web-search results; keep public learning sites available offline or without search credits. */
export async function findRelatedResources(
  topics: string[], preference: "visual" | "text", sourceUrl: string,
): Promise<RelatedResource[]> {
  const topic = topics.map(t => t.trim()).find(t => t.length >= 3 && t.length <= 90);
  if (!topic) return [];
  try {
    const webResults = await searchRelatedResources({ topics: [topic], preference, sourceUrl });
    const verified = webResults.filter(result =>
      typeof result.title === "string" && result.title.trim()
      && typeof result.url === "string" && safeUrl(result.url)
      && result.url !== sourceUrl
    );
    if (verified.length) return verified.slice(0, 4);
  } catch {
    // The learner can still receive public learning links without a running backend or credits.
  }

  const query = encodeURIComponent(topic);
  const jobs = projectHosts.map(async host => {
    const endpoint = `https://${host}/w/api.php?action=query&list=search&srsearch=${query}&srlimit=8&format=json&origin=*`;
    const response = await fetch(endpoint);
    if (!response.ok) return [];
    const data = await response.json() as { query?: { search?: Array<{ title: string; snippet: string }> } };
    const hits = (data.query?.search ?? []).filter(hit => {
      const title = hit.title?.trim();
      return title && title.toLocaleLowerCase().includes(topic.toLocaleLowerCase().split(/\s+/)[0]);
    });
    if (!hits.length) return [];
    const illustrated = new Set<string>();
    if (preference === "visual") {
      try {
        const titles = encodeURIComponent(hits.map(hit => hit.title).join("|"));
        const pages = await fetch(`https://${host}/w/api.php?action=query&prop=pageimages&piprop=thumbnail&titles=${titles}&format=json&origin=*`);
        if (pages.ok) {
          const metadata = await pages.json() as { query?: { pages?: Record<string, { title: string; thumbnail?: { source: string } }> } };
          for (const page of Object.values(metadata.query?.pages ?? {})) {
            if (page.thumbnail?.source) illustrated.add(page.title);
          }
        }
      } catch { /* Search links still work if image metadata is unavailable. */ }
    }
    return hits.flatMap(hit => {
      const title = hit.title.trim();
      const url = safeUrl(`https://${host}/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`);
      if (!url || url === sourceUrl) return [];
      const description = hit.snippet.replace(/<[^>]*>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
      const hasImage = illustrated.has(title);
      return [{ title, url, description, hasImage, reason: hasImage
        ? "Related topic with an indexed illustration; inspect the page for useful visuals."
        : preference === "visual" ? "Related topic; illustrations could not be verified."
          : "Related topic in a structured reading resource." }];
    });
  });
  const settled = await Promise.allSettled(jobs);
  const results = settled.flatMap(job => job.status === "fulfilled" ? job.value : []);
  if (preference === "visual") results.sort((a, b) => Number(b.hasImage) - Number(a.hasImage));
  return results.filter((item, index) => results.findIndex(other => other.url === item.url) === index).slice(0, 4)
    .map(({ hasImage: _hasImage, ...item }) => item);
}
