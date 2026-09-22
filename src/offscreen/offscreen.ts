/* offscreen.ts — Audio playback for Azure TTS via offscreen document (MV3)
   Runs in an offscreen document with reason AUDIO_PLAYBACK. Receives base64
   audio from background and plays it with a single <audio> element. This
   bypasses content-script autoplay/CSP restrictions that block blob: URLs.
*/

let activeAudio: HTMLAudioElement | null = null;
let pendingPlayRespond: ((resp: Record<string, unknown>) => void) | null = null;

function stopActive(): void {
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.src = "";
      activeAudio.removeAttribute("src");
      activeAudio.load();
    } catch {}
    activeAudio = null;
  }
}

function resolvePendingPlay(resp: Record<string, unknown>): void {
  if (pendingPlayRespond) {
    const fn = pendingPlayRespond;
    pendingPlayRespond = null;
    try { fn(resp); } catch {}
  }
}

// chrome is available globally in offscreen; use it directly for speed
const runtime = (globalThis as unknown as { chrome?: any }).chrome?.runtime;

if (runtime) {
  runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (resp: unknown) => void) => {
    const msg = message as { type?: string; payload?: Record<string, unknown> };
    if (!msg || typeof msg.type !== "string") return false;

    if (msg.type === "OFFSCREEN_PLAY") {
      const payload = (msg.payload ?? {}) as { audioBase64?: string; contentType?: string; volume?: number; rate?: number };
      const base64 = typeof payload.audioBase64 === "string" ? payload.audioBase64 : "";
      const contentType = typeof payload.contentType === "string" ? payload.contentType : "audio/mpeg";
      const volume = typeof payload.volume === "number" ? payload.volume : 1.0;

      if (!base64) {
        sendResponse({ error: "OFFSCREEN_PLAY: empty audio" });
        return false;
      }

      // Cancel any previous pending play
      if (pendingPlayRespond) {
        const prev = pendingPlayRespond;
        pendingPlayRespond = null;
        try { prev({ success: true }); } catch {}
      }
      stopActive();
      const dataUrl = `data:${contentType};base64,${base64}`;
      const audio = new Audio(dataUrl);
      activeAudio = audio;
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.preload = "auto";
      audio.playbackRate = Math.max(0.5, Math.min(2, payload.rate ?? 1));

      let responded = false;
      const respond = (resp: Record<string, unknown>): void => {
        if (responded) return;
        responded = true;
        pendingPlayRespond = null;
        try { sendResponse(resp); } catch {}
      };
      pendingPlayRespond = respond;

      audio.onended = () => {
        stopActive();
        respond({ success: true });
      };
      audio.onerror = () => {
        const err = audio.error ? `${audio.error.code}: ${audio.error.message}` : "unknown";
        stopActive();
        respond({ error: `Audio playback error: ${err}` });
      };

      audio.play().then(() => {
        // playback started, wait for onended to respond — keep channel open
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        stopActive();
        respond({ error: message });
      });

      return true;
    }

    if (msg.type === "OFFSCREEN_STOP") {
      const wasPending = !!pendingPlayRespond;
      stopActive();
      if (wasPending) resolvePendingPlay({ success: true });
      sendResponse({ success: true });
      return false;
    }

    if (msg.type === "OFFSCREEN_PAUSE") {
      if (activeAudio && !activeAudio.paused) activeAudio.pause();
      sendResponse({ success: true, paused: activeAudio?.paused ?? true });
      return false;
    }

    if (msg.type === "OFFSCREEN_RESUME") {
      if (activeAudio && activeAudio.paused) {
        activeAudio.play().then(() => sendResponse({ success: true })).catch((e: unknown) => sendResponse({ error: String(e) }));
        return true;
      }
      sendResponse({ success: true });
      return false;
    }

    if (msg.type === "OFFSCREEN_IS_PLAYING") {
      const playing = !!activeAudio && !activeAudio.paused && !activeAudio.ended;
      sendResponse({ playing, paused: activeAudio?.paused ?? false });
      return false;
    }

    return false;
  });
}
