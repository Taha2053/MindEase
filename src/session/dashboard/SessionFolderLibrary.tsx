import { useState, useEffect } from "react";
import browser from "webextension-polyfill";
import {
  getSessionFolders,
  getStorageConfig,
  downloadSessionSummary,
  syncSessionFolders,
} from "@/utils/sessionStorageManager";
import {
  downloadAnkiExport,
  downloadMarkdownExport,
  isValidHttpUrl,
} from "@/session/reviewExports";
import { renderMarkdown } from "@/utils/markdown";
import { syncNow } from "@/utils/supabase";
import type { SessionFolderSummary, StorageDestinationConfig } from "@/types";
import { STORAGE_KEYS } from "@/types";
import {
  Folder,
  FolderOpen,
  Film,
  Image as ImageIcon,
  FileText,
  Download,
  HardDrive,
  Cloud,
  ChevronRight,
  Clock,
  BookOpen,
  RefreshCw,
  AlertCircle,
  Pencil,
  Check,
  X,
  Maximize2,
} from "lucide-react";
import "./SessionFolderLibrary.css";

export function SessionFolderLibrary() {
  const [folders, setFolders] = useState<SessionFolderSummary[]>([]);
  const [config, setConfig] = useState<StorageDestinationConfig | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"review" | "summary" | "diagrams" | "videos">("review");
  const [isSyncing, setIsSyncing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState("");
  const [selectedVisual, setSelectedVisual] = useState<{ id: string; concept: string; dataUrl: string; filename: string } | null>(null);
  const [modalZoom, setModalZoom] = useState(1);

  const handleSaveTitle = async (folder: SessionFolderSummary) => {
    const trimmed = tempTitle.trim();
    if (!trimmed || trimmed === folder.title) {
      setEditingTitle(false);
      return;
    }
    const updated = folders.map(f => f.folderName === folder.folderName ? { ...f, title: trimmed } : f);
    setFolders(updated);
    await browser.storage.local.set({ [STORAGE_KEYS.SESSION_FOLDERS]: updated });
    const histRes = await browser.storage.local.get(STORAGE_KEYS.SESSION_HISTORY);
    const hist = (histRes[STORAGE_KEYS.SESSION_HISTORY] as Array<{ endTime: number; name: string }> | undefined) ?? [];
    const updatedHist = hist.map(h => {
      if (h.endTime === folder.savedAt || h.name === folder.title) {
        return { ...h, name: trimmed };
      }
      return h;
    });
    await browser.storage.local.set({ [STORAGE_KEYS.SESSION_HISTORY]: updatedHist });
    void syncNow().catch(() => {});
    setEditingTitle(false);
  };

  const load = async () => {
    try {
      setLoadError(null);
      const [fList, cfg] = await Promise.all([getSessionFolders(), getStorageConfig()]);
      setFolders(fList);
      setConfig(cfg);
      setSelectedFolderId((prev) => {
        if (prev && fList.some((f) => f.sessionId === prev)) return prev;
        return fList.length > 0 ? fList[0].sessionId : null;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load session folders.";
      setLoadError(msg);
    }
  };

  useEffect(() => {
    void load();

    const handleStorageChange = (
      changes: Record<string, browser.Storage.StorageChange>,
      areaName: string
    ) => {
      // Only react to local storage changes to avoid extraneous triggers
      if (areaName !== "local") return;
      if (
        STORAGE_KEYS.SESSION_FOLDERS in changes ||
        STORAGE_KEYS.AUTH_SESSION in changes ||
        STORAGE_KEYS.STORAGE_DESTINATION in changes
      ) {
        void load();
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    return () => {
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const handleRetrySync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncError(null);
    try {
      await syncSessionFolders();
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Cloud synchronization failed. Retry sync.";
      setSyncError(msg);
    } finally {
      setIsSyncing(false);
    }
  };

  const activeFolder = folders.find((f) => f.sessionId === selectedFolderId) ?? folders[0];

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tabList: Array<"review" | "summary" | "diagrams" | "videos"> = [
      "review",
      "summary",
      "diagrams",
      "videos",
    ];
    const currentIndex = tabList.indexOf(activeTab);
    if (currentIndex === -1) return;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % tabList.length;
      setActiveTab(tabList[nextIndex]);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + tabList.length) % tabList.length;
      setActiveTab(tabList[prevIndex]);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveTab(tabList[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveTab(tabList[tabList.length - 1]);
    }
  };

  const handleFolderKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowDown" && index < folders.length - 1) {
      e.preventDefault();
      setSelectedFolderId(folders[index + 1].sessionId);
    } else if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      setSelectedFolderId(folders[index - 1].sessionId);
    }
  };

  return (
    <section className="section-card session-library-section">
      <div className="section-card-header session-library-header">
        <div>
          <span className="library-badge">Archive Explorer</span>
          <h2>Lesson Sessions &amp; Media Vault</h2>
          <p className="library-sub">
            Organized into lesson folders (<code>YYYY-MM-DD_Session-XX</code>) containing all generated videos,
            conceptual diagrams, and study summaries.
          </p>
        </div>

        {config && (
          <div className="library-storage-indicator">
            {config.destination === "local" ? (
              <>
                <HardDrive size={15} />
                <span>Local: <code>{config.localPath}</code></span>
              </>
            ) : (
              <>
                <Cloud size={15} />
                <span>Supabase Cloud: <code>lessons/</code></span>
              </>
            )}
          </div>
        )}
      </div>

      {loadError && (
        <div role="alert" className="library-load-error-banner">
          <span>{loadError}</span>
          <button type="button" onClick={() => void load()} className="btn-retry-load">
            Retry
          </button>
        </div>
      )}

      {folders.length === 0 ? (
        <div className="library-empty-box">
          <Folder size={36} />
          <h4>No Session Folders Yet</h4>
          <p>
            When you complete study sessions with MindEase, structured folders with all lesson videos,
            visuals, and summaries will be automatically saved and archived here.
          </p>
        </div>
      ) : (
        <div className="library-layout-grid">
          {/* Folders List (Left column) */}
          <div className="folders-sidebar">
            <div className="folders-list-head">
              <FolderOpen size={16} />
              <span>Saved Lessons ({folders.length})</span>
            </div>

            <div className="folders-scroll-list" role="navigation" aria-label="Session folders">
              {folders.map((folder, index) => {
                const isSelected = activeFolder?.sessionId === folder.sessionId;
                return (
                  <button
                    key={folder.sessionId}
                    type="button"
                    className={`folder-item-btn ${isSelected ? "is-selected" : ""}`}
                    onClick={() => setSelectedFolderId(folder.sessionId)}
                    onKeyDown={(e) => handleFolderKeyDown(e, index)}
                    aria-current={isSelected ? "true" : undefined}
                  >
                    <div className="folder-item-icon">
                      {isSelected ? <FolderOpen size={18} /> : <Folder size={18} />}
                    </div>
                    <div className="folder-item-info">
                      <span className="folder-item-name">{folder.folderName}</span>
                      <strong className="folder-item-title">{folder.title}</strong>
                      <div className="folder-item-meta">
                        <span>{folder.videos.length} videos</span>
                        <span>•</span>
                        <span>{folder.visuals.length} visuals</span>
                        {folder.studyCards && folder.studyCards.length > 0 && (
                          <>
                            <span>•</span>
                            <span>{folder.studyCards.length} cards</span>
                          </>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={14} className="folder-item-arrow" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Folder Content Inspector (Right column) */}
          {activeFolder && (
            <div className="folder-contents-panel">
              <div className="folder-panel-header">
                <div>
                  <div className="folder-breadcrumb">
                    <span className="folder-pill-dest">
                      {activeFolder.destination === "local" ? (
                        <>
                          <HardDrive size={12} /> Local Disk
                        </>
                      ) : (
                        <>
                          <Cloud size={12} /> Supabase
                        </>
                      )}
                    </span>
                    <code>
                      {config?.destination === "local" ? config.localPath : "lessons"}
                      /{activeFolder.folderName}/
                    </code>
                  </div>

                  <div className="folder-title-row">
                    {editingTitle ? (
                      <div className="folder-title-edit-wrap">
                        <input
                          type="text"
                          className="folder-title-input"
                          value={tempTitle}
                          onChange={e => setTempTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") void handleSaveTitle(activeFolder);
                            if (e.key === "Escape") setEditingTitle(false);
                          }}
                          autoFocus
                        />
                        <button type="button" className="btn-title-save" onClick={() => void handleSaveTitle(activeFolder)} title="Save title">
                          <Check size={14} />
                        </button>
                        <button type="button" className="btn-title-cancel" onClick={() => setEditingTitle(false)} title="Cancel">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="folder-title-display-wrap" onClick={() => { setTempTitle(activeFolder.title); setEditingTitle(true); }}>
                        <h3 className="folder-active-title" title="Click to rename">{activeFolder.title}</h3>
                        <button type="button" className="btn-rename-icon" title="Rename session" onClick={e => { e.stopPropagation(); setTempTitle(activeFolder.title); setEditingTitle(true); }}>
                          <Pencil size={13} />
                        </button>
                      </div>
                    )}
                    <div className="folder-sync-badge-group">
                      {activeFolder.syncState === "synced" && (
                        <span className="sync-badge sync-badge-synced">Synced</span>
                      )}
                      {activeFolder.syncState === "pending" && (
                        <span className="sync-badge sync-badge-pending">Sync pending</span>
                      )}
                      {activeFolder.syncState === "error" && (
                        <span className="sync-badge sync-badge-error">Sync error</span>
                      )}
                      {(!activeFolder.syncState || activeFolder.syncState === "local") && (
                        <span className="sync-badge sync-badge-local">Local</span>
                      )}

                      {(activeFolder.syncState === "error" ||
                        activeFolder.syncError ||
                        (activeFolder.destination === "supabase" && activeFolder.syncState !== "synced")) && (
                        <button
                          type="button"
                          className="btn-retry-sync"
                          onClick={handleRetrySync}
                          disabled={isSyncing}
                          title="Retry syncing this session folder to cloud storage"
                        >
                          <RefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
                          <span>{isSyncing ? "Retrying..." : "Retry sync"}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="folder-quick-stats">
                    <span>
                      <Clock size={13} /> {Math.round(activeFolder.durationMs / 60000)} min study
                    </span>
                    <span>
                      <BookOpen size={13} /> {activeFolder.conceptCount} concepts
                    </span>
                    <span>
                      Saved on {new Date(activeFolder.savedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                    </span>
                  </div>
                </div>

                {/* Export Actions Toolbar */}
                <div className="folder-export-actions">
                  <button
                    type="button"
                    className="btn-export-action"
                    onClick={() => downloadAnkiExport(activeFolder)}
                    title="Export review cards as Anki TSV deck"
                  >
                    <Download size={13} />
                    <span>Anki TSV</span>
                  </button>
                  <button
                    type="button"
                    className="btn-export-action"
                    onClick={() => downloadMarkdownExport(activeFolder)}
                    title="Export lesson notes and chunks as Markdown"
                  >
                    <Download size={13} />
                    <span>Markdown</span>
                  </button>
                  <button
                    type="button"
                    className="btn-export-action"
                    onClick={() => downloadSessionSummary(activeFolder, config?.localPath || "MindEase/Lessons")}
                    title="Export session archive data and asset metadata as JSON"
                  >
                    <Download size={13} />
                    <span>Archive JSON</span>
                  </button>
                </div>
              </div>

              {/* Per-folder Sync Error Display */}
              {(activeFolder.syncError || syncError) && (
                <div role="alert" className="folder-sync-error-banner">
                  <div className="sync-error-msg">
                    <AlertCircle size={15} />
                    <span>
                      <strong>Sync Error:</strong> {activeFolder.syncError || syncError}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-retry-sync"
                    onClick={handleRetrySync}
                    disabled={isSyncing}
                  >
                    {isSyncing ? "Retrying..." : "Retry sync"}
                  </button>
                </div>
              )}

              {/* Subfolder Navigation Tabs: Review / Summary / Diagrams / Videos */}
              <div
                className="folder-sub-tabs"
                role="tablist"
                aria-label="Session content tabs"
                onKeyDown={handleTabKeyDown}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "review"}
                  className={`sub-tab ${activeTab === "review" ? "active" : ""}`}
                  onClick={() => setActiveTab("review")}
                >
                  <BookOpen size={13} />
                  <span>Review ({activeFolder.studyCards?.length ?? 0})</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "summary"}
                  className={`sub-tab ${activeTab === "summary" ? "active" : ""}`}
                  onClick={() => setActiveTab("summary")}
                >
                  <FileText size={13} />
                  <span>Summary</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "diagrams"}
                  className={`sub-tab ${activeTab === "diagrams" ? "active" : ""}`}
                  onClick={() => setActiveTab("diagrams")}
                >
                  <ImageIcon size={13} />
                  <span>Diagrams ({activeFolder.visuals.length})</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "videos"}
                  className={`sub-tab ${activeTab === "videos" ? "active" : ""}`}
                  onClick={() => setActiveTab("videos")}
                >
                  <Film size={13} />
                  <span>Videos ({activeFolder.videos.length})</span>
                </button>
              </div>

              {/* Tab Panel Content Display */}
              <div className="folder-assets-scroll" role="tabpanel">
                {/* 1. Review Tab: Native details/summary study cards */}
                {activeTab === "review" && (
                  <div className="asset-group">
                    <h5 className="asset-group-title">
                      <BookOpen size={14} /> Review Study Cards ({activeFolder.studyCards?.length ?? 0})
                    </h5>

                    {!activeFolder.studyCards || activeFolder.studyCards.length === 0 ? (
                      <div className="review-empty-box">
                        <BookOpen size={32} />
                        <p>This older session has no saved cards.</p>
                      </div>
                    ) : (
                      <div className="review-cards-list">
                        {activeFolder.studyCards.map((card) => {
                          const isUrl = isValidHttpUrl(card.sourceId);
                          return (
                            <details key={card.id} className="review-card-item">
                              <summary className="review-card-summary">
                                <div className="review-card-summary-left">
                                  <ChevronRight size={16} className="review-card-chevron" />
                                  <span className="review-card-question">
                                    What do you recall about {card.concept}?
                                  </span>
                                </div>
                                <div className="review-card-badges">
                                  {card.reviewFlag && (
                                    <span className="review-flag-badge">Needs Review</span>
                                  )}
                                  <span className="review-format-pill">{card.format}</span>
                                </div>
                              </summary>
                              <div className="review-card-body">
                                <div
                                  className="review-card-markdown-content"
                                  dangerouslySetInnerHTML={{ __html: renderMarkdown(card.content) }}
                                />
                                {card.sourceId && (
                                  <div className="review-card-source-row">
                                    <span>Source:</span>{" "}
                                    {isUrl ? (
                                      <a
                                        href={card.sourceId}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="review-source-anchor"
                                      >
                                        {card.sourceId}
                                      </a>
                                    ) : (
                                      <span className="review-source-plain">{card.sourceId}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </details>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Summary Tab: History summary, resources links, actual saved chunks */}
                {activeTab === "summary" && (
                  <div className="summary-sections-container">
                    {/* Session History Summary */}
                    <div className="asset-history-box">
                      <div className="history-stat-line">
                        <strong>Topic:</strong> {activeFolder.history.topic}
                      </div>
                      <div className="history-stat-line">
                        <strong>Study Duration:</strong> {activeFolder.history.timeSpentMinutes} minutes
                      </div>
                      <div className="history-stat-line">
                        <strong>Notes Logged:</strong> {activeFolder.history.notesCount}
                      </div>
                      {activeFolder.history.concepts.length > 0 && (
                        <div className="history-stat-line">
                          <strong>Concepts Covered:</strong>
                          <div className="history-concepts-pills">
                            {activeFolder.history.concepts.map((c, i) => (
                              <span key={i} className="concept-pill">{c}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {activeFolder.history.summaryText && (
                        <div
                          className="history-summary-p"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(activeFolder.history.summaryText) }}
                        />
                      )}
                    </div>

                    {/* Resources Links */}
                    {Array.isArray(activeFolder.resources) && activeFolder.resources.length > 0 && (
                      <div className="summary-resources-section">
                        <h5 className="summary-section-title">
                          <BookOpen size={14} /> Lesson Resources ({activeFolder.resources.length})
                        </h5>
                        <div className="summary-resources-grid">
                          {activeFolder.resources.map((res, i) => {
                            const isUrl = isValidHttpUrl(res.url);
                            return (
                              <div key={i} className="summary-resource-card">
                                <span className="resource-type-pill">{res.sourceType}</span>
                                <div className="resource-card-info">
                                  <strong className="resource-title">{res.title || res.url}</strong>
                                  {isUrl ? (
                                    <a
                                      href={res.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="resource-link-anchor"
                                    >
                                      {res.url}
                                    </a>
                                  ) : (
                                    <span className="resource-link-plain">{res.url}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Saved Content Chunks */}
                    {Array.isArray(activeFolder.content) && activeFolder.content.length > 0 && (
                      <div className="summary-chunks-section">
                        <h5 className="summary-section-title">
                          <FileText size={14} /> Saved Content Chunks ({activeFolder.content.length})
                        </h5>
                        <div className="summary-chunks-list">
                          {activeFolder.content.map((chunk, i) => (
                            <div key={chunk.id || i} className="summary-chunk-card">
                              <div className="chunk-header">
                                <span className="chunk-pos-badge">#{chunk.position + 1}</span>
                                {chunk.conceptTags && chunk.conceptTags.length > 0 && (
                                  <div className="chunk-tags">
                                    {chunk.conceptTags.map((t, idx) => (
                                      <span key={idx} className="concept-pill">{t}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div
                                className="chunk-body-markdown"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(chunk.text) }}
                              />
                              {chunk.sourceText && chunk.sourceText.trim() !== chunk.text.trim() && (
                                <details className="chunk-original-details">
                                  <summary>Original Source Excerpt</summary>
                                  <div
                                    className="chunk-original-body"
                                    dangerouslySetInnerHTML={{ __html: renderMarkdown(chunk.sourceText) }}
                                  />
                                </details>
                              )}
                              {chunk.sourceId && (
                                <div className="chunk-source-footnote">
                                  <span>Source: </span>
                                  {isValidHttpUrl(chunk.sourceId) ? (
                                    <a href={chunk.sourceId} target="_blank" rel="noopener noreferrer">
                                      {chunk.sourceId}
                                    </a>
                                  ) : (
                                    <span>{chunk.sourceId}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Diagrams Tab */}
                {activeTab === "diagrams" && (
                  <div className="asset-group">
                    <h5 className="asset-group-title">
                      <ImageIcon size={14} /> Visuals Folder (<code>visuals/</code>)
                    </h5>
                    {activeFolder.visuals.length === 0 ? (
                      <p className="asset-empty-text">No diagrams saved for this lesson.</p>
                    ) : (
                      <div className="asset-visuals-grid">
                        {activeFolder.visuals.map((vis) => (
                          <div key={vis.id} className="asset-visual-card" onClick={() => { setSelectedVisual(vis); setModalZoom(1); }} title="Click to open full size">
                            <span className="asset-filename">{vis.filename}</span>
                            <div className="visual-img-wrap">
                              <img src={vis.dataUrl} alt={vis.concept} loading="lazy" />
                              <span className="btn-zoom-visual">
                                <Maximize2 size={11} /> Open
                              </span>
                            </div>
                            <span className="asset-concept-label">{vis.concept}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Videos Tab */}
                {activeTab === "videos" && (
                  <div className="asset-group">
                    <h5 className="asset-group-title">
                      <Film size={14} /> Videos Folder (<code>videos/</code>)
                    </h5>
                    {activeFolder.videos.length === 0 ? (
                      <p className="asset-empty-text">No videos saved for this lesson.</p>
                    ) : (
                      <div className="asset-videos-grid">
                        {activeFolder.videos.map((vid) => (
                          <div key={vid.id} className="asset-video-card">
                            <span className="asset-filename">{vid.filename}</span>
                            <div className="video-wrap">
                              <video controls preload="metadata" src={vid.videoUrl} />
                            </div>
                            <span className="asset-concept-label">{vid.concept}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {selectedVisual && (
        <div className="visual-modal-backdrop" onClick={() => setSelectedVisual(null)}>
          <div className="visual-modal-content" onClick={e => e.stopPropagation()}>
            <div className="visual-modal-header">
              <div className="visual-modal-info">
                <h4>{selectedVisual.concept}</h4>
                <code>{selectedVisual.filename}</code>
              </div>
              <div className="visual-modal-actions">
                <button type="button" className="btn-modal-action" onClick={() => setModalZoom(z => Math.max(0.5, z - 0.25))} title="Zoom out">−</button>
                <span className="modal-zoom-display">{Math.round(modalZoom * 100)}%</span>
                <button type="button" className="btn-modal-action" onClick={() => setModalZoom(z => Math.min(4, z + 0.25))} title="Zoom in">+</button>
                <button type="button" className="btn-modal-action" onClick={() => setModalZoom(1)} title="Reset zoom">Reset</button>
                <button type="button" className="btn-modal-action btn-modal-close" onClick={() => setSelectedVisual(null)} title="Close">
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="visual-modal-body">
              <img
                src={selectedVisual.dataUrl}
                alt={selectedVisual.concept}
                style={{ transform: `scale(${modalZoom})` }}
                className="visual-modal-image"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
