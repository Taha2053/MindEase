/* ─── Content-script source helpers ──────────────────────────────────────────
   Pure / DOM-minimal utilities extracted for testability.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Detect whether a URL points to a PDF, accepting query strings and fragments.
 * Falls back to the page's declared content type.
 */
export function isPdfUrl(url: string, contentType?: string): boolean {
  if (contentType === "application/pdf") return true;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.endsWith(".pdf")) return true;
    // Query string detection for URLs like /view?file=paper.pdf or /download?format=pdf
    for (const [key, val] of parsed.searchParams.entries()) {
      const lower = val.toLowerCase();
      if ((/^(file|filename|attachment|document|path|download)$/i.test(key) && lower.endsWith(".pdf"))
        || (/^(format|type|mime|contentType)$/i.test(key) && (lower === "pdf" || lower === "application/pdf"))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Classify the source type for a page given its URL, content type, and DOM state. */
export function classifySource(
  url: string,
  contentType: string | undefined,
  hasVideoElement: boolean,
): "pdf" | "website" | "video" {
  if (isPdfUrl(url, contentType)) return "pdf";
  const platform = detectVideoPlatform(url);
  if (platform === "youtube" || platform === "vimeo" || hasVideoElement) {
    return "video";
  }
  return "website";
}

/* ─── Video platform detection ──────────────────────────────────────────────── */

export type VideoPlatform = "youtube" | "vimeo" | "generic";

export function detectVideoPlatform(url: string): VideoPlatform {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    // Only match youtube domains (youtube.com, m.youtube.com, youtu.be), avoiding false positives like not-youtube.com
    const isYouTubeHost = host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
    if (isYouTubeHost) {
      if ((host === "youtu.be" && parsed.pathname.length > 1) || parsed.pathname === "/watch") {
        return "youtube";
      }
    }
    const isVimeoHost = host === "vimeo.com" || host.endsWith(".vimeo.com");
    if (isVimeoHost && /^\/(?:video\/)?\d+(?:\/|$)/.test(parsed.pathname)) {
      return "vimeo";
    }
  } catch {
    // Fallback simple checks if URL parsing fails
  }
  return "generic";
}

/* ─── HTML5 textTrack transcript extraction ─────────────────────────────────── */

export interface TrackTranscript {
  language: string;
  label: string;
  cues: Array<{ start: number; end: number; text: string }>;
}

/**
 * Attempt to read an active text track (subtitles/captions) from an HTML5 video.
 * Returns null when no usable track is found or cues aren't loaded.
 */
export function extractTextTrackTranscript(video: HTMLVideoElement): TrackTranscript | null {
  const tracks = video.textTracks;
  if (!tracks || tracks.length === 0) return null;

  // Prefer showing/active caption/subtitle track; fall back to first with cues
  let best: TextTrack | null = null;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.kind !== "subtitles" && t.kind !== "captions") continue;
    if (t.mode === "showing" || t.mode === "hidden") {
      if (!best || t.mode === "showing") best = t;
    }
  }
  // If nothing showing/hidden, try to activate the first subtitle/caption track
  if (!best) {
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (t.kind === "subtitles" || t.kind === "captions") {
        best = t;
        break;
      }
    }
  }
  if (!best) return null;

  // Activate if needed so cues load
  if (best.mode === "disabled") best.mode = "hidden";

  const cueList = best.cues;
  if (!cueList || cueList.length === 0) return null;

  const cues: TrackTranscript["cues"] = [];
  for (let i = 0; i < cueList.length; i++) {
    const c = cueList[i] as VTTCue;
    cues.push({
      start: c.startTime,
      end: c.endTime,
      text: (c.text ?? "").replace(/<[^>]+>/g, "").trim(),
    });
  }
  if (cues.length === 0) return null;

  return {
    language: best.language || "unknown",
    label: best.label || best.language || "Default",
    cues,
  };
}

/** Disabled tracks load asynchronously once enabled; wait for the actual cue data. */
export async function loadTextTrackTranscript(video: HTMLVideoElement, signal: AbortSignal): Promise<TrackTranscript | null> {
  if (signal.aborted) return null;
  const ready = extractTextTrackTranscript(video);
  if (ready) return ready;
  const { promise, resolve } = Promise.withResolvers<TrackTranscript | null>();
  const tracks = Array.from(video.querySelectorAll("track"));
  const finish = (result: TrackTranscript | null) => {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    video.textTracks.removeEventListener("change", check);
    video.textTracks.removeEventListener("addtrack", check);
    tracks.forEach(track => track.removeEventListener("load", check));
    resolve(result);
  };
  const check = () => {
    const transcript = extractTextTrackTranscript(video);
    if (transcript) finish(transcript);
  };
  const abort = () => finish(null);
  const timer = setTimeout(() => finish(extractTextTrackTranscript(video)), 5000);
  signal.addEventListener("abort", abort, { once: true });
  video.textTracks.addEventListener("change", check);
  video.textTracks.addEventListener("addtrack", check);
  tracks.forEach(track => track.addEventListener("load", check));
  return promise;
}

/** Combine all cue texts from a TrackTranscript into a single string. */
export function transcriptToText(transcript: TrackTranscript): string {
  return transcript.cues.map(c => c.text).filter(Boolean).join(" ");
}

/* ─── Native PDF viewer detection ──────────────────────────────────────────── */

/**
 * Detect whether the current page is rendered by the browser's built-in PDF
 * viewer, which blocks content-script injection.  In Chrome this is an
 * `embed[type="application/pdf"]` inside a minimal document.
 */
export function isNativePdfViewer(doc: Document): boolean {
  // Chrome wraps PDFs in a minimal page with <embed type="application/pdf">
  const embed = doc.querySelector('embed[type="application/pdf"]');
  if (embed) return true;
  // Other native viewers may forbid content scripts entirely; use the dashboard reader.
  return false;
}
