import browser from "webextension-polyfill";

let _resolve: (() => void) | null = null;
let _reject: ((err: Error) => void) | null = null;

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TTS_DONE") {
    if (msg.payload?.error && _reject) {
      _reject(new Error(msg.payload.error));
    } else if (_resolve) {
      _resolve();
    }
    _resolve = null;
    _reject = null;
  }
});

export function speak(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    _resolve = resolve;
    _reject = reject;
    browser.runtime.sendMessage({ type: "TTS_SPEAK", payload: { text } }).catch(() => {});
  });
}

export function stopPuterTts(): void {
  _resolve = null;
  _reject = null;
  browser.runtime.sendMessage({ type: "TTS_STOP", payload: {} }).catch(() => {});
}
