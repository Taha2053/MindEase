// Node-safe stub for webextension-polyfill.
// The real module checks for chrome.runtime.id at load time and throws
// in non-browser environments.  This stub replaces it during tests.

const mockBrowser = {
  runtime: {
    onMessage: { addListener: () => {}, removeListener: () => {} },
    onInstalled: { addListener: () => {}, removeListener: () => {} },
    sendMessage: async () => ({}),
    getURL: (path: string) => `chrome-extension://mock-id/${path}`,
  },
  tabs: {
    get: async () => ({ id: 1, url: "https://example.com" }),
    query: async () => [],
    create: async () => ({ id: 1 }),
    sendMessage: async () => ({}),
    onCreated: { addListener: () => {}, removeListener: () => {} },
    onRemoved: { addListener: () => {}, removeListener: () => {} },
    onUpdated: { addListener: () => {}, removeListener: () => {} },
    onActivated: { addListener: () => {}, removeListener: () => {} },
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
