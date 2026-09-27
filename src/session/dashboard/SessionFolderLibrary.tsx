import { useState, useEffect } from "react";
import browser from "webextension-polyfill";
import {
  getSessionFolders,
  getStorageConfig,
  downloadSessionSummary,
} from "@/utils/sessionStorageManager";
import type { SessionFolderSummary, StorageDestinationConfig } from "@/types";
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
} from "lucide-react";

export function SessionFolderLibrary() {
  const [folders, setFolders] = useState<SessionFolderSummary[]>([]);
  const [config, setConfig] = useState<StorageDestinationConfig | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [activeMediaTab, setActiveMediaTab] = useState<"all" | "videos" | "visuals" | "history">("all");

  const load = () => {
    void Promise.all([getSessionFolders(), getStorageConfig()]).then(([fList, cfg]) => {
      setFolders(fList);
      setConfig(cfg);
      if (fList.length > 0 && !selectedFolderId) {
        setSelectedFolderId(fList[0].sessionId);
      }
    });
  };

  useEffect(() => {
    load();
    browser.storage.onChanged.addListener(load);
    return () => browser.storage.onChanged.removeListener(load);
  }, []);

  const activeFolder = folders.find((f) => f.sessionId === selectedFolderId) ?? folders[0];

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

            <div className="folders-scroll-list">
              {folders.map((folder) => {
                const isSelected = activeFolder?.sessionId === folder.sessionId;
                return (
                  <button
                    key={folder.sessionId}
                    type="button"
                    className={`folder-item-btn ${isSelected ? "is-selected" : ""}`}
                    onClick={() => setSelectedFolderId(folder.sessionId)}
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
                  <h3 className="folder-active-title">{activeFolder.title}</h3>
                  <div className="folder-quick-stats">
                    <span>
                      <Clock size={13} /> {Math.round(activeFolder.durationMs / 60000)} min study
                    </span>
                    <span>
                      <BookOpen size={13} /> {activeFolder.conceptCount} concepts
                    </span>
                    <span>
                      Saved on {new Date(activeFolder.savedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-download-folder"
                  onClick={() => downloadSessionSummary(activeFolder, config?.localPath || "MindEase/Lessons")}
                  title="Export structured session summary JSON"
                >
                  <Download size={14} />
                  <span>Export Folder</span>
                </button>
              </div>

              {/* Subfolder Navigation Tabs */}
              <div className="folder-sub-tabs">
                <button
                  type="button"
                  className={`sub-tab ${activeMediaTab === "all" ? "active" : ""}`}
                  onClick={() => setActiveMediaTab("all")}
                >
                  All Assets ({activeFolder.videos.length + activeFolder.visuals.length + 1})
                </button>
                <button
                  type="button"
                  className={`sub-tab ${activeMediaTab === "videos" ? "active" : ""}`}
                  onClick={() => setActiveMediaTab("videos")}
                >
                  <Film size={13} /> videos/ ({activeFolder.videos.length})
                </button>
                <button
                  type="button"
                  className={`sub-tab ${activeMediaTab === "visuals" ? "active" : ""}`}
                  onClick={() => setActiveMediaTab("visuals")}
                >
                  <ImageIcon size={13} /> visuals/ ({activeFolder.visuals.length})
                </button>
                <button
                  type="button"
                  className={`sub-tab ${activeMediaTab === "history" ? "active" : ""}`}
                  onClick={() => setActiveMediaTab("history")}
                >
                  <FileText size={13} /> history.json
                </button>
              </div>

              {/* Asset Grid Display */}
              <div className="folder-assets-scroll">
                {(activeMediaTab === "all" || activeMediaTab === "videos") && (
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

                {(activeMediaTab === "all" || activeMediaTab === "visuals") && (
                  <div className="asset-group">
                    <h5 className="asset-group-title">
                      <ImageIcon size={14} /> Visuals Folder (<code>visuals/</code>)
                    </h5>
                    {activeFolder.visuals.length === 0 ? (
                      <p className="asset-empty-text">No diagrams saved for this lesson.</p>
                    ) : (
                      <div className="asset-visuals-grid">
                        {activeFolder.visuals.map((vis) => (
                          <div key={vis.id} className="asset-visual-card">
                            <span className="asset-filename">{vis.filename}</span>
                            <div className="visual-img-wrap">
                              <img src={vis.dataUrl} alt={vis.concept} loading="lazy" />
                            </div>
                            <span className="asset-concept-label">{vis.concept}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {(activeMediaTab === "all" || activeMediaTab === "history") && (
                  <div className="asset-group">
                    <h5 className="asset-group-title">
                      <FileText size={14} /> Session History Summary (<code>history.json</code>)
                    </h5>
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
                      <div className="history-stat-line">
                        <strong>Concepts Covered:</strong>
                        <div className="history-concepts-pills">
                          {activeFolder.history.concepts.map((c, i) => (
                            <span key={i} className="concept-pill">{c}</span>
                          ))}
                        </div>
                      </div>
                      <p className="history-summary-p">{activeFolder.history.summaryText}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
