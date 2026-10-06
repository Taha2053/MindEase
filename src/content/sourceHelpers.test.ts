import { describe, it, expect, vi } from "vitest";
import {
  isPdfUrl,
  detectVideoPlatform,
  classifySource,
  extractTextTrackTranscript,
  loadTextTrackTranscript,
  transcriptToText,
  isNativePdfViewer,
} from "./sourceHelpers";

describe("sourceHelpers", () => {
  describe("isPdfUrl", () => {
    it("detects basic .pdf path", () => {
      expect(isPdfUrl("https://example.com/papers/document.pdf")).toBe(true);
    });

    it("detects .pdf with query strings and fragments", () => {
      expect(isPdfUrl("https://example.com/view.pdf?token=abc&page=2#section1")).toBe(true);
    });

    it("detects pdf in query string parameter", () => {
      expect(isPdfUrl("https://example.com/viewer?file=report.pdf&lang=en")).toBe(true);
      expect(isPdfUrl("https://example.com/download?format=pdf")).toBe(true);
      expect(isPdfUrl("https://example.com/api/get?mime=application/pdf")).toBe(true);
    });

    it("detects declared application/pdf content type even if URL does not end in .pdf", () => {
      expect(isPdfUrl("https://example.com/documents/render/12345", "application/pdf")).toBe(true);
    });

    it("rejects non-PDF URLs", () => {
      expect(isPdfUrl("https://example.com/article.html")).toBe(false);
      expect(isPdfUrl("https://example.com/pdf-tutorials")).toBe(false);
      expect(isPdfUrl("invalid-url")).toBe(false);
    });
  });

  describe("detectVideoPlatform - false positives prevention", () => {
    it("identifies valid YouTube domains", () => {
      expect(detectVideoPlatform("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube");
      expect(detectVideoPlatform("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube");
      expect(detectVideoPlatform("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube");
    });

    it("rejects lookalike hostnames (false positives)", () => {
      expect(detectVideoPlatform("https://not-youtube.com/watch?v=123")).toBe("generic");
      expect(detectVideoPlatform("https://fakayoutube.com/watch?v=123")).toBe("generic");
      expect(detectVideoPlatform("https://myvimeo.com/123456")).toBe("generic");
      expect(detectVideoPlatform("https://vimeo.com.attacker.com/123456")).toBe("generic");
    });

    it("identifies valid Vimeo video URLs", () => {
      expect(detectVideoPlatform("https://vimeo.com/76979871")).toBe("vimeo");
      expect(detectVideoPlatform("https://player.vimeo.com/123456")).toBe("vimeo");
    });

    it("falls back to generic for other video platforms", () => {
      expect(detectVideoPlatform("https://example.com/video.mp4")).toBe("generic");
      expect(detectVideoPlatform("https://coursera.org/learn/ml/lecture/1")).toBe("generic");
    });
  });

  describe("classifySource", () => {
    it("prioritizes PDF over other signals", () => {
      expect(classifySource("https://example.com/book.pdf", undefined, true)).toBe("pdf");
    });

    it("identifies video pages with video elements or video platforms", () => {
      expect(classifySource("https://www.youtube.com/watch?v=123", undefined, false)).toBe("video");
      expect(classifySource("https://example.com/lecture", undefined, true)).toBe("video");
    });

    it("defaults to website when neither PDF nor video", () => {
      expect(classifySource("https://example.com/article", undefined, false)).toBe("website");
    });
  });

  describe("extractTextTrackTranscript & transcriptToText", () => {
    it("returns null if no text tracks exist", () => {
      const mockVideo = { textTracks: [] } as unknown as HTMLVideoElement;
      expect(extractTextTrackTranscript(mockVideo)).toBeNull();
    });

    it("extracts cues from active text tracks", () => {
      const mockCues = [
        { startTime: 0, endTime: 3.5, text: "Hello and <b>welcome</b>." },
        { startTime: 3.5, endTime: 7.0, text: "In this lecture, we study calculus." },
      ];
      const mockTrack = {
        kind: "subtitles",
        mode: "showing",
        language: "en",
        label: "English (auto)",
        cues: mockCues,
      };
      const mockVideo = {
        textTracks: [mockTrack],
      } as unknown as HTMLVideoElement;

      const result = extractTextTrackTranscript(mockVideo);
      expect(result).not.toBeNull();
      expect(result?.language).toBe("en");
      expect(result?.label).toBe("English (auto)");
      expect(result?.cues).toHaveLength(2);
      expect(result?.cues[0].text).toBe("Hello and welcome.");
      expect(result?.cues[1].text).toBe("In this lecture, we study calculus.");

      const fullText = transcriptToText(result!);
      expect(fullText).toBe("Hello and welcome. In this lecture, we study calculus.");
    });

    it("activates disabled subtitle tracks to hidden mode", () => {
      const mockCues = [
        { startTime: 1, endTime: 2, text: "Testing track." },
      ];
      const mockTrack = {
        kind: "captions",
        mode: "disabled",
        language: "fr",
        label: "Français",
        cues: mockCues,
      };
      const mockVideo = {
        textTracks: [mockTrack],
      } as unknown as HTMLVideoElement;

      const result = extractTextTrackTranscript(mockVideo);
      expect(mockTrack.mode).toBe("hidden");
      expect(result?.language).toBe("fr");
      expect(result?.cues[0].text).toBe("Testing track.");
    });
  });

    it("resolves asynchronously when text tracks or cues load after activation", async () => {
      const cueList: Array<{ startTime: number; endTime: number; text: string }> = [];
      const track = {
        kind: "subtitles",
        mode: "disabled",
        language: "en",
        label: "English",
        get cues() { return cueList.length ? cueList : null; },
      };
      const video = {
        textTracks: Object.assign([track], {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
        querySelectorAll: () => [],
      } as unknown as HTMLVideoElement;

      const controller = new AbortController();
      const pending = loadTextTrackTranscript(video, controller.signal);
      expect(track.mode).toBe("hidden");
      cueList.push({ startTime: 0, endTime: 2, text: "Delayed caption." });
      // Simulate tracks change event
      const changeListener = vi.mocked(video.textTracks.addEventListener).mock.calls.find(c => c[0] === "change")?.[1] as (() => void) | undefined;
      changeListener?.();
      const result = await pending;
      expect(result?.cues[0].text).toBe("Delayed caption.");
    });

    it("returns null when signal is aborted before tracks load", async () => {
      const video = {
        textTracks: Object.assign([], {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
        querySelectorAll: () => [],
      } as unknown as HTMLVideoElement;
      const controller = new AbortController();
      controller.abort();
      const result = await loadTextTrackTranscript(video, controller.signal);
      expect(result).toBeNull();
    });

  describe("isNativePdfViewer", () => {
    it("detects Chrome native PDF viewer embed", () => {
      const mockDoc = {
        querySelector: (selector: string) => {
          if (selector === 'embed[type="application/pdf"]') {
            return {} as HTMLElement;
          }
          return null;
        },
      } as unknown as Document;
      expect(isNativePdfViewer(mockDoc)).toBe(true);
    });

    it("returns false when no native embed is present", () => {
      const mockDoc = {
        querySelector: () => null,
      } as unknown as Document;
      expect(isNativePdfViewer(mockDoc)).toBe(false);
    });
  });
});
