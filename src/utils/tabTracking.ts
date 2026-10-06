import browser from "webextension-polyfill";
import { STORAGE_KEYS, type WorkspaceSession } from "@/types";
import { isExcludedPage } from "@/utils/pagePrivacy";

export interface TabTrackingState {
  active: boolean;
  included: boolean;
  overridden: boolean;
}

/**
 * Returns tracking state for a given tab:
 * - active: extension active flag is true AND workspace exists and is not ended.
 * - overridden: explicit boolean exists in EXCLUDED_TABS for tabId.
 * - included: tab is active AND:
 *     if explicit boolean in map -> !map[tabId] (since excludedTabs stores true for excluded)
 *     if absent in map -> tab in workspace has category === 'learning'
 */
export async function getTabTrackingState(tabId: number): Promise<TabTrackingState> {
  const result = await browser.storage.local.get([
    STORAGE_KEYS.EXTENSION_ACTIVE,
    STORAGE_KEYS.WORKSPACE,
    STORAGE_KEYS.EXCLUDED_TABS,
  ]);

  const extActive = result[STORAGE_KEYS.EXTENSION_ACTIVE] === true;
  const workspace = result[STORAGE_KEYS.WORKSPACE] as WorkspaceSession | undefined;
  const excludedMap = (result[STORAGE_KEYS.EXCLUDED_TABS] as Record<number, boolean> | undefined) || {};

  const workspaceNotEnded = Boolean(workspace && workspace.state !== "ended");
  const active = extActive && workspaceNotEnded;

  const hasOverride = typeof excludedMap[tabId] === "boolean";
  const overridden = hasOverride;

  let included = false;
  if (active) {
    if (hasOverride) {
      included = !excludedMap[tabId];
    } else {
      const tab = workspace?.tabs?.find(t => t.tabId === tabId);
      included = tab?.category !== "distraction";
    }
  }

  return { active, included, overridden };
}

/* ── URL-guarded category update ────────────────────────────────────────────── */

/**
 * Updates a workspace tab's category only when the tab's current browser URL
 * still matches `expectedUrl`. Prevents a stale async classification from
 * overwriting the entry for a freshly navigated tab.
 *
 * Returns true if the update was applied.
 */
export async function updateTabCategoryGuarded(
  tabId: number,
  expectedUrl: string,
  category: "learning" | "distraction",
  sessionManager: { updateTabCategory(tabId: number, category: "learning" | "distraction"): Promise<void>; getSessionId?(): string | null },
  expectedSessionId?: string | null,
): Promise<boolean> {
  if (expectedSessionId !== undefined && sessionManager.getSessionId && sessionManager.getSessionId() !== expectedSessionId) {
    return false;
  }
  const currentTab = await browser.tabs.get(tabId).catch(() => null);
  if (!currentTab || currentTab.url !== expectedUrl) return false;
  if (expectedSessionId !== undefined && sessionManager.getSessionId?.() !== expectedSessionId) return false;
  await sessionManager.updateTabCategory(tabId, category);
  return true;
}

/* ── Background metadata-only classification ────────────────────────────────── */

/** Well-known learning domains/patterns that do not require an LLM call. */
const LEARNING_URL_PATTERNS: RegExp[] = [
  /^https?:\/\/classroom\.google\.com(?::\d+)?(?:\/|$)/i,
  /^https?:\/\/docs\.google\.com(?::\d+)?\/spreadsheets(?:\/|$)/i,
];

export interface MetadataClassification {
  category: "learning" | "distraction" | "unknown";
  /** How the result was produced: "heuristic" (URL pattern), "llm" (API call on title/URL only), or "unavailable". */
  method: "heuristic" | "llm" | "unavailable";
}

/**
 * Classify a tab using only its title and URL (no page body).
 *
 * - Privacy-excluded or incognito pages → "unknown" / "unavailable" (never sent to LLM).
 * - Well-known learning URLs → "learning" / "heuristic".
 * - Otherwise calls `classifyFn` with title + limited URL context and an explicit
 *   system note that only metadata is available.
 *
 * `classifyFn` is injected to avoid a direct import of llmClient from this utility,
 * keeping the module testable without heavy mocking.
 */
export async function classifyTabByMetadata(
  url: string,
  title: string,
  incognito: boolean,
  classifyFn: (title: string, snippet: string) => Promise<"educational" | "entertainment">,
): Promise<MetadataClassification> {
  // Privacy gate: never send excluded/incognito page metadata to LLM
  if (!url || isExcludedPage(url, incognito)) {
    return { category: "unknown", method: "unavailable" };
  }

  // Heuristic: well-known learning domains
  if (LEARNING_URL_PATTERNS.some(re => re.test(url))) {
    return { category: "learning", method: "heuristic" };
  }

  // LLM classification using only title + URL (honest about limited context)
  try {
    const snippet = `[Only page title and URL available — no page body was fetched.]\nURL: ${url}`;
    const result = await classifyFn(title, snippet);
    return {
      category: result === "educational" ? "learning" : "distraction",
      method: "llm",
    };
  } catch {
    return { category: "unknown", method: "unavailable" };
  }
}

/* ── Preserve EXCLUDED_TABS across session restart ──────────────────────────── */

/**
 * Prunes stale entries from EXCLUDED_TABS, keeping only tab IDs that are
 * still open in the browser. Called before a new session clears workspace data
 * so user overrides persist for tabs that remain open.
 */
export async function pruneExcludedTabs(): Promise<Record<number, boolean>> {
  const res = await browser.storage.local.get(STORAGE_KEYS.EXCLUDED_TABS);
  const existing = (res[STORAGE_KEYS.EXCLUDED_TABS] as Record<number, boolean> | undefined) || {};

  const openTabs = await browser.tabs.query({});
  const openIds = new Set(openTabs.map(t => t.id).filter((id): id is number => id != null));

  const pruned: Record<number, boolean> = {};
  for (const [key, value] of Object.entries(existing)) {
    const id = Number(key);
    if (openIds.has(id)) {
      pruned[id] = value;
    }
  }
  return pruned;
}
/**
 * Concurrency-bounded map helper for async processing.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}
