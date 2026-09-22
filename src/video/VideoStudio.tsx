import { useState, useEffect, type FC } from "react";
import { Film, Sparkles, FileDown, Play } from "lucide-react";
import { submitDocumentForAnimation, submitArxivPaperForAnimation, pollJobStatus, fetchDocumentVideos } from "@/layer1/premiumClient";
import type { PremiumJobStatus } from "@/types";
const trunc = (value: string, length: number) => value.length > length ? value.slice(0, length) + "…" : value;
export const VideoStudio: FC<{ defaultTopic?: string }> = ({ defaultTopic }) => {
  const [topic, setTopic] = useState(defaultTopic || "");
  const [sourceType, setSourceType] = useState<"arxiv" | "wikipedia" | "website" | "pdf" | "custom">("website");
  const [urlOrId, setUrlOrId] = useState(new URLSearchParams(location.search).get("url") || "");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<PremiumJobStatus | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [videos, setVideos] = useState<Array<{ id: string; concept: string; video_url: string }>>([]);
  const [message, setMessage] = useState("");
  const [selectedVideoIdx, setSelectedVideoIdx] = useState(0);
  const jobBusy = isSubmitting || Boolean(jobId && (!jobStatus || jobStatus.status === "queued" || jobStatus.status === "processing"));

  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      try {
        const status = await pollJobStatus(jobId);
        setJobStatus(status);
        if (status.status === "completed") {
          clearInterval(interval);
          const targetId = status.arxiv_id || status.paper_id || activeDocId || status.job_id;
          const doc = await fetchDocumentVideos(targetId);
          if (doc && doc.videos.length > 0) {
            setVideos(prev => [...doc.videos, ...prev]);
            setSelectedVideoIdx(0);
          }
        } else if (status.status === "failed") {
          clearInterval(interval);
        }
      } catch (err) {
        console.warn("[VideoStudio] Polling status error:", err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [jobId, activeDocId]);

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
      if (sourceType === "arxiv" && /^\d{4}\.\d{4,5}(v\d+)?$/.test(urlOrId.trim())) {
        const res = await submitArxivPaperForAnimation(urlOrId.trim());
        setJobId(res.job_id);
        setActiveDocId(res.arxiv_id);
      } else {
        const res = await submitDocumentForAnimation({
          title: topic.trim() || (needsUrl ? "" : content.trim().split("\n")[0].slice(0, 120)),
          source_type: sourceType === "custom" ? "website" : sourceType,
          url: needsUrl ? urlOrId.trim() : undefined,
          content: needsUrl ? undefined : content.trim(),
        });
        setJobId(res.job_id);
        setActiveDocId(res.arxiv_id);
      }
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
            {currentVideo ? (
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

          {currentVideo && (
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

              {videos.length > 1 && (
                <div className="video-list-chips">
                  {videos.map((v, idx) => (
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

