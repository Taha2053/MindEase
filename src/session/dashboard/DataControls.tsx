import { ApiKeysSection } from "./ApiKeysSection";
import { StorageDestinationSelector } from "./StorageDestinationSelector";
import { useState } from "react";
import { deleteAllUserData, exportUserData } from "@/utils/userData";
import { AccountControls } from "./AccountControls";

export function DataControls() {
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const data = await exportUserData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `mindease-data-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click(); URL.revokeObjectURL(url);
      setStatus("Learner data exported. Provider keys were excluded.");
    } catch { setStatus("Data could not be exported."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const count = await deleteAllUserData();
      setStatus(`${count} stored learner-data entries deleted. Reloading…`);
      setTimeout(() => window.location.reload(), 700);
    } catch { setStatus("Data could not be deleted."); setBusy(false); }
  };

  return (
    <div className="data-controls-container" id="section-data" data-section="data">
      {/* 1. Storage Destination & Local Folder Path */}
      <StorageDestinationSelector />

      {/* 2. Account & Cloud Synchronization */}
      <AccountControls />

      {/* 3. API Keys & AI Service Providers */}
      <ApiKeysSection />

      {/* 4. Local Telemetry Export & Reset */}
      <section className="section-card data-controls-subcard">
        <div className="section-card-header">
          <h2>Local Data &amp; Privacy Management</h2>
        </div>
        <p style={{ margin: "4px 0 14px", fontSize: "0.84rem", color: "var(--text-dim)" }}>
          Export your entire telemetry and session history as JSON, or permanently wipe all local profile and cache data from this browser.
        </p>
        <div className="feedback-actions">
          <button type="button" disabled={busy} onClick={download}>Export learner data</button>
          {!confirming ? (
            <button type="button" disabled={busy} onClick={() => setConfirming(true)}>Delete learner data</button>
          ) : (
            <>
              <span style={{ fontSize: "0.8rem", color: "var(--danger)" }}>This removes all profiles, sessions, feedback, and cached visuals from this device.</span>
              <button type="button" disabled={busy} onClick={remove}>Confirm deletion</button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
            </>
          )}
        </div>
        {status && <p role="status" aria-live="polite" style={{ fontSize: "0.8rem", color: "var(--accent)", marginTop: 8 }}>{status}</p>}
      </section>
    </div>
  );
}
