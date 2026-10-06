import type { Tabs } from "webextension-polyfill";
import type { WorkspaceSession } from "@/types";
import { isPdfUrl } from "@/content/sourceHelpers";
import { isExcludedPage } from "@/utils/pagePrivacy";
import { Globe } from "lucide-react";

export function TabList({ tabs, session, excludedTabs, onToggle, onReadPdf }: {
  tabs: Tabs.Tab[];
  onReadPdf?: (tab: Tabs.Tab) => void;
  session: WorkspaceSession | null;
  excludedTabs: Record<number, boolean>;
  onToggle: (tabId: number) => void;
}) {
  // Show valid study tabs, filtering out internal browser pages
  const studyTabs = tabs.filter(tab => {
    if (!tab.url) return false;
    return !isExcludedPage(tab.url, Boolean(tab.incognito));
  });

  if (studyTabs.length === 0) return null;
  return <section aria-label="Open study tabs">
    <div className="section-title">Study tabs ({studyTabs.length})</div>
    <div className="tab-list">
      {studyTabs.map(tab => {
        const resource = session?.tabs.find(item => item.tabId === tab.id && item.url === tab.url);
        const category = resource?.category;
        const isDistraction = category === "distraction";
        const isLearning = category === "learning";
        const classification = isDistraction ? "Non-learning" : isLearning ? "Learning" : "Pending";
        const badgeClass = isDistraction ? "distraction" : isLearning ? "learning" : "unknown";
        const overridden = tab.id !== undefined && typeof excludedTabs[tab.id] === "boolean";
        const included = overridden ? !excludedTabs[tab.id!] : !isDistraction;
        const title = tab.title || tab.url || "Untitled tab";
        return <div className="tab-row" key={tab.id}>
          {tab.favIconUrl ? (
            <img
              src={tab.favIconUrl}
              className="tab-favicon"
              alt=""
              onError={(e) => { (e.currentTarget as HTMLElement).style.display = "none"; }}
            />
          ) : (
            <Globe size={14} className="tab-favicon" style={{ color: "var(--text-muted)" }} />
          )}
          <span className="tab-title" title={tab.url}>{title}</span>
          <span className={`tab-badge ${badgeClass}`}>{classification}</span>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(included)}
            aria-label={`Include ${title} in adaptation`}
            className={`tab-switch ${included ? "active" : ""}`}
            onClick={() => tab.id !== undefined && onToggle(tab.id)}
          >
            <span className="tab-switch-track">
              <span className="tab-switch-thumb" />
            </span>
            <span className="tab-switch-label">{included ? "Active" : "Off"}</span>
          </button>
          {tab.url && isPdfUrl(tab.url) && onReadPdf && (
            <button type="button" className="btn-pdf-reader" onClick={() => onReadPdf(tab)}>
              Read PDF
            </button>
          )}
        </div>;
      })}
    </div>
  </section>;
}
