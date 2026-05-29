// Node-safe stub for webextension-polyfill.
// The real module checks for chrome.runtime.id at load time and throws
// in non-browser environments.  This stub replaces it during tests.

const mockBrowser = {
  runtime: {
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
  },
};

export default mockBrowser;
