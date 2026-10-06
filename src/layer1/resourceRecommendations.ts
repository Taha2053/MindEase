import { searchRelatedResources } from "./premiumClient";

export interface RelatedResource {
  title: string;
  url: string;
  description: string;
  reason: string;
}

const fallbackHosts = ["en.wikibooks.org", "en.wikiversity.org"] as const;

function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

/** Normalize for dedup: strip fragment, trailing slash, lowercase host. */
function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    let path = url.pathname.replace(/\/+$/, "");
    if (!path) path = "/";
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch { return raw; }
}


/** Prefer real web-search results; keep public learning sites available offline or without search credits. */
export async function findRelatedResources(
  topics: string[], preference: "visual" | "text", sourceUrl: string,
): Promise<RelatedResource[]> {
  const validTopics = [...new Set(topics.map(t => t.trim())
    .filter(t => t.length >= 3 && t.length <= 90))].slice(0, 3);
  if (!validTopics.length) return [];

  try {
    const webResults = await searchRelatedResources({ topics: validTopics, preference, sourceUrl });
    const seen = new Set<string>();
    const verified = webResults.filter(result => {
      if (typeof result.title !== "string" || !result.title.trim()) return false;
      const href = typeof result.url === "string" ? safeUrl(result.url) : null;
      if (!href || (sourceUrl && canonicalUrl(href) === canonicalUrl(sourceUrl))) return false;
      const canon = canonicalUrl(href);
      if (seen.has(canon)) return false;
      seen.add(canon);
      return true;
    });
    if (verified.length) return verified.slice(0, 6);
  } catch {
    // The learner can still receive public learning links without a running backend or credits.
  }

  // Public fallback: search Wikibooks and Wikiversity using all valid topics.
  const seen = new Set<string>();
  const allResults: Array<RelatedResource & { hasImage: boolean }> = [];

  for (const topic of validTopics) {
    const query = encodeURIComponent(topic);
    const jobs = fallbackHosts.map(async host => {
      const endpoint = `https://${host}/w/api.php?action=query&list=search&srsearch=${query}&srlimit=8&format=json&origin=*`;
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return [];
      const data = await response.json() as { query?: { search?: Array<{ title: string; snippet: string }> } };
      const hits = (data.query?.search ?? []).filter(hit => {
        const title = hit.title?.trim();
        if (!title) return false;
        const topicWords = topic.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(w =>
          w.length >= 3 && !["the", "and", "for", "with", "from", "into", "how", "what", "introduction"].includes(w)) ?? [];
        const indexedText = `${title} ${hit.snippet ?? ""}`.toLocaleLowerCase();
        const matched = topicWords.filter(word => indexedText.includes(word)).length;
        return topicWords.length > 0 && matched >= Math.min(2, topicWords.length);
      });
      if (!hits.length) return [];
      const illustrated = new Set<string>();
      if (preference === "visual") {
        try {
          const titles = encodeURIComponent(hits.map(hit => hit.title).join("|"));
          const pages = await fetch(`https://${host}/w/api.php?action=query&prop=pageimages&piprop=thumbnail&titles=${titles}&format=json&origin=*`, { signal: AbortSignal.timeout(8000) });
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
        if (!url || (sourceUrl && canonicalUrl(url) === canonicalUrl(sourceUrl))) return [];
        const canon = canonicalUrl(url);
        if (seen.has(canon)) return [];
        seen.add(canon);
        const description = hit.snippet.replace(/<[^>]*>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
        const hasImage = illustrated.has(title);
        return [{ title, url, description, hasImage, reason: hasImage
          ? "Related topic with an indexed illustration; inspect the page for useful visuals."
          : preference === "visual" ? "Related topic; illustrations could not be verified."
            : "Related topic in a structured reading resource." }];
      });
    });
    const settled = await Promise.allSettled(jobs);
    for (const job of settled) {
      if (job.status === "fulfilled") allResults.push(...job.value);
    }
  }

  if (preference === "visual") allResults.sort((a, b) => Number(b.hasImage) - Number(a.hasImage));
  return allResults.slice(0, 6)
    .map(({ hasImage: _hasImage, ...item }) => item);
}
