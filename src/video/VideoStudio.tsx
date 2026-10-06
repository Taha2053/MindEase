import { useState, useEffect, type FC } from "react";
import browser from "webextension-polyfill";
import { Film, Sparkles, FileDown, Play } from "lucide-react";
import {
  submitDocumentForAnimation,
  submitArxivPaperForAnimation,
  pollJobStatus,
  fetchDocumentVideos,
  isValidVideoUrl,
  type SavedVideoEntry,
} from "@/layer1/premiumClient";
import { STORAGE_KEYS, type PremiumJobStatus, type PremiumJobResponse } from "@/types";

export const VIDEO_DRAFT_KEY = "mindease_video_draft";

export interface VideoStudioDraft {
  jobId: string | null;
  activeDocId?: string | null;
  sourceType: "arxiv" | "wikipedia" | "website" | "pdf" | "custom";
  urlOrId: string;
  topic: string;
  content: string;
  sessionId?: string | null;
  ownerAccountId?: string | null;
  createdAt?: number;
}

const trunc = (value: string, length: number) => value.length > length ? value.slice(0, length) + "…" : value;

export const VideoStudio: FC<{ defaultTopic?: string; source?: string }> = ({ defaultTopic, source }) => {
  const initialSource = source ?? new URLSearchParams(location.search).get("source") ?? "";
  const [topic, setTopic] = useState(defaultTopic || "");
  const [sourceType, setSourceType] = useState<"arxiv" | "wikipedia" | "website" | "pdf" | "custom">(/\.pdf(?:[?#]|$)/i.test(initialSource) ? "pdf" : "website");
  const [urlOrId, setUrlOrId] = useState(initialSource);
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<PremiumJobStatus | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [capturedSessionId, setCapturedSessionId] = useState<string | null>(null);
  const [capturedOwnerId, setCapturedOwnerId] = useState<string | null>(null);
  const [videos, setVideos] = useState<Array<{ id: string; concept: string; video_url: string; section_id?: string }>>([]);
  const [message, setMessage] = useState("");
  const [selectedVideoIdx, setSelectedVideoIdx] = useState(0);
  const jobBusy = isSubmitting || Boolean(jobId && (!jobStatus || jobStatus.status === "queued" || jobStatus.status === "processing"));

  // Restore active draft and saved videos on mount
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const stored = await browser.storage.local.get([
          VIDEO_DRAFT_KEY,
          STORAGE_KEYS.AUTH_SESSION,
          "mindease_saved_videos",
        ]);
        if (!mounted) return;

        const currentAuth = stored[STORAGE_KEYS.AUTH_SESSION] as { user?: { id?: string } } | undefined;
        const currentOwnerId = currentAuth?.user?.id ?? null;

        // Populate initial saved videos for current account
        const saved = (stored.mindease_saved_videos ?? []) as Array<SavedVideoEntry>;
        const matchingVideos = saved
          .filter(v => (v.ownerAccountId === undefined || v.ownerAccountId === null || v.ownerAccountId === currentOwnerId) && isValidVideoUrl(v.video_url))
          .map(v => ({ id: v.id, concept: v.concept, video_url: v.video_url, section_id: v.section_id }));
        if (matchingVideos.length > 0) {
          setVideos(prev => {
            if (prev.length > 0) return prev;
            return matchingVideos;
          });
        }

        const draft = stored[VIDEO_DRAFT_KEY] as VideoStudioDraft | undefined;
        if (!draft) return;

        // If draft belonged to a specific account, prevent cross-account restoration
        if (draft.ownerAccountId !== undefined && draft.ownerAccountId !== currentOwnerId) {
          return;
        }

        // Recover job regardless
        if (draft.jobId) {
          setJobId(draft.jobId);
          setActiveDocId(draft.activeDocId ?? null);
          setCapturedSessionId(draft.sessionId ?? null);
          setCapturedOwnerId(draft.ownerAccountId ?? null);
        }

        // Don't overwrite explicit new source prop when restoring form, but recover job regardless
        const hasExplicitSource = Boolean(source && source.trim().length > 0);
        if (!hasExplicitSource) {
          if (draft.urlOrId) setUrlOrId(draft.urlOrId);
          if (draft.sourceType) setSourceType(draft.sourceType);
          if (draft.topic) setTopic(draft.topic);
          if (draft.content) setContent(draft.content);
        } else {
          if (draft.topic) setTopic(prev => prev || draft.topic);
          if (draft.content) setContent(prev => prev || draft.content);
        }
      } catch (err) {
        console.warn("[VideoStudio] Failed to restore state:", err);
      }
    };

    void init();
    return () => {
      mounted = false;
    };
  }, []);

  // Explicit source prop updates (respect busy state to avoid mid-job mutations)
  useEffect(() => {
    if (!source || !source.trim() || jobBusy) return;
    setUrlOrId(source);
    setSourceType(/\.pdf(?:[?#]|$)/i.test(source) ? "pdf" : "website");
  }, [source, jobBusy]);

  const clearActiveDraftJob = async () => {
    try {
      const stored = await browser.storage.local.get([VIDEO_DRAFT_KEY, STORAGE_KEYS.AUTH_SESSION]);
      const currentAuth = stored[STORAGE_KEYS.AUTH_SESSION] as { user?: { id?: string } } | undefined;
      const currentOwnerId = currentAuth?.user?.id ?? null;
      if (currentOwnerId !== capturedOwnerId) {
        return;
      }
      const existingDraft = stored[VIDEO_DRAFT_KEY] as VideoStudioDraft | undefined;
      if (existingDraft?.jobId === jobId) {
        // Clear active draft job, keep form fields
        await browser.storage.local.set({
          [VIDEO_DRAFT_KEY]: {
            ...existingDraft,
            jobId: null,
            activeDocId: null,
          },
        });
      }
    } catch (err) {
      console.warn("[VideoStudio] Failed to clear active draft job:", err);
    }
  };

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const status = await pollJobStatus(jobId);
        if (cancelled) return;
        setJobStatus(status);
        if (status.status === "completed") {
          const targetId = status.arxiv_id || status.paper_id || activeDocId || status.job_id;
          const doc = await fetchDocumentVideos(targetId, {
            sessionId: capturedSessionId,
            ownerAccountId: capturedOwnerId,
          });
          if (cancelled) return;
          if (doc?.videos.length) {
            setVideos(prev => {
              const safeIncoming = doc.videos.filter(v => isValidVideoUrl(v.video_url));
              const map = new Map<string, { id: string; concept: string; video_url: string; section_id?: string }>();
              for (const v of safeIncoming) map.set(v.id, v);
              for (const v of prev) {
                if (!map.has(v.id) && isValidVideoUrl(v.video_url)) map.set(v.id, v);
              }
              return [...map.values()];
            });
            setSelectedVideoIdx(0);
            setMessage("");
          } else {
            setMessage("Processing completed without a playable video. Check the generation status and source.");
          }
          await clearActiveDraftJob();
          return;
        }
        if (status.status === "failed") {
          await clearActiveDraftJob();
          return;
        }
        setMessage("");
      } catch (err) {
        if (cancelled) return;
        setMessage(`Could not retrieve video progress: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!cancelled) timer = window.setTimeout(poll, 2500);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId, activeDocId, capturedSessionId, capturedOwnerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (jobBusy) return;
    const needsUrl = sourceType !== "custom";
    if ((needsUrl && !urlOrId.trim()) || (!needsUrl && !content.trim())) {
      setMessage(needsUrl ? "Provide the exact source URL or arXiv ID." : "Paste the exact source material to animate.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    setJobStatus(null);
    setJobId(null);
    try {
      // Capture owner and workspace session before submission
      const authStored = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
      const ownerId = (authStored[STORAGE_KEYS.AUTH_SESSION] as { user?: { id?: string } } | undefined)?.user?.id ?? null;
      const wsStored = await browser.storage.local.get(STORAGE_KEYS.WORKSPACE);
      const sessId = (wsStored[STORAGE_KEYS.WORKSPACE] as { sessionId?: string } | undefined)?.sessionId ?? null;

      setCapturedOwnerId(ownerId);
      setCapturedSessionId(sessId);

      let res: PremiumJobResponse;
      if (sourceType === "arxiv" && /^\d{4}\.\d{4,5}(v\d+)?$/.test(urlOrId.trim())) {
        res = await submitArxivPaperForAnimation(urlOrId.trim());
      } else {
        res = await submitDocumentForAnimation({
          title: topic.trim() || (needsUrl ? "" : content.trim().split("\n")[0].slice(0, 120)),
          source_type: sourceType === "custom" ? "website" : sourceType,
          url: needsUrl ? urlOrId.trim() : undefined,
          content: needsUrl ? undefined : content.trim(),
        });
      }

      const newJobId = res.job_id;
      const newDocId = res.arxiv_id;

      // Prevent async cancelled prior-account fetch writing into different account
      const checkAuth = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSION);
      const checkOwnerId = (checkAuth[STORAGE_KEYS.AUTH_SESSION] as { user?: { id?: string } } | undefined)?.user?.id ?? null;
      if (checkOwnerId !== ownerId) {
        return;
      }

      // Persist active video job ID/document ID + source/type/title/content in browser.storage.local
      // key mindease_video_draft immediately when submission returns
      const draft: VideoStudioDraft = {
        jobId: newJobId,
        activeDocId: newDocId,
        sourceType,
        urlOrId,
        topic,
        content,
        sessionId: sessId,
        ownerAccountId: ownerId,
        createdAt: Date.now(),
      };
      await browser.storage.local.set({ [VIDEO_DRAFT_KEY]: draft });

      setJobId(newJobId);
      setActiveDocId(newDocId);
    } catch (err) {
      setMessage("Animation request failed: " + String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentVideo = videos[selectedVideoIdx] || videos[0];

  return (
    <section className="section-card" id="section-video-studio" data-section="video-studio">
      <div className="section-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Film size={18} style={{ color: "var(--accent)" }} />
          <h2>Video studio</h2>
        </div>
      </div>

      <div className="video-studio-grid">
        {/* Left: Generator Console */}
        <div className="video-form-card">
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Sparkles size={16} style={{ color: "var(--accent)" }} />
            <h3 style={{ fontSize: "0.9rem", fontWeight: 600 }}>Create a video explanation</h3>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-dim)", lineHeight: 1.4 }}>
            Create a Manim explanation grounded in the source you provide. DeepSeek plans and generates the animation.
          </p>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="video-field-group">
              <label className="video-field-label">
                Content Source
              </label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(["website", "pdf", "arxiv", "wikipedia", "custom"] as const).map(type => (
                  <button
                    key={type}
                    type="button"
                    className={`video-chip ${sourceType === type ? "active" : ""}`}
                    onClick={() => setSourceType(type)}
                    disabled={jobBusy}
                  >
                    {type === "arxiv" ? "arXiv Paper" : type === "wikipedia" ? "Wikipedia" : type === "website" ? "Web article" : type === "pdf" ? "PDF" : "Paste text"}
                  </button>
                ))}
              </div>
            </div>

            <div className="video-field-group">
              <label className="video-field-label" htmlFor="video-topic">
                Title (optional)
              </label>
              <input
                id="video-topic"
                type="text"
                className="video-input"
                placeholder="e.g. Scaled Dot-Product Attention or Eigenvalues"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={jobBusy}
              />
            </div>

            {(sourceType !== "custom") && (
              <div className="video-field-group">
                <label className="video-field-label" htmlFor="video-url">
                  {sourceType === "arxiv" ? "arXiv Paper ID" : "Source URL"}
                  <span>{sourceType === "arxiv" ? "e.g. 1706.03762" : "e.g. https://en.wikipedia.org/..."}</span>
                </label>
                <input
                  id="video-url"
                  type="text"
                  className="video-input"
                  placeholder={sourceType === "arxiv" ? "1706.03762" : "https://..."}
                  value={urlOrId}
                  onChange={(e) => setUrlOrId(e.target.value)}
                  disabled={jobBusy}
                />
              </div>
            )}

            {sourceType === "custom" && <div className="video-field-group">
              <label className="video-field-label" htmlFor="video-content">
                {"Source material"} <span>(LaTeX or Markdown)</span>
              </label>
              <textarea
                id="video-content"
                className="video-textarea"
                placeholder="e.g. Attention(Q, K, V) = softmax(QK^T / sqrt(d))V"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={jobBusy}
              />
            </div>}

            <button
              type="submit"
              className="video-submit-btn"
              disabled={jobBusy}
            >
              {isSubmitting ? (
                <>Submitting request...</>
              ) : jobStatus && jobStatus.status === "processing" ? (
                <><div className="loading-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Generating Animation...</>
              ) : (
                <><Film size={16} /> Generate video</>
              )}
            </button>
            <p role="status" aria-live="polite" style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>{message}</p>
          </form>

          {/* Progress Box */}
          {jobStatus && (
            <div className="video-progress-box">
              <div className="video-progress-header">
                <span>{jobStatus.current_step || "Processing..."}</span>
                <span style={{ color: jobStatus.status === "failed" ? "var(--danger)" : "var(--accent)" }}>
                  {jobStatus.status === "completed" ? "✓ Done" : jobStatus.status === "failed" ? "✗ Failed" : `${Math.round(jobStatus.progress * 100)}%`}
                </span>
              </div>
              <div className="video-progress-bar">
                <div className="video-progress-fill" style={{ width: `${Math.max(8, Math.round(jobStatus.progress * 100))}%` }} />
              </div>
              {jobStatus.error && (
                <p style={{ color: "var(--danger)", fontSize: "0.72rem" }}>{jobStatus.error}</p>
              )}
            </div>
          )}
        </div>

        {/* Right: Cinema Video Player */}
        <div className="video-player-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 600 }}>Your videos</h3>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              {videos.length} Animation{videos.length !== 1 ? "s" : ""} Available
            </span>
          </div>

          <div className="video-screen-wrap">
            {currentVideo && isValidVideoUrl(currentVideo.video_url) ? (
              <video
                key={currentVideo.video_url}
                src={currentVideo.video_url}
                controls
                preload="metadata"
              />
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>No video loaded</div>
            )}
          </div>

          {currentVideo && isValidVideoUrl(currentVideo.video_url) && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>
                  {currentVideo.concept}
                </span>
                <a
                  href={currentVideo.video_url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "none", fontSize: "0.72rem", display: "flex", alignItems: "center", gap: 4 }}
                >
                  <FileDown size={14} /> Download MP4
                </a>
              </div>

              {videos.filter(v => isValidVideoUrl(v.video_url)).length > 1 && (
                <div className="video-list-chips">
                  {videos.filter(v => isValidVideoUrl(v.video_url)).map((v, idx) => (
                    <button
                      key={v.id + idx}
                      type="button"
                      className={`video-chip ${selectedVideoIdx === idx ? "active" : ""}`}
                      onClick={() => setSelectedVideoIdx(idx)}
                    >
                      <Play size={10} /> {trunc(v.concept, 24)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

