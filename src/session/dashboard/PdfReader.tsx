import { useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { STORAGE_KEYS, type ContentChunk, type FullCognitiveProfile, type WorkspaceSession } from "@/types";
import { extractRemoteSource } from "@/layer1/premiumClient";
import { transformContent } from "@/layer1";
import { getTabTrackingState } from "@/utils/tabTracking";
import { renderMarkdown } from "@/utils/markdown";
import { findRelatedResources, type RelatedResource } from "@/layer1/resourceRecommendations";
import { isExcludedPage } from "@/utils/pagePrivacy";

/** Extension-owned reader: native PDF viewers do not need to accept content scripts. */
export function PdfReader({ source, tabId }: { source: string; tabId: number }) {
  const [chunks, setChunks] = useState<ContentChunk[]>([]);
  const [related, setRelated] = useState<RelatedResource[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const cancelled = useRef(false);
  useEffect(() => { cancelled.current = false; return () => { cancelled.current = true; }; }, []);

  const adapt = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    setChunks([]);
    setRelated([]);
    try {
      const url = new URL(source);
      if (!["http:", "https:"].includes(url.protocol) || !Number.isInteger(tabId) || tabId < 0) {
        throw new Error("Open a remote PDF tab and choose Read PDF in the popup. Local files are not uploaded.");
      }
      const sourceTab = await browser.tabs.get(tabId);
      if (sourceTab.url !== source || isExcludedPage(source, sourceTab.incognito)) {
        throw new Error("The source tab changed or is private. Reopen the reader from its current popup entry.");
      }
      const tracking = await getTabTrackingState(tabId);
      if (!tracking.included) throw new Error("Start a study session and include this PDF tab in the popup first.");
      const stored = await browser.storage.local.get([STORAGE_KEYS.PROFILE, STORAGE_KEYS.WORKSPACE]);
      const profile = stored[STORAGE_KEYS.PROFILE] as FullCognitiveProfile | undefined;
      const workspace = stored[STORAGE_KEYS.WORKSPACE] as WorkspaceSession | undefined;
      if (!profile?.baseline || !workspace) throw new Error("Complete onboarding before adapting a PDF.");
      const sessionId = workspace.sessionId;
      setStatus("Retrieving PDF text from your configured MindEase server…");
      const text = await extractRemoteSource(source, "pdf");
      if (cancelled.current) return;
      setStatus("Preparing adapted sections…");
      const adapted = await transformContent(text, "pdf", {
        baseline: profile.baseline, transformationParams: profile.transformationParams, outputLanguage: "source",
      }, source, async batch => {
        if (cancelled.current) throw new Error("Reader closed.");
        const reply: unknown = await browser.runtime.sendMessage({
          type: "SAVE_READER_CHUNKS", payload: { sourceTabId: tabId, sourceUrl: source, sessionId, chunks: batch },
        });
        if (!reply || typeof reply !== "object" || !("received" in reply) || reply.received !== true) {
          throw new Error("The PDF tab was excluded, closed, or the session ended. Start again in an included session.");
        }
        if (!cancelled.current) setChunks(previous => [...previous, ...batch]);
      });
      if (cancelled.current) return;
      setStatus("Adaptation saved to this study session.");
      const topics = [...new Set(adapted.flatMap(chunk => chunk.conceptTags))];
      const resources = await findRelatedResources(topics, profile.baseline.formatPreference === "visual" ? "visual" : "text", source);
      if (!cancelled.current) setRelated(resources);
    } catch (error) {
      if (!cancelled.current) setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (!cancelled.current) setBusy(false);
    }
  };

  return <section className="section-card" aria-labelledby="pdf-reader-title">
    <h2 id="pdf-reader-title">PDF reader</h2>
    <p style={{ overflowWrap: "anywhere" }}>{source}</p>
    <p>Accepting sends this PDF URL and extracted text to your configured MindEase server and DeepSeek. Scanned PDFs without extractable text require OCR. Private or authenticated downloads may be inaccessible to the server.</p>
    <button disabled={busy} onClick={() => void adapt()}>{busy ? "Adapting PDF…" : "Accept and adapt PDF"}</button>
    <p role="status" aria-live="polite">{status}</p>
    {chunks.map(chunk => <article key={chunk.id}>
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(chunk.text) }} />
      {chunk.sourceText && <details><summary>Original source section</summary><div dangerouslySetInnerHTML={{ __html: renderMarkdown(chunk.sourceText) }} /></details>}
    </article>)}
    {related.length > 0 && <aside aria-label="Related websites"><h3>Related websites</h3>{related.map(resource => <p key={resource.url}>
      <a href={resource.url} target="_blank" rel="noopener noreferrer">{resource.title}</a><br />{resource.description}
    </p>)}</aside>}
  </section>;
}
